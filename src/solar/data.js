/*
 * Everything the Solar System shows, in one place: orbital elements, sizes,
 * surfaces and the facts on each detail card. Figures are from NASA's
 * planetary fact sheets and JPL's approximate elements (J2000).
 */

export const DEG = Math.PI / 180;
// Obliquity of the ecliptic, for turning RA/Dec into this scene's frame.
export { OBLIQUITY } from './scale.js';
const EARTH_RADIUS_KM = 6371;

// One Earth year of simulated time per this many seconds at 1×.
export const EARTH_YEAR_SECONDS = 30;

// Real sizes and distances cannot share a screen: at true scale every planet
// is sub-pixel. Both are compressed by power laws so order and proportion
// still read — Jupiter is still the giant, Neptune still far out.
export const displayRadius = (earthRadii) => 0.55 * earthRadii ** 0.55;
export const displayOrbit = (au) => 8 + 13 * au ** 0.62;
export const kmToDisplayRadius = (km) => Math.max(displayRadius(km / EARTH_RADIUS_KM), 0.035);
// Real day lengths span 0.4 to 243 days; spin is compressed the same way so
// Venus still barely turns and Jupiter still whips round.
export const spinSeconds = (days) => 8 * days ** 0.35;
// Moon systems are compressed logarithmically, which keeps their order (Mimas
// just outside Saturn's rings, Callisto far out) without flinging Iapetus
// halfway to Uranus.
export const moonOrbitRadius = (parentRadius, ratio) => parentRadius * (1 + 1.1 * Math.log(ratio));
// Io really laps Jupiter in 1.8 days, which at planet time scale would strobe.
export const moonPeriodSeconds = (days) => 1.6 * Math.abs(days) ** 0.55;
export const SUN_RADIUS = 4.2;

/** Seconds of light travel to cover `au`, formatted like "8 min 19 s". */
export function lightTime(au) {
  const s = au * 499.005;
  if (s < 3600) return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}

export const SUN = {
  name: 'Sun',
  info: {
    type: 'Star · G2V yellow dwarf',
    rows: [
      ['Diameter', '1,392,700 km (109 Earths)'],
      ['Surface', '≈ 5,500 °C'],
      ['Core', '≈ 15 million °C'],
      ['Rotation', '≈ 25 days at the equator'],
      ['Age', '4.6 billion years'],
      ['Gravity', '274 m/s²']
    ],
    fact: 'Holds 99.86% of the Solar System\'s mass. Its light takes 8 min 19 s to reach Earth.'
  }
};

/*
 * `L0` and `rate` are the mean longitude (deg) and its rate (deg per Julian
 * century), so each planet starts where it actually is today. Retrograde spin
 * is expressed by the tilt (Venus 177°, Uranus 98°), never by a negative day
 * as well, which would cancel out.
 */
