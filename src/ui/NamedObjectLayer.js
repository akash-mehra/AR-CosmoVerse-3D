import * as THREE from 'three';
import { LOCAL_MAX_MPC } from '../data/namedObjects.js';
import { lookbackTimeGyr } from '../cosmology/planck18.js';

const MAX_LABELS = 14;
const HIT_RADIUS_PX = 26;
const LABEL_HEIGHT_PX = 24;
const LABEL_GAP_PX = 6;
const DRAG_TOLERANCE_PX = 6;

const OTYPE_LABELS = {
  G: 'Galaxy',
  GiC: 'Galaxy in cluster',
  GiG: 'Galaxy in group',
  GiP: 'Galaxy in pair',
  IG: 'Interacting galaxies',
  PaG: 'Pair of galaxies',
  AGN: 'Active galactic nucleus',
  SBG: 'Starburst galaxy',
  LSB: 'Low surface brightness galaxy',
  rG: 'Radio galaxy',
  EmG: 'Emission-line galaxy',
  H2G: 'HII galaxy',
  LIN: 'LINER',
  QSO: 'Quasar',
  Sy1: 'Seyfert 1 galaxy',
  Sy2: 'Seyfert 2 galaxy',
  Sy: 'Seyfert galaxy',
  BLL: 'BL Lac object',
  Bla: 'Blazar',
  ClG: 'Cluster of galaxies',
  SCG: 'Supercluster',
  GrG: 'Group of galaxies',
  CGG: 'Compact group of galaxies',
  Void: 'Void',
  PoG: 'Part of a galaxy'
};

/** Cheap proxy for label width — measuring the DOM every frame would force a layout. */
const estimateLabelWidth = (label) => label.length * 7 + 34;

const formatDistance = (mpc) => (mpc >= 1000 ? `${(mpc / 1000).toFixed(2)} Gpc` : `${mpc.toFixed(1)} Mpc`);
const formatLookback = (gyr) => (gyr < 0.01 ? `${(gyr * 1000).toFixed(1)} Myr` : `${gyr.toFixed(2)} Gyr`);
const formatRedshift = (z) => (Number.isFinite(z) ? `z = ${Math.abs(z) < 0.01 ? z.toFixed(5) : z.toFixed(4)}` : 'not measured');

/**
 * Screen-space layer for real catalogued objects: zoom-gated labels, a selection
 * reticle, and the detail card. Projection is done per frame for the named set
 * only (order of a hundred objects), which also serves as the click hit test.
 */
export class NamedObjectLayer {
  constructor(container, scene) {
    this.container = container;
    this.scene = scene;
    this.objects = [];
    this.candidates = [];
    this.selected = null;
    this.cardSize = { width: 272, height: 260 };

    this._eye = new THREE.Vector3();
    this._ndc = new THREE.Vector3();
    this._pointerDown = null;

    this.renderDOM();
    this.bindEvents();
  }

  renderDOM() {
    this.root = document.createElement('div');
    this.root.className = 'named-layer';
    this.root.id = 'named-layer';

    this.labels = Array.from({ length: MAX_LABELS }, () => {
      const el = document.createElement('div');
      el.className = 'named-label';
      el.innerHTML = '<span class="named-label-dot"></span><span class="named-label-text"></span>';
      this.root.appendChild(el);
      return { el, text: el.querySelector('.named-label-text'), object: null };
    });

    this.reticle = document.createElement('div');
    this.reticle.className = 'named-reticle hidden';
    this.root.appendChild(this.reticle);

    this.card = document.createElement('div');
    this.card.className = 'glass-card named-card hidden';
    this.card.innerHTML = `
      <button class="named-card-close" type="button" aria-label="Close">✕</button>
      <h2 class="named-card-title"></h2>
      <p class="named-card-type"></p>
      <dl class="named-card-rows">
        <div><dt>Catalogue</dt><dd class="named-card-ids"></dd></div>
        <div><dt>RA / Dec</dt><dd class="named-card-coords"></dd></div>
        <div><dt>Redshift</dt><dd class="named-card-z"></dd></div>
        <div><dt>Distance</dt><dd class="named-card-distance"></dd></div>
        <div><dt>Lookback</dt><dd class="named-card-lookback"></dd></div>
      </dl>
      <p class="named-card-note"></p>
      <button class="control-btn small named-card-fly" type="button">Fly to object</button>
    `;
    this.root.appendChild(this.card);

    this.container.appendChild(this.root);
  }

