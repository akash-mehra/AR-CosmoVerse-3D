import * as THREE from 'three';
import { notify } from '../ui/notify.js';
import { galacticBasis } from '../data/milkyWay.js';

// Camera distance from the galactic centre, in Mpc, inside which the way in
// appears: about four galaxy diameters, where the disc fills a good part of
// the view.
const ENTER_RANGE = 0.12;
const FADE_MS = 450;
// The plunge toward the Sun while the wormhole's mouth opens over the map.
const DIVE_MS = 1500;
const RETURN_MS = 2400;
const LY_PER_MPC = 3.2616e6;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The easter egg. Zoom far enough into the Milky Way and a button offers the
 * way in; taking it swaps the galaxy map for the Solar System. The Solar
 * System module and its textures are only fetched on that first entry.
 */
export class MilkyWayPortal {
  constructor(container, scene, namedLayer) {
    this.container = container;
    this.scene = scene;
    this.namedLayer = namedLayer;
    this.active = false;
    this.busy = false;
    this.solar = null;
    this._ndc = new THREE.Vector3();

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'portal-btn';
    this.button.hidden = true;
    this.button.innerHTML = '✨ Enter the Milky Way <span>visit the Sun and its planets</span>';
    this.button.addEventListener('click', () => this.enter());

    this.veil = document.createElement('div');
    this.veil.className = 'warp-veil';
    this.veil.setAttribute('role', 'status');

    container.append(this.button, this.veil);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.active && !e.target.closest?.('input, textarea, dialog')) this.exit();
    });
  }

  /** True while the Solar System or the wormhole fills the screen, so the map need not be drawn. */
  get ownsFrame() {
    return this.active || !!this.wormhole?.covers;
  }

  /** Called every frame: draws the Solar System or the trip, otherwise watches for the way in. */
  update(dt) {
    if (this.active) {
      this.solar.update(dt);
      return;
    }
    this.wormhole?.update(dt);
    const hidden = this.busy || !this.inRange();
    if (this.button.hidden !== hidden) this.button.hidden = hidden;
  }

  inRange() {
    if (this.container.classList.contains('ar-active')) return false;
    const { camera, milkyWay } = this.scene;
    if (camera.position.distanceTo(milkyWay.centre) > ENTER_RANGE) return false;
    const ndc = this._ndc.copy(milkyWay.centre).project(camera);
    return ndc.z < 1 && Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1;
  }

  async fade(text) {
    this.veil.textContent = text;
    this.veil.classList.add('visible');
    await wait(FADE_MS);
  }

  /**
   * Just above the galactic disc beside the Sun, looking down on it: where the
   * dive into the galaxy ends and the Solar System takes over.
   */
  sunView() {
    const { x, z } = galacticBasis();
    const position = new THREE.Vector3(z.x, z.y, z.z).multiplyScalar(0.0035)
      .addScaledVector(new THREE.Vector3(x.x, x.y, x.z), -0.0025);
    return { position, target: new THREE.Vector3(0, 0, 0) };
  }

  /** iOS only lets audio start inside a user gesture, so the click makes (or wakes) the context. */
  unlockAudio() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      this.audio ??= new AudioCtx();
      this.audio.resume().catch(() => {});
      return this.audio;
    } catch {
      return null;
    }
  }

  async enter() {
    if (this.active || this.busy) return;
    this.busy = true;
    this.button.hidden = true;
    this.namedLayer.clearSelection();
    const audio = this.unlockAudio();

    // Plunge toward the Sun while the wormhole opens over the map; the Solar
    // System loads during the trip, so the wait is the journey.
    const { camera, controls } = this.scene;
    this.returnView = { position: camera.position.clone(), target: controls.target.clone() };
    const lightYears = camera.position.length() * LY_PER_MPC; // the Sun is the map's origin
    const { position, target } = this.sunView();
    this.scene.smoothFlyTo(position, target, DIVE_MS);
    this.container.classList.add('warp-active');
    const loading = this.loadSolar();
    loading.catch(() => {}); // awaited through the trip; this only stops an early failure reading as unhandled

    try {
      const { Wormhole } = await import('./Wormhole.js');
      this.wormhole ??= new Wormhole(this.container, this.scene.renderer);
      await this.wormhole.travel({ lightYears, audio, ready: loading });
    } catch (err) {
      console.error(err);
      this.wormhole?.abort();
      this.container.classList.remove('warp-active');
      notify(`Could not open the Solar System: ${err.message}`, { error: true });
      this.scene.smoothFlyTo(this.returnView.position, this.returnView.target, RETURN_MS);
      this.busy = false;
      return;
    }

    // The galaxy map's own input and labels stand down while we are inside.
    this.scene.controls.enabled = false;
    this.namedLayer.suspended = true;
    this.container.classList.replace('warp-active', 'solar-active');
    this.solar.enter();
    this.active = true;
    this.wormhole.reveal();
    this.busy = false;
  }

  async loadSolar() {
    const { SolarSystem } = await import('./SolarSystem.js');
    if (!this.solar) {
      this.solar = new SolarSystem(this.scene.renderer, this.container);
      this.solar.onExit = () => this.exit();
    }
    await this.solar.load();
    // Compile its shaders during the trip rather than in its first frame, in
    // the background where the browser can (asking three to try where it
    // cannot only logs a warning).
    const { renderer } = this.scene;
    if (renderer.extensions.has('KHR_parallel_shader_compile')) await renderer.compileAsync(this.solar.scene, this.solar.camera);
    else renderer.compile(this.solar.scene, this.solar.camera);
  }

  async exit() {
    if (!this.active || this.busy) return;
    this.busy = true;
    await this.fade('Back to the universe…');

    this.active = false;
    this.solar.exit();
    this.container.classList.remove('solar-active');
    this.namedLayer.suspended = false;
    this.scene.controls.enabled = true;
    this.veil.classList.remove('visible');
    // Rise back out of the disc to where the journey started.
    if (this.returnView) this.scene.smoothFlyTo(this.returnView.position, this.returnView.target, RETURN_MS);
    this.busy = false;
  }
}
