import * as THREE from 'three';

/*
 * NASA GIBS imagery for the Earth layer: Blue Marble Next Generation (MODIS,
 * August 2004) in GIBS's geographic grid, 512 px tiles. At level L a tile is
 * 288/2^L degrees square, so levels 3–7 tile the globe exactly, 36° down to
 * 2.25° (~490 m a pixel): region level. The manifest's Earth map is drawn
 * underneath, and tiles are fetched only where it would look blurred.
 *
 * Each frame a tile is split into its four children while its pixels are
 * larger than REFINE_PX on screen, and drawn in their place only once all
 * the visible ones have arrived, so detail sharpens without holes. Anything
 * not yet loaded shows the map underneath. Tiles are kept by most recent use
 * up to a budget and disposed past it.
 */
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_NextGeneration/default/500m/';
const FIRST = 3;
const LAST = 7;
const TILE_PX = 512;
const REFINE_PX = 1.25;
const SEGMENTS = 16;
const LOADING = 6;
// Kilometres above the map underneath, clear of its sag between vertices.
const LIFT_KM = 2;
const DEG = Math.PI / 180;

const span = (level) => 288 / 2 ** level;

export class GibsTiles {
  /** `nightSide` masks each tile's city lights to the night side; `budget` is how many tiles to keep. */
  constructor(radiusKm, { nightSide, budget }) {
    this.radius = radiusKm;
    this.nightSide = nightSide;
    this.budget = budget;
    this.group = new THREE.Group();
    this.loader = new THREE.TextureLoader();
    this.tiles = new Map();
    this.night = null;
    this.frame = 0;
    this.loading = 0;
    this.failed = false;
    this.frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
    this._c = new THREE.Vector3();
    this._s = new THREE.Sphere();
  }

  /** City lights for the tiles: the global night map, read through each tile's second UV set. */
  setNight(texture) {
    if (this.night?.source === texture?.source) return;
    this.night?.dispose();
    this.night = texture ? texture.clone() : null;
    if (this.night) this.night.channel = 1;
    for (const tile of this.tiles.values()) if (tile.mesh) this.dress(tile.mesh.material);
  }

  dress(material) {
    material.emissiveMap = this.night;
    material.emissive.set(this.night ? 0xffffff : 0x000000);
    material.needsUpdate = true;
  }

  tile(level, row, col) {
    const key = `${level}/${row}/${col}`;
    let tile = this.tiles.get(key);
    if (!tile) {
      const s = span(level);
      const lon = -180 + col * s;
      const top = 90 - row * s;
      const lat = (top - s / 2) * DEG;
      const mid = (lon + s / 2) * DEG;
      tile = {
        key, level, row, col, lon, top, state: 'idle', used: 0, mesh: null,
        centre: new THREE.Vector3(Math.cos(lat) * Math.cos(mid), Math.sin(lat), -Math.cos(lat) * Math.sin(mid)),
        // Half the diagonal, as an angle: generous away from the equator.
        reach: (s / 2) * Math.SQRT2 * DEG
      };
      this.tiles.set(key, tile);
    }
    tile.used = this.frame;
    return tile;
  }

  children(tile) {
    const { level, row, col } = tile;
    return [0, 1, 2, 3].map((k) => this.tile(level + 1, row * 2 + (k >> 1), col * 2 + (k & 1)));
  }

