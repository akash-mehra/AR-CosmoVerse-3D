import * as THREE from 'three';
import { EARTH_G, GRAVITY_EXPONENT } from './tuning.js';

// Surface gravity in m/s², from NASA's planetary and satellite fact sheets.
const SURFACE_G = {
  Sun: 274, Mercury: 3.7, Venus: 8.87, Earth: 9.81, Moon: 1.62, Mars: 3.71, Phobos: 0.0057, Deimos: 0.003,
  Jupiter: 24.79, Io: 1.796, Europa: 1.314, Ganymede: 1.428, Callisto: 1.235,
  Saturn: 10.44, Mimas: 0.064, Enceladus: 0.113, Tethys: 0.146, Dione: 0.232, Rhea: 0.264, Titan: 1.352, Iapetus: 0.223,
  Uranus: 8.87, Miranda: 0.079, Ariel: 0.269, Umbriel: 0.23, Titania: 0.367, Oberon: 0.346,
  Neptune: 11.15, Triton: 0.779, Pluto: 0.62, Charon: 0.288, Ceres: 0.28, Haumea: 0.401, Makemake: 0.5, Eris: 0.82
};

// Nothing solid to set down on.
const GASEOUS = new Set(['Sun', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']);

// How far each world's pull reaches, in its own radii, fading out over the
// last FADE share. The worlds ride their orbits at game time, Earth at a
// crawl, while a ship flies in real seconds: the Sun's pull felt all the way
// out would drop a coasting ship into it within half a minute. So between the
// worlds the ship coasts, and each world is a well of its own.
const REACH_RADII = 7;
const SUN_REACH_RADII = 3.2;
const FADE = 0.4;

const smoothstep = (x, a, b) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * Every world in the Solar System that pulls on the ship: an inverse-square
 * point mass at its centre, with a surface gravity compressed by a power law
 * of its real one so that the Sun, Jupiter and the Moon keep their order but
 * none of them makes the game unflyable. Positions are refreshed once a frame
 * and held through the physics substeps; the worlds barely move between.
 */
export class GravityField {
  constructor(solar) {
    this.sources = [];
    for (const body of solar.bodies) {
      const g = SURFACE_G[body.name];
      if (!body.mesh || !body.radius || g === undefined) continue;
      const surface = EARTH_G * (g / SURFACE_G.Earth) ** GRAVITY_EXPONENT;
      this.sources.push({
        body,
        name: body.name,
        radius: body.radius,
        reach: body.radius * (body.name === 'Sun' ? SUN_REACH_RADII : REACH_RADII),
        mu: surface * body.radius ** 2,
        surface,
        solid: !GASEOUS.has(body.name),
        position: new THREE.Vector3(),
        last: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        primed: false
      });
    }
    this.byName = new Map(this.sources.map((s) => [s.name, s]));
    this.sun = this.byName.get('Sun');
    // How hard the strongest world pulled at the last sample.
    this.strength = 0;
  }

  /** Where every world is this frame and how fast it is moving. Call once a frame, after the Solar System steps. */
  refresh(dt) {
    for (const s of this.sources) {
      s.last.copy(s.position);
      s.body.mesh.getWorldPosition(s.position);
      if (s.primed && dt > 0) s.velocity.subVectors(s.position, s.last).divideScalar(dt);
      else s.velocity.set(0, 0, 0);
      s.primed = true;
    }
  }

  /** Forget last frame's positions, so a jump in time does not read as a burst of speed. */
  reset() {
    for (const s of this.sources) s.primed = false;
  }

  /**
   * Gravitational acceleration at `p`, written into `out`, with every world
   * carried `ahead` seconds along its current motion (for the trajectory
   * drawn ahead). Returns the world pulling hardest; out between the worlds
   * that is the Sun, pulling with nothing.
   */
  sample(p, out, ahead = 0) {
    out.set(0, 0, 0);
    let strongest = this.sun;
    let best = 0;
    for (const s of this.sources) {
      const dx = s.position.x + s.velocity.x * ahead - p.x;
      const dy = s.position.y + s.velocity.y * ahead - p.y;
      const dz = s.position.z + s.velocity.z * ahead - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= s.reach * s.reach || d2 < 1e-18) continue;
      const d = Math.sqrt(d2);
      // Inside a world the pull stops growing; contact is resolved before then anyway.
      const a = (s.mu / Math.max(d2, s.radius * s.radius)) * (1 - smoothstep(d, s.reach * (1 - FADE), s.reach));
      const k = a / d;
      out.x += dx * k;
      out.y += dy * k;
      out.z += dz * k;
      if (a > best) {
        best = a;
        strongest = s;
      }
    }
    this.strength = best;
    return strongest;
  }
}
