# AR-CosmoVerse-3D — working context

Three.js / WebGL map of an SDSS-style survey, being extended into a
gesture-controlled AR experience. Vanilla JS + Vite, no framework.

```bash
npm install
npm run dev          # http://localhost:5173
npm run build
npm run fetch:named  # rebuilds src/data/namedObjects.json from SIMBAD TAP
```

## Where the project stands

Phases 1 to 3 are code complete, and `src/data/namedObjects.json` ships
populated (1,371 objects: 198 local, 1,173 deep). Phase 4 is next.

Phase 3's gesture vocabulary has been decided and built, so it is no longer an
open question: the right palm held open anchors, the other hand sweeps, and the
sky keeps turning after the hands drop. Pulling **both** hands apart or together
zooms. **Gestures run in AR only**, and their control lives in the AR dock.

**`simbad.cds.unistra.fr` is reachable.** An earlier note here claimed the
egress policy blocked it with a 403 at the proxy CONNECT; that was wrong.
`/capabilities` and `sim-tap/sync` both return 200, `npm run fetch:named` runs
against the live service, and the "Load SIMBAD" button works. Check before
assuming otherwise:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://simbad.cds.unistra.fr/simbad/sim-tap/capabilities
```

If it ever does return 403, report it rather than routing around it. On
Node >= 22.21 behind the agent proxy, global `fetch` ignores `HTTPS_PROXY`
unless `NODE_USE_ENV_PROXY=1` — `npm run fetch:named` needs that prefix here.

## Roadmap

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Named objects: catalogue data, zoom-gated labels, detail card | Done, dataset populated |
| 2 | AR shell: camera passthrough + device-orientation look-around | Done |
| 3 | Gesture control: two-handed sky turning, inertia, star trails | Done, untested on a real device |
| 4 | Visual & UX polish: shaders, mobile point budget, AR-native HUD | Not started |

**Phase 3 notes.** Modelled on the Moon Knight sky-turning shot the owner
supplied: open palms raised, the celestial sphere swinging past a stationary
viewer, and stars stretching into streaks as it picks up speed. Sweeping for a
second turns about 40 degrees and then coasts through another 50 as it winds
down — most of the movement happens after the hands stop, and that lag is the
whole feel. Tuning lives in the constants at the top of `SkyGestures.js`
(`YAW_GAIN`, `STATIC_BREAKAWAY`, `KINETIC_BREAKAWAY`, `SPIN_UP`,
`RELEASE_DECAY`, `ZOOM_GAIN`, `TRAIL_FULL_SPEED`) — but read the preview's
metrics line before changing any of them.

The AR dock carries the gesture toggle, a 🔄 Flip control (gesturing at the
rear camera means not being able to see the screen), Recentre and Exit. A hand
preview sits top-left showing the camera frame with the landmarks and skeleton
drawn over it — without it a gesture that will not arm gives you nothing to go
on, since a hand out of frame and a palm read as closed look identical.

**Arming was the first thing real hands broke.** Detection itself was fine —
the skeleton tracked in real time — but going gold and starting to scroll
lagged badly, from four compounding causes, all in this repo rather than in
MediaPipe: `OPEN_ENTER` at 1.85 sat right on top of a real open palm (~1.9);
both hands had to be open when only the anchor should pose; hysteresis was
wiped on every one-hand frame, which detection produces constantly; and the
velocity chase needed ~215ms to reach the hand's speed. If arming still feels
slow, the preview caption now prints the anchor's measured openness against the
threshold — read it before changing anything.

Still open: no real hand has been tracked *here*. The sandbox browser cannot
reach HTTPS, so MediaPipe has never downloaded in this environment. Test on the
deploy preview.

**Phase 4 notes.** The desktop HUD is entirely hidden in AR right now
(`.ar-active .hud-container { display: none }`) and replaced by a three-control
dock. Phase 4 should give AR real controls. Also worth revisiting: the camera
FOV is not matched to the device camera's FOV, which weakens the illusion, and
`onResize` would fight any fixed value.

### Decisions already made — do not re-litigate

- Both object tiers, zoom-gated (nearby galaxies *and* map-scale structures).
- Named-object data comes from SIMBAD, not a hand-curated list.
- Labels auto-declutter by zoom rather than always-on or tap-only.
- AR is **model-locked**, not sky-locked: the map floats as an object you look
  around, and orientation aims the camera. Sky-locking (mapping alt/az to
  RA/Dec so the map matches the real sky) was considered and deferred — it
  needs geolocation plus local sidereal time and only works outdoors.
- Phone testing happens via **deploy previews**, so there is deliberately no
  HTTPS dev-server setup in this repo. `getUserMedia` needs a secure context,
  so AR will not work from a plain `http://` LAN address.