  /**
   * Picks and loads the tiles `camera` (Earth-centred, km) needs; `height` is
   * the viewport's in CSS pixels, `baseWidth` the width of the map underneath.
   */
  update(camera, height, baseWidth) {
    this.frame += 1;
    this.frustum.setFromProjectionMatrix(this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const eye = camera.position;
    const toEye = eye.length();
    this.eye = eye;
    this.horizon = Math.acos(Math.min(1, this.radius / toEye));
    this.pxPerRad = height / (2 * Math.tan((camera.fov * DEG) / 2));
    // How much coarser the map underneath is than a top-level tile.
    this.baseScale = baseWidth ? (360 / baseWidth) / (span(FIRST) / TILE_PX) : Infinity;
    this.wanted = [];
    for (const tile of this.tiles.values()) if (tile.mesh) tile.mesh.visible = false;

    const s = span(FIRST);
    for (let row = 0; row < 180 / s; row++) {
      for (let col = 0; col < 360 / s; col++) this.visit(this.tile(FIRST, row, col));
    }
    this.load();
    this.evict();
  }

  visible(tile) {
    const angle = Math.acos(THREE.MathUtils.clamp(tile.centre.dot(this._c.copy(this.eye).normalize()), -1, 1));
    if (angle > this.horizon + tile.reach) return false;
    this._s.center.copy(tile.centre).multiplyScalar(this.radius);
    this._s.radius = this.radius * tile.reach;
    return this.frustum.intersectsSphere(this._s);
  }

  visit(tile) {
    if (!this.visible(tile)) return;
    if (tile.level === FIRST && this.texelPx(tile) * this.baseScale <= REFINE_PX) return;
    if (tile.level < LAST && this.texelPx(tile) > REFINE_PX) {
      const kids = this.children(tile).filter((kid) => this.visible(kid));
      kids.forEach((kid) => this.want(kid));
      if (kids.every((kid) => kid.state === 'ready')) {
        kids.forEach((kid) => this.visit(kid));
        return;
      }
    }
    this.want(tile);
    if (tile.state === 'ready') tile.mesh.visible = true;
  }

  /** How many screen pixels one of the tile's pixels covers at its nearest. */
  texelPx(tile) {
    const near = Math.max(this._c.copy(tile.centre).multiplyScalar(this.radius).distanceTo(this.eye) - this.radius * tile.reach,
      this.eye.length() - this.radius, 1);
    return ((span(tile.level) / TILE_PX) * DEG * this.radius * this.pxPerRad) / near;
  }

  want(tile) {
    if (tile.state === 'idle') this.wanted.push(tile);
  }

  load() {
    // Coarse first: they cover the most and are what the finer ones wait behind.
    this.wanted.sort((a, b) => a.level - b.level);
    for (const tile of this.wanted) {
      if (this.loading >= LOADING) break;
      tile.state = 'loading';
      this.loading += 1;
      this.loader.loadAsync(`${GIBS}${tile.level}/${tile.row}/${tile.col}.jpeg`).then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        if (!this.tiles.has(tile.key)) {
          texture.dispose();
          return;
        }
        tile.mesh = this.mesh(tile, texture);
        tile.state = 'ready';
      }, () => {
        // Left to the map underneath; said once, not for every tile.
        tile.state = 'failed';
        if (!this.failed) console.warn('GIBS imagery unavailable; the Earth map stays as it is.');
        this.failed = true;
      }).finally(() => {
        this.loading -= 1;
      });
    }
  }

  mesh(tile, texture) {
    const s = span(tile.level);
    const geometry = new THREE.SphereGeometry(this.radius + LIFT_KM, SEGMENTS, SEGMENTS,
      (tile.lon + 180) * DEG, s * DEG, (90 - tile.top) * DEG, s * DEG);
    // Where each vertex falls on the global maps (the night side's lights).
    const uv = geometry.attributes.uv;
    const global = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i++) {
      global[i * 2] = (tile.lon + 180 + uv.getX(i) * s) / 360;
      global[i * 2 + 1] = (tile.top - s + 90 + uv.getY(i) * s) / 180;
    }
    geometry.setAttribute('uv1', new THREE.BufferAttribute(global, 2));
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 });
    material.onBeforeCompile = this.nightSide;
    this.dress(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    this.group.add(mesh);
    return mesh;
  }

  /** Least recently used first, never one used this frame. */
  evict() {
    const kept = [...this.tiles.values()].filter((tile) => tile.state === 'ready');
    if (kept.length > this.budget) {
      kept.sort((a, b) => a.used - b.used);
      for (const tile of kept.slice(0, kept.length - this.budget)) {
        if (tile.used === this.frame) break;
        this.drop(tile);
      }
    }
    // Bookkeeping for tiles never loaded, so the map does not grow without end;
    // a failed one out of use for a while is tried again when next needed.
    for (const tile of this.tiles.values()) {
      if ((tile.state === 'idle' || tile.state === 'failed') && tile.used < this.frame - 600) this.tiles.delete(tile.key);
    }
  }

  drop(tile) {
    this.group.remove(tile.mesh);
    tile.mesh.geometry.dispose();
    tile.mesh.material.map.dispose();
    tile.mesh.material.dispose();
    this.tiles.delete(tile.key);
  }

  dispose() {
    for (const tile of [...this.tiles.values()]) if (tile.mesh) this.drop(tile);
    this.tiles.clear();
    this.night?.dispose();
    this.night = null;
  }
}
