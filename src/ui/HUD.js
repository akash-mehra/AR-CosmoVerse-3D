import { computeRedshiftHistogram, importCustomSDSSData } from '../data/sdssGenerator.js';
import { fetchSimbadCatalog } from '../data/simbadSource.js';

export class HUD {
  constructor(container, controller, scene) {
    this.container = container;
    this.controller = controller;
    this.scene = scene;
    this.minZFilter = 0.00;
    this.maxZFilter = 0.30;
    this.uiHidden = false;
    this.lastClickPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

    this.renderDOM();
    this.bindEvents();
    this.bindMouseZoomEvents();
    this.bindKeyboardShortcuts();

    // Register controller listener
    this.controller.onProgress(stats => this.updateTelemetry(stats));
  }

  renderDOM() {
    const el = document.createElement('div');
    el.className = 'hud-container';
    el.innerHTML = `
      <!-- TOP HEADER BAR -->
      <header class="hud-header glass-card" id="card-header">
        <div class="header-left">
          <div class="brand-badge">SDSS DR18</div>
          <div>
            <h1>Sloan Digital Sky Survey 3D Map</h1>
            <p class="subtitle">Planck 2018 Cosmology • 240,000 Galaxies & Quasars</p>
          </div>
        </div>
        <nav class="landmark-nav">
          <button class="landmark-btn" data-landmark="bootes" title="Focus on 200 Million Light-Year Boötes Void">
            <span class="icon">🕳️</span> Boötes Void
          </button>
          <button class="landmark-btn" data-landmark="sloan_wall" title="Focus on 420 Mpc Sloan Great Wall">
            <span class="icon">🧱</span> Sloan Great Wall
          </button>
          <button class="landmark-btn" data-landmark="quasar_dawn" title="Deep Cosmic Web Quasars out to z = 7">
            <span class="icon">🌟</span> Quasar Dawn
          </button>
          <button class="landmark-btn" data-landmark="earth" title="Return to Milky Way / Earth Origin">
            <span class="icon">🔭</span> Earth Origin
          </button>
          <button class="landmark-btn active" data-landmark="overview" title="Full SDSS Survey Dual-Wedge View">
            <span class="icon">🦋</span> Survey Wedge
          </button>
          <button class="landmark-btn cinema-btn" id="btn-fullscreen" title="Enter Cinema Fullscreen Mode (Press F)">
            <span class="icon">🎬</span> Fullscreen
          </button>
          <button class="landmark-btn orbit-btn" id="btn-auto-orbit" title="Toggle Cinematic Camera Orbit (Press O)">
            <span class="icon">🎥</span> Auto-Orbit
          </button>
          <button class="landmark-btn bg-trans-btn" id="btn-transparent-bg" title="Toggle Transparent Background for Video Editing (Press T)">
            <span class="icon">🌌</span> Alpha BG
          </button>
          <button class="landmark-btn hide-ui-btn" id="btn-hide-ui" title="Hide HUD Panels for Clean Screen Recording (Press H)">
            <span class="icon">👁️</span> Hide UI
          </button>
          <button class="landmark-btn import-btn" id="btn-import-csv" title="Import Custom SDSS SQL CSV">
            <span class="icon">📂</span> Import CSV
          </button>
          <button class="landmark-btn simbad-btn" id="btn-load-simbad" title="Fetch real galaxies &amp; quasars from the SIMBAD TAP service (CDS Strasbourg)">
            <span class="icon">🛰️</span> Load SIMBAD
          </button>
          <button class="landmark-btn ar-btn" id="btn-enter-ar" title="View the map through your device camera">
            <span class="icon">📱</span> AR View
          </button>
        </nav>
      </header>

      <!-- MINIMAL RECORDING DOCK (VISIBLE WHEN HUD IS HIDDEN) -->
      <div class="recording-dock glass-card hidden" id="recording-dock">
        <span class="recording-indicator"><span class="rec-dot"></span> RECORDING MODE</span>
        <button class="dock-btn" id="dock-play-pause" title="Play/Pause (Space)">⏸</button>
        <button class="dock-btn" id="dock-orbit" title="Toggle Auto-Orbit (O)">🎥 Orbit</button>
        <button class="dock-btn" id="dock-transparent" title="Toggle Transparent Background (T)">🌌 Alpha BG</button>
        <span class="dock-stats" id="dock-count">0 / 240,000</span>
        <button class="dock-btn exit-btn" id="dock-exit" title="Restore Full UI (H)">👁️ Show UI [H]</button>
      </div>

      <!-- FLOATING MOUSE CLICK ZOOM POPOVER MENU -->
      <div class="zoom-popover glass-card hidden" id="zoom-popover">
        <div class="popover-title">Mouse Focus Target</div>
        <div class="popover-actions">
          <button class="popover-btn primary" id="popover-zoom-in">🔍 Smooth Zoom In</button>
          <button class="popover-btn" id="popover-zoom-out">🔎 Smooth Zoom Out</button>
          <button class="popover-btn close" id="popover-close">✕</button>
        </div>
      </div>

      <!-- TOP RIGHT: COSMOLOGY TELEMETRY & STATS -->
      <aside class="hud-telemetry glass-card" id="card-telemetry">
        <div class="telemetry-header">
          <span class="pulse-dot"></span>
          <span>Cosmic Frontier Live Telemetry</span>
        </div>
        <div class="telemetry-grid">
          <div class="stat-item">
            <span class="stat-label">Plotted Objects</span>
            <span class="stat-value" id="stat-count">0 / 0</span>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" id="stat-progress-bar" style="width: 0%"></div>
            </div>
          </div>
          <div class="stat-row">
            <div class="stat-pill galaxies">
              <span class="dot"></span>
              <span>Galaxies: <strong id="stat-galaxies">0</strong></span>
            </div>
            <div class="stat-pill qsos">
              <span class="dot"></span>
              <span>QSOs: <strong id="stat-qsos">0</strong></span>
            </div>
          </div>
          <div class="stat-item">
            <span class="stat-label">Current Redshift Frontier (z)</span>
            <span class="stat-value accent-cyan" id="stat-redshift">z = 0.00 — 0.30</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Comoving Distance</span>
            <span class="stat-value" id="stat-distance">0 Mpc — 1.22 Gpc</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Lookback Time</span>
            <span class="stat-value accent-gold" id="stat-lookback">0.00 — 3.45 Gyr ago</span>
          </div>
          <div class="shortcut-tips">
            <span>Click/DblClick anywhere to Smooth Zoom • [T] Alpha BG • [H] Hide UI • [O] Orbit</span>
          </div>
        </div>
      </aside>

      <!-- BOTTOM LEFT: ONE-BY-ONE PLOTTING ENGINE & SPEED CONTROLS -->
      <section class="hud-plotting-controller glass-card" id="card-controller">
        <div class="controller-top-row">
          <div class="playback-controls">
            <button class="control-btn play-pause-btn" id="btn-play-pause" title="Play / Pause Plotting (Space)">
              <span id="play-pause-icon">⏸</span> <span id="play-pause-label">Pause</span>
            </button>
            <button class="control-btn" id="btn-step" title="Step +1 Galaxy">
              <span>+1</span> Step
            </button>
            <button class="control-btn" id="btn-reset" title="Reset Plotting to 0 (R)">
              <span>⟲</span> Reset
            </button>
          </div>
          <div class="order-selector">
            <label for="select-order">Plotting Order:</label>
            <select id="select-order" class="glass-select">
              <option value="redshift">Cosmic Time (Earth Outwards)</option>
              <option value="scan">SDSS Telescope Scan Sweep</option>
              <option value="filaments">Cosmic Web Filaments First</option>
              <option value="random">Random Discovery</option>
            </select>
          </div>
        </div>

        <!-- Timeline Scrubber -->
        <div class="scrubber-row">
          <input type="range" id="slider-scrubber" class="cosmic-slider" min="0" max="1000" value="0" />
          <span class="scrubber-pct" id="scrubber-pct-label">0.0%</span>
        </div>

        <!-- Plotting Speed Presets & Slider -->
        <div class="speed-row">
          <span class="speed-label">Plotting Speed: <strong id="speed-label-value">4,500 / sec</strong></span>
          <div class="speed-pills">
            <button class="speed-pill" data-speed="0.2" title="Super Slow-Mo: 1 Galaxy every 5 seconds">0.2 /s</button>
            <button class="speed-pill" data-speed="1" title="Slow-Mo: 1 Galaxy per second">1 /s</button>
            <button class="speed-pill" data-speed="10">10 /s</button>
            <button class="speed-pill" data-speed="100">100 /s</button>
            <button class="speed-pill" data-speed="1000">1,000 /s</button>
            <button class="speed-pill active" data-speed="4500">4,500 /s</button>
            <button class="speed-pill" data-speed="25000">25,000 /s</button>
            <button class="speed-pill" data-speed="Infinity">All (Instant)</button>
          </div>
        </div>
      </section>

      <!-- BOTTOM RIGHT: REDSHIFT HISTOGRAM & FILTER -->
      <section class="hud-histogram glass-card" id="card-histogram">
        <div class="histogram-header">
          <div>
            <h3>Redshift Distribution (z = 0.00 to 0.30)</h3>
            <p class="hist-subtitle">Real-time object count vs comoving distance & redshift</p>
          </div>
          <div class="hist-legend">
            <span class="legend-dot gal"></span> Galaxies
            <span class="legend-dot qso"></span> QSOs
          </div>
        </div>
        <div class="histogram-svg-wrapper">
          <svg id="histogram-svg" viewBox="0 0 400 110" preserveAspectRatio="none"></svg>
        </div>
        <div class="filter-controls">
          <label>Redshift Slice Filter:</label>
          <div class="range-inputs">
            <span>min z:</span>
            <input type="number" id="input-min-z" class="glass-input" step="0.01" min="0.00" max="6.9" value="0.00" />
            <span>max z:</span>
            <input type="number" id="input-max-z" class="glass-input" step="0.01" min="0.05" max="7.0" value="0.30" />
            <button class="control-btn small" id="btn-apply-filter">Slice</button>
            <button class="control-btn small" id="btn-reset-filter">Full Scope (z=7)</button>
          </div>
        </div>
      </section>

      <!-- CSV IMPORT MODAL -->
      <div class="modal-backdrop hidden" id="csv-modal">
        <div class="glass-card modal-box">
          <h2>Import Custom SDSS SQL Query CSV</h2>
          <p class="modal-desc">
            Paste your SDSS DR18 CSV export below. Must contain columns: <code>ra</code>, <code>dec</code>, <code>z</code>, and optionally <code>class</code> ('GALAXY' or 'QSO').
          </p>
          <textarea id="csv-textarea" class="glass-textarea" placeholder="ra,dec,z,class&#10;145.2,12.3,0.045,GALAXY&#10;218.1,46.2,0.056,GALAXY..."></textarea>
          <div class="modal-actions">
            <button class="control-btn primary" id="btn-confirm-import">Load & Visualize</button>
            <button class="control-btn" id="btn-close-modal">Cancel</button>
          </div>
        </div>
      </div>
    `;

    this.container.appendChild(el);
  }

