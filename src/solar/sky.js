import * as THREE from 'three';
import { DEG, SKY_OBJECTS } from './data.js';
import { solarFromMap } from './scale.js';
import { galacticBasis } from '../data/milkyWay.js';
import { mulberry32, glowTexture, nebulaTexture, galaxyTexture, cloudTexture, clusterTexture } from './textures.js';

// The sky is drawn this far from the camera and moves with it, so it stays at
// infinity however far you fly.
export const SKY_RADIUS = 2400;
// How much longer than wide a star gets at full warp.
const STRETCH = 9.0;

/*
 * Stars that streak when the camera moves fast: each one grows along the line
 * from the point the camera is heading for (uFocus, in NDC), with the trail
 * pointing back toward it — the classic look of travelling through a star
 * field. At uWarp = 0 they are plain round points.
 */
const WARP_FRAGMENT = `
varying vec3 vColor;
varying vec2 vDir;
varying float vStretch;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  c.y = -c.y;
  float grow = 1.0 + vStretch * ${STRETCH.toFixed(1)};
  float r0 = 0.5 / grow;
  vec2 tail = -vDir * (0.5 - r0);
  float h = clamp(dot(c, tail) / max(dot(tail, tail), 1e-6), 0.0, 1.0);
  float d = length(c - tail * h) / r0;
  float a = exp(-d * d * 2.2) * (1.0 - 0.7 * h);
  if (a < 0.02) discard;
  gl_FragColor = vec4(vColor, a);
}`;

const WARP_COMMON = `
attribute vec3 aColor;
attribute float aSize;
uniform float uWarp;
uniform vec2 uFocus;
uniform float uSign;
uniform float uPixelRatio;
varying vec3 vColor;
varying vec2 vDir;
varying float vStretch;
void streak(vec4 clip, float size) {
  gl_Position = clip;
  vec2 ndc = clip.xy / clip.w;
  vec2 d = (ndc - uFocus) * uSign;
  float len = length(d);
  vDir = len > 1e-5 ? d / len : vec2(1.0, 0.0);
  // Stars near the vanishing point barely move; those at the edge rush past.
  vStretch = uWarp * clamp(len * 1.4, 0.12, 1.0);
  gl_PointSize = size * uPixelRatio * (1.0 + vStretch * ${STRETCH.toFixed(1)});
}`;

const STAR_VERTEX = `${WARP_COMMON}
void main() {
  vColor = aColor;
  streak(projectionMatrix * modelViewMatrix * vec4(position, 1.0), aSize);
}`;

// Dust drifts in a box that wraps around the camera, so there is always some
// nearby to fly through, and it never runs out however far you go.
const DUST_VERTEX = `${WARP_COMMON}
uniform vec3 uCam;
uniform float uBox;
void main() {
  vec3 rel = mod(position - uCam + 0.5 * uBox, uBox) - 0.5 * uBox;
  vec4 mv = viewMatrix * vec4(uCam + rel, 1.0);
  float dist = length(rel);
  float fade = smoothstep(0.5 * uBox, 0.22 * uBox, dist) * smoothstep(0.3, 1.8, dist);
  vColor = aColor * fade;
  streak(projectionMatrix * mv, clamp(aSize * 16.0 / max(-mv.z, 0.1), 0.6, 3.2));
}`;

function warpMaterial(vertexShader, pixelRatio, extra = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uWarp: { value: 0 },
      uFocus: { value: new THREE.Vector2() },
      uSign: { value: 1 },
      uPixelRatio: { value: pixelRatio },
      ...extra
    },
    vertexShader,
    fragmentShader: WARP_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
}

export function setWarp(material, warp, focus, sign, pixelRatio) {
  const u = material.uniforms;
  u.uWarp.value = warp;
  u.uFocus.value.copy(focus);
  u.uSign.value = sign;
  u.uPixelRatio.value = pixelRatio;
}

/**
 * An equatorial unit vector in this scene's frame: the ecliptic lies in XZ
 * with its north pole on +Y, and longitude 0 (the vernal equinox) on +X,
 * increasing anticlockwise seen from above — the frame the planets use.
 */
function sceneFromEquatorial(x, y, z, out) {
  return solarFromMap(out.set(x, y, z), out);
}

export function skyDirection(raDeg, decDeg, out = new THREE.Vector3()) {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  return sceneFromEquatorial(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec), out);
}

const GAL = galacticBasis();
function galacticDirection(lDeg, bDeg, out) {
  const l = lDeg * DEG;
  const b = bDeg * DEG;
  const cx = Math.cos(b) * Math.cos(l);
  const cy = Math.cos(b) * Math.sin(l);
  const cz = Math.sin(b);
  return sceneFromEquatorial(
    GAL.x.x * cx + GAL.y.x * cy + GAL.z.x * cz,
    GAL.x.y * cx + GAL.y.y * cy + GAL.z.y * cz,
    GAL.x.z * cx + GAL.y.z * cy + GAL.z.z * cz,
    out
  );
}

const wrap180 = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;

/**
 * Background stars and the Milky Way seen from inside it: a band along the
 * true galactic plane, thickest and warmest toward the centre in Sagittarius,
 * and split by the Great Rift — the dust lanes that hide the stars behind
 * them between Cygnus and Sagittarius.
 */
