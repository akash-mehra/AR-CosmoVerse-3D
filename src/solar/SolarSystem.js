import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  DEG, EARTH_YEAR_SECONDS, SUN_RADIUS, SUN, PLANETS, MOONS, MINOR_BODIES,
  displayRadius, displayOrbit, kmToDisplayRadius, spinSeconds, moonOrbitRadius, moonPeriodSeconds, lightTime
} from './data.js';
import { mulberry32, surfaceTexture, saturnRingTexture, glowTexture } from './textures.js';
import { orbitalPosition, orbitSamples } from './kepler.js';
import { createSky, createDust, setWarp, SKY_RADIUS } from './sky.js';
import { createBelts } from './belts.js';
import { BodyCard } from './BodyCard.js';
import { createAtmosphere } from './atmosphere.js';
import { BAND_OUTER, SOLAR_FOV } from './scale.js';
import { accelerateZoom } from '../rendering/accelerateZoom.js';

// Where maps are served from: this deploy, unless VITE_TEXTURE_BASE names another
// host, which must send CORS headers or WebGL cannot use them.
const TEXTURE_BASE = (import.meta.env.VITE_TEXTURE_BASE || `${import.meta.env.BASE_URL}textures`).replace(/\/?$/, '/');
const TEXTURE_ROOT = `${TEXTURE_BASE}solar/`;
// Spacecraft maps of Earth, the moons and dwarf planets (npm run fetch:textures).
const BODY_ROOT = `${TEXTURE_BASE}bodies/`;
// A body's spacecraft map loads once it spans this many pixels on screen; until
// then its painted surface stands in, so bodies never visited cost no memory.
const PHOTO_PX = 12;
// The Moon's normal map holds true slopes; drawn deeper so its relief reads.
const MOON_RELIEF = 2.5;
// Below this share of its surface photographed, a map's black gaps are painted in.
const MOSTLY_SEEN = 0.98;
const TIME_SPEEDS = [0, 1, 10, 100];
// Arrival from interstellar space: fast at first, easing in to the planets.
const APPROACH_SECONDS = 6.5;
const APPROACH_FROM = new THREE.Vector3(-700, 1100, 2500);
const TOUR = ['Sun', 'Mercury', 'Venus', 'Earth', 'Moon', 'Mars', 'Asteroid Belt', 'Jupiter', 'Io', 'Europa',
  'Saturn', 'Titan', 'Uranus', 'Neptune', 'Triton', 'Pluto', 'Kuiper Belt'];
const TOUR_DWELL = 7;
// Who keeps a label when two would overlap.
const PRIORITY = { sun: 100, planet: 90, dwarf: 72, comet: 68, belt: 60, moon: 55, sky: 30 };
// The simulation starts now, as a decimal year, and runs forward from it.
const START_YEAR = 1970 + Date.now() / 31557600000;
const J2000_CENTURIES = (START_YEAR - 2000) / 100;
const MS_PER_YEAR = 31557600000;

async function loadTexture(loader, file, { data = false } = {}) {
  try {
    const texture = await loader.loadAsync(TEXTURE_ROOT + file);
    // Colour maps are sRGB; an alpha map is data and must not be decoded.
    texture.colorSpace = data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  } catch {
    return null;
  }
}

/** A painted surface's overall colour, brightest channel 1: the tint for a greyscale map. */
function averageColour(image) {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 16;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, 32, 16);
  const { data } = ctx.getImageData(0, 0, 32, 16);
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += data[i + c];
  const top = Math.max(...sum, 1);
  return sum.map((v) => v / top);
}

/**
 * A spacecraft map with what no spacecraft saw (black in the mosaic) taken
 * from the painted surface, and the rest tinted: the seen part stays real.
 */
