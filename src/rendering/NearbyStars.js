import * as THREE from 'three';
import { loadStarField } from '../data/nearbyStars.js';

// Faintest magnitude drawn from near the Sun: a dark-sky naked eye, a little
// deeper because a screen is not a sky. Further out it deepens with distance,
// so the whole neighbourhood stays in view as a cloud rather than vanishing.
const NEAR_LIMIT = 7;
// The layer shows within this distance of the Sun (Mpc), fading out beyond,
// where the Milky Way model carries the view.
const FULL_MPC = 0.0015;
const GONE_MPC = 0.004;
// Fetched this close to the Sun, ahead of the stars being needed.
const PREFETCH_MPC = 0.005;

/*
 * Every star is a point at its true position, and its apparent magnitude is
 * worked out per vertex from its absolute magnitude and its distance from the
 * camera — so the sky is right from wherever you stand: from the Sun it is the
 * night sky, from Alpha Centauri the Sun is a bright star in Cassiopeia.
 */
const VERTEX = `
attribute float aAbsMag;
attribute vec3 aColor;
uniform float uLimit;
uniform float uOpacity;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vAlpha;
varying float vGlow;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float pc = max(length(mv.xyz) * 1.0e6, 1.0e-7);
  float m = aAbsMag + 5.0 * log(pc) / log(10.0) - 5.0;
  // log10 of the flux relative to the faintest drawn.
  float lf = -0.4 * (m - uLimit);
  if (lf < -0.6 || uOpacity <= 0.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vAlpha = 0.0;
    return;
  }
  gl_Position = projectionMatrix * mv;
  // Past a few magnitudes above the limit a star swells into a glare, so one
  // flown up to blazes rather than staying a dot.
  gl_PointSize = clamp(1.5 + 2.0 * max(lf, 0.0) + 5.0 * max(lf - 4.0, 0.0), 1.5, 64.0) * uPixelRatio;
  vAlpha = clamp(0.3 + 0.25 * lf, 0.06, 1.0) * uOpacity;
  vGlow = clamp((lf - 3.0) / 4.0, 0.0, 1.0);
  vColor = aColor;
}`;

const FRAGMENT = `
varying vec3 vColor;
varying float vAlpha;
varying float vGlow;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(mix(0.5, 0.18, vGlow), 0.0, d);
  float halo = exp(-d * d * mix(5.0, 3.0, vGlow)) * mix(0.45, 0.8, vGlow);
  float a = (core + halo) * vAlpha;
  if (a < 0.004) discard;
  // Additive blending multiplies by alpha itself.
  gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.5), a);
}`;

export class NearbyStars {
  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uLimit: { value: NEAR_LIMIT }, uOpacity: { value: 0 }, uPixelRatio: { value: 1 } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.visible = false;
    this.loading = null;
    this.ready = false;
    this.onError = null;
  }

  /** Fetches the star field once. */
  load() {
    this.loading ??= loadStarField().then((data) => {
      const geometry = this.points.geometry;
      geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geometry.setAttribute('aAbsMag', new THREE.BufferAttribute(data.absMag, 1));
      geometry.setAttribute('aColor', new THREE.BufferAttribute(data.colors, 3, true));
      geometry.computeBoundingSphere();
      this.data = data;
      this.ready = true;
      return data;
    }, (err) => {
      console.error(err);
      this.onError?.(err);
      throw err;
    });
    return this.loading;
  }

  update(camera, pixelRatio) {
    const toSun = camera.position.length();
    if (toSun < PREFETCH_MPC && !this.loading) this.load().catch(() => {}); // reported by load
    const opacity = THREE.MathUtils.clamp((GONE_MPC - toSun) / (GONE_MPC - FULL_MPC), 0, 1);
    this.points.visible = this.ready && opacity > 0;
    const u = this.material.uniforms;
    u.uOpacity.value = opacity;
    u.uPixelRatio.value = pixelRatio;
    u.uLimit.value = NEAR_LIMIT + 5 * Math.log10(Math.max(toSun * 1e6, 10) / 10);
  }
}
