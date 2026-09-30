/*
 * Every number the game is tuned by. Units are the Solar System's display
 * units and seconds. Distances there are compressed by power laws, so
 * kilometres would lie: the HUD measures in ship lengths instead.
 */

// The ship, nose to tail. Earth's display radius (0.55) is ~46 of these.
export const SHIP_LENGTH = 0.012;
export const SHIP_RADIUS = SHIP_LENGTH * 0.45;

// Simulated time while flying: one Earth year every 750 s. At 1× Earth laps
// the Sun in 30 s and everything worth flying to would race away.
export const GAME_TIME_SCALE = 0.04;

// Engines (units/s² and units/s). Thrust tapers to nothing as the speed along
// the nose reaches the cap, so holding it settles there; gravity is not capped,
// so a slingshot can go faster.
export const THRUST = 0.9;
export const REVERSE_SHARE = 0.5;
export const BOOST = 2.4;
export const CRUISE_CAP = 0.55;
export const BOOST_CAP = 1.6;
export const BRAKE = 1.2;
export const HARD_CAP = 4;

// Turning (rad/s), and how quickly the ship reaches the rate asked for.
export const PITCH_RATE = 1.5;
export const YAW_RATE = 1.2;
export const ROLL_RATE = 2.4;
export const TURN_RESPONSE = 7;

// Gravity. Each world's surface gravity is its real value compressed by a
// power law, with Earth's at EARTH_G: real ratios would put the Sun's pull at
// Earth's orbit above Earth's own surface gravity at these distances.
export const EARTH_G = 0.35;
export const GRAVITY_EXPONENT = 0.5;

// Meeting a world's surface: slower than LAND_SPEED is a touchdown, faster a crash.
export const LAND_SPEED = 0.18;
export const RESTITUTION = 0.3;

// Damage, out of HULL.
export const HULL = 100;
export const ROCK_BASE_DAMAGE = 4;
export const ROCK_SPEED_DAMAGE = 34;
export const CRASH_BASE_DAMAGE = 10;
export const CRASH_SPEED_DAMAGE = 60;
// Rocks smaller than this (ship lengths, radius) break up when hit; bigger ones throw you off.
export const SHATTER_BELOW = 6;
// After a hit, rocks cannot damage the hull again for this long.
export const HIT_GRACE = 0.35;
// Inside HEAT_RANGE Sun radii the hull cooks, up to HEAT_DAMAGE per second at the surface.
export const HEAT_RANGE = 2.2;
export const HEAT_DAMAGE = 25;

// Scoring.
export const POINTS_PER_SECOND = 10;
export const BELT_MULTIPLIER = 3;
export const NEAR_MISS_POINTS = 25;
export const LANDING_POINTS = 250;
// Faster than this relative to the world pulling hardest, a rock passing close counts as a near miss.
export const NEAR_MISS_SPEED = 0.2;

// The physics step, and the most steps one frame may take.
export const STEP = 1 / 120;
export const MAX_STEPS = 12;