function fillUnseen(photo, painted, tint) {
  const canvas = document.createElement('canvas');
  canvas.width = photo.width;
  canvas.height = photo.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(painted, 0, 0, canvas.width, canvas.height);
  const fill = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  ctx.drawImage(photo, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const p = image.data;
  for (let i = 0; i < p.length; i += 4) {
    // JPEG leaves the black fill a little noisy.
    const unseen = p[i] + p[i + 1] + p[i + 2] < 18;
    for (let c = 0; c < 3; c++) p[i + c] = unseen ? fill[i + c] : p[i + c] * tint[c];
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** City lights only on the night side, fading in through twilight. The Sun is at the origin. */
function nightSideOnly(shader) {
  shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    vec3 toSun = normalize((viewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz + vViewPosition);
    totalEmissiveRadiance *= smoothstep(0.1, -0.15, dot(normal, toSun));`);
}

/** Where a body's surface comes from, for its card. */
function surfaceNote(body, entry) {
  if (entry) {
    const seen = entry.note ? ` ${entry.note}; what it never saw is painted in.`
      : entry.imaged < MOSTLY_SEEN ? ` ${Math.round(entry.imaged * 100)}% of it has been photographed; the rest is an artist's impression.` : '';
    return `Map: ${entry.credit}.${seen}`;
  }
  if (!body.mesh.material.map?.isCanvasTexture) return 'Map: Solar System Scope, from NASA imagery (CC BY 4.0).';
  return body.unvisited ? "Artist's impression: no spacecraft has visited it." : "Artist's impression: no spacecraft map of it is used here.";
}

/** A potato: a sphere dented in a few places, for bodies too small to pull themselves round. */
function lumpyGeometry(radius, seed) {
  const geometry = new THREE.IcosahedronGeometry(radius, 3);
  const rand = mulberry32(seed);
  const dents = Array.from({ length: 7 }, () => ({
    dir: new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize(),
    depth: 0.12 + rand() * 0.25
  }));
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    // A function of direction only, so vertices shared between faces agree.
    let s = 1;
    for (const d of dents) s -= d.depth * Math.max(0, v.dot(d.dir)) ** 3;
    v.multiplyScalar(radius * s);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function orbitLine(points, colour, opacity) {
  return new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false })
  );
}

const circle = (radius, count = 256) => Array.from({ length: count }, (_, k) => {
  const a = (k / count) * Math.PI * 2;
  return new THREE.Vector3(Math.cos(a) * radius, 0, -Math.sin(a) * radius);
});

/**
 * The Solar System, reached by zooming into the Milky Way: the Sun, planets
 * and their major moons, dwarf planets and Halley's Comet on their real
 * orbits, the asteroid and Kuiper belts, and the sky as it really stands
 * around us. Everything starts where it is today and runs forward in time.
 *
 * It owns its own scene, camera and OrbitControls but borrows the map's
 * renderer and canvas; MilkyWayPortal decides which of the two is drawn.
 */
export class SolarSystem {
  constructor(renderer, container, starField = null) {
    this.renderer = renderer;
    this.container = container;
    // The nearby stars, for a real sky; null falls back to a random one.
    this.starField = starField;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x010104);
    this.camera = new THREE.PerspectiveCamera(SOLAR_FOV, 1, 0.02, 8000);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 0.3;
    // Out past the Oort Cloud to where the galaxy map takes over.
    this.controls.maxDistance = BAND_OUTER;
    this.controls.enabled = false;
    accelerateZoom(this.controls);

    this.bodies = [];
    this.byName = new Map();
    this.bodyMaps = {};
    this.pendingMaps = [];
    this.loader = new THREE.TextureLoader();
    this.pickables = [];
    this.active = false;
    this.years = 0;
    this.moonClock = 0;
    this.timeScale = 1;
    this.follow = null;
    this.selected = null;
    this.tour = null;
    this.approach = null;
    this.warp = 0;
    this.dateClock = 0;
    this.loaded = null;

    this.size = new THREE.Vector2();
    this.lastCam = new THREE.Vector3();
    this.focusNdc = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this._p = new THREE.Vector3();
    this._q = new THREE.Vector3();
    this._a = new THREE.Vector3();

    this.renderDOM();
    this.bindPointer();
  }

  renderDOM() {
    this.root = document.createElement('div');
    this.root.className = 'solar-layer';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="solar-top glass-card">
        <button class="control-btn" type="button" data-solar="exit" title="Back to the galaxy map (Esc)">← Back to the universe</button>
        <div class="solar-title">
          <strong>Solar System</strong>
          <span class="solar-date"></span>
        </div>
        <div class="solar-tools">
          <button class="control-btn small" type="button" data-solar="tour" title="Fly from the Sun out to the Kuiper Belt, stopping at each world">🚀 Grand tour</button>
          <div class="solar-speed" role="group" aria-label="Time speed">
            ${TIME_SPEEDS.map((s) => `<button type="button" data-speed="${s}" aria-pressed="${s === 1}" title="${s === 0 ? 'Pause time' : `One Earth year every ${EARTH_YEAR_SECONDS / s} s`}">${s === 0 ? '⏸' : `${s}×`}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="solar-labels"></div>
      <p class="solar-hint">Drag to orbit · scroll or pinch to zoom · tap anything named to learn about it</p>
      <p class="solar-credit">Sizes and distances compressed to fit — the Oort Cloud far more.
        Planet maps: <a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noopener noreferrer">Solar System Scope</a>, CC BY 4.0 ·
        Earth, moon and dwarf-planet maps: NASA, USGS</p>
    `;
    this.labelRoot = this.root.querySelector('.solar-labels');
    this.dateEl = this.root.querySelector('.solar-date');
    this.tourBtn = this.root.querySelector('[data-solar="tour"]');
    this.root.querySelector('[data-solar="exit"]').addEventListener('click', () => this.onExit?.());
    this.tourBtn.addEventListener('click', () => (this.tour ? this.stopTour() : this.startTour()));
    this.speedBtns = [...this.root.querySelectorAll('[data-speed]')];
    this.speedBtns.forEach((btn) => btn.addEventListener('click', () => this.setSpeed(Number(btn.dataset.speed))));

    this.card = new BodyCard(this.root);
    this.card.onClose = () => {
      this.selected = null;
      this.card.hide();
    };
    this.card.onFollow = () => {
      if (!this.selected) return;
      if (this.follow?.body === this.selected) {
        this.follow = null;
        this.card.setFollowing(false);
      } else {
        this.focusOn(this.selected);
      }
    };
    this.container.appendChild(this.root);
  }

  /** Tap to select, drag to orbit: only a tap that did not move picks a body. */
  bindPointer() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => {
      if (!this.active || !e.isPrimary) return;
      // Any touch cuts the arrival short and hands over the controls.
      if (this.approach) this.approach.t = 1;
      this.stopTour();
      down = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointerup', (e) => {
      if (!this.active || !e.isPrimary || !down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 6) return;
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
      if (hit) this.select(hit.object.userData.body);
    });
  }

  /** Builds everything once; later entries reuse it. */
  load() {
    this.loaded ??= this.build();
    return this.loaded;
  }

  async build() {
    const loader = this.loader;
    const maps = new Map();
    const colourFiles = ['sun.jpg', ...PLANETS.map((p) => p.texture), ...MOONS.map((m) => m.texture).filter(Boolean)];
    const dataFiles = PLANETS.map((p) => p.clouds).filter(Boolean);
    await Promise.all([
      // Without the manifest every body keeps its painted surface.
      fetch(`${BODY_ROOT}manifest.json`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((manifest) => { this.bodyMaps = manifest.bodies ?? {}; })
        .catch((err) => console.warn('Body maps unavailable:', err.message)),
      ...colourFiles.map(async (f) => maps.set(f, await loadTexture(loader, f))),
      ...dataFiles.map(async (f) => maps.set(f, await loadTexture(loader, f, { data: true })))
    ]);
    const pixelRatio = this.renderer.getPixelRatio();

    this.sky = createSky(pixelRatio, this.starField);
    this.scene.add(this.sky.group);
    for (const item of this.sky.items) this.addBody({ ...item, followable: false });
    this.dust = createDust(pixelRatio);
    this.scene.add(this.dust.points);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.09));
    this.scene.add(new THREE.PointLight(0xfff4e0, 3.2, 0, 0));
    this.addSun(maps.get('sun.jpg'));

    for (const planet of PLANETS) {
      const map = maps.get(planet.texture) ?? surfaceTexture(planet.name, null, planet.colour);
      this.addPlanet(planet, map, planet.clouds ? maps.get(planet.clouds) : null);
    }
    for (const body of MINOR_BODIES) this.addMinor(body);
    for (const moon of MOONS) this.addMoon(moon, moon.texture ? maps.get(moon.texture) : null);

    const jupiter = PLANETS.find((p) => p.name === 'Jupiter');
    this.belts = createBelts({
      pixelRatio,
      jupiterStart: (jupiter.L0 + jupiter.rate * J2000_CENTURIES) * DEG,
      jupiterRate: (2 * Math.PI) / jupiter.period
    });
    this.scene.add(this.belts.points);
    for (const region of this.belts.regions) {
      this.addBody({ name: region.name, kind: 'belt', info: region.info, anchor: region.anchor, followable: true, viewDistance: 70 });
    }
  }

  addBody(body) {
    const label = document.createElement('button');
    label.type = 'button';
    label.className = `solar-label kind-${body.kind}`;
    label.textContent = body.name;
    label.style.visibility = 'hidden';
    label.addEventListener('click', () => this.select(body));
    this.labelRoot.appendChild(label);
    body.label = label;
    body.shown = false;
    if (body.mesh) {
      body.mesh.userData.body = body;
      this.pickables.push(body.mesh);
      const entry = this.bodyMaps[body.name.toLowerCase()];
      if (entry) this.pendingMaps.push({ body, entry });
      body.surfaceNote = surfaceNote(body, entry);
    }
    this.bodies.push(body);
    this.byName.set(body.name, body);
    return body;
  }

  addSun(map) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(SUN_RADIUS, 64, 32),
      new THREE.MeshBasicMaterial(map ? { map } : { color: 0xffc350 })
    );
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture('rgba(255,236,190,0.95)', 'rgba(255,170,60,0.28)'),
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    glow.scale.setScalar(SUN_RADIUS * 7);
    mesh.add(glow);
    this.scene.add(mesh);
    const spin = (2 * Math.PI) / spinSeconds(25.4);
    this.addBody({
      name: 'Sun', kind: 'sun', info: SUN.info, mesh, radius: SUN_RADIUS, followable: true, viewDistance: 150,
      tick: (dt) => { mesh.rotation.y += spin * dt; }
    });
  }

  addPlanet(planet, map, clouds) {
    const radius = displayRadius(planet.radius);
    const orbit = displayOrbit(planet.au);

    // Line of nodes, then inclination about it, then the circular orbit.
    const pivot = new THREE.Object3D();
    pivot.rotation.y = planet.node * DEG;
    const plane = new THREE.Object3D();
    plane.rotation.x = planet.incl * DEG;
    pivot.add(plane);
    this.scene.add(pivot);
    plane.add(orbitLine(circle(orbit), 0x4a6a9a, 0.28));

    const carrier = new THREE.Object3D();
    plane.add(carrier);
    const tilt = new THREE.Object3D();
    tilt.rotation.z = planet.tilt * DEG;
    carrier.add(tilt);

    const segments = radius > 1 ? 64 : 40;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, segments, segments / 2),
      new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 })
    );
    tilt.add(mesh);

    let cloudMesh = null;
    if (clouds) {
      cloudMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.015, segments, segments / 2),
        new THREE.MeshStandardMaterial({ alphaMap: clouds, transparent: true, depthWrite: false, roughness: 1 })
      );
      mesh.add(cloudMesh);
    }
    if (planet.atmosphere) mesh.add(createAtmosphere(radius, { ...planet.atmosphere, radiusKm: planet.radiusKm }));
    if (planet.rings) tilt.add(this.saturnRings(radius));

    const angle0 = (planet.L0 + planet.rate * J2000_CENTURIES - planet.node) * DEG;
    const spin = (2 * Math.PI) / spinSeconds(planet.day);
    this.addBody({
      name: planet.name,
      kind: 'planet',
      info: { ...planet.info, rows: [['From the Sun', `${planet.au} AU · light takes ${lightTime(planet.au)}`], ...planet.info.rows] },
      mesh, tilt, carrier, radius, radiusKm: planet.radiusKm, clouds: cloudMesh, followable: true, viewDistance: radius * 9 + 3,
      tick: (dt) => {
        const a = angle0 + (2 * Math.PI * this.years) / planet.period;
        carrier.position.set(Math.cos(a) * orbit, 0, -Math.sin(a) * orbit);
        mesh.rotation.y += spin * dt;
      }
    });
  }

  saturnRings(radius) {
    const inner = radius * 1.24;
    const outer = radius * 2.27;
    const geometry = new THREE.RingGeometry(inner, outer, 160, 1);
    // RingGeometry maps UVs as a square; the ring texture is a radial strip.
    const pos = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    for (let k = 0; k < pos.count; k++) {
      const d = Math.hypot(pos.getX(k), pos.getY(k));
      uv.setXY(k, (d - inner) / (outer - inner), 0.5);
    }
    // Unlit: the Sun grazes the ring plane, and a lit ring came out nearly
    // black, where the real one is brighter than the planet.
    const rings = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      map: saturnRingTexture(),
      color: 0xd8d0c0,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    }));
    rings.rotation.x = -Math.PI / 2; // into the equatorial plane
    return rings;
  }

  /** A dwarf planet or comet on its real eccentric orbit, solved from Kepler's equation each frame. */
  addMinor(el) {
    const radius = kmToDisplayRadius(el.radiusKm);
    const pivot = new THREE.Object3D();
    pivot.rotation.y = el.node * DEG;
    const plane = new THREE.Object3D();
    plane.rotation.x = el.i * DEG;
    pivot.add(plane);
    this.scene.add(pivot);
    const path = orbitSamples(el).map(({ r, u }) => {
      const d = displayOrbit(r);
      return new THREE.Vector3(Math.cos(u) * d, 0, -Math.sin(u) * d);
    });
    plane.add(orbitLine(path, el.kind === 'comet' ? 0x5fb4c9 : 0x8a7a9a, el.kind === 'comet' ? 0.3 : 0.22));

    const carrier = new THREE.Object3D();
    plane.add(carrier);
    const tilt = new THREE.Object3D();
    tilt.rotation.z = el.tilt * DEG;
    carrier.add(tilt);
    const map = surfaceTexture(el.name, el.surface);
    const mesh = new THREE.Mesh(
      el.lumpy ? lumpyGeometry(radius, el.name.length * 131) : new THREE.SphereGeometry(radius, 64, 32),
      new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 })
    );
    if (el.stretch) mesh.scale.set(...el.stretch);
    tilt.add(mesh);

    const spin = (2 * Math.PI) / spinSeconds(el.day);
    const body = this.addBody({
      name: el.name,
      kind: el.kind,
      info: el.info,
      unvisited: el.unvisited,
      mesh, tilt, carrier, radius, radiusKm: el.radiusKm, followable: true,
      viewDistance: el.kind === 'comet' ? 7 : radius * 12 + 2,
      r: el.a,
      tick: (dt) => {
        const { r, u } = orbitalPosition(el, START_YEAR + this.years);
        const d = displayOrbit(r);
        carrier.position.set(Math.cos(u) * d, 0, -Math.sin(u) * d);
        body.r = r;
        mesh.rotation.y += spin * dt;
      }
    });
    if (el.kind === 'comet') this.addCometTail(body);
  }

  /**
   * Coma and tails, grown from the comet's distance to the Sun: nothing out
   * past Jupiter, a long blue ion tail and a curved dust tail near perihelion,
   * both pointing away from the Sun.
   */
  addCometTail(body) {
    const COUNT = 1400;
    const rand = mulberry32(1986);
    const seeds = Array.from({ length: COUNT }, (_, i) => ({
      ion: i % 2 === 0,
      t: rand() ** 0.7,
      jitter: new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).multiplyScalar(0.5)
    }));
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const soft = glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.3)', 64);
    const tail = new THREE.Points(geometry, new THREE.PointsMaterial({
      size: 0.1, map: soft, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    tail.frustumCulled = false;
    this.scene.add(tail);
    const coma = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture('rgba(220,245,255,0.9)', 'rgba(120,200,230,0.25)', 128),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    }));
    body.mesh.add(coma);

    const nucleus = new THREE.Vector3();
    const last = new THREE.Vector3();
    const away = new THREE.Vector3();
    const drift = new THREE.Vector3();
    const tick = body.tick;
    body.tick = (dt) => {
      tick(dt);
      body.mesh.getWorldPosition(nucleus);
      drift.copy(nucleus).sub(last);
      last.copy(nucleus);
      const activity = THREE.MathUtils.clamp((5.5 - body.r) / 5, 0, 1);
      coma.visible = activity > 0;
      coma.scale.setScalar(0.4 + activity * 2.6);
      coma.material.opacity = activity;
      tail.visible = activity > 0;
      if (!tail.visible) return;

      away.copy(nucleus).normalize();
      if (drift.lengthSq() > 1e-12) drift.normalize();
      const ionLength = 2 + 20 * activity ** 1.3;
      const dustLength = 1.5 + 13 * activity ** 1.3;
      seeds.forEach(({ ion, t, jitter }, i) => {
        const p = this._p.copy(nucleus);
        if (ion) {
          p.addScaledVector(away, t * ionLength).addScaledVector(jitter, (0.08 + t * 0.6) * activity);
          colors.set([0.45 * (1 - t) * activity, 0.65 * (1 - t) * activity, 1.0 * (1 - t) * activity], i * 3);
        } else {
          // The dust lags behind the comet's motion, so its tail curves.
          p.addScaledVector(away, t * dustLength).addScaledVector(drift, -t * t * dustLength * 0.45)
            .addScaledVector(jitter, (0.15 + t * 1.4) * activity);
          colors.set([0.9 * (1 - t) * activity, 0.84 * (1 - t) * activity, 0.7 * (1 - t) * activity], i * 3);
        }
        positions.set([p.x, p.y, p.z], i * 3);
      });
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
    };
  }

  /** A moon on its parent's equator (Earth's Moon: near the ecliptic), tidally locked. */
  addMoon(m, photo) {
    const parent = this.byName.get(m.parent);
    if (!parent) return;
    const radius = kmToDisplayRadius(m.radiusKm);
    const orbit = moonOrbitRadius(parent.radius, m.aKm / parent.radiusKm);
    const rand = mulberry32(m.name.length * 977 + m.aKm);

    const node = new THREE.Object3D();
    node.rotation.y = rand() * Math.PI * 2;
    const plane = new THREE.Object3D();
    plane.rotation.x = m.incl * DEG;
    node.add(plane);
    (m.plane === 'ecliptic' ? parent.carrier : parent.tilt).add(node);
    plane.add(orbitLine(circle(orbit, 128), 0x7890b0, 0.16));

    const pivot = new THREE.Object3D();
    plane.add(pivot);
    const mesh = new THREE.Mesh(
      m.lumpy ? lumpyGeometry(radius, m.aKm) : new THREE.SphereGeometry(radius, 64, 32),
      new THREE.MeshStandardMaterial({ map: photo ?? surfaceTexture(m.name, m.surface), roughness: 1, metalness: 0 })
    );
    mesh.position.x = orbit;
    // A map's 0° longitude faces the planet, as it is defined to. A sphere puts
    // the map's centre on +X and the planet lies along −X; an icosahedron's
    // UVs already start half a turn round.
    if (!m.lumpy) mesh.rotation.y = Math.PI;
    pivot.add(mesh);
    if (m.atmosphere) mesh.add(createAtmosphere(radius, { ...m.atmosphere, radiusKm: m.radiusKm }));

    const angle0 = rand() * Math.PI * 2;
    const period = moonPeriodSeconds(m.period);
    this.addBody({
      name: m.name,
      kind: 'moon',
      info: m.info,
      mesh, radius, parent, followable: true, viewDistance: radius * 10 + 1.2,
      // Turning the pivot carries the moon round with the same face inward.
      tick: () => {
        pivot.rotation.y = angle0 + (2 * Math.PI * this.moonClock) / period;
        // Pluto keeps its own 0° (the sub-Charon meridian) facing Charon too.
        if (m.mutual) parent.mesh.rotation.y = node.rotation.y + pivot.rotation.y;
      }
    });
  }

  /** Where a body is now: a mesh, a region's anchor, or a direction on the sky. */
  positionOf(body, out) {
    if (body.anchor) return body.anchor(this.years, out);
    if (body.direction) return out.copy(this.camera.position).addScaledVector(body.direction, SKY_RADIUS);
    return body.mesh.getWorldPosition(out);
  }

  select(body) {
    this.selected = body;
    if (body.followable) this.focusOn(body);
    this.card.show(body, { following: this.follow?.body === body });
  }

  /** Flies to a body, then rides along with it. */
  focusOn(body) {
    const at = this.positionOf(body, new THREE.Vector3());
    const away = this.camera.position.clone().sub(this.controls.target);
    if (away.lengthSq() < 1e-9) away.set(0, 0.4, 1);
    away.normalize().multiplyScalar(body.viewDistance);
    const to = at.clone().add(away);
    this.follow = {
      body,
      t: 0,
      // Long hops take longer, and the stars streak past on the way.
      duration: THREE.MathUtils.clamp(1.3 + this.camera.position.distanceTo(to) / 90, 1.3, 4.5),
      fromCam: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      offset: away,
      last: at
    };
    if (this.selected === body) this.card.setFollowing(true);
  }

  startTour() {
    this.tour = { index: -1, wait: 0 };
    this.tourBtn.textContent = '■ Stop tour';
    this.nextStop();
  }

  nextStop() {
    const tour = this.tour;
    tour.index += 1;
    tour.wait = 0;
    if (tour.index >= TOUR.length) {
      this.stopTour();
      this.select(this.byName.get('Sun'));
      return;
    }
    const body = this.byName.get(TOUR[tour.index]);
    if (body) this.select(body);
    else this.nextStop();
  }

  stopTour() {
    if (!this.tour) return;
    this.tour = null;
    this.tourBtn.textContent = '🚀 Grand tour';
  }

  setSpeed(speed) {
    this.timeScale = speed;
    this.speedBtns.forEach((btn) => btn.setAttribute('aria-pressed', String(Number(btn.dataset.speed) === speed)));
    this.dateClock = 0;
  }

  enter() {
    // Arrive from outside the Oort Cloud and fall inward to the planets. A
    // portrait screen is narrow, so the final view there stands further back.
    this.takeOver(APPROACH_FROM, new THREE.Vector3());
    this.renderer.getSize(this.size);
    const back = this.size.x < this.size.y ? 1.9 : 1;
    this.approach = { t: 0, from: APPROACH_FROM.clone(), to: new THREE.Vector3(0, 70 * back, 150 * back) };
    this.camera.lookAt(0, 0, 0);
    this.controls.enabled = false;
  }

  /** Takes over the view as it is, as when a zoom from the map reaches it. */
  takeOver(position, target) {
    this.active = true;
    this.root.hidden = false;
    this.follow = null;
    this.approach = null;
    this.stopTour();
    this.camera.position.copy(position);
    this.controls.target.copy(target);
    this.lastCam.copy(position);
    this.controls.enabled = true;
  }

  exit() {
    this.active = false;
    this.root.hidden = true;
    this.controls.enabled = false;
    this.follow = null;
    this.approach = null;
    this.stopTour();
    this.selected = null;
    this.card.hide();
  }

  update(dt) {
    this.step(dt);
    this.draw();
  }

  /**
   * Advances time and the camera. `driven` is for when the map owns the view
   * and places this camera itself: nothing here may move it then.
   */
  step(dt, driven = false) {
    this.renderer.getSize(this.size);
    const aspect = this.size.x / Math.max(this.size.y, 1);
    // Far enough to keep the Oort Cloud in view from where the map takes over.
    const far = Math.max(8000, this.camera.position.length() + 3000);
    if (Math.abs(this.camera.aspect - aspect) > 1e-4 || far !== this.camera.far) {
      this.camera.aspect = aspect;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }

    // Time: planets and belts run on simulated years; moons on their own
    // compressed clock, capped so fast time does not turn them into a blur.
    this.years += (dt * this.timeScale) / EARTH_YEAR_SECONDS;
    this.moonClock += dt * Math.min(this.timeScale, 3);
    const spinDt = this.timeScale > 0 ? dt : 0;
    for (const body of this.bodies) body.tick?.(spinDt);
    this.loadNearMaps();
    this.belts.material.uniforms.uYears.value = this.years;
    this.belts.material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();

    if (this.approach && !driven) {
      this.updateApproach(dt);
    } else if (!driven) {
      this.updateFollow(dt);
      this.updateTour(dt);
      this.controls.update();
    }
    this.updateWarp(dt);
    this.stepDate = dt;
  }

  /** Starts a body's spacecraft maps loading the first time it is big enough on screen to show them. */
  loadNearMaps() {
    if (!this.pendingMaps.length) return;
    const pxPerUnit = this.size.y / (2 * Math.tan((this.camera.fov * DEG) / 2));
    this.pendingMaps = this.pendingMaps.filter(({ body, entry }) => {
      const distance = body.mesh.getWorldPosition(this._a).distanceTo(this.camera.position);
      if ((body.radius / distance) * pxPerUnit < PHOTO_PX) return true;
      this.applyMaps(body, entry).catch((err) => console.warn(`${body.name} map:`, err.message));
      return false;
    });
  }

  /**
   * Puts a body's spacecraft maps on it: the colour map (a greyscale one tinted
   * to the body's overall colour, gaps painted in), the Moon's relief, and
   * Earth's night lights and clouds.
   */
  async applyMaps(body, entry) {
    const load = async (map, colour = true) => {
      const texture = await this.loader.loadAsync(BODY_ROOT + map['2k'].file);
      texture.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.anisotropy = 4;
      return texture;
    };
    const { material } = body.mesh;
    const painted = material.map?.isCanvasTexture ? material.map.image : null;
    let map = await load(entry.maps.color);
    const tint = entry.grey && painted ? averageColour(painted) : [1, 1, 1];
    if (painted && !(entry.imaged >= MOSTLY_SEEN)) {
      const photo = map;
      map = fillUnseen(photo.image, painted, tint);
      photo.dispose();
    } else {
      material.color.setRGB(...tint, THREE.SRGBColorSpace);
    }
    const old = material.map;
    material.map = map;
    old?.dispose();
    if (entry.maps.normal) {
      material.normalMap = await load(entry.maps.normal, false);
      material.normalScale.setScalar(MOON_RELIEF);
    }
    if (entry.maps.night) {
      material.emissiveMap = await load(entry.maps.night);
      material.emissive.set(0xffffff);
      material.onBeforeCompile = nightSideOnly;
    }
    if (entry.maps.clouds && body.clouds) {
      const clouds = body.clouds.material;
      clouds.alphaMap?.dispose();
      clouds.alphaMap = await load(entry.maps.clouds, false);
      clouds.needsUpdate = true;
    }
    material.needsUpdate = true;
  }

  /** Renders into whatever target is bound, and lays out the labels. */
  draw() {
    this.sky.group.position.copy(this.camera.position);
    this.dust.material.uniforms.uCam.value.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
    this.layoutLabels();
    this.updateDate(this.stepDate);
  }

  updateApproach(dt) {
    const a = this.approach;
    a.t = Math.min(1, a.t + dt / APPROACH_SECONDS);
    const e = 1 - (1 - a.t) ** 3;
    this.camera.position.lerpVectors(a.from, a.to, e);
    // A banked arc rather than a straight line.
    this.camera.position.x += Math.sin(Math.PI * e) * 260;
    this.controls.target.set(0, 0, 0);
    this.camera.lookAt(0, 0, 0);
    if (a.t >= 1) {
      this.approach = null;
      this.controls.enabled = true;
    }
  }

  updateFollow(dt) {
    const follow = this.follow;
    if (!follow) return;
    const at = this.positionOf(follow.body, this._p);

    if (follow.t < 1) {
      follow.t = Math.min(1, follow.t + dt / follow.duration);
      const e = follow.t < 0.5 ? 4 * follow.t ** 3 : 1 - (-2 * follow.t + 2) ** 3 / 2;
      this.controls.target.lerpVectors(follow.fromTarget, at, e);
      this.camera.position.lerpVectors(follow.fromCam, this._q.copy(at).add(follow.offset), e);
    } else {
      // Carry the camera along by however far the body moved, so the view the
      // user has orbited to is kept.
      this.camera.position.add(this._q.copy(at).sub(follow.last));
      this.controls.target.copy(at);
    }
    follow.last.copy(at);
  }

  updateTour(dt) {
    if (!this.tour || (this.follow && this.follow.t < 1)) return;
    this.tour.wait += dt;
    if (this.tour.wait >= TOUR_DWELL) this.nextStop();
  }

  /**
   * How fast the camera is really moving decides how hard the stars streak,
   * and where it is heading decides which way.
   */
  updateWarp(dt) {
    const cam = this.camera.position;
    const delta = this._a.copy(cam).sub(this.lastCam);
    const speed = delta.length() / Math.max(dt, 1e-3);
    this.lastCam.copy(cam);
    const target = THREE.MathUtils.clamp((speed - 12) / 380, 0, 1);
    this.warp += (target - this.warp) * (1 - Math.exp(-dt * 6));

    let sign = 1;
    if (speed > 1e-3) {
      delta.normalize();
      const forward = this.camera.getWorldDirection(this._q);
      sign = delta.dot(forward) >= 0 ? 1 : -1;
      const p = this._q.copy(cam).addScaledVector(delta, sign * 50).project(this.camera);
      this.focusNdc.set(THREE.MathUtils.clamp(p.x, -30, 30), THREE.MathUtils.clamp(p.y, -30, 30));
    }
    const pixelRatio = this.renderer.getPixelRatio();
    setWarp(this.sky.material, this.warp, this.focusNdc, sign, pixelRatio);
    setWarp(this.dust.material, this.warp, this.focusNdc, sign, pixelRatio);
  }

  /** Labels for everything in view, highest priority first, none overlapping. */
  layoutLabels() {
    const { x: width, y: height } = this.size;
    const cam = this.camera.position;
    const candidates = [];

    for (const body of this.bodies) {
      body.placed = false;
      // A moon's label only shows once you are close to its planet.
      if (body.parent && cam.distanceTo(body.parent.mesh.getWorldPosition(this._a)) > body.parent.radius * 14 + 4) continue;
      const p = this.positionOf(body, this._p);
      if (body.radius) p.addScaledVector(this.camera.up, body.radius * 1.2);
      p.project(this.camera);
      if (p.z > 1 || p.z < -1 || Math.abs(p.x) > 1.05 || Math.abs(p.y) > 1.05) continue;
      const focused = body === this.selected || body === this.follow?.body;
      candidates.push({ body, x: (p.x * 0.5 + 0.5) * width, y: (-p.y * 0.5 + 0.5) * height, rank: PRIORITY[body.kind] + (focused ? 1000 : 0) });
    }

    candidates.sort((a, b) => b.rank - a.rank);
    const taken = [];
    for (const { body, x, y } of candidates) {
      const half = (body.name.length * 6.4 + 20) / 2;
      const box = { l: x - half, r: x + half, t: y - 22, b: y };
      if (taken.some((o) => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t)) continue;
      taken.push(box);
      body.placed = true;
      body.label.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, -100%)`;
      body.label.classList.toggle('following', body === this.follow?.body || body === this.selected);
    }

    for (const body of this.bodies) {
      if (body.shown === body.placed) continue;
      body.shown = body.placed;
      body.label.style.visibility = body.placed ? 'visible' : 'hidden';
    }
  }

  updateDate(dt) {
    this.dateClock -= dt;
    if (this.dateClock > 0) return;
    this.dateClock = 0.25;
    const date = new Date((START_YEAR + this.years - 1970) * MS_PER_YEAR);
    const speed = this.timeScale === 0 ? 'paused' : `1 year every ${EARTH_YEAR_SECONDS / this.timeScale} s`;
    this.dateEl.textContent = `${Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)} · ${speed}`;
  }
}
