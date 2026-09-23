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
populated (1,371 objects: 198 local, 1,173 deep). Phase 3a (the Milky Way and
the Solar System) has its base in place and will get more detail; Phase 4
comes after it.

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
| 3a | Milky Way, name search, Solar System: moons, belts, dwarf planets, comet, real sky, cards, travel | Done; Solar System not yet reachable from AR |
| 4 | Visual & UX polish: shaders, mobile point budget, AR-native HUD | Not started |

**Phase 3a notes.** The Milky Way was missing — only a 1 Mpc "Earth" sphere at
the origin, while its satellites (LMC, SMC, Sgr dSph) were all labelled. It is
now a procedural barred spiral in the true galactic plane around the true
centre, with the Sun (the origin) in the disc 8.2 kpc out, plus a named entry
so it labels, searches and opens a card. Zooming within ~0.12 Mpc of it shows
"Enter the Milky Way", which swaps the map for a Solar System: the Sun, eight
planets at today's positions on their real periods, inclinations and tilts,
real texture maps and Saturn's rings.

It is now dense enough to feel like travelling through a galaxy:
- **Getting there is a journey.** "Enter" plunges the map's camera toward the
  Sun as a wormhole opens over it, then flies the tunnel at hyperspeed from a
  ship's bridge: warnings every 0.8 s, alarms, a velocity readout, the real
  distance to the Sun counting down, hull integrity falling, synthesised engine
  and alarm sound, and a spoken callout on entry and exit. It exits in a
  white-out into the Solar System's approach from outside the Oort Cloud, with
  stars streaking past as it eases in to the planets. The Solar System loads
  during the trip. Leaving rises back out.
- **Contents.** 21 major moons (log-compressed orbits, in their planet's
  equatorial plane, tidally locked), Ceres, Pluto + Charon, Haumea (stretched),
  Makemake, Eris and Halley's Comet on real eccentric orbits solved from
  Kepler's equation (the comet grows a coma, an ion tail and a curved dust tail
  inside ~5 AU — jump to 2061 to see it), the asteroid belt with its Kirkwood
  gaps, Jupiter's Trojans, the Kuiper Belt, zodiacal dust and a (not to scale)
  Oort Cloud.
- **The real sky.** The Milky Way band lies along the true galactic plane, with
  the core glow in Sagittarius and the Great Rift; nebulae (Orion, Carina,
  Lagoon, Eagle), galaxies (Andromeda, both Magellanic Clouds), the Pleiades
  and nearby/bright stars sit at their real directions.
- **Motion.** Stars stretch into streaks by the camera's real speed and
  direction, and interplanetary dust drifts past the camera.
- **Detail cards** for every named thing (tap a label or a body); a Grand tour
  flies Sun → Kuiper Belt stopping at each world; time runs at pause, 1×, 10× or
  100× (1× = one Earth year every 30 s) from today's date.