## Architecture

```
src/
  cosmology/planck18.js      Planck 2018 distances/lookback via a lookup table
  data/sdssGenerator.js      Procedural catalogue, buildCatalog, named injection
  data/simbadSource.js       Runtime SIMBAD TAP client ("Load SIMBAD")
  data/namedObjects.js       Loads namedObjects.json, projects it into Mpc space
  data/namedObjects.json     Generated by scripts/fetchNamedObjects.mjs
  rendering/GalaxyScene.js   Renderer, camera, OrbitControls, uniforms, flights
  rendering/shaders/         galaxy.vert / galaxy.frag — the point cloud
  ar/ARMode.js               Camera passthrough, device orientation, AR dock
  ar/HandPreview.js          Picture-in-picture of what the tracker sees
  ar/HandTracker.js          MediaPipe hand landmarks -> anchor/driver reading
  ar/SkyGestures.js          Gesture -> angular velocity, inertia, star trails
  ui/HUD.js                  Glassmorphic panels, histogram, CSV/SIMBAD loading
  ui/NamedObjectLayer.js     Label projection, declutter, picking, detail card
  controller/PlottingController.js  Progressive "plot one by one" engine
```

Two catalog builders feed the same GPU buffers: `generateSDSSCatalog` makes the
procedural cloud (noise-based cosmic web with a hand-placed Boötes Void and
Sloan Great Wall), and `buildCatalog(records)` maps real `{ra, dec, z, isQSO}`
rows from SIMBAD or CSV. **Both append the named objects** at the tail of the
buffers at true coordinates, so names survive any catalog swap. Each entry in
`catalog.named` carries the `pointIndex` of its point.

`HUD.loadCatalog` is the single choke point for swapping datasets, and fires
`onCatalogLoaded` so the label layer rebinds. `main.js` owns the wiring hooks:
`hud.shouldSuppressClick`, `hud.onCatalogLoaded`, `hud.onEnterAR`.

## Gotchas

- **The renderer needs `alpha: true`** in its constructor or nothing can show
  through the canvas, no matter what clear-colour alpha is set. This was
  `false` originally, which silently broke both the "Alpha BG" toggle and any
  camera passthrough.
- **`GalaxyScene.update` has a `cameraDriver` seam.** When set, it is called
  instead of the auto-orbit / camera-flight / `controls.update()` path, then the
  frame renders. AR uses it because `OrbitControls.update()` recomputes the
  camera from its own state every frame and would overwrite an
  orientation-driven quaternion — note that `controls.enabled = false` alone
  does *not* stop that, it only gates input.
- **The vertex shader hides points two ways**: `aSpawnOrder > uPlotProgress`
  (the plotting animation) and `aRedshift` outside `[uMinZ, uMaxZ]`. The default
  range is 0.00–0.30, so most quasars are invisible until the filter is widened.
  Check both before suspecting position.
- **Nearby galaxies have negative redshift** (M31 is about -0.001), which the
  redshift filter would clip. `namedObjects.js` stores a clamped `filterZ` for
  the attribute while the card shows the true value. Keep that split.
- **Nearby objects cannot be placed by redshift at all** — peculiar velocity
  dominates. They carry `tier: "local"` and a measured `distMpc`, projected with
  `raDecDistToCartesian`. `LOCAL_MAX_MPC` (50) is both the placement boundary
  and the label-tier switch.
