import { comovingDistanceMpc, lookbackTimeGyr, raDecZToCartesian } from '../cosmology/planck18.js';
import { getNamedObjects } from './namedObjects.js';

// Upper redshift bound of the Planck18 distance table.
export const MAX_CATALOG_Z = 7.5;

/**
 * Fast 3D Simplex-like Noise for Cosmic Web Filaments
 */
function hash(x, y, z) {
  let h = x * 374761393 + y * 668265263 + z * 1274126177;
  h = (h ^ (h >> 13)) * 1274126177;
  return (h ^ (h >> 16)) & 0x7fffffff;
}

function noise3D(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;

  const h000 = hash(ix, iy, iz) / 0x7fffffff;
  const h100 = hash(ix + 1, iy, iz) / 0x7fffffff;
  const h010 = hash(ix, iy + 1, iz) / 0x7fffffff;
  const h110 = hash(ix + 1, iy + 1, iz) / 0x7fffffff;
  const h001 = hash(ix, iy, iz + 1) / 0x7fffffff;
  const h101 = hash(ix + 1, iy, iz + 1) / 0x7fffffff;
  const h011 = hash(ix, iy + 1, iz + 1) / 0x7fffffff;
  const h111 = hash(ix + 1, iy + 1, iz + 1) / 0x7fffffff;

  // Smoothstep interpolation
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  const x00 = h000 * (1 - ux) + h100 * ux;
  const x10 = h010 * (1 - ux) + h110 * ux;
  const x01 = h001 * (1 - ux) + h101 * ux;
  const x11 = h011 * (1 - ux) + h111 * ux;

  const y0 = x00 * (1 - uy) + x10 * uy;
  const y1 = x01 * (1 - uy) + x11 * uy;

  return y0 * (1 - uz) + y1 * uz;
}

/**
 * Computes multi-scale cosmic web density (filaments and voids)
 */
function cosmicWebDensity(x, y, z) {
  const scale1 = 0.015;
  const scale2 = 0.04;
  const scale3 = 0.09;
  const n1 = noise3D(x * scale1, y * scale1, z * scale1);
  const n2 = noise3D(x * scale2, y * scale2, z * scale2);
  const n3 = noise3D(x * scale3, y * scale3, z * scale3);

  // Combine noise to form ridge-like filaments
  const filament = Math.pow(Math.abs(n1 - 0.5) * 2, 0.6) * 0.5 +
                   Math.pow(Math.abs(n2 - 0.5) * 2, 0.8) * 0.35 +
                   (n3 * 0.15);
  return 1.0 - filament; // High values = dense filaments, Low values = voids
}

/**
 * Checks if a coordinate (RA in deg, Dec in deg, d in Mpc) is inside
 * The Boötes Void ("The Great Nothing")
 * Boötes Void: RA ~ 218 deg (14h 32m), Dec ~ +46 deg, z ~ 0.055 (d ~ 250 Mpc)
 * Radius ~ 30-35 Mpc
 */
export const BOOTES_VOID_CENTER = {
  ra: 218.0,
  dec: 46.0,
  z: 0.055,
  distanceMpc: 250.0,
  radiusMpc: 32.0
};

export const SLOAN_GREAT_WALL = {
  ra: 175.0,
  dec: 5.0,
  z: 0.073,
  distanceMpc: 325.0
};

function isInBootesVoid(ra, dec, distMpc) {
  const dRa = (ra - BOOTES_VOID_CENTER.ra) * Math.cos(dec * Math.PI / 180);
  const dDec = dec - BOOTES_VOID_CENTER.dec;
  const angDist = Math.sqrt(dRa * dRa + dDec * dDec);
  const physDist = angDist * (Math.PI / 180) * distMpc;
  const radialDist = Math.abs(distMpc - BOOTES_VOID_CENTER.distanceMpc);
  const totalDist = Math.sqrt(physDist * physDist + radialDist * radialDist);
  return totalDist < BOOTES_VOID_CENTER.radiusMpc;
}

