import { DEG } from './data.js';

/** Eccentric anomaly E for mean anomaly M (Newton's method; converges for Halley's e = 0.967 too). */
export function solveKepler(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 30; k++) {
    const step = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-10) break;
  }
  return E;
}

/**
 * Where a body on an eccentric orbit is at `year`: its distance from the Sun
 * in AU and its angle in the orbit plane measured from the ascending node
 * (argument of perihelion plus true anomaly), in radians.
 */
export function orbitalPosition(el, year) {
  const M = (((year - el.tp) / el.period) % 1) * 2 * Math.PI;
  const E = solveKepler(M, el.e);
  const nu = 2 * Math.atan2(Math.sqrt(1 + el.e) * Math.sin(E / 2), Math.sqrt(1 - el.e) * Math.cos(E / 2));
  return { r: el.a * (1 - el.e * Math.cos(E)), u: el.peri * DEG + nu };
}

/** Points around a whole eccentric orbit, as { r, u }, for drawing it. */
export function orbitSamples(el, count = 512) {
  const p = el.a * (1 - el.e * el.e);
  return Array.from({ length: count }, (_, k) => {
    const nu = (k / count) * 2 * Math.PI;
    return { r: p / (1 + el.e * Math.cos(nu)), u: el.peri * DEG + nu };
  });
}
