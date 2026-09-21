import * as THREE from 'three';
import { HandTracker } from './HandTracker.js';

// Hand travel across the frame, in radians of sky. A full sweep of the frame
// turns the map roughly a half-turn, which keeps big arcs feeling weighty.
const YAW_GAIN = Math.PI * 1.15;
const PITCH_GAIN = Math.PI * 0.55;
/*
 * The sky behaves as a heavy flywheel rather than a cursor. Velocity used to
 * chase the hand directly with no threshold, so every twitch of a hand that is
 * simply in shot moved the map.
 *
 * Torque is the gap between the speed the hand is asking for and the speed the
 * wheel already has. Coulomb friction eats a fixed slice of that torque, and
 * the slice is larger at rest than in motion — so it takes a deliberate shove
 * to break away, and only a nudge to keep it going or steer it. Mass
 * (SPIN_UP) limits how fast torque becomes speed, so it winds up rather than
 * snapping to the hand.
 */
const STATIC_BREAKAWAY = 1.3;   // rad/s of demand needed to start it from rest
const KINETIC_BREAKAWAY = 0.5;  // ...and to change it once it is already turning
const MOVING_ABOVE = 0.12;      // above this the wheel counts as in motion
const SPIN_UP = 12.0;           // torque -> speed, i.e. 1 / mass

/*
 * Zoom is a two-handed pull. Sweeping also changes the distance between the
 * hands — the driver moves, the anchor does not — so separation alone cannot
 * tell the two apart. A pull is both hands moving along the axis between them
 * in opposite directions, which a sweep never does.
 */
const MIN_PULL = 0.003;         // per-hand travel along that axis, per detection
const ZOOM_DEADBAND = 0.010;    // relative separation change to ignore outright
// Distance ends up roughly proportional to hand separation: doubling the gap
// between your hands roughly doubles the distance. At 1.6 a single wide pull
// ran the map out 16x, which is not a control anyone can aim.
const ZOOM_GAIN = 1.0;
// One detection should never move the map far, whatever the tracker reports.
const ZOOM_STEP_LIMIT = 0.06;
// Landmark noise alone can satisfy the opposite-directions test on any given
// frame, so the rate is taken from a smoothed separation: jitter averages out
// of it, a sustained pull does not.
const SEPARATION_SMOOTHING = 0.35;

const RELEASE_DECAY = 0.62;
const STOP_BELOW = 0.004;

// Detection is far more expensive than a render frame, so it runs on its own clock.
const DETECT_INTERVAL_MS = 1000 / 30;

// Angular speed, in rad/s, at which the star trails reach full stretch.
const TRAIL_FULL_SPEED = 1.5;

/**
 * MediaPipe rejects with bare strings as often as with Errors, and the model
 * download is the failure people actually hit, so give it a message worth reading.
 */
function asError(err) {
  if (err instanceof Error && err.message) return err;
  const detail = typeof err === 'string' && err ? err : 'the hand model could not be loaded';
  return new Error(`${detail}. Check the connection — the model is fetched on first use.`);
}

/**
 * Two-handed sky control, after the Moon Knight sky-turning shot: the anchor
 * hand held open arms the gesture, the other hand sweeps, and the map keeps
 * turning after the hands drop.
 *
 * It owns no camera maths — it hands deltas to a target that implements
 * `orbitBy(dYaw, dPitch, scaleFactor)`, which GalaxyScene and ARMode both do.
 */
export class SkyGestures {
  constructor(scene) {
    this.scene = scene;
    this.tracker = null;
    this.video = null;
    this.stream = null;
    this.preview = null;
    this.active = false;

    this.engaged = false;
    this.yawVel = 0;
    this.pitchVel = 0;
    this.lastDriver = null;
    this.lastAnchor = null;
    this.smoothSeparation = null;
    this.zooming = false;
    this.pendingScale = 1;
    this.nextDetectAt = 0;

    this.trailDir = new THREE.Vector2(1, 0);
    this.onStateChange = null;
  }

  /** Null when gestures can run here, otherwise why they cannot. */
  static unsupportedReason() {
    if (!window.isSecureContext) {
      return 'Hand tracking needs a secure context. Open the app over HTTPS (localhost also counts).';
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return 'This browser does not expose a camera API.';
    }
    return null;
  }

