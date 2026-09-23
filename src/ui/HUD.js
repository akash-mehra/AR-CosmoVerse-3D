import { computeRedshiftHistogram, importCustomSDSSData, MAX_CATALOG_Z } from '../data/sdssGenerator.js';
import { fetchSimbadCatalog } from '../data/simbadSource.js';
import { notify } from './notify.js';
import { searchEntries } from './search.js';
import { formatDistance, OTYPE_LABELS } from './NamedObjectLayer.js';

const SIMBAD_LABEL = 'SIMBAD';
const MAX_CSV_BYTES = 50 * 1024 * 1024;
// Must match the compact layout's media query in style.css.
const COMPACT_QUERY = '(max-width: 1024px), (orientation: portrait)';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// Hand-placed structures with camera presets but no catalogue entry, so the
// search reaches them too.
const LANDMARK_ENTRIES = [
  { label: 'Boötes Void', ids: ['The Great Nothing'], typeLabel: 'Void', landmark: 'bootes', weight: 100 },
  { label: 'Sloan Great Wall', ids: ['SGW'], typeLabel: 'Galaxy filament', landmark: 'sloan_wall', weight: 100 }
];

export class HUD {
  constructor(container, controller, scene) {
    this.container = container;
    this.controller = controller;
    this.scene = scene;
    this.minZFilter = 0.00;
    this.maxZFilter = 0.30;
    this.uiHidden = false;
    // SIMBAD is a push button: the catalog loaded before it was switched on is
    // kept so the second push can restore it, and the fetch is cached so
    // toggling back on does not re-query the service.
    this.simbadActive = false;
    this.simbadCatalog = null;
    this.baseCatalog = null;
    this.baseSourceLabel = null;

    this.renderDOM();
    this.bindEvents();
    this.bindZoomEvents();
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
          <div class="brand-badge"></div>
          <div>
            <h1>Sloan Digital Sky Survey 3D Map</h1>
            <p class="subtitle"></p>
          </div>
        </div>
        <nav class="landmark-nav">
          <button class="landmark-btn search-btn" id="btn-search" type="button" aria-expanded="false" aria-controls="search-panel" title="Find a galaxy, cluster or quasar by name (/)">
            <span class="icon">🔍</span> Search
          </button>
          <button class="landmark-btn tour-btn" id="btn-tour" type="button" title="A guided journey from Earth to the edge of the universe">
            <span class="icon">🎬</span> Tour
          </button>
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
          <button class="landmark-btn simbad-btn" id="btn-load-simbad" type="button" aria-pressed="false" title="Load real galaxies &amp; quasars from the SIMBAD TAP service (CDS Strasbourg)">
            <span class="icon">🔴</span> SIMBAD Off
          </button>
          <button class="landmark-btn ar-btn" id="btn-enter-ar" title="View the map through your device camera">
            <span class="icon">📱</span> AR View
          </button>
        </nav>
        <div class="search-panel" id="search-panel" hidden>
          <input type="search" id="search-input" class="glass-input search-input" placeholder="Name or catalogue ID — Milky Way, M31, Coma, 3C 273…"
            autocomplete="off" spellcheck="false" role="combobox" aria-label="Search named objects"
            aria-autocomplete="list" aria-expanded="false" aria-controls="search-results" />
          <ul class="search-results" id="search-results" role="listbox" aria-label="Matches"></ul>
        </div>
      </header>

      <!-- MINIMAL RECORDING DOCK (VISIBLE WHEN HUD IS HIDDEN) -->
      <div class="recording-dock glass-card hidden" id="recording-dock">
        <span class="recording-indicator"><span class="rec-dot"></span> CLEAN VIEW</span>
        <button class="dock-btn" id="dock-play-pause" title="Play/Pause (Space)">⏸</button>
        <button class="dock-btn" id="dock-orbit" title="Toggle Auto-Orbit (O)">🎥 Orbit</button>
        <button class="dock-btn" id="dock-transparent" title="Toggle Transparent Background (T)">🌌 Alpha BG</button>
        <span class="dock-stats" id="dock-count">0 / 240,000</span>
        <button class="dock-btn exit-btn" id="dock-exit" title="Restore Full UI (H)">👁️ Show UI [H]</button>
      </div>

      <!-- TOP RIGHT: COSMOLOGY TELEMETRY & STATS -->
      <aside class="hud-telemetry glass-card" id="card-telemetry">
        <details class="telemetry-details" id="telemetry-details" open>
        <summary class="telemetry-header">
          <span class="pulse-dot"></span>
          <span>Live Telemetry</span>
          <span class="telemetry-mini" id="stat-mini"></span>
        </summary>
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
            <span>Drag to orbit • Scroll to zoom • Double-click to fly in (Shift: out)</span>
            <span>[/] Search • [Space] Play • [R] Reset • [F] Fullscreen • [H] Hide UI • [O] Orbit • [T] Alpha BG</span>
          </div>
        </div>
        </details>
      </aside>

      <!-- BOTTOM LEFT: ONE-BY-ONE PLOTTING ENGINE & SPEED CONTROLS -->
      <section class="hud-plotting-controller glass-card" id="card-controller">
        <div class="controller-top-row">
          <div class="playback-controls">
            <button class="control-btn play-pause-btn" id="btn-play-pause" type="button" title="Play / Pause Plotting (Space)">
              <span id="play-pause-icon">⏸</span> <span id="play-pause-label">Pause</span>
            </button>
            <button class="control-btn" id="btn-step" type="button" title="Plot one more object">
              <span>+1</span> Step
            </button>
            <button class="control-btn" id="btn-reset" type="button" title="Reset Plotting to 0 (R)">
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
          <input type="range" id="slider-scrubber" class="cosmic-slider" min="0" max="1000" value="0" aria-label="Plotting progress" />
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
            <h3>Redshift Distribution</h3>
            <p class="hist-subtitle" id="hist-title">Plotted objects, z = 0.00 to 0.30</p>
          </div>
          <div class="hist-legend">
            <span class="legend-dot gal"></span> Galaxies
            <span class="legend-dot qso"></span> QSOs
          </div>
        </div>
        <div class="histogram-svg-wrapper">
          <svg id="histogram-svg" viewBox="0 0 400 110" preserveAspectRatio="none"></svg>
        </div>
        <form class="filter-controls" id="filter-form" novalidate>
          <span>Redshift slice</span>
          <div class="range-inputs">
            <label for="input-min-z">min z</label>
            <input type="number" id="input-min-z" class="glass-input" step="0.01" min="0" max="${MAX_CATALOG_Z}" value="0.00" inputmode="decimal" />
            <label for="input-max-z">max z</label>
            <input type="number" id="input-max-z" class="glass-input" step="0.01" min="0" max="${MAX_CATALOG_Z}" value="0.30" inputmode="decimal" />
            <button class="control-btn small" id="btn-apply-filter" type="submit">Slice</button>
            <button class="control-btn small" id="btn-reset-filter" type="button" title="Show every redshift, z = 0 to ${MAX_CATALOG_Z}">Full range</button>
          </div>
        </form>
      </section>

      <!-- CSV IMPORT: a native dialog brings Escape, focus handling and a backdrop -->
      <dialog class="glass-card csv-dialog" id="csv-modal" aria-labelledby="csv-title">
        <div class="modal-box">
          <h2 id="csv-title">Import Custom SDSS SQL Query CSV</h2>
          <p class="modal-desc">
            Choose a file or paste an SDSS CSV export. Needs <code>ra</code>, <code>dec</code> and <code>z</code> (or <code>redshift</code>) columns, and optionally <code>class</code> ('GALAXY' or 'QSO').
          </p>
          <input type="file" id="csv-file" class="glass-file" accept=".csv,text/csv,text/plain" />
          <textarea id="csv-textarea" class="glass-textarea" spellcheck="false" aria-label="CSV data" placeholder="ra,dec,z,class&#10;145.2,12.3,0.045,GALAXY&#10;218.1,46.2,0.056,GALAXY..."></textarea>
          <p class="modal-error" id="csv-error" role="alert"></p>
          <div class="modal-actions">
            <button class="control-btn" id="btn-close-modal" type="button">Cancel</button>
            <button class="control-btn primary" id="btn-confirm-import" type="button">Load & Visualize</button>
          </div>
        </div>
      </dialog>
    `;

    this.container.appendChild(el);
    this.histogramSvg = el.querySelector('#histogram-svg');

    // On a phone the telemetry card would sit over the middle of the map.
    el.querySelector('#telemetry-details').open = !window.matchMedia(COMPACT_QUERY).matches;
  }

  bindEvents() {
    const $ = (id) => document.getElementById(id);

    // 1. Playback. The buttons only drive the controller; the play/pause label
    //    is painted from its reports, so every path to a state change agrees.
    const togglePlay = () => this.controller.togglePlay();
    $('btn-play-pause').addEventListener('click', togglePlay);
    $('dock-play-pause').addEventListener('click', togglePlay);
    $('btn-step').addEventListener('click', () => this.controller.step(1));
    $('btn-reset').addEventListener('click', () => this.controller.reset());

    // 2. Scrubber
    $('slider-scrubber').addEventListener('input', e => {
      const val = parseFloat(e.target.value);
      this.controller.setCount((val / 1000.0) * this.controller.totalCount);
    });

    // 3. Speed pills
    const speedPills = document.querySelectorAll('.speed-pill');
    const speedValueLabel = $('speed-label-value');
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

    // 4. Order selector
    $('select-order').addEventListener('change', e => this.controller.setOrder(e.target.value));

    // 5. Landmark tour buttons
    document.getElementById('btn-tour').addEventListener('click', () => this.onStartTour?.());
    this.landmarkBtns = document.querySelectorAll('.landmark-btn[data-landmark]');
    this.landmarkBtns.forEach(btn => {
      btn.addEventListener('click', () => this.flyToLandmark(btn.getAttribute('data-landmark')));
    });

    // 6. Fullscreen: absent where the page cannot go fullscreen (iPhone Safari),
    //    and kept in step with Esc and the browser's own controls.
    const fullscreenBtn = $('btn-fullscreen');
    if (!document.fullscreenEnabled) fullscreenBtn.hidden = true;
    fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    document.addEventListener('fullscreenchange', () => {
      fullscreenBtn.classList.toggle('active', Boolean(document.fullscreenElement));
    });

    // 7. Auto-orbit and transparent background
    $('btn-auto-orbit').addEventListener('click', () => this.toggleOrbit());
    $('dock-orbit').addEventListener('click', () => this.toggleOrbit());
    $('btn-transparent-bg').addEventListener('click', () => this.toggleTransparent());
    $('dock-transparent').addEventListener('click', () => this.toggleTransparent());

    // 8. Hide / Show UI (clean view for screen recording)
    $('btn-hide-ui').addEventListener('click', () => this.toggleUIVisibility());
    $('dock-exit').addEventListener('click', () => this.toggleUIVisibility());

    // 9. Redshift slice. A form, so Enter in either box applies it.
    $('filter-form').addEventListener('submit', e => {
      e.preventDefault();
      this.setRedshiftFilter($('input-min-z').value, $('input-max-z').value);
    });
    $('btn-reset-filter').addEventListener('click', () => this.setRedshiftFilter(0, MAX_CATALOG_Z));

    // 10. AR mode
    $('btn-enter-ar').addEventListener('click', () => this.onEnterAR?.());

    // 11. CSV import
    this.bindCsvDialog();

    // 12. Live SIMBAD catalog push button
    this.simbadBtn = $('btn-load-simbad');
    this.simbadBtn.addEventListener('click', () => this.toggleSimbad());

    // 13. Search
    this.bindSearch();
  }

  bindSearch() {
    const button = document.getElementById('btn-search');
    const panel = document.getElementById('search-panel');
    const input = document.getElementById('search-input');
    const list = document.getElementById('search-results');
    this.searchResults = [];
    this.searchActive = 0;

    button.addEventListener('click', () => (panel.hidden ? this.openSearch() : this.closeSearch()));

    input.addEventListener('input', () => {
      this.searchActive = 0;
      this.renderSearchResults(input.value);
    });

    input.addEventListener('keydown', (e) => {
      const count = this.searchResults.length;
      if (e.key === 'ArrowDown' && count) {
        e.preventDefault();
        this.searchActive = (this.searchActive + 1) % count;
        this.renderSearchResults(input.value);
      } else if (e.key === 'ArrowUp' && count) {
        e.preventDefault();
        this.searchActive = (this.searchActive - 1 + count) % count;
        this.renderSearchResults(input.value);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const entry = this.searchResults[this.searchActive];
        if (entry) this.pickSearchResult(entry);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeSearch();
        button.focus();
      }
    });

    // pointerdown, not click: picking must win over the input losing focus.
    list.addEventListener('pointerdown', (e) => {
      const item = e.target.closest('[data-index]');
      if (!item) return;
      e.preventDefault();
      this.pickSearchResult(this.searchResults[Number(item.dataset.index)]);
    });
  }

  openSearch() {
    const panel = document.getElementById('search-panel');
    const input = document.getElementById('search-input');
    panel.hidden = false;
    document.getElementById('btn-search').setAttribute('aria-expanded', 'true');
    input.focus();
    input.select();
    this.renderSearchResults(input.value);
  }

  closeSearch() {
    document.getElementById('search-panel').hidden = true;
    document.getElementById('btn-search').setAttribute('aria-expanded', 'false');
    document.getElementById('search-input').setAttribute('aria-expanded', 'false');
  }

  renderSearchResults(query) {
    const input = document.getElementById('search-input');
    const list = document.getElementById('search-results');
    const entries = [...(this.searchObjects?.() ?? []), ...LANDMARK_ENTRIES];
    this.searchResults = searchEntries(entries, query);
    list.replaceChildren();
    input.removeAttribute('aria-activedescendant');

    if (!query.trim()) {
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    if (!this.searchResults.length) {
      const empty = document.createElement('li');
      empty.className = 'search-empty';
      empty.textContent = 'No named object matches that.';
      list.append(empty);
      input.setAttribute('aria-expanded', 'false');
      return;
    }

    this.searchResults.forEach((entry, i) => {
      const item = document.createElement('li');
      item.className = 'search-result';
      item.id = `search-result-${i}`;
      item.dataset.index = String(i);
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(i === this.searchActive));
      const name = document.createElement('span');
      name.className = 'search-result-name';
      name.textContent = entry.label;
      const meta = document.createElement('span');
      meta.className = 'search-result-meta';
      meta.textContent = entry.landmark
        ? entry.typeLabel
        : `${entry.typeLabel ?? OTYPE_LABELS[entry.otype] ?? entry.otype} · ${entry.distanceText ?? formatDistance(entry.distanceMpc)}`;
      item.append(name, meta);
      list.append(item);
    });
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', `search-result-${this.searchActive}`);
  }

  pickSearchResult(entry) {
    this.closeSearch();
    if (entry.landmark) {
      this.flyToLandmark(entry.landmark);
      return;
    }
    // Quasars sit far outside the default 0–0.3 slice; a hidden point is not
    // much of an answer.
    if (entry.filterZ < this.minZFilter || entry.filterZ > this.maxZFilter) {
      this.setRedshiftFilter(Math.min(this.minZFilter, entry.filterZ), Math.max(this.maxZFilter, entry.filterZ));
    }
    this.landmarkBtns.forEach(b => b.classList.remove('active'));
    this.onSearchPick?.(entry);
  }

  bindCsvDialog() {
    const dialog = document.getElementById('csv-modal');
    const textarea = document.getElementById('csv-textarea');
    const fileInput = document.getElementById('csv-file');
    const error = document.getElementById('csv-error');
    const confirm = document.getElementById('btn-confirm-import');

    document.getElementById('btn-import-csv').addEventListener('click', () => {
      error.textContent = '';
      dialog.showModal();
    });
    document.getElementById('btn-close-modal').addEventListener('click', () => dialog.close());
    // The dialog box is padded by its inner wrapper, so a click that lands on
    // the dialog element itself is on the backdrop.
    dialog.addEventListener('click', e => {
      if (e.target === dialog) dialog.close();
    });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (file.size > MAX_CSV_BYTES) {
        error.textContent = `That file is ${(file.size / 1048576).toFixed(0)} MB; the limit is ${MAX_CSV_BYTES / 1048576} MB.`;
        fileInput.value = '';
        return;
      }
      try {
        textarea.value = await file.text();
        error.textContent = '';
      } catch (err) {
        error.textContent = `Could not read the file: ${err.message}`;
      }
    });

    confirm.addEventListener('click', () => {
      try {
        const importedData = importCustomSDSSData(textarea.value);
        this.loadCatalog(importedData, 'CSV IMPORT');
        dialog.close();
        // Named objects ride along with every catalog; report only the file's rows.
        const rows = importedData.count - importedData.named.length;
        notify(`Loaded ${rows.toLocaleString()} objects from CSV.`);
      } catch (err) {
        // Kept in the dialog, next to the data that caused it.
        error.textContent = err.message;
      }
    });
  }

  /** Validates, clamps and applies a redshift slice, then writes back what was applied. */
  setRedshiftFilter(minInput, maxInput) {
    const min = minInput === '' ? 0 : Number(minInput);
    const max = maxInput === '' ? MAX_CATALOG_Z : Number(maxInput);
    const minInputEl = document.getElementById('input-min-z');
    const maxInputEl = document.getElementById('input-max-z');

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      notify('Redshift limits must be numbers.', { error: true });
    } else if (Math.max(min, 0) >= Math.min(max, MAX_CATALOG_Z)) {
      notify('The minimum redshift has to be below the maximum.', { error: true });
    } else {
      this.minZFilter = clamp(min, 0, MAX_CATALOG_Z);
      this.maxZFilter = clamp(max, 0, MAX_CATALOG_Z);
      this.scene.setRedshiftRange(this.minZFilter, this.maxZFilter);
    }

    minInputEl.value = this.minZFilter.toFixed(2);
    maxInputEl.value = this.maxZFilter.toFixed(2);
    document.getElementById('hist-title').textContent =
      `Plotted objects, z = ${this.minZFilter.toFixed(2)} to ${this.maxZFilter.toFixed(2)}`;
    this.drawHistogram();
  }

  flyToLandmark(name, duration) {
    this.landmarkBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-landmark') === name));
    // Quasar Dawn is the z > 4 frontier, which the default 0–0.3 slice hides:
    // the camera used to fly out to an empty sky.
    if (name === 'quasar_dawn' && this.maxZFilter < MAX_CATALOG_Z) {
      this.setRedshiftFilter(this.minZFilter, MAX_CATALOG_Z);
    }
    this.scene.flyToLandmark(name, false, duration);
  }

  toggleOrbit() {
    const isOrbiting = this.scene.toggleAutoOrbit();
    document.getElementById('btn-auto-orbit').classList.toggle('active', isOrbiting);
    document.getElementById('dock-orbit').classList.toggle('active', isOrbiting);
  }

  toggleTransparent() {
    const isTrans = this.scene.toggleTransparentBackground();
    document.getElementById('btn-transparent-bg').classList.toggle('active', isTrans);
    document.getElementById('dock-transparent').classList.toggle('active', isTrans);
  }

  /**
   * Push once for the live SIMBAD catalog, push again to drop back to whatever
   * was loaded before it. The fetch is cached, so only the first push waits on
   * the network.
   */
  async toggleSimbad() {
    const button = this.simbadBtn;
    if (!button || button.disabled) return;

    if (this.simbadActive) {
      if (!this.baseCatalog) return;
      this.loadCatalog(this.baseCatalog, this.baseSourceLabel);
      return;
    }

    button.disabled = true;
    this.renderSimbadButton('Connecting…');

    try {
      this.simbadCatalog ??= await fetchSimbadCatalog({
        onProgress: (done, total) => this.renderSimbadButton(`${done}/${total}`)
      });
      this.loadCatalog(this.simbadCatalog, SIMBAD_LABEL);

      const { count, failedBands } = this.simbadCatalog;
      notify(failedBands > 0
        ? `Loaded ${count.toLocaleString()} SIMBAD objects, but ${failedBands} of the query bands failed.`
        : `Loaded ${count.toLocaleString()} real objects from SIMBAD.`);
    } catch (err) {
      notify(`SIMBAD load failed: ${err.message}`, { error: true });
      this.renderSimbadButton();
    } finally {
      button.disabled = false;
    }
  }

  /** Paints the push button: 🟢 live, 🔴 off, or the in-flight fetch progress. */
  renderSimbadButton(progress = null) {
    const button = this.simbadBtn;
    if (!button) return;

    if (progress !== null) {
      button.innerHTML = `<span class="icon">🛰️</span> SIMBAD ${progress}`;
      return;
    }

    button.setAttribute('aria-pressed', String(this.simbadActive));
    button.innerHTML = this.simbadActive
      ? '<span class="icon">🟢</span> SIMBAD Live'
      : '<span class="icon">🔴</span> SIMBAD Off';
    button.title = this.simbadActive
      ? 'Switch the live SIMBAD catalog off and restore the previous dataset'
      : 'Load real galaxies & quasars from the SIMBAD TAP service (CDS Strasbourg)';
  }

  /** Mounts a catalog into the scene and controller, then relabels the header. */
  loadCatalog(catalog, sourceLabel) {
    this.scene.loadDataset(catalog);
    this.controller.setDataset(catalog);
    this.onCatalogLoaded?.(catalog);

    this.simbadActive = sourceLabel === SIMBAD_LABEL;
    if (!this.simbadActive) {
      // Anything loaded by other means becomes what SIMBAD falls back to.
      this.baseCatalog = catalog;
      this.baseSourceLabel = sourceLabel;
    }
    this.renderSimbadButton();

    const badge = this.container.querySelector('.brand-badge');
    const subtitle = this.container.querySelector('.subtitle');
    if (badge) badge.textContent = sourceLabel;
    if (subtitle) {
      subtitle.textContent = `Planck 2018 Cosmology • ${catalog.count.toLocaleString()} Galaxies & Quasars`;
    }
  }

  bindZoomEvents() {
    // Double-click on the map flies in at the pointer; Shift or Alt flies out.
    // A single click is left to the named-object layer, which selects labels.
    window.addEventListener('dblclick', e => {
      if (e.target !== this.scene.renderer.domElement) return;
      if (this.container.matches('.ar-active, .solar-active, .warp-active, .tour-active')) return;
      e.preventDefault();
      const direction = e.shiftKey || e.altKey ? 'out' : 'in';
      this.scene.zoomAtScreenPoint(e.clientX, e.clientY, direction);
    });
  }

  bindKeyboardShortcuts() {
    const actions = {
      f: () => this.toggleFullscreen(),
      h: () => this.toggleUIVisibility(),
      o: () => this.toggleOrbit(),
      t: () => this.toggleTransparent(),
      r: () => this.controller.reset(),
      ' ': () => this.controller.togglePlay(),
      '/': () => this.openSearch()
    };

    window.addEventListener('keydown', e => {
      // Ctrl/Cmd+R must still reload and Ctrl/Cmd+F still find.
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.target.closest?.('input, textarea, select, dialog')) return;
      // A focused button handles its own Space; toggling here as well undid it.
      if (e.key === ' ' && e.target.closest?.('button')) return;
      // The HUD is hidden in AR, the wormhole and the Solar System, so its shortcuts would
      // act on nothing visible.
      if (this.container.matches('.ar-active, .solar-active, .warp-active, .tour-active')) return;

      const action = actions[e.key.toLowerCase()];
      if (!action) return;
      e.preventDefault();
      action();
    });
  }

  toggleFullscreen() {
    if (!document.fullscreenEnabled) return;
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    request.catch(err => notify(`Fullscreen unavailable: ${err.message}`, { error: true }));
  }

  toggleUIVisibility() {
    this.uiHidden = !this.uiHidden;
    const cards = ['card-header', 'card-telemetry', 'card-controller', 'card-histogram', 'named-layer'];
    cards.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('hidden-hud', this.uiHidden);
      // Invisible controls must not stay reachable with Tab.
      el.inert = this.uiHidden;
    });
    document.getElementById('recording-dock')?.classList.toggle('hidden', !this.uiHidden);
  }

  syncPlayState(isPlaying) {
    document.getElementById('play-pause-icon').textContent = isPlaying ? '⏸' : '▶';
    document.getElementById('play-pause-label').textContent = isPlaying ? 'Pause' : 'Play';
    document.getElementById('dock-play-pause').textContent = isPlaying ? '⏸' : '▶';
    document.getElementById('btn-play-pause').classList.toggle('paused', !isPlaying);
  }

  updateTelemetry(stats) {
    const count = `${stats.currentCount.toLocaleString()} / ${stats.totalCount.toLocaleString()}`;
    document.getElementById('stat-count').textContent = count;
    document.getElementById('stat-mini').textContent = count;
    document.getElementById('dock-count').textContent = count;
    document.getElementById('stat-galaxies').textContent = stats.galaxiesCount.toLocaleString();
    document.getElementById('stat-qsos').textContent = stats.qsosCount.toLocaleString();
    document.getElementById('stat-progress-bar').style.width = `${(stats.progressNorm * 100).toFixed(1)}%`;

    const scrubber = document.getElementById('slider-scrubber');
    if (document.activeElement !== scrubber) {
      scrubber.value = Math.round(stats.progressNorm * 1000);
    }
    document.getElementById('scrubber-pct-label').textContent = `${(stats.progressNorm * 100).toFixed(1)}%`;

    const distance = stats.distanceMpc >= 1000
      ? `${(stats.distanceMpc / 1000).toFixed(2)} Gpc`
      : `${stats.distanceMpc.toFixed(0)} Mpc`;
    document.getElementById('stat-redshift').textContent = `z = 0.00 — ${stats.currentMaxZ.toFixed(2)}`;
    document.getElementById('stat-distance').textContent = `0 Mpc — ${distance}`;
    document.getElementById('stat-lookback').textContent = `0.00 — ${stats.lookbackGyr.toFixed(2)} Gyr ago`;

    this.syncPlayState(stats.isPlaying);
    this.drawHistogram();
  }

  drawHistogram() {
    const svg = this.histogramSvg;
    const order = this.controller.order;
    // Hidden on phones; scanning every point for a chart nobody sees is waste.
    if (!svg || !order || !svg.getClientRects().length) return;

    const hist = computeRedshiftHistogram(
      this.controller.redshifts,
      this.controller.isQSOArray,
      order,
      this.controller.progress,
      this.minZFilter,
      this.maxZFilter,
      50
    );

    let maxBinVal = 10;
    for (let i = 0; i < hist.numBins; i++) {
      maxBinVal = Math.max(maxBinVal, hist.galaxyBins[i] + hist.qsoBins[i]);
    }

    const width = 400;
    const height = 110;
    const barWidth = width / hist.numBins;

    let svgHTML = '';

    for (let i = 0; i < hist.numBins; i++) {
      const x = i * barWidth;
      const gHeight = (hist.galaxyBins[i] / maxBinVal) * (height - 18);
      const qHeight = (hist.qsoBins[i] / maxBinVal) * (height - 18);
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
    svgHTML += `<text x="5" y="${height - 4}" class="hist-label">z=${this.minZFilter.toFixed(2)}</text>`;
    svgHTML += `<text x="${width - 5}" y="${height - 4}" class="hist-label" text-anchor="end">z=${this.maxZFilter.toFixed(2)}</text>`;

    svg.innerHTML = svgHTML;
  }
}
