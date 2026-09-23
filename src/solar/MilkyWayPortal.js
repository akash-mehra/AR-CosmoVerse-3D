import * as THREE from 'three';
import { notify } from '../ui/notify.js';
import { galacticBasis } from '../data/milkyWay.js';
import { LayerBlend } from '../rendering/LayerBlend.js';
import { MPC_PER_UNIT, BAND_INNER, BAND_OUTER, SOLAR_FOV, bandPosition, solarFromMap, mapFromSolar } from './scale.js';

// Camera distance from the galactic centre, in Mpc, inside which the way in
// appears: about four galaxy diameters, where the disc fills a good part of
// the view.
const ENTER_RANGE = 0.12;
const FADE_MS = 450;
// The plunge toward the Sun while the wormhole's mouth opens over the map.
const DIVE_MS = 1500;
const RETURN_MS = 2400;
const LY_PER_MPC = 3.2616e6;
// The map's closest approach to anything but the Sun: the Milky Way filling the view.
const MAP_MIN_MPC = 0.03;
// Aimed at the Sun and closer than this (1 kpc), the Solar System is fetched
// ahead of the zoom reaching it.
const PREFETCH_MPC = 0.001;
// Where "Back to the universe" rises to after zooming in: the Milky Way from 20 kpc.
const RISE_MPC = 0.02;
// Either side of the band's middle, so a zoom held there does not hand the
// view back and forth.
const HAND_TO_MAP = 0.55;
const HAND_TO_SOLAR = 0.45;
// Display units from the Sun, inside the Oort Cloud, where the view starts
// rolling toward the map's up: spread over more zoom than the band alone, a
// turn of up to 180° reads as a slow bank rather than a spin.
const ROLL_FROM = 1000;
const UP = new THREE.Vector3(0, 1, 0);

