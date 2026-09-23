#!/usr/bin/env node
/**
 * Builds the nearby-stars layer: public/data/stars/nearby-stars.bin (every
 * star's position, brightness and colour) and named-stars.json (the ones worth
 * a label, a card or a search hit).
 *
 * Sources, all queried live:
 *   Hipparcos, new reduction (van Leeuwen 2007, VizieR I/311) for positions and
 *   parallaxes, joined to the original catalogue (I/239) for V and spectral type;
 *   SIMBAD for proper names and Bayer/Flamsteed designations;
 *   the NASA Exoplanet Archive for planet hosts, adding those Hipparcos lacks.
 *
 * Run: npm run fetch:stars
 * Behind an HTTPS proxy, Node's global fetch needs NODE_USE_ENV_PROXY=1 (Node >= 22.21).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/stars');
const VIZIER = 'https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync';
const SIMBAD = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync';
const EXOPLANETS = 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync';

// Within 1 kpc, and parallax good to 20%: a poorer one scatters stars along
// the line of sight.
const MIN_PARALLAX_MAS = 1;
const MIN_PARALLAX_SNR = 5;
const MAX_HOST_PC = 1000;
// Bayer letters label any star; a Flamsteed number alone only a bright or near one.
const FLAMSTEED_MAX_V = 4.5;
const FLAMSTEED_MAX_PC = 20;

const GREEK = {
  alf: ['α', 'Alpha'], bet: ['β', 'Beta'], gam: ['γ', 'Gamma'], del: ['δ', 'Delta'], eps: ['ε', 'Epsilon'],
  zet: ['ζ', 'Zeta'], eta: ['η', 'Eta'], tet: ['θ', 'Theta'], iot: ['ι', 'Iota'], kap: ['κ', 'Kappa'],
  lam: ['λ', 'Lambda'], 'mu.': ['μ', 'Mu'], 'nu.': ['ν', 'Nu'], ksi: ['ξ', 'Xi'], omi: ['ο', 'Omicron'],
  'pi.': ['π', 'Pi'], rho: ['ρ', 'Rho'], sig: ['σ', 'Sigma'], tau: ['τ', 'Tau'], ups: ['υ', 'Upsilon'],
  phi: ['φ', 'Phi'], chi: ['χ', 'Chi'], psi: ['ψ', 'Psi'], ome: ['ω', 'Omega']
};

// IAU abbreviations to genitives, so "* tau Cet" can be found as "Tau Ceti".
const GENITIVE = {
  And: 'Andromedae', Ant: 'Antliae', Aps: 'Apodis', Aqr: 'Aquarii', Aql: 'Aquilae', Ara: 'Arae', Ari: 'Arietis',
  Aur: 'Aurigae', Boo: 'Boötis', Cae: 'Caeli', Cam: 'Camelopardalis', Cnc: 'Cancri', CVn: 'Canum Venaticorum',
  CMa: 'Canis Majoris', CMi: 'Canis Minoris', Cap: 'Capricorni', Car: 'Carinae', Cas: 'Cassiopeiae', Cen: 'Centauri',
  Cep: 'Cephei', Cet: 'Ceti', Cha: 'Chamaeleontis', Cir: 'Circini', Col: 'Columbae', Com: 'Comae Berenices',
  CrA: 'Coronae Australis', CrB: 'Coronae Borealis', Crv: 'Corvi', Crt: 'Crateris', Cru: 'Crucis', Cyg: 'Cygni',
  Del: 'Delphini', Dor: 'Doradus', Dra: 'Draconis', Equ: 'Equulei', Eri: 'Eridani', For: 'Fornacis',
  Gem: 'Geminorum', Gru: 'Gruis', Her: 'Herculis', Hor: 'Horologii', Hya: 'Hydrae', Hyi: 'Hydri', Ind: 'Indi',
  Lac: 'Lacertae', Leo: 'Leonis', LMi: 'Leonis Minoris', Lep: 'Leporis', Lib: 'Librae', Lup: 'Lupi', Lyn: 'Lyncis',
  Lyr: 'Lyrae', Men: 'Mensae', Mic: 'Microscopii', Mon: 'Monocerotis', Mus: 'Muscae', Nor: 'Normae', Oct: 'Octantis',
  Oph: 'Ophiuchi', Ori: 'Orionis', Pav: 'Pavonis', Peg: 'Pegasi', Per: 'Persei', Phe: 'Phoenicis', Pic: 'Pictoris',
  Psc: 'Piscium', PsA: 'Piscis Austrini', Pup: 'Puppis', Pyx: 'Pyxidis', Ret: 'Reticuli', Sge: 'Sagittae',
  Sgr: 'Sagittarii', Sco: 'Scorpii', Scl: 'Sculptoris', Sct: 'Scuti', Ser: 'Serpentis', Sex: 'Sextantis',
  Tau: 'Tauri', Tel: 'Telescopii', Tri: 'Trianguli', TrA: 'Trianguli Australis', Tuc: 'Tucanae',
  UMa: 'Ursae Majoris', UMi: 'Ursae Minoris', Vel: 'Velorum', Vir: 'Virginis', Vol: 'Volantis', Vul: 'Vulpeculae'
};

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** Minimal RFC 4180 CSV: quoted fields, doubled quotes, commas inside quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

async function request(url, init, label) {
  // One retry: the proxy occasionally drops a long-running TAP response.
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, init);
      const text = await res.text();
      if (!res.ok) throw new Error(`${label} ${res.status}: ${text.slice(0, 400)}`);
      return text;
    } catch (err) {
      if (attempt >= 2) throw err;
      console.warn(`${label}: ${err.message}; retrying`);
    }
  }
}

const tap = (url, label, adql, maxrec) => request(url, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', MAXREC: String(maxrec), QUERY: adql })
}, label).then(parseCsv);

const num = (s) => (s === '' || s == null ? NaN : Number(s));
const tidy = (s) => String(s).replace(/\s+/g, ' ').trim();

/** Ballesteros (2012): colour index to effective temperature. */
const teffFromBV = (bv) => 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
const BV_BY_CLASS = { O: -0.3, B: -0.2, A: 0.05, F: 0.4, G: 0.65, K: 1.05, M: 1.5 };