/**
 * Checks if coordinate is in the Sloan Great Wall
 */
function isInSloanWall(ra, dec, distMpc) {
  const dRa = ra - SLOAN_GREAT_WALL.ra;
  const dDec = dec - SLOAN_GREAT_WALL.dec;
  const radialDist = Math.abs(distMpc - SLOAN_GREAT_WALL.distanceMpc);
  return Math.abs(dRa) < 25 && Math.abs(dDec) < 8 && radialDist < 18;
}

/**
 * Generates SDSS DR18 Galaxy & Quasar catalog with:
 * - Dual wedge sky survey geometry (North & South Galactic Caps)
 * - Filamentary cosmic web & clustering
 * - Boötes Void (98% underdense)
 * - Sloan Great Wall (250% overdense)
 * - Quasars out to redshift z = 7.0
 */
export function generateSDSSCatalog(targetCount = 240000) {
  // Real catalogued objects are appended after the synthetic cloud, at their
  // true coordinates, so the synthetic density is unchanged.
  const named = getNamedObjects();
  const syntheticCount = targetCount;
  const total = syntheticCount + named.length;

  const numGalaxies = Math.floor(syntheticCount * 0.78);

  const positions = new Float32Array(total * 3);
  const colorParams = new Float32Array(total);
  const redshifts = new Float32Array(total);
  const isQSOArray = new Uint8Array(total);
  const landmarkIds = new Uint8Array(total); // 0=general, 1=bootes_void_border, 2=sloan_wall, 3=quasar_dawn, 4=named

  // We create 4 normalized orderings for the one-by-one plotting controller
  const orderRedshift = new Float32Array(total);
  const orderScan = new Float32Array(total);
  const orderFilaments = new Float32Array(total);
  const orderRandom = new Float32Array(total);

  let idx = 0;

  // 1. Generate Galaxies (z in [0.015, 0.45])
  while (idx < numGalaxies) {
    // Generate RA and Dec within SDSS DR18 footprint wedges
    // North Galactic Cap: RA 110..260, Dec -10..65
    // South Galactic Cap: RA -50..50 (310..360 or 0..50), Dec -15..35
    const isNGC = Math.random() < 0.65;
    let ra, dec;

    if (isNGC) {
      ra = 115 + Math.random() * 140;
      dec = -8 + Math.random() * 70;
    } else {
      ra = (Math.random() < 0.5 ? 310 + Math.random() * 50 : Math.random() * 50);
      dec = -12 + Math.random() * 45;
    }

    // Redshift distribution for SDSS main galaxy sample peaks around z ~ 0.10
    // We use a Gamma-like probability distribution starting from local neighborhood z ~ 0.001
    const u1 = Math.random();
    const u2 = Math.random();
    let z = 0.001 + Math.pow(u1, 1.6) * 0.40;
    if (Math.random() < 0.15) z = 0.001 + Math.random() * 0.30; // Uniform fill

    const d = comovingDistanceMpc(z);

    // Compute Cartesian coordinates
    const cosDec = Math.cos((dec * Math.PI) / 180);
    const x = d * cosDec * Math.cos((ra * Math.PI) / 180);
    const y = d * cosDec * Math.sin((ra * Math.PI) / 180);
    const zCoord = d * Math.sin((dec * Math.PI) / 180);

    // Check cosmic web density & voids
    const inBootes = isInBootesVoid(ra, dec, d);
    if (inBootes && Math.random() < 0.98) {
      // Boötes void is 98% empty! Skip almost all points inside
      continue;
    }

    const inWall = isInSloanWall(ra, dec, d);
    const webDensity = cosmicWebDensity(x, y, zCoord);

    // Rejection sample to form realistic filaments (unless in Sloan Wall)
    if (!inWall && Math.random() > Math.pow(webDensity, 1.8) * 1.3 && Math.random() < 0.82) {
      continue;
    }

    // Store Galaxy
    const i3 = idx * 3;
    positions[i3 + 0] = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = zCoord;

    // Color param [0.0, 0.5)
    colorParams[idx] = Math.max(0, Math.min((z - 0.01) / 0.40, 0.999)) * 0.499;
    redshifts[idx] = z;
    isQSOArray[idx] = 0;

    if (inBootes) landmarkIds[idx] = 1;
    else if (inWall) landmarkIds[idx] = 2;
    else landmarkIds[idx] = 0;

    // Plotting order values
    orderRedshift[idx] = z;
    orderScan[idx] = ((ra % 360) / 360.0) * 0.8 + (dec + 20) / 100.0 * 0.2;
    orderFilaments[idx] = 1.0 - webDensity; // Dense filaments first (lowest density value last)
    orderRandom[idx] = Math.random();

    idx++;
  }

  // 2. Generate Quasars (QSOs, z in [0.2, 7.0])
  while (idx < syntheticCount) {
    const isNGC = Math.random() < 0.65;
    let ra, dec;
    if (isNGC) {
      ra = 115 + Math.random() * 140;
      dec = -8 + Math.random() * 70;
    } else {
      ra = (Math.random() < 0.5 ? 310 + Math.random() * 50 : Math.random() * 50);
      dec = -12 + Math.random() * 45;
    }

    // QSO redshift distribution: wide range from 0.2 out to 7.0
    const u = Math.random();
    const z = 0.15 + Math.pow(u, 2.0) * 6.8;
    const d = comovingDistanceMpc(z);

    const cosDec = Math.cos((dec * Math.PI) / 180);
    const x = d * cosDec * Math.cos((ra * Math.PI) / 180);
    const y = d * cosDec * Math.sin((ra * Math.PI) / 180);
    const zCoord = d * Math.sin((dec * Math.PI) / 180);

    const i3 = idx * 3;
    positions[i3 + 0] = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = zCoord;

    // Color param [0.5, 1.0]
    colorParams[idx] = 0.5 + Math.max(0, Math.min((z - 0.15) / 6.85, 0.999)) * 0.499;
    redshifts[idx] = z;
    isQSOArray[idx] = 1;
    landmarkIds[idx] = z >= 4.0 ? 3 : 0; // High redshift quasar dawn

    orderRedshift[idx] = z;
    orderScan[idx] = ((ra % 360) / 360.0) * 0.8 + (dec + 20) / 100.0 * 0.2;
    orderFilaments[idx] = Math.random();
    orderRandom[idx] = Math.random();

    idx++;
  }

  // 3. Append real catalogued objects at their true coordinates
  for (const obj of named) {
    const i3 = idx * 3;
    positions[i3 + 0] = obj.position.x;
    positions[i3 + 1] = obj.position.y;
    positions[i3 + 2] = obj.position.z;

    colorParams[idx] = obj.colorParam;
    redshifts[idx] = obj.filterZ;
    isQSOArray[idx] = obj.isQSO ? 1 : 0;
    landmarkIds[idx] = 4;
    obj.pointIndex = idx;

    orderRedshift[idx] = obj.filterZ;
    orderScan[idx] = ((obj.ra % 360) / 360.0) * 0.8 + (obj.dec + 20) / 100.0 * 0.2;
    orderFilaments[idx] = Math.random();
    orderRandom[idx] = Math.random();

    idx++;
  }

  rankOrder(orderRedshift);
  rankOrder(orderScan);
  rankOrder(orderFilaments);
  rankOrder(orderRandom);

  return {
    count: total,
    positions,
    colorParams,
    redshifts,
    isQSOArray,
    landmarkIds,
    named,
    orders: {
      redshift: orderRedshift,
      scan: orderScan,
      filaments: orderFilaments,
      random: orderRandom
    }
  };
}

