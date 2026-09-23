import * as THREE from 'three';
import { soundMuted, setSoundMuted } from '../ui/sound.js';

/*
 * The trip from the galaxy map to the Sun: a wormhole at hyperspeed, seen from
 * the bridge of a ship that is not enjoying it. The tunnel is one full-screen
 * shader drawn with the map's own renderer, the bridge is DOM over it, and
 * every sound is synthesised, so nothing is downloaded.
 */

const OPEN_S = 1.4; // the mouth opens over the diving map
const MIN_S = 5.2; // the shortest trip, even when the Solar System is cached
const FLASH_S = 0.45; // the white-out on the way out
const WARN_EVERY_S = 0.8;
const ALARM_EVERY_S = 1.7;
const LY_PER_S_AT_C = 1 / 31557600;
const AU_PER_LY = 63241;
const VOLUME = 0.8;

const WARNINGS = [
  'Wormhole throat entered',
  'Tidal shear rising',
  'Hull stress critical',
  'Inertial dampeners at limit',
  'Spacetime curvature off scale',
  'Sensors blinded · gravitational lensing',
  'Radiation shields at 40%',
  'Coolant pressure dropping',
  'Course locked · Sol',
  'G-type star dead ahead'
];

const VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAGMENT = `
varying vec2 vUv;
uniform float uTime;
uniform float uTravel;
uniform float uOpen;
uniform float uReach;
uniform float uAspect;
uniform float uHeat;
uniform vec2 uCentre;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    sum += amp * noise(p);
    p *= 2.07;
    amp *= 0.5;
  }
  return sum / 0.875;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0 - uCentre;
  float r = length(p);
  float a = atan(p.y, p.x);

  // Distance down the tunnel: the screen's edge is the wall beside the ship,
  // its centre the far end. The angle goes through cos/sin so there is no seam.
  float depth = 0.45 / max(r, 0.02);
  float z = depth + uTravel;
  float twist = a + 0.3 * depth + uTime * 0.25;
  vec2 around = vec2(cos(twist), sin(twist));
  float walls = fbm(vec3(around * 1.7, z * 0.5));
  float bands = fbm(vec3(around * 3.1 + 5.0, z * 1.3));
  float swirl = a + 0.08 * depth;
  float streaks = pow(noise(vec3(cos(swirl) * 40.0, sin(swirl) * 40.0, z * 0.16)), 8.0);

  vec3 col = mix(vec3(0.02, 0.01, 0.07), vec3(0.34, 0.1, 0.66), smoothstep(0.3, 0.8, walls));
  col = mix(col, vec3(0.2, 0.72, 1.0), smoothstep(0.55, 0.9, bands) * 0.75);
  col += vec3(0.85, 0.93, 1.0) * streaks * (2.0 + 3.0 * uHeat);

  // The light at the end of the tunnel is the Sun.
  vec3 sun = vec3(1.0, 0.8, 0.52);
  col = mix(col, sun, pow(smoothstep(0.5, 0.0, r), 2.2));
  col += sun * exp(-r * 7.0) * (0.35 + 0.35 * uHeat);
  col *= 1.0 - 0.5 * smoothstep(0.9, 2.0, r);

  // The mouth opens over the map, ringed where it bends the light.
  float edge = uOpen * uReach;
  float inside = 1.0 - smoothstep(edge - 0.15, edge, r);
  float rim = exp(-pow((r - edge) * 12.0, 2.0)) * (1.0 - step(1.0, uOpen));
  gl_FragColor = vec4(mix(vec3(0.75, 0.92, 1.0), col, inside), max(inside, rim));
}`;

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const superscript = (n) => String(n).replace(/\d/g, (d) => SUPERSCRIPT[d]);

function formatSpeed(lyPerSecond) {
  const c = lyPerSecond / LY_PER_S_AT_C;
  if (c < 1e4) return `${Math.round(c).toLocaleString('en-US')} c`;
  const exponent = Math.floor(Math.log10(c));
  return `${(c / 10 ** exponent).toFixed(1)} × 10${superscript(exponent)} c`;
}

function formatDistance(ly) {
  if (ly >= 1) return `${Math.round(ly).toLocaleString('en-US')} ly`;
  return `${Math.round(ly * AU_PER_LY).toLocaleString('en-US')} AU`;
}

function noiseBuffer(ctx, brown) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = brown ? last * 3.5 : white;
  }
  return buffer;
}

