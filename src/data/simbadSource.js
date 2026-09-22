import { buildCatalog, MAX_CATALOG_Z } from './sdssGenerator.js';

/**
 * SIMBAD (CDS, Strasbourg) TAP client.
 * Pulls real galaxies and quasars with measured redshifts and maps them into
 * the same GPU catalog buffers the synthetic generator produces.
 * Service docs: https://simbad.cds.unistra.fr/simbad/sim-tap
 */
const TAP_SYNC_URL = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync';
const REQUEST_TIMEOUT_MS = 90000;
const MAX_ROWS_PER_BAND = 50000;

// `otype = 'X..'` matches the whole SIMBAD hierarchy below X. The QSO subtree
// sits under Galaxy, so galaxy bands subtract it to keep the families disjoint.
const TYPE_FILTERS = {
  galaxy: "otype = 'Galaxy..' AND otype != 'QSO..'",
  qso: "otype = 'QSO..'"
};

/**
 * TOP without ORDER BY returns whichever rows the server indexes first, so the
 * sample is split into redshift bands to keep coverage across cosmic depth.
 */
export const DEFAULT_BANDS = [
  { kind: 'galaxy', minZ: 0.0005, maxZ: 0.02, limit: 4000 },
  { kind: 'galaxy', minZ: 0.02, maxZ: 0.1, limit: 8000 },
  { kind: 'galaxy', minZ: 0.1, maxZ: 0.5, limit: 8000 },
  { kind: 'galaxy', minZ: 0.5, maxZ: 2.0, limit: 4000 },
  { kind: 'galaxy', minZ: 2.0, maxZ: MAX_CATALOG_Z, limit: 2000 },
  { kind: 'qso', minZ: 0.1, maxZ: 1.0, limit: 4000 },
  { kind: 'qso', minZ: 1.0, maxZ: 2.5, limit: 6000 },
  { kind: 'qso', minZ: 2.5, maxZ: 4.0, limit: 4000 },
  { kind: 'qso', minZ: 4.0, maxZ: MAX_CATALOG_Z, limit: 2000 }
];

/**
 * Builds the ADQL for one band. Only validated numbers reach the query string;
 * the type predicate comes from a fixed allow-list.
 */
function buildQuery(band) {
  const typeFilter = TYPE_FILTERS[band.kind];
  const minZ = Number(band.minZ);
  const maxZ = Number(band.maxZ);
  const limit = Number(band.limit);

  if (!typeFilter) throw new Error(`Unknown band kind '${band.kind}'`);
  if (!Number.isFinite(minZ) || !Number.isFinite(maxZ) || minZ < 0 || maxZ <= minZ) {
    throw new Error('Band redshift range must satisfy 0 <= minZ < maxZ');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ROWS_PER_BAND) {
    throw new Error(`Band limit must be an integer in 1..${MAX_ROWS_PER_BAND}`);
  }

  return `SELECT TOP ${limit} ra, dec, rvz_redshift FROM basic ` +
    `WHERE ${typeFilter} AND rvz_redshift > ${minZ} AND rvz_redshift <= ${maxZ} ` +
    `AND ra IS NOT NULL AND dec IS NOT NULL`;
}

/**
 * Maps a VOTable-JSON payload to { ra, dec, z, isQSO } records. The band's own
 * type filter decides isQSO: the QSO bands select exactly the QSO subtree and
 * the galaxy bands exclude it, so no per-row otype list can drift from them.
 */
function toRecords(payload, isQSO) {
  if (!payload || !Array.isArray(payload.metadata) || !Array.isArray(payload.data)) {
    throw new Error('Unexpected SIMBAD response shape');
  }

  const col = {};
  payload.metadata.forEach((meta, i) => {
    if (meta && typeof meta.name === 'string') col[meta.name.toLowerCase()] = i;
  });
  for (const name of ['ra', 'dec', 'rvz_redshift']) {
    if (col[name] === undefined) throw new Error(`SIMBAD response is missing column '${name}'`);
  }

  return payload.data.map(row => ({
    ra: row[col.ra],
    dec: row[col.dec],
    z: row[col.rvz_redshift],
    isQSO
  }));
}

async function fetchBand(band) {
  const body = new URLSearchParams({
    request: 'doQuery',
    lang: 'ADQL',
    format: 'json',
    query: buildQuery(band)
  });

  const response = await fetch(TAP_SYNC_URL, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  // ADQL and service errors come back as a VOTable document, not JSON.
  if (!response.ok) throw new Error(`SIMBAD TAP responded ${response.status}`);

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('SIMBAD TAP returned a non-JSON body');
  }
  return toRecords(payload, band.kind === 'qso');
}

/**
 * Fetches a real SIMBAD catalog. Bands are requested in parallel; a band that
 * fails is reported via `failedBands` instead of losing the whole load.
 * @returns catalog buffers plus { source, failedBands }
 */
export async function fetchSimbadCatalog({ bands = DEFAULT_BANDS, onProgress } = {}) {
  if (!Array.isArray(bands) || bands.length === 0) throw new Error('No SIMBAD bands requested');

  let completed = 0;
  const tick = () => { if (onProgress) onProgress(++completed, bands.length); };
  const results = await Promise.allSettled(bands.map(band => fetchBand(band).finally(tick)));

  const records = [];
  let failedBands = 0;
  let lastError = null;

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const record of result.value) records.push(record);
    } else {
      failedBands++;
      lastError = result.reason;
      console.warn('SIMBAD band failed:', result.reason);
    }
  }

  if (records.length === 0) {
    throw new Error(lastError ? `SIMBAD query failed: ${lastError.message}` : 'SIMBAD returned no rows');
  }

  const catalog = buildCatalog(records);
  catalog.source = 'SIMBAD';
  catalog.failedBands = failedBands;
  return catalog;
}
