const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;
const count = (n) => Math.round(n).toLocaleString('en-US');
const clock = (seconds) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const TOAST_MS = 1800;
const MAX_TOASTS = 3;
// However hard the rocks come, the red vignette flashes at most twice a second.
const FLASH_GAP_MS = 500;

const TEMPLATE = `
  <div class="game-picker" role="dialog" aria-modal="true" aria-labelledby="game-picker-title" hidden>
    <div class="game-picker-card glass-card">
      <h2 id="game-picker-title">Launch your spaceship</h2>
      <p class="game-picker-lead">Take off from Earth and fly the Solar System. Every world pulls on your ship,
        and rocks in the asteroid belt cost hull — but the belt scores triple.</p>
      <p class="game-picker-ask">How will you fly?</p>
      <div class="game-picker-options">
        <button type="button" class="game-option" data-controls="touch">
          <span class="game-option-icon" aria-hidden="true">📱</span>
          <strong>On-screen</strong>
          <span>A stick to steer and buttons to thrust, boost and brake — for phones and tablets.</span>
          <em class="game-option-tag" hidden>Suits this device</em>
        </button>
        <button type="button" class="game-option" data-controls="keyboard">
          <span class="game-option-icon" aria-hidden="true">⌨️</span>
          <strong>Keyboard</strong>
          <span>W/S thrust · A/D turn · ↑/↓ pitch · Q/E roll · Shift boost · Space brake</span>
          <em class="game-option-tag" hidden>Suits this device</em>
        </button>
      </div>
      <label class="game-hd">
        <input type="checkbox" />
        <span class="game-hd-text"></span>
      </label>
      <div class="game-picker-actions">
        <button type="button" class="control-btn small" data-picker="cancel">Not now</button>
      </div>
    </div>
  </div>

  <div class="game-countdown" hidden>
    <p class="game-tminus">T-minus</p>
    <p class="game-count" aria-live="assertive"></p>
    <p class="game-scale"></p>
    <p class="game-hold" hidden>
      <span class="game-hold-text"></span>
      <button type="button" class="control-btn small game-hold-retry" hidden>Try again</button>
    </p>
    <div class="game-pack glass-card">
      <p class="game-pack-title">Resource pack</p>
      <div class="game-pack-row game-pack-main">
        <span class="game-pack-label">Game resources</span>
        <span class="game-pack-value"></span>
        <progress max="1"></progress>
      </div>
      <div class="game-pack-row game-pack-hd" hidden>
        <span class="game-pack-label">HD planet maps</span>
        <span class="game-pack-value"></span>
        <progress max="1" value="0"></progress>
      </div>
      <p class="game-pack-stage"></p>
    </div>
    <button type="button" class="control-btn small game-abort">Abort launch</button>
  </div>

  <div class="game-flight" hidden>
    <div class="game-hull glass-card">
      <span class="game-k">Hull</span>
      <div class="game-bar"><i></i></div>
      <strong class="game-hull-value"></strong>
    </div>
    <div class="game-score">
      <strong class="game-score-value">0</strong>
      <span class="game-best"></span>
      <span class="game-mult" hidden></span>
    </div>
    <button type="button" class="game-pause-btn" aria-label="Pause">⏸</button>
    <div class="game-read glass-card">
      <div><span class="game-k">Speed</span><strong data-read="speed"></strong></div>
      <div><span class="game-k">Altitude</span><strong data-read="altitude"></strong></div>
      <div><span class="game-k">Gravity</span><strong data-read="gravity"></strong></div>
      <p class="game-status"></p>
      <p class="game-hdmini" hidden></p>
    </div>
    <div class="game-reticle" aria-hidden="true"></div>
    <p class="game-legend" hidden></p>
  </div>

  <div class="game-toasts" aria-live="polite"></div>
  <div class="game-heat" aria-hidden="true"></div>
  <div class="game-vignette" aria-hidden="true"></div>
  <div class="game-fade" aria-hidden="true"></div>

  <div class="game-modal game-pause" role="dialog" aria-modal="true" aria-labelledby="game-pause-title" hidden>
    <div class="game-modal-card glass-card">
      <h2 id="game-pause-title">Paused</h2>
      <div class="game-modal-actions">
        <button type="button" class="control-btn" data-act="resume">Resume</button>
        <button type="button" class="control-btn" data-act="restart">Launch again from Earth</button>
        <button type="button" class="control-btn" data-act="exit">Leave the game</button>
      </div>
    </div>
  </div>

  <div class="game-modal game-over" role="dialog" aria-modal="true" aria-labelledby="game-over-title" hidden>
    <div class="game-modal-card glass-card">
      <h2 id="game-over-title" class="game-over-title">Ship destroyed</h2>
      <p class="game-over-cause"></p>
      <p class="game-newbest" hidden>New best score</p>
      <dl class="game-over-stats"></dl>
      <div class="game-modal-actions">
        <button type="button" class="control-btn" data-act="retry">Launch again</button>
        <button type="button" class="control-btn" data-act="exit">Leave the game</button>
      </div>
    </div>
  </div>
`;