export const PLANETS = [
  {
    name: 'Mercury', radius: 0.383, radiusKm: 2440, au: 0.387, period: 0.2408, day: 58.65, tilt: 0.03, incl: 7.0, node: 48.33,
    L0: 252.2503, rate: 149472.6741, colour: [140, 134, 128], texture: 'mercury.jpg',
    info: {
      type: 'Terrestrial planet',
      rows: [['Diameter', '4,879 km'], ['Year', '88 days'], ['Day', '58.6 Earth days (rotation)'], ['Moons', 'none'],
        ['Temperature', '−173 to 427 °C'], ['Gravity', '3.7 m/s²']],
      fact: 'With no air to hold heat, its night side freezes at −173 °C while the day side bakes at 427 °C.'
    }
  },
  {
    name: 'Venus', radius: 0.949, radiusKm: 6052, au: 0.723, period: 0.6152, day: 243.0, tilt: 177.4, incl: 3.39, node: 76.68,
    L0: 181.9791, rate: 58517.8154, colour: [232, 205, 160], texture: 'venus.jpg',
    atmosphere: { pressureMb: 92000, extentKm: 7 * 15.9, colour: [1.0, 0.9, 0.7], sunset: [1.0, 0.6, 0.3] },
    info: {
      type: 'Terrestrial planet',
      rows: [['Diameter', '12,104 km'], ['Year', '225 days'], ['Day', '243 days, backwards'], ['Moons', 'none'],
        ['Temperature', '464 °C'], ['Gravity', '8.9 m/s²']],
      fact: 'The hottest planet — a runaway greenhouse under clouds of sulphuric acid — and it spins backwards, so the Sun rises in the west.'
    }
  },
  {
    name: 'Earth', radius: 1.0, radiusKm: 6378, au: 1.0, period: 1.0, day: 0.997, tilt: 23.44, incl: 0, node: 0,
    L0: 100.4646, rate: 35999.3724, colour: [47, 111, 181], texture: 'earth.jpg', clouds: 'earth_clouds.jpg',
    atmosphere: { pressureMb: 1014, extentKm: 7 * 8.5, colour: [0.32, 0.56, 1.0], sunset: [1.0, 0.45, 0.2] },
    info: {
      type: 'Terrestrial planet · home',
      rows: [['Diameter', '12,756 km'], ['Year', '365.25 days'], ['Day', '23 h 56 min'], ['Moons', '1'],
        ['Temperature', '15 °C average'], ['Gravity', '9.8 m/s²']],
      fact: 'The only world known to harbour life. 71% of its surface is ocean.'
    }
  },
  {
    name: 'Mars', radius: 0.532, radiusKm: 3396, au: 1.524, period: 1.8808, day: 1.026, tilt: 25.19, incl: 1.85, node: 49.56,
    L0: -4.5534, rate: 19140.3027, colour: [181, 83, 42], texture: 'mars.jpg',
    // Butterscotch dust by day; Martian sunsets are blue.
    atmosphere: { pressureMb: 6.36, extentKm: 7 * 11.0, colour: [0.86, 0.62, 0.44], sunset: [0.45, 0.6, 0.95] },
    info: {
      type: 'Terrestrial planet',
      rows: [['Diameter', '6,792 km'], ['Year', '687 days'], ['Day', '24 h 37 min'], ['Moons', '2'],
        ['Temperature', '−65 °C average'], ['Gravity', '3.7 m/s²']],
      fact: 'Home to Olympus Mons, the tallest volcano known — about 22 km high, two and a half times Everest.'
    }
  },
  {
    name: 'Jupiter', radius: 11.21, radiusKm: 71492, au: 5.203, period: 11.862, day: 0.414, tilt: 3.13, incl: 1.3, node: 100.47,
    L0: 34.3964, rate: 3034.7461, colour: [201, 162, 122], texture: 'jupiter.jpg',
    info: {
      type: 'Gas giant',
      rows: [['Diameter', '142,984 km'], ['Year', '11.9 years'], ['Day', '9 h 56 min'], ['Moons', '95+ known · 4 largest shown'],
        ['Temperature', '−110 °C at the cloud tops'], ['Gravity', '24.8 m/s²']],
      fact: 'More than twice the mass of all the other planets together. The Great Red Spot is a storm wider than Earth.'
    }
  },
  {
    name: 'Saturn', radius: 9.45, radiusKm: 60268, au: 9.537, period: 29.457, day: 0.444, tilt: 26.73, incl: 2.49, node: 113.66,
    L0: 49.9542, rate: 1222.4936, colour: [227, 211, 163], texture: 'saturn.jpg', rings: true,
    info: {
      type: 'Gas giant',
      rows: [['Diameter', '120,536 km'], ['Year', '29.5 years'], ['Day', '10 h 34 min'], ['Moons', '274 known · 7 shown'],
        ['Temperature', '−140 °C at the cloud tops'], ['Gravity', '9.0 m/s²']],
      fact: 'Its rings are mostly water ice, about 280,000 km across yet typically only about 10 m thick.'
    }
  },
  {
    name: 'Uranus', radius: 4.01, radiusKm: 25559, au: 19.19, period: 84.011, day: 0.718, tilt: 97.77, incl: 0.77, node: 74.02,
    L0: 313.2381, rate: 428.482, colour: [166, 225, 232], texture: 'uranus.jpg',
    info: {
      type: 'Ice giant',
      rows: [['Diameter', '51,118 km'], ['Year', '84 years'], ['Day', '17 h 14 min, backwards'], ['Moons', '29 known · 5 largest shown'],
        ['Temperature', '−195 °C'], ['Gravity', '8.7 m/s²']],
      fact: 'Knocked onto its side at 98°: each pole gets 42 years of continuous sunlight, then 42 years of night.'
    }
  },
  {
    name: 'Neptune', radius: 3.88, radiusKm: 24764, au: 30.07, period: 164.79, day: 0.671, tilt: 28.32, incl: 1.77, node: 131.78,
    L0: -55.12, rate: 218.4595, colour: [75, 112, 221], texture: 'neptune.jpg',
    info: {
      type: 'Ice giant',
      rows: [['Diameter', '49,528 km'], ['Year', '164.8 years'], ['Day', '16 h 6 min'], ['Moons', '16 known · Triton shown'],
        ['Temperature', '−200 °C'], ['Gravity', '11.0 m/s²']],
      fact: 'The windiest world, with gusts over 2,000 km/h. It was found by mathematics before anyone saw it, in 1846.'
    }
  }
];

