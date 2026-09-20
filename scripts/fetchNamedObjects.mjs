#!/usr/bin/env node
/**
 * Builds src/data/namedObjects.json from the SIMBAD TAP service (CDS, Strasbourg).
 *
 * Run: npm run fetch:named
 * Behind an HTTPS proxy, Node's global fetch needs NODE_USE_ENV_PROXY=1 (Node >= 22.21).
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const TAP_URL = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync';
const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/namedObjects.json');

// Redshift below this is dominated by peculiar velocity, so the object is placed
// by a measured distance instead. Also the boundary of the "local" label tier.
const LOCAL_MAX_MPC = 50;
const MIN_RELIABLE_Z = 0.003;
const MAX_Z = 7.4; // Matches the cosmology lookup table ceiling.

const GALAXY_TYPES = ['G', 'GiC', 'GiG', 'GiP', 'IG', 'PaG', 'AGN', 'SBG', 'LSB', 'rG', 'EmG', 'H2G', 'LIN'];
const ACTIVE_TYPES = ['QSO', 'Sy1', 'Sy2', 'Sy', 'BLL', 'Bla', 'QSO_Candidate'];
const STRUCTURE_TYPES = ['ClG', 'SCG', 'GrG', 'CGG', 'Void', 'PoG'];
const WANTED_TYPES = [...GALAXY_TYPES, ...ACTIVE_TYPES, ...STRUCTURE_TYPES];

const TYPE_WEIGHT = { SCG: 100, Void: 95, ClG: 90, GrG: 72, CGG: 70, PoG: 65, QSO: 60, BLL: 58, Sy1: 55, Sy2: 55, AGN: 55 };

const quote = (values) => values.map((v) => `'${v.replace(/'/g, "''")}'`).join(',');

async function tapQuery(adql) {
  const body = new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'json', QUERY: adql });
  const res = await fetch(TAP_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`SIMBAD TAP ${res.status}: ${text.slice(0, 500)}`);

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`SIMBAD TAP returned non-JSON: ${text.slice(0, 500)}`);
  }
  if (!Array.isArray(payload?.data)) throw new Error(`Unexpected TAP payload: ${text.slice(0, 500)}`);

  const columns = (payload.metadata ?? []).map((m) => String(m.name).toLowerCase());
  return payload.data.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
}

/** SIMBAD pads identifiers ("M  31", "NAME Andromeda Galaxy"). */
const tidyId = (id) => String(id).replace(/\s+/g, ' ').trim();
const properName = (id) => (id.startsWith('NAME ') ? id.slice(5).trim() : null);

async function fetchCandidates() {
  const rows = await tapQuery(`
    SELECT TOP 4000 b.oid, b.main_id, b.ra, b.dec, b.otype, b.rvz_redshift, i.id
    FROM basic AS b
    JOIN ident AS i ON b.oid = i.oidref
    WHERE b.ra IS NOT NULL AND b.dec IS NOT NULL
      AND b.otype IN (${quote(WANTED_TYPES)})
      AND (i.id LIKE 'NAME %' OR i.id LIKE 'M %' OR i.id LIKE 'NGC %')
      AND b.oid IN (
        SELECT i2.oidref FROM ident AS i2 WHERE i2.id LIKE 'NAME %' OR i2.id LIKE 'M %'
      )
  `);

  const byOid = new Map();
  for (const row of rows) {
    const oid = row.oid;
    if (!byOid.has(oid)) {
      byOid.set(oid, {
        oid,
        mainId: tidyId(row.main_id),
        ra: Number(row.ra),
        dec: Number(row.dec),
        otype: String(row.otype),
        z: row.rvz_redshift === null || row.rvz_redshift === undefined ? null : Number(row.rvz_redshift),
        ids: []
      });
    }
    byOid.get(oid).ids.push(tidyId(row.id));
  }
  return [...byOid.values()].filter((o) => Number.isFinite(o.ra) && Number.isFinite(o.dec));
}

/** Measured distances, normalised to Mpc; median wins over a single noisy measurement. */
async function fetchDistances(oids) {
  if (!oids.length) return new Map();
  const rows = await tapQuery(`
    SELECT d.oidref, d.dist, d.unit
    FROM mesDistance AS d
    WHERE d.unit IN ('Mpc', 'kpc') AND d.dist > 0
      AND d.oidref IN (${oids.join(',')})
  `);

  const grouped = new Map();
  for (const row of rows) {
    const value = Number(row.dist) * (row.unit === 'kpc' ? 0.001 : 1);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (!grouped.has(row.oidref)) grouped.set(row.oidref, []);
    grouped.get(row.oidref).push(value);
  }

  const medians = new Map();
  for (const [oid, values] of grouped) {
    values.sort((a, b) => a - b);
    medians.set(oid, values[Math.floor(values.length / 2)]);
  }
  return medians;
}

function buildObject(candidate, measuredMpc) {
  const ids = [...new Set(candidate.ids)];
  const name = ids.map(properName).find(Boolean) ?? null;
  const messier = ids.find((id) => /^M \d+$/.test(id)) ?? null;
  const catalogId = messier ?? ids.find((id) => id.startsWith('NGC ')) ?? candidate.mainId;

  const hasReliableZ = Number.isFinite(candidate.z) && candidate.z >= MIN_RELIABLE_Z && candidate.z <= MAX_Z;
  const useMeasured = !hasReliableZ && Number.isFinite(measuredMpc) && measuredMpc < LOCAL_MAX_MPC;
  if (!hasReliableZ && !useMeasured) return null;

  const isQSO = ACTIVE_TYPES.includes(candidate.otype);
  const weight = (TYPE_WEIGHT[candidate.otype] ?? 50) + (name ? 8 : 0) + (messier ? 6 : 0);

  return {
    mainId: candidate.mainId,
    label: name ?? catalogId,
    name,
    catalogId,
    ids: ids.filter((id) => !id.startsWith('NAME ')).slice(0, 4),
    otype: candidate.otype,
    ra: candidate.ra,
    dec: candidate.dec,
    z: Number.isFinite(candidate.z) ? candidate.z : null,
    distMpc: useMeasured ? Number(measuredMpc.toFixed(3)) : null,
    tier: useMeasured ? 'local' : 'deep',
    isQSO,
    weight
  };
}

async function main() {
  console.log('Querying SIMBAD TAP...');
  const candidates = await fetchCandidates();
  console.log(`  ${candidates.length} candidate objects`);

  const distances = await fetchDistances(candidates.map((c) => c.oid));
  console.log(`  ${distances.size} with measured distances`);

  const objects = candidates
    .map((c) => buildObject(c, distances.get(c.oid)))
    .filter(Boolean)
    .sort((a, b) => b.weight - a.weight);

  const payload = {
    source: 'SIMBAD TAP (CDS, Strasbourg)',
    acknowledgement:
      'This research has made use of the SIMBAD database, operated at CDS, Strasbourg, France.',
    generatedAt: new Date().toISOString().slice(0, 10),
    localMaxMpc: LOCAL_MAX_MPC,
    objects
  };

  await writeFile(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  const local = objects.filter((o) => o.tier === 'local').length;
  console.log(`Wrote ${objects.length} objects (${local} local, ${objects.length - local} deep) to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