- **SIMBAD CHAR columns come back space-padded.** `mesDistance.unit` is
  `'Mpc '` / `'kpc '`, not `'Mpc'` / `'kpc'`. ADQL `unit IN ('Mpc','kpc')`
  still matches because the server pads the literal, so the bug only shows up
  in JavaScript — an untrimmed `row.unit === 'kpc'` silently read every kpc
  distance as Mpc and placed Milky Way satellites 1000x too far out. Trim
  before comparing.
- **Object type codes are the short `otype` form, and some are lower case.**
  A void is `vid`, not `Void`. Also note the SIMBAD hierarchy puts QSO under
  Galaxy, so anything selecting galaxies has to subtract the quasar types
  rather than assume they are disjoint. Seyferts and AGN are galaxies, not
  quasars — only `QSO`/`BLL`/`Bla`/`QSO_Candidate` set `isQSO`.
- **Boötes Void and the Sloan Great Wall cannot be labelled from SIMBAD.**
  Boötes Void carries no redshift and no `mesDistance` row, and the Sloan Great
  Wall's `otype` is `?`. The camera presets for them come from the hand-placed
  constants in `sdssGenerator.js`, and no SIMBAD query will put a label there.
- **A label's click target is its own rectangle, not its point.** The label
  renders a leader's length (`LABEL_LEADER_PX`) above the point it names, well
  outside `HIT_RADIUS_PX`, so `NamedObjectLayer.layoutLabels` records the
  rendered rect in `labelHits` and `hitTest` checks those before falling back
  to the point-radius search. Keep the transform and the recorded rect in step.
- **`.glass-card` sets `transition: all 0.35s`.** Anything anchored to a moving
  world position must override it or it visibly lags the camera.
- `.ar-layer` deliberately has no `z-index`, so it does not create a stacking
  context and the video can sit behind the canvas (z-index 0 vs 1) while the
  dock sits above it (z-index 20). The vignette (`.ar-layer::after`) exploits
  the same thing: equal z-index to the video, so DOM order puts it over the
  feed while the canvas still paints over both.
- **The passthrough is dimmed, and it has to be.** The point cloud is additive
  over the camera feed, so whatever the camera sees sets the floor the faintest
  stars must clear. A lit room behind the selfie camera buries them — measured
  on a bright feed, dimming halves mean screen luminance and stars that were
  invisible become crisp. `.ar-video` carries a `data-facing` attribute so the
  rear camera (pointed at a dark sky) gets a gentle `brightness(0.5)` and the
  front one a hard `brightness(0.24) saturate(0.3)`. Keep the filters cheap:
  no blur, which costs real time full-screen on a phone.
- **CSS filters on the `<video>` do not affect `drawImage`.** The hand preview
  reads raw pixels, so it stays bright while the full-screen passthrough is
  dimmed — which is what lets you frame your hands in the preview without
  turning the dimming off. Do not "fix" this by filtering the preview canvas.
- `controls.minDistance` is 0.2, lowered from 5.0 so the Local Group (under
  1 Mpc) is reachable. `ARMode.MIN_DISTANCE` matches it for the same reason —
  at its old value of 5 Mpc, entering AR near Andromeda snapped the map back
  out and the local tier was unreachable in AR.
- **Anything that moves the camera around the map goes through `orbitBy`.**
  `GalaxyScene.orbitBy(dYaw, dPitch, scaleFactor)` swings the camera around the
  orbit target; `ARMode.orbitBy` has the same signature but swings the anchor
  direction instead, because in AR the device orientation aims the view and
  moving the camera itself would slide the view off the map. `SkyGestures` only
  ever talks to that seam, so it does not care which mode is running.
- **A selfie feed reverses two separate things.** MediaPipe reports the user's
  right hand as "Left", *and* moving that hand to the user's right walks it
  toward image-left. `HandTracker`'s `mirrored` flag undoes both — the
  handedness label via `anchorLabel`, the coordinates via `toUserFrame` — so
  downstream code always gets "x grows as the hand moves to the user's right".
  Fix only one and the two cameras disagree about which way a sweep turns the
  sky. `mirrored` follows the camera actually running (`ARMode.isMirrored`),
  never the mode: AR can be flipped to the selfie camera.
