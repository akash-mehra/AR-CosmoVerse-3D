import * as THREE from 'three';
import { galacticBasis, milkyWayObject } from '../data/milkyWay.js';

const KPC = 0.001; // Mpc
const COUNT = 42000;
const ARMS = 4;
const PITCH = (12 * Math.PI) / 180;
const BAR_ANGLE = (27 * Math.PI) / 180; // bar's long axis from the Sun–centre line
// Hidden beyond this camera distance, where it would collapse to one pixel
// that 42,000 additive points turn into a glaring dot over the Earth beacon.
const FADE_FAR = 4.0;
const FADE_NEAR = 1.2;

/** Deterministic, so the galaxy looks the same on every load. */
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function starSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/**
 * A barred spiral seen from outside: bulge and bar, four trailing log-spiral
 * arms, and a thin diffuse disc, laid out in the true galactic plane around the
 * true centre so the Sun (the map's origin) sits in the disc 8.2 kpc out. It is
 * an impression, not a star catalogue.
 */
export class MilkyWayModel {
  constructor() {
    const rand = mulberry32(20260922);
    const gauss = () => {
      const u = Math.max(rand(), 1e-9);
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
    };

    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const bulge = new THREE.Color(1.0, 0.82, 0.55);
    const armBlue = new THREE.Color(0.72, 0.82, 1.0);
    const disc = new THREE.Color(0.95, 0.9, 0.82);
    const hii = new THREE.Color(1.0, 0.45, 0.65);
    const colour = new THREE.Color();

    for (let i = 0; i < COUNT; i++) {
      let gx;
      let gy;
      let gz;
      const kind = rand();

      if (kind < 0.22) {
        // Bulge and bar: an elongated Gaussian, rotated off the Sun–centre line.
        const a = gauss() * 2.2;
        const b = gauss() * 0.9;
        gx = a * Math.cos(BAR_ANGLE) - b * Math.sin(BAR_ANGLE);
        gy = a * Math.sin(BAR_ANGLE) + b * Math.cos(BAR_ANGLE);
        gz = gauss() * 0.6;
        colour.copy(bulge);
      } else if (kind < 0.85) {
        // Arms. The galaxy turns clockwise seen from the north pole, so
        // trailing arms wind anticlockwise outward.
        const r = 3 + -Math.log(1 - rand() * 0.96) * 3.6;
        const arm = Math.floor(rand() * ARMS);
        const theta = (arm * 2 * Math.PI) / ARMS + Math.log(r / 3) / Math.tan(PITCH);
        const spread = 0.25 + r * 0.045;
        gx = r * Math.cos(theta) + gauss() * spread;
        gy = r * Math.sin(theta) + gauss() * spread;
        gz = gauss() * 0.12;
        colour.copy(rand() < 0.05 ? hii : armBlue);
      } else {
        const r = -Math.log(1 - rand() * 0.98) * 3.5;
        const theta = rand() * 2 * Math.PI;
        gx = r * Math.cos(theta);
        gy = r * Math.sin(theta);
        gz = gauss() * 0.25;
        colour.copy(disc);
      }

      positions[i * 3] = gx * KPC;
      positions[i * 3 + 1] = gy * KPC;
      positions[i * 3 + 2] = gz * KPC;
      // Additive blending: 42k points saturate to white unless each is faint.
      const shade = 0.22 + rand() * 0.38;
      colors[i * 3] = colour.r * shade;
      colors[i * 3 + 1] = colour.g * shade;
      colors[i * 3 + 2] = colour.b * shade;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.material = new THREE.PointsMaterial({
      size: 0.00026,
      map: starSprite(),
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.points = new THREE.Points(geometry, this.material);
    // Galactic frame (x toward the centre from the Sun, z to the north pole)
    // expressed in map coordinates, anchored at the centre.
    const { x, y, z } = galacticBasis();
    const centre = milkyWayObject().position;
    this.points.matrixAutoUpdate = false;
    this.points.matrix.set(
      x.x, y.x, z.x, centre.x,
      x.y, y.y, z.y, centre.y,
      x.z, y.z, z.z, centre.z,
      0, 0, 0, 1
    );
    this.points.frustumCulled = false;
    this.centre = new THREE.Vector3(centre.x, centre.y, centre.z);
  }

  /** Fades in as the camera closes on it, and drops out of the draw entirely far away. */
  update(camera) {
    const distance = camera.position.distanceTo(this.centre);
    const opacity = THREE.MathUtils.clamp((FADE_FAR - distance) / (FADE_FAR - FADE_NEAR), 0, 1);
    this.points.visible = opacity > 0;
    this.material.opacity = opacity;
    return distance;
  }
}