/**
 * Everything the game shows over the canvas: the controller choice, the
 * countdown and its resource pack, the flight readouts, and the pause and
 * game-over screens. It only displays; GameMode decides, through the `on…`
 * callbacks it sets.
 */
export class GameHUD {
  constructor(container) {
    this.root = document.createElement('div');
    this.root.className = 'game-layer';
    this.root.hidden = true;
    this.root.innerHTML = TEMPLATE;
    container.appendChild(this.root);
    const $ = (selector) => this.root.querySelector(selector);

    this.picker = $('.game-picker');
    this.options = [...this.root.querySelectorAll('.game-option')];
    this.cancelBtn = $('[data-picker="cancel"]');
    this.hdRow = $('.game-hd');
    this.hdBox = $('.game-hd input');
    this.hdText = $('.game-hd-text');

    this.countdown = $('.game-countdown');
    this.countEl = $('.game-count');
    this.scaleEl = $('.game-scale');
    this.hold = $('.game-hold');
    this.holdText = $('.game-hold-text');
    this.holdRetry = $('.game-hold-retry');
    this.packBar = $('.game-pack-main progress');
    this.packValue = $('.game-pack-main .game-pack-value');
    this.packStage = $('.game-pack-stage');
    this.hdPack = $('.game-pack-hd');
    this.hdBar = $('.game-pack-hd progress');
    this.hdValue = $('.game-pack-hd .game-pack-value');

    this.flight = $('.game-flight');
    this.hull = $('.game-hull');
    this.hullBar = $('.game-bar i');
    this.hullValue = $('.game-hull-value');
    this.score = $('.game-score-value');
    this.best = $('.game-best');
    this.mult = $('.game-mult');
    this.reads = Object.fromEntries([...this.root.querySelectorAll('[data-read]')].map((el) => [el.dataset.read, el]));
    this.status = $('.game-status');
    this.hdMini = $('.game-hdmini');
    this.legend = $('.game-legend');

    this.toasts = $('.game-toasts');
    this.heat = $('.game-heat');
    this.vignette = $('.game-vignette');
    this.fader = $('.game-fade');
    this.pauseEl = $('.game-pause');
    this.overEl = $('.game-over');
    this.overTitle = $('.game-over-title');
    this.overCause = $('.game-over-cause');
    this.newBest = $('.game-newbest');
    this.overStats = $('.game-over-stats');

    this.lastFlash = 0;
    this.legendTimer = 0;
    this.shown = {};

    $('.game-abort').addEventListener('click', () => this.onAbort?.());
    this.holdRetry.addEventListener('click', () => this.onRetryPack?.());
    $('.game-pause-btn').addEventListener('click', () => this.onPause?.());
    this.pauseEl.querySelector('[data-act="resume"]').addEventListener('click', () => this.onResume?.());
    this.pauseEl.querySelector('[data-act="restart"]').addEventListener('click', () => this.onRestart?.());
    this.pauseEl.querySelector('[data-act="exit"]').addEventListener('click', () => this.onExit?.());
    this.overEl.querySelector('[data-act="retry"]').addEventListener('click', () => this.onRetry?.());
    this.overEl.querySelector('[data-act="exit"]').addEventListener('click', () => this.onExit?.());
  }

