import { notify } from '../ui/notify.js';

/*
 * The optional HD download: every body map this device would use, saved with
 * the Cache API so close-ups load from the device. BodyMaps asks the cache
 * before the network, so a download cut short still helps. The page reads the
 * cache itself rather than through a service worker: only map files are ever
 * stored, and a deploy preview can never be served a stale page.
 *
 * Whether the maps are saved is judged from the cache alone. iOS clears a
 * site's storage after about a week away, and the offer then simply returns.
 */
const CACHE = 'cosmoverse-maps';
const DECLINED_KEY = 'cosmoverse.hdMaps';
const DONE_MS = 4000;

const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;
const absolute = (url) => new URL(url, document.baseURI).href;

/** A saved map as a blob URL (revoke it once loaded), or null to use the network. */
export async function savedUrl(url, bytes) {
  try {
    const hit = await globalThis.caches?.match(url, { cacheName: CACHE });
    if (!hit) return null;
    const blob = await hit.blob();
    // Regenerated since it was saved: the network has the new one.
    if (blob.size !== bytes) {
      await caches.open(CACHE).then((cache) => cache.delete(url));
      return null;
    }
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/** Where the browser says the connection is metered or slow, it says so. */
function connectionNote() {
  const c = navigator.connection;
  return c?.saveData || c?.type === 'cellular' || /2g|3g/.test(c?.effectiveType ?? '')
    ? 'Your connection looks metered or slow: this uses data and may take a while.'
    : 'Best on Wi-Fi.';
}

function declined() {
  try {
    return localStorage.getItem(DECLINED_KEY) === 'no';
  } catch {
    return false;
  }
}

export class MapOffer {
  constructor(parent, maps) {
    this.maps = maps;
    this.files = [];
    this.abort = null;
    this.checking = false;
    this.el = document.createElement('div');
    this.el.className = 'map-offer glass-card';
    this.el.hidden = true;
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = `
      <p class="map-offer-text"></p>
      <progress class="map-offer-progress" max="1" value="0"></progress>
      <div class="map-offer-actions">
        <button class="control-btn small" type="button" data-offer="yes">Download</button>
        <button class="control-btn small" type="button" data-offer="no">Not now</button>
        <button class="control-btn small" type="button" data-offer="cancel">Cancel</button>
      </div>
    `;
    this.text = this.el.querySelector('.map-offer-text');
    this.progress = this.el.querySelector('.map-offer-progress');
    this.buttons = Object.fromEntries([...this.el.querySelectorAll('[data-offer]')].map((b) => [b.dataset.offer, b]));
    this.buttons.yes.addEventListener('click', () => this.download());
    this.buttons.no.addEventListener('click', () => this.decline());
    this.buttons.cancel.addEventListener('click', () => this.abort?.abort());
    parent.appendChild(this.el);
  }

  /** What this device would load and has not saved: 2K everywhere, 4K where BodyMaps goes that far. */
  async missing() {
    const levels = this.maps.top === '4k' ? ['2k', '4k'] : ['2k'];
    const files = levels.flatMap((level) => Object.values(this.maps.entries).flatMap((entry) =>
      Object.values(entry.maps).map((map) => ({ url: this.maps.root + map[level].file, bytes: map[level].bytes }))));
    const cache = await caches.open(CACHE);
    const saved = new Set((await cache.keys()).map((request) => request.url));
    return files.filter(({ url }) => !saved.has(absolute(url)));
  }

  /** On entering the Solar System, unless declined, already saved, or impossible here. */
  async offer() {
    if (this.checking || !this.el.hidden || declined()) return;
    this.checking = true;
    try {
      this.files = await this.missing();
    } catch {
      // No Cache API: a plain-http address, or a private window that blocks it.
      this.files = [];
    } finally {
      this.checking = false;
    }
    if (!this.files.length) return;
    const worlds = Object.keys(this.maps.entries).length;
    this.show(`Save sharper maps of ${worlds} worlds on this device (${mb(this.total())}) so close-ups load at once. ${connectionNote()}`, false);
  }

  total() {
    return this.files.reduce((sum, file) => sum + file.bytes, 0);
  }

  show(text, downloading) {
    this.text.textContent = text;
    this.progress.hidden = !downloading;
    this.buttons.yes.hidden = downloading;
    this.buttons.no.hidden = downloading;
    this.buttons.cancel.hidden = !downloading;
    this.el.hidden = false;
  }

  decline() {
    try {
      localStorage.setItem(DECLINED_KEY, 'no');
    } catch {
      // Storage blocked: asked again next visit.
    }
    this.el.hidden = true;
  }

  async download() {
    const abort = (this.abort = new AbortController());
    // Inside the click, where a browser that asks the user can ask.
    navigator.storage?.persist?.().catch(() => {});
    const total = this.total();
    let done = 0;
    const step = () => {
      this.show(`Saving maps… ${mb(done)} of ${mb(total)}`, true);
      this.progress.value = done / total;
    };
    step();
    try {
      const cache = await caches.open(CACHE);
      for (const { url, bytes } of this.files) {
        const res = await fetch(url, { signal: abort.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (blob.size !== bytes) throw new Error(`${url.split('/').pop()} is not the file the manifest lists`);
        await cache.put(url, new Response(blob));
        done += bytes;
        step();
      }
      this.show('Maps saved on this device.', true);
      this.buttons.cancel.hidden = true;
      setTimeout(() => (this.el.hidden = true), DONE_MS);
    } catch (err) {
      this.el.hidden = true;
      if (!abort.signal.aborted) notify(`Map download stopped (${err.message}); what was saved is kept.`, { error: true });
    } finally {
      this.abort = null;
    }
  }
}