/*
 * Major moons. `aKm` over the parent's radius sets the (compressed) orbit.
 * Moons orbit in their parent's equatorial plane — so Uranus's circle it on
 * its side — except Earth's Moon, which keeps close to the ecliptic. A
 * retrograde orbit is an inclination over 90° (Triton's 157°), never a
 * negative period as well: the two would cancel.
 */
export const MOONS = [
  { name: 'Moon', parent: 'Earth', radiusKm: 1737.4, aKm: 384400, period: 27.32, incl: 5.14, plane: 'ecliptic', surface: 'moon',
    info: { type: 'Moon of Earth', rows: [['Diameter', '3,474 km'], ['From Earth', '384,400 km'], ['Orbit', '27.3 days']],
      fact: 'Tidally locked: the same face always points at Earth. It drifts 3.8 cm further away every year.' } },
  { name: 'Phobos', parent: 'Mars', radiusKm: 11.3, aKm: 9376, period: 0.319, incl: 1.1, surface: 'rubble', lumpy: true,
    info: { type: 'Moon of Mars', rows: [['Size', '27 × 22 × 18 km'], ['Orbit', '7 h 39 min']],
      fact: 'Creeping 2 m closer to Mars every century; in about 50 million years it will be torn into a ring.' } },
  { name: 'Deimos', parent: 'Mars', radiusKm: 6.2, aKm: 23463, period: 1.262, incl: 1.8, surface: 'rubble', lumpy: true,
    info: { type: 'Moon of Mars', rows: [['Size', '15 × 12 × 11 km'], ['Orbit', '30.3 hours']],
      fact: 'So small that its escape velocity is under 6 m/s — a good jump would almost do it.' } },
  { name: 'Io', parent: 'Jupiter', radiusKm: 1821.6, aKm: 421700, period: 1.769, incl: 0.05, surface: 'io',
    info: { type: 'Galilean moon of Jupiter', rows: [['Diameter', '3,643 km'], ['Orbit', '1.8 days']],
      fact: 'The most volcanically active world known, with over 400 active volcanoes squeezed by Jupiter\'s tides.' } },
  { name: 'Europa', parent: 'Jupiter', radiusKm: 1560.8, aKm: 671034, period: 3.551, incl: 0.47, surface: 'europa',
    info: { type: 'Galilean moon of Jupiter', rows: [['Diameter', '3,122 km'], ['Orbit', '3.6 days']],
      fact: 'An ice shell over a global salt-water ocean with twice Earth\'s water — a prime place to look for life.' } },
  { name: 'Ganymede', parent: 'Jupiter', radiusKm: 2634.1, aKm: 1070412, period: 7.155, incl: 0.2, surface: 'ganymede',
    info: { type: 'Galilean moon of Jupiter', rows: [['Diameter', '5,268 km'], ['Orbit', '7.2 days']],
      fact: 'The largest moon in the Solar System — bigger than Mercury — and the only one with its own magnetic field.' } },
  { name: 'Callisto', parent: 'Jupiter', radiusKm: 2410.3, aKm: 1882709, period: 16.689, incl: 0.2, surface: 'callisto',
    info: { type: 'Galilean moon of Jupiter', rows: [['Diameter', '4,821 km'], ['Orbit', '16.7 days']],
      fact: 'The most heavily cratered surface known, almost unchanged for four billion years.' } },
  { name: 'Mimas', parent: 'Saturn', radiusKm: 198.2, aKm: 185539, period: 0.942, incl: 1.6, surface: 'mimas',
    info: { type: 'Moon of Saturn', rows: [['Diameter', '396 km'], ['Orbit', '22.6 hours']],
      fact: 'Its giant crater Herschel, a third of its width, makes it look like the Death Star.' } },
  { name: 'Enceladus', parent: 'Saturn', radiusKm: 252.1, aKm: 238042, period: 1.370, incl: 0, surface: 'enceladus',
    info: { type: 'Moon of Saturn', rows: [['Diameter', '504 km'], ['Orbit', '32.9 hours']],
      fact: 'Geysers at its south pole spray its hidden ocean into space, feeding Saturn\'s E ring.' } },
  { name: 'Tethys', parent: 'Saturn', radiusKm: 531.1, aKm: 294619, period: 1.888, incl: 1.1, surface: 'ice',
    info: { type: 'Moon of Saturn', rows: [['Diameter', '1,062 km'], ['Orbit', '45.3 hours']],
      fact: 'Almost pure water ice, split by a canyon, Ithaca Chasma, three quarters of the way round it.' } },
  { name: 'Dione', parent: 'Saturn', radiusKm: 561.4, aKm: 377396, period: 2.737, incl: 0, surface: 'ice',
    info: { type: 'Moon of Saturn', rows: [['Diameter', '1,123 km'], ['Orbit', '2.7 days']],
      fact: 'Bright ice cliffs hundreds of metres high streak its trailing side.' } },
  { name: 'Rhea', parent: 'Saturn', radiusKm: 763.8, aKm: 527108, period: 4.518, incl: 0.3, surface: 'ice',
    info: { type: 'Moon of Saturn', rows: [['Diameter', '1,527 km'], ['Orbit', '4.5 days']],
      fact: 'Saturn\'s second-largest moon: a cold, cratered ball of ice and rock.' } },
  { name: 'Titan', parent: 'Saturn', radiusKm: 2574.7, aKm: 1221870, period: 15.945, incl: 0.3, surface: 'titan',
    // Pressure ~60% above Earth's, air 600 km high, an orange haze that hides the ground (NASA).
    atmosphere: { pressureMb: 1.6 * 1014, extentKm: 600, veil: 0.96, colour: [0.95, 0.62, 0.28], sunset: [0.6, 0.3, 0.1] },
    info: { type: 'Moon of Saturn', rows: [['Diameter', '5,150 km'], ['Orbit', '15.9 days']],
      fact: 'The only moon with a thick atmosphere — and with rain, rivers and seas of liquid methane.' } },
  { name: 'Iapetus', parent: 'Saturn', radiusKm: 734.5, aKm: 3560820, period: 79.32, incl: 15.5, surface: 'iapetus',
    info: { type: 'Moon of Saturn', rows: [['Diameter', '1,469 km'], ['Orbit', '79.3 days']],
      fact: 'Two-toned: one hemisphere as dark as coal, the other as bright as snow.' } },
  { name: 'Miranda', parent: 'Uranus', radiusKm: 235.8, aKm: 129390, period: 1.413, incl: 4.2, surface: 'ice',
    info: { type: 'Moon of Uranus', rows: [['Diameter', '472 km'], ['Orbit', '33.9 hours']],
      fact: 'A patchwork world with Verona Rupes, cliffs about 20 km high — the tallest known.' } },
  { name: 'Ariel', parent: 'Uranus', radiusKm: 578.9, aKm: 191020, period: 2.520, incl: 0.3, surface: 'ice',
    info: { type: 'Moon of Uranus', rows: [['Diameter', '1,158 km'], ['Orbit', '2.5 days']],
      fact: 'The brightest and perhaps youngest surface among Uranus\'s large moons.' } },
  { name: 'Umbriel', parent: 'Uranus', radiusKm: 584.7, aKm: 266000, period: 4.144, incl: 0.4, surface: 'dark',
    info: { type: 'Moon of Uranus', rows: [['Diameter', '1,169 km'], ['Orbit', '4.1 days']],
      fact: 'The darkest of Uranus\'s large moons, apart from one bright ring on its surface.' } },
  { name: 'Titania', parent: 'Uranus', radiusKm: 788.4, aKm: 435910, period: 8.706, incl: 0.1, surface: 'ice',
    info: { type: 'Moon of Uranus', rows: [['Diameter', '1,577 km'], ['Orbit', '8.7 days']],
      fact: 'Uranus\'s largest moon, cut by canyons up to 1,500 km long.' } },
  { name: 'Oberon', parent: 'Uranus', radiusKm: 761.4, aKm: 583520, period: 13.463, incl: 0.1, surface: 'dark',
    info: { type: 'Moon of Uranus', rows: [['Diameter', '1,523 km'], ['Orbit', '13.5 days']],
      fact: 'The outermost of Uranus\'s big moons: old, dark and heavily cratered.' } },
  { name: 'Triton', parent: 'Neptune', radiusKm: 1353.4, aKm: 354759, period: 5.877, incl: 156.9, surface: 'triton',
    info: { type: 'Moon of Neptune', rows: [['Diameter', '2,707 km'], ['Orbit', '5.9 days, backwards']],
      fact: 'Orbits the wrong way round — almost certainly a captured Kuiper Belt object — and has nitrogen geysers.' } },
  { name: 'Charon', parent: 'Pluto', radiusKm: 606, aKm: 19591, period: 6.387, incl: 0, surface: 'charon', mutual: true,
    info: { type: 'Moon of Pluto', rows: [['Diameter', '1,212 km'], ['Orbit', '6.4 days']],
      fact: 'Half Pluto\'s size; the two circle a point in the space between them, each always facing the other.' } }
];

