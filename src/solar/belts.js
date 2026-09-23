import * as THREE from 'three';
import { DEG, displayOrbit, BELTS } from './data.js';
import { mulberry32 } from './textures.js';

/*
 * Every belt particle on its own circular Keplerian orbit, moved on the GPU:
 * inner asteroids overtake outer ones, the Trojans keep pace with Jupiter,
 * and the Kuiper Belt barely creeps. Positions come from the orbit elements
 * and the simulated year, in the same ecliptic frame the planets use.
 */
const VERTEX = `
attribute float aRadius;
attribute float aPhase;
attribute float aRate;
attribute float aIncl;
attribute float aNode;
attribute float aSize;
attribute vec3 aColor;
uniform float uYears;
uniform float uPixelRatio;
varying vec3 vColor;
void main() {
  float u = aPhase + aRate * uYears - aNode;
  float ci = cos(aIncl), si = sin(aIncl), cn = cos(aNode), sn = sin(aNode), cu = cos(u), su = sin(u);
  vec3 ecl = aRadius * vec3(cn * cu - sn * su * ci, sn * cu + cn * su * ci, su * si);
  vec4 mv = modelViewMatrix * vec4(ecl.x, ecl.z, -ecl.y, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixelRatio * clamp(90.0 / -mv.z, 0.55, 3.0);
  vColor = aColor;
}`;

const FRAGMENT = `
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = exp(-d * d * 3.0);
  if (a < 0.03) discard;
  gl_FragColor = vec4(vColor, a);
}`;

// Resonances with Jupiter clear these distances (AU) of asteroids.
const KIRKWOOD_GAPS = [2.502, 2.825, 2.958, 3.279];

/**
 * The asteroid belt with its Kirkwood gaps, Jupiter's Trojans, the Kuiper
 * Belt, the zodiacal dust and — not to scale — the Oort Cloud, as one point
 * cloud. `jupiterLongitude(years)` places the Trojans 60° either side of it.
 */
export function createBelts({ pixelRatio, jupiterStart, jupiterRate }) {
  const rand = mulberry32(2026);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-9))) * Math.cos(2 * Math.PI * rand());
  const attrs = { aRadius: [], aPhase: [], aRate: [], aIncl: [], aNode: [], aSize: [], aColor: [] };
  const keplerRate = (au) => (2 * Math.PI) / au ** 1.5; // rad per year

  const add = (au, { phase = rand() * Math.PI * 2, rate = keplerRate(au), incl, node = rand() * Math.PI * 2, size, colour, radius = displayOrbit(au) }) => {
    attrs.aRadius.push(radius);
    attrs.aPhase.push(phase);
    attrs.aRate.push(rate);
    attrs.aIncl.push(incl);
    attrs.aNode.push(node);
    attrs.aSize.push(size);
    attrs.aColor.push(...colour);
  };
  const rock = (k) => [0.78 * k, 0.72 * k, 0.64 * k];

  // Main belt, 2.1–3.3 AU, thinned out at the Kirkwood gaps.
  for (let placed = 0; placed < 7000;) {
    const au = 2.1 + (rand() + rand()) * 0.6;
    if (KIRKWOOD_GAPS.some((gap) => Math.abs(au - gap) < 0.022) && rand() < 0.92) continue;
    add(au, { incl: Math.min(Math.abs(gauss()) * 7, 25) * DEG, size: 0.9 + rand() * 1.1, colour: rock(0.35 + rand() * 0.3) });
    placed++;
  }

  // Trojans: bunched 60° ahead of and behind Jupiter, moving at its pace.
  for (let i = 0; i < 1600; i++) {
    const side = i % 2 ? 1 : -1;
    add(5.2 + gauss() * 0.12, {
      phase: jupiterStart + side * 60 * DEG + gauss() * 11 * DEG,
      rate: jupiterRate,
      incl: Math.min(Math.abs(gauss()) * 11, 35) * DEG,
      size: 0.9 + rand() * 1.0,
      colour: rock(0.28 + rand() * 0.25).map((c, k) => c * (k === 0 ? 1.1 : 0.95))
    });
  }

  // Kuiper Belt: the cold classical core at 42–47.5 AU, the Plutinos locked at
  // 39.4 AU with Neptune, and a sparse scattered disc beyond.
  for (let i = 0; i < 6000; i++) {
    const pick = rand();
    const au = pick < 0.6 ? 42 + rand() * 5.5 : pick < 0.8 ? 39.4 + gauss() * 0.25 : 30 + rand() * 30;
    const hot = pick >= 0.6 || rand() < 0.35;
    const k = 0.25 + rand() * 0.3;
    add(au, {
      incl: Math.abs(gauss()) * (hot ? 12 : 2.5) * DEG,
      size: 1.0 + rand() * 1.1,
      colour: rand() < 0.5 ? [k * 0.9, k * 0.8, k * 0.75] : [k * 0.8, k * 0.86, k]
    });
  }

  // Zodiacal dust: a faint warm disc, densest near the Sun.
  for (let i = 0; i < 3000; i++) {
    const au = 0.15 + 3.4 * rand() ** 1.8;
    const k = 0.05 + rand() * 0.06;
    add(au, { incl: Math.abs(gauss()) * 3 * DEG, size: 1.6 + rand() * 1.8, colour: [k, k * 0.9, k * 0.72] });
  }

  // Oort Cloud: a spherical shell, drawn at a sliver of its real distance
  // (2,000–100,000 AU would sit far outside the camera's reach).
  for (let i = 0; i < 4500; i++) {
    const k = 0.1 + rand() * 0.18;
    add(0, {
      radius: 1250 + 850 * Math.cbrt(rand()),
      rate: 0,
      incl: Math.acos(1 - 2 * rand()),
      size: 1.2 + rand() * 1.2,
      colour: [k * 0.85, k * 0.92, k]
    });
  }

  const geometry = new THREE.BufferGeometry();
  // three wants a position attribute to size draw calls; the shader ignores it.
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(attrs.aRadius.length * 3), 3));
  for (const [name, values] of Object.entries(attrs)) {
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, name === 'aColor' ? 3 : 1));
  }
  const material = new THREE.ShaderMaterial({
    uniforms: { uYears: { value: 0 }, uPixelRatio: { value: pixelRatio } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  const at = (au, lonDeg, out) => {
    const r = displayOrbit(au);
    return out.set(Math.cos(lonDeg * DEG) * r, 0, -Math.sin(lonDeg * DEG) * r);
  };
  // Where each region's label sits: toward the opening camera, or riding
  // along with Jupiter for the Trojans.
  const regions = [
    { ...BELTS.asteroid, anchor: (years, out) => at(2.75, 262, out) },
    { ...BELTS.kuiper, anchor: (years, out) => at(44, 275, out) },
    { ...BELTS.zodiacal, anchor: (years, out) => at(1.25, 300, out).setY(0.4) },
    { ...BELTS.oort, anchor: (years, out) => out.set(0, 900, 1500) },
    {
      ...BELTS.trojans,
      anchor: (years, out) => {
        const lon = jupiterStart + jupiterRate * years + 60 * DEG;
        const r = displayOrbit(5.2);
        return out.set(Math.cos(lon) * r, 0, -Math.sin(lon) * r);
      }
    }
  ];

  return { points, material, regions };
}
