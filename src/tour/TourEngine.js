import * as THREE from 'three';
import { TOURS } from './tours.js';
import { MPC_PER_UNIT, BAND_OUTER } from '../solar/scale.js';
import { MPC_PER_PC } from '../data/nearbyStars.js';
import { soundMuted, setSoundMuted } from '../ui/sound.js';
import { notify } from '../ui/notify.js';

// A zoom into the Solar System starts from this far out, among the stars and
// outside the band where the two layers meet.
const APPROACH_MPC = 5 * MPC_PER_PC;
// And ends here, deep in the Oort Cloud (display units from the Sun), before
// the flight in to the first body.
const DESCENT_UNITS = 1500;
// Narration is left on screen at least long enough to read.
const WORDS_PER_SECOND = 2.6;
const BEAT_MS = 1000;

class Cancelled extends Error {}

const ease = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Plays a tour: each chapter shows (and speaks) its narration while the camera
 * goes where it says, then holds long enough to be read. It drives only what
 * already exists — the map's log-scale flights, the Solar System's focus
 * flights, and a scripted zoom that crosses the scale band like a scroll does —
 * so a tour really travels. Touching the view pauses it and hands the camera
 * back; ▶ flies to the current chapter again.
 */
export class TourEngine {
  constructor({ container, scene, portal, namedLayer, hud, controller }) {
    Object.assign(this, { container, scene, portal, namedLayer, hud, controller });
    this.tour = TOURS[0];
    this.active = false;
    this.playing = false;
    this.done = false;
    this.index = 0;
    this.token = 0;
    this.zoom = null;
    this.buildPanel();
    this.bindInput();
  }

  buildPanel() {
    this.panel = document.createElement('section');
    this.panel.className = 'tour-panel glass-card';
    this.panel.setAttribute('aria-label', 'Guided tour');
    this.panel.hidden = true;
    this.panel.innerHTML = `
      <p class="tour-step"><span class="tour-count"></span> · <span class="tour-title"></span></p>
      <p class="tour-text" aria-live="polite"></p>
      <div class="tour-progress" aria-hidden="true"><span></span></div>
      <div class="tour-controls">
        <button type="button" data-tour="prev" aria-label="Previous chapter">⏮</button>
        <button type="button" data-tour="play" aria-label="Pause">⏸</button>
        <button type="button" data-tour="next" aria-label="Next chapter">⏭</button>
        <button type="button" data-tour="sound" aria-label="Narration voice"></button>
        <button type="button" data-tour="end" class="tour-end">End tour</button>
      </div>
      <p class="tour-hint">Touch the view to take over · ▶ picks the tour up again</p>
    `;
    this.countEl = this.panel.querySelector('.tour-count');
    this.titleEl = this.panel.querySelector('.tour-title');
    this.textEl = this.panel.querySelector('.tour-text');
    this.barEl = this.panel.querySelector('.tour-progress span');
    this.playBtn = this.panel.querySelector('[data-tour="play"]');
    this.soundBtn = this.panel.querySelector('[data-tour="sound"]');
    this.panel.querySelector('[data-tour="prev"]').addEventListener('click', () => this.jump(-1));
    this.panel.querySelector('[data-tour="next"]').addEventListener('click', () => this.jump(1));
    this.panel.querySelector('[data-tour="end"]').addEventListener('click', () => this.end());
    this.playBtn.addEventListener('click', () => this.toggle());
    this.soundBtn.addEventListener('click', () => this.setVoice(soundMuted()));
    this.container.appendChild(this.panel);
    this.setVoice(!soundMuted());
  }