/*
 * Dwarf planets and a comet, on their real eccentric orbits: semi-major axis
 * `a` (AU), eccentricity `e`, inclination `i`, ascending node `node` and
 * argument of perihelion `peri` (deg), time of perihelion `tp` (year) and
 * `period` (years).
 */
export const MINOR_BODIES = [
  { name: 'Ceres', kind: 'dwarf', radiusKm: 469.7, a: 2.7675, e: 0.0785, i: 10.59, node: 80.31, peri: 73.6, tp: 2022.93, period: 4.604,
    day: 0.378, tilt: 4, surface: 'ceres',
    info: { type: 'Dwarf planet · asteroid belt', rows: [['Diameter', '939 km'], ['Year', '4.6 years'], ['Day', '9 h 4 min']],
      fact: 'The largest object in the asteroid belt. NASA\'s Dawn found its bright spots are salt left by briny water.' } },
  { name: 'Pluto', kind: 'dwarf', radiusKm: 1188.3, a: 39.482, e: 0.2488, i: 17.16, node: 110.3, peri: 113.83, tp: 1989.68, period: 247.94,
    day: 6.387, tilt: 122.5, surface: 'pluto',
    info: { type: 'Dwarf planet · Kuiper Belt', rows: [['Diameter', '2,377 km'], ['Year', '248 years'], ['Day', '6.4 days, backwards'],
      ['Moons', '5 · Charon shown'], ['Temperature', '≈ −230 °C']],
      fact: 'In 2015 New Horizons found its pale heart, Tombaugh Regio, whose left lobe is a vast glacier of nitrogen ice.' } },
  { name: 'Haumea', kind: 'dwarf', unvisited: true, radiusKm: 816, a: 43.13, e: 0.195, i: 28.2, node: 122.2, peri: 239.2, tp: 1850, period: 283.3,
    day: 0.163, tilt: 0, surface: 'haumea', stretch: [1.35, 1.0, 0.65],
    info: { type: 'Dwarf planet · Kuiper Belt', rows: [['Size', '≈ 2,100 × 1,700 × 1,100 km'], ['Year', '283 years'], ['Day', '3 h 55 min'], ['Moons', '2']],
      fact: 'Spins so fast — every 3.9 hours — that it is stretched into an egg. It also has a ring.' } },
  { name: 'Makemake', kind: 'dwarf', unvisited: true, radiusKm: 715, a: 45.43, e: 0.161, i: 28.98, node: 79.62, peri: 294.8, tp: 1880, period: 306.2,
    day: 0.94, tilt: 0, surface: 'makemake',
    info: { type: 'Dwarf planet · Kuiper Belt', rows: [['Diameter', '≈ 1,430 km'], ['Year', '306 years'], ['Day', '22.5 hours'], ['Moons', '1']],
      fact: 'Found just after Easter 2005, and named after the creator god of the Rapa Nui of Easter Island.' } },
  { name: 'Eris', kind: 'dwarf', unvisited: true, radiusKm: 1163, a: 67.86, e: 0.4407, i: 44.04, node: 35.95, peri: 151.64, tp: 1699.7, period: 559.1,
    day: 15.8, tilt: 0, surface: 'eris',
    info: { type: 'Dwarf planet · scattered disc', rows: [['Diameter', '2,326 km'], ['Year', '559 years'], ['Now', '≈ 96 AU, near its farthest'], ['Moons', '1']],
      fact: 'Almost exactly Pluto\'s size. Its discovery in 2005 is why "dwarf planet" was defined in 2006.' } },
  { name: "Halley's Comet", kind: 'comet', radiusKm: 5.5, a: 17.834, e: 0.96714, i: 162.26, node: 58.42, peri: 111.33, tp: 1986.11, period: 75.32,
    day: 2.2, tilt: 0, surface: 'rubble', lumpy: true,
    info: { type: 'Periodic comet · orbits backwards', rows: [['Nucleus', '15 × 8 km'], ['Period', '75–76 years'], ['Last perihelion', 'February 1986'],
      ['Next perihelion', 'July 2061']],
      fact: 'Recorded for over 2,000 years; its 1066 return is stitched into the Bayeux Tapestry. Speed up time to watch it swing past the Sun.' } }
];

