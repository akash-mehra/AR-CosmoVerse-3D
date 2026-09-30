import * as THREE from 'three';

// Sizes are world units, turned into pixels by perspective: uScale is the
// drawing buffer's height over the lens, so a particle is as big as it would be.
const VERTEX = `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 1e-5), 0.0, 180.0);
  vColor = aColor;
  vAlpha = aAlpha;
}`;

const FRAGMENT = `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = vAlpha * exp(-d * d * 3.2);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * A fixed pool of soft round particles: engine exhaust, launch smoke, sparks
 * and debris. Spawning reuses the oldest slot, so a burst never allocates;
 * each particle eases from its start size and colour to its end ones and fades
 * out over its life.
 */
export class Particles {
  constructor(capacity, { additive = true } = {}) {
    this.capacity = capacity;
    this.next = 0;

    this.position = new Float32Array(capacity * 3);
    this.colour = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);

    this.velocity = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.colour0 = new Float32Array(capacity * 3);
    this.colour1 = new Float32Array(capacity * 3);
    this.alpha0 = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.dirty = false;

    const geometry = new THREE.BufferGeometry();
    this.attributes = {
      position: new THREE.BufferAttribute(this.position, 3),
      aColor: new THREE.BufferAttribute(this.colour, 3),
      aSize: new THREE.BufferAttribute(this.size, 1),
      aAlpha: new THREE.BufferAttribute(this.alpha, 1)
    };
    for (const [name, attribute] of Object.entries(this.attributes)) {
      attribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, attribute);
    }

    this.uniforms = { uScale: { value: 600 } };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    this.points = new THREE.Points(geometry, this.material);
    // Particles are everywhere the ship has been; three's bounds would cull them wrongly.
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    this._size = new THREE.Vector2();
  }

  /**
   * One particle at `p` moving at `v`. `colour` and `colour1` are [r, g, b];
   * sizes are world units. `drag` is a decay rate per second.
   */
  spawn(p, v, { life, size, size1 = size, colour, colour1 = colour, alpha = 1, drag = 0 }) {
    const i = this.next;
    this.next = (i + 1) % this.capacity;
    const i3 = i * 3;
    this.position[i3] = p.x;
    this.position[i3 + 1] = p.y;
    this.position[i3 + 2] = p.z;
    this.velocity[i3] = v.x;
    this.velocity[i3 + 1] = v.y;
    this.velocity[i3 + 2] = v.z;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size;
    this.size1[i] = size1;
    this.size[i] = size;
    this.colour0.set(colour, i3);
    this.colour1.set(colour1, i3);
    this.colour.set(colour, i3);
    this.alpha0[i] = alpha;
    this.alpha[i] = 0;
    this.drag[i] = drag;
    this.dirty = true;
  }

  update(dt) {
    let changed = this.dirty;
    this.dirty = false;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      changed = true;
      const life = (this.life[i] -= dt);
      if (life <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      const t = 1 - life / this.maxLife[i];
      const i3 = i * 3;
      const damp = Math.exp(-this.drag[i] * dt);
      for (let k = 0; k < 3; k++) {
        this.velocity[i3 + k] *= damp;
        this.position[i3 + k] += this.velocity[i3 + k] * dt;
        this.colour[i3 + k] = lerp(this.colour0[i3 + k], this.colour1[i3 + k], t);
      }
      this.size[i] = lerp(this.size0[i], this.size1[i], t);
      // A quick fade in, then out over the rest of the life.
      this.alpha[i] = this.alpha0[i] * (1 - t) ** 1.3 * Math.min(1, t * 12);
    }
    if (!changed) return;
    for (const attribute of Object.values(this.attributes)) attribute.needsUpdate = true;
  }

  /** Keeps world sizes true to the lens: call when the camera's field of view or the canvas changes. */
  fit(renderer, camera) {
    renderer.getDrawingBufferSize(this._size);
    this.uniforms.uScale.value = this._size.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.dirty = true;
  }
}