- **Gestures are AR-only, and that is why the control is in the AR dock.** The
  HUD is hidden wholesale in AR (`.ar-active .hud-container { display: none }`),
  so a gesture button in the header is unreachable exactly where it is needed —
  that was the original bug. `SkyGestures.start()` now requires a stream and
  refuses without one, and `main.js` binds `target: arMode`. Binding the target
  to the scene instead is the other half of that bug: AR's `cameraDriver`
  overwrites the camera every frame, so scene-targeted gestures do nothing
  visible.
- **The global `canvas` rule absolutely positions every canvas on the page.**
  `canvas { position: absolute; width: 100%; height: 100% }` exists for the
  WebGL surface, so any other canvas has to opt back into flow
  (`.ar-hand-canvas` sets `position: static`) or its parent collapses to
  nothing around it.
- **The AR dock wraps.** Four controls plus the status line overflow a phone on
  one row and `.dock-btn` does not shrink, so `.ar-dock` is `flex-wrap: wrap`.
  Its height therefore varies — do not anchor anything above it. The hand
  preview is top-left for that reason.
- **AR can flip cameras mid-session.** `ARMode.flipCamera()` swaps rear for
  front, stops the old stream, mirrors the `<video>` for a selfie view, and
  fires `onCameraChange`. Hand tracking borrows that stream, so `main.js`
  forwards the new one to `SkyGestures.useSource()`, which rebinds without
  reloading the model. The rear camera is the right default for looking at the
  sky, but you cannot watch the screen while gesturing at it — the front camera
  is what makes the gesture usable one-person.
- **The WASM URL in `HandTracker.js` is pinned to the `@mediapipe/tasks-vision`
  version in package.json.** The JS bundle and the WASM are released as a pair
  and a mismatch fails to instantiate, so bump both together. The model
  `.task` file is fetched from Google's CDN on first use — the button sits in a
  "Loading hands…" state while that happens, and there is no offline fallback.
- **Hand detection runs on its own clock** (`DETECT_INTERVAL_MS`, 30Hz), not per
  rendered frame — `detectForVideo` costs far more than a frame's budget.
  Velocity is integrated per render frame regardless, so the motion stays smooth
  between detections.
- **Never assume the interval between readings.** `HandTracker.read` returns
  null unless the camera frame has advanced, which is not in step with the
  render loop, so successful readings arrive irregularly — 33ms, 66ms, 100ms.
  `applySweep` used to divide the hand's displacement by a hard-coded 33ms,
  which demanded up to *three times* the speed the hand was actually asking
  for, by a factor that changed from reading to reading. That one line made the
  map both too fast and unpredictable. `readHands` now measures the gap and
  clamps it to `MIN_READING_GAP`..`MAX_READING_GAP`, so a stall cannot be read
  as one enormous shove. It also returns whether it got a frame, and `update`
  only charges the detection interval on a hit — advancing it on a miss threw
  away a whole slot and widened the gap further.
- **Tune against the on-screen numbers, not adjectives.** The preview's second
  line shows the measured gap, the speed the hand is demanding, and the speed
  the sky is turning (`50ms  ask 1.6  sky 1.3`). Measured at a realistic 50ms
  gap: a hand merely in shot demands ~0.14 rad/s, a wandering hand ~0.35, an
  unhurried but deliberate sweep ~0.86, a committed one ~1.6. `STATIC_BREAKAWAY`
  belongs between wandering and deliberate — it was 1.3, above every one of
  those, so real sweeps were being ignored.
- **Only the anchor palm has to be open.** The driving hand is sweeping, not
  posing; requiring it to be open too squared the chance of failing to arm.
- **The sky is a flywheel, not a cursor.** Velocity used to chase the hand with
  no threshold, so every twitch of a hand that was merely in shot moved the map.
  `applySweep` now computes torque as the gap between the speed the hand asks
  for and the speed the wheel has, takes a fixed Coulomb bite out of it
  (`STATIC_BREAKAWAY` at rest, the much smaller `KINETIC_BREAKAWAY` once
  turning), and converts what is left to speed at a rate capped by `SPIN_UP`.
  Verified: an identical ~1 rad/s demand is rejected from a standstill and
  accepted while turning. A consequence worth knowing — holding your hands
  still while armed *brakes* the wheel, because the demand is then zero and the
  torque points against the motion. Hands up grips it; hands down lets it
  freewheel.