function starPoints(pixelRatio) {
  const rand = mulberry32(7);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-9))) * Math.cos(2 * Math.PI * rand());
  const FIELD = 7000;
  const BAND = 26000;
  const positions = [];
  const colors = [];
  const sizes = [];
  const v = new THREE.Vector3();

  for (let i = 0; i < FIELD; i++) {
    const lon = rand() * Math.PI * 2;
    const lat = Math.asin(2 * rand() - 1);
    v.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)).multiplyScalar(SKY_RADIUS);
    positions.push(v.x, v.y, v.z);
    const b = 0.3 + rand() ** 4 * 0.7;
    const warm = rand();
    colors.push(b * (warm > 0.7 ? 1 : 0.86), b * 0.92, b * (warm < 0.3 ? 1 : 0.82));
    sizes.push(1.4 + rand() ** 6 * 3.2);
  }

  let placed = 0;
  while (placed < BAND) {
    const l = rand() < 0.45 ? wrap180(gauss() * 38) : rand() * 360 - 180;
    const core = Math.exp(-((l / 16) ** 2));
    const b = gauss() * (2.4 + 6 * core);
    // The Great Rift: dust blocks most of the light near the plane there.
    if (l > -8 && l < 62 && Math.abs(b - 0.6) < 2.1 && rand() < 0.82) continue;
    galacticDirection(l, b, v).multiplyScalar(SKY_RADIUS);
    positions.push(v.x, v.y, v.z);
    const k = 0.18 + rand() * 0.34 + core * 0.18;
    colors.push(k * (0.95 + core * 0.05), k * (0.9 - core * 0.06), k * (0.86 - core * 0.2));
    sizes.push(1.1 + rand() * 1.1);
    placed++;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  const points = new THREE.Points(geometry, warpMaterial(STAR_VERTEX, pixelRatio));
  points.frustumCulled = false;
  return points;
}

const angularScale = (deg) => 2 * SKY_RADIUS * Math.tan((deg * DEG) / 2);

function sprite(texture, { size, opacity = 1, rotation = 0, dark = false }) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    color: dark ? 0x000000 : 0xffffff,
    opacity,
    rotation,
    transparent: true,
    depthWrite: false,
    blending: dark ? THREE.NormalBlending : THREE.AdditiveBlending
  }));
  s.scale.setScalar(angularScale(size));
  return s;
}

/** The diffuse glow of unresolved stars along the band, and dark dust over the rift. */
function bandGlow(group) {
  const soft = glowTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0.3)', 128);
  const v = new THREE.Vector3();
  for (let l = -180; l < 180; l += 6) {
    const core = Math.exp(-((l / 25) ** 2));
    const s = sprite(soft, { size: 13 + core * 16, opacity: 0.05 + core * 0.13 });
    s.material.color.setRGB(1, 0.92 - core * 0.08, 0.84 - core * 0.24);
    s.position.copy(galacticDirection(l, 0, v).multiplyScalar(SKY_RADIUS * 0.99));
    group.add(s);
  }
  const dust = glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.5)', 128);
  for (let l = -4; l <= 58; l += 5) {
    const s = sprite(dust, { size: 7, opacity: 0.35, dark: true });
    s.position.copy(galacticDirection(l, 0.6, v).multiplyScalar(SKY_RADIUS * 0.98));
    s.renderOrder = 1;
    group.add(s);
  }
}

function objectSprite(obj) {
  switch (obj.kind) {
    // Nebulae are faint smudges to the eye; kept soft so they read as sky, not objects.
    case 'nebula': return sprite(nebulaTexture(obj.name, obj.colour, obj.core), { size: obj.size, opacity: 0.45 });
    case 'galaxy': return sprite(galaxyTexture(obj.colour, obj.tilt), { size: obj.size, rotation: obj.angle * DEG, opacity: 0.85 });
    case 'cloud': return sprite(cloudTexture(obj.name, obj.colour), { size: obj.size, opacity: 0.8 });
    case 'cluster': return sprite(clusterTexture(obj.name, obj.colour), { size: obj.size });
    case 'core': {
      const [r, g, b] = obj.colour;
      return sprite(glowTexture(`rgba(${r},${g},${b},0.9)`, `rgba(${r},${g},${b},0.25)`, 128), { size: obj.size, opacity: 0.55 });
    }
    default: {
      const [r, g, b] = obj.colour;
      return sprite(glowTexture('rgba(255,255,255,1)', `rgba(${r},${g},${b},0.45)`, 64), { size: 1.6 * obj.mag });
    }
  }
}

/**
 * The whole sky around the Solar System: field stars, the Milky Way band,
 * and the named nebulae, galaxies and stars at their true directions.
 * Returns the group (move it with the camera), the star material (for the
 * warp) and the named objects with their directions.
 */
export function createSky(pixelRatio) {
  const group = new THREE.Group();
  const stars = starPoints(pixelRatio);
  group.add(stars);
  bandGlow(group);

  const items = SKY_OBJECTS.map((obj) => {
    const direction = skyDirection(obj.ra, obj.dec);
    const s = objectSprite(obj);
    s.position.copy(direction).multiplyScalar(SKY_RADIUS * 0.97);
    group.add(s);
    return { name: obj.name, kind: 'sky', info: obj.info, direction };
  });

  return { group, material: stars.material, items };
}

/**
 * Interplanetary dust drifting past the camera: nothing to look at when you
 * sit still, but it is what makes moving feel like moving.
 */
export function createDust(pixelRatio) {
  const COUNT = 2200;
  const BOX = 36;
  const rand = mulberry32(99);
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const sizes = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    positions.set([rand() * BOX, rand() * BOX, rand() * BOX], i * 3);
    const k = 0.18 + rand() * 0.22;
    colors.set([k, k * 0.93, k * 0.84], i * 3);
    sizes[i] = 0.6 + rand() * 0.8;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const material = warpMaterial(DUST_VERTEX, pixelRatio, {
    uCam: { value: new THREE.Vector3() },
    uBox: { value: BOX }
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return { points, material };
}
