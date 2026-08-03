import { comovingDistanceMpc, lookbackTimeGyr } from '../cosmology/planck18.js';

export class PlottingController {
  constructor(scene) {
    this.scene = scene;
    this.totalCount = 0;
    this.currentCount = 0;
    this.speedPtsPerSec = 4500; // Default: ~4500 points / sec
    this.isPlaying = true;
    this.plottingOrder = 'redshift';
    this.onProgressCallbacks = [];

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

    // Apply initial order
    this.scene.setPlottingOrder(this.plottingOrder);
    this.scene.setPlotProgress(0.0);
    this.scene.setPlotSpeed(this.speedPtsPerSec);
    this.notifyProgress();
  }

  onProgress(callback) {
    this.onProgressCallbacks.push(callback);
  }

  notifyProgress() {
    if (!this.totalCount) return;
    const norm = Math.min(1.0, this.currentCount / this.totalCount);
    const intCount = Math.floor(this.currentCount);

    // Approximate frontier statistics based on current progress
    let currentMaxZ = 0.02;
    let galaxiesCount = 0;
    let qsosCount = 0;

    if (this.plottingOrder === 'redshift') {
      const idx = Math.min(Math.max(0, intCount - 1), this.totalCount - 1);
      currentMaxZ = this.redshifts ? this.redshifts[idx] : 0.02;
    } else {
      currentMaxZ = Math.min(7.0, 0.02 + norm * 6.98);
    }

    galaxiesCount = Math.round(intCount * 0.78);
    qsosCount = intCount - galaxiesCount;

    const distMpc = comovingDistanceMpc(currentMaxZ);
    const lookbackGyr = lookbackTimeGyr(currentMaxZ);

    const stats = {
      currentCount: intCount,
      totalCount: this.totalCount,
      progressNorm: norm,
      galaxiesCount,
      qsosCount,
      currentMaxZ,
      distanceMpc: distMpc,
      lookbackGyr,
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
    this.notifyProgress();
  }

  setOrder(orderKey) {
    if (orderKey === this.plottingOrder) return;
    this.plottingOrder = orderKey;
    if (this.scene) {
      this.scene.setPlottingOrder(orderKey);
    }
    this.notifyProgress();
  }

  togglePlay() {
    this.isPlaying = !this.isPlaying;
    this.notifyProgress();
    return this.isPlaying;
  }

  play() {
    this.isPlaying = true;
    this.notifyProgress();
  }

  pause() {
    this.isPlaying = false;
    this.notifyProgress();
  }

  reset() {
    this.currentCount = 0;
    this.isPlaying = false;
    if (this.scene) {
      this.scene.setPlotProgress(0.0);
    }
    this.notifyProgress();
  }

  step(numPts = 1) {
    this.isPlaying = false;
    this.currentCount = Math.min(this.totalCount, this.currentCount + numPts);
    if (this.scene) {
      this.scene.setPlotProgress(this.currentCount / this.totalCount);
    }
    this.notifyProgress();
  }

  setCount(newCount) {
    this.currentCount = Math.max(0, Math.min(this.totalCount, newCount));
    if (this.scene) {
      this.scene.setPlotProgress(this.currentCount / this.totalCount);
    }
    this.notifyProgress();
  }

  setInstantAll() {
    this.currentCount = this.totalCount;
    this.isPlaying = false;
    if (this.scene) {
      this.scene.setPlotProgress(1.0);
    }
    this.notifyProgress();
  }

  update(deltaTime) {
    if (!this.isPlaying || this.totalCount === 0) return;

    if (this.currentCount >= this.totalCount) {
      this.isPlaying = false;
      this.currentCount = this.totalCount;
      this.notifyProgress();
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
    this.notifyProgress();
  }
}