/** Blackbody colour for a temperature, brightest channel at 255 (after Tanner Helland's fit). */
function rgbFromTeff(teff) {
  const t = Math.min(Math.max(teff, 1500), 40000) / 100;
  const r = t <= 66 ? 255 : 329.7 * (t - 60) ** -0.1332;
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * (t - 60) ** -0.0755;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  const rgb = [r, g, b].map((c) => Math.min(Math.max(c, 0), 255));
  const peak = Math.max(...rgb);
  return rgb.map((c) => Math.round((c / peak) * 255));
}

// Main-sequence absolute V by temperature, for the few hosts with no V.
const MS = [[2600, 18], [3000, 14], [3500, 10.5], [4000, 8.5], [4500, 7.2], [5000, 6.2], [5800, 4.8], [6500, 3.8], [7500, 2.6], [9500, 1.2], [15000, -1], [30000, -4]];
function msAbsMag(teff) {
  if (teff <= MS[0][0]) return MS[0][1];
  for (let i = 1; i < MS.length; i++) {
    const [t1, m1] = MS[i - 1];
    const [t2, m2] = MS[i];
    if (teff <= t2) return m1 + ((m2 - m1) * (teff - t1)) / (t2 - t1);
  }
  return MS[MS.length - 1][1];
}

/** "* alf02 Cen A" → { short: "α² Cen A", long: "Alpha² Centauri A", bayer: true }. */
function designation(id) {
  const m = tidy(id).match(/^\* ([a-z.]{2,3}|\d+)(\d{2})? ([A-Z][A-Za-z]{1,2})(?: (.+))?$/);
  if (!m) return null;
  const [, head, sup, con, rest] = m;
  const greek = GREEK[head];
  const genitive = GENITIVE[con];
  if ((!greek && !/^\d+$/.test(head)) || !genitive) return null;
  const upper = sup ? [...String(Number(sup))].map((d) => SUPERSCRIPT[d]).join('') : '';
  const tail = rest ? ` ${rest}` : '';
  return {
    bayer: Boolean(greek),
    short: `${greek ? greek[0] : head}${upper} ${con}${tail}`,
    long: `${greek ? greek[1] : head}${upper} ${genitive}${tail}`
  };
}

