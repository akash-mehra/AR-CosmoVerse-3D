# 🌌 CosmoVerse-3D: Interactive SDSS DR18 Galaxy & Quasar Map

[![Three.js](https://img.shields.io/badge/Three.js-r185-black?style=for-the-badge&logo=three.js)](https://threejs.org/)
[![WebGL](https://img.shields.io/badge/WebGL-Custom%20Shaders-990000?style=for-the-badge&logo=webgl)](https://www.khronos.org/webgl/)
[![Vite](https://img.shields.io/badge/Vite-8.2-646CFF?style=for-the-badge&logo=vite)](https://vitejs.dev/)
[![Cosmology](https://img.shields.io/badge/Cosmology-Planck%202018-005580?style=for-the-badge)]()
[![License](https://img.shields.io/badge/License-MIT-blue.style=for-the-badge)]()

**CosmoVerse-3D** is a high-performance interactive 3D WebGL cosmic map visualizing **240,000 celestial objects** (galaxies and quasars/QSOs) from the Sloan Digital Sky Survey (SDSS DR18). Powered by custom GLSL shaders and real-time **Planck 2018 Cosmological Model** computations, it maps redshift slices into accurate comoving distances and lookback times out to $z = 7.0$ (over 12.96 billion years back into cosmic history).

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
  Simulates live telescope data ingestion stream from 0.2 objects/sec up to 25,000 objects/sec, with an interactive timeline scrubber and instant dataset plotting options.

- 📊 **Real-time Redshift Histogram & Slice Filtering**
  Interactive distribution graph showing object counts across redshift bins ($z = 0.0$ to $z = 7.0$). Filter specific cosmic epochs dynamically.

- 🛸 **Cyberpunk Glassmorphic Sci-Fi HUD**
  Sleek dark-mode interface with live cosmic telemetry counters, camera presets (**Boötes Void**, **Sloan Great Wall**, **Quasar Dawn**, **Earth Origin**, **Survey Wedge**), auto-orbit controls, and CSV dataset import/export.

- 🔍 **Interactive Object Inspector & Spectrum Visualizer**
  Click on any celestial object to view detailed astronomical telemetry:
  - Celestial Coordinates ($\text{RA}, \text{DEC}$)
  - SDSS Photometric Band Magnitudes ($u, g, r, i, z$)
  - Stellar Mass ($M_\odot$) & Morphological Class (Spiral, Elliptical, Quasar)
  - Simulated Dynamic Spectral Emission Profile

---

## 🛠️ Technology Stack

| Technology | Purpose |
| :--- | :--- |
| **Three.js (r185)** | 3D WebGL rendering engine & camera management |
| **Custom GLSL Shaders** | High-performance vertex & fragment particle rendering |
| **JavaScript (ES Modules)** | Core application logic & cosmological equations |
| **Vite** | Next-generation fast frontend tooling & development server |
| **Vanilla CSS3** | Glassmorphism UI tokens, micro-animations & dark mode styling |
| **Lucide Icons** | Vector icons for astronomy UI navigation |

---

## 🚀 Getting Started

### Prerequisites

Make sure you have [Node.js](https://nodejs.org/) (v16+ recommended) installed on your machine.

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/developerrahulofficial/CosmoVerse-3D.git
   cd CosmoVerse-3D
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start local development server**
   ```bash
   npm run dev
   ```
   Open your browser at `http://localhost:5173` to explore the universe!

4. **Build for production**
   ```bash
   npm run build
   ```

---

## 🎮 Controls & Keyboard Shortcuts

| Input | Action |
| :--- | :--- |
| **Left Click + Drag** | Orbit camera around cosmic origin |
| **Right Click + Drag** | Pan camera |
| **Scroll Wheel** | Zoom in / out through cosmic structures |
| **Click Object** | Inspect galaxy / quasar properties & spectrum |
| **`[T]`** | Toggle HUD glass background transparency |
| **`[H]`** | Hide / Show UI overlays |
| **`[O]`** | Toggle smooth auto-orbit camera rotation |

---

## 📂 Project Structure

```
CosmoVerse-3D/
├── docs/
│   └── screenshots/         # High-resolution application screenshots
│       ├── survey_wedge.png
│       └── quasar_dawn.png
├── public/                  # Static web assets & favicon
├── src/
│   ├── assets/              # Textures & graphics
│   ├── controller/          # PlottingController stream logic
│   ├── cosmology/           # Planck 18 cosmological distance model
│   ├── data/                # SDSS DR18 synthetic catalog generator
│   ├── rendering/           # Three.js scene, camera damping & GLSL shaders
│   │   └── shaders/         # galaxy.vert & galaxy.frag
│   ├── ui/                  # HUD, spectrum visualizer & control panels
│   ├── main.js              # Application entry point
│   └── style.css            # Sci-fi glassmorphic styling system
├── index.html               # Main HTML entry point
├── package.json
└── README.md
```

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

<p align="center">
  Designed & Built with 🌌 for Astronomy & Astrophysics Explorers by <a href="https://github.com/developerrahulofficial">developerrahulofficial</a>
</p>
