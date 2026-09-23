import * as THREE from 'three';

/*
 * Where the Solar System sits in the galaxy map, so a zoom can run from one
 * into the other. Both are centred on the Sun. The map is in Mpc on equatorial
 * axes; the Solar System is in compressed display units on ecliptic axes.
 * Its display scale is a power law, so the two are pinned where they meet:
 * the Oort Cloud's outer edge, drawn at 2,100 units, is ~100,000 AU (0.48 pc).
 * Small on purpose: this module is in the main bundle, the Solar System is not.
 */
export const OBLIQUITY = 23.4393 * (Math.PI / 180);
export const MPC_PER_UNIT = 0.485e-6 / 2100;

// Distances from the Sun, in display units (0.9–3.2 pc), over which the
// Solar System fades into the map.
export const BAND_INNER = 4000;
export const BAND_OUTER = 14000;
// The Solar System's own lens (vertical degrees); across the band it turns into the map's.
export const SOLAR_FOV = 45;

const s = Math.sin(OBLIQUITY);
const c = Math.cos(OBLIQUITY);
// Equatorial x, y, z to the Solar System's axes: x, ecliptic north, −ecliptic y.
const TO_SOLAR = new THREE.Matrix4().set(1, 0, 0, 0, 0, -s, c, 0, 0, -c, -s, 0, 0, 0, 0, 1);
const TO_MAP = TO_SOLAR.clone().transpose();

/** A map direction (or point, with `scale`) in Solar System axes. */
export const solarFromMap = (v, out, scale = 1) => out.copy(v).applyMatrix4(TO_SOLAR).multiplyScalar(scale);
/** A Solar System direction (or point, with `scale`) in map axes. */
export const mapFromSolar = (v, out, scale = 1) => out.copy(v).applyMatrix4(TO_MAP).multiplyScalar(scale);

/** 0 within the Solar System's own range, 1 out in the map's, from the camera's distance to the Sun in display units. */
export function bandPosition(units) {
  return THREE.MathUtils.clamp(Math.log(units / BAND_INNER) / Math.log(BAND_OUTER / BAND_INNER), 0, 1);
}
