import * as THREE from 'three';
import { notify } from '../ui/notify.js';
import { DEG, EARTH_YEAR_SECONDS } from '../solar/data.js';
import { SOLAR_FOV } from '../solar/scale.js';
import { isSaving, isMetered, hdDeclined, saveMaps } from '../solar/hdMaps.js';
import { GameHUD } from './GameHUD.js';
import { Ship, createPad, TAIL_DEPTH } from './Ship.js';
import { AsteroidField } from './AsteroidField.js';
import { GravityField } from './gravity.js';
import { Particles } from './Particles.js';
import { KeyboardControls, TouchControls, KEYBOARD_LEGEND, emptyInput } from './controls.js';
import {
  SHIP_LENGTH, SHIP_RADIUS, GAME_TIME_SCALE, BRAKE, HARD_CAP, EARTH_G, LAND_SPEED, RESTITUTION, HULL,
  ROCK_BASE_DAMAGE, ROCK_SPEED_DAMAGE, CRASH_BASE_DAMAGE, CRASH_SPEED_DAMAGE, SHATTER_BELOW, HIT_GRACE,
  HEAT_RANGE, HEAT_DAMAGE, POINTS_PER_SECOND, BELT_MULTIPLIER, NEAR_MISS_POINTS, LANDING_POINTS,
  NEAR_MISS_SPEED, STEP, MAX_STEPS
} from './tuning.js';

const CONTROLS_KEY = 'cosmoverse.gameControls';
const BEST_KEY = 'cosmoverse.gameBest';

// The countdown, in seconds to liftoff. At ENTER_AT the view cuts to high
// over Earth, holding at NEED_SOLAR_AT until the Solar System has loaded; the
// zoom from there down to the ship on its pad is over by APPROACH_END, when
// the engines light; the rest of the resource pack must be in by NEED_PACK_AT.
const COUNT_FROM = 10;
const RETRY_FROM = 3;
const ENTER_AT = 7.5;
const NEED_SOLAR_AT = 7;
const APPROACH_END = 3;
const MIN_APPROACH_S = 2.5;
const MAX_APPROACH_S = 5;
const IGNITION_AT = 3;
const NEED_PACK_AT = 1;

const LIFTOFF_S = 3;
const LIFTOFF_LABEL_S = 1.2;
const TOWER_CAM_S = 1.1;
const CHASE_BLEND_S = 1.4;
const DESTROYED_S = 1.8;
const FADE_S = 0.35;
// How long a landed ship takes to settle onto its tail.
const SETTLE_S = 0.35;
// From the galaxy map the view first flies home: the Sun, from 20 kpc.
const HOME_MPC = 0.02;
const HOME_MS = 2600;

// The pad's latitude, Cape Canaveral's: its up is tilted this far from
// Earth's direction of travel toward ecliptic north, on the dawn side.
const PAD_TILT = 28.5 * DEG;
// Where the zoom down to the pad starts, in display units from Earth: ahead
// along its orbit, sunward (so the day side shows) and above the ecliptic.
const START_AHEAD = 20;
const START_SUNWARD = 10;
const START_NORTH = 12;
const CAMERA_NEAR = 0.004;
// Boost widens the lens by this much.
const BOOST_WIDEN = 11;
// The chase camera, in ship lengths behind, above and ahead of the ship.
const CHASE_BACK = 5.2;
const CHASE_UP = 1.5;
const CHASE_AHEAD = 12;
// The coasting path drawn ahead of the ship.
const PREDICT_STEPS = 160;
const PREDICT_DT = 0.06;
const HUD_EVERY = 0.1;
// Rocks passing this close to the hull count as near misses, once per rock in a while.
const NEAR_GAP = 3 * SHIP_LENGTH;
const NEAR_COOLDOWN_S = 4;
// Earth only counts as a landing once the ship has been this far from it.
const LEFT_EARTH = 5;
const CRASH_GRACE = 0.5;
// Scraping along the ground keeps this much of the speed along it.
const SCRAPE = 0.7;
const DESKTOP_ROCKS = 8200;
const PHONE_ROCKS = 5000;

const TOUCH_LEGEND = 'Stick: steer · hold Thrust to fly · Boost, Brake, Rev and roll beside it · ⏸ pause';

const Y = new THREE.Vector3(0, 1, 0);

const smooth = (t) => t * t * (3 - 2 * t);
const ramp = (x, a, b) => smooth(THREE.MathUtils.clamp((x - a) / (b - a), 0, 1));
const coarsePointer = () => matchMedia('(pointer: coarse)').matches;
const format = (n) => Math.round(n).toLocaleString('en-US');

function randomDirection(out) {
  const z = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(a), r * Math.sin(a), z);
}

function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: forgotten next visit.
  }
}

function readBest() {
  const best = Number.parseInt(readStored(BEST_KEY) ?? '', 10);
  return Number.isFinite(best) && best > 0 ? best : 0;
}

/** The path gravity will take the ship along if it lets go: a line fading ahead of it. */
function createPredictor() {
  const count = PREDICT_STEPS + 1;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  // Four components, so the line can fade out along its length.
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage));
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
  line.frustumCulled = false;
  line.renderOrder = 2;
  line.visible = false;
  return line;
}

/**
 * The space game. "Launch spaceship" asks how you will fly, then counts down
 * from ten while the view closes in from wherever it was to a ship standing
 * on a pad on Earth's dawn side, loading what the game needs on the way (the
 * resource pack: the Solar System, the asteroid belt at the ship's scale,
 * gravity, compiled shaders; optionally the HD planet maps). After liftoff
 * you fly the Solar System as it stands today, in real gravity wells, through
 * a belt of rocks that cost hull, and can land on any world with a surface.
 *
 * It borrows the Solar System (scene, camera, bodies and clock) and, once it
 * has cut to Earth, draws every frame itself: `update` returns true then.
 */
