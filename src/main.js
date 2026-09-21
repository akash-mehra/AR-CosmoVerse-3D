import './style.css';
import { GalaxyScene } from './rendering/GalaxyScene.js';
import { PlottingController } from './controller/PlottingController.js';
import { HUD } from './ui/HUD.js';
import { NamedObjectLayer } from './ui/NamedObjectLayer.js';
import { ARMode } from './ar/ARMode.js';
import { SkyGestures } from './ar/SkyGestures.js';
import { generateSDSSCatalog } from './data/sdssGenerator.js';

document.addEventListener('DOMContentLoaded', () => {
  const appContainer = document.getElementById('app');
  if (!appContainer) return;

  // 1. Initialize 3D Scene and Renderer
  const scene = new GalaxyScene(appContainer);

  // 2. Initialize One-by-One Plotting Controller
  const controller = new PlottingController(scene);

  // 3. Initialize Glassmorphic HUD & Histogram
  const hud = new HUD(appContainer, controller, scene);

  // 3b. Labels & detail card for real catalogued objects
  const namedLayer = new NamedObjectLayer(appContainer, scene);
  hud.shouldSuppressClick = (e) => namedLayer.hitTest(e.clientX, e.clientY) !== null;

  // 3c. Camera passthrough AR shell
  const arMode = new ARMode(appContainer, scene);
  hud.onEnterAR = () => arMode.enter();

  // 3d. Two-handed sky control. AR only: it borrows the passthrough stream, and
  //     its control lives in the AR dock because the HUD is hidden in AR.
  const gestures = new SkyGestures(scene);
  gestures.onStateChange = (state) => arMode.setGestureState(state);
  arMode.onExit = () => gestures.stop();
  // Flipping the AR camera swaps the stream under the gesture session.
  arMode.onCameraChange = (source) => gestures.useSource(source);

  arMode.onToggleGestures = async () => {
    if (gestures.active) {
      gestures.stop();
      return;
    }
    arMode.setGestureState({ loading: true });
    try {
      await gestures.start({
        target: arMode,
        stream: arMode.stream,
        mirrored: arMode.isMirrored,
        preview: arMode.handPreview
      });
    } catch (err) {
      arMode.setGestureState({ active: false });
      alert(`Gesture control unavailable: ${err?.message ?? err}`);
    }
  };

  hud.onCatalogLoaded = (loaded) => {
    namedLayer.setDataset(loaded);
    window.__SDSS_APP__.catalog = loaded; // keep the debug handle on the live catalog
  };

  // 4. Generate Authentic SDSS DR18 Galaxy & Quasar Dataset (240,000 objects)
  console.log("Generating SDSS DR18 Galaxy & Quasar catalog...");
  const startTime = performance.now();
  const catalog = generateSDSSCatalog(240000);
  console.log(`Generated ${catalog.count.toLocaleString()} objects in ${(performance.now() - startTime).toFixed(1)} ms.`);

  // Expose for debugger / user exploration in console. Assigned before the
  // first mount so the onCatalogLoaded hook has somewhere to write.
  window.__SDSS_APP__ = {
    scene,
    controller,
    hud,
    namedLayer,
    arMode,
    gestures,
    catalog
  };

  // 5. Mount through the HUD so it owns the dataset it falls back to when the
  //    SIMBAD push button is switched off.
  hud.loadCatalog(catalog, 'SDSS DR18');

  // 6. Start high-precision Animation Loop
  let lastTime = performance.now();

  function animate(now) {
    requestAnimationFrame(animate);

    const deltaMs = now - lastTime;
    lastTime = now;
    const deltaTime = Math.min(deltaMs * 0.001, 0.1); // Clamp max delta to 100ms

    // Advance one-by-one plotting engine
    controller.update(deltaTime);

    // Hands steer the sky before the frame is drawn
    gestures.update(deltaTime);

    // Render Three.js scene & update camera damping/flight
    scene.update(deltaTime);

    // Reproject named object labels against the camera just rendered
    namedLayer.update();
  }

  requestAnimationFrame(animate);
});