export const BELTS = {
  asteroid: { name: 'Asteroid Belt', info: { type: 'Asteroid belt · 2.1–3.3 AU',
    rows: [['Objects', 'over a million larger than 1 km'], ['Total mass', '≈ 3% of the Moon']],
    fact: 'Mostly empty space. The gaps in it — Kirkwood gaps — are swept clear by resonances with Jupiter.' } },
  trojans: { name: 'Jupiter Trojans', info: { type: 'Asteroids sharing Jupiter\'s orbit',
    rows: [['Where', '60° ahead of and behind Jupiter'], ['Known', 'over 15,000']],
    fact: 'Trapped at two balance points of the Sun and Jupiter\'s gravity. NASA\'s Lucy is on its way to visit them.' } },
  kuiper: { name: 'Kuiper Belt', info: { type: 'Icy belt · 30–50 AU',
    rows: [['Members', 'Pluto, Haumea, Makemake and thousands more'], ['Explored by', 'New Horizons (2015, 2019)']],
    fact: 'A doughnut of frozen leftovers from the Solar System\'s birth, and the source of short-period comets.' } },
  oort: { name: 'Oort Cloud', info: { type: 'Shell of icy bodies · ≈ 2,000–100,000 AU',
    rows: [['Shown', 'far closer than it really is'], ['Seen directly', 'never']],
    fact: 'A vast, dark shell reaching perhaps a third of the way to the nearest star. Long-period comets fall in from it.' } },
  zodiacal: { name: 'Zodiacal Cloud', info: { type: 'Interplanetary dust disc',
    rows: [['Made of', 'dust from comets and asteroid collisions']],
    fact: 'From dark sites on Earth it glows faintly along the ecliptic after dusk and before dawn: the zodiacal light.' } }
};

