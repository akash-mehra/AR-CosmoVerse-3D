import * as THREE from 'three';
import { HandPreview } from './HandPreview.js';

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, -1);
const SCREEN_AXIS = new THREE.Vector3(0, 0, 1);

// Turns the device frame into a camera frame looking out of the back of the phone.
const DEVICE_TO_CAMERA = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);

// Matches GalaxyScene's controls.minDistance so the Local Group (under 1 Mpc)
// stays reachable in AR instead of being clamped back out to 5 Mpc.
const MIN_DISTANCE = 0.2;
const MAX_DISTANCE = 18000;
const ORIENTATION_PROBE_MS = 1200;

const touchSpread = (touches) =>
  Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

/**
 * Model-locked AR: the live camera feed sits behind a transparent canvas and the
 * device's orientation aims the camera, so the map holds still in the room while
 * you look around it. Position is not tracked — gyroscopes give orientation only —
 * so the map is anchored at a fixed distance and pinch changes its apparent size.
 */
export class ARMode {
  constructor(container, scene) {
    this.container = container;
    this.scene = scene;

    this.active = false;
    this.stream = null;
    // Rear camera looks at the sky; front camera is the one you can hold your
    // hands in front of while still watching the screen.
    this.facingMode = 'environment';
    this.hasOrientation = false;
    this.pinch = null;
    this.saved = null;

    this.rawQuaternion = new THREE.Quaternion();
    this.yawOffset = new THREE.Quaternion();
    this.anchor = new THREE.Vector3();
    this.anchorDirection = new THREE.Vector3(0, 0, 1);
    this.distance = 1000;

    this.euler = new THREE.Euler();
    this.scratch = new THREE.Quaternion();
    this.deviceForward = new THREE.Vector3();
    this.mapForward = new THREE.Vector3();

    this.handleOrientation = this.handleOrientation.bind(this);
    this.handleTouchStart = this.handleTouchStart.bind(this);
    this.handleTouchMove = this.handleTouchMove.bind(this);
    this.handleTouchEnd = this.handleTouchEnd.bind(this);
    this.drive = this.drive.bind(this);

    this.renderDOM();
  }

  /** Null when AR can run here, otherwise why it cannot. */
  static unsupportedReason() {
    if (!window.isSecureContext) {
      return 'AR needs a secure context. Open the app over HTTPS (localhost also counts).';
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return 'This browser does not expose a camera API.';
    }
    return null;
  }

  renderDOM() {
    this.root = document.createElement('div');
    this.root.className = 'ar-layer hidden';
    this.root.id = 'ar-layer';
    this.root.innerHTML = `
      <video class="ar-video" playsinline muted autoplay></video>
      <div class="ar-dock glass-card">
        <span class="ar-status"></span>
        <button class="dock-btn" type="button" data-ar="gestures" aria-pressed="false" title="Turn the sky with your hands: hold your right palm open to anchor, sweep with the other">🖐️ Gestures</button>
        <button class="dock-btn" type="button" data-ar="recentre" title="Put the map back in front of you">Recentre</button>
        <button class="dock-btn" type="button" data-ar="flip" title="Switch between the rear and front camera">🔄 Flip</button>
        <button class="dock-btn exit-btn" type="button" data-ar="exit">Exit AR</button>
      </div>
    `;
    this.container.appendChild(this.root);

    // What the hand tracker sees, so a gesture that will not arm is diagnosable.
    this.handPreview = new HandPreview();
    this.root.appendChild(this.handPreview.el);

    this.video = this.root.querySelector('.ar-video');
    this.status = this.root.querySelector('.ar-status');
    this.root.querySelector('[data-ar="exit"]').addEventListener('click', () => this.exit());
    this.root.querySelector('[data-ar="recentre"]').addEventListener('click', () => this.recentre());
    this.root.querySelector('[data-ar="flip"]').addEventListener('click', () => this.flipCamera());

    this.gestureBtn = this.root.querySelector('[data-ar="gestures"]');
    this.gestureBtn.addEventListener('click', () => {
      if (!this.gestureBtn.disabled) this.onToggleGestures?.();
    });
  }

