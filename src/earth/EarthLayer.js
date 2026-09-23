import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { accelerateZoom } from '../rendering/accelerateZoom.js';
import { LayerBlend } from '../rendering/LayerBlend.js';
import { createAtmosphere } from '../solar/atmosphere.js';
import { GibsTiles } from './gibsTiles.js';
import { googleTiles } from './googleTiles.js';

/*
 * Earth at true scale, in kilometres, for descending from orbit to region
 * level. The Solar System's Earth is a compressed stand-in; this is the same
 * globe in Earth's own frame (north on +Y, 0° longitude on +X, as its maps
 * are drawn), with GIBS imagery sharpening it to ~500 m a pixel.
 *
 * It is joined to the Solar System by a band, like the map and the Solar
 * System: following Earth, between BAND_OUTER_R and BAND_INNER_R Earth radii
 * from its centre this layer fades in over it from the same viewpoint, and
 * the controls change hands mid-band. It is drawn over the Solar System's
 * frame, so the real sky, the Sun and the Moon stay behind it. While it has
 * the controls the Solar System's clock is held: at display speed Earth
 * turns every 8 s, which no one could land on.
 */
const BAND_OUTER_R = 5;
const BAND_INNER_R = 2.5;
const HAND_IN = 0.45;
const HAND_BACK = 0.55;
const HAND_IN_R = BAND_INNER_R * (BAND_OUTER_R / BAND_INNER_R) ** HAND_IN;
// Below this the view has turned from ecliptic north up to Earth's north up.
const LEVEL_R = 1.6;
// Region level: GIBS's ~490 m pixels are about two screen pixels here.
const MIN_ALTITUDE_KM = 250;
// Clouds from the 8K map blur the imagery below; they clear on the way down.
const CLOUDS_GONE_KM = 1500;
const CLOUDS_FULL_KM = 6000;
const CLOUD_KM = 12;
const AU_KM = 1.496e8;
const TWO_PI = Math.PI * 2;
const Y = new THREE.Vector3(0, 1, 0);

export class EarthLayer {
  /** `body` is the Solar System's Earth; `planet` its entry in data.js. */
  constructor(renderer, body, planet) {
    this.renderer = renderer;
    this.body = body;
    this.radius = planet.radiusKm;
    // Kilometres per Solar System unit, at Earth.
    this.kmPerUnit = planet.radiusKm / body.radius;
    this.owns = false;
    this.opacity = 0;
    this.size = new THREE.Vector2();
    this.sunView = { value: new THREE.Vector3() };
    this.sun = new THREE.Vector3();
    this._inv = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._qi = new THREE.Quaternion();
    this._look = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._cross = new THREE.Vector3();
    this._clear = new THREE.Color();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 10, 1e5);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.minDistance = this.radius + MIN_ALTITUDE_KM;
    this.controls.maxDistance = this.radius * BAND_OUTER_R;
    accelerateZoom(this.controls);