const RANK_BINS = 1 << 16;

/**
 * Replaces each sort key with (rank + 1) / n. The shader shows a point once its
 * order is <= uPlotProgress, so with ranks a progress of k / n puts exactly k
 * points on screen — the count, the speed in points per second and every
 * telemetry figure then describe what is actually drawn. Min-max scaling kept
 * the keys' own distribution, so "4,500 / sec" and the plotted count were
 * fiction. Bucketed, so O(n); keys sharing a bucket keep buffer order.
 */
function rankOrder(arr) {
  const n = arr.length;
  if (n === 0) return;

  let min = Infinity, max = -Infinity;
  for (let i = 0; i < n; i++) {
    if (arr[i] < min) min = arr[i];
    if (arr[i] > max) max = arr[i];
  }
  const scale = (RANK_BINS - 1) / ((max - min) || 1);

  const bins = new Uint16Array(n);
  const next = new Uint32Array(RANK_BINS + 1);
  for (let i = 0; i < n; i++) {
    const b = ((arr[i] - min) * scale) | 0;
    bins[i] = b;
    next[b + 1]++;
  }
  for (let b = 0; b < RANK_BINS; b++) next[b + 1] += next[b];
  for (let i = 0; i < n; i++) arr[i] = (next[bins[i]]++ + 1) / n;
}