  bindEvents() {
    // 1. Play / Pause
    const playPauseBtn = document.getElementById('btn-play-pause');
    const playPauseIcon = document.getElementById('play-pause-icon');
    const playPauseLabel = document.getElementById('play-pause-label');
    const dockPlayPause = document.getElementById('dock-play-pause');

    const togglePlayPauseUI = () => {
      const isPlaying = this.controller.togglePlay();
      playPauseIcon.textContent = isPlaying ? '⏸' : '▶';
      playPauseLabel.textContent = isPlaying ? 'Pause' : 'Play';
      dockPlayPause.textContent = isPlaying ? '⏸' : '▶';
      playPauseBtn.classList.toggle('paused', !isPlaying);
    };

    playPauseBtn.addEventListener('click', togglePlayPauseUI);
    dockPlayPause.addEventListener('click', togglePlayPauseUI);

    // 2. Step
    document.getElementById('btn-step').addEventListener('click', () => {
      this.controller.step(1);
      playPauseIcon.textContent = '▶';
      playPauseLabel.textContent = 'Play';
      dockPlayPause.textContent = '▶';
    });

    // 3. Reset
    document.getElementById('btn-reset').addEventListener('click', () => {
      this.controller.reset();
      playPauseIcon.textContent = '▶';
      playPauseLabel.textContent = 'Play';
      dockPlayPause.textContent = '▶';
    });

    // 4. Scrubber
    const scrubber = document.getElementById('slider-scrubber');
    scrubber.addEventListener('input', e => {
      const val = parseFloat(e.target.value);
      const targetCount = (val / 1000.0) * this.controller.totalCount;
      this.controller.setCount(targetCount);
    });

    // 5. Speed pills
    const speedPills = document.querySelectorAll('.speed-pill');
    const speedValueLabel = document.getElementById('speed-label-value');

    speedPills.forEach(pill => {
      pill.addEventListener('click', () => {
        speedPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const spdStr = pill.getAttribute('data-speed');
        const spd = spdStr === 'Infinity' ? Infinity : parseFloat(spdStr);
        this.controller.setSpeed(spd);
        if (spd === Infinity) {
          speedValueLabel.textContent = 'All (Instant)';
        } else if (spd < 1) {
          speedValueLabel.textContent = `${spd} / sec (1 every ${Math.round(1/spd)}s)`;
        } else {
          speedValueLabel.textContent = `${spd.toLocaleString()} / sec`;
        }
      });
    });

    // 6. Order selector
    document.getElementById('select-order').addEventListener('change', e => {
      this.controller.setOrder(e.target.value);
    });

    // 7. Landmark tour buttons
    const landmarkBtns = document.querySelectorAll('.landmark-btn[data-landmark]');
    landmarkBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        landmarkBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const name = btn.getAttribute('data-landmark');
        this.scene.flyToLandmark(name);
      });
    });

    // 8. Fullscreen / Cinema mode
    document.getElementById('btn-fullscreen').addEventListener('click', () => {
      this.toggleFullscreen();
    });

    // 9. Auto-Orbit toggle
    const orbitBtn = document.getElementById('btn-auto-orbit');
    const dockOrbit = document.getElementById('dock-orbit');
    const toggleOrbitUI = () => {
      const isOrbiting = this.scene.toggleAutoOrbit();
      orbitBtn.classList.toggle('active', isOrbiting);
      dockOrbit.classList.toggle('active', isOrbiting);
    };
    orbitBtn.addEventListener('click', toggleOrbitUI);
    dockOrbit.addEventListener('click', toggleOrbitUI);

    // 10. Transparent Background toggle
    const bgTransBtn = document.getElementById('btn-transparent-bg');
    const dockTransBtn = document.getElementById('dock-transparent');
    const toggleTransUI = () => {
      const isTrans = this.scene.toggleTransparentBackground();
      bgTransBtn.classList.toggle('active', isTrans);
      dockTransBtn.classList.toggle('active', isTrans);
    };
    bgTransBtn.addEventListener('click', toggleTransUI);
    dockTransBtn.addEventListener('click', toggleTransUI);

    // 11. Hide / Show UI (Recording Mode)
    const btnHideUI = document.getElementById('btn-hide-ui');
    const dockExit = document.getElementById('dock-exit');
    btnHideUI.addEventListener('click', () => this.toggleUIVisibility());
    dockExit.addEventListener('click', () => this.toggleUIVisibility());

    // 12. Redshift Filter Slice
    document.getElementById('btn-apply-filter').addEventListener('click', () => {
      const minInput = document.getElementById('input-min-z').value;
      const minVal = minInput !== '' ? parseFloat(minInput) : 0.00;
      const maxVal = parseFloat(document.getElementById('input-max-z').value) || 0.30;
      this.minZFilter = minVal;
      this.maxZFilter = maxVal;
      this.scene.setRedshiftRange(minVal, maxVal);
      this.drawHistogram();
    });

    document.getElementById('btn-reset-filter').addEventListener('click', () => {
      this.minZFilter = 0.00;
      this.maxZFilter = 7.0;
      document.getElementById('input-min-z').value = '0.00';
      document.getElementById('input-max-z').value = '7.0';
      this.scene.setRedshiftRange(0.00, 7.0);
      this.drawHistogram();
    });

    // 13. AR mode
    document.getElementById('btn-enter-ar').addEventListener('click', () => this.onEnterAR?.());

    // 14. CSV modal
    const csvModal = document.getElementById('csv-modal');
    document.getElementById('btn-import-csv').addEventListener('click', () => {
      csvModal.classList.remove('hidden');
    });
    document.getElementById('btn-close-modal').addEventListener('click', () => {
      csvModal.classList.add('hidden');
    });
    document.getElementById('btn-confirm-import').addEventListener('click', () => {
      const csvText = document.getElementById('csv-textarea').value;
      try {
        const importedData = importCustomSDSSData(csvText);
        this.loadCatalog(importedData, 'CSV IMPORT');
        csvModal.classList.add('hidden');
      } catch (err) {
        alert("Error importing CSV: " + err.message);
      }
    });

    // 14. Live SIMBAD catalog fetch
    const simbadBtn = document.getElementById('btn-load-simbad');
    simbadBtn.addEventListener('click', async () => {
      if (simbadBtn.disabled) return;
      const idleLabel = simbadBtn.innerHTML;
      simbadBtn.disabled = true;

      try {
        const catalog = await fetchSimbadCatalog({
          onProgress: (done, total) => {
            simbadBtn.innerHTML = `<span class="icon">🛰️</span> SIMBAD ${done}/${total}`;
          }
        });
        this.loadCatalog(catalog, 'SIMBAD');
        if (catalog.failedBands > 0) {
          alert(`Loaded ${catalog.count.toLocaleString()} SIMBAD objects, but ${catalog.failedBands} of the query bands failed.`);
        }
      } catch (err) {
        alert("SIMBAD load failed: " + err.message);
      } finally {
        simbadBtn.innerHTML = idleLabel;
        simbadBtn.disabled = false;
      }
    });
  }

  /** Mounts a catalog into the scene and controller, then relabels the header. */
  loadCatalog(catalog, sourceLabel) {
    this.scene.loadDataset(catalog);
    this.controller.setDataset(catalog);
    this.onCatalogLoaded?.(catalog);

    const badge = this.container.querySelector('.brand-badge');
    const subtitle = this.container.querySelector('.subtitle');
    if (badge) badge.textContent = sourceLabel;
    if (subtitle) {
      subtitle.textContent = `Planck 2018 Cosmology • ${catalog.count.toLocaleString()} Galaxies & Quasars`;
    }
  }

  bindMouseZoomEvents() {
    const popover = document.getElementById('zoom-popover');
    const zoomInBtn = document.getElementById('popover-zoom-in');
    const zoomOutBtn = document.getElementById('popover-zoom-out');
    const popoverClose = document.getElementById('popover-close');

    const showPopoverAt = (x, y) => {
      this.lastClickPos = { x, y };
      popover.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
      popover.style.top = `${Math.min(y, window.innerHeight - 120)}px`;
      popover.classList.remove('hidden');
    };

    const hidePopover = () => {
      popover.classList.add('hidden');
    };

    zoomInBtn.addEventListener('click', () => {
      this.scene.zoomAtScreenPoint(this.lastClickPos.x, this.lastClickPos.y, 'in');
      hidePopover();
    });

    zoomOutBtn.addEventListener('click', () => {
      this.scene.zoomAtScreenPoint(this.lastClickPos.x, this.lastClickPos.y, 'out');
      hidePopover();
    });

    popoverClose.addEventListener('click', hidePopover);

    // Canvas Mouse Click Listener for Raycast Zoom
    let isMouseDown = false;
    let mouseDownPos = { x: 0, y: 0 };

    window.addEventListener('mousedown', e => {
      if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A'].includes(e.target.tagName)) return;
      if (e.target.closest('.glass-card') && !e.target.closest('#zoom-popover')) {
        hidePopover();
        return;
      }
      isMouseDown = true;
      mouseDownPos = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mouseup', e => {
      if (!isMouseDown) return;
      isMouseDown = false;

      // Only trigger click popover if mouse didn't drag (distance < 6px)
      const dist = Math.hypot(e.clientX - mouseDownPos.x, e.clientY - mouseDownPos.y);
      if (dist < 6) {
        // A named object takes the click instead, and opens its own detail card
        if (this.shouldSuppressClick?.(e)) {
          hidePopover();
          return;
        }
        // If clicking on empty canvas or in recording mode
        showPopoverAt(e.clientX, e.clientY);
      }
    });

    // Double-Click on Canvas -> Instant Smooth Zoom In at Mouse Position!
    window.addEventListener('dblclick', e => {
      if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A'].includes(e.target.tagName)) return;
      if (e.target.closest('.glass-card')) return;
      e.preventDefault();
      const direction = e.shiftKey || e.altKey ? 'out' : 'in';
      this.scene.zoomAtScreenPoint(e.clientX, e.clientY, direction);
      hidePopover();
    });
  }

  bindKeyboardShortcuts() {
    window.addEventListener('keydown', e => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      const key = e.key.toLowerCase();
      if (key === 'f') {
        e.preventDefault();
        this.toggleFullscreen();
      } else if (key === 'h') {
        e.preventDefault();
        this.toggleUIVisibility();
      } else if (key === 'o') {
        e.preventDefault();
        const isOrbiting = this.scene.toggleAutoOrbit();
        document.getElementById('btn-auto-orbit').classList.toggle('active', isOrbiting);
        document.getElementById('dock-orbit').classList.toggle('active', isOrbiting);
      } else if (key === 't') {
        e.preventDefault();
        const isTrans = this.scene.toggleTransparentBackground();
        document.getElementById('btn-transparent-bg').classList.toggle('active', isTrans);
        document.getElementById('dock-transparent').classList.toggle('active', isTrans);
      } else if (e.code === 'Space') {
        e.preventDefault();
        const isPlaying = this.controller.togglePlay();
        document.getElementById('play-pause-icon').textContent = isPlaying ? '⏸' : '▶';
        document.getElementById('play-pause-label').textContent = isPlaying ? 'Pause' : 'Play';
        document.getElementById('dock-play-pause').textContent = isPlaying ? '⏸' : '▶';
        document.getElementById('btn-play-pause').classList.toggle('paused', !isPlaying);
      } else if (key === 'r') {
        e.preventDefault();
        this.controller.reset();
        document.getElementById('play-pause-icon').textContent = '▶';
        document.getElementById('play-pause-label').textContent = 'Play';
        document.getElementById('dock-play-pause').textContent = '▶';
      }
    });
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      document.getElementById('btn-fullscreen').classList.add('active');
    } else {
      document.exitFullscreen().catch(() => {});
      document.getElementById('btn-fullscreen').classList.remove('active');
    }
  }

  toggleUIVisibility() {
    this.uiHidden = !this.uiHidden;
    const cards = ['card-header', 'card-telemetry', 'card-controller', 'card-histogram', 'named-layer'];
    cards.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('hidden-hud', this.uiHidden);
    });
    const dock = document.getElementById('recording-dock');
    if (dock) dock.classList.toggle('hidden', !this.uiHidden);
    const popover = document.getElementById('zoom-popover');
    if (popover) popover.classList.add('hidden');
  }

  updateTelemetry(stats) {
    document.getElementById('stat-count').textContent = `${stats.currentCount.toLocaleString()} / ${stats.totalCount.toLocaleString()}`;
    document.getElementById('stat-galaxies').textContent = stats.galaxiesCount.toLocaleString();
    document.getElementById('stat-qsos').textContent = stats.qsosCount.toLocaleString();
    document.getElementById('stat-progress-bar').style.width = `${(stats.progressNorm * 100).toFixed(1)}%`;

    const scrubber = document.getElementById('slider-scrubber');
    if (document.activeElement !== scrubber) {
      scrubber.value = Math.round(stats.progressNorm * 1000);
    }
    document.getElementById('scrubber-pct-label').textContent = `${(stats.progressNorm * 100).toFixed(1)}%`;

    document.getElementById('stat-redshift').textContent = `z = 0.00 — ${stats.currentMaxZ.toFixed(2)}`;
    document.getElementById('stat-distance').textContent = `0 Mpc — ${(stats.distanceMpc > 1000 ? (stats.distanceMpc / 1000).toFixed(2) + ' Gpc' : stats.distanceMpc.toFixed(0) + ' Mpc')}`;
    document.getElementById('stat-lookback').textContent = `0.00 — ${stats.lookbackGyr.toFixed(2)} Gyr ago`;

    // Update minimal recording dock count
    const dockCount = document.getElementById('dock-count');
    if (dockCount) {
      dockCount.textContent = `${stats.currentCount.toLocaleString()} / ${stats.totalCount.toLocaleString()}`;
    }

    // Redraw histogram with current progress
    this.drawHistogram(stats.currentCount);
  }

  drawHistogram(plottedLimit = null) {
    const svg = document.getElementById('histogram-svg');
    if (!svg || !this.controller.redshifts) return;

    const limit = plottedLimit !== null ? plottedLimit : this.controller.currentCount;
    const sampleRedshifts = this.controller.redshifts.subarray(0, limit);
    const sampleQSO = this.controller.isQSOArray.subarray(0, limit);

    const hist = computeRedshiftHistogram(
      sampleRedshifts,
      sampleQSO,
      this.minZFilter,
      this.maxZFilter,
      50
    );

    const maxBinVal = Math.max(
      10,
      ...Array.from(hist.galaxyBins).map((v, i) => v + hist.qsoBins[i])
    );

    const width = 400;
    const height = 110;
    const barWidth = width / hist.numBins;

    let svgHTML = '';

    for (let i = 0; i < hist.numBins; i++) {
      const gVal = hist.galaxyBins[i];
      const qVal = hist.qsoBins[i];
      const x = i * barWidth;

      const gHeight = (gVal / maxBinVal) * (height - 18);
      const qHeight = (qVal / maxBinVal) * (height - 18);

      const yGal = height - gHeight;
      const yQSO = yGal - qHeight;

      if (gHeight > 0) {
        svgHTML += `<rect x="${x + 0.5}" y="${yGal}" width="${barWidth - 1}" height="${gHeight}" class="hist-bar-gal" />`;
      }
      if (qHeight > 0) {
        svgHTML += `<rect x="${x + 0.5}" y="${yQSO}" width="${barWidth - 1}" height="${qHeight}" class="hist-bar-qso" />`;
      }
    }

    svgHTML += `<line x1="0" y1="${height - 1}" x2="${width}" y2="${height - 1}" stroke="#334466" stroke-width="1" />`;
    svgHTML += `<text x="5" y="${height - 4}" class="hist-label">z=${this.minZFilter}</text>`;
    svgHTML += `<text x="${width - 40}" y="${height - 4}" class="hist-label">z=${this.maxZFilter}</text>`;

    svg.innerHTML = svgHTML;
  }
}
