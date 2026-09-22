import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const TEXTURE_ROOT = `${import.meta.env.BASE_URL}textures/solar/`;
const DEG = Math.PI / 180;

// One Earth year of simulated time per this many seconds.
const EARTH_YEAR_SECONDS = 30;
// Real sizes and distances cannot share a screen — at true scale every planet
// is sub-pixel. Both are compressed by a power law so the order and the
// proportions still read: Jupiter is still the giant, Neptune still far out.
const displayRadius = (earthRadii) => 0.55 * earthRadii ** 0.55;
const displayOrbit = (au) => 8 + 13 * au ** 0.62;
// Real day lengths span 0.4 to 243 days; spin is compressed the same way so
// Venus still barely turns and Jupiter still whips round.
const spinSeconds = (days) => 8 * days ** 0.35;
const SUN_RADIUS = 4.2;

/*
 * Mean orbital elements (J2000, JPL approximate elements). `L0` and `rate` give
 * the mean longitude in degrees and degrees per Julian century, so each planet
 * starts where it actually is today. Orbits are drawn circular.
 * Retrograde spin is expressed by the tilt (Venus 177°, Uranus 98°), not by a
 * negative day.
 */
const PLANETS = [
  { name: 'Mercury', radius: 0.383, au: 0.387, period: 0.2408, day: 58.65, tilt: 0.03, incl: 7.0, node: 48.33, L0: 252.2503, rate: 149472.6741, colour: [140, 134, 128], texture: 'mercury.jpg' },
  { name: 'Venus', radius: 0.949, au: 0.723, period: 0.6152, day: 243.0, tilt: 177.4, incl: 3.39, node: 76.68, L0: 181.9791, rate: 58517.8154, colour: [232, 205, 160], texture: 'venus.jpg' },
  { name: 'Earth', radius: 1.0, au: 1.0, period: 1.0, day: 0.997, tilt: 23.44, incl: 0, node: 0, L0: 100.4646, rate: 35999.3724, colour: [47, 111, 181], texture: 'earth.jpg', clouds: 'earth_clouds.jpg' },
  { name: 'Mars', radius: 0.532, au: 1.524, period: 1.8808, day: 1.026, tilt: 25.19, incl: 1.85, node: 49.56, L0: -4.5534, rate: 19140.3027, colour: [181, 83, 42], texture: 'mars.jpg' },
  { name: 'Jupiter', radius: 11.21, au: 5.203, period: 11.862, day: 0.414, tilt: 3.13, incl: 1.3, node: 100.47, L0: 34.3964, rate: 3034.7461, colour: [201, 162, 122], texture: 'jupiter.jpg' },
  { name: 'Saturn', radius: 9.45, au: 9.537, period: 29.457, day: 0.444, tilt: 26.73, incl: 2.49, node: 113.66, L0: 49.9542, rate: 1222.4936, colour: [227, 211, 163], texture: 'saturn.jpg', rings: true },
  { name: 'Uranus', radius: 4.01, au: 19.19, period: 84.011, day: 0.718, tilt: 97.77, incl: 0.77, node: 74.02, L0: 313.2381, rate: 428.482, colour: [166, 225, 232], texture: 'uranus.jpg' },
  { name: 'Neptune', radius: 3.88, au: 30.07, period: 164.79, day: 0.671, tilt: 28.32, incl: 1.77, node: 131.78, L0: -55.12, rate: 218.4595, colour: [75, 112, 221], texture: 'neptune.jpg' }
];

