import { comovingDistanceMpc, lookbackTimeGyr } from '../cosmology/planck18.js';

// Telemetry scans every point, so while playing it reports at most this often.
const NOTIFY_INTERVAL_MS = 125;

export class PlottingController {
  constructor(scene) {
    this.scene = scene;
    this.totalCount = 0;
    this.currentCount = 0;
    this.speedPtsPerSec = 4500; // Default: ~4500 points / sec
    this.isPlaying = true;
    this.plottingOrder = 'redshift';
    this.onProgressCallbacks = [];
    this.lastNotifyAt = 0;

    // Cached references for fast statistics
    this.redshifts = null;
    this.isQSOArray = null;
  }

  setDataset(catalogData) {
    this.catalogData = catalogData;
    this.totalCount = catalogData.count;
    this.redshifts = catalogData.redshifts;
    this.isQSOArray = catalogData.isQSOArray;
    this.currentCount = 0;
    // A new dataset replays from the start. Staying paused here left an empty
    // map after every catalog swap made while paused.
    this.isPlaying = true;

    // Apply initial order
    this.scene.setPlottingOrder(this.plottingOrder);
    this.scene.setPlotProgress(0.0);
    this.scene.setPlotSpeed(this.speedPtsPerSec);
    this.notifyProgress(true);
  }

  onProgress(callback) {
    this.onProgressCallbacks.push(callback);
  }

  /** Spawn order of every point under the current plotting order. */
  get order() {
    return this.catalogData?.orders[this.plottingOrder] ?? null;
  }

  get progress() {
    return this.totalCount ? Math.min(1.0, this.currentCount / this.totalCount) : 0;
  }

  /**
   * Telemetry for the points actually on screen. Spawn orders are ranks, so a
   * point is plotted exactly when its order is at or below the progress — the
   * same test the vertex shader applies. One O(n) pass, so it is throttled
   * while playing; state changes pass `force` and report immediately.
   */
  notifyProgress(force = false) {
    if (!this.totalCount) return;
    const now = performance.now();
    if (!force && now - this.lastNotifyAt < NOTIFY_INTERVAL_MS) return;
    this.lastNotifyAt = now;

    const progress = this.progress;
    const order = this.order;
    const { redshifts, isQSOArray } = this;
    let plotted = 0;
    let qsosCount = 0;
    let currentMaxZ = 0;
    for (let i = 0; i < order.length; i++) {
      if (order[i] > progress) continue;
      plotted++;
      if (isQSOArray[i]) qsosCount++;
      if (redshifts[i] > currentMaxZ) currentMaxZ = redshifts[i];
    }

    const stats = {
      currentCount: plotted,
      totalCount: this.totalCount,
      progressNorm: progress,
      galaxiesCount: plotted - qsosCount,
      qsosCount,
      currentMaxZ,
      distanceMpc: comovingDistanceMpc(currentMaxZ),
      lookbackGyr: lookbackTimeGyr(currentMaxZ),
      isPlaying: this.isPlaying,
      speedPtsPerSec: this.speedPtsPerSec,
      order: this.plottingOrder
    };

    for (const cb of this.onProgressCallbacks) {
      cb(stats);
    }
  }

  setSpeed(ptsPerSec) {
    this.speedPtsPerSec = ptsPerSec;
    if (this.scene) {
      this.scene.setPlotSpeed(ptsPerSec);
    }
    this.notifyProgress(true);
  }

  setOrder(orderKey) {
    if (orderKey === this.plottingOrder) return;
    this.plottingOrder = orderKey;
    if (this.scene) {
      this.scene.setPlottingOrder(orderKey);
    }
    this.notifyProgress(true);
  }

  togglePlay() {
    // Play at the end starts over; otherwise it stops again on the next frame
    // and the button looks broken.
    if (!this.isPlaying && this.currentCount >= this.totalCount) this.setCount(0);
    this.isPlaying = !this.isPlaying;
    this.notifyProgress(true);
    return this.isPlaying;
  }

  reset() {
    this.currentCount = 0;
    this.isPlaying = false;
    if (this.scene) {
      this.scene.setPlotProgress(0.0);
    }
    this.notifyProgress(true);
  }

  step(numPts = 1) {
    this.isPlaying = false;
    this.currentCount = Math.min(this.totalCount, this.currentCount + numPts);
    if (this.scene) {
      this.scene.setPlotProgress(this.currentCount / this.totalCount);
    }
    this.notifyProgress(true);
  }

  setCount(newCount) {
    this.currentCount = Math.max(0, Math.min(this.totalCount, newCount));
    if (this.scene) {
      this.scene.setPlotProgress(this.currentCount / this.totalCount);
    }
    this.notifyProgress(true);
  }

  setInstantAll() {
    this.currentCount = this.totalCount;
    this.isPlaying = false;
    if (this.scene) {
      this.scene.setPlotProgress(1.0);
    }
    this.notifyProgress(true);
  }

  update(deltaTime) {
    if (!this.isPlaying || this.totalCount === 0) return;

    if (this.currentCount >= this.totalCount) {
      this.isPlaying = false;
      this.currentCount = this.totalCount;
      this.notifyProgress(true);
      return;
    }

    if (this.speedPtsPerSec === Infinity) {
      this.currentCount = this.totalCount;
    } else {
      this.currentCount += this.speedPtsPerSec * deltaTime;
      if (this.currentCount > this.totalCount) {
        this.currentCount = this.totalCount;
        this.isPlaying = false;
      }
    }

    const progress = this.currentCount / this.totalCount;
    if (this.scene) {
      this.scene.setPlotProgress(progress);
    }
    // The last frame must report, or the HUD is left showing "Pause" at 99%.
    this.notifyProgress(!this.isPlaying);
  }
}