/*
 * Real objects in the sky around the Solar System, at their true directions
 * (J2000 RA/Dec). They are drawn at infinity, and angular sizes are
 * exaggerated so they read on a phone.
 */
export const SKY_OBJECTS = [
  { name: 'Galactic Centre', kind: 'core', ra: 266.405, dec: -28.936, size: 16, colour: [255, 214, 150],
    info: { type: 'Heart of the Milky Way · Sgr A*', rows: [['Distance', '≈ 26,700 light years'], ['Black hole', '4 million Suns']],
      fact: 'Behind the dust of Sagittarius sits a black hole of four million solar masses, circled by the galaxy\'s bulge.' } },
  { name: 'Orion Nebula', kind: 'nebula', ra: 83.822, dec: -5.391, size: 3.5, colour: [255, 110, 150], core: [120, 220, 230],
    info: { type: 'Emission nebula · M42', rows: [['Distance', '1,344 light years'], ['Across', '≈ 24 light years']],
      fact: 'The nearest large stellar nursery — to the naked eye, the fuzzy middle "star" of Orion\'s sword.' } },
  { name: 'Carina Nebula', kind: 'nebula', ra: 161.265, dec: -59.867, size: 6, colour: [255, 140, 90], core: [255, 220, 170],
    info: { type: 'Emission nebula · NGC 3372', rows: [['Distance', '≈ 8,500 light years'], ['Across', '≈ 230 light years']],
      fact: 'Four times the size of the Orion Nebula, and home to Eta Carinae, an unstable giant expected to end as a supernova.' } },
  { name: 'Lagoon Nebula', kind: 'nebula', ra: 270.925, dec: -24.38, size: 3.5, colour: [255, 100, 140], core: [255, 200, 210],
    info: { type: 'Emission nebula · M8', rows: [['Distance', '≈ 4,100 light years']],
      fact: 'A star-forming cloud split by a dark dust lane, bright enough to see with the naked eye from dark skies.' } },
  { name: 'Eagle Nebula', kind: 'nebula', ra: 274.7, dec: -13.807, size: 3, colour: [240, 150, 90], core: [150, 210, 190],
    info: { type: 'Emission nebula · M16', rows: [['Distance', '≈ 5,700 light years']],
      fact: 'Home of the "Pillars of Creation", towers of gas and dust several light years tall where stars are forming.' } },
  { name: 'Pleiades', kind: 'cluster', ra: 56.75, dec: 24.117, size: 3.5, colour: [150, 185, 255],
    info: { type: 'Open star cluster · M45', rows: [['Distance', '444 light years'], ['Age', '≈ 100 million years']],
      fact: 'The Seven Sisters: over a thousand young, hot blue stars drifting through a cloud of dust.' } },
  { name: 'Andromeda Galaxy', kind: 'galaxy', ra: 10.685, dec: 41.269, size: 7, colour: [255, 225, 195], tilt: 0.32, angle: 38,
    info: { type: 'Spiral galaxy · M31', rows: [['Distance', '2.5 million light years'], ['Stars', '≈ 1 trillion']],
      fact: 'Our biggest neighbour, and the most distant thing the naked eye can see. It and the Milky Way should merge in 4–5 billion years.' } },
  { name: 'Large Magellanic Cloud', kind: 'cloud', ra: 80.894, dec: -69.756, size: 11, colour: [215, 220, 255],
    info: { type: 'Satellite galaxy of the Milky Way', rows: [['Distance', '≈ 160,000 light years']],
      fact: 'A small galaxy in orbit around ours, visible to the naked eye from the southern hemisphere.' } },
  { name: 'Small Magellanic Cloud', kind: 'cloud', ra: 13.187, dec: -72.829, size: 6, colour: [215, 220, 255],
    info: { type: 'Satellite galaxy of the Milky Way', rows: [['Distance', '≈ 200,000 light years']],
      fact: 'The Large Cloud\'s smaller companion; the two are joined by a bridge of gas.' } },
  { name: 'Alpha Centauri', kind: 'star', ra: 219.9, dec: -60.83, colour: [255, 238, 210], mag: 1.0,
    info: { type: 'Triple star · the nearest', rows: [['Distance', '4.37 light years'], ['Proxima', '4.24 light years']],
      fact: 'The nearest star system. Its smallest member, Proxima Centauri, has a planet in its habitable zone.' } },
  { name: 'Sirius', kind: 'star', ra: 101.287, dec: -16.716, colour: [205, 220, 255], mag: 1.0,
    info: { type: 'Binary star · A1V', rows: [['Distance', '8.6 light years']],
      fact: 'The brightest star in Earth\'s night sky, with a white dwarf companion.' } },
  { name: "Barnard's Star", kind: 'star', ra: 269.452, dec: 4.693, colour: [255, 150, 105], mag: 0.55,
    info: { type: 'Red dwarf', rows: [['Distance', '5.96 light years']],
      fact: 'The fastest-moving star across our sky: it shifts the Moon\'s width every 180 years.' } },
  { name: 'Vega', kind: 'star', ra: 279.235, dec: 38.784, colour: [210, 225, 255], mag: 0.9,
    info: { type: 'Star · A0V', rows: [['Distance', '25 light years']],
      fact: 'Earth\'s wobbling axis made it the pole star around 12,000 BC, and will again around AD 13,700.' } },
  { name: 'Betelgeuse', kind: 'star', ra: 88.793, dec: 7.407, colour: [255, 150, 90], mag: 0.95,
    info: { type: 'Red supergiant', rows: [['Distance', '≈ 550 light years'], ['Size', 'would reach past Mars']],
      fact: 'A dying giant that will explode as a supernova some time in the next 100,000 years.' } },
  { name: 'Polaris', kind: 'star', ra: 37.955, dec: 89.264, colour: [255, 245, 225], mag: 0.75,
    info: { type: 'Supergiant · the North Star', rows: [['Distance', '≈ 430 light years']],
      fact: 'Sits almost exactly above Earth\'s north pole, so the whole northern sky seems to turn around it.' } }
];
