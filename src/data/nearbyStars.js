import { raDecDistToCartesian } from '../cosmology/planck18.js';

/*
 * The nearby-stars layer's data, built by `npm run fetch:stars` from Hipparcos,
 * SIMBAD and the NASA Exoplanet Archive. Positions are in parsecs on the map's
 * equatorial axes around the Sun; the map works in Mpc.
 */
const ROOT = `${import.meta.env.BASE_URL}data/stars/`;
export const MPC_PER_PC = 1e-6;
// Every star in the layer lies within 1 kpc of the Sun.
export const STAR_REACH_MPC = 0.001;
const LY_PER_PC = 3.26156;

async function fetchOk(file) {
  const res = await fetch(ROOT + file);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res;
}

/** Close enough that the star fills its own neighbourhood, but not so close a dwarf is lost in the dark. */
const viewDistancePc = (absMag) => Math.min(Math.max(10 ** ((-8 - absMag) / 5 + 1), 0.01), 0.3);

/** Named stars and planet hosts, in the shape the label layer and search use. */
export async function loadNamedStars() {
  const { fields, rows } = await (await fetchOk('named-stars.json')).json();
  return rows.map((row) => {
    const s = Object.fromEntries(fields.map((f, i) => [f, row[i]]));
    const planets = s.planets ?? [];
    const isSun = s.i === 0;
    const kind = isSun ? 'Star · G2V · home' : s.sp ? `Star · ${s.sp}` : 'Star';
    return {
      tier: 'star',
      mainId: s.name,
      label: s.name,
      name: s.name,
      ids: s.ids ?? [],
      otype: '*',
      typeLabel: planets.length && !isSun ? `${kind} · ${planets.length} planet${planets.length > 1 ? 's' : ''}` : kind,
      ra: s.ra,
      dec: s.dec,
      z: null,
      appMag: s.v,
      absMag: s.M,
      position: raDecDistToCartesian(s.ra, s.dec, s.pc * MPC_PER_PC),
      distanceMpc: s.pc * MPC_PER_PC,
      lookbackGyr: (s.pc * LY_PER_PC) / 1e9,
      planets,
      // Ranked by how bright it looks from Earth until the label layer ranks it from the camera.
      weight: 200 - 10 * (s.v ?? 15),
      viewDistance: isSun ? 5e-6 : viewDistancePc(s.M) * MPC_PER_PC,
      distanceText: isSun ? '1 AU · 8.3 light-minutes' : null,
      lightText: isSun ? '8 minutes 20 seconds ago' : null,
      coordsText: isSun ? 'Moves round the ecliptic over a year' : null,
      note: isSun
        ? 'You are here. Keep zooming in to reach the planets.'
        : planets.length
          ? `Planets: ${planets.slice(0, 6).join(', ')}${planets.length > 6 ? ` and ${planets.length - 6} more` : ''}.`
          : 'Placed by its Hipparcos parallax.'
    };
  });
}

/** Every star: positions (Mpc), absolute V magnitudes and colours. */
export async function loadStarField() {
  const buffer = await (await fetchOk('nearby-stars.bin')).arrayBuffer();
  const view = new DataView(buffer);
  const count = view.getUint32(0, true);
  if (buffer.byteLength !== 4 + count * 19) throw new Error('nearby-stars.bin: unexpected size');
  const positions = new Float32Array(count * 3);
  const absMag = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = 4 + i * 16;
    positions[i * 3] = view.getFloat32(o, true) * MPC_PER_PC;
    positions[i * 3 + 1] = view.getFloat32(o + 4, true) * MPC_PER_PC;
    positions[i * 3 + 2] = view.getFloat32(o + 8, true) * MPC_PER_PC;
    absMag[i] = view.getFloat32(o + 12, true);
  }
  const colors = new Uint8Array(buffer, 4 + count * 16, count * 3);
  return { count, positions, absMag, colors };
}