  /**
   * Gestures only run inside AR, so the camera stream is always borrowed from
   * ARMode rather than opened here.
   *
   * @param target   object exposing orbitBy(dYaw, dPitch, scaleFactor)
   * @param stream   ARMode's live passthrough stream
   * @param mirrored true for a user-facing feed, which is read reversed
   * @param preview  optional HandPreview to draw landmarks into
   */
  async start({ target, stream, mirrored = false, preview = null } = {}) {
    if (this.active) return;

    const reason = SkyGestures.unsupportedReason();
    if (reason) throw new Error(reason);
    if (!stream) throw new Error('Gesture control needs the AR camera. Enter AR first.');

    this.target = target ?? this.scene;
    this.stream = stream;
    this.preview = preview;

    try {
      // A detached element is enough — MediaPipe only needs decoded frames.
      this.video = document.createElement('video');
      this.video.playsInline = true;
      this.video.muted = true;
      this.video.srcObject = this.stream;
      await this.video.play();

      this.tracker = new HandTracker({ anchorHand: 'Right', mirrored });
      await this.tracker.load();
    } catch (err) {
      // Leaving a camera running after a failed start is the worst outcome here.
      this.releaseSources();
      throw asError(err);
    }

    this.active = true;
    this.nextDetectAt = 0;
    this.notify();
  }

  /** Drops the tracker and the video element. ARMode owns the stream itself. */
  releaseSources() {
    this.tracker?.close();
    this.tracker = null;
    this.stream = null;

    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this.preview?.hide();
  }

  /**
   * Rebinds to a different camera without reloading the model — the AR flip
   * button hands over a new stream, and a selfie feed is read mirrored.
   */
  useSource({ stream, mirrored }) {
    if (!this.active || !stream) return;

    this.stream = stream;
    if (this.video) this.video.srcObject = stream;
    if (this.tracker) {
      this.tracker.mirrored = mirrored;
      // The next frame is in a new frame of reference; do not diff against the old one.
      this.tracker.lastVideoTime = -1;
    }
    this.lastDriver = null;
    this.lastAnchor = null;
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.engaged = false;
    this.yawVel = 0;
    this.pitchVel = 0;
    this.lastDriver = null;
    this.lastAnchor = null;

    this.releaseSources();
    this.applyTrail(0);
    this.notify();
  }

  /** Called once per rendered frame, before the scene draws. */
  update(deltaTime) {
    if (!this.active) return;

    const now = performance.now();
    if (now >= this.nextDetectAt) {
      this.nextDetectAt = now + DETECT_INTERVAL_MS;
      this.readHands(now);
    }

    if (!this.engaged) {
      const decay = Math.exp(-RELEASE_DECAY * deltaTime);
      this.yawVel *= decay;
      this.pitchVel *= decay;
      if (Math.abs(this.yawVel) < STOP_BELOW) this.yawVel = 0;
      if (Math.abs(this.pitchVel) < STOP_BELOW) this.pitchVel = 0;
    }

    const scale = this.pendingScale;
    this.pendingScale = 1;

    if (this.yawVel || this.pitchVel || scale !== 1) {
      this.target.orbitBy(this.yawVel * deltaTime, this.pitchVel * deltaTime, scale);
    }

    this.applyTrail(Math.hypot(this.yawVel, this.pitchVel));
  }

  readHands(now) {
    let reading = null;
    try {
      reading = this.tracker.read(this.video, now);
    } catch {
      // A dropped frame is not worth tearing the gesture down for.
      return;
    }
    if (!reading) return;

    // Only the anchor palm has to be deliberately open. The driving hand just
    // has to be present — it is sweeping, not posing, and requiring a second
    // open palm squared the chance of failing to arm.
    const engaged = !reading.partial && reading.anchorOpen;
    this.preview?.draw({
      video: this.video,
      hands: reading.hands,
      engaged,
      openness: reading.openness,
      mirrored: this.tracker.mirrored
    });

    if (reading.partial) {
      this.setEngaged(false);
      this.lastDriver = null;
      this.lastAnchor = null;
      this.smoothSeparation = null;
      return;
    }

    if (!engaged) {
      this.setEngaged(false);
      this.lastDriver = null;
      this.lastAnchor = null;
      this.smoothSeparation = null;
      return;
    }

    if (!this.engaged) {
      // Arm on this frame: seed from it so the first delta is not a jump.
      this.setEngaged(true);
      this.lastDriver = reading.driver;
      this.lastAnchor = reading.anchor;
      return;
    }

    const dt = DETECT_INTERVAL_MS / 1000;
    const zoomed = this.applyZoom(reading);
    // A pull and a sweep are different gestures; letting a pull also spin the
    // sky is what made the distance control unusable in the first place.
    if (!zoomed) this.applySweep(reading, dt);

    this.lastDriver = reading.driver;
    this.lastAnchor = reading.anchor;
    this.zooming = zoomed;
  }

