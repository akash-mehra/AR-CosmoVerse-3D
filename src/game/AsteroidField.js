import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { DEG, displayOrbit } from '../solar/data.js';
import { KIRKWOOD_GAPS } from '../solar/belts.js';
import { mulberry32 } from '../solar/textures.js';
import { SHIP_LENGTH } from './tuning.js';

// The main belt, as the point belt draws it: 2.15–3.3 AU, thinned at the Kirkwood gaps.
const INNER_AU = 2.15;
const OUTER_AU = 3.3;
// Wider than the real gaps (0.022 AU), so a skilled pilot can fly the lanes.
const GAP_HALF_AU = 0.03;
const GAP_CLEARED = 0.95;
// Thin, so the belt is dense and there is open space above and below it.
const INCLINATION_SIGMA = 0.8 * DEG;
const MAX_INCLINATION = 4 * DEG;
// Rock diameters in ship lengths: mostly small, a few moonlets.
const MIN_SIZE = 1;
const MAX_SIZE = 30;
const SIZE_POWER = 2.6;
const VARIANTS = 7;
// Collision uses a sphere a little inside each rock's furthest point, since rocks are lumpy.
const HIT_SHARE = 0.8;
// Where the score counts the ship as in the belt: within this height of the ecliptic.
const BELT_HALF_HEIGHT = 1.2;
const RESPAWN_S = 25;
const RESPAWN_CLEARANCE = 1.5;

// C, S and M types (dark carbonaceous, stony, metallic), about as common as in the real belt.
const TYPES = [
  { upTo: 0.75, colour: [0.3, 0.29, 0.28] },
  { upTo: 0.92, colour: [0.58, 0.49, 0.41] },
  { upTo: 1, colour: [0.62, 0.62, 0.64] }
];

const yieldToFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

