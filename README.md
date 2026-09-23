# 🌌 CosmoVerse-3D: Interactive SDSS DR18 Galaxy & Quasar Map

[![Three.js](https://img.shields.io/badge/Three.js-r185-black?style=for-the-badge&logo=three.js)](https://threejs.org/)
[![WebGL](https://img.shields.io/badge/WebGL-Custom%20Shaders-990000?style=for-the-badge&logo=webgl)](https://www.khronos.org/webgl/)
[![Vite](https://img.shields.io/badge/Vite-8.2-646CFF?style=for-the-badge&logo=vite)](https://vitejs.dev/)
[![Cosmology](https://img.shields.io/badge/Cosmology-Planck%202018-005580?style=for-the-badge)]()
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)]()

**CosmoVerse-3D** is a high-performance interactive 3D WebGL cosmic map of **240,000 galaxies and quasars** laid out like the Sloan Digital Sky Survey (SDSS DR18) footprint. The default catalogue is **synthetic** — generated in the browser with a modelled cosmic web — and one click swaps it for real objects from SIMBAD. Powered by custom GLSL shaders and real-time **Planck 2018 Cosmological Model** computations, it maps redshift slices into accurate comoving distances and lookback times out to $z = 7.0$ (over 12.96 billion years back into cosmic history).

---

## 📸 Screenshots

### 1. Cosmic Web Survey Wedge & Glassmorphic Telemetry
![CosmoVerse-3D Cosmic Survey Wedge](docs/screenshots/survey_wedge.png)

### 2. Deep Quasar Dawn View ($z = 6.52$, 8.64 Gpc Comoving Distance)
![CosmoVerse-3D Quasar Dawn View](docs/screenshots/quasar_dawn.png)

---

## ✨ Key Features

- 💫 **240,000 GPU Point Cloud Particle Engine**
  Custom GLSL shaders (`galaxy.vert`, `galaxy.frag`) render high-density particle clouds with distance-based attenuation, dynamic glow halos, and spectral color mapping based on celestial object classification.

- 🔭 **Planck 2018 Cosmological Model Integration**
  Accurate astronomical calculations based on $H_0 = 67.4 \text{ km/s/Mpc}$ and $\Omega_m = 0.315$. Automatically computes:
  - Redshift $z \rightarrow$ Comoving Distance ($\text{Mpc} / \text{Gpc}$)
  - Lookback Time ($\text{Gyr}$)
  - Angular Diameter & Luminosity Distances

- ⚡ **Streamed Progressive Data Engine**
  Plots the catalogue one object at a time, from 0.2 objects/sec up to 25,000 objects/sec, in cosmic-time, telescope-scan, filament-first or random order, with a timeline scrubber. The counts, redshift frontier and histogram describe exactly the points on screen.

- 📊 **Real-time Redshift Histogram & Slice Filtering**
  Distribution of the plotted objects across redshift bins, and a slice filter from $z = 0$ to $z = 7.5$ to isolate a cosmic epoch.

- 🛸 **Cyberpunk Glassmorphic Sci-Fi HUD**
  Sleek dark-mode interface with live cosmic telemetry counters, camera presets (**Boötes Void**, **Sloan Great Wall**, **Quasar Dawn**, **Earth Origin**, **Survey Wedge**), auto-orbit controls, and CSV import (paste or choose a file). On phones the panels collapse out of the way of the map.

- 🛰️ **Live SIMBAD Catalog (real observations)**
  One click swaps the synthetic catalog for ~40,000 real galaxies and quasars
  queried live from the [SIMBAD TAP service](https://simbad.cds.unistra.fr/simbad/sim-tap)
  at CDS Strasbourg — real RA/Dec and measured redshifts out to $z \approx 7$,
  projected through the same Planck 2018 model.

- 🏷️ **Named Objects & Labels**
  A curated set of identified objects — Messier galaxies, clusters, superclusters, voids and famous quasars — is plotted at true coordinates alongside whichever catalog is loaded. Labels are zoom-gated: nearby galaxies surface once you fly into the local volume, large-scale structures label at survey scale. Click any named object for its catalogue IDs, coordinates, redshift, distance and lookback time.

- 🔍 **Search by Name**
  **Search** (or `/`) finds any named object by name or catalogue ID — `M31`, `Andromeda`, `Coma`, `3C 273`, `Milky Way` — plus the Boötes Void and Sloan Great Wall, then flies there and opens its card, widening the redshift slice if the object would otherwise be hidden.

- 🌌 **The Milky Way — and what is inside it**
  Our own galaxy sits where it belongs: a barred spiral in the true galactic plane, its centre 8.2 kpc from the Sun at the map's origin. Zoom in close and see what happens — a wormhole ride takes you to a whole Solar System, with moons, belts, dwarf planets, a comet, the real night sky around it, a detail card for everything, and a grand tour.

- ⭐ **The stars around the Sun**
  63,000 real stars within 1 kpc, each at its measured distance and drawn as bright as it looks *from wherever you are* — near the Sun it is the night sky; fly to Alpha Centauri and the Sun is a bright star behind you. Search any named star (`Sirius`, `Tau Ceti`, `Alpha Centauri`, `TRAPPIST-1`) to fly there; cards give its brightness, distance, how long its light took, and its known planets.

- 🎬 **A guided tour**
  **Tour** in the header flies *From Earth to the edge of the universe*: fifteen narrated chapters from Earth, the Moon and the planets, out through the Oort Cloud to Alpha Centauri, Sirius and Betelgeuse, then the Milky Way, Andromeda, the cosmic web and the most distant quasars — one continuous journey, read aloud if your browser can speak. Touch the view to take over; ▶ picks it up again; ←/→ skip chapters, Space pauses, Esc ends it.

- 🔭 **One zoom, from the cosmic web to the planets**
  Press **Earth Origin** and keep scrolling: through the Milky Way, down to a few light-years from the Sun, where the Solar System fades in around it, and on in to the planets — no cuts. Scroll out and it runs the other way. Keep the wheel turning and the zoom speeds up.

- 📱 **Camera Passthrough AR**
  View the map through your device camera. The survey floats as a fixed object in the room — move the phone to look around it, pinch to change its apparent size, and tap **Recentre** to bring it back in front of you. **Fly to object** on a label's card re-centres the AR map on that object. Needs a secure context (HTTPS) and a motion sensor; without a gyroscope it falls back to drag-to-look over the live feed.

- 🖐️ **Hand-Gesture Sky Control (AR)**
  Tap **Gestures** in the AR dock (it switches to the front camera so you can watch the screen). Hold your **right palm open** to arm, then **sweep your left hand** to turn the sky — it is heavy, so it takes a deliberate sweep to start and keeps coasting after your hands drop. **Pull both hands apart or together** to zoom. A small preview top-left shows what the tracker sees and what to do next. The MediaPipe hand model downloads the first time you switch gestures on.

---

## 🌐 Data Sources

| Source | How it loads | Notes |
| :--- | :--- | :--- |
| **Synthetic SDSS DR18 catalog** | Generated in-browser at startup | 240,000 objects with a modelled cosmic web, Boötes Void and Sloan Great Wall. Instant and offline. |
| **SIMBAD (CDS Strasbourg)** | 🔴/🟢 **SIMBAD** push button in the header | ~40,000 **real** galaxies and quasars with measured redshifts, fetched live over the SIMBAD TAP `/sync` endpoint. Push again to switch back. |
| **Nearby stars** (Hipparcos, SIMBAD, NASA Exoplanet Archive) | Fetched when you zoom within a few kpc of the Sun | 63,000 real stars within 1 kpc at their parallax distances, with names, designations and 3,800 planet hosts. Built by `npm run fetch:stars`; credits in `public/data/stars/CREDITS.md`. |
| **Custom CSV** | 📂 **Import CSV** button | Any table with `ra`, `dec`, `z` (or `redshift`) and an optional `class` column; SDSS CasJobs `#` comment lines are skipped. Up to 1,000,000 rows. |

### How the SIMBAD query works

`src/data/simbadSource.js` posts ADQL to `https://simbad.cds.unistra.fr/simbad/sim-tap/sync`.
ADQL's `TOP` has no `ORDER BY`, so a single query returns whichever rows the
server indexes first — heavily biased to the nearby universe. The fetch is
therefore split into **redshift bands** that are requested in parallel:

```
galaxies  z ∈ (0.0005, 0.02] (0.02, 0.1] (0.1, 0.5] (0.5, 2.0] (2.0, 7.5]
quasars   z ∈ (0.1, 1.0]  (1.0, 2.5]  (2.5, 4.0]  (4.0, 7.5]
```

Galaxy bands filter on `otype = 'Galaxy..' AND otype != 'QSO..'` — the `..`
suffix matches a whole SIMBAD type hierarchy, and the QSO subtree sits under
Galaxy, so it is subtracted to keep the two families disjoint. A band that
fails is reported via `failedBands` rather than failing the whole load, and
rows with non-finite or out-of-range coordinates are dropped before they reach
the GPU buffers.

No API key is required, and SIMBAD serves `Access-Control-Allow-Origin: *`, so
the browser talks to it directly with no proxy.

---

## 🛠️ Technology Stack

| Technology | Purpose |
| :--- | :--- |
| **Three.js (r185)** | 3D WebGL rendering engine & camera management |
| **Custom GLSL Shaders** | High-performance vertex & fragment particle rendering |
| **JavaScript (ES Modules)** | Core application logic & cosmological equations |
| **Vite** | Next-generation fast frontend tooling & development server |
| **Vanilla CSS3** | Glassmorphism UI tokens, micro-animations & dark mode styling |
| **MediaPipe Tasks Vision** | Hand landmarks for gesture control, loaded only when gestures are switched on |

---

## 🚀 Getting Started

### Prerequisites

[Node.js](https://nodejs.org/) 20.19+ or 22.12+ (required by Vite 8).

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/akash-mehra/AR-CosmoVerse-3D.git
   cd AR-CosmoVerse-3D
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Refresh the named-object catalogue** (optional)
   ```bash
   npm run fetch:named
   ```
   Queries SIMBAD for real galaxies, clusters and quasars and rewrites `src/data/namedObjects.json`. The repository ships it populated (1,371 objects), so this is only needed to refresh it.

4. **Start local development server**
   ```bash
   npm run dev
   ```
   Open your browser at `http://localhost:5173` to explore the universe!

5. **Build for production**
   ```bash
   npm run build
   ```

---

## 🎮 Controls & Keyboard Shortcuts

| Input | Action |
| :--- | :--- |
| **Left Click + Drag** / one finger | Orbit camera |
| **Right Click + Drag** / two fingers | Pan camera |
| **Scroll Wheel** / pinch | Zoom toward the pointer |
| **Double-click** | Fly in at the pointer (**Shift**: fly out) |
| **Click / tap a label** | Open the object's card: IDs, coordinates, redshift, distance, lookback time |
| **`[Space]`** | Play / pause plotting |
| **`[R]`** | Reset plotting to zero |
| **`[F]`** | Fullscreen |
| **`[H]`** | Hide / show the UI (clean view for screen recording) |
| **`[O]`** | Toggle auto-orbit |
| **`[T]`** | Toggle a transparent canvas background (for compositing recordings) |
| **`[/]`** | Search by name |
| **`[Esc]`** | Leave the Solar System |

Add `?debug` to the URL to show the gesture tuning numbers (reading gap, demanded and actual sky speed) under the hand preview.

---

## 📂 Project Structure

```
CosmoVerse-3D/
├── docs/
│   └── screenshots/         # High-resolution application screenshots
│       ├── survey_wedge.png
│       └── quasar_dawn.png
├── scripts/
│   ├── fetchNamedObjects.mjs # Builds the named-object catalogue from SIMBAD TAP
│   └── fetchNearbyStars.mjs  # Builds the nearby-stars layer (Hipparcos, SIMBAD, NASA)
├── src/
│   ├── ar/                  # Camera passthrough AR, hand tracking & gesture control
│   ├── controller/          # PlottingController stream logic
│   ├── cosmology/           # Planck 18 cosmological distance model
│   ├── data/                # Catalog sources
│   │   ├── sdssGenerator.js # Synthetic SDSS DR18 generator + CSV import + buildCatalog()
│   │   └── simbadSource.js  # Live SIMBAD TAP (ADQL) client
│   ├── rendering/           # Three.js scene, camera damping & GLSL shaders
│   │   └── shaders/         # galaxy.vert & galaxy.frag
│   ├── ui/                  # HUD, named-object labels & detail card, notices
│   ├── main.js              # Application entry point
│   └── style.css            # Sci-fi glassmorphic styling system
├── index.html               # Main HTML entry point
├── package.json
└── README.md
```

---

## 📄 License

Distributed under the MIT License.

Planet texture maps in `public/textures/solar/` are by [Solar System Scope](https://www.solarsystemscope.com/textures/), based on NASA imagery, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — see `CREDITS.md` there.

---

<p align="center">
  Designed & Built with 🌌 for Astronomy & Astrophysics Explorers by <a href="https://github.com/developerrahulofficial">developerrahulofficial</a>
</p>