/** The archive writes Bayer hosts its own way: "gam1 Leo", "ups And". */
function hostLabel(hostname) {
  const m = tidy(hostname).match(/^([a-z]{2,3}\.?) ?(\d)? ([A-Z][A-Za-z]{1,2})(?: (.+))?$/);
  const greek = m && (GREEK[m[1]] ?? GREEK[`${m[1]}.`]);
  if (!greek || !GENITIVE[m[3]]) return { short: tidy(hostname), long: null };
  const upper = m[2] ? SUPERSCRIPT[m[2]] : '';
  const tail = m[4] ? ` ${m[4]}` : '';
  return { short: `${greek[0]}${upper} ${m[3]}${tail}`, long: `${greek[1]}${upper} ${GENITIVE[m[3]]}${tail}` };
}

// SIMBAD files a few designations as names ("NAME iot Cas AB").
const looksLikeDesignation = (name) => /^([a-z]{2,3}\.?)\d* [A-Z][A-Za-z]{1,2}\b/.test(name);

/**
 * SIMBAD lists several NAME aliases for a few dozen stars ("Sirius", "Sirius A";
 * "Polaris", "North Star", "Lodestar"; "Proxima", "Proxima Cen", "Proxima
 * Centauri"). While anything else is left, drop components, abbreviated
 * constellations, "… Star" nicknames and catalogue-like names; then prefer a
 * name that extends another ("Proxima Centauri"), else the shortest. The rest
 * stay searchable as aliases.
 */
function bestName(names) {
  const unwanted = [
    (n) => / [A-C]{1,2}$|[0-9][A-C]{1,2}$/.test(n),
    (n) => n.split(' ').some((w) => w in GENITIVE),
    (n) => /\bstar\b/i.test(n),
    (n) => /\d/.test(n)
  ];
  let pool = [...new Set(names)];
  for (const test of unwanted) {
    const kept = pool.filter((n) => !test(n));
    if (kept.length) pool = kept;
  }
  const extended = pool.filter((n) => pool.some((m) => m !== n && n.startsWith(`${m} `)));
  const name = (extended.length ? extended : pool).sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  return name.replace(/\bstar\b/, 'Star');
}