  /**
   * Asks how the player will fly. Resolves `{ controls, hd }`, or null if
   * they back out. `recommend` marks the scheme that suits the device;
   * `remembered` is the one chosen last time, which gets the focus.
   */
  openPicker({ recommend, remembered }) {
    this.root.hidden = false;
    this.picker.hidden = false;
    for (const option of this.options) {
      option.querySelector('.game-option-tag').hidden = option.dataset.controls !== recommend;
      option.classList.toggle('remembered', option.dataset.controls === remembered);
    }
    const first = this.options.find((o) => o.dataset.controls === (remembered || recommend)) ?? this.options[0];
    requestAnimationFrame(() => first.focus());

    return new Promise((resolve) => {
      const finish = (value) => {
        this.options.forEach((o) => o.removeEventListener('click', pick));
        this.cancelBtn.removeEventListener('click', cancel);
        window.removeEventListener('keydown', key);
        this.picker.hidden = true;
        resolve(value);
      };
      const pick = (e) => finish({
        controls: e.currentTarget.dataset.controls,
        hd: !this.hdRow.hidden && !this.hdBox.disabled && this.hdBox.checked
      });
      const cancel = () => finish(null);
      const key = (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        cancel();
      };
      this.options.forEach((o) => o.addEventListener('click', pick));
      this.cancelBtn.addEventListener('click', cancel);
      window.addEventListener('keydown', key);
    });
  }

  /**
   * The HD maps line in the picker: 'checking' (size not known yet, but it can
   * be ticked), 'offer', 'saved', 'busy' or 'none'. `checked` is applied only
   * when given, so a later state keeps what the player chose.
   */
  setHdOption({ state, bytes = 0, metered = false, checked }) {
    const open = state === 'checking' || state === 'offer';
    this.hdRow.hidden = state === 'none';
    this.hdBox.disabled = !open;
    if (!open) this.hdBox.checked = false;
    else if (checked !== undefined) this.hdBox.checked = checked;
    const note = metered ? 'Your connection looks metered or slow: this uses data.' : 'Best on Wi-Fi.';
    const text = {
      checking: `Also download the HD planet maps during the countdown (working out the size…). ${note}`,
      offer: `Also download the HD planet maps during the countdown (${mb(bytes)}), so worlds are sharp the moment you fly up to them. ${note}`,
      saved: 'HD planet maps are already saved on this device ✓',
      busy: 'HD planet maps are already downloading.'
    }[state];
    if (text) this.hdText.textContent = text;
  }

  showCountdown() {
    this.root.hidden = false;
    this.countdown.hidden = false;
    this.shown.count = null;
    this.setHold(null);
  }

  setCount(value) {
    if (this.shown.count === value) return;
    this.shown.count = value;
    const liftoff = value === 'LIFTOFF';
    this.countEl.textContent = liftoff ? 'Liftoff' : String(value);
    this.countEl.classList.toggle('liftoff', liftoff);
    this.countdown.classList.toggle('lifting', liftoff);
    // Restart the tick: one pulse a second.
    this.countEl.classList.remove('tick');
    void this.countEl.offsetWidth;
    this.countEl.classList.add('tick');
  }

  setHold(text, { retry = false } = {}) {
    const key = text === null ? null : `${text}|${retry}`;
    if (this.shown.hold === key) return;
    this.shown.hold = key;
    this.hold.hidden = !text;
    this.holdText.textContent = text ? `Hold · ${text}` : '';
    this.holdRetry.hidden = !retry;
  }

  /** `progress` null shows the bar as working without a known share. */
  setPack(progress, stage) {
    const key = `${progress === null ? '-' : progress.toFixed(2)}|${stage}`;
    if (this.shown.pack === key) return;
    this.shown.pack = key;
    if (progress === null) {
      this.packBar.removeAttribute('value');
      this.packValue.textContent = '';
    } else {
      this.packBar.value = progress;
      this.packValue.textContent = `${Math.round(progress * 100)}%`;
    }
    this.packStage.textContent = stage;
  }

  /** The HD maps' progress, on the countdown and in flight. `hd` null hides it. */
  setHdProgress(hd) {
    const text = !hd ? ''
      : hd.failed ? 'stopped; what was saved is kept'
        : hd.finished ? 'saved ✓'
          : `${mb(hd.done)} of ${mb(hd.total)}`;
    if (this.shown.hd === text) return;
    this.shown.hd = text;
    this.hdPack.hidden = !hd;
    this.hdMini.hidden = !hd;
    if (!hd) return;
    this.hdBar.value = hd.total ? hd.done / hd.total : 1;
    this.hdValue.textContent = text;
    this.hdMini.textContent = `HD maps · ${text}`;
  }