  async enter() {
    if (this.active) return;

    const reason = ARMode.unsupportedReason();
    if (reason) {
      alert(reason);
      return;
    }

    // Safari only grants this from a user gesture, so it has to come before any
    // other await in the click handler.
    const orientationAllowed = await this.requestOrientationPermission();

    try {
      await this.openCamera(this.facingMode);
    } catch (err) {
      alert(`Camera unavailable: ${err.message}`);
      return;
    }

    this.active = true;
    this.saved = {
      transparent: Boolean(this.scene.isTransparentBg),
      position: this.scene.camera.position.clone(),
      quaternion: this.scene.camera.quaternion.clone(),
      target: this.scene.controls.target.clone(),
      autoOrbit: this.scene.autoOrbit
    };

    this.scene.setTransparentBackground(true);
    this.scene.cameraFlight = null;
    this.scene.autoOrbit = false;

    this.anchorMap();
    this.container.classList.add('ar-active');
    this.root.classList.remove('hidden');

    if (orientationAllowed) await this.startOrientation();
    this.applyInputMode();
  }

  /**
   * Paints the dock's gesture control. 'loading' covers the one-off model
   * download; 'engaged' means both palms are up and driving the sky.
   */
  setGestureState({ active = false, engaged = false, loading = false } = {}) {
    const button = this.gestureBtn;
    if (!button) return;

    button.disabled = loading;
    button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('engaged', engaged);
    button.textContent = loading
      ? '🖐️ Loading…'
      : engaged ? '✋ Turning' : active ? '🟢 Gestures' : '🖐️ Gestures';

    if (active) this.handPreview.show();
    else this.handPreview.hide();

    if (this.status && this.hasOrientation) {
      this.status.textContent = active
        ? (engaged ? 'Sweeping the sky' : 'Open both palms')
        : 'Move to look around';
    }
  }

  /** True when the feed is a selfie view, which is displayed and read mirrored. */
  get isMirrored() {
    return this.facingMode === 'user';
  }

