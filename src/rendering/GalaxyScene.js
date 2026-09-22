import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import galaxyVert from './shaders/galaxy.vert?raw';
import galaxyFrag from './shaders/galaxy.frag?raw';
import { BOOTES_VOID_CENTER, SLOAN_GREAT_WALL } from '../data/sdssGenerator.js';

// Birth flash length: long enough to see one galaxy land in slow motion, short
// enough not to smear the whole frontier at full speed.
const flashSeconds = (speed) => Math.min(0.9, 0.15 + 8 / speed);

export class GalaxyScene {
  constructor(container) {
    this.container = container;
    this.width = container.clientWidth || window.innerWidth;
    this.height = container.clientHeight || window.innerHeight;

    // 1. Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      // Needs an alpha channel in the drawing buffer, otherwise a zero-alpha
      // clear colour still composites opaque and nothing shows through.
      alpha: true
    });
    this.renderer.setSize(this.width, this.height);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2.0);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setClearColor(0x040408, 1.0); // Sleek deep cosmic dark
    container.appendChild(this.renderer.domElement);

    // 2. Scene & Camera
    this.scene = new THREE.Scene();
    // Near has to sit well inside controls.minDistance (0.2 Mpc), or the Local
    // Group is clipped away exactly when you fly in to look at it.
    this.camera = new THREE.PerspectiveCamera(50, this.width / this.height, 0.02, 30000.0);
    this.camera.position.set(200, 500, 1350);

    // 3. Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxDistance = 20000.0;
    this.controls.minDistance = 0.2; // Local Group galaxies sit under 1 Mpc from origin
    // Scrolling heads for what is under the pointer, like every map.
    this.controls.zoomToCursor = true;
    this.controls.target.set(0, 0, 0);

    // 4. Uniforms
    this.uniforms = {
      uPlotProgress: { value: 1.0 },
      uMinZ: { value: 0.00 },
      uMaxZ: { value: 0.30 },
      uPointSize: { value: 3.8 },
      uTime: { value: 0.0 },
      uHDRExposure: { value: 1.3 },
      uHighlightActive: { value: 0.0 },
      uHighlightCenter: { value: new THREE.Vector3(0, 0, 0) },
      uHighlightRadius: { value: 40.0 },
      uSpawnWindow: { value: 0.002 },
      uPixelRatio: { value: this.pixelRatio },
      // Star trails: how far a point stretches, and which way on screen.
      uTrailAmount: { value: 0.0 },
      uTrailDir: { value: new THREE.Vector2(1, 0) }
    };

    // 5. Build Earth origin & Coordinate axes
    this.createCosmicLandmarkBeacons();

    // 6. Camera flight & Cinematic Auto-Orbit state
    this.cameraFlight = null;
    this.autoOrbit = false;
    this.orbitSpeedRadPerSec = 0.06; // Mesmerizing slow rotation for screen recording

    // 7. Resize & Orientation observers
    window.addEventListener('resize', this.onResize.bind(this));
    window.addEventListener('orientationchange', () => {
      setTimeout(() => this.onResize(), 150);
    });
    this.onResize();
  }

  createCosmicLandmarkBeacons() {
    // Earth origin: Small crisp blue dot with subtle atmosphere glow (z=0)
    const earthGroup = new THREE.Group();
    const earthGeo = new THREE.SphereGeometry(1.0, 32, 32);
    const earthMat = new THREE.MeshBasicMaterial({
      color: 0x0088ff
    });
    const earthMesh = new THREE.Mesh(earthGeo, earthMat);

    // Atmosphere halo
    const haloGeo = new THREE.SphereGeometry(1.6, 32, 32);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x00dfff,
      transparent: true,
      opacity: 0.35,
      side: THREE.BackSide
    });
    const haloMesh = new THREE.Mesh(haloGeo, haloMat);

    earthGroup.add(earthMesh);
    earthGroup.add(haloMesh);
    this.earthMarker = earthGroup;
    this.scene.add(this.earthMarker);

    // Subtle coordinate rings (100 Mpc, 500 Mpc, 1000 Mpc)
    const ringGroup = new THREE.Group();
    [100, 500, 1000].forEach(r => {
      const ringGeo = new THREE.RingGeometry(r - 0.5, r, 64);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x334466,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.18,
        // With the near plane this close, depth is coarse out at the rings;
        // writing it would clip stars sitting just behind them.
        depthWrite: false
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ringGroup.add(ring);
    });
    this.scene.add(ringGroup);

    // Boötes Void Wireframe Indicator
    const cosDec = Math.cos(BOOTES_VOID_CENTER.dec * Math.PI / 180);
    const bx = BOOTES_VOID_CENTER.distanceMpc * cosDec * Math.cos(BOOTES_VOID_CENTER.ra * Math.PI / 180);
    const by = BOOTES_VOID_CENTER.distanceMpc * cosDec * Math.sin(BOOTES_VOID_CENTER.ra * Math.PI / 180);
    const bz = BOOTES_VOID_CENTER.distanceMpc * Math.sin(BOOTES_VOID_CENTER.dec * Math.PI / 180);
    this.bootesCenter = new THREE.Vector3(bx, by, bz);

    const voidGeo = new THREE.SphereGeometry(BOOTES_VOID_CENTER.radiusMpc, 24, 16);
    const voidMat = new THREE.MeshBasicMaterial({
      color: 0xff3355,
      wireframe: true,
      transparent: true,
      opacity: 0.0,
      depthWrite: false
    });
    this.bootesSphere = new THREE.Mesh(voidGeo, voidMat);
    this.bootesSphere.position.copy(this.bootesCenter);
    this.scene.add(this.bootesSphere);

    // Sloan Great Wall indicator center
    const sDec = Math.cos(SLOAN_GREAT_WALL.dec * Math.PI / 180);
    const sx = SLOAN_GREAT_WALL.distanceMpc * sDec * Math.cos(SLOAN_GREAT_WALL.ra * Math.PI / 180);
    const sy = SLOAN_GREAT_WALL.distanceMpc * sDec * Math.sin(SLOAN_GREAT_WALL.ra * Math.PI / 180);
    const sz = SLOAN_GREAT_WALL.distanceMpc * Math.sin(SLOAN_GREAT_WALL.dec * Math.PI / 180);
    this.sloanCenter = new THREE.Vector3(sx, sy, sz);
  }

  loadDataset(catalogData) {
    if (this.pointsMesh) {
      this.scene.remove(this.pointsMesh);
      this.pointsMesh.geometry.dispose();
    }

    this.catalogData = catalogData;
    const geo = new THREE.BufferGeometry();

    geo.setAttribute('position', new THREE.BufferAttribute(catalogData.positions, 3));
    geo.setAttribute('aColorParam', new THREE.BufferAttribute(catalogData.colorParams, 1));
    geo.setAttribute('aRedshift', new THREE.BufferAttribute(catalogData.redshifts, 1));
    geo.setAttribute('aIsQSO', new THREE.BufferAttribute(catalogData.isQSOArray, 1));
    geo.setAttribute('aLandmarkId', new THREE.BufferAttribute(catalogData.landmarkIds, 1));

    // Its own buffer: setPlottingOrder copies other orders into it, and aliasing
    // catalogData.orders.redshift here overwrote that order on the first switch.
    this.currentOrderKey = 'redshift';
    geo.setAttribute('aSpawnOrder', new THREE.BufferAttribute(new Float32Array(catalogData.orders.redshift), 1));

    // One material for the life of the scene; a new one per dataset leaked a
    // compiled program on every catalog swap.
    this.pointsMaterial ??= new THREE.ShaderMaterial({
      vertexShader: galaxyVert,
      fragmentShader: galaxyFrag,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.pointsMesh = new THREE.Points(geo, this.pointsMaterial);
    this.scene.add(this.pointsMesh);
  }

  /**
   * Swings the camera around the orbit target: the map turns past a viewer who
   * stays put, which is what turning the sky looks like from the ground.
   * Gesture and any other input drive this rather than touching the camera.
   */
  orbitBy(dYaw, dPitch, scaleFactor = 1.0) {
    this._orbitOffset ??= new THREE.Vector3();
    this._orbitSpherical ??= new THREE.Spherical();

    this._orbitOffset.copy(this.camera.position).sub(this.controls.target);
    this._orbitSpherical.setFromVector3(this._orbitOffset);
    this._orbitSpherical.theta += dYaw;
    // Stop just short of the poles, where azimuth becomes meaningless.
    this._orbitSpherical.phi = THREE.MathUtils.clamp(this._orbitSpherical.phi + dPitch, 0.05, Math.PI - 0.05);
    this._orbitSpherical.radius = THREE.MathUtils.clamp(
      this._orbitSpherical.radius * scaleFactor,
      this.controls.minDistance,
      this.controls.maxDistance
    );

    this.camera.position.copy(this.controls.target).add(this._orbitOffset.setFromSpherical(this._orbitSpherical));
    this.camera.lookAt(this.controls.target);
  }

  setPlottingOrder(orderKey) {
    if (!this.catalogData || !this.catalogData.orders[orderKey]) return;
    this.currentOrderKey = orderKey;
    const attr = this.pointsMesh.geometry.getAttribute('aSpawnOrder');
    attr.array.set(this.catalogData.orders[orderKey]);
    attr.needsUpdate = true;
  }

  setRedshiftRange(minZ, maxZ) {
    this.uniforms.uMinZ.value = minZ;
    this.uniforms.uMaxZ.value = maxZ;
  }

  setPlotProgress(progress) {
    this.uniforms.uPlotProgress.value = Math.max(0.0, Math.min(1.0, progress));
  }

  setPlotSpeed(speed) {
    const count = this.catalogData?.count || 1;
    const span = Number.isFinite(speed) ? (speed * flashSeconds(speed)) / count : 0.06;
    this.uniforms.uSpawnWindow.value = THREE.MathUtils.clamp(span, 1e-7, 0.06);
  }

  setTransparentBackground(isTransparent) {
    this.isTransparentBg = isTransparent;
    if (isTransparent) {
      this.renderer.setClearColor(0x000000, 0.0);
    } else {
      this.renderer.setClearColor(0x040408, 1.0);
    }
  }

  toggleTransparentBackground() {
    this.setTransparentBackground(!this.isTransparentBg);
    return this.isTransparentBg;
  }

  toggleAutoOrbit() {
    this.autoOrbit = !this.autoOrbit;
    return this.autoOrbit;
  }

  zoomAtScreenPoint(screenX, screenY, direction = 'in') {
    const mouse = new THREE.Vector2(
      (screenX / this.width) * 2 - 1,
      -(screenY / this.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);
    if (raycaster.params.Points) {
      raycaster.params.Points.threshold = 25.0;
    }

    let targetPoint = new THREE.Vector3();
    let hitFound = false;

    if (this.pointsMesh) {
      const intersects = raycaster.intersectObject(this.pointsMesh);
      if (intersects.length > 0) {
        targetPoint.copy(intersects[0].point);
        hitFound = true;
      }
    }

    if (!hitFound) {
      // Raycast to plane passing through current orbit target
      const cameraDir = this.camera.getWorldDirection(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        cameraDir.clone().negate(),
        this.controls.target
      );
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, hit)) {
        targetPoint.copy(hit);
      } else {
        targetPoint.copy(this.controls.target);
      }
    }

    // Calculate current camera offset vector relative to target
    const currentOffset = this.camera.position.clone().sub(this.controls.target);
    const currentDist = currentOffset.length();

    let newDist = currentDist;
    if (direction === 'in') {
      newDist = Math.max(15.0, currentDist * 0.35); // Zoom 3x closer smoothly
    } else {
      newDist = Math.min(18000.0, currentDist * 2.5); // Zoom 2.5x further back smoothly
    }

    const newCamPos = targetPoint.clone().add(
      currentOffset.clone().normalize().multiplyScalar(newDist)
    );

    this.smoothFlyTo(newCamPos, targetPoint, 1600);
    return targetPoint;
  }

  smoothFlyTo(camPos, targetPos, duration = 1600) {
    this.cameraFlight = {
      startCam: this.camera.position.clone(),
      endCam: camPos,
      startTarget: this.controls.target.clone(),
      endTarget: targetPos,
      startTime: performance.now(),
      duration
    };
  }

  highlightLandmark(name) {
    if (name === 'bootes') {
      this.uniforms.uHighlightActive.value = 1.0;
      this.uniforms.uHighlightCenter.value.copy(this.bootesCenter);
      this.uniforms.uHighlightRadius.value = BOOTES_VOID_CENTER.radiusMpc * 1.15;
      this.bootesSphere.material.opacity = 0.35;
    } else {
      this.uniforms.uHighlightActive.value = 0.0;
      this.bootesSphere.material.opacity = 0.0;
    }
  }

  flyToLandmark(landmark, immediate = false) {
    let targetPos = new THREE.Vector3(0, 0, 0);
    let camPos = new THREE.Vector3(200, 350, 1100);

    if (landmark === 'earth') {
      targetPos.set(0, 0, 0);
      camPos.set(40, 60, 150);
      this.highlightLandmark('none');
    } else if (landmark === 'bootes') {
      targetPos.copy(this.bootesCenter);
      camPos.copy(this.bootesCenter).add(new THREE.Vector3(120, 80, 150));
      this.highlightLandmark('bootes');
    } else if (landmark === 'sloan_wall') {
      targetPos.copy(this.sloanCenter);
      camPos.copy(this.sloanCenter).add(new THREE.Vector3(-150, 120, 200));
      this.highlightLandmark('none');
    } else if (landmark === 'quasar_dawn') {
      targetPos.set(0, 0, 0);
      camPos.set(1200, 2400, 4800);
      this.highlightLandmark('none');
    } else {
      targetPos.set(0, 0, 0);
      camPos.set(200, 500, 1350);
      this.highlightLandmark('none');
    }

    if (immediate) {
      this.camera.position.copy(camPos);
      this.controls.target.copy(targetPos);
      this.controls.update();
      return;
    }

    this.cameraFlight = {
      startCam: this.camera.position.clone(),
      endCam: camPos,
      startTarget: this.controls.target.clone(),
      endTarget: targetPos,
      startTime: performance.now(),
      duration: 1800 // 1.8 seconds smooth cinematic flight
    };
  }

  onResize() {
    if (!this.container) return;
    this.width = this.container.clientWidth || window.innerWidth;
    this.height = this.container.clientHeight || window.innerHeight;
    const aspect = this.width / this.height;
    this.camera.aspect = aspect;

    // Adapt camera FOV in portrait orientation so the full 3D SDSS wedge remains visible
    if (aspect < 1.0) {
      this.camera.fov = Math.min(75, 50 / aspect);
    } else {
      this.camera.fov = 50;
    }

    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);

    // Moving a window between screens changes the ratio without a reload.
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2.0);
    if (pixelRatio !== this.pixelRatio) {
      this.pixelRatio = pixelRatio;
      this.renderer.setPixelRatio(pixelRatio);
      this.uniforms.uPixelRatio.value = pixelRatio;
    }
  }

  update(deltaTime) {
    this.uniforms.uTime.value += deltaTime;

    // AR drives the camera itself; OrbitControls and camera flights would fight it.
    if (this.cameraDriver) {
      this.cameraDriver(deltaTime);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // Cinematic Auto-Orbit rotation for screen recordings
    if (this.autoOrbit && !this.cameraFlight) {
      const angle = this.orbitSpeedRadPerSec * deltaTime;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const x = this.camera.position.x - this.controls.target.x;
      const z = this.camera.position.z - this.controls.target.z;
      this.camera.position.x = this.controls.target.x + (x * cosA - z * sinA);
      this.camera.position.z = this.controls.target.z + (x * sinA + z * cosA);
    }

    // Smooth camera flight animation
    if (this.cameraFlight) {
      const now = performance.now();
      const elapsed = now - this.cameraFlight.startTime;
      let t = Math.min(1.0, elapsed / this.cameraFlight.duration);
      t = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      this.camera.position.lerpVectors(this.cameraFlight.startCam, this.cameraFlight.endCam, t);
      this.controls.target.lerpVectors(this.cameraFlight.startTarget, this.cameraFlight.endTarget, t);

      if (t >= 1.0) {
        this.cameraFlight = null;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
