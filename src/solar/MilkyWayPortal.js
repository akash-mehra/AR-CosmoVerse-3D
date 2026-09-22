import * as THREE from 'three';
import { notify } from '../ui/notify.js';

// Camera distance from the galactic centre, in Mpc, inside which the way in
// appears: about four galaxy diameters, where the disc fills a good part of
// the view.
const ENTER_RANGE = 0.12;
const FADE_MS = 450;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The easter egg. Zoom far enough into the Milky Way and a button offers the
 * way in; taking it swaps the galaxy map for the Solar System. The Solar
 * System module and its textures are only fetched on that first entry.
 */
export class MilkyWayPortal {
  constructor(container, scene, namedLayer) {
    this.container = container;
    this.scene = scene;
    this.namedLayer = namedLayer;
    this.active = false;
    this.busy = false;
    this.solar = null;
    this._ndc = new THREE.Vector3();

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'portal-btn';
    this.button.hidden = true;
    this.button.innerHTML = '✨ Enter the Milky Way <span>visit the Sun and its planets</span>';
    this.button.addEventListener('click', () => this.enter());

    this.veil = document.createElement('div');
    this.veil.className = 'warp-veil';
    this.veil.setAttribute('role', 'status');

    container.append(this.button, this.veil);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.active && !e.target.closest?.('input, textarea, dialog')) this.exit();
    });
  }

  /** Called every frame: draws the Solar System when inside, otherwise watches for the way in. */
  update(dt) {
    if (this.active) {
      this.solar.update(dt);
      return;
    }
    const hidden = this.busy || !this.inRange();
    if (this.button.hidden !== hidden) this.button.hidden = hidden;
  }

  inRange() {
    if (this.container.classList.contains('ar-active')) return false;
    const { camera, milkyWay } = this.scene;
    if (camera.position.distanceTo(milkyWay.centre) > ENTER_RANGE) return false;
    const ndc = this._ndc.copy(milkyWay.centre).project(camera);
    return ndc.z < 1 && Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1;
  }

  async fade(text) {
    this.veil.textContent = text;
    this.veil.classList.add('visible');
    await wait(FADE_MS);
  }

  async enter() {
    if (this.active || this.busy) return;
    this.busy = true;
    this.button.hidden = true;

    try {
      await this.fade('Entering the Milky Way…');
      const { SolarSystem } = await import('./SolarSystem.js');
      if (!this.solar) {
        this.solar = new SolarSystem(this.scene.renderer, this.container);
        this.solar.onExit = () => this.exit();
      }
      await this.solar.load();
    } catch (err) {
      console.error(err);
      notify(`Could not open the Solar System: ${err.message}`, { error: true });
      this.veil.classList.remove('visible');
      this.busy = false;
      return;
    }

    // The galaxy map's own input and labels stand down while we are inside.
    this.scene.controls.enabled = false;
    this.namedLayer.clearSelection();
    this.namedLayer.suspended = true;
    this.container.classList.add('solar-active');
    this.solar.enter();
    this.active = true;
    this.veil.classList.remove('visible');
    this.busy = false;
  }

  async exit() {
    if (!this.active || this.busy) return;
    this.busy = true;
    await this.fade('Back to the universe…');

    this.active = false;
    this.solar.exit();
    this.container.classList.remove('solar-active');
    this.namedLayer.suspended = false;
    this.scene.controls.enabled = true;
    this.veil.classList.remove('visible');
    this.busy = false;
  }
}