/** The ship: hull rumble, beating engines, spacetime rushing past, alarms. */
class ShipSound {
  constructor(ctx, muted) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = muted ? 0 : VOLUME;
    this.out.connect(ctx.destination);
    this.sources = [];
    this.white = noiseBuffer(ctx, false);

    this.rumble = this.voice([this.loop(noiseBuffer(ctx, true))], 'lowpass', 160, 0.55);
    // Two saws a hair apart, so the engines beat.
    this.engine = this.voice([this.osc(44), this.osc(44.7)], 'lowpass', 300, 0.14);
    this.rush = this.voice([this.loop(this.white)], 'bandpass', 500, 0.35, 0.8);
    for (const source of this.sources) source.start();
  }

  loop(buffer) {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    this.sources.push(source);
    return source;
  }

  osc(frequency) {
    const source = this.ctx.createOscillator();
    source.type = 'sawtooth';
    source.frequency.value = frequency;
    this.sources.push(source);
    return source;
  }

  voice(sources, type, frequency, level, q = 0.7) {
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.4);
    for (const source of sources) source.connect(filter);
    filter.connect(gain).connect(this.out);
    return { sources, filter, gain, level };
  }

  /** `push` runs 0 → 1 as the ship is driven harder, past 1 on the way out. */
  update(push) {
    const t = this.ctx.currentTime;
    this.engine.sources.forEach((o, i) => o.frequency.setTargetAtTime((44 + 0.7 * i) * (1 + push), t, 0.4));
    this.engine.filter.frequency.setTargetAtTime(300 + 900 * push, t, 0.4);
    this.rush.filter.frequency.setTargetAtTime(500 + 2500 * push, t, 0.3);
    this.rush.gain.gain.setTargetAtTime(this.rush.level * (0.6 + 0.4 * push), t, 0.3);
  }

  tone(type, frequency, start, length, level, endFrequency) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    if (endFrequency) osc.frequency.exponentialRampToValueAtTime(endFrequency, start + length);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(level, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(gain).connect(this.out);
    osc.start(start);
    osc.stop(start + length + 0.05);
  }

  blip() {
    const t = this.ctx.currentTime;
    this.tone('sine', 1320, t, 0.07, 0.05);
    this.tone('sine', 1760, t + 0.08, 0.06, 0.04);
  }

  alarm() {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      this.tone('square', 740, t + i * 0.44, 0.2, 0.035);
      this.tone('square', 988, t + i * 0.44 + 0.22, 0.2, 0.035);
    }
  }

  boom() {
    const t = this.ctx.currentTime;
    this.tone('sine', 120, t, 1.6, 0.55, 30);
    const source = this.ctx.createBufferSource();
    source.buffer = this.white;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, t);
    filter.frequency.exponentialRampToValueAtTime(80, t + 1.2);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    source.connect(filter).connect(gain).connect(this.out);
    source.start(t);
    source.stop(t + 1.5);
  }

  setMuted(muted) {
    this.out.gain.setTargetAtTime(muted ? 0 : VOLUME, this.ctx.currentTime, 0.05);
  }

  fadeOut(seconds) {
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + seconds);
    for (const source of this.sources) source.stop(t + seconds + 0.05);
  }
}

