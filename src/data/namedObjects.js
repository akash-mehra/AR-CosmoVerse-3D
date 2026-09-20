import catalog from './namedObjects.json';
import { comovingDistanceMpc, raDecDistToCartesian, raDecZToCartesian } from '../cosmology/planck18.js';

export const LOCAL_MAX_MPC = catalog.localMaxMpc ?? 50;

// Light travel time across 1 Mpc, in Gyr. Expansion is negligible over the
// local volume, so nearby lookback times come straight from distance.
const GYR_PER_MPC = 0.00326156;

function project(obj) {
  if (obj.tier === 'local') {
    const distanceMpc = obj.distMpc;
    const { x, y, z } = raDecDistToCartesian(obj.ra, obj.dec, distanceMpc);
    return {
      position: { x, y, z },
      distanceMpc,
      lookbackGyr: distanceMpc * GYR_PER_MPC,
      colorParam: 0
    };
  }

  const p = raDecZToCartesian(obj.ra, obj.dec, obj.z, obj.isQSO);
  return {
    position: { x: p.x, y: p.y, z: p.z },
    distanceMpc: p.distanceMpc,
    lookbackGyr: p.lookbackGyr,
    colorParam: p.colorParam
  };
}

/**
 * Real catalogued objects, projected into the same Mpc coordinate frame as the
 * synthetic cloud. Nearby objects are placed by measured distance; everything
 * else by redshift through the Planck 2018 model.
 */
export function getNamedObjects() {
  return (catalog.objects ?? [])
    .map((obj) => {
      const usableDistance = obj.tier === 'local'
        ? Number.isFinite(obj.distMpc) && obj.distMpc > 0
        : Number.isFinite(obj.z) && comovingDistanceMpc(obj.z) > 0;
      if (!usableDistance) return null;

      return {
        ...obj,
        ...project(obj),
        // The shader filters on redshift and clips anything below uMinZ, so
        // nearby objects (z at or below zero) need a non-negative filter key.
        filterZ: Math.max(obj.z ?? 0, 0)
      };
    })
    .filter(Boolean);
}