    // City lights on the night side only; the Sun is far off along uSunView.
    this.nightSide = (shader) => {
      shader.uniforms.uSunView = this.sunView;
      shader.fragmentShader = `uniform vec3 uSunView;\n${shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance *= smoothstep(0.1, -0.15, dot(normal, uSunView));`)}`;
    };
    // The manifest's maps, whichever the Solar System's Earth is wearing, under the tiles.
    this.globe = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius, 128, 64),
      new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 })
    );
    this.globe.material.onBeforeCompile = this.nightSide;
    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius + CLOUD_KM, 128, 64),
      new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, roughness: 1 })
    );
    this.atmosphere = createAtmosphere(this.radius, { ...planet.atmosphere, radiusKm: planet.radiusKm });
    const touch = globalThis.matchMedia?.('(pointer: coarse)').matches;
    this.tiles = new GibsTiles(this.radius, { nightSide: this.nightSide, budget: touch ? 48 : 96 });
    this.light = new THREE.DirectionalLight(0xfff4e0, 3.2);
    this.scene.add(this.globe, this.tiles.group, this.clouds, this.atmosphere, this.light, new THREE.AmbientLight(0xffffff, 0.09));
    // Google Photorealistic 3D Tiles would join below region level; the slot is empty.
    this.photoreal = googleTiles(this);
  }

  /**
   * Called every Solar System step, after its own camera has moved. Following
   * Earth, this layer's camera is placed from the Solar System's; once it has
   * the controls, the Solar System's camera is placed from it instead.
   */
  update(dt, solar) {
    const { body, camera } = this;
    body.mesh.updateWorldMatrix(true, false);
    const frame = body.mesh.matrixWorld;
    body.mesh.getWorldQuaternion(this._q);
    this._qi.copy(this._q).invert();
    const following = solar.follow?.body === body && solar.follow.t >= 1;
    if (!this.owns && !following) {
      this.setOpacity(0);
      return;
    }

    solar.renderer.getSize(this.size);
    camera.fov = solar.camera.fov;
    camera.aspect = this.size.x / Math.max(this.size.y, 1);
    if (this.owns) {
      this.steer();
      this.driveSolar(solar, frame);
    } else {
      camera.position.copy(solar.camera.position).applyMatrix4(this._inv.copy(frame).invert()).multiplyScalar(this.kmPerUnit);
      camera.quaternion.copy(this._qi).multiply(solar.camera.quaternion);
    }

    const r = camera.position.length() / this.radius;
    const band = THREE.MathUtils.clamp(Math.log(r / BAND_INNER_R) / Math.log(BAND_OUTER_R / BAND_INNER_R), 0, 1);
    if (!this.owns && band < HAND_IN) this.takeOver(solar);
    else if (this.owns && band > HAND_BACK) this.handBack(solar);
    this.setOpacity(1 - band);
    if (this.opacity > 0) this.prepare();
  }

  /** The zoom and drag follow the ground: each notch a share of the altitude, a drag keeps the ground under the pointer. */
  steer() {
    const { camera, controls } = this;
    const distance = camera.position.length();
    const altitude = distance - this.radius;
    controls.zoomBase = Math.log(1 - (0.05 * altitude) / distance) / Math.log(0.95);
    controls.zoomSpeed = controls.zoomBase;
    controls.rotateSpeed = Math.min(1, (altitude * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / (TWO_PI * this.radius));
    controls.update();

    // Roll from ecliptic north up (the Solar System's) to Earth's north up on
    // the way down, so neither hand-over turns the view.
    const look = this._look.copy(camera.position).negate().normalize();
    const ecliptic = this._b.copy(Y).applyQuaternion(this._qi);
    const a = this._a.copy(Y).addScaledVector(look, -Y.dot(look));
    const b = ecliptic.addScaledVector(look, -ecliptic.dot(look));
    if (a.lengthSq() < 1e-8 || b.lengthSq() < 1e-8) return;
    a.normalize();
    b.normalize();
    const roll = Math.atan2(this._cross.crossVectors(a, b).dot(look), a.dot(b));
    const share = THREE.MathUtils.clamp((distance / this.radius - LEVEL_R) / (HAND_IN_R - LEVEL_R), 0, 1);
    camera.up.copy(a).applyAxisAngle(look, roll * share);
    camera.lookAt(0, 0, 0);
  }

  /** The Solar System's camera, placed from this one: same view, in display units. */
  driveSolar(solar, frame) {
    const { camera } = solar;
    camera.position.copy(this.camera.position).divideScalar(this.kmPerUnit).applyMatrix4(frame);
    camera.quaternion.copy(this._q).multiply(this.camera.quaternion);
    camera.up.copy(Y).applyQuaternion(camera.quaternion);
    this.body.mesh.getWorldPosition(solar.controls.target);
  }

  takeOver(solar) {
    this.owns = true;
    solar.controls.enabled = false;
    solar.stopTour();
    this.controls.target.set(0, 0, 0);
    this.controls.enabled = true;
    solar.root.classList.add('earth-view');
  }

  handBack(solar) {
    this.release(solar);
    solar.controls.enabled = true;
  }

  /** Gives the view back to the Solar System, as on leaving it. */
  release(solar) {
    this.owns = false;
    this.controls.enabled = false;
    this.camera.up.copy(Y);
    solar.root.classList.remove('earth-view');
    this.setOpacity(0);
  }

  setOpacity(opacity) {
    this.opacity = opacity;
    // Covered entirely, the stand-in need not be drawn (it is also inside the near plane by then).
    this.body.mesh.visible = opacity < 1;
  }

  /** Sun, maps and tiles for the frame about to be drawn. */
  prepare() {
    const { camera, body } = this;
    const distance = camera.position.length();
    camera.near = Math.max(1, (distance - this.radius) * 0.1);
    camera.far = distance + this.radius * 1.2;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    // The Sun is the Solar System's origin: its true direction, at 1 AU.
    this.sun.copy(body.mesh.getWorldPosition(this._a)).negate().applyQuaternion(this._qi).setLength(AU_KM);
    this.light.position.copy(this.sun);
    this.atmosphere.material.uniforms.uSun.value.copy(this.sun);
    this.sunView.value.copy(this.sun).normalize().transformDirection(camera.matrixWorldInverse);

    const source = body.mesh.material;
    const globe = this.globe.material;
    if (globe.map !== source.map || globe.emissiveMap !== source.emissiveMap) {
      globe.map = source.map;
      globe.emissiveMap = source.emissiveMap;
      globe.emissive.set(source.emissiveMap ? 0xffffff : 0x000000);
      globe.needsUpdate = true;
    }
    const cloudMap = body.clouds?.material.alphaMap ?? null;
    if (this.clouds.material.alphaMap !== cloudMap) {
      this.clouds.material.alphaMap = cloudMap;
      this.clouds.material.needsUpdate = true;
    }
    this.clouds.visible = !!cloudMap;
    this.clouds.material.opacity = THREE.MathUtils.smoothstep(distance - this.radius, CLOUDS_GONE_KM, CLOUDS_FULL_KM);
    this.tiles.setNight(source.emissiveMap);
    this.tiles.update(camera, this.size.y, source.map?.image?.width);
  }

  /** Over the Solar System's frame just drawn: faded across the band, straight on inside it. */
  draw() {
    if (this.opacity <= 0) return;
    const { renderer } = this;
    const render = () => {
      const alpha = renderer.getClearAlpha();
      renderer.getClearColor(this._clear);
      renderer.setClearColor(this._clear, 0);
      renderer.clear();
      renderer.render(this.scene, this.camera);
      renderer.setClearColor(this._clear, alpha);
    };
    if (this.opacity < 1) {
      this.blend ??= new LayerBlend(renderer);
      this.blend.over(render, this.opacity);
      return;
    }
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }
}