- **Zoom is a two-handed pull, and it has to be.** Sweeping changes the distance
  between the hands too — the driver moves, the anchor does not — so separation
  alone cannot tell a pull from a sweep. `applyZoom` requires both hands to
  travel along the axis *between* them in opposite directions, which a sweep
  cannot fake, and returns true so the sweep is skipped that frame. The rate
  comes from a smoothed separation (`SEPARATION_SMOOTHING`): landmark noise
  satisfies the opposite-directions test on any given frame, and without
  smoothing pure jitter zoomed the map ~12%.
- **`ZOOM_GAIN` is an exponent, not a multiplier.** Distance ends up roughly
  proportional to hand separation, so 1.0 means doubling the gap between your
  hands doubles the distance. It was 1.6 briefly, which ran a single wide pull
  out 16x.
- **Never clear `wasOpen` on a partial reading.** Detection drops to one hand
  constantly, and resetting hysteresis there sends an already-open palm back to
  the strict `OPEN_ENTER`, which reads as the gesture refusing to arm. Only the
  constructor and `close()` reset it.
- **`uTrailAmount` at 0 must reproduce the original round star exactly.** The
  vertex stage grows the sprite by `1 + uTrailAmount * 5` and the fragment stage
  divides its sampling by the same factor, so the star keeps its width and only
  gains length. Additive blending piles stretched sprites up in the dense wedge,
  which is why alpha is scaled by `inversesqrt(widen)`.
- The README still oversells: there is no spectrum visualizer, and the "object
  inspector" it describes only exists for the named subset.

## Verifying UI changes

There is no test suite. Drive the real app — Chromium is preinstalled at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; install `playwright-core`
in a scratch directory (not into this project) and launch with
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --no-sandbox`.

For AR, add `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`
to auto-grant the camera and supply a synthetic feed, and drive orientation by
dispatching `new DeviceOrientationEvent('deviceorientation', {alpha, beta, gamma})`
on an interval — `ARMode` only attaches its listener after `getUserMedia`
resolves, so a single dispatch gets missed.

The app exposes `window.__SDSS_APP__` (`scene`, `controller`, `hud`,
`namedLayer`, `arMode`, `catalog`), which is enough to place the camera, force
the plot to complete (`controller.setInstantAll()`), widen the redshift filter,
enter AR and assert on DOM state. `catalog` is kept pointing at the live catalog
across swaps.

`namedObjects.json` is regenerated by `npm run fetch:named`, never edited by
hand — the data is supposed to come from SIMBAD.

Gestures can be exercised without a camera or the model. Set `gestures.active`,
point `gestures.target` at `arMode` (or the scene), stub `gestures.video` with
`{ readyState: 4, currentTime: 0 }` and replace `gestures.tracker` with an
object whose `read()` returns `{ partial: false, anchorOpen, driverOpen,
driver: {x, y}, anchor: {x, y}, spread, hands: [] }` — and give it a `mirrored`
property, which the preview call reads. Reset `gestures.nextDetectAt = 0` before each
`update(dt)` so every step reads the stub. That covers the whole motion model —
engagement, inertia, spread-to-distance and the trail uniforms — and leaves only
MediaPipe itself untested. For the trails alone, set `scene.uniforms.uTrailAmount`
and `uTrailDir` directly and screenshot. The hand preview draws from whatever
you hand it: `arMode.handPreview.draw({ video, hands: [{points, role}], engaged,
mirrored })` with 21 synthetic normalised points per hand renders the full
skeleton without MediaPipe.

Two traps when asserting on labels. `layoutLabels` re-runs every frame, so
measure a label's position immediately before clicking it rather than reading
all of them up front, and allow ~1.5s after moving the camera for OrbitControls
damping to settle or the label set is still changing. A selection also opens the
detail card over part of the screen, and `isInteractiveTarget` deliberately
swallows clicks that land on it, so clear the selection between assertions.