async function main() {
  console.log('Hipparcos (VizieR)…');
  const hip = await tap(VIZIER, 'VizieR', `SELECT h.HIP, h.RArad, h.DErad, h.Plx, h.e_Plx, h.Hpmag, h."B-V", m.Vmag, m.SpType
    FROM "I/311/hip2" AS h LEFT JOIN "I/239/hip_main" AS m ON m.HIP = h.HIP
    WHERE h.Plx > ${MIN_PARALLAX_MAS} AND h.Plx > ${MIN_PARALLAX_SNR} * h.e_Plx`, 200000);
  if (hip.length < 50000) throw new Error(`Only ${hip.length} Hipparcos rows; expected ~60,000`);

  console.log('Names and designations (SIMBAD)…');
  const idPairs = (like) => tap(SIMBAD, 'SIMBAD', `SELECT i1.id AS hip, i2.id AS other FROM ident AS i1
    JOIN ident AS i2 ON i1.oidref = i2.oidref WHERE i1.id LIKE 'HIP %' AND i2.id LIKE '${like}'`, 60000);
  const [nameRows, desigRows] = [await idPairs('NAME %'), await idPairs('* %')];

  console.log('Planet hosts (NASA Exoplanet Archive)…');
  const planetRows = await tap(EXOPLANETS, 'Exoplanet Archive', `SELECT pl_name, hostname, hip_name, ra, dec, sy_dist,
    sy_vmag, st_teff, st_spectype FROM pscomppars WHERE sy_dist < ${MAX_HOST_PC}`, 20000);

  const byHip = new Map();
  const group = (rows, key) => {
    for (const r of rows) {
      const n = Number(tidy(r.hip).slice(4));
      if (!byHip.has(n)) byHip.set(n, { names: [], desigs: [] });
      byHip.get(n)[key].push(tidy(r.other));
    }
  };
  group(nameRows, 'names');
  group(desigRows, 'desigs');

  const hosts = new Map();
  for (const p of planetRows) {
    const host = hosts.get(p.hostname) ?? { ...p, planets: [] };
    host.planets.push(tidy(p.pl_name));
    hosts.set(p.hostname, host);
  }
  const hostByHip = new Map();
  for (const host of hosts.values()) {
    const hipName = tidy(host.hip_name ?? '');
    if (hipName.startsWith('HIP ')) hostByHip.set(Number(hipName.slice(4)), host);
  }
  // Hosts the archive gives no Hipparcos number are often Hipparcos stars all
  // the same: match them by position, or they would be drawn twice. 60 arcsec
  // allows for 25 years of proper motion between the catalogues' epochs; the
  // distances must agree too, so a near neighbour on the sky is not taken.
  const cells = new Map();
  const cellOf = (ra, dec) => `${Math.floor(dec)}:${Math.floor(ra)}`;
  for (const r of hip) {
    const key = cellOf(num(r.RArad), num(r.DErad));
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(r);
  }
  const matched = new Set(hostByHip.values());
  for (const host of hosts.values()) {
    if (matched.has(host)) continue;
    const ra = num(host.ra);
    const dec = num(host.dec);
    let best = null;
    const hostPc = num(host.sy_dist);
    let bestSep = 60 / 3600;
    for (let dd = -1; dd <= 1; dd++) {
      for (let dr = -1; dr <= 1; dr++) {
        for (const r of cells.get(cellOf((ra + dr + 360) % 360, dec + dd)) ?? []) {
          const dRa = ((num(r.RArad) - ra + 540) % 360 - 180) * Math.cos((dec * Math.PI) / 180);
          const sep = Math.hypot(dRa, num(r.DErad) - dec);
          const pc = 1000 / num(r.Plx);
          if (sep < bestSep && Math.abs(pc - hostPc) < 0.25 * hostPc && !hostByHip.has(Number(r.HIP))) {
            best = r;
            bestSep = sep;
          }
        }
      }
    }
    if (best) hostByHip.set(Number(best.HIP), host);
  }

  // The star field. The Sun is in it, so from any other star it shines too.
  const stars = [{ x: 0, y: 0, z: 0, M: 4.83, rgb: rgbFromTeff(5772) }];
  const named = [{
    i: 0, name: 'Sun', ids: ['Sol', 'The Solar System'], sp: 'G2V', v: -26.74, M: 4.83, ra: 0, dec: 0, pc: 0,
    planets: ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']
  }];
  const place = (ra, dec, pc) => {
    const a = (ra * Math.PI) / 180;
    const d = (dec * Math.PI) / 180;
    return { x: pc * Math.cos(d) * Math.cos(a), y: pc * Math.cos(d) * Math.sin(a), z: pc * Math.sin(d) };
  };
  const round = (v, digits) => Number(v.toFixed(digits));

  const hipIndex = new Map();
  for (const r of hip) {
    const hipNo = Number(r.HIP);
    const pc = 1000 / num(r.Plx);
    const v = Number.isFinite(num(r.Vmag)) ? num(r.Vmag) : num(r.Hpmag);
    let bv = num(r['B-V']);
    const sp = tidy(r.SpType).replace(/\.{2,}$/, '');
    if (!Number.isFinite(bv)) bv = BV_BY_CLASS[sp[0]] ?? 0.65;
    const M = v - 5 * Math.log10(pc / 10);
    hipIndex.set(hipNo, stars.length);
    stars.push({ ...place(num(r.RArad), num(r.DErad), pc), M, rgb: rgbFromTeff(teffFromBV(bv)) });

    const ids = byHip.get(hipNo);
    const host = hostByHip.get(hipNo) ?? null;
    const desigs = (ids?.desigs ?? []).map(designation).filter(Boolean);
    const bayer = desigs.find((d) => d.bayer);
    const flamsteed = desigs.find((d) => !d.bayer);
    const properNames = (ids?.names ?? []).map((n) => n.slice(5).trim()).filter((n) => !looksLikeDesignation(n));
    const properName = properNames.length ? bestName(properNames) : null;
    const useFlamsteed = flamsteed && (v < FLAMSTEED_MAX_V || pc < FLAMSTEED_MAX_PC);
    if (!properName && !bayer && !useFlamsteed && !host) continue;

    const hostName = host ? hostLabel(host.hostname) : null;
    const label = properName ?? bayer?.short ?? (useFlamsteed ? flamsteed.short : null) ?? hostName.short;
    const aliases = [...properNames, bayer?.short, bayer?.long, useFlamsteed && flamsteed.short,
      useFlamsteed && flamsteed.long, host && tidy(host.hostname), hostName?.long, `HIP ${hipNo}`].filter((a) => a && a !== label);
    named.push({
      i: stars.length - 1, name: label, ids: [...new Set(aliases)], sp: sp || null, v: round(v, 2), M: round(M, 2),
      ra: round(num(r.RArad), 5), dec: round(num(r.DErad), 5), pc: round(pc, pc < 10 ? 3 : 1),
      ...(host ? { planets: host.planets } : {})
    });
    if (host) host.placed = true;
  }

  // Hosts too faint for Hipparcos (TRAPPIST-1, most Kepler and TESS systems).
  for (const host of hosts.values()) {
    if (host.placed) continue;
    const pc = num(host.sy_dist);
    const teff = num(host.st_teff);
    if (!Number.isFinite(pc) || pc <= 0) continue;
    const v = num(host.sy_vmag);
    const M = Number.isFinite(v) ? v - 5 * Math.log10(pc / 10) : msAbsMag(Number.isFinite(teff) ? teff : 5000);
    stars.push({ ...place(num(host.ra), num(host.dec), pc), M, rgb: rgbFromTeff(Number.isFinite(teff) ? teff : 5000) });
    const hostName = hostLabel(host.hostname);
    named.push({
      i: stars.length - 1, name: hostName.short, ids: [hostName.short === tidy(host.hostname) ? null : tidy(host.hostname), hostName.long].filter(Boolean),
      sp: tidy(host.st_spectype) || null,
      v: Number.isFinite(v) ? round(v, 2) : null, M: round(M, 2), ra: round(num(host.ra), 5), dec: round(num(host.dec), 5),
      pc: round(pc, pc < 10 ? 3 : 1), planets: host.planets
    });
  }

  // Binary: count, then x, y, z (pc, equatorial axes as the map), absolute V
  // as float32 per star, then r, g, b bytes per star.
  const count = stars.length;
  const buffer = Buffer.alloc(4 + count * 16 + count * 3);
  buffer.writeUInt32LE(count, 0);
  stars.forEach((s, i) => {
    const o = 4 + i * 16;
    buffer.writeFloatLE(s.x, o);
    buffer.writeFloatLE(s.y, o + 4);
    buffer.writeFloatLE(s.z, o + 8);
    buffer.writeFloatLE(s.M, o + 12);
    buffer.set(s.rgb, 4 + count * 16 + i * 3);
  });

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(resolve(OUT_DIR, 'nearby-stars.bin'), buffer);
  // Columns rather than objects: repeating eleven keys 5,000 times was half the file.
  const fields = ['i', 'name', 'ids', 'sp', 'v', 'M', 'ra', 'dec', 'pc', 'planets'];
  await writeFile(resolve(OUT_DIR, 'named-stars.json'), `${JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    sources: ['Hipparcos new reduction (VizieR I/311) and main catalogue (I/239)', 'SIMBAD', 'NASA Exoplanet Archive'],
    count,
    fields,
    rows: named.map((n) => fields.map((f) => n[f] ?? null))
  })}\n`);

  const hostsPlaced = named.filter((n) => n.planets && n.i > 0).length;
  console.log(`Wrote ${count} stars (${hip.length} Hipparcos, ${count - hip.length - 1} more planet hosts) and ${named.length} named, ${hostsPlaced} with planets.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