/** First index whose value is at least `value`, in an ascending array. */
function lowerBound(values, value) {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * A lumpy rock of about unit radius. Displaced after merging, as a function
 * of direction only, so there are no cracks; speckled through vertex colours.
 */
function rockGeometry(rand, detail) {
  let geometry = new THREE.IcosahedronGeometry(1, detail);
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  geometry = mergeVertices(geometry);

  const bumps = Array.from({ length: 6 }, (_, k) => ({
    dir: new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize(),
    freq: 1.5 + rand() * 3.5,
    amp: (0.16 - k * 0.018) * (0.7 + rand() * 0.6),
    phase: rand() * Math.PI * 2
  }));
  const stretch = new THREE.Vector3(0.75 + rand() * 0.5, 0.65 + rand() * 0.45, 0.8 + rand() * 0.5);
  const pos = geometry.attributes.position;
  const colours = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  let reach = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let s = 1;
    for (const b of bumps) s += b.amp * Math.sin(v.dot(b.dir) * b.freq + b.phase);
    const speckle = 0.72 + 0.28 * Math.sin(v.dot(bumps[0].dir) * 9 + bumps[1].phase) * Math.sin(v.dot(bumps[2].dir) * 7);
    v.multiplyScalar(s).multiply(stretch);
    pos.setXYZ(i, v.x, v.y, v.z);
    reach = Math.max(reach, v.length());
    colours.set([speckle, speckle * 0.97, speckle * 0.93], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, reach };
}

/*
 * The vertex stage places every rock on its circular Keplerian orbit from the
 * simulated year, exactly as belts.js places the point belt, and tumbles it
 * about its own axis. The CPU runs the same formula only for rocks near the ship.
 */
const VERTEX_HEAD = `
attribute vec4 aOrbit;
attribute vec4 aSpin;
attribute vec2 aShape;
attribute float aAlive;
uniform float uYears;
uniform float uSpinTime;
vec3 spinAbout(vec3 v, vec3 k, float a) {
  float c = cos(a);
  float s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}`;

const VERTEX_PLACE = `
float tumble = aSpin.w * uSpinTime + aOrbit.y * 7.0;
vec3 transformed = spinAbout(position, aSpin.xyz, tumble) * (aShape.x * aAlive);
float node = aShape.y;
float u = aOrbit.y + aOrbit.z * uYears - node;
float ci = cos(aOrbit.w), si = sin(aOrbit.w), cn = cos(node), sn = sin(node), cu = cos(u), su = sin(u);
vec3 ecl = aOrbit.x * vec3(cn * cu - sn * su * ci, sn * cu + cn * su * ci, su * si);
transformed += vec3(ecl.x, ecl.z, -ecl.y);`;

/**
 * The asteroid belt at the ship's scale: thousands of real rocks, one to
 * thirty ship lengths across, on the belt's own orbits, with the Kirkwood gaps
 * left as flyable lanes. Drawn as instanced meshes whose orbits run on the
 * GPU; rocks are kept sorted by orbit radius so the few near the ship are
 * found by a binary search rather than by checking them all.
 */
export class AsteroidField {
  static async build({ count, detail, seed = 2061 }, onProgress) {
    const field = new AsteroidField();
    await field.generate(count, detail, seed, onProgress);
    return field;
  }

  constructor() {
    this.group = new THREE.Group();
    this.uniforms = { uYears: { value: 0 }, uSpinTime: { value: 0 } };
    this.dead = new Map();
    this.meshes = [];
    this.count = 0;
    this._p = new THREE.Vector3();
    this._q = new THREE.Vector3();

    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0.05 });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uYears = this.uniforms.uYears;
      shader.uniforms.uSpinTime = this.uniforms.uSpinTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
        .replace('#include <begin_vertex>', VERTEX_PLACE);
    };
  }

  async generate(count, detail, seed, onProgress) {
    const rand = mulberry32(seed);
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-9))) * Math.cos(2 * Math.PI * rand());

    const shapes = [];
    for (let v = 0; v < VARIANTS; v++) {
      shapes.push(rockGeometry(rand, detail));
      onProgress?.((0.5 * (v + 1)) / VARIANTS);
      await yieldToFrame();
    }

    const rows = [];
    while (rows.length < count) {
      const au = INNER_AU + (rand() + rand()) * 0.5 * (OUTER_AU - INNER_AU);
      if (KIRKWOOD_GAPS.some((gap) => Math.abs(au - gap) < GAP_HALF_AU) && rand() < GAP_CLEARED) continue;
      const size = MIN_SIZE + (MAX_SIZE - MIN_SIZE) * rand() ** SIZE_POWER;
      const pick = rand();
      const axis = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
      if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0);
      axis.normalize();
      rows.push({
        radius: displayOrbit(au),
        phase: rand() * Math.PI * 2,
        // Kepler's third law, in radians per simulated year, as the point belt uses.
        rate: (2 * Math.PI) / au ** 1.5,
        incl: Math.min(Math.abs(gauss()) * INCLINATION_SIGMA, MAX_INCLINATION),
        node: rand() * Math.PI * 2,
        scale: (size * SHIP_LENGTH) / 2,
        variant: Math.floor(rand() * VARIANTS),
        colour: TYPES.find((t) => pick <= t.upTo).colour,
        tint: 0.85 + rand() * 0.3,
        axis,
        // Big rocks turn slowly.
        spin: ((0.15 + rand() * 0.9) * (rand() < 0.5 ? -1 : 1)) / Math.sqrt(size)
      });
    }
    rows.sort((a, b) => a.radius - b.radius);
    onProgress?.(0.75);
    await yieldToFrame();

    const n = rows.length;
    this.count = n;
    this.radius = new Float32Array(n);
    this.phase = new Float32Array(n);
    this.rate = new Float32Array(n);
    this.incl = new Float32Array(n);
    this.node = new Float32Array(n);
    this.reach = new Float32Array(n);
    this.variant = new Uint8Array(n);
    this.slot = new Uint32Array(n);
    this.alive = new Uint8Array(n).fill(1);

    const members = shapes.map(() => []);
    rows.forEach((row, i) => {
      this.radius[i] = row.radius;
      this.phase[i] = row.phase;
      this.rate[i] = row.rate;
      this.incl[i] = row.incl;
      this.node[i] = row.node;
      this.variant[i] = row.variant;
      this.slot[i] = members[row.variant].length;
      members[row.variant].push(i);
    });

    const identity = new THREE.Matrix4();
    const colour = new THREE.Color();
    this.meshes = shapes.map(({ geometry, reach }, v) => {
      const list = members[v];
      const m = list.length;
      if (m === 0) return null;
      const orbit = new Float32Array(m * 4);
      const spin = new Float32Array(m * 4);
      const shape = new Float32Array(m * 2);
      const alive = new Float32Array(m).fill(1);
      list.forEach((i, s) => {
        const row = rows[i];
        orbit.set([row.radius, row.phase, row.rate, row.incl], s * 4);
        spin.set([row.axis.x, row.axis.y, row.axis.z, row.spin], s * 4);
        shape.set([row.scale, row.node], s * 2);
        this.reach[i] = row.scale * reach * HIT_SHARE;
      });
      geometry.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(orbit, 4));
      geometry.setAttribute('aSpin', new THREE.InstancedBufferAttribute(spin, 4));
      geometry.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape, 2));
      const aliveAttribute = new THREE.InstancedBufferAttribute(alive, 1);
      aliveAttribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aAlive', aliveAttribute);

      const mesh = new THREE.InstancedMesh(geometry, this.material, m);
      list.forEach((i, s) => {
        mesh.setMatrixAt(s, identity);
        const row = rows[i];
        colour.setRGB(row.colour[0] * row.tint, row.colour[1] * row.tint, row.colour[2] * row.tint, THREE.SRGBColorSpace);
        mesh.setColorAt(s, colour);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      // The rocks are placed in the shader, so three's bounds (all at the origin) mean nothing.
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return { mesh, alive: aliveAttribute };
    });

    this.inner = this.radius[0];
    this.outer = this.radius[n - 1];
    // The largest collision radius: how wide a search has to reach to find every rock touching a point.
    this.maxReach = this.reach.reduce((max, r) => Math.max(max, r), 0);
    onProgress?.(1);
  }

  /** Where rock `i` is at `years`, into `out`: the shader's formula, in double precision. */
  positionOf(i, years, out) {
    const node = this.node[i];
    const incl = this.incl[i];
    const r = this.radius[i];
    const u = this.phase[i] + this.rate[i] * years - node;
    const ci = Math.cos(incl);
    const si = Math.sin(incl);
    const cn = Math.cos(node);
    const sn = Math.sin(node);
    const cu = Math.cos(u);
    const su = Math.sin(u);
    const ex = r * (cn * cu - sn * su * ci);
    const ey = r * (sn * cu + cn * su * ci);
    const ez = r * su * si;
    return out.set(ex, ez, -ey);
  }

  /** Velocity of rock `i`, into `out`, with simulated time running at `yearsPerSecond`. */
  velocityOf(i, years, yearsPerSecond, out) {
    const node = this.node[i];
    const incl = this.incl[i];
    const u = this.phase[i] + this.rate[i] * years - node;
    const ci = Math.cos(incl);
    const si = Math.sin(incl);
    const cn = Math.cos(node);
    const sn = Math.sin(node);
    const cu = Math.cos(u);
    const su = Math.sin(u);
    const k = this.radius[i] * this.rate[i] * yearsPerSecond;
    const dx = -cn * su - sn * cu * ci;
    const dy = -sn * su + cn * cu * ci;
    const dz = cu * si;
    return out.set(k * dx, k * dz, -k * dy);
  }

  /**
   * Calls `visit(i, position, distance)` for each live rock within `reach` of
   * `p`. A circular orbit keeps a rock at exactly its orbit radius from the
   * Sun, so only rocks whose radius is within `reach` of the ship's distance
   * can qualify. `position` is reused between calls: copy it to keep it.
   */
  near(p, reach, years, visit) {
    if (!this.count) return;
    const d = p.length();
    const end = lowerBound(this.radius, d + reach);
    const r2 = reach * reach;
    for (let i = lowerBound(this.radius, d - reach); i < end; i++) {
      if (!this.alive[i]) continue;
      const c = this.positionOf(i, years, this._p);
      const dist2 = c.distanceToSquared(p);
      if (dist2 < r2) visit(i, c, Math.sqrt(dist2));
    }
  }

  /** Whether `p` is in the belt, for the score's multiplier. */
  contains(p) {
    if (!this.count) return false;
    const d = p.length();
    return d >= this.inner && d <= this.outer && Math.abs(p.y) < BELT_HALF_HEIGHT;
  }

  setAlive(i, alive) {
    this.alive[i] = alive ? 1 : 0;
    const entry = this.meshes[this.variant[i]];
    const slot = this.slot[i];
    entry.alive.array[slot] = alive ? 1 : 0;
    entry.alive.addUpdateRange(slot, 1);
    entry.alive.needsUpdate = true;
  }

  /** Breaks rock `i` up; it comes back somewhere along its orbit later. */
  shatter(i, now) {
    if (!this.alive[i]) return;
    this.setAlive(i, false);
    this.dead.set(i, now + RESPAWN_S + (i % 17));
  }

  /** Per frame: the clock for the GPU, and any rock due back that is clear of the ship. */
  update(years, spinTime, now, ship) {
    this.uniforms.uYears.value = years;
    this.uniforms.uSpinTime.value = spinTime;
    for (const [i, at] of this.dead) {
      if (now < at) continue;
      if (this.positionOf(i, years, this._q).distanceTo(ship) < RESPAWN_CLEARANCE) {
        this.dead.set(i, now + 3);
        continue;
      }
      this.setAlive(i, true);
      this.dead.delete(i);
    }
  }

  resetAll() {
    for (const i of this.dead.keys()) this.setAlive(i, true);
    this.dead.clear();
  }
}