  /** Opens the requested camera and shows it, replacing any stream already up. */
  async openCamera(facingMode) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode } },
      audio: false
    });

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = stream;
    this.facingMode = facingMode;

    this.video.srcObject = stream;
    // A selfie view that is not mirrored reads as broken to everyone.
    this.video.classList.toggle('mirrored', this.isMirrored);
    // Autoplay can still be refused; the element plays once it is on screen.
    this.video.play().catch(() => {});
  }

  /**
   * Swaps rear for front and back. Hand tracking borrows this stream, so
   * whoever is listening has to rebind to the new one — and to the fact that a
   * selfie feed reports handedness and hand motion mirrored.
   */
  async flipCamera() {
    if (!this.active) return;
    const next = this.isMirrored ? 'environment' : 'user';

    try {
      await this.openCamera(next);
    } catch (err) {
      alert(`Could not switch camera: ${err.message}`);
      return;
    }

    this.onCameraChange?.({ stream: this.stream, mirrored: this.isMirrored });
  }

  async requestOrientationPermission() {
    if (typeof DeviceOrientationEvent === 'undefined') return false;
    if (typeof DeviceOrientationEvent.requestPermission !== 'function') return true;

    try {
      return (await DeviceOrientationEvent.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }

  /** Listens for a usable reading; resolves false if the device never sends one. */
  async startOrientation() {
    window.addEventListener('deviceorientation', this.handleOrientation);
    await new Promise((resolve) => setTimeout(resolve, ORIENTATION_PROBE_MS));

    if (!this.hasOrientation) {
      window.removeEventListener('deviceorientation', this.handleOrientation);
      return false;
    }
    return true;
  }

  /**
   * With a gyro the device aims the camera and pinch resizes the map; without one
   * we leave OrbitControls in charge so the map is still explorable over the feed.
   */
  applyInputMode() {
    if (!this.active) return;

    if (this.hasOrientation) {
      this.scene.controls.enabled = false;
      this.scene.cameraDriver = this.drive;
      this.container.addEventListener('touchstart', this.handleTouchStart, { passive: true });
      this.container.addEventListener('touchmove', this.handleTouchMove, { passive: false });
      this.container.addEventListener('touchend', this.handleTouchEnd, { passive: true });
      this.status.textContent = 'Move to look around';
    } else {
      this.scene.controls.enabled = true;
      this.scene.cameraDriver = null;
      this.status.textContent = 'No sensor — drag to look';
    }
  }

  handleOrientation(event) {
    if (event.alpha === null || event.beta === null || event.gamma === null) return;

    const screenAngle = screen.orientation?.angle ?? window.orientation ?? 0;
    this.euler.set(event.beta * DEG, event.alpha * DEG, -event.gamma * DEG, 'YXZ');
    this.rawQuaternion.setFromEuler(this.euler);
    this.rawQuaternion.multiply(DEVICE_TO_CAMERA);
    this.rawQuaternion.multiply(this.scratch.setFromAxisAngle(SCREEN_AXIS, -screenAngle * DEG));

    if (!this.hasOrientation) {
      this.hasOrientation = true;
      this.recentre();
    }
  }

  /**
   * Pins the map at the current orbit target, level with the camera so it sits
   * straight ahead rather than below the horizon once orientation takes over.
   */
  anchorMap() {
    const camera = this.scene.camera;
    this.anchor.copy(this.scene.controls.target);

    const offset = camera.position.clone().sub(this.anchor);
    this.distance = THREE.MathUtils.clamp(offset.length(), MIN_DISTANCE, MAX_DISTANCE);

    this.anchorDirection.set(offset.x, 0, offset.z);
    if (this.anchorDirection.lengthSq() < 1e-6) this.anchorDirection.set(0, 0, 1);
    this.anchorDirection.normalize();

    this.applyDistance();
  }

  applyDistance() {
    this.scene.camera.position.copy(this.anchor).addScaledVector(this.anchorDirection, this.distance);
  }

  /**
   * Gesture control's hook. Device orientation still aims the view, so swinging
   * the anchor direction moves the map around you rather than sliding the view
   * off it — the map turns, your head does not.
   */
  orbitBy(dYaw, dPitch, scaleFactor = 1.0) {
    this._gestureSpherical ??= new THREE.Spherical();

    this._gestureSpherical.setFromVector3(this.anchorDirection);
    this._gestureSpherical.theta += dYaw;
    this._gestureSpherical.phi = THREE.MathUtils.clamp(this._gestureSpherical.phi + dPitch, 0.12, Math.PI - 0.12);
    this._gestureSpherical.radius = 1;
    this.anchorDirection.setFromSpherical(this._gestureSpherical).normalize();

    this.distance = THREE.MathUtils.clamp(this.distance * scaleFactor, MIN_DISTANCE, MAX_DISTANCE);
    this.applyDistance();
  }

  /** Rotates the map's heading onto wherever the device is pointing right now. */
  recentre() {
    if (!this.hasOrientation) return;

    this.deviceForward.copy(FORWARD).applyQuaternion(this.rawQuaternion);
    this.mapForward.copy(this.anchor).sub(this.scene.camera.position).normalize();

    const yaw =
      Math.atan2(this.mapForward.x, this.mapForward.z) -
      Math.atan2(this.deviceForward.x, this.deviceForward.z);
    this.yawOffset.setFromAxisAngle(UP, yaw);
  }

  drive() {
    this.scene.camera.quaternion.multiplyQuaternions(this.yawOffset, this.rawQuaternion);
  }

  handleTouchStart(event) {
    if (event.touches.length !== 2) return;
    this.pinch = { spread: touchSpread(event.touches), distance: this.distance };
  }

  handleTouchMove(event) {
    if (!this.pinch || event.touches.length !== 2) return;
    event.preventDefault();

    const ratio = touchSpread(event.touches) / this.pinch.spread;
    if (!Number.isFinite(ratio) || ratio <= 0) return;

    this.distance = THREE.MathUtils.clamp(this.pinch.distance / ratio, MIN_DISTANCE, MAX_DISTANCE);
    this.applyDistance();
  }

  handleTouchEnd(event) {
    if (event.touches.length < 2) this.pinch = null;
  }

  exit() {
    if (!this.active) return;
    this.active = false;

    this.scene.cameraDriver = null;
    window.removeEventListener('deviceorientation', this.handleOrientation);
    this.container.removeEventListener('touchstart', this.handleTouchStart);
    this.container.removeEventListener('touchmove', this.handleTouchMove);
    this.container.removeEventListener('touchend', this.handleTouchEnd);

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;

    this.scene.setTransparentBackground(this.saved.transparent);
    this.scene.camera.position.copy(this.saved.position);
    this.scene.camera.quaternion.copy(this.saved.quaternion);
    this.scene.controls.target.copy(this.saved.target);
    this.scene.autoOrbit = this.saved.autoOrbit;
    this.scene.controls.enabled = true;
    this.scene.controls.update();

    this.hasOrientation = false;
    this.pinch = null;
    this.setGestureState({ active: false });
    this.container.classList.remove('ar-active');
    this.root.classList.add('hidden');

    // Anything sharing this stream (hand tracking) has just lost it.
    this.onExit?.();
  }
}