export class GameMode {
  constructor({ container, scene, portal, namedLayer }) {
    this.container = container;
    this.scene = scene;
    this.portal = portal;
    this.namedLayer = namedLayer;
    this.hud = new GameHUD(container);
    this.calm = matchMedia('(prefers-reduced-motion: reduce)');

    this.state = 'idle';
    this.phase = null;
    this.inSolar = false;
    this.controls = null;
    this.input = emptyInput();
    this.autopilot = { ...emptyInput(), thrust: 1 };

    this.ship = new Ship();
    this.pad = createPad();
    this.fire = new Particles(1400);
    this.debris = new Particles(600, { additive: false });
    // Launch smoke lives in Earth's frame, so it stays by the pad as Earth moves on.
    this.smoke = new Particles(700, { additive: false });
    this.predictor = createPredictor();

    this.pack = null;
    this.packState = { progress: null, stage: '', ready: false, error: null };
    this.field = null;
    this.gravity = null;
    this.hd = null;
    this.wantHd = false;
    this.best = readBest();

    this.count = 0;
    this.cutting = 0;
    this.cutAction = null;
    this.approach = null;
    this.ignited = false;
    this.landed = null;
    this.frame = null;
    this.shot = null;
    this.saved = null;
    this.clock = 0;
    this.stateTime = 0;
    this.hudClock = 0;
    this.boostLens = 0;
    this.exhaustDebt = 0;
    this.smokeDebt = 0;
    this.pausedFrom = 'playing';
    this.nearMisses = new Map();
    this.resetRun();

    this.camOffset = new THREE.Vector3();
    this.camQuat = new THREE.Quaternion();
    this.chasePos = new THREE.Vector3();
    this.chaseReady = false;
    this.towerQuat = new THREE.Quaternion();
    this.wreck = { position: new THREE.Vector3(), velocity: new THREE.Vector3(), camera: new THREE.Vector3() };
    this.shotWorld = { pos: new THREE.Vector3(), anchor: new THREE.Vector3(), up: new THREE.Vector3() };

    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._c = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._e = new THREE.Vector3();
    this._f = new THREE.Vector3();
    this._g = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._u = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._x = new THREE.Vector3();
    this._y = new THREE.Vector3();
    this._acc = new THREE.Vector3();
    this._rel = new THREE.Vector3();
    this._rock = new THREE.Vector3();
    this._hit = new THREE.Vector3();
    this._seg = new THREE.Vector3();
    this._mid = new THREE.Vector3();
    this._pp = new THREE.Vector3();
    this._pv = new THREE.Vector3();
    this._pa = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._nozzles = [new THREE.Vector3(), new THREE.Vector3()];

    const { hud } = this;
    hud.onAbort = () => this.exit();
    hud.onPause = () => (this.state === 'paused' ? this.resume() : this.pause());
    hud.onResume = () => this.resume();
    hud.onRestart = () => this.retry();
    hud.onRetry = () => this.retry();
    hud.onExit = () => this.exit();
    hud.onRetryPack = () => this.startPack();

    // Esc and P pause whichever way you fly; during the countdown Esc aborts.
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' && e.code !== 'KeyP') return;
      if (this.state === 'idle' || this.state === 'picking') return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select')) return;
      e.preventDefault();
      this.onPauseKey();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });
  }

  // ---------------------------------------------------------------- starting

  /** "Launch spaceship": ask how to fly, then count down. */
  async open() {
    if (this.state !== 'idle' || this.portal.busy) return;
    this.state = 'picking';
    this.checkHd();
    const remembered = readStored(CONTROLS_KEY);
    const choice = await this.hud.openPicker({
      recommend: coarsePointer() ? 'touch' : 'keyboard',
      remembered: remembered === 'touch' || remembered === 'keyboard' ? remembered : null
    });
    if (!choice) {
      this.state = 'idle';
      this.hud.hideAll();
      return;
    }
    store(CONTROLS_KEY, choice.controls);
    // Still within the click's activation, where a browser that asks the user can ask.
    if (choice.hd) navigator.storage?.persist?.().catch(() => {});
    this.begin(choice);
  }

  /**
   * What the picker can offer for the HD planet maps. Knowing their size
   * needs the Solar System's map manifest, so this starts it loading, which
   * the game needs anyway.
   */
  async checkHd() {
    if (!window.isSecureContext || !('caches' in window)) {
      this.hud.setHdOption({ state: 'none' });
      return;
    }
    if (isSaving()) {
      this.hud.setHdOption({ state: 'busy' });
      return;
    }
    const metered = isMetered();
    this.hud.setHdOption({ state: 'checking', metered, checked: !metered && !hdDeclined() });
    try {
      await this.portal.ensureSolar(true);
      const { solar } = this.portal;
      if (!Object.keys(solar.maps.entries).length) throw new Error('No map manifest');
      const files = await solar.offer.missing();
      const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
      this.hud.setHdOption(files.length ? { state: 'offer', bytes, metered } : { state: 'saved' });
    } catch {
      this.hud.setHdOption({ state: 'none' });
    }
  }

  useControls(kind) {
    this.controls?.dispose();
    this.controls = kind === 'touch' ? new TouchControls(this.hud.root) : new KeyboardControls();
  }

  begin({ controls, hd }) {
    this.useControls(controls);
    this.wantHd = hd;
    this.container.classList.add('game-active');
    this.namedLayer.clearSelection();
    this.namedLayer.suspended = true;
    const fromMap = !this.portal.active;
    if (fromMap) this.flyHome();
    this.resetRun();
    this.state = 'countdown';
    this.phase = 'home';
    this.count = COUNT_FROM;
    this.ignited = false;
    this.hud.showCountdown();
    this.hud.setCount(COUNT_FROM);
    this.hud.setScale(fromMap ? 'Heading home to the Sun…' : 'Heading for Earth…');
    this.startPack();
  }

  /** On the galaxy map: fly toward the Sun while the countdown starts. */
  flyHome() {
    const { camera, controls } = this.scene;
    controls.enabled = false;
    const distance = camera.position.length();
    const to = distance > 1e-9
      ? camera.position.clone().setLength(Math.min(HOME_MPC, distance))
      : new THREE.Vector3(0, 0, HOME_MPC);
    this.scene.smoothFlyTo(to, new THREE.Vector3(), HOME_MS);
  }

  resetRun() {
    this.score = 0;
    this.time = 0;
    this.beltTime = 0;
    this.hits = 0;
    this.landedOn = new Set();
    this.landedList = [];
    this.leftEarth = false;
    this.nearMisses.clear();
    this.grace = 0;
    this.crashGrace = 0;
    this.shake = 0;
    this.cause = '';
    this.inBelt = false;
    this.heatShare = 0;
    this.impact = null;
    this.ship.reset();
    this.fire.clear();
    this.debris.clear();
    this.smoke.clear();
    this.field?.resetAll();
  }

  // ------------------------------------------------------- the resource pack

  startPack() {
    const pack = this.packState;
    if (pack.ready || this.pack) return;
    pack.error = null;
    this.pack = this.loadPack().then(
      () => {
        pack.ready = true;
        if (this.inSolar) this.mountParts();
      },
      (err) => {
        console.error(err);
        pack.error = err;
        this.pack = null;
      }
    );
  }

  /** Everything liftoff needs, built once and kept for every later launch. */
  async loadPack() {
    const pack = this.packState;
    const stage = (progress, text) => {
      pack.progress = progress;
      pack.stage = text;
    };
    stage(null, 'Loading the Solar System');
    await this.portal.ensureSolar(true);
    stage(0.35, 'Charting gravity');
    this.gravity ??= new GravityField(this.portal.solar);
    if (!this.field) {
      const phone = coarsePointer();
      stage(0.4, 'Scattering the asteroid belt');
      this.field = await AsteroidField.build(
        { count: phone ? PHONE_ROCKS : DESKTOP_ROCKS, detail: phone ? 1 : 2 },
        (share) => stage(0.4 + 0.45 * share, 'Scattering the asteroid belt')
      );
    }
    stage(0.9, 'Warming up the engines');
    await this.warmUp();
    stage(1, 'Ready for launch');
  }

  /**
   * Compiles the game's shaders against the Solar System's lights now, so
   * the first frame that shows the rocks or the ship does not stall. Where
   * the browser can, in the background.
   */
  async warmUp() {
    const { renderer } = this.scene;
    const { solar } = this.portal;
    const parallel = renderer.extensions.has('KHR_parallel_shader_compile');
    const parts = [this.field.group, this.ship.group, this.pad, this.fire.points, this.debris.points, this.smoke.points, this.predictor];
    for (const part of parts) {
      if (parallel) await renderer.compileAsync(part, solar.camera, solar.scene);
      else renderer.compile(part, solar.camera, solar.scene);
    }
  }

  /** The optional HD planet maps, into the same cache the Solar System reads. Never holds the launch. */
  async startHd() {
    this.wantHd = false;
    if (isSaving()) return;
    const hd = (this.hd = { done: 0, total: 0, finished: false, failed: false, until: Infinity });
    try {
      const files = await this.portal.solar.offer.missing();
      hd.total = files.reduce((sum, file) => sum + file.bytes, 0);
      if (files.length) await saveMaps(files, { onProgress: (done) => { hd.done = done; } });
      hd.finished = true;
      this.portal.solar.offer.el.hidden = true;
      this.announce('HD planet maps saved on this device.', 'good');
    } catch (err) {
      hd.failed = true;
      this.announce(`Map download stopped (${err.message}); what was saved is kept.`, 'bad');
    }
    hd.until = performance.now() + 5000;
  }

  announce(text, tone) {
    if (this.state === 'idle' || this.state === 'picking') notify(text, { error: tone === 'bad' });
    else this.hud.toast(text, tone);
  }

  // ------------------------------------------------------------------ frame

  /** Every frame. Returns true when it has stepped and drawn the Solar System itself. */
  update(dt) {
    if (this.state === 'idle' || this.state === 'picking') return false;
    if (this.state === 'countdown') this.tickCount(dt);
    if (this.wantHd && this.portal.solarReady) this.startHd();
    if (this.hd && performance.now() > this.hd.until) this.hd = null;
    this.hud.setHdProgress(this.hd);
    if (!this.inSolar) return false;

    const { solar } = this.portal;
    const running = this.state !== 'paused';
    solar.step(dt, true);
    this.gravity?.refresh(dt);
    if (running) {
      this.clock += dt;
      this.stateTime += dt;
    }
    this.field?.update(solar.years, this.clock, this.clock, this.ship.position);
    // Before anything spawns this frame: a new puff must start where it is made,
    // not a frame's travel ahead of the ship.
    if (running) {
      this.fire.update(dt);
      this.debris.update(dt);
      this.smoke.update(dt);
    }

    if (this.state === 'countdown') this.countdownFrame(dt);
    else if (this.state === 'liftoff') this.liftoffFrame(dt);
    else if (this.state === 'playing') this.playFrame(dt);
    else if (this.state === 'destroyed' || this.state === 'over') this.wreckFrame(dt);

    this.fitLens();
    solar.draw();
    this.updateHud(dt);
    return true;
  }

  /**
   * A portrait screen gets a taller lens, as the map's does: at the Solar
   * System's own 45° the chase view put the ship under the touch controls.
   */
  fitLens() {
    const { camera } = this.portal.solar;
    const base = camera.aspect < 1 ? Math.min(70, SOLAR_FOV / Math.sqrt(camera.aspect)) : SOLAR_FOV;
    const fov = base + BOOST_WIDEN * this.boostLens;
    if (Math.abs(camera.fov - fov) > 1e-3 || camera.near !== CAMERA_NEAR) {
      camera.fov = fov;
      camera.near = CAMERA_NEAR;
      camera.updateProjectionMatrix();
    }
    const { renderer } = this.scene;
    this.fire.fit(renderer, camera);
    this.debris.fit(renderer, camera);
    this.smoke.fit(renderer, camera);
  }

  // -------------------------------------------------------------- countdown

  /** The count itself, its holds, and the cut into the Solar System. Runs before the game has the frame too. */
  tickCount(dt) {
    if (this.cutting > 0) {
      this.cutting -= dt;
      if (this.cutting <= 0) {
        this.cutting = 0;
        const action = this.cutAction;
        this.cutAction = null;
        action();
        this.hud.fade(false);
      }
    }
    const pack = this.packState;
    const solarReady = this.portal.solarReady;
    if (this.phase === 'home' && this.count <= ENTER_AT && solarReady) {
      this.phase = 'cut';
      this.startCut(() => this.cutToEarth());
    }

    // The count may not run past what is not ready yet.
    let floor = 0;
    let hold = null;
    let retry = false;
    if (this.phase === 'cut') {
      floor = this.count;
    } else if (this.phase === 'home') {
      floor = NEED_SOLAR_AT;
      if (!solarReady) {
        hold = pack.error ? `The Solar System did not load (${pack.error.message})` : 'Loading the Solar System';
        retry = !!pack.error;
      }
    } else if (this.phase === 'approach') {
      floor = APPROACH_END;
    } else if (!pack.ready) {
      floor = NEED_PACK_AT;
      hold = pack.error ? `The resource pack did not load (${pack.error.message})` : pack.stage;
      retry = !!pack.error;
    }
    this.count = Math.max(this.count - dt, Math.min(floor, this.count));
    const held = !!hold && this.count <= floor + 1e-6;
    this.hud.setHold(held ? hold : null, { retry: held && retry });
    if (this.count > 0) this.hud.setCount(Math.ceil(this.count - 1e-6));
    this.hud.setPack(pack.ready ? 1 : pack.progress, pack.ready ? 'Ready for launch' : pack.error ? 'Stopped' : pack.stage);

    if (this.phase !== 'pad') return;
    if (!this.ignited && this.count <= IGNITION_AT) this.ignite();
    if (pack.ready && this.count <= 0) this.liftoff();
  }

  startCut(action) {
    this.cutting = FADE_S;
    this.cutAction = action;
    this.hud.fade(true);
  }

  /** Behind the fade: into the Solar System high over Earth, and the zoom down to the pad begins. */
  cutToEarth() {
    const { solar } = this.portal;
    // Every body where it is now, even if the Solar System has never been shown.
    solar.step(0, true);
    const f = this.computePadFrame();
    const start = f.earth.clone()
      .addScaledVector(f.travel, START_AHEAD)
      .addScaledVector(f.toSun, START_SUNWARD)
      .addScaledVector(Y, START_NORTH);
    if (!this.portal.active) this.portal.enterDirect(start, f.earth);
    this.takeSolar();
    this.placeOnPad();
    const { camera } = solar;
    camera.position.copy(start);
    camera.up.copy(Y);
    camera.lookAt(f.earth);
    this.approach = {
      t: 0,
      duration: THREE.MathUtils.clamp(this.count - APPROACH_END, MIN_APPROACH_S, MAX_APPROACH_S),
      from: start,
      target: f.earth.clone(),
      up: Y.clone()
    };
    this.phase = 'approach';
  }

  /** The Solar System stands down for the game: no follow, tour, card or controls, and time held. */
  takeSolar() {
    const { solar } = this.portal;
    this.saved = { timeScale: solar.timeScale, near: solar.camera.near };
    if (solar.earth?.owns) solar.earth.release(solar);
    solar.follow = null;
    solar.approach = null;
    solar.stopTour();
    solar.selected = null;
    solar.card.hide();
    solar.controls.enabled = false;
    solar.timeScale = 0;
    this.portal.band = 0;
    this.boostLens = 0;
    this.inSolar = true;
    this.gravity?.reset();
    this.mountParts();
  }

  /** The pad on Earth's dawn side, and the axes the launch is built from. */
  computePadFrame() {
    const body = this.portal.solar.byName.get('Earth');
    const earth = body.mesh.getWorldPosition(new THREE.Vector3());
    // Earth circles anticlockwise seen from ecliptic north, so it travels along Y × r.
    const travel = new THREE.Vector3().crossVectors(Y, earth).normalize();
    const up = travel.clone().multiplyScalar(Math.cos(PAD_TILT)).addScaledVector(Y, Math.sin(PAD_TILT)).normalize();
    const toSun = earth.clone().negate().normalize();
    const side = new THREE.Vector3().crossVectors(up, toSun).normalize();
    this.frame = { body, earth, radius: body.radius, travel, up, toSun, side, pad: earth.clone().addScaledVector(up, body.radius) };
    return this.frame;
  }

  /**
   * The pad, the ship on it and the camera's shot of them, all kept in
   * Earth's own frame so they ride along as it moves and turns.
   */
  placeOnPad() {
    const f = this.frame;
    const mesh = f.body.mesh;
    mesh.updateWorldMatrix(true, false);
    const toLocal = mesh.getWorldQuaternion(new THREE.Quaternion()).invert();
    const basis = (x, y, z) => new THREE.Quaternion().setFromRotationMatrix(this._m.makeBasis(x, y, z));
    const L = SHIP_LENGTH;

    // The tower stands on the side away from the camera.
    const away = f.side.clone().negate();
    this.pad.position.copy(mesh.worldToLocal(f.pad.clone()));
    this.pad.quaternion.copy(toLocal).multiply(basis(away, f.up, new THREE.Vector3().crossVectors(away, f.up)));

    // Nose up (its nose is −Z), canopy toward the camera.
    const shipQuat = basis(new THREE.Vector3().crossVectors(f.up, f.side), f.side, f.up.clone().negate());
    const shipPos = f.pad.clone().addScaledVector(f.up, (this.pad.userData.deckTop + TAIL_DEPTH) * L);
    this.ship.reset();
    this.ship.position.copy(shipPos);
    this.ship.quaternion.copy(shipQuat);
    this.landed = { body: f.body, local: mesh.worldToLocal(shipPos.clone()), from: null, quat: toLocal.clone().multiply(shipQuat), t: 1 };

    // Beside the pad, a little above the deck and toward the night side, so the Sun lights the ship from the side.
    const anchor = f.pad.clone().addScaledVector(f.up, 1.1 * L);
    const shot = f.pad.clone().addScaledVector(f.up, 1.5 * L).addScaledVector(f.side, 6 * L).addScaledVector(f.toSun, -1.2 * L);
    this.shot = { pos: mesh.worldToLocal(shot), anchor: mesh.worldToLocal(anchor), up: f.up.clone().applyQuaternion(toLocal) };
    this.padLocal = mesh.worldToLocal(f.pad.clone());
  }

  /** The pad shot in world space, now. */
  worldShot() {
    const mesh = this.frame.body.mesh;
    mesh.updateWorldMatrix(true, false);
    const s = this.shotWorld;
    s.pos.copy(this.shot.pos).applyMatrix4(mesh.matrixWorld);
    s.anchor.copy(this.shot.anchor).applyMatrix4(mesh.matrixWorld);
    s.up.copy(this.shot.up).applyQuaternion(mesh.getWorldQuaternion(this._q2));
    return s;
  }

  mountParts() {
    const { solar } = this.portal;
    solar.scene.add(this.ship.group, this.fire.points, this.debris.points, this.predictor);
    solar.byName.get('Earth').mesh.add(this.pad, this.smoke.points);
    if (this.field) solar.scene.add(this.field.group);
  }

  unmountParts() {
    const parts = [this.ship.group, this.fire.points, this.debris.points, this.predictor, this.pad, this.smoke.points, this.field?.group];
    for (const part of parts) part?.removeFromParent();
  }

  countdownFrame(dt) {
    if (this.landed) this.carry(dt);
    if (this.phase === 'approach') {
      this.approachCamera(dt);
    } else if (this.phase === 'pad') {
      const { camera } = this.portal.solar;
      const shot = this.worldShot();
      camera.position.copy(shot.pos);
      camera.up.copy(shot.up);
      camera.lookAt(shot.anchor);
      this.applyShake(dt);
    }
    // The engines light at T-3 and build toward liftoff.
    const level = this.ignited ? 0.25 + 0.55 * (1 - Math.max(this.count, 0) / IGNITION_AT) : 0;
    this.ship.animate(dt, this.clock, level, false);
    if (!this.ignited) return;
    this.ship.vibrate(0.02 + 0.03 * level, this.clock);
    this.shake = Math.max(this.shake, 0.15 * level);
    this.exhaust(dt, level, false);
    this.launchSmoke(dt, 40 + 60 * level);
  }

  /**
   * From high over Earth down to the ship, the distance on a log scale so
   * every second closes in by the same factor, the view swinging round to
   * the pad shot early; the line under the count says how big the view is.
   */
  approachCamera(dt) {
    const a = this.approach;
    const { camera } = this.portal.solar;
    a.t = Math.min(1, a.t + dt / a.duration);
    const s = smooth(a.t);
    const shot = this.worldShot();
    const from = this._a.copy(a.from).sub(shot.anchor);
    const to = this._b.copy(shot.pos).sub(shot.anchor);
    const d0 = from.length();
    const d1 = to.length();
    this._q.setFromUnitVectors(from.normalize(), to.normalize());
    this._q2.identity().slerp(this._q, ramp(s, 0, 0.7));
    const distance = Math.exp(THREE.MathUtils.lerp(Math.log(d0), Math.log(d1), s));
    // Both ends are above the pad's horizon, so the arc between never dips into Earth.
    camera.position.copy(from).applyQuaternion(this._q2).multiplyScalar(distance).add(shot.anchor);
    const look = this._c.lerpVectors(a.target, shot.anchor, ramp(s, 0, 0.6));
    camera.up.lerpVectors(a.up, shot.up, ramp(s, 0.3, 0.95)).normalize();
    camera.lookAt(look);
    const across = (2 * camera.position.distanceTo(look) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect) / SHIP_LENGTH;
    this.hud.setScale(`The view: ${format(Number(across.toPrecision(2)))} ship lengths across`);
    if (a.t < 1) return;
    this.approach = null;
    this.phase = 'pad';
    this.hud.setScale(`Scale set: Earth is ${format((2 * this.frame.radius) / SHIP_LENGTH)} ship lengths across`);
  }

  ignite() {
    this.ignited = true;
    // Time runs from here: Earth carries the pad, and the ship on it, along its orbit.
    this.portal.solar.timeScale = GAME_TIME_SCALE;
    this.gravity?.reset();
  }

  liftoff() {
    this.state = 'liftoff';
    this.phase = null;
    this.stateTime = 0;
    // Carrying it on the pad already gave the ship the ground's velocity.
    this.landed = null;
    this.chaseReady = false;
    this.hud.setCount('LIFTOFF');
    this.hud.setHold(null);
    this.hud.setScale('');
    this.hud.showFlight({ touch: this.controls.kind === 'touch' });
  }

  startPlaying() {
    this.state = 'playing';
    this.stateTime = 0;
    this.controls.setVisible(true);
    this.hud.showLegend(this.controls.kind === 'touch' ? TOUCH_LEGEND : KEYBOARD_LEGEND, 9000);
  }

  // ----------------------------------------------------------------- flight

  liftoffFrame(dt) {
    if (this.stateTime >= LIFTOFF_LABEL_S) this.hud.hideCountdown();
    this.physics(dt, this.autopilot);
    if (this.state !== 'liftoff') return;
    this.time += dt;
    this.score += POINTS_PER_SECOND * dt;
    this.ship.animate(dt, this.clock, 1, false);
    this.ship.vibrate(0.05 * Math.max(0, 1 - this.stateTime / 1.5), this.clock);
    this.exhaust(dt, 1, false);
    if (this.stateTime < 1.5) this.launchSmoke(dt, 120);
    this.liftoffCamera(dt);
    if (this.stateTime >= LIFTOFF_S) this.startPlaying();
  }

  playFrame(dt) {
    const input = this.controls.read(this.input);
    this.physics(dt, input);
    if (this.state === 'playing') this.heat(dt);
    if (this.state !== 'playing') return;
    const ship = this.ship;
    const flying = !this.landed;
    this.inBelt = flying && !!this.field?.contains(ship.position);
    if (flying) {
      this.time += dt;
      if (this.inBelt) this.beltTime += dt;
      this.score += POINTS_PER_SECOND * dt * (this.inBelt ? BELT_MULTIPLIER : 1);
    }
    const throttle = flying ? ship.throttle : 0;
    const boost = flying && ship.boosting;
    ship.animate(dt, this.clock, throttle, boost);
    ship.vibrate(boost ? 0.012 : 0, this.clock);
    this.exhaust(dt, throttle, boost);
    this.predict();

    const { camera } = this.portal.solar;
    const chase = this.chaseCamera(dt);
    camera.position.copy(chase.position);
    camera.quaternion.copy(chase.quaternion);
    this.keepCameraOut(camera.position);
    this.applyShake(dt);
    // A wider lens on boost sells the speed.
    this.boostLens += ((boost ? 1 : 0) - this.boostLens) * (1 - Math.exp(-dt * 4));
  }

  /**
   * Fixed-size substeps (at most MAX_STEPS a frame), then one sweep for rocks
   * along the whole frame's path. The Solar System has already stepped to the
   * frame's end, so each substep sees every world carried back along its
   * motion to that substep's moment: a ship on or beside a moving world keeps
   * its place instead of the world jumping a frame's travel into it.
   */
  physics(dt, input) {
    if (dt <= 0) return;
    this.grace = Math.max(0, this.grace - dt);
    this.crashGrace = Math.max(0, this.crashGrace - dt);
    if (this.landed) {
      if (this.state !== 'playing' || !(input.thrust > 0 || input.boost)) {
        this.carry(dt);
        return;
      }
      this.takeoff();
    }
    const start = this._s.copy(this.ship.position);
    const steps = Math.min(MAX_STEPS, Math.ceil(dt / STEP));
    const h = dt / steps;
    for (let i = 0; i < steps && this.flying(); i++) this.substep(h, input, (i + 1) * h - dt);
    if (this.flying()) this.sweepRocks(start, this.ship.position);
  }

  flying() {
    return (this.state === 'playing' || this.state === 'liftoff') && !this.landed;
  }

  /** One step of `h` seconds, ending `lag` seconds (≤ 0) before the frame's end, where the worlds are. */
  substep(h, input, lag) {
    const ship = this.ship;
    const strongest = this.gravity.sample(ship.position, this._g, lag);
    // Thrust tapers and the brake works against the world pulling hardest, not the Sun.
    const rel = this._rel.subVectors(ship.velocity, strongest.velocity);
    if (this.state === 'playing') ship.steer(input, h);
    const acc = ship.engineAccel(input, rel, this._acc).add(this._g);
    if (input.brake) {
      const speed = rel.length();
      if (speed > 1e-6) acc.addScaledVector(rel, -Math.min(BRAKE, speed / h) / speed);
    }
    ship.velocity.addScaledVector(acc, h);
    rel.subVectors(ship.velocity, strongest.velocity);
    const speed = rel.length();
    if (speed > HARD_CAP) ship.velocity.copy(strongest.velocity).addScaledVector(rel, HARD_CAP / speed);
    ship.position.addScaledVector(ship.velocity, h);
    this.contact(lag);
  }

  /** Meeting a world: slow enough on solid ground is a landing; anything else is a crash and a bounce. */
  contact(lag) {
    const ship = this.ship;
    for (const s of this.gravity.sources) {
      const centre = this._c.copy(s.position).addScaledVector(s.velocity, lag);
      const n = this._n.subVectors(ship.position, centre);
      const d = n.length();
      const reach = s.radius + SHIP_RADIUS;
      if (d >= reach) continue;
      if (s === this.gravity.sun) {
        this.destroy('You flew into the Sun.');
        return;
      }
      if (d > 1e-9) n.divideScalar(d);
      else n.copy(Y);
      const rel = this._rel.subVectors(ship.velocity, s.velocity);
      const speed = rel.length();
      const vn = rel.dot(n);
      const along = Math.sqrt(Math.max(0, speed * speed - vn * vn));
      if (s.solid && this.state === 'playing' && -vn < LAND_SPEED && along < LAND_SPEED * 1.5) {
        this.touchdown(s, n);
        return;
      }
      ship.position.copy(centre).addScaledVector(n, reach + 1e-4);
      if (vn < 0) rel.addScaledVector(n, -(1 + RESTITUTION) * vn);
      const out = rel.dot(n);
      rel.addScaledVector(n, -out).multiplyScalar(SCRAPE).addScaledVector(n, out);
      ship.velocity.copy(s.velocity).add(rel);
      if (this.crashGrace > 0) return;
      this.crashGrace = CRASH_GRACE;
      if (s.solid) {
        this.damage(CRASH_BASE_DAMAGE + CRASH_SPEED_DAMAGE * speed, { toast: `Crashed on ${s.name}`, cause: `You crashed on ${s.name}.` });
      } else {
        this.damage(2 * CRASH_BASE_DAMAGE + CRASH_SPEED_DAMAGE * speed, {
          toast: `${s.name} has no surface`,
          cause: `${s.name} has no surface to land on: its clouds crushed the hull.`
        });
      }
      return;
    }
  }

  touchdown(s, n) {
    const ship = this.ship;
    const mesh = s.body.mesh;
    // Landed, the ship rides the world to where it is at the frame's end.
    ship.position.copy(s.position).addScaledVector(n, s.radius + TAIL_DEPTH * SHIP_LENGTH);
    ship.velocity.copy(s.velocity);
    ship.angular.set(0, 0, 0);
    // It settles onto its tail, nose along the ground's normal, as it stood on the pad.
    const upright = this._q.setFromUnitVectors(ship.forward(this._f), n).multiply(ship.quaternion);
    mesh.updateWorldMatrix(true, false);
    const toLocal = mesh.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.landed = {
      body: s.body,
      local: mesh.worldToLocal(ship.position.clone()),
      from: toLocal.clone().multiply(ship.quaternion),
      quat: toLocal.multiply(upright),
      t: 0
    };
    this.impact = null;
    if (this.landedOn.has(s.name) || (s.name === 'Earth' && !this.leftEarth)) {
      this.hud.toast(`Touchdown on ${s.name}`, 'good');
      return;
    }
    this.landedOn.add(s.name);
    this.landedList.push(s.name);
    this.score += LANDING_POINTS;
    this.hud.toast(`First touchdown on ${s.name} · +${LANDING_POINTS}`, 'good');
  }

  takeoff() {
    // Carrying it already gave the ship the ground's velocity; its nose points up and away.
    this.landed = null;
    this.crashGrace = CRASH_GRACE;
  }

  /** A landed ship rides its world's surface, turning with it. */
  carry(dt) {
    const l = this.landed;
    const ship = this.ship;
    const mesh = l.body.mesh;
    mesh.updateWorldMatrix(true, false);
    const before = this._v.copy(ship.position);
    ship.position.copy(l.local).applyMatrix4(mesh.matrixWorld);
    l.t = Math.min(1, l.t + dt / SETTLE_S);
    const local = l.from ? this._q2.slerpQuaternions(l.from, l.quat, smooth(l.t)) : l.quat;
    ship.quaternion.copy(mesh.getWorldQuaternion(this._q)).multiply(local);
    if (dt > 0) ship.velocity.subVectors(ship.position, before).divideScalar(dt);
  }

  /**
   * Rocks along the path the ship took this frame: the first it touched is a
   * hit, anything else that passed within NEAR_GAP a near miss. A swept test,
   * so a fast ship cannot pass through a small rock between frames.
   */
  sweepRocks(p0, p1) {
    const field = this.field;
    if (!field) return;
    const r = p1.length();
    if (r < field.inner - 0.5 || r > field.outer + 0.5 || Math.abs(p1.y) > 3) return;
    const seg = this._seg.subVectors(p1, p0);
    const len2 = seg.lengthSq();
    const mid = this._mid.addVectors(p0, p1).multiplyScalar(0.5);
    const reach = Math.sqrt(len2) / 2 + field.maxReach + SHIP_RADIUS + NEAR_GAP;
    let hit = -1;
    let hitT = Infinity;
    field.near(mid, reach, this.portal.solar.years, (i, c) => {
      const t = len2 > 0 ? THREE.MathUtils.clamp(this._x.subVectors(c, p0).dot(seg) / len2, 0, 1) : 0;
      const d = this._y.copy(p0).addScaledVector(seg, t).distanceTo(c);
      const touch = field.reach[i] + SHIP_RADIUS;
      if (d < touch) {
        if (t < hitT) {
          hitT = t;
          hit = i;
          this._hit.copy(c);
        }
      } else if (d < touch + NEAR_GAP) {
        this.nearMiss(i);
      }
    });
    if (hit >= 0) this.hitRock(hit, this._hit, p0, seg, hitT);
  }

  rockVelocity(i, out) {
    const { solar } = this.portal;
    return this.field.velocityOf(i, solar.years, solar.timeScale / EARTH_YEAR_SECONDS, out);
  }

  hitRock(i, centre, p0, seg, t) {
    const field = this.field;
    const ship = this.ship;
    const rockVelocity = this.rockVelocity(i, this._rock);
    // Back to where the hull met the rock, just outside it.
    const n = this._n.copy(p0).addScaledVector(seg, t).sub(centre);
    if (n.lengthSq() < 1e-18) n.copy(seg).negate();
    n.normalize();
    const touch = field.reach[i] + SHIP_RADIUS;
    ship.position.copy(centre).addScaledVector(n, touch + 1e-4);
    const rel = this._rel.subVectors(ship.velocity, rockVelocity);
    const speed = rel.length();
    const L = SHIP_LENGTH;
    this._x.copy(ship.position).addScaledVector(n, -SHIP_RADIUS);
    for (let k = 0; k < 14; k++) {
      randomDirection(this._y).addScaledVector(n, 1.2).normalize().multiplyScalar((3 + Math.random() * 7) * L).add(rockVelocity);
      this.fire.spawn(this._x, this._y, { life: 0.25 + Math.random() * 0.35, size: 0.35 * L, size1: 0.1 * L, colour: [1, 0.95, 0.75], colour1: [1, 0.45, 0.1] });
    }
    if (field.reach[i] / L < SHATTER_BELOW) {
      // A small rock breaks up; ploughing through it costs speed.
      field.shatter(i, this.clock);
      rel.multiplyScalar(0.7);
      for (let k = 0; k < 16; k++) {
        randomDirection(this._y).multiplyScalar((1 + Math.random() * 4) * L).add(rockVelocity);
        this.debris.spawn(centre, this._y, {
          life: 1.2 + Math.random(), size: 0.6 * L, size1: (1.5 + Math.random() * 2) * L,
          colour: [0.42, 0.38, 0.34], colour1: [0.2, 0.19, 0.18], alpha: 0.8
        });
      }
    } else {
      const vn = rel.dot(n);
      if (vn < 0) rel.addScaledVector(n, -(1 + RESTITUTION) * vn);
    }
    ship.velocity.copy(rockVelocity).add(rel);
    if (this.grace > 0) return;
    this.grace = HIT_GRACE;
    this.hits += 1;
    this.damage(ROCK_BASE_DAMAGE + ROCK_SPEED_DAMAGE * speed, { toast: 'Asteroid hit', cause: 'An asteroid tore the hull open.' });
  }

  nearMiss(i) {
    const last = this.nearMisses.get(i);
    if (last !== undefined && this.clock - last < NEAR_COOLDOWN_S) return;
    const rel = this._v.subVectors(this.ship.velocity, this.rockVelocity(i, this._rock));
    if (rel.length() < NEAR_MISS_SPEED) return;
    this.nearMisses.set(i, this.clock);
    this.score += NEAR_MISS_POINTS;
    this.hud.toast(`Near miss · +${NEAR_MISS_POINTS}`, 'near');
  }

  /** Inside HEAT_RANGE Sun radii the hull cooks, fastest at the surface. */
  heat(dt) {
    const sun = this.gravity.sun;
    const range = HEAT_RANGE * sun.radius;
    const d = this.ship.position.distanceTo(sun.position);
    this.heatShare = THREE.MathUtils.clamp((range - d) / (range - sun.radius), 0, 1);
    if (this.heatShare > 0) this.damage(HEAT_DAMAGE * this.heatShare * dt, { cause: 'The Sun burned through the hull.', flash: false });
  }

  damage(amount, { toast = '', cause, flash = true }) {
    const ship = this.ship;
    ship.hull = Math.max(0, ship.hull - amount);
    if (toast) this.hud.toast(`${toast} · hull −${Math.max(1, Math.round((amount / HULL) * 100))}%`, 'bad');
    if (flash) {
      this.hud.flashDamage();
      this.shake = Math.min(1, this.shake + amount / 25);
    }
    if (ship.hull <= 0) this.destroy(cause);
  }

  destroy(cause) {
    if (this.state !== 'playing' && this.state !== 'liftoff') return;
    const ship = this.ship;
    const { camera } = this.portal.solar;
    this.state = 'destroyed';
    this.stateTime = 0;
    this.cause = cause;
    ship.hull = 0;
    this.landed = null;
    ship.group.visible = false;
    this.predictor.visible = false;
    this.heatShare = 0;
    this.hud.setHeat(0);
    this.controls.setVisible(false);
    this.hud.hideLegend();
    this.hud.flashDamage();
    this.shake = 1;
    this.wreck.position.copy(ship.position);
    this.wreck.velocity.copy(ship.velocity);
    this.wreck.camera.copy(camera.position);
    camera.up.copy(Y).applyQuaternion(camera.quaternion);
    this.explode(ship.position, ship.velocity);
  }

  /** Particles inherit the ship's velocity and have no drag: drag would pull them to rest against the Sun and leave them behind. */
  explode(p, v) {
    const L = SHIP_LENGTH;
    for (let k = 0; k < 90; k++) {
      randomDirection(this._x).multiplyScalar((2 + Math.random() * 9) * L).add(v);
      this.fire.spawn(p, this._x, {
        life: 0.5 + Math.random() * 0.9, size: (0.5 + Math.random()) * L, size1: (2 + Math.random() * 3) * L,
        colour: [1, 0.9, 0.6], colour1: [0.9, 0.25, 0.05]
      });
    }
    for (let k = 0; k < 40; k++) {
      randomDirection(this._x).multiplyScalar((0.5 + Math.random() * 3) * L).add(v);
      this.debris.spawn(p, this._x, {
        life: 2 + Math.random() * 1.5, size: 1.5 * L, size1: (5 + Math.random() * 4) * L,
        colour: [0.35, 0.33, 0.32], colour1: [0.15, 0.15, 0.16], alpha: 0.7
      });
    }
  }

  gameOver() {
    this.state = 'over';
    const score = Math.floor(this.score);
    const newBest = score > this.best;
    if (newBest) {
      this.best = score;
      store(BEST_KEY, String(score));
    }
    this.hud.hideFlight();
    this.hud.showOver({
      cause: this.cause, score, best: this.best, newBest,
      time: this.time, beltTime: this.beltTime, landed: this.landedList, hits: this.hits
    });
  }

  // ------------------------------------------------------- camera & effects

  /**
   * Behind and above the ship, lagging its turns a little so they read as
   * weight. Landed, the ship stands on its tail and behind it is underground,
   * so the camera swings round beside it, level with the ground.
   */
  chaseCamera(dt) {
    const ship = this.ship;
    const L = SHIP_LENGTH;
    const forward = ship.forward(this._f);
    const up = ship.up(this._u);
    const desired = this._d;
    const look = this._e;
    if (this.landed) {
      up.subVectors(ship.position, this.landed.body.mesh.getWorldPosition(this._y)).normalize();
      desired.copy(this.camOffset).addScaledVector(up, -this.camOffset.dot(up));
      if (desired.lengthSq() < 1e-12) {
        // Straight overhead: any direction along the ground will do.
        desired.set(Math.abs(up.x) < 0.9 ? 1 : 0, Math.abs(up.x) < 0.9 ? 0 : 1, 0);
        desired.addScaledVector(up, -desired.dot(up));
      }
      desired.normalize().multiplyScalar(6 * L).addScaledVector(up, 2 * L);
      look.copy(ship.position).addScaledVector(up, 0.3 * L);
    } else {
      desired.copy(forward).multiplyScalar(-CHASE_BACK * L).addScaledVector(up, CHASE_UP * L);
      look.copy(ship.position).addScaledVector(forward, CHASE_AHEAD * L);
    }
    if (this.chaseReady) this.camOffset.lerp(desired, 1 - Math.exp(-dt * 7));
    else this.camOffset.copy(desired);
    const position = this.chasePos.copy(ship.position).add(this.camOffset);
    this._q.setFromRotationMatrix(this._m.lookAt(position, look, up));
    if (this.chaseReady) this.camQuat.slerp(this._q, 1 - Math.exp(-dt * 9));
    else this.camQuat.copy(this._q);
    this.chaseReady = true;
    return { position, quaternion: this.camQuat };
  }

  /** Beside the pad, watching the ship climb, then easing into the chase. */
  liftoffCamera(dt) {
    const { camera } = this.portal.solar;
    const shot = this.worldShot();
    this.towerQuat.setFromRotationMatrix(this._m.lookAt(shot.pos, this.ship.position, shot.up));
    const chase = this.chaseCamera(dt);
    const k = ramp(this.stateTime, TOWER_CAM_S, TOWER_CAM_S + CHASE_BLEND_S);
    camera.position.lerpVectors(shot.pos, chase.position, k);
    camera.quaternion.slerpQuaternions(this.towerQuat, chase.quaternion, k);
    this.keepCameraOut(camera.position);
    this.applyShake(dt);
  }

  /** After the explosion: drift back from the wreck, carried along with it. */
  wreckFrame(dt) {
    const { camera } = this.portal.solar;
    const w = this.wreck;
    w.position.addScaledVector(w.velocity, dt);
    w.camera.addScaledVector(w.velocity, dt);
    const away = this._x.subVectors(w.camera, w.position);
    const d = away.length();
    if (d > 1e-9 && d < 30 * SHIP_LENGTH) w.camera.addScaledVector(away, (1.5 * SHIP_LENGTH * dt) / d);
    this.keepCameraOut(w.camera);
    // Shake goes on the camera, never into the drifting position it starts from.
    camera.position.copy(w.camera);
    camera.lookAt(w.position);
    this.applyShake(dt);
    if (this.state === 'destroyed' && this.stateTime >= DESTROYED_S) this.gameOver();
  }

  keepCameraOut(p) {
    if (!this.gravity) return;
    for (const s of this.gravity.sources) {
      const min = s.radius + 1.2 * SHIP_LENGTH;
      const d = p.distanceTo(s.position);
      if (d < min && d > 1e-9) p.sub(s.position).multiplyScalar(min / d).add(s.position);
    }
  }

  applyShake(dt) {
    if (this.shake < 0.002) return;
    const amount = this.shake * (this.calm.matches ? 0.25 : 1) * 0.35 * SHIP_LENGTH;
    const { position } = this.portal.solar.camera;
    position.x += (Math.random() * 2 - 1) * amount;
    position.y += (Math.random() * 2 - 1) * amount;
    position.z += (Math.random() * 2 - 1) * amount;
    this.shake *= Math.exp(-dt * 3.5);
  }

  exhaust(dt, throttle, boost) {
    if (throttle <= 0) {
      this.exhaustDebt = 0;
      return;
    }
    this.exhaustDebt += dt * throttle * (boost ? 110 : 70);
    const n = Math.floor(this.exhaustDebt);
    if (!n) return;
    this.exhaustDebt -= n;
    const ship = this.ship;
    const L = SHIP_LENGTH;
    const back = ship.forward(this._f).negate();
    const nozzles = ship.nozzles(this._nozzles);
    for (let k = 0; k < n; k++) {
      const speed = (boost ? 10 : 6) * (0.7 + Math.random() * 0.6) * L;
      randomDirection(this._x).multiplyScalar(0.6 * L).addScaledVector(back, speed).add(ship.velocity);
      this.fire.spawn(nozzles[k % 2], this._x, boost
        ? { life: 0.2 + Math.random() * 0.12, size: 0.3 * L, size1: 0.7 * L, colour: [0.75, 0.88, 1], colour1: [0.2, 0.3, 0.9], alpha: 0.7 }
        : { life: 0.22 + Math.random() * 0.14, size: 0.25 * L, size1: 0.55 * L, colour: [1, 0.72, 0.35], colour1: [0.6, 0.12, 0.03], alpha: 0.65 });
    }
  }

  /** Smoke rolling out across the ground from the pad, in Earth's frame. */
  launchSmoke(dt, rate) {
    this.smokeDebt += dt * rate;
    const n = Math.floor(this.smokeDebt);
    if (!n) return;
    this.smokeDebt -= n;
    const L = SHIP_LENGTH;
    const up = this.shot.up;
    for (let k = 0; k < n; k++) {
      const out = randomDirection(this._x);
      out.addScaledVector(up, -out.dot(up)).normalize();
      const p = this._y.copy(this.padLocal).addScaledVector(up, 0.3 * L).addScaledVector(out, 0.4 * L);
      out.multiplyScalar((1.5 + Math.random() * 2.5) * L).addScaledVector(up, (0.2 + Math.random() * 0.6) * L);
      const grey = 0.75 + Math.random() * 0.15;
      this.smoke.spawn(p, out, {
        life: 2 + Math.random() * 1.4, size: 0.9 * L, size1: (2.5 + Math.random() * 2.5) * L,
        colour: [grey, grey, grey * 1.03], colour1: [grey * 0.55, grey * 0.55, grey * 0.6], alpha: 0.38, drag: 0.9
      });
    }
  }

  /**
   * Where the ship will coast: gravity only, every world carried along its
   * current motion, drawn relative to the world pulling hardest now so an
   * orbit reads as an orbit. It stops, red, at the first world it would hit.
   */
  predict() {
    const line = this.predictor;
    if (this.landed) {
      line.visible = false;
      this.impact = null;
      return;
    }
    line.visible = true;
    const g = this.gravity;
    const ship = this.ship;
    const reference = g.sample(ship.position, this._g);
    const p = this._pp.copy(ship.position);
    const v = this._pv.copy(ship.velocity);
    const positions = line.geometry.attributes.position.array;
    const colours = line.geometry.attributes.color.array;
    positions[0] = p.x;
    positions[1] = p.y;
    positions[2] = p.z;
    let last = PREDICT_STEPS;
    this.impact = null;
    for (let k = 1; k <= PREDICT_STEPS && !this.impact; k++) {
      g.sample(p, this._pa, (k - 1) * PREDICT_DT);
      v.addScaledVector(this._pa, PREDICT_DT);
      p.addScaledVector(v, PREDICT_DT);
      const t = k * PREDICT_DT;
      positions[k * 3] = p.x - reference.velocity.x * t;
      positions[k * 3 + 1] = p.y - reference.velocity.y * t;
      positions[k * 3 + 2] = p.z - reference.velocity.z * t;
      for (const s of g.sources) {
        const dx = s.position.x + s.velocity.x * t - p.x;
        const dy = s.position.y + s.velocity.y * t - p.y;
        const dz = s.position.z + s.velocity.z * t - p.z;
        if (dx * dx + dy * dy + dz * dz < s.radius * s.radius) {
          this.impact = s;
          last = k;
          break;
        }
      }
    }
    for (let k = 0; k <= last; k++) {
      const share = k / last;
      const red = this.impact ? ramp(share, 0.5, 1) : 0;
      colours[k * 4] = 0.35 + 0.65 * red;
      colours[k * 4 + 1] = 0.85 - 0.5 * red;
      colours[k * 4 + 2] = 1 - 0.7 * red;
      colours[k * 4 + 3] = 0.05 + 0.65 * (1 - share) ** 0.7 + 0.5 * red;
    }
    line.geometry.setDrawRange(0, last + 1);
    line.geometry.attributes.position.needsUpdate = true;
    line.geometry.attributes.color.needsUpdate = true;
  }

  updateHud(dt) {
    if (this.state !== 'liftoff' && this.state !== 'playing') return;
    this.hudClock -= dt;
    if (this.hudClock > 0) return;
    this.hudClock = HUD_EVERY;
    const ship = this.ship;
    const g = this.gravity;
    const strongest = g.sample(ship.position, this._g);
    const pull = this._g.length();
    const rel = this._rel.subVectors(ship.velocity, strongest.velocity);
    let nearest = g.sun;
    let altitude = Infinity;
    for (const s of g.sources) {
      const above = ship.position.distanceTo(s.position) - s.radius;
      if (above < altitude) {
        altitude = above;
        nearest = s;
      }
    }
    const earth = g.byName.get('Earth');
    if (!this.leftEarth && earth && ship.position.distanceTo(earth.position) > LEFT_EARTH) this.leftEarth = true;

    let status;
    let warn = false;
    if (this.heatShare > 0) {
      status = 'Hull overheating: turn away from the Sun';
      warn = true;
    } else if (this.landed) {
      status = `Landed on ${this.landed.body.name} · thrust to lift off`;
    } else if (this.state === 'liftoff') {
      status = 'Climbing away from Earth';
    } else if (this.impact) {
      status = this.impact.solid
        ? `Surface ahead: ${this.impact.name} · under ${format(LAND_SPEED / SHIP_LENGTH)} L/s to land`
        : `Impact course: ${this.impact.name}`;
      warn = !this.impact.solid;
    } else if (ship.boosting) {
      status = 'Boost';
    } else if (this.input.brake) {
      status = `Braking against ${strongest.name}`;
    } else {
      status = g.strength > 1e-4 ? `In ${strongest.name}'s pull` : 'Coasting between worlds';
    }

    this.hud.setStats({
      hull: ship.hull,
      maxHull: HULL,
      score: this.score,
      best: Math.max(this.best, this.score),
      inBelt: this.inBelt,
      multiplier: BELT_MULTIPLIER,
      speed: rel.length() / SHIP_LENGTH,
      altitude: Math.max(0, altitude - SHIP_RADIUS) / SHIP_LENGTH,
      altitudeOf: nearest.name,
      gravity: pull / EARTH_G,
      gravityOf: g.strength > 1e-4 ? strongest.name : 'none',
      status,
      warn
    });
    this.hud.setHeat(this.heatShare);
  }

  // ------------------------------------------------- pausing, again, leaving

  onPauseKey() {
    if (this.state === 'countdown') this.exit();
    else if (this.state === 'paused') this.resume();
    else this.pause();
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'liftoff') return;
    this.pausedFrom = this.state;
    this.state = 'paused';
    this.portal.solar.timeScale = 0;
    this.controls.setVisible(false);
    this.hud.showPause();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.pausedFrom;
    this.portal.solar.timeScale = GAME_TIME_SCALE;
    this.controls.setVisible(this.state === 'playing');
    this.hud.hidePause();
  }

  /** Launch again: fade, back on the pad, a short count. */
  retry() {
    if (!this.inSolar || this.state === 'countdown') return;
    this.hud.hideOver();
    this.hud.hidePause();
    this.hud.hideFlight();
    this.controls.setVisible(false);
    this.predictor.visible = false;
    this.state = 'countdown';
    this.phase = 'cut';
    this.count = RETRY_FROM;
    this.hud.showCountdown();
    this.hud.setCount(RETRY_FROM);
    this.hud.setScale('');
    this.startCut(() => this.backToPad());
  }

  backToPad() {
    this.portal.solar.timeScale = 0;
    this.resetRun();
    this.ignited = false;
    this.boostLens = 0;
    this.gravity?.reset();
    this.computePadFrame();
    this.placeOnPad();
    this.phase = 'pad';
  }

  /** Leave the game for the Solar System (or the map, before the cut), framing the nearest world. */
  exit() {
    if (this.state === 'idle' || this.state === 'picking') return;
    this.state = 'idle';
    this.phase = null;
    this.cutting = 0;
    this.cutAction = null;
    this.approach = null;
    this.controls?.dispose();
    this.controls = null;
    this.hud.hideAll();
    this.container.classList.remove('game-active');
    if (!this.inSolar) {
      if (!this.portal.active) {
        this.scene.controls.enabled = true;
        this.namedLayer.suspended = false;
      }
      return;
    }

    this.inSolar = false;
    const { solar } = this.portal;
    const nearest = this.nearestWorld();
    this.unmountParts();
    this.landed = null;
    this.predictor.visible = false;
    this.fire.clear();
    this.debris.clear();
    this.smoke.clear();
    solar.setSpeed(this.saved.timeScale);
    solar.camera.near = this.saved.near;
    solar.camera.fov = SOLAR_FOV;
    solar.camera.updateProjectionMatrix();
    solar.camera.up.copy(Y);
    solar.controls.target.copy(this.ship.position);
    solar.controls.enabled = true;
    solar.focusOn(nearest);
    // A download still running here must not be offered again over itself.
    if (isSaving()) solar.offer.el.hidden = true;
  }

  nearestWorld() {
    if (!this.gravity) return this.portal.solar.byName.get('Earth');
    let best = this.gravity.sun;
    let altitude = Infinity;
    for (const s of this.gravity.sources) {
      const above = this.ship.position.distanceTo(s.position) - s.radius;
      if (above < altitude) {
        altitude = above;
        best = s;
      }
    }
    return best.body;
  }
}