/**
 * Redshift histogram of the points currently plotted: those whose spawn order
 * is at or below `progress`, the same test the vertex shader applies.
 */
export function computeRedshiftHistogram(redshifts, isQSOArray, order, progress, minZ = 0.00, maxZ = 0.30, numBins = 50) {
  const galaxyBins = new Int32Array(numBins);
  const qsoBins = new Int32Array(numBins);
  const dz = (maxZ - minZ) / numBins;
  let totalInRegion = 0;
  let galaxiesInRegion = 0;
  let qsosInRegion = 0;

  for (let i = 0; i < redshifts.length; i++) {
    if (order[i] > progress) continue;
    const z = redshifts[i];
    if (z >= minZ && z <= maxZ) {
      const binIdx = Math.min(Math.floor((z - minZ) / dz), numBins - 1);
      if (isQSOArray[i] === 0) {
        galaxyBins[binIdx]++;
        galaxiesInRegion++;
      } else {
        qsoBins[binIdx]++;
        qsosInRegion++;
      }
      totalInRegion++;
    }
  }

  return {
    minZ,
    maxZ,
    numBins,
    dz,
    galaxyBins,
    qsoBins,
    totalInRegion,
    galaxiesInRegion,
    qsosInRegion
  };
}

/**
 * Builds GPU-ready catalog buffers from plain { ra, dec, z, isQSO } records.
 * Rows with non-finite or out-of-range values are dropped.
 */
