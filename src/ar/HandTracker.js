import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// Must match the @mediapipe/tasks-vision version in package.json: the WASM and
// the JS bundle are released together and a mismatch fails to instantiate.
const TASKS_VISION_VERSION = '1.0.1';
const WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Landmark indices we care about (MediaPipe hand topology).
const WRIST = 0;
const INDEX_MCP = 5;
const MIDDLE_MCP = 9;
const PINKY_MCP = 17;
const FINGERTIPS = [8, 12, 16, 20];

// Mean fingertip reach over palm length. Against real hand geometry a relaxed
// open palm lands near 1.9 and a fist near 1.1, so the old 1.85 entry sat right
// on the edge: you had to splay hard and hold it. Enter well below a
// comfortable palm, and keep the exit clear of a fist.
export const OPEN_ENTER = 1.55;
export const OPEN_EXIT = 1.25;

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));

/** Average of wrist and the two outer knuckles — steadier than any single point. */
function palmCentre(points) {
  const a = points[WRIST];
  const b = points[INDEX_MCP];
  const c = points[PINKY_MCP];
  return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
}

function openness(points) {
  const wrist = points[WRIST];
  const palmLength = distance(wrist, points[MIDDLE_MCP]);
  if (palmLength < 1e-4) return 0;
  const reach = FINGERTIPS.reduce((sum, i) => sum + distance(wrist, points[i]), 0) / FINGERTIPS.length;
  return reach / palmLength;
}

/**
 * Wraps MediaPipe's hand landmarker and reduces each frame to the two things
 * the sky gesture needs: which hand is anchoring, and where the other one is.
 *
 * A user-facing feed sees you reversed: your right hand is reported as "Left",
 * and moving it to your right walks it toward image-left. `mirrored` undoes
 * both, so downstream code always gets "x grows as the hand moves to the user's
 * right" whichever camera is running.
 */
export class HandTracker {
  constructor({ anchorHand = 'Right', mirrored = true } = {}) {
    this.anchorHand = anchorHand;
    this.mirrored = mirrored;
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.wasOpen = { Left: false, Right: false };
  }

  async load() {
    if (this.landmarker) return;
    const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT);
    this.landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6
    });
  }

  close() {
    this.landmarker?.close();
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.wasOpen = { Left: false, Right: false };
  }

  /** The label MediaPipe will use for the hand the user thinks of as the anchor. */
  get anchorLabel() {
    if (!this.mirrored) return this.anchorHand;
    return this.anchorHand === 'Right' ? 'Left' : 'Right';
  }

  /**
   * Reads one video frame.
   * @returns null when the frame was already read or no usable pair was found,
   *   otherwise { anchorOpen, driver: {x, y}, driverOpen, spread }.
   */
  read(video, timestampMs) {
    if (!this.landmarker || video.readyState < 2) return null;
    if (video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;

    const result = this.landmarker.detectForVideo(video, timestampMs);
    const hands = result?.landmarks ?? [];
    if (hands.length < 2) {
      // Deliberately NOT clearing `wasOpen` here: detection drops to one hand
      // constantly, and resetting hysteresis sends an already-open palm back to
      // the strict entry threshold, which is what made arming feel slow.
      // Still worth reporting so the preview shows tracking before it can arm.
      return {
        partial: true,
        hands: hands.map((points) => ({ points, role: 'driver' })),
        openness: hands.length ? openness(hands[0]) : 0
      };
    }

    const anchorLabel = this.anchorLabel;
    let anchor = null;
    let driver = null;

    hands.forEach((points, i) => {
      const label = result.handednesses?.[i]?.[0]?.categoryName ?? result.handedness?.[i]?.[0]?.categoryName;
      const hand = { points, label };
      if (label === anchorLabel && !anchor) anchor = hand;
      else if (!driver) driver = hand;
    });

    // Both hands labelled the same way (a common miscall at the edge of frame):
    // fall back to screen order, which is stable enough to keep the gesture alive.
    if (!anchor || !driver) {
      const byX = hands.map((points) => ({ points, centre: palmCentre(points) }))
        .sort((a, b) => a.centre.x - b.centre.x);
      const anchorIsLeftOfFrame = anchorLabel === 'Left';
      anchor = { points: (anchorIsLeftOfFrame ? byX[0] : byX[1]).points };
      driver = { points: (anchorIsLeftOfFrame ? byX[1] : byX[0]).points };
    }

    const anchorCentre = this.toUserFrame(palmCentre(anchor.points));
    const driverCentre = this.toUserFrame(palmCentre(driver.points));

    return {
      partial: false,
      // Surfaced so the preview can show why a palm is not arming.
      openness: openness(anchor.points),
      anchorOpen: this.isOpen(anchorLabel, anchor.points),
      driverOpen: this.isOpen(anchorLabel === 'Left' ? 'Right' : 'Left', driver.points),
      driver: driverCentre,
      anchor: anchorCentre,
      spread: Math.hypot(driverCentre.x - anchorCentre.x, driverCentre.y - anchorCentre.y),
      // Raw frame coordinates, for drawing over the camera image.
      hands: [{ points: anchor.points, role: 'anchor' }, { points: driver.points, role: 'driver' }]
    };
  }

  /**
   * Puts a point in the user's own left-right frame. Without this the two
   * cameras disagree on which way a sweep turns the sky.
   */
  toUserFrame(point) {
    return this.mirrored ? { x: 1 - point.x, y: point.y } : point;
  }

  /** Hysteresis keeps a hand hovering near the threshold from flickering. */
  isOpen(key, points) {
    const value = openness(points);
    const open = this.wasOpen[key] ? value > OPEN_EXIT : value > OPEN_ENTER;
    this.wasOpen[key] = open;
    return open;
  }
}