function setFov(camera, fov) {
  if (Math.abs(camera.fov - fov) < 1e-6) return;
  camera.fov = fov;
  camera.updateProjectionMatrix();
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The way between the galaxy map and the Solar System, two scale layers
 * centred on the Sun. Aimed at the Sun, a zoom runs straight from one into the
 * other: across a band 0.9–3.2 pc out both are drawn from one camera, the
 * Solar System fading over the map, and the controls change hands mid-band.
 * The easter-egg button is the fast way in, through a wormhole. The Solar
 * System module and its textures are fetched on first need.
 */
export class MilkyWayPortal {
  constructor(container, scene, namedLayer) {
    this.container = container;
    this.scene = scene;
    this.namedLayer = namedLayer;
    this.active = false;
    this.busy = false;
    this.solar = null;
    this.solarReady = false;
    // 0 deep in the Solar System, 1 out in the map, between across the band.
    this.band = 1;
    this._ndc = new THREE.Vector3();
    // The map's up, in Solar System axes; the Solar System's own is ecliptic north.
    this._mapUp = solarFromMap(UP, new THREE.Vector3());
    this._look = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._cross = new THREE.Vector3();

    scene.afterControls = () => this.levelMap();
    // While the Solar System has the controls, the map is placed from its camera.
    this.driveMap = (dt) => {
      this.solar.step(dt);
      this.measureSolar();
      this.solar.camera.lookAt(this.solar.controls.target);
      const { camera, controls } = this.scene;
      mapFromSolar(this.solar.camera.position, camera.position, MPC_PER_UNIT);
      mapFromSolar(this.solar.controls.target, controls.target, MPC_PER_UNIT);
      camera.lookAt(controls.target);
    };

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

  /** True while the Solar System alone or the wormhole fills the screen, so the map need not be drawn. */
  get ownsFrame() {
    return (this.active && this.band <= 0) || !!this.wormhole?.covers;
  }

  /** Called every frame, after the map when it was drawn. */
  update(dt) {
    if (this.active) {
      if (this.ownsFrame) {
        this.solar.step(dt);
        this.measureSolar();
        this.solar.camera.lookAt(this.solar.controls.target);
        this.solar.draw();
      } else {
        // The map was drawn this frame, placed by driveMap; the Solar System goes over it.
        this.blend.over(() => this.solar.draw(), 1 - this.band);
      }
      if (this.band > HAND_TO_MAP) this.handToMap();
      return;
    }
    this.wormhole?.update(dt);
    const near = this.bridgeFromMap(dt);
    const hidden = this.busy || near || !this.inRange();
    if (this.button.hidden !== hidden) this.button.hidden = hidden;
  }

  measureSolar() {
    const { camera, controls } = this.solar;
    this.measure(camera.position.length(), this._look.copy(controls.target).sub(camera.position).normalize());
  }

  /**
   * Where the camera is in the band, from its distance to the Sun in display
   * units and its line of sight in Solar System axes; and the lens and roll
   * both layers share there.
   */
  measure(units, look) {
    this.band = bandPosition(units);
    // One lens for both layers, or the skies drawn across the band disagree:
    // the Solar System's own at its inner edge, the map's at the outer.
    const fov = THREE.MathUtils.lerp(SOLAR_FOV, this.scene.fov, this.band);
    setFov(this.solar.camera, fov);
    setFov(this.scene.camera, fov);
    // The view rolls steadily about the line of sight, from ecliptic north up
    // to the map's up by the band's outer edge, so neither hand-over snaps it round.
    // (Turning the up vector itself swung the view fast wherever its path
    // passed near the line of sight.)
    const a = this._a.copy(UP).addScaledVector(look, -UP.dot(look));
    const b = this._b.copy(this._mapUp).addScaledVector(look, -this._mapUp.dot(look));
    if (a.lengthSq() < 1e-8 || b.lengthSq() < 1e-8) return; // looking straight down one of them: keep the last roll
    a.normalize();
    b.normalize();
    const roll = Math.atan2(this._cross.crossVectors(a, b).dot(look), a.dot(b));
    // The wormhole's arrival flies in level; it has no map to match.
    const share = this.solar.approach ? 0 : THREE.MathUtils.clamp(Math.log(units / ROLL_FROM) / Math.log(BAND_OUTER / ROLL_FROM), 0, 1);
    const solarUp = this.solar.camera.up.copy(a).applyAxisAngle(look, roll * share);
    mapFromSolar(solarUp, this.scene.camera.up);
  }

  aimedAtSun() {
    return this.scene.controls.target.lengthSq() < (BAND_INNER * MPC_PER_UNIT) ** 2
      && !this.container.classList.contains('ar-active');
  }

  /** The map has the controls: before it is drawn, where it is in the band and the roll to match. */
  levelMap() {
    this.band = 1;
    const { camera, controls } = this.scene;
    camera.up.copy(UP);
    setFov(camera, this.scene.fov);
    const units = camera.position.length() / MPC_PER_UNIT;
    // Outside the band the map keeps its own up untouched.
    if (this.active || !this.solarReady || !this.aimedAtSun() || units >= BAND_OUTER) return;
    const look = solarFromMap(this._look.copy(controls.target).sub(camera.position).normalize(), this._look);
    this.measure(units, look);
    camera.lookAt(controls.target);
  }

  /**
   * The map has the controls, and has been drawn. Aimed at the Sun, a zoom
   * heads for it whatever the pointer is over and may go all the way in;
   * across the band the Solar System is drawn over the map from the same
   * viewpoint, and takes over past its middle. Returns whether the camera is
   * close in on the Sun.
   */
  bridgeFromMap(dt) {
    const { camera, controls } = this.scene;
    if (this.container.classList.contains('ar-active')) return false;
    const aimed = this.aimedAtSun();
    const toSun = camera.position.length();
    controls.zoomToCursor = !aimed;
    // Panning off the Sun up close keeps the distance rather than throwing the
    // camera back out to the map's usual limit.
    controls.minDistance = !aimed ? Math.min(MAP_MIN_MPC, camera.position.distanceTo(controls.target))
      : (this.solarReady ? BAND_INNER : BAND_OUTER) * MPC_PER_UNIT;
    if (!aimed || this.busy) return false;

    if (toSun < PREFETCH_MPC && !this.loading) {
      this.ensureSolar().catch((err) => notify(`Could not load the Solar System: ${err.message}`, { error: true }));
    }
    if (!this.solarReady || this.band >= 1) return toSun < PREFETCH_MPC;
    const { solar } = this;
    solarFromMap(camera.position, solar.camera.position, 1 / MPC_PER_UNIT);
    solarFromMap(controls.target, solar.controls.target, 1 / MPC_PER_UNIT);
    solar.camera.lookAt(solar.controls.target);
    solar.step(dt, true);
    this.blend.over(() => solar.draw(), 1 - this.band);
    // A flight passing through (rising out after Back) is not a zoom in.
    if (this.band < HAND_TO_SOLAR && !this.scene.cameraFlight) this.handToSolar();
    return true;
  }

  handToSolar() {
    const { camera, controls } = this.scene;
    this.returnView = { position: camera.position.clone().setLength(RISE_MPC), target: new THREE.Vector3() };
    controls.enabled = false;
    this.scene.cameraDriver = this.driveMap;
    this.namedLayer.clearSelection();
    this.namedLayer.suspended = true;
    this.container.classList.add('solar-active');
    this.solar.takeOver(this.solar.camera.position, this.solar.controls.target);
    this.active = true;
  }

  handToMap() {
    this.active = false;
    this.solar.exit();
    this.scene.cameraDriver = null;
    this.container.classList.remove('solar-active');
    this.namedLayer.suspended = false;
    this.scene.controls.enabled = true;
  }

  get blend() {
    this._blend ??= new LayerBlend(this.scene.renderer);
    return this._blend;
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
    const loading = this.ensureSolar(true);
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
    this.scene.cameraDriver = this.driveMap;
    this.namedLayer.suspended = true;
    this.container.classList.replace('warp-active', 'solar-active');
    this.solar.camera.up.copy(UP);
    this.solar.enter();
    this.active = true;
    this.band = 0;
    this.wormhole.reveal();
    this.busy = false;
  }

  /** Builds the Solar System once. A failed prefetch is not retried by itself; `retry` asks again. */
  ensureSolar(retry = false) {
    if (retry && this.loadFailed) this.loading = null;
    this.loading ??= this.loadSolar().then(
      () => { this.solarReady = true; this.loadFailed = false; },
      (err) => { this.loadFailed = true; throw err; }
    );
    return this.loading;
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

    this.handToMap();
    this.veil.classList.remove('visible');
    // Rise back out of the disc to where the journey started.
    if (this.returnView) this.scene.smoothFlyTo(this.returnView.position, this.returnView.target, RETURN_MS);
    this.busy = false;
  }
}
