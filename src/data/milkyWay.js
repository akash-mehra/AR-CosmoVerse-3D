import { raDecDistToCartesian } from '../cosmology/planck18.js';

/*
 * Our own galaxy, which no survey and no SIMBAD query places: we sit inside
 * it, so it has no redshift and no distance row. The map's origin is the Sun,
 * so the galaxy is hand-placed from the standard galactic frame (J2000):
 * its centre (Sgr A*) lies 8.2 kpc toward RA 266.405°, Dec -28.936°, and its
 * disc is the plane whose pole is at RA 192.859°, Dec +27.128°.
 */
export const GALACTIC_CENTRE = { ra: 266.40499, dec: -28.93617 };
export const GALACTIC_NORTH_POLE = { ra: 192.85948, dec: 27.12825 };
export const SUN_TO_CENTRE_MPC = 0.0082;
export const DISC_RADIUS_MPC = 0.015;

const unit = ({ ra, dec }) => raDecDistToCartesian(ra, dec, 1);

/** Galactic axes in map coordinates: x toward the centre, z to the north pole, y = z × x. */
export function galacticBasis() {
  const x = unit(GALACTIC_CENTRE);
  const z = unit(GALACTIC_NORTH_POLE);
  const y = { x: z.y * x.z - z.z * x.y, y: z.z * x.x - z.x * x.z, z: z.x * x.y - z.y * x.x };
  return { x, y, z };
}

/**
 * The Milky Way as a named object, so it labels, searches and opens a card
 * like everything else. Positioned at its centre, where the model is drawn.
 */
export function milkyWayObject() {
  const position = raDecDistToCartesian(GALACTIC_CENTRE.ra, GALACTIC_CENTRE.dec, SUN_TO_CENTRE_MPC);
  return {
    mainId: 'Milky Way',
    label: 'Milky Way',
    name: 'Milky Way',
    ids: ['Our Galaxy', 'Sgr A* (centre)'],
    otype: 'G',
    typeLabel: 'Barred spiral · home',
    ra: GALACTIC_CENTRE.ra,
    dec: GALACTIC_CENTRE.dec,
    z: 0,
    distMpc: SUN_TO_CENTRE_MPC,
    tier: 'local',
    isQSO: false,
    weight: 120,
    position,
    distanceMpc: SUN_TO_CENTRE_MPC,
    lookbackGyr: SUN_TO_CENTRE_MPC * 0.00326156,
    // Warm, like the bulge the point sits in.
    colorParam: 0.18,
    filterZ: 0,
    // Close enough to fill the view; the map's own offset rule would park the
    // camera 12 Mpc away from a galaxy 0.03 Mpc across.
    viewDistance: 0.05,
    note: 'You are here: the Sun orbits 8.2 kpc from the centre, in the disc.'
  };
}