  /** A line under the count: how big the view is, as the zoom closes in on the ship. */
  setScale(text) {
    if (this.shown.scale === text) return;
    this.shown.scale = text;
    this.scaleEl.textContent = text;
  }

  hideCountdown() {
    this.countdown.hidden = true;
  }

  showFlight({ touch }) {
    this.root.hidden = false;
    this.flight.hidden = false;
    this.flight.classList.toggle('touch', touch);
    this.shown.stats = null;
  }

  hideFlight() {
    this.flight.hidden = true;
    this.hideLegend();
  }

  setStats(s) {
    const hullShare = Math.max(0, s.hull / s.maxHull);
    this.hullBar.style.transform = `scaleX(${hullShare})`;
    this.hullValue.textContent = `${Math.ceil(hullShare * 100)}%`;
    this.hull.classList.toggle('low', hullShare < 0.3);
    this.score.textContent = count(s.score);
    this.best.textContent = `Best ${count(s.best)}`;
    this.mult.hidden = !s.inBelt;
    if (s.inBelt) this.mult.textContent = `In the belt · ×${s.multiplier}`;
    this.reads.speed.textContent = `${count(s.speed)} L/s`;
    this.reads.altitude.textContent = `${count(s.altitude)} L · ${s.altitudeOf}`;
    this.reads.gravity.textContent = `${s.gravity.toFixed(2)} g · ${s.gravityOf}`;
    this.status.textContent = s.status;
    this.status.classList.toggle('warn', !!s.warn);
  }

  toast(text, tone = '') {
    const el = document.createElement('p');
    el.className = `game-toast ${tone}`;
    el.textContent = text;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > MAX_TOASTS) this.toasts.firstChild.remove();
    setTimeout(() => el.remove(), TOAST_MS);
  }

  /** A steady orange glow at the edges, 0–1, while the Sun cooks the hull. */
  setHeat(share) {
    const value = share.toFixed(2);
    if (this.shown.heat === value) return;
    this.shown.heat = value;
    this.heat.style.opacity = value;
  }

  flashDamage() {
    const now = performance.now();
    if (now - this.lastFlash < FLASH_GAP_MS) return;
    this.lastFlash = now;
    this.vignette.classList.remove('hit');
    void this.vignette.offsetWidth;
    this.vignette.classList.add('hit');
  }

  showLegend(text, ms) {
    this.legend.textContent = text;
    this.legend.hidden = false;
    clearTimeout(this.legendTimer);
    this.legendTimer = setTimeout(() => this.hideLegend(), ms);
  }

  hideLegend() {
    clearTimeout(this.legendTimer);
    this.legend.hidden = true;
  }

  showPause() {
    this.pauseEl.hidden = false;
    requestAnimationFrame(() => this.pauseEl.querySelector('[data-act="resume"]').focus());
  }

  hidePause() {
    this.pauseEl.hidden = true;
  }

  /** The end of a run: what happened and how it went. */
  showOver({ cause, score, best, newBest, time, beltTime, landed, hits }) {
    this.overCause.textContent = cause;
    this.newBest.hidden = !newBest;
    const rows = [
      ['Score', count(score)],
      ['Best', count(best)],
      ['Time flown', clock(time)],
      ['In the belt', clock(beltTime)],
      ['Landed on', landed.length ? landed.join(', ') : 'nowhere yet'],
      ['Rocks hit', count(hits)]
    ];
    this.overStats.replaceChildren(...rows.flatMap(([label, value]) => {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = label;
      dd.textContent = value;
      return [dt, dd];
    }));
    this.overEl.hidden = false;
    requestAnimationFrame(() => this.overEl.querySelector('[data-act="retry"]').focus());
  }

  hideOver() {
    this.overEl.hidden = true;
  }

  /** Covers the screen for a cut, or uncovers it. */
  fade(on) {
    this.fader.classList.toggle('on', on);
  }

  hideAll() {
    this.picker.hidden = true;
    this.countdown.hidden = true;
    this.hideFlight();
    this.hidePause();
    this.hideOver();
    this.toasts.replaceChildren();
    this.vignette.classList.remove('hit');
    this.setHeat(0);
    this.fade(false);
    this.root.hidden = true;
  }
}
