import * as THREE from 'three';

/*
 * Spacecraft maps for Earth, the moons and dwarf planets, at the detail each
 * body's size on screen calls for:
 *
 *   painted  its procedural surface (Earth: the CC BY planet map)
 *   2k       once it spans NEAR_PX, the everyday maps
 *   4k       once it spans SHARP_PX, where the device can hold them
 *
 * Each level is let go only below a lower threshold, so a body at the edge does
 * not flicker, and leaving a body releases its maps: a Grand tour no longer
 * piles every map into GPU memory. A map set is shown only if it is still
 * wanted when it arrives, and one no longer wanted is disposed, even mid-load.
 */
const NEAR_PX = 12;
const NEAR_KEEP_PX = 4;
// Sizes are the body's radius on screen. At a 400 px radius a 2K map's texels
// are ~1.3 screen pixels across the disc and starting to blur.
const SHARP_PX = 400;
const SHARP_KEEP_PX = 250;
// The Moon's normal map holds true slopes; drawn deeper so its relief reads.
const MOON_RELIEF = 2.5;
// Below this share of its surface photographed, a card says how much was seen.
const MOSTLY_SEEN = 0.98;

/** A painted surface's overall colour, brightest channel 1: the tint for a greyscale map. */
function averageColour(image) {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 16;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, 32, 16);
  const { data } = ctx.getImageData(0, 0, 32, 16);
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += data[i + c];
  const top = Math.max(...sum, 1);
  return sum.map((v) => v / top);
}

/** City lights only on the night side, fading in through twilight. The Sun is at the origin. */
function nightSideOnly(shader) {
  shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    vec3 toSun = normalize((viewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz + vViewPosition);
    totalEmissiveRadiance *= smoothstep(0.1, -0.15, dot(normal, toSun));`);
}

const disposeSet = (set) => Object.values(set).forEach((texture) => texture?.dispose());

/** Where a body's surface comes from, for its card. */
export function surfaceNote(body, entry) {
  if (entry) {
    const seen = entry.note ? ` ${entry.note}; what it never saw is left plain.`
      : entry.imaged < MOSTLY_SEEN ? ` ${Math.round(entry.imaged * 100)}% of it has been photographed; the rest is left plain.` : '';
    return `Map: ${entry.credit}.${seen}`;
  }
  if (!body.mesh.material.map?.isCanvasTexture) return 'Map: Solar System Scope, from NASA imagery (CC BY 4.0).';
  return body.unvisited ? "Artist's impression: no spacecraft has visited it." : "Artist's impression: no spacecraft map of it is used here.";
}

export class BodyMaps {
  constructor(root, renderer) {
    this.root = root;
    this.loader = new THREE.TextureLoader();
    this.entries = {};
    this.bodies = [];
    this._p = new THREE.Vector3();
    // A 4K map is ~90 MB of GPU memory as JPEG whatever its file size, and
    // Earth has three: touch devices stop at 2K, as does a GPU without 4096.
    const touch = globalThis.matchMedia?.('(pointer: coarse)').matches;
    this.top = touch || renderer.capabilities.maxTextureSize < 4096 ? '2k' : '4k';
  }

  /** The manifest; without it every body stays painted. */
  async load() {
    try {
      const res = await fetch(`${this.root}manifest.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.entries = (await res.json()).bodies ?? {};
    } catch (err) {
      console.warn('Body maps unavailable:', err.message);
    }
  }

  entry(name) {
    return this.entries[name.toLowerCase()] ?? null;
  }

  add(body) {
    const entry = this.entry(body.name);
    if (!entry) return;
    const { material } = body.mesh;
    body.maps = {
      entry,
      want: 'painted',
      shown: 'painted',
      sets: {},
      base: { map: material.map, color: material.color.clone(), clouds: body.clouds?.material.alphaMap ?? null },
      // A greyscale map takes the overall colour of the painted surface.
      tint: entry.grey && material.map?.isCanvasTexture ? averageColour(material.map.image) : null
    };
    // Harmless while there is no emissive map.
    if (entry.maps.night) material.onBeforeCompile = nightSideOnly;
    this.bodies.push(body);
  }

  /** Picks each body's level from its radius on screen; `height` is the viewport's, in pixels. */
  update(camera, height) {
    const pxPerUnit = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    for (const body of this.bodies) {
      const px = (body.radius / body.mesh.getWorldPosition(this._p).distanceTo(camera.position)) * pxPerUnit;
      const was = body.maps.want;
      let want = 'painted';
      if (this.top === '4k' && px >= (was === '4k' ? SHARP_KEEP_PX : SHARP_PX)) want = '4k';
      else if (px >= (was === 'painted' ? NEAR_PX : NEAR_KEEP_PX)) want = '2k';
      if (want !== was) {
        body.maps.want = want;
        this.settle(body);
      }
    }
  }

  /** Brings what is shown in line with what is wanted, loading if need be. */
  async settle(body) {
    const maps = body.maps;
    const want = maps.want;
    let set = null;
    if (want !== 'painted') {
      const pending = (maps.sets[want] ??= this.fetchSet(maps.entry, want));
      try {
        set = await pending;
      } catch (err) {
        if (maps.sets[want] === pending) delete maps.sets[want];
        console.warn(`${body.name} ${want} maps:`, err.message);
        return;
      }
      // Wanted something else by the time it arrived, or let go and asked for
      // again (this set is then being disposed): a later call settles it.
      if (maps.want !== want || maps.sets[want] !== pending) return;
    }
    this.show(body, set);
    maps.shown = want;
    for (const level of Object.keys(maps.sets)) {
      if (level === want) continue;
      maps.sets[level].then(disposeSet, () => {});
      delete maps.sets[level];
    }
  }

  async fetchSet(entry, level) {
    const load = async (map, colour = true) => {
      const texture = await this.loader.loadAsync(this.root + map[level].file);
      // Colour maps are sRGB; normals and the cloud alpha are data.
      texture.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.anisotropy = 4;
      return texture;
    };
    const { color, normal, night, clouds } = entry.maps;
    const [c, n, l, a] = await Promise.all([
      load(color), normal && load(normal, false), night && load(night), clouds && load(clouds, false)
    ]);
    return { color: c, normal: n || null, night: l || null, clouds: a || null };
  }

  /** Puts a map set on a body, or its painted surface back for `null`. */
  show(body, set) {
    const { material } = body.mesh;
    const { base, tint } = body.maps;
    material.map = set?.color ?? base.map;
    if (set && tint) material.color.setRGB(...tint, THREE.SRGBColorSpace);
    else material.color.copy(base.color);
    material.normalMap = set?.normal ?? null;
    if (set?.normal) material.normalScale.setScalar(MOON_RELIEF);
    material.emissiveMap = set?.night ?? null;
    material.emissive.set(set?.night ? 0xffffff : 0x000000);
    material.needsUpdate = true;
    if (body.clouds) {
      body.clouds.material.alphaMap = set?.clouds ?? base.clouds;
      body.clouds.material.needsUpdate = true;
    }
  }
}
