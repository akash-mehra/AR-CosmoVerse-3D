import * as THREE from 'three';
import { HandTracker } from './HandTracker.js';

// Hand travel across the frame, in radians of sky. A full sweep of the frame
// turns the map roughly a half-turn, which keeps big arcs feeling weighty.
const YAW_GAIN = Math.PI * 1.15;
const PITCH_GAIN = Math.PI * 0.55;
// How much the hands have to part before the map starts pushing away.
const SPREAD_GAIN = 1.4;

// While the hands drive, velocity chases the hand. Once they drop, it coasts:
// the sky keeps turning and winds down instead of stopping dead.
const DRIVE_RESPONSE = 9.0;
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
    this.ownsStream = false;
    this.stream = null;
    this.active = false;

    this.engaged = false;
    this.yawVel = 0;
    this.pitchVel = 0;
    this.lastDriver = null;
    this.engageSpread = null;
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
   * @param target   object exposing orbitBy(dYaw, dPitch, scaleFactor)
   * @param stream   an existing camera stream to share (AR owns one); omit to open one
   * @param mirrored true for a user-facing feed, where handedness labels are flipped
   */
  async start({ target, stream = null, mirrored = true } = {}) {
    if (this.active) return;

    const reason = SkyGestures.unsupportedReason();
    if (reason) throw new Error(reason);

    this.target = target ?? this.scene;
    this.ownsStream = !stream;

    try {
      this.stream = stream ?? await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'user' }, width: { ideal: 640 } },
        audio: false
      });

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

  /** Drops the tracker, the video element and any stream this instance opened. */
  releaseSources() {
    this.tracker?.close();
    this.tracker = null;

    if (this.ownsStream) this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;

    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
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
    this.engageSpread = null;
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.engaged = false;
    this.yawVel = 0;
    this.pitchVel = 0;
    this.lastDriver = null;
    this.engageSpread = null;

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

    const engaged = reading.anchorOpen && reading.driverOpen;

    if (!engaged) {
      this.setEngaged(false);
      this.lastDriver = null;
      this.engageSpread = null;
      return;
    }

    if (!this.engaged) {
      // Arm on this frame: seed from it so the first delta is not a jump.
      this.setEngaged(true);
      this.lastDriver = reading.driver;
      this.engageSpread = reading.spread;
      return;
    }

    const dt = DETECT_INTERVAL_MS / 1000;
    // Image x grows to the right; sweeping right should carry the sky left past you.
    const targetYawVel = -((reading.driver.x - this.lastDriver.x) * YAW_GAIN) / dt;
    const targetPitchVel = ((reading.driver.y - this.lastDriver.y) * PITCH_GAIN) / dt;
    const blend = Math.min(1, DRIVE_RESPONSE * dt);

    this.yawVel += (targetYawVel - this.yawVel) * blend;
    this.pitchVel += (targetPitchVel - this.pitchVel) * blend;
    this.lastDriver = reading.driver;

    if (this.engageSpread > 0.02 && reading.spread > 0.02) {
      const ratio = reading.spread / this.engageSpread;
      // Hands apart push the map away, together pull it in.
      this.pendingScale = 1 + (ratio - 1) * SPREAD_GAIN * dt;
      this.engageSpread = reading.spread;
    }
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