export class Wormhole {
  constructor(container, renderer) {
    this.renderer = renderer;
    this.phase = null;
    this.muted = soundMuted();
    this._size = new THREE.Vector2();

    this.uniforms = {
      uTime: { value: 0 },
      uTravel: { value: 0 },
      uOpen: { value: 0 },
      uReach: { value: 2 },
      uAspect: { value: 1 },
      uHeat: { value: 0 },
      uCentre: { value: new THREE.Vector2() }
    };
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthTest: false,
        depthWrite: false
      })
    );
    quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.el = document.createElement('div');
    this.el.className = 'wormhole';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="wh-vignette"></div>
      <div class="wh-alert" aria-hidden="true">
        <span class="wh-alert-tag">⚠ Warning</span>
        <span class="wh-alert-text"></span>
        <span class="wh-skip" hidden>Tap to drop out of the wormhole</span>
      </div>
      <ol class="wh-log" aria-hidden="true"></ol>
      <dl class="wh-readouts" aria-hidden="true">
        <div><dt>Velocity</dt><dd class="wh-speed"></dd></div>
        <div><dt>Distance to the Sun</dt><dd class="wh-distance"></dd></div>
        <div class="wh-hull"><dt>Hull</dt><dd></dd></div>
      </dl>
      <button class="wh-sound" type="button" aria-label="Sound"></button>
      <div class="wh-flash"></div>
      <span class="wh-sr" role="status">Travelling through a wormhole to the Sun</span>
    `;
    this.alertText = this.el.querySelector('.wh-alert-text');
    this.skipHint = this.el.querySelector('.wh-skip');
    this.log = this.el.querySelector('.wh-log');
    this.speedOut = this.el.querySelector('.wh-speed');
    this.distanceOut = this.el.querySelector('.wh-distance');
    this.hull = this.el.querySelector('.wh-hull');
    this.hullOut = this.hull.querySelector('dd');
    this.soundBtn = this.el.querySelector('.wh-sound');
    this.flash = this.el.querySelector('.wh-flash');
    container.appendChild(this.el);

    this.soundBtn.addEventListener('click', () => this.setMuted(!this.muted));
    this.el.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('button') && this.loaded) this.skipRequested = true;
    });
    // A hidden tab stops the frames but not the audio.
    document.addEventListener('visibilitychange', () => {
      if (!this.sound) return;
      if (document.hidden) this.sound.ctx.suspend().catch(() => {});
      else if (this.phase) this.sound.ctx.resume().catch(() => {});
    });
    this.setMuted(this.muted);
  }

  /** Whether the tunnel fills the screen, so the map beneath need not be drawn. */
  get covers() {
    return (this.phase === 'cruise' || this.phase === 'exit') && this.t >= OPEN_S;
  }

  /**
   * Flies the trip. Resolves at the white-out, once `ready` has resolved and
   * the trip has lasted long enough to be one; rejects if `ready` rejects.
   * `audio` is an AudioContext unlocked by the click that started it, or null.
   */
  travel({ lightYears, audio, ready }) {
    Object.assign(this, {
      lightYears,
      reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      phase: 'open',
      t: 0,
      travelled: 0,
      progressNow: 0,
      speed: 0,
      nextWarn: 0.9,
      nextAlarm: OPEN_S,
      nextReadout: 0,
      warnIndex: 0,
      loaded: false,
      skipRequested: false
    });
    this.log.replaceChildren();
    this.alertText.textContent = 'Wormhole ahead · hold on';
    this.skipHint.hidden = true;
    this.flash.style.transition = 'none';
    this.flash.style.opacity = '0';
    this.el.classList.remove('leaving');
    this.el.hidden = false;

    this.sound = audio ? new ShipSound(audio, this.muted) : null;
    this.speak('Warning. Wormhole entry. Hull stress critical.');

    return new Promise((resolve, reject) => {
      this.settle = resolve;
      ready.then(() => {
        this.loaded = true;
        if (this.phase === 'open' || this.phase === 'cruise') this.skipHint.hidden = false;
      }, reject);
    });
  }

  update(dt) {
    if (this.phase !== 'open' && this.phase !== 'cruise' && this.phase !== 'exit') return;
    const t = (this.t += dt);
    if (this.phase === 'open' && t >= OPEN_S) this.phase = 'cruise';
    if (this.phase !== 'exit' && this.loaded && (t >= MIN_S || this.skipRequested)) this.beginExit();

    const exiting = this.phase === 'exit';
    const opened = Math.min(t / OPEN_S, 1);
    const heat = exiting ? 1 : Math.min(t / MIN_S, 1);
    // Reduced motion keeps the look but lets the tunnel drift rather than rush.
    const pace = this.reduced ? 0.1 : 1;
    this.travelled += dt * pace * (0.6 + 3.4 * (1 - (1 - opened) ** 3) + 2.5 * heat + (exiting ? 4 : 0));

    const u = this.uniforms;
    u.uTime.value = t * pace;
    u.uTravel.value = this.travelled;
    u.uOpen.value = opened;
    u.uHeat.value = heat;
    // The throat wanders, and shudders harder the deeper in.
    const shake = this.reduced ? 0 : 0.004 + 0.014 * heat;
    u.uCentre.value.set(
      0.05 * pace * opened * Math.sin(t * 0.9) + shake * Math.sin(t * 37),
      0.04 * pace * opened * Math.cos(t * 0.7) + shake * Math.cos(t * 43)
    );

    if (!exiting && t >= this.nextWarn) {
      this.warn(WARNINGS[this.warnIndex++ % WARNINGS.length]);
      this.nextWarn += WARN_EVERY_S;
    }
    if (!exiting && t >= this.nextAlarm) {
      this.sound?.alarm();
      this.nextAlarm += ALARM_EVERY_S;
    }
    this.updateReadouts(dt, heat, exiting);
    this.render();

    if (exiting && t - this.exitAt >= FLASH_S) {
      this.phase = 'reveal';
      this.settle();
    }
  }

  beginExit() {
    this.phase = 'exit';
    this.exitAt = this.t;
    this.exitFrom = this.progressNow;
    this.skipHint.hidden = true;
    this.alertText.textContent = 'Exiting wormhole · brace';
    this.sound?.boom();
    this.speak('Exiting wormhole. Welcome to the Solar System.');
    this.flash.style.transition = `opacity ${FLASH_S}s ease-in`;
    this.flash.style.opacity = '1';
  }

  warn(text) {
    this.alertText.textContent = text;
    const line = document.createElement('li');
    const stamp = document.createElement('span');
    stamp.textContent = `T+${this.t.toFixed(1).padStart(4, '0')}`;
    line.append(stamp, text);
    this.log.prepend(line);
    while (this.log.children.length > 5) this.log.lastChild.remove();
    this.sound?.blip();
  }

  updateReadouts(dt, heat, exiting) {
    // Most of the way is covered early; the rest creeps in until the Solar
    // System is ready, then the white-out closes it.
    const cruise = 0.97 * (1 - Math.exp((-3 * this.t) / MIN_S));
    const progress = exiting
      ? this.exitFrom + (1 - this.exitFrom) * Math.min((this.t - this.exitAt) / FLASH_S, 1)
      : cruise;
    const before = this.lightYears * (1 - this.progressNow) ** 3;
    const distance = this.lightYears * (1 - progress) ** 3;
    this.progressNow = progress;
    if (dt > 0) this.speed += ((before - distance) / dt - this.speed) * Math.min(dt * 6, 1);

    if (this.t < this.nextReadout) return;
    this.nextReadout = this.t + 0.08;
    this.speedOut.textContent = formatSpeed(this.speed);
    this.distanceOut.textContent = formatDistance(distance);
    const hull = Math.round(100 - 34 * heat - 3 * heat * (1 + Math.sin(this.t * 13)));
    this.hullOut.textContent = `${hull}%`;
    this.hull.classList.toggle('low', hull < 80);
    this.sound?.update(exiting ? 1.4 : heat);
  }

  render() {
    const renderer = this.renderer;
    renderer.getDrawingBufferSize(this._size);
    const aspect = this._size.x / Math.max(this._size.y, 1);
    this.uniforms.uAspect.value = aspect;
    this.uniforms.uReach.value = Math.hypot(aspect, 1) + 0.3;
    // While the mouth opens it is drawn over the map just rendered; once it
    // covers the screen it is drawn alone.
    const autoClear = renderer.autoClear;
    renderer.autoClear = this.covers;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }

  /** After the swap: the white-out fades from over the Solar System. */
  reveal() {
    this.phase = null;
    this.el.classList.add('leaving');
    this.stopSound(2.2);
    // Only once the Solar System's first frame is on screen: the fade runs off
    // the main thread and would otherwise uncover the last tunnel frame.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (this.phase) return;
      this.flash.style.transition = 'opacity 0.9s ease-out';
      this.flash.style.opacity = '0';
      setTimeout(() => {
        if (!this.phase) this.el.hidden = true;
      }, 950);
    }));
  }

  /** The trip failed: stop at once. */
  abort() {
    this.phase = null;
    this.el.hidden = true;
    this.stopSound(0.3);
    window.speechSynthesis?.cancel();
  }

  stopSound(seconds) {
    const sound = this.sound;
    if (!sound) return;
    this.sound = null;
    sound.fadeOut(seconds);
    // Let the device sleep until the next trip wakes the context again.
    setTimeout(() => {
      if (!this.sound) sound.ctx.suspend().catch(() => {});
    }, seconds * 1000 + 200);
  }

  speak(text) {
    this.muted = soundMuted(); // the tour may have changed it since
    if (this.muted || !window.speechSynthesis) return;
    const line = new SpeechSynthesisUtterance(text);
    line.rate = 1.05;
    line.pitch = 0.6;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(line);
  }

  setMuted(muted) {
    this.muted = muted;
    setSoundMuted(muted);
    this.sound?.setMuted(muted);
    if (muted) window.speechSynthesis?.cancel();
    this.soundBtn.textContent = muted ? '🔇' : '🔊';
    this.soundBtn.setAttribute('aria-pressed', String(!muted));
  }
}