  bindEvents() {
    this.card.querySelector('.named-card-close').addEventListener('click', () => this.clearSelection());
    this.card.querySelector('.named-card-fly').addEventListener('click', () => {
      if (!this.selected) return;
      const { x, y, z } = this.selected.position;
      const target = new THREE.Vector3(x, y, z);
      const offset = Math.max(this.selected.distanceMpc * 0.08, 12);
      const camPos = target.clone().add(new THREE.Vector3(offset, offset * 0.6, offset));
      this.scene.smoothFlyTo(camPos, target);
    });

    window.addEventListener('mousedown', (e) => {
      if (this.isInteractiveTarget(e.target)) {
        this._pointerDown = null;
        return;
      }
      this._pointerDown = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mouseup', (e) => {
      const down = this._pointerDown;
      this._pointerDown = null;
      if (!down) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) >= DRAG_TOLERANCE_PX) return;

      const hit = this.hitTest(e.clientX, e.clientY);
      if (hit) this.select(hit);
      else this.clearSelection();
    });
  }

  isInteractiveTarget(target) {
    return Boolean(target.closest?.('.glass-card') || target.closest?.('.named-card'));
  }

  setDataset(catalogData) {
    this.objects = catalogData.named ?? [];
    this.candidates = [];
    this.clearSelection();
  }

  /** Projects a world position to screen pixels, or null when off screen or behind the camera. */
  projectToScreen(position) {
    const { camera, width, height } = this.scene;
    const eye = this._eye.set(position.x, position.y, position.z).applyMatrix4(camera.matrixWorldInverse);
    if (eye.z > -camera.near) return null;

    const eyeDistance = eye.length();
    const ndc = this._ndc.copy(eye).applyMatrix4(camera.projectionMatrix);
    if (ndc.x < -1.1 || ndc.x > 1.1 || ndc.y < -1.1 || ndc.y > 1.1) return null;

    return {
      x: (ndc.x * 0.5 + 0.5) * width,
      y: (-ndc.y * 0.5 + 0.5) * height,
      eyeDistance
    };
  }

  update() {
    if (!this.objects.length) return;

    const { camera, controls } = this.scene;
    const localTierActive = camera.position.distanceTo(controls.target) < LOCAL_MAX_MPC;

    this.candidates.length = 0;
    for (const obj of this.objects) {
      const tierMatches = (obj.tier === 'local') === localTierActive;
      if (!tierMatches && obj !== this.selected) continue;

      const screen = this.projectToScreen(obj.position);
      if (!screen) continue;

      obj.screenX = screen.x;
      obj.screenY = screen.y;
      obj.eyeDistance = screen.eyeDistance;
      this.candidates.push(obj);
    }

    this.candidates.sort((a, b) => b.weight - a.weight || a.eyeDistance - b.eyeDistance);
    this.layoutLabels();
    this.updateReticle();
  }

  /** Greedy declutter: highest weight first, skipping anything that would overlap an accepted label. */
  layoutLabels() {
    const placed = [];

    for (const obj of this.candidates) {
      if (placed.length >= MAX_LABELS) break;

      const width = estimateLabelWidth(obj.label);
      const box = {
        left: obj.screenX - width * 0.5,
        right: obj.screenX + width * 0.5,
        top: obj.screenY - LABEL_HEIGHT_PX,
        bottom: obj.screenY + LABEL_GAP_PX
      };

      const overlaps = placed.some(
        (p) => box.left < p.box.right && box.right > p.box.left && box.top < p.box.bottom && box.bottom > p.box.top
      );
      if (overlaps && obj !== this.selected) continue;

      placed.push({ obj, box });
    }

    this.labels.forEach((slot, i) => {
      const entry = placed[i];
      if (!entry) {
        if (slot.object) {
          slot.el.classList.remove('visible');
          slot.object = null;
        }
        return;
      }

      const { obj } = entry;
      if (slot.object !== obj) {
        slot.text.textContent = obj.label;
        slot.object = obj;
      }
      slot.el.classList.toggle('selected', obj === this.selected);
      slot.el.style.transform = `translate3d(${Math.round(obj.screenX)}px, ${Math.round(obj.screenY)}px, 0) translate(-50%, calc(-100% - 10px))`;
      slot.el.classList.add('visible');
    });
  }

  updateReticle() {
    const selected = this.selected;
    if (!selected) {
      this.reticle.classList.add('hidden');
      return;
    }

    const screen = this.projectToScreen(selected.position);
    if (!screen) {
      this.reticle.classList.add('hidden');
      return;
    }

    this.reticle.classList.remove('hidden');
    this.reticle.style.transform = `translate3d(${Math.round(screen.x)}px, ${Math.round(screen.y)}px, 0) translate(-50%, -50%)`;
    this.positionCard(screen.x, screen.y);
  }

  positionCard(screenX, screenY) {
    const { width, height } = this.scene;
    const { width: cardWidth, height: cardHeight } = this.cardSize;
    // Clear the selected object's own label, which is centred on it.
    const gap = estimateLabelWidth(this.selected.label) * 0.5 + 18;
    const left = Math.min(Math.max(screenX + gap, 16), Math.max(width - cardWidth - 16, 16));
    const top = Math.min(Math.max(screenY - cardHeight * 0.5, 16), Math.max(height - cardHeight - 16, 16));
    this.card.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }

  hitTest(clientX, clientY) {
    let best = null;
    let bestDistance = HIT_RADIUS_PX;

    for (const obj of this.candidates) {
      const distance = Math.hypot(obj.screenX - clientX, obj.screenY - clientY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = obj;
      }
    }
    return best;
  }

  select(obj) {
    this.selected = obj;

    const lookbackGyr = obj.tier === 'local' ? obj.lookbackGyr : lookbackTimeGyr(obj.z);
    const set = (selector, value) => {
      this.card.querySelector(selector).textContent = value;
    };

    set('.named-card-title', obj.label);
    set('.named-card-type', OTYPE_LABELS[obj.otype] ?? obj.otype);
    set('.named-card-ids', obj.ids.length ? obj.ids.join(' · ') : obj.mainId);
    set('.named-card-coords', `${obj.ra.toFixed(3)}° / ${obj.dec >= 0 ? '+' : ''}${obj.dec.toFixed(3)}°`);
    set('.named-card-z', formatRedshift(obj.z));
    set('.named-card-distance', formatDistance(obj.distanceMpc));
    set('.named-card-lookback', formatLookback(lookbackGyr));
    set(
      '.named-card-note',
      obj.tier === 'local'
        ? 'Placed by measured distance — too close for redshift to give one.'
        : 'Comoving distance from redshift, Planck 2018 cosmology.'
    );

    this.card.classList.remove('hidden');
    // Measured once per selection; reading it per frame would force a layout every frame.
    this.cardSize = { width: this.card.offsetWidth, height: this.card.offsetHeight };
  }

  clearSelection() {
    this.selected = null;
    this.card.classList.add('hidden');
    this.reticle.classList.add('hidden');
  }
}