  bindInput() {
    // Taking the controls pauses the tour rather than fighting it.
    const interrupt = (e) => {
      if (this.active && this.playing && !this.panel.contains(e.target)) this.pause();
    };
    window.addEventListener('pointerdown', interrupt, true);
    window.addEventListener('wheel', interrupt, { capture: true, passive: true });
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, dialog')) return;
      // A focused button handles its own Space.
      if (e.key === ' ' && e.target.closest?.('button')) return;
      const actions = { ' ': () => this.toggle(), ArrowRight: () => this.jump(1), ArrowLeft: () => this.jump(-1), Escape: () => this.end() };
      const action = actions[e.key];
      if (!action) return;
      e.preventDefault();
      action();
    });
  }

  start() {
    if (!this.active) {
      this.active = true;
      this.container.classList.add('tour-active');
      this.namedLayer.clearSelection();
      this.panel.hidden = false;
      this.index = 0;
    }
    this.play(this.done ? 0 : this.index);
  }

  end() {
    if (!this.active) return;
    this.halt();
    this.active = false;
    this.playing = false;
    this.done = false;
    this.panel.hidden = true;
    this.container.classList.remove('tour-active');
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play(this.done ? 0 : this.index);
  }

  pause() {
    if (!this.playing) return;
    this.halt();
    this.playing = false;
    this.renderState('Paused');
  }

  jump(step) {
    const last = this.tour.chapters.length - 1;
    this.play(THREE.MathUtils.clamp(this.index + step, 0, last));
  }

  /** Stops whatever the tour set moving and leaves the camera where it is. */
  halt() {
    this.token++;
    if (this.zoom) {
      this.zoom.reject(new Cancelled());
      this.zoom = null;
    }
    this.scene.cameraFlight = null;
    window.speechSynthesis?.cancel();
  }

  async play(from) {
    this.halt();
    const token = this.token;
    this.playing = true;
    this.done = false;
    try {
      for (let i = from; i < this.tour.chapters.length; i++) {
        this.index = i;
        await this.runChapter(this.tour.chapters[i], token);
      }
      this.playing = false;
      this.done = true;
      this.renderState('The end · explore freely, or ▶ to go again');
    } catch (err) {
      if (err instanceof Cancelled) return;
      console.error(err);
      notify(`The tour stopped: ${err.message}`, { error: true });
      this.end();
    }
  }

  async runChapter(chapter, token) {
    this.renderChapter(chapter);
    const started = performance.now();
    const speech = this.speak(chapter.text);
    await this.go(chapter.go, token);
    const readMs = (chapter.text.split(/\s+/).length / WORDS_PER_SECOND + 1.5) * 1000;
    await this.sleep(readMs - (performance.now() - started), token);
    await speech;
    this.check(token);
    await this.sleep(BEAT_MS, token);
  }

  renderChapter(chapter) {
    const n = this.tour.chapters.length;
    this.countEl.textContent = `${this.index + 1} / ${n}`;
    this.titleEl.textContent = chapter.title;
    this.textEl.textContent = chapter.text;
    this.barEl.style.width = `${((this.index + 1) / n) * 100}%`;
    this.renderState(null);
  }

  /** The play button, and a status in place of the count when paused or done. */
  renderState(status) {
    const n = this.tour.chapters.length;
    this.countEl.textContent = status ?? `${this.index + 1} / ${n}`;
    this.playBtn.textContent = this.playing ? '⏸' : '▶';
    this.playBtn.setAttribute('aria-label', this.playing ? 'Pause' : 'Play');
  }

  setVoice(on) {
    setSoundMuted(!on);
    if (!on) window.speechSynthesis?.cancel();
    this.soundBtn.textContent = on ? '🔊' : '🔇';
    this.soundBtn.setAttribute('aria-pressed', String(on));
  }

  /** Reads the narration aloud where the browser can; resolves when it has finished (or plainly will not). */
  speak(text) {
    const synth = window.speechSynthesis;
    if (soundMuted() || !synth) return Promise.resolve();
    synth.cancel();
    const line = new SpeechSynthesisUtterance(text);
    const voice = synth.getVoices().find((v) => /^en[-_]/i.test(v.lang) && v.localService);
    if (voice) line.voice = voice;
    return new Promise((resolve) => {
      // Some engines never fire `end`; do not wait on them for ever.
      const cap = setTimeout(resolve, (text.length / 12 + 4) * 1000);
      line.onend = line.onerror = () => {
        clearTimeout(cap);
        resolve();
      };
      synth.speak(line);
    });
  }

  check(token) {
    if (token !== this.token) throw new Cancelled();
  }

  sleep(ms, token) {
    return new Promise((resolve, reject) => {
      setTimeout(() => (token === this.token ? resolve() : reject(new Cancelled())), Math.max(0, ms));
    });
  }

  /** Resolves true once `test` passes, false after `timeoutMs`; rejects if the tour moves on. */
  until(test, token, timeoutMs) {
    const deadline = performance.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const tick = () => {
        if (token !== this.token) reject(new Cancelled());
        else if (test()) resolve(true);
        else if (performance.now() > deadline) resolve(false);
        else requestAnimationFrame(tick);
      };
      tick();
    });
  }

  async go(go, token) {
    if (go.plot === 'all') this.controller.setInstantAll();
    if (go.body) await this.toBody(go.body, token);
    else if (go.sunDistancePc) await this.toSunDistance(go.sunDistancePc * MPC_PER_PC, go.seconds ?? 6, token);
    else if (go.object) await this.toObject(go, token);
    else if (go.landmark) await this.toLandmark(go, token);
  }

  /** How far the camera is from the Sun, in Mpc, in whichever layer has it. */
  sunDistance() {
    return this.portal.active ? this.portal.solar.camera.position.length() * MPC_PER_UNIT : this.scene.camera.position.length();
  }

  /**
   * Called every frame before anything draws. A scripted zoom moves whichever
   * camera has the view along its line through the Sun, on a log scale, so it
   * crosses from one layer into the other exactly as a scroll does.
   */
  update(dt) {
    const z = this.zoom;
    if (!z) return;
    z.t = Math.min(1, z.t + dt / z.seconds);
    const d = Math.exp(THREE.MathUtils.lerp(Math.log(z.from), Math.log(z.to), ease(z.t)));
    if (this.portal.active) this.portal.solar.camera.position.setLength(d / MPC_PER_UNIT);
    else this.scene.camera.position.setLength(d);
    if (z.t >= 1) {
      this.zoom = null;
      z.resolve();
    }
  }

  zoomTo(to, seconds, token) {
    this.check(token);
    return new Promise((resolve, reject) => {
      this.zoom = { from: this.sunDistance(), to, t: 0, seconds, resolve, reject };
    });
  }

  /** A log-scale map flight to `distance` from `target`, arriving along the line it came in on. */
  async mapFlight(target, distance, seconds, token) {
    this.check(token);
    const { camera } = this.scene;
    const dir = camera.position.clone().sub(target);
    if (dir.lengthSq() < 1e-30) dir.set(1, 0.6, 1);
    dir.normalize();
    this.scene.smoothFlyTo(target.clone().addScaledVector(dir, distance), target.clone(), seconds * 1000);
    await this.until(() => !this.scene.cameraFlight, token, seconds * 1000 + 10000);
  }

  /** Into the Solar System from wherever the map is: aim at the Sun, then zoom in through the band. */
  async descend(token) {
    const loading = this.portal.ensureSolar();
    loading.catch(() => {}); // awaited below
    if (!this.portal.aimedAtSun() || this.sunDistance() > APPROACH_MPC * 1.5) {
      await this.mapFlight(new THREE.Vector3(), APPROACH_MPC, 6, token);
    }
    await loading;
    this.check(token);
    await this.zoomTo(DESCENT_UNITS * MPC_PER_UNIT, 5, token);
    await this.until(() => this.portal.active, token, 5000);
  }

  async toBody(name, token) {
    if (!this.portal.active) await this.descend(token);
    const { solar } = this.portal;
    const body = solar.byName.get(name);
    if (!body) return;
    // The Solar System's own grand tour, or the wormhole's arrival, would fight this one.
    solar.stopTour();
    if (solar.approach) solar.approach.t = 1;
    solar.focusOn(body);
    await this.until(() => solar.follow?.body === body && solar.follow.t >= 1, token, 15000);
  }

  async toSunDistance(d, seconds, token) {
    const { portal } = this;
    if (portal.active) {
      // Back to the Sun first, so the way out runs along a line through it.
      const { solar } = portal;
      if (solar.controls.target.lengthSq() > 1e-6) {
        const sun = solar.byName.get('Sun');
        solar.focusOn(sun);
        await this.until(() => solar.follow?.body === sun && solar.follow.t >= 1, token, 10000);
      }
    } else if (!portal.aimedAtSun()) {
      await this.mapFlight(new THREE.Vector3(), Math.max(d, APPROACH_MPC), seconds, token);
    }
    if (Math.abs(Math.log(this.sunDistance() / d)) < 0.01) return;
    // Zooming into the band needs the Solar System ready to take over.
    if (d < BAND_OUTER * MPC_PER_UNIT) {
      await this.portal.ensureSolar();
      this.check(token);
    }
    await this.zoomTo(d, seconds, token);
  }

  /** Out of the Solar System, if in it, to the stars. */
  async leaveSolar(token) {
    if (this.portal.active) await this.toSunDistance(APPROACH_MPC, 7, token);
    await this.until(() => !this.portal.active, token, 5000);
  }

  async toObject(go, token) {
    await this.leaveSolar(token);
    // Named stars arrive a moment after start; give them a little while.
    const find = () => this.namedLayer.objects.find((o) => o.label === go.object || o.ids?.includes(go.object));
    await this.until(() => Boolean(find()), token, 10000);
    const obj = find();
    if (!obj) return; // narrated without moving rather than stopping the tour
    const { x, y, z } = obj.position;
    const distance = go.distanceMpc ?? (obj.viewDistance ?? Math.max(obj.distanceMpc * 0.08, 12)) * 1.5;
    await this.mapFlight(new THREE.Vector3(x, y, z), distance, go.seconds ?? 6, token);
  }

  async toLandmark(go, token) {
    await this.leaveSolar(token);
    const seconds = go.seconds ?? 6;
    this.hud.flyToLandmark(go.landmark, seconds * 1000);
    await this.until(() => !this.scene.cameraFlight, token, seconds * 1000 + 10000);
  }
}