/** Julian centuries since J2000, for today's planet positions. */
const centuriesSinceJ2000 = () => (Date.now() / 86400000 + 2440587.5 - 2451545.0) / 36525;

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(width, height, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Stand-in surface for a body whose map is missing: its real colour, mottled,
 * with craters for the airless rocky ones and ice caps for Mars.
 */
function proceduralSurface({ name, colour: [r, g, b] }) {
  const rand = mulberry32(name.length * 7919);
  return canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const shade = rand() < 0.5 ? 0 : 255;
      ctx.fillStyle = `rgba(${shade},${shade},${shade},${0.03 + rand() * 0.05})`;
      ctx.beginPath();
      ctx.arc(rand() * w, rand() * h, 4 + rand() * 30, 0, Math.PI * 2);
      ctx.fill();
    }
    if (name === 'Mercury') {
      for (let i = 0; i < 160; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const radius = 1.5 + rand() ** 3 * 14;
        ctx.strokeStyle = 'rgba(40,36,32,0.45)';
        ctx.lineWidth = 1 + radius * 0.15;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (name === 'Mars') {
      ctx.fillStyle = 'rgba(90,40,24,0.55)';
      for (let i = 0; i < 40; i++) {
        ctx.beginPath();
        ctx.ellipse(rand() * w, h * (0.3 + rand() * 0.4), 10 + rand() * 45, 5 + rand() * 18, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(245,240,235,0.9)';
      ctx.fillRect(0, 0, w, h * 0.05);
      ctx.fillRect(0, h * 0.96, w, h * 0.04);
    }
  });
}

/** Radial profile of Saturn's rings, faint C ring to the Encke gap, Cassini division and all. */
function saturnRingTexture() {
  // Band edges as fractions of the ring's width (C ring 1.24 R to A ring 2.27 R).
  const bands = [
    [0.0, 0.27, 'rgba(160,140,115,0.25)'],
    [0.27, 0.69, 'rgba(226,208,175,0.92)'],
    [0.69, 0.75, 'rgba(40,34,28,0.08)'],
    [0.75, 0.93, 'rgba(205,188,158,0.78)'],
    [0.93, 0.945, 'rgba(40,34,28,0.1)'],
    [0.945, 1.0, 'rgba(195,178,150,0.7)']
  ];
  const texture = canvasTexture(1024, 8, (ctx, w, h) => {
    for (const [from, to, fill] of bands) {
      ctx.fillStyle = fill;
      ctx.fillRect(from * w, 0, (to - from) * w, h);
    }
    const rand = mulberry32(42);
    for (let x = 0; x < w; x++) {
      ctx.fillStyle = `rgba(0,0,0,${rand() * 0.18})`;
      ctx.fillRect(x, 0, 1, h);
    }
  });
  return texture;
}

function glowTexture(inner, outer) {
  return canvasTexture(256, 256, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.35, outer);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

/**
 * Background stars, and the Milky Way itself as a band across them: we are
 * inside it now, so it wraps the whole sky, tilted 60° to the planets' plane.
 */
function starfield() {
  const rand = mulberry32(7);
  const count = 14000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const radius = 2500;
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 60.2 * DEG);
  const v = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const inBand = i < count * 0.6;
    const lon = rand() * Math.PI * 2;
    // Band stars hug the galactic plane; the rest spread uniformly.
    const lat = inBand
      ? (rand() + rand() + rand() - 1.5) * 0.18
      : Math.asin(2 * rand() - 1);
    v.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
    if (inBand) v.applyQuaternion(tilt);
    v.multiplyScalar(radius);
    positions.set([v.x, v.y, v.z], i * 3);

    const warm = rand();
    const brightness = inBand ? 0.35 + rand() * 0.45 : 0.45 + rand() ** 3 * 0.55;
    colors.set([
      brightness * (warm > 0.7 ? 1 : 0.85),
      brightness * 0.9,
      brightness * (warm < 0.3 ? 1 : 0.8)
    ], i * 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 2.8,
    sizeAttenuation: false,
    vertexColors: true,
    map: glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.35)'),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }));
}

async function loadTexture(loader, file, { data = false } = {}) {
  if (!file) return null;
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

/**
 * The Sun, the eight planets and the stars, reached by zooming into the Milky
 * Way. Planets start at their real positions for today's date and orbit at
 * their real relative periods, on their real inclinations and axial tilts;
 * sizes and distances are compressed so they fit one screen.
 *
 * It owns its own scene, camera and OrbitControls but borrows the map's
 * renderer and canvas; MilkyWayPortal decides which of the two is drawn.
 */
export class SolarSystem {
  constructor(renderer, container) {
    this.renderer = renderer;
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x010104);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 8000);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 900;
    this.controls.enabled = false;

    this.bodies = [];
    this.follow = null;
    this.size = new THREE.Vector2();
    this._p = new THREE.Vector3();
    this._q = new THREE.Vector3();
    this.loaded = null;

    this.renderDOM();
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
          <span>Inside the Milky Way · planets where they are today</span>
        </div>
      </div>
      <div class="solar-labels"></div>
      <p class="solar-hint">Drag to orbit · scroll or pinch to zoom · tap a name to follow it</p>
      <p class="solar-credit">Sizes and distances compressed to fit.
        Planet maps: <a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noopener noreferrer">Solar System Scope</a>, CC BY 4.0</p>
    `;
    this.labelRoot = this.root.querySelector('.solar-labels');
    this.root.querySelector('[data-solar="exit"]').addEventListener('click', () => this.onExit?.());
    this.container.appendChild(this.root);
  }

  /** Builds everything once; later entries reuse it. */
  load() {
    this.loaded ??= this.build();
    return this.loaded;
  }

  async build() {
    const loader = new THREE.TextureLoader();
    const [sunMap, ...maps] = await Promise.all([
      loadTexture(loader, 'sun.jpg'),
      ...PLANETS.flatMap((p) => [loadTexture(loader, p.texture), loadTexture(loader, p.clouds, { data: true })])
    ]);

    // Rides with the camera, so the sky stays at infinity however far you zoom out.
    this.stars = starfield();
    this.scene.add(this.stars);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.09));
    this.scene.add(new THREE.PointLight(0xfff4e0, 3.2, 0, 0));

    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(SUN_RADIUS, 64, 32),
      new THREE.MeshBasicMaterial(sunMap ? { map: sunMap } : { color: 0xffc350 })
    );
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture('rgba(255,236,190,0.95)', 'rgba(255,170,60,0.28)'),
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    glow.scale.setScalar(SUN_RADIUS * 7);
    sun.add(glow);
    this.scene.add(sun);
    this.addBody({ name: 'Sun', mesh: sun, spin: (2 * Math.PI) / spinSeconds(25.4), radius: SUN_RADIUS });

    const T = centuriesSinceJ2000();
    PLANETS.forEach((planet, i) => {
      const map = maps[i * 2] ?? proceduralSurface(planet);
      const clouds = maps[i * 2 + 1];
      this.addPlanet(planet, map, clouds, T);
    });
  }

  addPlanet(planet, map, clouds, T) {
    const radius = displayRadius(planet.radius);
    const orbit = displayOrbit(planet.au);

    // Line of nodes, then inclination about it, then the circular orbit.
    const pivot = new THREE.Object3D();
    pivot.rotation.y = planet.node * DEG;
    const plane = new THREE.Object3D();
    plane.rotation.x = planet.incl * DEG;
    pivot.add(plane);
    this.scene.add(pivot);

    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 256 }, (_, k) => {
          const a = (k / 256) * Math.PI * 2;
          return new THREE.Vector3(Math.cos(a) * orbit, 0, -Math.sin(a) * orbit);
        })
      ),
      new THREE.LineBasicMaterial({ color: 0x4a6a9a, transparent: true, opacity: 0.28 })
    );
    plane.add(ring);

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

    if (clouds) {
      mesh.add(new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.015, segments, segments / 2),
        new THREE.MeshStandardMaterial({ alphaMap: clouds, transparent: true, depthWrite: false, roughness: 1 })
      ));
    }

    if (planet.rings) {
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
      tilt.add(rings);
    }

    const angle = (planet.L0 + planet.rate * T - planet.node) * DEG;
    this.addBody({
      name: planet.name,
      mesh,
      carrier,
      orbit,
      radius,
      angle,
      orbitSpeed: (2 * Math.PI) / (planet.period * EARTH_YEAR_SECONDS),
      spin: (2 * Math.PI) / spinSeconds(planet.day)
    });
  }

  addBody(body) {
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'solar-label';
    label.textContent = body.name;
    label.addEventListener('click', () => this.focusOn(body));
    this.labelRoot.appendChild(label);
    body.label = label;
    this.bodies.push(body);
    this.placeBody(body);
  }

  placeBody(body) {
    if (!body.carrier) return;
    body.carrier.position.set(Math.cos(body.angle) * body.orbit, 0, -Math.sin(body.angle) * body.orbit);
  }

  /** Swings the camera to a body and then rides along with it. */
  focusOn(body) {
    const at = body.mesh.getWorldPosition(new THREE.Vector3());
    const away = this.camera.position.clone().sub(this.controls.target).normalize();
    const distance = body.name === 'Sun' ? 150 : body.radius * 9 + 3;
    this.follow = {
      body,
      t: 0,
      fromCam: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      offset: away.multiplyScalar(distance),
      last: at
    };
  }

  enter() {
    this.root.hidden = false;
    this.controls.enabled = true;
    this.follow = null;
    // A portrait screen is narrow: start further back so the outer planets fit.
    this.renderer.getSize(this.size);
    const back = this.size.x < this.size.y ? 1.9 : 1;
    this.camera.position.set(0, 70 * back, 150 * back);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  exit() {
    this.root.hidden = true;
    this.controls.enabled = false;
    this.follow = null;
  }

  update(dt) {
    this.renderer.getSize(this.size);
    const aspect = this.size.x / Math.max(this.size.y, 1);
    if (Math.abs(this.camera.aspect - aspect) > 1e-4) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }

    for (const body of this.bodies) {
      body.mesh.rotation.y += body.spin * dt;
      if (body.carrier) {
        body.angle += body.orbitSpeed * dt;
        this.placeBody(body);
      }
    }

    this.updateFollow(dt);
    this.controls.update();
    this.stars?.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
    this.layoutLabels();
  }

  updateFollow(dt) {
    const follow = this.follow;
    if (!follow) return;
    const at = follow.body.mesh.getWorldPosition(this._p);

    if (follow.t < 1) {
      follow.t = Math.min(1, follow.t + dt / 1.4);
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

  layoutLabels() {
    const { x: width, y: height } = this.size;
    for (const body of this.bodies) {
      const p = body.mesh.getWorldPosition(this._p);
      // Lift the label to the top of the body on screen.
      const up = this._q.copy(p).addScaledVector(this.camera.up, body.radius * 1.25).project(this.camera);
      if (up.z > 1 || up.z < -1) {
        body.label.style.visibility = 'hidden';
        continue;
      }
      body.label.style.visibility = 'visible';
      body.label.classList.toggle('following', this.follow?.body === body);
      body.label.style.transform =
        `translate3d(${Math.round((up.x * 0.5 + 0.5) * width)}px, ${Math.round((-up.y * 0.5 + 0.5) * height)}px, 0) translate(-50%, -100%)`;
    }
  }
}