Still to do: make the Solar System reachable from AR, and photographic maps for
the moons and dwarf planets (only the Sun and planets have them; Wikimedia kept
rate-limiting the Moon's).

**Phase 3 notes.** Modelled on the Moon Knight sky-turning shot the owner
supplied: open palms raised, the celestial sphere swinging past a stationary
viewer, and stars stretching into streaks as it picks up speed. Sweeping for a
second turns about 40 degrees and then coasts through another 50 as it winds
down — most of the movement happens after the hands stop, and that lag is the
whole feel. Tuning lives in the constants at the top of `SkyGestures.js`
(`YAW_GAIN`, `STATIC_BREAKAWAY`, `KINETIC_BREAKAWAY`, `SPIN_UP`,
`RELEASE_DECAY`, `ZOOM_GAIN`, `TRAIL_FULL_SPEED`) — but read the preview's
metrics line before changing any of them. It only renders with `?debug` in the
URL; end users get the captions, which say what to do next.

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
- **No chat session links in the repo.** Commits, PR descriptions and comments
  never carry a `claude.ai/code/session_…` URL or a `Claude-Session:` trailer:
  the owner does not want their chats reachable from GitHub. `main`'s history
  was rewritten once to strip them; do not add them back.
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
  ui/notify.js               Non-blocking notices; use instead of alert()
  ui/search.js               Name/ID matching behind the header's Search
  data/milkyWay.js           Galactic frame constants and the Milky Way entry
  rendering/MilkyWayModel.js Procedural Milky Way point model at the centre
  solar/MilkyWayPortal.js    Easter-egg button, the dive, galaxy <-> Solar System
  solar/Wormhole.js          The trip: tunnel shader, ship's bridge, synthesised sound
  solar/SolarSystem.js       Lazy-loaded scene: bodies, labels, cards, tour, time
  solar/data.js              Every body's elements, sizes and card facts; scaling
  solar/kepler.js            Kepler's equation for the eccentric orbits
  solar/sky.js               Real sky (band, nebulae, stars), warp shader, dust
  solar/belts.js             GPU Keplerian belts: asteroids, Trojans, Kuiper, Oort
  solar/textures.js          Procedural surfaces and sky sprites
  solar/BodyCard.js          The docked detail card
  controller/PlottingController.js  Progressive "plot one by one" engine
public/textures/solar/       Planet maps (CC BY 4.0, see CREDITS.md there)
```

Two catalog builders feed the same GPU buffers: `generateSDSSCatalog` makes the
procedural cloud (noise-based cosmic web with a hand-placed Boötes Void and
Sloan Great Wall), and `buildCatalog(records)` maps real `{ra, dec, z, isQSO}`
rows from SIMBAD or CSV. **Both append the named objects** at the tail of the
buffers at true coordinates, so names survive any catalog swap. Each entry in
`catalog.named` carries the `pointIndex` of its point.

`HUD.loadCatalog` is the single choke point for swapping datasets, and fires
`onCatalogLoaded` so the label layer rebinds. It restarts the plot from zero,
playing. `main.js` owns the wiring hooks: `hud.onCatalogLoaded`,
`hud.onEnterAR`, `namedLayer.onFlyTo` (AR re-anchors instead of flying), and
the AR/gesture callbacks. It also wraps startup and the frame loop in an error
boundary that reports on the boot screen rather than leaving a black page.

## Gotchas

- **Spawn orders are ranks, `(rank + 1) / n`, not min-max scaled keys.** The
  shader draws a point once `aSpawnOrder <= uPlotProgress`, so with ranks a
  progress of k/n puts exactly k points on screen. The old min-max scaling kept
  each key's own distribution, which made the plotted count, "points per
  second" and every telemetry figure fiction. `rankOrder` in `sdssGenerator.js`
  is a bucketed O(n) rank; keep using it for any new order.
- **`aSpawnOrder` owns its buffer.** `setPlottingOrder` copies an order into
  it, and it used to alias `catalogData.orders.redshift`, so the first switch
  overwrote the redshift order for good.
- **Telemetry is an O(n) scan over the plotted set**
  (`PlottingController.notifyProgress`): counts, the redshift frontier and the
  histogram all apply the shader's own test. It is throttled while playing;
  anything that changes state passes `force` so the HUD is never left stale
  (the play button used to read "Pause" after the plot had finished).
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
  range is 0.00–0.30, so most quasars are invisible until the filter is widened;
  the Quasar Dawn preset widens it itself. Check both before suspecting
  position. `NamedObjectLayer.isDrawn` applies the same two tests, so a label
  never names a point that is not on screen.
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
- `controls.minDistance` is 0.03 Mpc, lowered in steps from 5.0 so first the
  Local Group and then the Milky Way (0.03 Mpc across) can fill the view, and
  the camera's near plane is 0.002 to match — each time it lagged, whatever you
  flew in to see was clipped. The coordinate rings do not write depth, because
  depth is coarse that far out. `ARMode.MIN_DISTANCE` matches it for the same
  reason: at its old value of 5 Mpc, entering AR near Andromeda snapped the map
  back out.
- **The Milky Way is hand-placed, like the Boötes Void.** SIMBAD gives it no
  redshift and no distance, so `milkyWayObject()` in `data/milkyWay.js` builds
  its entry from the galactic frame and `getNamedObjects` appends it; do not
  add it to `namedObjects.json`. Entries may carry `typeLabel`, `note` and
  `viewDistance` to override the card text and the fly-to distance.
- **Scale-dependent furniture updates every frame** (`updateLocalScale`). The
  Earth beacon is a 1 Mpc sphere that swallowed the whole Milky Way up close,
  so it now shrinks with the camera's distance to stay a dot. The Milky Way
  model fades out beyond ~4 Mpc and is then not drawn: far away its 42k
  additive points collapse onto one pixel and glare.
- **The frame loop draws the galaxy map or the Solar System, never both.** The
  Solar System borrows the renderer and canvas but has its own scene, camera
  and OrbitControls. On entry `MilkyWayPortal` disables the map's controls,
  sets `namedLayer.suspended` (hidden labels must not take clicks) and adds
  `.solar-active`, which hides the HUD; HUD shortcuts and double-click zoom
  ignore input under it as they do in AR. Esc or the Back button leaves.
- **The Solar System is compressed, on purpose and by power laws**
  (`displayRadius`, `displayOrbit`, `spinSeconds`): at true scale every planet
  is sub-pixel. Positions are not invented — planets start at their mean
  longitudes for today from J2000 elements and keep real relative periods.
  Retrograde spin is expressed by the tilt (Venus 177°, Uranus 98°), never by a
  negative day as well, which would cancel out. Saturn's rings are unlit: the
  Sun grazes the ring plane and a lit ring came out black.
- **One frame for everything in the Solar System**: ecliptic in the XZ plane,
  ecliptic north on +Y, longitude 0 (the vernal equinox) on +X, and a body at
  longitude λ sits at `(cos λ, 0, −sin λ)`. Planets (node → inclination →
  circle), eccentric bodies, the GPU belts and the sky all use it — the sky
  converts RA/Dec through the obliquity and galactic (l, b) through
  `galacticBasis()`. Mix conventions and the Trojans leave Jupiter, or Orion
  turns up in the wrong place.
- **A retrograde orbit is an inclination over 90°** (Triton 157°, Halley 162°),
  exactly as a retrograde spin is a tilt over 90°. A negative period on top
  cancels it — Triton briefly orbited forwards that way.
- **The belts move on the GPU.** `belts.js` stores each particle's orbit and
  the vertex shader places it from `uYears`, so 22k particles cost nothing on
  the CPU. The Trojans start at Jupiter's own mean longitude ±60° and share its
  period; derive `jupiterStart` from the same elements the planet uses.
- **The sky group and the dust follow the camera.** The sky sits at
  `SKY_RADIUS` around the camera with sprite sizes set as angles, so it stays
  at infinity at any zoom. Dust lives in a box that wraps around the camera in
  the shader (`mod`), so there is always some to fly through. Neither shows
  motion by itself; the warp does: `updateWarp` measures the camera's real
  speed and heading each frame and the star/dust shaders streak along it.
- **The wormhole borrows the map's renderer, and the frame from it.** While
  its mouth opens it is drawn over the map just rendered (`autoClear` off);
  once it covers the screen `portal.ownsFrame` is true and the frame loop stops
  drawing the map. `.warp-active` hides the HUD and labels and silences the
  shortcuts for the trip, like `.solar-active` after it.
- **The trip's audio context is made in the click** (`portal.unlockAudio`): iOS
  only lets audio start inside a user gesture, and by the time the lazy
  `Wormhole.js` has loaded that gesture is over. Every sound is synthesised with
  Web Audio (the output peaks at ~0.7, measured); the callouts use
  `speechSynthesis`. The mute button's choice is kept in `localStorage`
  (`cosmoverse.sound`), and the context is suspended between trips.
- **Keep the trip photosensitive-safe.** The banner blinks at 1 Hz, the red
  vignette pulses more slowly, and there is exactly one white-out: well inside
  three flashes a second. Reduced motion stops the pulsing and slows the tunnel
  to a drift.
- **The white-out must not fade before the Solar System's first frame.** CSS
  opacity animates off the main thread, so a stall there (shader compilation)
  uncovered the last tunnel frame. `reveal` waits two animation frames, and
  `loadSolar` compiles the Solar System's shaders during the trip —
  `compileAsync` only where `KHR_parallel_shader_compile` exists, because three
  logs a warning when asked without it.
- **The Milky Way model has its own point shader** capped at a few pixels and
  fading within ~2 kpc of the camera. With `PointsMaterial` the dive into the
  disc filled the screen with sprites hundreds of pixels wide.
- **Labels declutter by priority** (Sun, planets, dwarfs, comet, regions,
  moons, sky) and moons only get one near their planet. Tap-to-pick is a
  raycast against body meshes that fires only if the pointer moved under 6px,
  so dragging to orbit never selects.
- **Planet maps are CC BY 4.0 and must stay credited** — in the Solar System's
  corner and in `public/textures/solar/CREDITS.md`. They came from Wikimedia
  Commons, not solarsystemscope.com, which serves a captcha to scripts (do not
  route around it). Commons' API rate-limits this sandbox's IP; direct
  `upload.wikimedia.org` paths are derived from the MD5 of the file name. Any
  map that is missing falls back to a procedural surface, so a 404 degrades
  rather than breaks. Moons, dwarf planets, rings, the sky sprites and the
  starfield are procedural (`textures.js`) and painted with each body's known
  features. The credit stays visible on phones — the hint line is what goes.
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
- **Never centre an absolutely positioned box with `left: 50%` + translate.**
  Its shrink-to-fit width is capped at the space right of `left`, i.e. half
  the screen: the AR dock stacked into three rows and notices squeezed into a
  column. Use `left: 0; right: 0; margin: 0 auto; width: fit-content`.
- **Grid tracks that hold wide content need `minmax(0, 1fr)`.** A plain `1fr`
  grows to its content's min-content, and the unwrapped landmark nav pushed the
  whole HUD 1,400px wide on a phone, AR button included.
- **There is no global `.hidden` rule.** Each component declares its own
  (`.ar-layer.hidden`, `.named-card.hidden`, …). The hand preview had none and
  showed an empty box in AR the whole time gestures were off.
- **Do not use `alert()`.** It blocks the render loop and, in AR, the camera
  feed and hand tracking. Use `notify()` from `ui/notify.js`, which lives on
  `<body>` so it shows in AR too. The CSV dialog keeps its errors inline.
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
  is what makes the gesture usable one-person, so switching gestures on flips
  to it (Flip still goes back).
- **`facingMode` comes from the track, not the request.** `ideal` is only a
  preference, and a one-camera device hands back what it has; trusting the
  request gave rear-only phones a mirrored feed and reversed gestures. Cameras
  that report nothing (most laptop webcams) keep the requested label.
- **Without a motion sensor OrbitControls owns the AR camera**, so
  `ARMode.orbitBy` delegates to `GalaxyScene.orbitBy` and Recentre puts the view
  back on the anchor. Moving the anchor there snapped back on the next update.
- **MediaPipe is loaded on demand.** `SkyGestures.start` dynamically imports
  `HandTracker.js`, which keeps ~155 kB out of the main bundle; `HandPreview`
  carries its own copy of the 21-point topology for the same reason. The
  tracker (and the downloaded model) is kept across gesture toggles — only a
  failed start closes it. Stopping during a start (leaving AR while the model
  downloads) cancels it quietly.
- **The GPU delegate can fail on some phones**; `HandTracker.load` falls back
  to the CPU delegate before giving up.
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
- **Tune against the on-screen numbers, not adjectives.** With `?debug` in the
  URL the preview's second line shows the measured gap, the speed the hand is
  demanding, and the speed the sky is turning (`50ms  ask 1.6  sky 1.3`). Measured at a realistic 50ms
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
  the strict `OPEN_ENTER`, which reads as the gesture refusing to arm. Only
  `reset()` clears it, and only between gesture sessions (start, stop, close).
- **`uTrailAmount` at 0 must reproduce the original round star exactly.** The
  vertex stage grows the sprite by `1 + uTrailAmount * 5` and the fragment stage
  divides its sampling by the same factor, so the star keeps its width and only
  gains length. Additive blending piles stretched sprites up in the dense wedge,
  which is why alpha is scaled by `inversesqrt(widen)`.

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
`namedLayer`, `arMode`, `gestures`, `portal`, `catalog`), which is enough to place the camera, force
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
property, which the preview call reads, and a `reset()`, which `stop()` calls.
In this sandbox a real `start()` fails at the model download with a notice;
that failure path is itself worth checking after gesture changes. Reset `gestures.nextDetectAt = 0` before each
`update(dt)` so every step reads the stub. That covers the whole motion model —
engagement, inertia, spread-to-distance and the trail uniforms — and leaves only
MediaPipe itself untested. For the trails alone, set `scene.uniforms.uTrailAmount`
and `uTrailDir` directly and screenshot. The hand preview draws from whatever
you hand it: `arMode.handPreview.draw({ video, hands: [{points, role}], engaged,
mirrored })` with 21 synthetic normalised points per hand renders the full
skeleton without MediaPipe.

To reach the Solar System, search "Milky Way" (it flies to 0.077 Mpc, inside
the portal's 0.12 range) and click `.portal-btn`; `portal.active` flips after
the wormhole trip. `portal.wormhole` exposes `phase` (`open`, `cruise`, `exit`),
`t`, `covers` and `loaded`, and a tap once loaded skips to the exit. Its clock
runs on the frame loop's clamped `dt`, so under SwiftShader a 5.7 s trip takes
~12 s of wall time. To measure the sound, connect an `AnalyserNode` to
`portal.wormhole.sound.out`. A tap on the canvas skips the arrival. Drive it through
`portal.solar`: `select(byName.get('Jupiter'))` flies there and opens its card,
`setSpeed(100)` changes time, and setting `years` jumps the clock (years since
entry — set it so `START_YEAR + years` is 2061.5 to catch Halley at
perihelion). Solar labels ride their bodies, so Playwright's stability check
never settles on them — click them through `page.evaluate`.

Two traps when asserting on labels. `layoutLabels` re-runs every frame, so
measure a label's position immediately before clicking it rather than reading
all of them up front, and allow ~1.5s after moving the camera for OrbitControls
damping to settle or the label set is still changing. A selection also opens the
detail card over part of the screen, and `isInteractiveTarget` deliberately
swallows clicks that land on it, so clear the selection between assertions.
