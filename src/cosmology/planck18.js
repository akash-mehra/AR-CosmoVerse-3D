/**
 * Planck 2018 Cosmology Implementation
 * Astropy Planck18 reference cosmology:
 * H0 = 67.4 km / (s * Mpc)
 * Omega_m0 = 0.315
 * Omega_lambda0 = 0.685
 * c = 299792.458 km/s
 */

export const PLANCK18 = {
  H0: 67.4,
  Omega_m: 0.315,
  Omega_lambda: 0.685,
  c: 299792.458,
  // Hubble Distance in Mpc = c / H0
  get DH() {
    return this.c / this.H0;
  },
  // Hubble Time in Gyr = 1/H0 * 977.79222 (unit conversion factor)
  get TH_Gyr() {
    return (1 / this.H0) * 977.79222137;
  }
};

/**
 * E(z) = sqrt(Omega_m * (1+z)^3 + Omega_lambda)
 * Dimensionless Hubble parameter
 */
export function Ez(z) {
  const opz = 1.0 + z;
  return Math.sqrt(
    PLANCK18.Omega_m * (opz * opz * opz) + PLANCK18.Omega_lambda
  );
}

// High-speed lookup table for comoving distance and lookback time
// Evaluates integral once and linearly interpolates for millions of objects
const TABLE_SIZE = 4000;
const MAX_Z = 7.5;
const lookupTable = new Float64Array(TABLE_SIZE * 3); // [z, distanceMpc, lookbackGyr]

function initLookupTable() {
  const nStepsPerBin = 40;
  let accumulatedDist = 0;
  let accumulatedTime = 0;
  const dz = MAX_Z / (TABLE_SIZE - 1);

  for (let i = 0; i < TABLE_SIZE; i++) {
    const zCurr = i * dz;
    lookupTable[i * 3 + 0] = zCurr;
    lookupTable[i * 3 + 1] = accumulatedDist;
    lookupTable[i * 3 + 2] = accumulatedTime;

    if (i < TABLE_SIZE - 1) {
      // Simpson integration across interval dz
      const z0 = zCurr;
      const z1 = zCurr + dz * 0.5;
      const z2 = zCurr + dz;

      // Comoving distance integral: int_0^z dz' / E(z')
      const f0_d = 1.0 / Ez(z0);
      const f1_d = 1.0 / Ez(z1);
      const f2_d = 1.0 / Ez(z2);
      const dDist = (dz / 6.0) * (f0_d + 4.0 * f1_d + f2_d) * PLANCK18.DH;

      // Lookback time integral: int_0^z dz' / ((1+z') * E(z'))
      const f0_t = 1.0 / ((1.0 + z0) * Ez(z0));
      const f1_t = 1.0 / ((1.0 + z1) * Ez(z1));
      const f2_t = 1.0 / ((1.0 + z2) * Ez(z2));
      const dTime = (dz / 6.0) * (f0_t + 4.0 * f1_t + f2_t) * PLANCK18.TH_Gyr;

      accumulatedDist += dDist;
      accumulatedTime += dTime;
    }
  }
}
initLookupTable();

/**
 * Calculates comoving distance in Megaparsecs (Mpc) for a given redshift z
 * using Planck18 cosmology.
 * Fast O(1) interpolation from precision table.
 */
export function comovingDistanceMpc(z) {
  if (z <= 0) return 0;
  if (z >= MAX_Z) z = MAX_Z - 0.0001;
  const idxFloat = (z / MAX_Z) * (TABLE_SIZE - 1);
  const idx = Math.floor(idxFloat);
  const frac = idxFloat - idx;
  const d0 = lookupTable[idx * 3 + 1];
  const d1 = lookupTable[Math.min(idx + 1, TABLE_SIZE - 1) * 3 + 1];
  return d0 + frac * (d1 - d0);
}

/**
 * Calculates cosmic lookback time in Billion Years (Gyr) for a given redshift z.
 */
export function lookbackTimeGyr(z) {
  if (z <= 0) return 0;
  if (z >= MAX_Z) z = MAX_Z - 0.0001;
  const idxFloat = (z / MAX_Z) * (TABLE_SIZE - 1);
  const idx = Math.floor(idxFloat);
  const frac = idxFloat - idx;
  const t0 = lookupTable[idx * 3 + 2];
  const t1 = lookupTable[Math.min(idx + 1, TABLE_SIZE - 1) * 3 + 2];
  return t0 + frac * (t1 - t0);
}

/**
 * Projects RA/Dec (degrees) at a known distance in Mpc into Cartesian coordinates.
 * Used directly for nearby objects, whose redshift is dominated by peculiar
 * velocity and so cannot be turned into a distance.
 */
export function raDecDistToCartesian(raDeg, decDeg, distMpc) {
  const raRad = (raDeg * Math.PI) / 180.0;
  const decRad = (decDeg * Math.PI) / 180.0;
  const cosDec = Math.cos(decRad);

  return {
    x: distMpc * cosDec * Math.cos(raRad),
    y: distMpc * cosDec * Math.sin(raRad),
    z: distMpc * Math.sin(decRad)
  };
}

/**
 * Projects astronomical coordinates (RA/Dec in degrees, redshift z)
 * into 3D Cartesian coordinates (x, y, z in Mpc) + metadata.
 * Ricky Reusser projection:
 *   x = d * cos(Dec) * cos(RA)
 *   y = d * cos(Dec) * sin(RA)
 *   z = d * sin(Dec)
 */
export function raDecZToCartesian(raDeg, decDeg, z, isQSO = false) {
  const d = comovingDistanceMpc(z);
  const lookback = lookbackTimeGyr(z);
  const { x, y, z: zCoord } = raDecDistToCartesian(raDeg, decDeg, d);

  // Encode color_param: galaxies map to [0, 0.5) and QSOs to [0.5, 1.0]
  let colorParam = 0;
  if (!isQSO) {
    // Galaxy redshift range ~ 0.0 to 0.4
    const norm = Math.max(0, Math.min((z - 0.01) / 0.38, 0.999));
    colorParam = norm * 0.499;
  } else {
    // QSO redshift range ~ 0.1 to 7.0
    const norm = Math.max(0, Math.min((z - 0.1) / 6.8, 0.999));
    colorParam = 0.5 + norm * 0.499;
  }

  return {
    x,
    y,
    z: zCoord,
    distanceMpc: d,
    lookbackGyr: lookback,
    colorParam,
    raDeg,
    decDeg,
    redshift: z,
    isQSO
  };
}
