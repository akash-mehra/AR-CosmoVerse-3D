import './style.css';
import { GalaxyScene } from './rendering/GalaxyScene.js';
import { PlottingController } from './controller/PlottingController.js';
import { HUD } from './ui/HUD.js';
import { NamedObjectLayer } from './ui/NamedObjectLayer.js';
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
  hud.onCatalogLoaded = (loaded) => {
    namedLayer.setDataset(loaded);
    window.__SDSS_APP__.catalog = loaded; // keep the debug handle on the live catalog
  };

  // 4. Generate Authentic SDSS DR18 Galaxy & Quasar Dataset (240,000 objects)
  console.log("Generating SDSS DR18 Galaxy & Quasar catalog...");
  const startTime = performance.now();
  const catalog = generateSDSSCatalog(240000);
  console.log(`Generated ${catalog.count.toLocaleString()} objects in ${(performance.now() - startTime).toFixed(1)} ms.`);

  // 5. Mount dataset into Scene and Controller
  scene.loadDataset(catalog);
  controller.setDataset(catalog);
  namedLayer.setDataset(catalog);

  // 6. Start high-precision Animation Loop
  let lastTime = performance.now();

  function animate(now) {
    requestAnimationFrame(animate);

    const deltaMs = now - lastTime;
    lastTime = now;
    const deltaTime = Math.min(deltaMs * 0.001, 0.1); // Clamp max delta to 100ms

    // Advance one-by-one plotting engine
    controller.update(deltaTime);

    // Render Three.js scene & update camera damping/flight
    scene.update(deltaTime);

    // Reproject named object labels against the camera just rendered
    namedLayer.update();
  }

  requestAnimationFrame(animate);

  // Expose for debugger / user exploration in console
  window.__SDSS_APP__ = {
    scene,
    controller,
    hud,
    namedLayer,
    catalog
  };
});
