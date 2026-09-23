/*
 * Tours are data. A chapter has a title, the narration shown (and spoken) while
 * it plays, and where it goes:
 *
 *   { body: 'Earth' }              a Solar System body, zooming in to it if needed
 *   { sunDistancePc: 2.5 }         a distance from the Sun, zooming across layers
 *   { object: 'Sirius' }           a named star or galaxy, by label or alias
 *   { landmark: 'quasar_dawn' }    one of the map's presets
 *
 * with optional `seconds` for the flight, `distanceMpc` to override how close
 * an object is viewed from, and `plot: 'all'` to finish the map's plot first.
 * Facts are the ones the cards and the data give, and are kept conservative.
 */
export const TOURS = [
  {
    id: 'outward',
    title: 'From Earth to the edge of the universe',
    chapters: [
      {
        title: 'Home',
        text: 'This is Earth, 12,742 km across, turning once a day and circling the Sun once a year. Every journey in this map starts here.',
        go: { body: 'Earth' }
      },
      {
        title: 'The Moon',
        text: 'The Moon is a quarter of Earth’s width and 384,000 km away: light crosses the gap in about 1.3 seconds.',
        go: { body: 'Moon' }
      },
      {
        title: 'The Sun',
        text: 'The Sun holds 99.8% of all the mass in the Solar System. The light leaving it now reaches Earth 8 minutes and 20 seconds later.',
        go: { body: 'Sun' }
      },
      {
        title: 'Jupiter',
        text: 'Jupiter is more than twice as massive as all the other planets put together, with 95 known moons and counting.',
        go: { body: 'Jupiter' }
      },
      {
        title: 'Saturn',
        text: 'Saturn would float in water. Its rings are mostly ice, about 280,000 km across yet typically only about ten metres thick.',
        go: { body: 'Saturn' }
      },
      {
        title: 'The edge of the planets',
        text: 'Pluto and the Kuiper Belt: icy worlds 30 to 50 times Earth’s distance from the Sun, where sunlight arrives more than five hours after it set out.',
        go: { body: 'Pluto' }
      },
      {
        title: 'Leaving the Sun',
        text: 'The Oort Cloud, a vast shell of icy bodies, may stretch a light-year or more from the Sun. Beyond it, the Sun is just one star among many.',
        // Just outside the band, so the next flight starts from the map's own lens and roll.
        go: { sunDistancePc: 3.6, seconds: 9 }
      },
      {
        title: 'Alpha Centauri',
        text: 'Our nearest neighbours: the Sun-like pair Alpha Centauri A and B, 4.4 light-years away, and the red dwarf Proxima Centauri, 4.2 light-years away, with at least two planets. From here, our Sun is a bright star in Cassiopeia.',
        go: { object: 'Alpha Centauri A', seconds: 6 }
      },
      {
        title: 'Sirius',
        text: 'Sirius, the brightest star in Earth’s night sky, is 8.6 light-years away and about 25 times as luminous as the Sun. A white dwarf circles it.',
        go: { object: 'Sirius', seconds: 5 }
      },
      {
        title: 'Our neighbourhood',
        text: 'Every point here is a real star, placed by its parallax as measured by the Hipparcos satellite: some 60,000 of them within about 3,000 light-years.',
        go: { sunDistancePc: 90, seconds: 6 }
      },
      {
        title: 'Betelgeuse',
        text: 'Betelgeuse, Orion’s shoulder, roughly 500 light-years away: a red supergiant that, put in the Sun’s place, would reach past the orbit of Mars. It is expected to explode as a supernova within about 100,000 years.',
        go: { object: 'Betelgeuse', seconds: 6 }
      },
      {
        title: 'The Milky Way',
        text: 'Our galaxy: a barred spiral about 100,000 light-years across, with a few hundred billion stars. The Sun orbits its centre 26,000 light-years out, once every 230 million years.',
        go: { object: 'Milky Way', seconds: 7 }
      },
      {
        title: 'Andromeda',
        text: 'The Andromeda Galaxy, 2.5 million light-years away, is the largest galaxy in our Local Group. It is falling toward us at about 110 km/s; the two galaxies may merge billions of years from now.',
        go: { object: 'Andromeda Galaxy', distanceMpc: 0.9, seconds: 7 }
      },
      {
        title: 'The cosmic web',
        text: 'On the largest scales, galaxies gather into filaments and walls around vast empty voids: the cosmic web. This map lays out a survey-sized slice of it by redshift, one point per galaxy.',
        go: { landmark: 'overview', plot: 'all', seconds: 6 }
      },
      {
        title: 'Quasar dawn',
        text: 'The farthest points are quasars: galaxies whose central black holes outshine all their stars. The most distant here sent their light more than 12 billion years ago, less than a billion years after the Big Bang.',
        go: { landmark: 'quasar_dawn', seconds: 6 }
      }
    ]
  }
];