  /**
   * Both hands travelling along the axis between them, in opposite directions:
   * apart pushes the map away, together pulls it in. Returns true when the
   * frame was a pull, so the sweep is skipped.
   */
  applyZoom(reading) {
    if (!this.lastAnchor) return false;

    const ax = reading.driver.x - reading.anchor.x;
    const ay = reading.driver.y - reading.anchor.y;
    const separation = Math.hypot(ax, ay);
    if (separation < 0.05) return false;

    const previous = this.smoothSeparation;
    this.smoothSeparation = previous == null
      ? separation
      : previous + (separation - previous) * SEPARATION_SMOOTHING;
    if (previous == null) return false;

    const ux = ax / separation;
    const uy = ay / separation;
    const driverAlong = (reading.driver.x - this.lastDriver.x) * ux
                      + (reading.driver.y - this.lastDriver.y) * uy;
    const anchorAlong = (reading.anchor.x - this.lastAnchor.x) * ux
                      + (reading.anchor.y - this.lastAnchor.y) * uy;

    // Opposite signs, both past the threshold: the hands are working against
    // each other along their own axis, which a one-handed sweep cannot fake.
    const pulling = driverAlong > MIN_PULL && anchorAlong < -MIN_PULL;
    const pushing = driverAlong < -MIN_PULL && anchorAlong > MIN_PULL;
    if (!pulling && !pushing) return false;

    const rate = (this.smoothSeparation - previous) / previous;
    const over = Math.sign(rate) * Math.max(0, Math.abs(rate) - ZOOM_DEADBAND);
    if (over === 0) return false;

    this.pendingScale = THREE.MathUtils.clamp(
      1 + over * ZOOM_GAIN, 1 - ZOOM_STEP_LIMIT, 1 + ZOOM_STEP_LIMIT);
    return true;
  }

  /** Torque from the driving hand, against a flywheel that resists starting. */
  applySweep(reading, dt) {
    // Image x grows to the right; sweeping right should carry the sky left past you.
    const demandYaw = -((reading.driver.x - this.lastDriver.x) * YAW_GAIN) / dt;
    const demandPitch = ((reading.driver.y - this.lastDriver.y) * PITCH_GAIN) / dt;

    let torqueYaw = demandYaw - this.yawVel;
    let torquePitch = demandPitch - this.pitchVel;
    const torque = Math.hypot(torqueYaw, torquePitch);

    const spinning = Math.hypot(this.yawVel, this.pitchVel) > MOVING_ABOVE;
    const breakaway = spinning ? KINETIC_BREAKAWAY : STATIC_BREAKAWAY;
    if (torque <= breakaway) return;

    // Friction takes a fixed bite out of the torque, whatever its direction.
    const remaining = (torque - breakaway) / torque;
    torqueYaw *= remaining;
    torquePitch *= remaining;

    const gain = Math.min(1, SPIN_UP * dt);
    this.yawVel += torqueYaw * gain;
    this.pitchVel += torquePitch * gain;
  }

  setEngaged(value) {
    if (this.engaged === value) return;
    this.engaged = value;
    this.notify();
  }

  /**
   * Stretches the point sprites along the direction of travel. Stars streaking
   * as the sky picks up speed is the whole look of the shot.
   */
  applyTrail(speed) {
    const uniforms = this.scene.uniforms;
    if (!uniforms?.uTrailAmount) return;

    const amount = THREE.MathUtils.clamp(speed / TRAIL_FULL_SPEED, 0, 1);
    if (amount > 0.001) {
      // Yaw slides stars across the screen, pitch slides them up and down.
      this.trailDir.set(this.yawVel, -this.pitchVel);
      if (this.trailDir.lengthSq() > 1e-8) this.trailDir.normalize();
      uniforms.uTrailDir.value.copy(this.trailDir);
    }
    uniforms.uTrailAmount.value = amount;
  }

  notify() {
    this.onStateChange?.({ active: this.active, engaged: this.engaged });
  }
}
