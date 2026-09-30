import * as THREE from 'three';
import {
  SHIP_LENGTH, THRUST, REVERSE_SHARE, BOOST, CRUISE_CAP, BOOST_CAP,
  PITCH_RATE, YAW_RATE, ROLL_RATE, TURN_RESPONSE, HULL
} from './tuning.js';

const FORWARD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

// Where the tail sits below the ship's centre, in ship lengths: how high it
// stands on the pad.
export const TAIL_DEPTH = 0.47;

const FLAME_VERTEX = `
varying float vT;
void main() {
  vT = position.z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Orange-white at cruise, blue-white plasma on boost; flickers, fades down its length.
const FLAME_FRAGMENT = `
uniform float uLevel;
uniform float uBoost;
uniform float uTime;
varying float vT;
void main() {
  float flicker = 0.82 + 0.18 * sin(uTime * 61.0 + vT * 17.0) * sin(uTime * 23.0 + vT * 5.0);
  vec3 hot = mix(vec3(1.0, 0.95, 0.82), vec3(0.85, 0.95, 1.0), uBoost);
  vec3 cool = mix(vec3(1.0, 0.42, 0.1), vec3(0.3, 0.55, 1.0), uBoost);
  vec3 colour = mix(hot, cool, smoothstep(0.0, 0.75, vT));
  float alpha = pow(1.0 - vT, 1.6) * uLevel * flicker;
  gl_FragColor = vec4(colour, alpha);
}`;

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

/** The fuselage: a lathe, nose along −Z, a little flatter than it is wide. */
function hullGeometry() {
  const profile = [
    [0.0, 0.52], [0.035, 0.46], [0.065, 0.36], [0.088, 0.22], [0.1, 0.06],
    [0.1, -0.16], [0.094, -0.32], [0.082, -0.44], [0.05, -0.47], [0.0, -0.47]
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const geometry = new THREE.LatheGeometry(profile, 28);
  geometry.rotateX(-Math.PI / 2);
  geometry.scale(1, 0.72, 1);
  geometry.computeVertexNormals();
  return geometry;
}

/** The right wing, seen from above: x out along the span, y toward the tail. */
function wingGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0.07, -0.04);
  shape.lineTo(0.44, 0.17);
  shape.lineTo(0.46, 0.27);
  shape.lineTo(0.07, 0.31);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.018, bevelEnabled: false });
  // The shape's plane becomes the wing plane; its y runs toward the tail (+Z).
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, -0.011, 0);
  geometry.computeVertexNormals();
  return geometry;
}

/** The tail fin, seen from the side: x toward the tail, y up. */
function finGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0.16, 0.0);
  shape.lineTo(0.4, 0.0);
  shape.lineTo(0.46, 0.2);
  shape.lineTo(0.36, 0.21);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: false });
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(0.007, 0.05, 0);
  geometry.computeVertexNormals();
  return geometry;
}

/** A flame cone with its base at z = 0 and its tip at z = 1, so its length is its z scale. */
function flameGeometry() {
  const geometry = new THREE.ConeGeometry(0.04, 1, 16, 1, true);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0, 0.5);
  return geometry;
}

/**
 * The player's ship: a procedural fighter, its flight model and its engine
 * flames. `group` carries the physics (position, orientation); `model` inside
 * it is scaled to SHIP_LENGTH and takes the shaking, so a shudder never moves
 * the ship itself.
 */
export class Ship {
  constructor() {
    this.group = new THREE.Group();
    this.model = new THREE.Group();
    this.model.scale.setScalar(SHIP_LENGTH);
    this.group.add(this.model);

    this.velocity = new THREE.Vector3();
    // Turn rates about the ship's own axes: x pitch, y yaw, z roll.
    this.angular = new THREE.Vector3();
    this.hull = HULL;
    this.flame = 0;
    this.boosting = false;
    this.throttle = 0;
    this.flameUniforms = { uLevel: { value: 0 }, uBoost: { value: 0 }, uTime: { value: 0 } };
    this.nozzleLocal = [new THREE.Vector3(0.13, -0.025, 0.47), new THREE.Vector3(-0.13, -0.025, 0.47)];

    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();

    this.build();
  }

  build() {
    // A little self-light keeps the hull readable on the night side, where
    // the ambient light alone leaves it black.
    const hull = new THREE.MeshStandardMaterial({ color: 0xdfe4ec, metalness: 0.45, roughness: 0.38, emissive: 0x141b26 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a4252, metalness: 0.5, roughness: 0.45, emissive: 0x0c1016 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0b2a3a, metalness: 0.2, roughness: 0.15, emissive: 0x1fb8ff, emissiveIntensity: 0.35 });
    this.nozzleMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a2020, metalness: 0.6, roughness: 0.4, emissive: 0xff7a2a, emissiveIntensity: 0.4, side: THREE.DoubleSide
    });

    const body = new THREE.Mesh(hullGeometry(), hull);
    const canopyGeometry = new THREE.SphereGeometry(0.05, 20, 12);
    canopyGeometry.scale(1, 0.62, 2.1);
    const canopy = new THREE.Mesh(canopyGeometry, glass);
    canopy.position.set(0, 0.045, -0.16);

    const rightWing = new THREE.Mesh(wingGeometry(), dark);
    rightWing.rotation.z = 0.08;
    const leftWing = rightWing.clone();
    // A mirror image; three flips the face winding for negative scale itself.
    leftWing.scale.x = -1;
    leftWing.rotation.z = -0.08;
    const fin = new THREE.Mesh(finGeometry(), dark);

    const nacelleGeometry = new THREE.CylinderGeometry(0.052, 0.04, 0.3, 18);
    nacelleGeometry.rotateX(Math.PI / 2);
    const nozzleGeometry = new THREE.CylinderGeometry(0.056, 0.046, 0.035, 18, 1, true);
    nozzleGeometry.rotateX(Math.PI / 2);
    const flameGeometryShared = flameGeometry();
    const flameMaterial = new THREE.ShaderMaterial({
      uniforms: this.flameUniforms,
      vertexShader: FLAME_VERTEX,
      fragmentShader: FLAME_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });

    this.flames = [];
    for (const side of [1, -1]) {
      const nacelle = new THREE.Mesh(nacelleGeometry, dark);
      nacelle.position.set(0.13 * side, -0.025, 0.29);
      const nozzle = new THREE.Mesh(nozzleGeometry, this.nozzleMaterial);
      nozzle.position.set(0.13 * side, -0.025, 0.455);
      const flame = new THREE.Mesh(flameGeometryShared, flameMaterial);
      flame.position.set(0.13 * side, -0.025, 0.47);
      flame.scale.set(1, 1, 0.001);
      flame.renderOrder = 4;
      this.flames.push(flame);
      this.model.add(nacelle, nozzle, flame);
    }

    // Navigation lights on the wingtips: red to port, green to starboard.
    const lightGeometry = new THREE.SphereGeometry(0.014, 8, 6);
    const port = new THREE.Mesh(lightGeometry, new THREE.MeshBasicMaterial({ color: 0xff3040 }));
    port.position.set(-0.455, -0.011, 0.24);
    const starboard = new THREE.Mesh(lightGeometry, new THREE.MeshBasicMaterial({ color: 0x30ff70 }));
    starboard.position.set(0.455, -0.011, 0.24);
    this.navLights = [port, starboard];

    this.model.add(body, canopy, rightWing, leftWing, fin, port, starboard);
  }

  get position() {
    return this.group.position;
  }

  get quaternion() {
    return this.group.quaternion;
  }

  forward(out) {
    return out.copy(FORWARD).applyQuaternion(this.group.quaternion);
  }

  up(out) {
    return out.copy(UP).applyQuaternion(this.group.quaternion);
  }

  right(out) {
    return out.copy(RIGHT).applyQuaternion(this.group.quaternion);
  }

  /** Turns toward the rates the controls ask for, with a little inertia, and integrates the orientation. */
  steer(input, dt) {
    const k = 1 - Math.exp(-TURN_RESPONSE * dt);
    this.angular.x += (input.pitch * PITCH_RATE - this.angular.x) * k;
    this.angular.y += (input.yaw * YAW_RATE - this.angular.y) * k;
    this.angular.z += (input.roll * ROLL_RATE - this.angular.z) * k;
    const angle = this.angular.length() * dt;
    if (angle > 1e-9) {
      // Rates are about the ship's own axes, so the turn composes on the right.
      this._q.setFromAxisAngle(this._v.copy(this.angular).normalize(), angle);
      this.group.quaternion.multiply(this._q).normalize();
    }
  }

  /**
   * Engine acceleration in world axes, into `out`. `relative` is the ship's
   * velocity relative to the world pulling hardest: the caps are speeds
   * against that, not against the Sun. Boost is an afterburner, so it always
   * drives forward.
   */
  engineAccel(input, relative, out) {
    const thrust = input.boost ? Math.max(input.thrust, 1) : input.thrust;
    const boost = input.boost && thrust > 0;
    this.boosting = boost;
    this.throttle = Math.abs(thrust);
    this.forward(out);
    if (thrust === 0) return out.set(0, 0, 0);
    const along = relative.dot(out);
    if (thrust > 0) {
      const cap = boost ? BOOST_CAP : CRUISE_CAP;
      return out.multiplyScalar(thrust * THRUST * (boost ? BOOST : 1) * clamp01(1 - along / cap));
    }
    return out.multiplyScalar(thrust * THRUST * REVERSE_SHARE * clamp01(1 + along / CRUISE_CAP));
  }

  /** World positions of the two nozzles, for the exhaust. */
  nozzles(out) {
    this.group.updateMatrixWorld(true);
    for (let i = 0; i < this.nozzleLocal.length; i++) {
      out[i].copy(this.nozzleLocal[i]);
      this.model.localToWorld(out[i]);
    }
    return out;
  }

  /** Flames and nozzle glow follow the throttle; the nav lights blink once a second. */
  animate(dt, time, throttle, boost) {
    const target = throttle > 0 ? (0.35 + 0.65 * throttle) * (boost ? 1.6 : 1) : 0;
    this.flame += (target - this.flame) * (1 - Math.exp(-dt * 14));
    const u = this.flameUniforms;
    u.uLevel.value = Math.min(this.flame, 1);
    u.uBoost.value += ((boost ? 1 : 0) - u.uBoost.value) * (1 - Math.exp(-dt * 8));
    u.uTime.value = time;
    const width = 1 + 0.3 * u.uBoost.value;
    const length = 0.001 + this.flame * (boost ? 1.15 : 0.6) * (0.92 + 0.08 * Math.sin(time * 53));
    for (const flame of this.flames) flame.scale.set(width, width, length);
    this.nozzleMaterial.emissiveIntensity = 0.4 + this.flame * 2.2;
    // A short blink once a second: well under three flashes a second.
    const on = time % 1 < 0.12;
    for (const light of this.navLights) light.visible = on;
  }

  /** Shakes the model, not the ship: `amount` is in ship lengths. */
  vibrate(amount, time) {
    this.model.position.set(Math.sin(time * 83) * amount * SHIP_LENGTH, Math.sin(time * 71 + 1) * amount * SHIP_LENGTH, 0);
  }

  reset() {
    this.velocity.set(0, 0, 0);
    this.angular.set(0, 0, 0);
    this.hull = HULL;
    this.flame = 0;
    this.throttle = 0;
    this.boosting = false;
    this.model.position.set(0, 0, 0);
    this.group.visible = true;
  }
}

/**
 * A launch pad, in ship lengths: a deck, and a tower with its arm along +X,
 * which is turned away from the camera when the pad is placed.
 */
export function createPad() {
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a9099, metalness: 0.4, roughness: 0.6, emissive: 0x0d1117 });
  const group = new THREE.Group();

  const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.06, 32), metal);
  deck.position.y = 0.03;
  const tower = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.1, 0.09), metal);
  tower.position.set(0.72, 0.55, 0);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.035, 0.05), metal);
  arm.position.set(0.42, 0.82, 0);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3a30 }));
  beacon.position.set(0.72, 1.13, 0);

  group.add(deck, tower, arm, beacon);
  group.userData.deckTop = 0.06;
  group.scale.setScalar(SHIP_LENGTH);
  return group;
}