export function buildCatalog(records) {
  const named = getNamedObjects();
  const maxRows = records.length + named.length;
  const positions = new Float32Array(maxRows * 3);
  const colorParams = new Float32Array(maxRows);
  const redshifts = new Float32Array(maxRows);
  const isQSOArray = new Uint8Array(maxRows);
  const landmarkIds = new Uint8Array(maxRows);

  const orderRedshift = new Float32Array(maxRows);
  const orderScan = new Float32Array(maxRows);
  const orderFilaments = new Float32Array(maxRows);
  const orderRandom = new Float32Array(maxRows);

  let validCount = 0;

  for (const record of records) {
    const ra = Number(record.ra);
    const dec = Number(record.dec);
    const z = Number(record.z);

    if (!Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(z)) continue;
    if (z <= 0 || z > MAX_CATALOG_Z || dec < -90 || dec > 90) continue;

    const isQSO = Boolean(record.isQSO);
    const raNorm = ((ra % 360) + 360) % 360;
    const coords = raDecZToCartesian(raNorm, dec, z, isQSO);

    const i3 = validCount * 3;
    positions[i3 + 0] = coords.x;
    positions[i3 + 1] = coords.y;
    positions[i3 + 2] = coords.z;

    colorParams[validCount] = coords.colorParam;
    redshifts[validCount] = z;
    isQSOArray[validCount] = isQSO ? 1 : 0;
    landmarkIds[validCount] = isQSO && z >= 4.0 ? 3 : 0; // Quasar dawn beacon

    orderRedshift[validCount] = z;
    orderScan[validCount] = raNorm / 360.0;
    orderFilaments[validCount] = Math.random();
    orderRandom[validCount] = Math.random();

    validCount++;
  }

  if (validCount === 0) {
    throw new Error("No rows with usable ra / dec / redshift values.");
  }

  // Named objects ride along with every data source, at their true coordinates.
  for (const obj of named) {
    const i3 = validCount * 3;
    positions[i3 + 0] = obj.position.x;
    positions[i3 + 1] = obj.position.y;
    positions[i3 + 2] = obj.position.z;

    colorParams[validCount] = obj.colorParam;
    redshifts[validCount] = obj.filterZ;
    isQSOArray[validCount] = obj.isQSO ? 1 : 0;
    landmarkIds[validCount] = 4;
    obj.pointIndex = validCount;

    orderRedshift[validCount] = obj.filterZ;
    orderScan[validCount] = (((obj.ra % 360) + 360) % 360) / 360.0;
    orderFilaments[validCount] = Math.random();
    orderRandom[validCount] = Math.random();

    validCount++;
  }

  rankOrder(orderRedshift.subarray(0, validCount));
  rankOrder(orderScan.subarray(0, validCount));
  rankOrder(orderFilaments.subarray(0, validCount));
  rankOrder(orderRandom.subarray(0, validCount));

  return {
    count: validCount,
    positions: positions.subarray(0, validCount * 3),
    colorParams: colorParams.subarray(0, validCount),
    redshifts: redshifts.subarray(0, validCount),
    isQSOArray: isQSOArray.subarray(0, validCount),
    landmarkIds: landmarkIds.subarray(0, validCount),
    named,
    orders: {
      redshift: orderRedshift.subarray(0, validCount),
      scan: orderScan.subarray(0, validCount),
      filaments: orderFilaments.subarray(0, validCount),
      random: orderRandom.subarray(0, validCount)
    }
  };
}

// Past this the GPU buffers and the per-frame telemetry scan stop being cheap.
export const MAX_IMPORT_ROWS = 1_000_000;

/**
 * Custom SDSS SQL CSV / JSON Parser
 * Parses CSV with columns: ra, dec, z, class ('GALAXY' or 'QSO')
 */
export function importCustomSDSSData(csvText) {
  // CasJobs exports open with a "#Table1" line; blank lines and CRLF are common.
  const lines = String(csvText ?? '')
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.trimStart().startsWith('#'));
  if (lines.length <= 1) throw new Error("CSV contains no rows");
  if (lines.length - 1 > MAX_IMPORT_ROWS) {
    throw new Error(`CSV has ${(lines.length - 1).toLocaleString()} rows; the limit is ${MAX_IMPORT_ROWS.toLocaleString()}.`);
  }

  const headers = lines[0].toLowerCase().split(',').map(s => s.trim().replace(/['"]/g, ''));
  const raIdx = headers.indexOf('ra');
  const decIdx = headers.indexOf('dec');
  const zIdx = headers.findIndex(h => h === 'z' || h === 'redshift');
  // Prefer an exact 'class' so a 'subclass' column earlier in the row cannot win.
  const exactClassIdx = headers.findIndex(h => h === 'class' || h === 'type');
  const classIdx = exactClassIdx !== -1
    ? exactClassIdx
    : headers.findIndex(h => h.includes('class') || h.includes('type'));

  if (raIdx === -1 || decIdx === -1 || zIdx === -1) {
    throw new Error("CSV must contain 'ra', 'dec', and 'z' (or 'redshift') columns.");
  }

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(s => s.trim().replace(/['"]/g, ''));
    if (cols.length < 3) continue;

    const className = classIdx !== -1 ? (cols[classIdx] || '').toUpperCase() : '';
    records.push({
      ra: parseFloat(cols[raIdx]),
      dec: parseFloat(cols[decIdx]),
      z: parseFloat(cols[zIdx]),
      isQSO: className === 'QSO' || className === 'QUASAR'
    });
  }

  return buildCatalog(records);
}
