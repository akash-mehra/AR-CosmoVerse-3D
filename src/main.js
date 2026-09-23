import './style.css';
import { GalaxyScene } from './rendering/GalaxyScene.js';
import { PlottingController } from './controller/PlottingController.js';
import { HUD } from './ui/HUD.js';
import { NamedObjectLayer } from './ui/NamedObjectLayer.js';
import { ARMode } from './ar/ARMode.js';
import { SkyGestures } from './ar/SkyGestures.js';
import { generateSDSSCatalog } from './data/sdssGenerator.js';
import { notify } from './ui/notify.js';
import { MilkyWayPortal } from './solar/MilkyWayPortal.js';

const bootScreen = document.getElementById('boot-screen');

/** Replaces the page with a message: better than a black screen that says nothing. */
function fail(message, err) {
  console.error(message, err);
  if (!bootScreen) return;
  bootScreen.hidden = false;
  bootScreen.classList.remove('done');
  bootScreen.classList.add('failed');
  bootScreen.textContent = `${message} ${err?.message ?? ''}`.trim();
}

function start() {
  const appContainer = document.getElementById('app');
  if (!appContainer) return;

  // 1. Initialize 3D Scene and Renderer
  let scene;
  try {
    scene = new GalaxyScene(appContainer);
  } catch (err) {
    fail('This map needs WebGL, which this browser or device has turned off.', err);
    return;
  }

  // 2. Initialize One-by-One Plotting Controller
  const controller = new PlottingController(scene);

  // 3. Initialize Glassmorphic HUD & Histogram
  const hud = new HUD(appContainer, controller, scene);

  // 3b. Labels & detail card for real catalogued objects
  const namedLayer = new NamedObjectLayer(appContainer, scene);

  // Search hands back a named object: select it, widen nothing else, fly there.
  hud.searchObjects = () => namedLayer.objects;
  hud.onSearchPick = (obj) => {
    namedLayer.select(obj);
    namedLayer.flyTo(obj);
  };

  // 3b'. Easter egg: zoom into the Milky Way and a way into the Solar System opens.
  const portal = new MilkyWayPortal(appContainer, scene, namedLayer);

  // 3c. Camera passthrough AR shell
  const arMode = new ARMode(appContainer, scene);
  hud.onEnterAR = () => arMode.enter();
  // In AR the device aims the camera, so "Fly to object" moves the map instead.
  namedLayer.onFlyTo = (target, distance) => {
    if (!arMode.active) return false;
    arMode.focusOn(target, distance);
    return true;
  };

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
      // Nobody can watch the screen while gesturing at the rear camera, so
      // gestures bring up the selfie one. Flip stays available to go back.
      if (!arMode.isMirrored && await arMode.flipCamera()) {
        notify('Switched to the front camera so you can see the sky while you gesture.');
      }
      await gestures.start({
        target: arMode,
        stream: arMode.stream,
        mirrored: arMode.isMirrored,
        preview: arMode.handPreview
      });
    } catch (err) {
      arMode.setGestureState({ active: false });
      notify(`Gesture control unavailable: ${err?.message ?? err}`, { error: true });
    }
  };

  hud.onCatalogLoaded = (loaded) => {
    namedLayer.setDataset(loaded);
    window.__SDSS_APP__.catalog = loaded; // keep the debug handle on the live catalog
  };

  // 4. Procedural SDSS-style catalogue (240,000 objects) plus the named objects
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
    portal,
    catalog
  };

  // 5. Mount through the HUD so it owns the dataset it falls back to when the
  //    SIMBAD push button is switched off. Labelled as what it is.
  hud.loadCatalog(catalog, 'SYNTHETIC');

  // 6. Animation loop
  let lastTime = performance.now();

  function animate(now) {
    const deltaMs = now - lastTime;
    lastTime = now;
    const deltaTime = Math.min(deltaMs * 0.001, 0.1); // Clamp max delta to 100ms

    try {
      if (portal.ownsFrame) {
        // Inside the Solar System or the wormhole: the galaxy map is paused, not drawn.
        portal.update(deltaTime);
      } else {
        // Advance one-by-one plotting engine
        controller.update(deltaTime);

        // Hands steer the sky before the frame is drawn
        gestures.update(deltaTime);

        // Render Three.js scene & update camera damping/flight
        scene.update(deltaTime);

        // Reproject named object labels against the camera just rendered
        namedLayer.update();

        // Offer the way into the Milky Way once the camera is close enough
        portal.update(deltaTime);
      }
    } catch (err) {
      // A frame that throws will throw every frame; stop and say so rather
      // than flood the console behind a frozen picture.
      fail('The map stopped because of an unexpected error. Reload to try again.', err);
      arMode.exit(); // release the camera
      return;
    }

    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
  if (bootScreen) {
    bootScreen.classList.add('done');
    bootScreen.addEventListener('transitionend', () => { bootScreen.hidden = true; }, { once: true });
  }
}

// Let the boot screen paint before the catalogue build blocks the main thread.
requestAnimationFrame(() => requestAnimationFrame(() => {
  try {
    start();
  } catch (err) {
    fail('The map could not start.', err);
  }
}));
