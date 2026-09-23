# AR-CosmoVerse-3D — working context

Three.js / WebGL map of an SDSS-style survey, being extended into a
gesture-controlled AR experience. Vanilla JS + Vite, no framework.

```bash
npm install
npm run dev          # http://localhost:5173
npm run build
npm run fetch:named  # rebuilds src/data/namedObjects.json from SIMBAD TAP
npm run fetch:stars  # rebuilds public/data/stars/ from VizieR, SIMBAD, NASA
npm run fetch:textures  # rebuilds public/textures/bodies/ from NASA and the PDS
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
| 3b | Continuous scale: one zoom from the cosmic web down to the planets | Engine and nearby-stars layer done; a tour engine was built and pulled, to be revisited |
| 3c | Map data pipeline: `fetch:textures`, two sizes per map, manifest, credits, `VITE_TEXTURE_BASE` | Done: 15 bodies, 2K set 5.8 MB, 4K set 19.0 MB (16 files each, JPEG) |
| 3d | Planet detail: atmospheres, Earth clouds + night lights, the Moon's relief, photo maps for moons | Done: 18 bodies on spacecraft maps, 4 atmospheres, every card says where its surface comes from |
| 3e | Sharper maps near bodies: 4K in on approach, out on leaving, phones capped | Done: painted → 2K → 4K by size on screen, released on leaving; phones stop at 2K |
| 3f | Optional HD download: prompt with the real size, map cache, cache-first loading | Done: offered on entering the Solar System, 30.3 MB on desktop (2K + 4K), 7.0 MB on phones; no service worker |
| 3g | Landing on Earth: true-scale Earth layer, GIBS / Blue Marble to region level, a dormant Google 3D Tiles slot | Done: follow Earth and zoom from orbit to 250 km on GIBS tiles (~490 m a pixel); Google slot empty |
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

Still to do: make the Solar System reachable from AR. (Photographic maps for
the moons and dwarf planets came with 3c/3d, from NASA and the PDS.)

**Phase 3b notes.** The first step toward an "ultimate universe tour" (the
owner's goal): scales join up instead of cutting between scenes. Aim at the Sun
(the Earth Origin preset does) and keep scrolling: the map runs down through the
Milky Way to a few parsecs, where the Solar System fades in around the Sun and
takes the controls, and on in to the planets; scrolling out runs the same way
back. No button, no cut. It is built as layers so more can slot in. The gap
between ~3 pc and ~1 kpc is now filled with 63,000 real stars (Hipparcos,
with SIMBAD names and NASA's planet hosts), each as bright as it looks from
the camera; the Solar System's own sky is built from the same stars. A tour
engine (tours as data, narrated chapters) was built and then pulled by the
owner to be revisited later; it is in the history as #18.
Undecided and the owner's call: true scale versus cinematic compression, guided
versus free, phone-first versus desktop/VR, download budget, narration voice.

**Phases 3c–3g plan** (agreed with the owner; each ends at its "done when").
- **3c, map data pipeline.** Check USGS, NASA and GIBS through the proxy
  first. `npm run fetch:textures` downloads the Moon (LRO colour map and
  elevation), the Galilean and Saturnian moons, Pluto, Charon and Ceres, saves
  each at ~2K (everyday) and ~4K (close-up), and writes a manifest of files and
  sizes plus `CREDITS.md`. Record every map's licence and refuse a source
  without one: several well-known moon maps are enthusiasts' mosaics under
  their own terms. One setting, `VITE_TEXTURE_BASE`, says where maps live (the
  Vercel deploy by default), so a later move to other hosting is one line; a
  different origin must send CORS headers or WebGL cannot use the maps. Done
  when the manifest exists and the real download size is known. **Result:**
  15 bodies plus the Moon's normal map, 5.8 MB at 2K and 19.0 MB at 4K as
  JPEG (`public/textures/bodies/manifest.json`); the originals are ~2 GB.
  Nothing draws them yet — that is 3d.
- **3d, planet detail.** An atmosphere shader tuned from NASA fact-sheet values
  (Earth, Mars, Venus, Titan); Earth's cloud layer and night-side city lights
  (Blue and Black Marble); the Moon's LRO map with relief as a normal map
  derived at build time, not a displaced dense mesh; photo maps for Jupiter's
  and Saturn's moons. Surfaces no spacecraft saw stay procedural and are
  labelled as an artist's impression. Done when every body with real data uses
  it and the rest say so. **Result:** Earth (Blue Marble, Black Marble city
  lights on the night side, NASA clouds), the Moon (LRO colour + LOLA relief),
  Phobos, the four Galilean moons, seven Saturnian moons, Triton, Pluto,
  Charon and Ceres wear spacecraft maps; atmospheres on Earth, Mars, Venus and
  Titan. Deimos, the five Uranian moons and Halley have no global map in the
  archive, and Haumea, Makemake and Eris were never visited: their cards say
  "artist's impression".
- **3e, sharper maps near bodies.** 4K maps load on approach and unload on
  leaving; phones stay capped at what they can hold. A 4K RGBA map is ~90 MB
  of GPU memory with mipmaps whatever its file size, so the file format
  (JPEG/WebP versus KTX2, which needs a transcoder) sets whether that cap is
  2K or 4K. Done when flying up to any body sharpens it without a memory spike
  on a phone. **Result:** `BodyMaps` picks painted, 2K or 4K from each body's
  radius on screen (12 px, 400 px) with hysteresis, and disposes what a body
  no longer needs, so GPU memory returns to its baseline once the camera
  leaves. Phones and GPUs without 4096-pixel textures stop at 2K; files stay
  JPEG, as KTX2 was not needed for that.
- **3f, optional HD download.** On the way into the Milky Way, a prompt with
  the real size (Download / Not now, remembered). A service worker saves the
  maps to the Cache API with progress and cancel and asks for persistent
  storage; loading checks the cache first, so a partial download still helps.
  It caches map files only, never the page, or deploy previews go stale. Warn
  on metered or slow connections where the browser says so, "best on Wi-Fi"
  elsewhere. Whether maps are downloaded is judged from the cache, because iOS
  clears a site's storage after ~7 days without a visit (home-screen apps
  excepted): the user is simply asked again. Done when yes and no both give a
  working trip and a cancelled download still speeds things up. **Result:**
  the offer appears on entering the Solar System (by the wormhole or the
  zoom) with the size still to fetch: 2K + 4K on desktop (30.3 MB), 2K on
  phones (7.0 MB), matching `BodyMaps.top`. No service worker: the page reads
  the Cache API itself, so only map files can ever be cached. Verified: Not
  now is remembered, a cancelled download keeps its files and they load with
  no network request, and the offer comes back with only what is left.
- **3g, landing on Earth.** A true-scale Earth layer handed over from the
  Solar System's Earth, joined by a band like the map and the Solar System;
  NASA GIBS or Blue Marble imagery down to region level; an empty, inactive
  slot for Google Photorealistic 3D Tiles until its pricing is checked. When it
  is switched on, its key runs in the browser (restrict it to the site's
  domains), Google's attribution must show, and its tiles must stay out of the
  3f cache, which Google's terms forbid. Done when you can descend from orbit
  to region level with the Google slot ready. **Result:** following Earth,
  a zoom runs from the Solar System into a km-scale Earth (`src/earth/`)
  across a band 5–2.5 Earth radii out, and on down to 250 km, where GIBS's
  Blue Marble (level 7, ~490 m a pixel) is about two screen pixels. The
  Solar System's Earth map is now August 2004, the month GIBS serves, so the
  two agree. `googleTiles()` is the slot and returns null; nothing is fetched
  from Google and no key is read.
- **Still unplaced:** reaching the Solar System from AR (open since 3a). The
  Earth layer is a third layer AR cannot reach; decide whether AR gets there
  before Phase 4 or in it.
- **Parked:** the spaceship (a chase camera suggested, not confirmed); the
  tour; OpenStreetMap buildings, street view and a move to Cloudflare; the
  open decisions (true or cinematic scale, guided or free, phone or
  desktop/VR, narration voice).

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
  rendering/LayerBlend.js    Draws a layer off-screen and fades it over the canvas
  rendering/NearbyStars.js   Real stars within 1 kpc, brightness from the camera
  data/nearbyStars.js        Loads the star field and the named stars
  rendering/accelerateZoom.js Wheel zoom that speeds up while you keep scrolling
  solar/MilkyWayPortal.js    Galaxy <-> Solar System: the zoom bridge, the wormhole button
  solar/scale.js             Where the Solar System sits in the map: units, axes, band
  solar/Wormhole.js          The trip: tunnel shader, ship's bridge, synthesised sound
  solar/atmosphere.js        Atmosphere shell: air crossed per sight line, lit by the Sun
  solar/bodyMaps.js          Spacecraft maps by size on screen: painted, 2K, 4K; released on leaving
  solar/hdMaps.js            The optional HD download: the offer, the map cache, cache-first lookup
  solar/SolarSystem.js       Lazy-loaded scene: bodies, labels, cards, tour, time
  earth/EarthLayer.js        True-scale Earth in km: the band with the Solar System, controls, drawing
  earth/gibsTiles.js         NASA GIBS Blue Marble tiles, levels 3–7, by texel size on screen
  earth/googleTiles.js       The empty slot for Google Photorealistic 3D Tiles, and its conditions
  solar/data.js              Every body's elements, sizes and card facts; scaling
  solar/kepler.js            Kepler's equation for the eccentric orbits
  solar/sky.js               Real sky (band, nebulae, stars), warp shader, dust
  solar/belts.js             GPU Keplerian belts: asteroids, Trojans, Kuiper, Oort
  solar/textures.js          Procedural surfaces and sky sprites
  solar/BodyCard.js          The docked detail card
  controller/PlottingController.js  Progressive "plot one by one" engine
public/textures/solar/       Planet maps (CC BY 4.0, see CREDITS.md there)
public/data/stars/           Star field + named stars, from npm run fetch:stars
public/textures/bodies/      Moon, moon and dwarf-planet maps at 2K/4K + manifest, from fetch:textures
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
- `controls.minDistance` is 0.03 Mpc (the Milky Way filling the view), lowered
  in steps from 5.0; each time the near plane lagged it, whatever you flew in
  to see was clipped, so near now follows the distance to the target
  (`updateLocalScale`, 0.02× of it, capped at 0.002). Aimed at the Sun there is
  no 0.03 floor: the portal sets `minDistance` and `zoomToCursor` every frame
  (see the scale gotchas), so set them nowhere else. Anything framed on the
  Milky Way (search, its label) aims at the galactic centre, 8 kpc from the
  Sun, so a zoom there used to stop dead at the 0.03 floor; reaching that floor
  anywhere in the disc now glides the target onto the Sun (`homeIn`) and the
  zoom carries on down. Satellites (LMC, SMC) keep the floor. The coordinate rings do not write depth, because
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
- **Scales are layers joined by a band** (`solar/scale.js`). The map (Mpc,
  equatorial) and the Solar System (compressed display units, ecliptic) are
  both centred on the Sun; `MPC_PER_UNIT` pins them at the Oort Cloud's edge
  (2,100 units ≈ 0.48 pc) and `solarFromMap`/`mapFromSolar` convert points and
  directions. Between `BAND_INNER` and `BAND_OUTER` (0.9–3.2 pc) both draw from
  one camera: the Solar System renders off-screen and `LayerBlend` fades it over
  the map. Control changes hands at 0.45/0.55 of the band (hysteresis).
  Whoever lacks the controls is placed from the other: `driveMap` is the map's
  `cameraDriver` while the Solar System owns the view (AR is not the only
  driver), and `bridgeFromMap` places the Solar System's camera the other way.
  Only when aimed at the Sun: the target within `BAND_INNER` of it.
- **Across the band both layers need one lens and one roll, measured to 0.00
  px.** A 45° versus 50° field of view alone put stars 80 px apart, so the lens
  blends from `SOLAR_FOV` to the map's (`scene.fov`, kept by `onResize`). The
  two layers' ups differ by up to 180° seen along some lines of sight, so the
  view rolls about the line of sight at a steady rate from `ROLL_FROM` (1,000
  units) out to `BAND_OUTER`. Turning the up vector itself swung 45° in a small
  zoom wherever its path neared the line of sight. The roll must be set before
  each layer draws: `GalaxyScene.afterControls` runs between the controls and
  the render for exactly this, and the Solar System steps, is measured, then
  draws. The wormhole's arrival is exempt and flies in level.
- **Flights are logarithmic** (`GalaxyScene.stepFlight`): the target eases
  across, the view direction slerps and the distance to the target
  interpolates on a log scale. A straight lerp from the survey to a few
  parsecs spent the whole flight at the far end and arrived in one frame.
- **Crossing ten orders of magnitude needs faster zoom.** A wheel notch is
  ×0.95 by default: 450 notches from Earth Origin to the planets.
  `accelerateZoom` raises OrbitControls' `zoomSpeed` to 5× while notches come
  less than 150 ms apart; a single notch is unchanged, pinch is untouched.
- **A star's brightness is worked out from the camera, per vertex**
  (`NearbyStars.js`): apparent magnitude from its absolute magnitude and its
  distance to the camera, so the sky is right from anywhere. The limiting
  magnitude is 7 near the Sun and deepens by 5 per tenfold distance, or the
  neighbourhood vanished when seen from outside it. Past ~4 magnitudes above
  the limit a star swells into glare — flown up to, it read as a dot. The
  layer fades out 1.5–4 kpc from the Sun, where the Milky Way model carries on.
- **The stars live in the map, in Mpc.** No new frame: the Sun is the origin,
  so float32 holds 1 kpc to ~20 AU. Near a star (the target within
  `STAR_REACH_MPC` of the Sun) the camera may close to ~200 AU; elsewhere the
  old limits stand. Among the stars `uAmongStars` shrinks galaxy sprites to
  smudges, which at their usual 22 px buried the stars.
- **Named stars ride along with every dataset** (`NamedObjectLayer.addObjects`)
  in a `star` tier shown within 2 kpc of the Sun. Their weight is recomputed
  each frame from how bright they look from the camera, so the labels follow
  the sky; only stars brighter than ~2.5 there (deeper further out) get one.
  Cards swap the redshift and lookback rows for brightness and light-travel
  time. Names are chosen from SIMBAD's aliases (components, "… Star" nicknames
  and catalogue-like names dropped); a few come out in a variant spelling
  (Rigel Kentaurus, Celeno, Albereo) because no service offers the IAU list,
  and every alias stays searchable.
- **The Solar System's sky is the real one.** `createSky` places the ~9,000
  stars brightest from the Sun at their true directions, so the band's
  crossfade shows one sky; `loadSolar` fetches the star field for it, and a
  failure there falls back to random stars rather than failing the trip.
- **`fetch:stars` quirks.** VizieR's `RArad`/`DErad` in I/311 are degrees.
  SIMBAD's Bayer/Flamsteed ids are padded (`*  61 Cyg A`) and superscripted
  (`* alf02 Cen`), and a few designations are filed as names (`NAME iot Cas
  AB`), which are dropped. The archive gives some Hipparcos stars no `hip_name`
  and writes Bayer hosts its own way (`gam1 Leo`): hosts are matched to
  Hipparcos by position (60″, allowing for proper motion between the epochs)
  with distances agreeing to 25%, or they were drawn twice. The proxy
  occasionally drops a long TAP response, so each query retries once. Like
  `fetch:named`, it needs `NODE_USE_ENV_PROXY=1` here.
- **The Earth layer is a scaled copy of the Solar System's Earth** (`EarthLayer`),
  in Earth's own frame: the mesh's local axes, in km (`kmPerUnit` =
  6,378 km over its display radius). One camera is placed from the other
  through the mesh's world matrix, so across the band the two layers put
  every place on the same pixel (measured: 0.000 px). It is drawn after the
  Solar System's frame, cleared to transparent, so the real sky, the Sun and
  the Moon stay behind it; faded through `LayerBlend` across the band,
  straight over it inside, where the stand-in Earth is hidden. The band only
  applies while following Earth: unfollowed, Earth runs off along its orbit.
- **At Earth the Solar System's clock is held** (`step` uses a time scale of 0
  while `earth.owns`): at display speed Earth turns every 8 s and circles the
  Sun every 30, so the ground and the terminator would race. Held, Earth's
  frame is still and the Sun's direction fixed. Labels, the tour and the speed
  buttons and the card's Follow stand aside (`.earth-view`), picking is off and the date line says
  so; zooming back out past mid-band hands the view back and time runs again.
- **The Earth layer sets its own roll.** It orbits Earth's axis (north up)
  while the Solar System's up is ecliptic north, 23.4° away. The view rolls
  from one to the other between the hand-over (3.4 R) and 1.6 R, as the map
  band does, and `MilkyWayPortal.measure` leaves the Solar System camera's up
  alone while the Earth layer owns it, or its `lookAt` would undo the roll.
- **Zoom at Earth goes by altitude, not distance.** OrbitControls scales the
  distance to the target (Earth's centre), which near the ground would step
  hundreds of km a notch. `steer` sets `zoomSpeed` so each notch is 5% of the
  altitude, and `rotateSpeed` so a drag keeps the ground under the pointer.
  `accelerateZoom` multiplies `controls.zoomBase` when a layer sets one.
- **GIBS's geographic grid is 288° at level 0**, so only levels 3–7 tile the
  globe exactly (36° down to 2.25°, 512 px tiles). A tile splits while its
  pixels exceed 1.25 screen pixels, and its children replace it only once all
  the visible ones have arrived; until then the manifest's map shows
  underneath, 2 km lower so tiles never z-fight it. Top-level tiles are fetched
  only where that map would look blurred, so nothing loads out in the band.
  Tiles are kept by last use up to 96 (48 on phones). City lights on tiles
  read the global night map through a second UV set (`uv1`, a `channel = 1`
  clone sharing its GPU texture). The floor is 250 km: GIBS's ~490 m pixels
  are two screen pixels there, and below it they would only magnify.
- **GIBS's terms** (Earthdata's data use guidance): NASA mission data not
  marked otherwise is CC0; GIBS asks for an acknowledgement, which is in the
  Solar System credit line while at Earth (`.earth-credit`) and in the README.
  Its tiles send `Access-Control-Allow-Origin: *`, and are not part of the 3f
  cache.
- **The atmosphere takes the Sun's position** (`uSun`, the origin in the
  Solar System). The Earth layer sets it to the Sun's true direction at 1 AU
  in km; `normalize(-p)` assumed a Sun at the origin.
- **`LayerBlend.over` restores whatever target was bound**, not the canvas,
  so a layer drawn inside another's blend composites into it.
- **`fetch:textures` re-frames every map to one convention**: east to the
  right, 0° longitude at the centre, 180° at both edges. The archive's ISIS
  labels number longitude east or west and centre on 0° or 180°; the script
  reads `LongitudeDirection`, `CenterLongitude` and `UpperLeftCornerX` and
  rolls each map. ISIS draws east to the right either way — checked by eye
  against Mare Crisium, Pele and Loki, Herschel and Iapetus's ridge. A source
  without a label (the Moon, Mimas) carries its left edge by hand. Earth's
  colour map is August 2004 (record 74117), the month GIBS's Blue Marble
  matches, so the tiles do not melt December's snow as they load. The ~2 GB
  of originals are cached in `node_modules/.cache/fetch-textures` and checked
  against the archive's MD5s; `sharp` (dev only) decodes them, with no pixel
  limit, since Pluto's mosaic is 310 megapixels.
- **Map licences rest on pages the script could read.** USGS's and JPL's
  policy pages return 403 to scripts, the USGS product pages sit behind a
  Cloudflare challenge (do not route around it) and its CKAN catalogue
  answered 502. So the Moon's licence is the SVS help page ("all of our
  content is in the public domain") and everything else is NASA's media
  guidelines, which name texture maps and exclude only material marked with a
  third-party holder; no PDS label marks one. Mimas is not in the PDS bucket
  except as DLR's zip, so it comes from NASA's library (PIA17214). A source
  with no licence is refused.
- **`imaged` in the manifest is the share of the surface actually seen** (area
  weighted, black fill excluded). Pluto is 77%: its south was in winter
  darkness during the flyby. 3d labels the rest as an artist's impression.
  Iapetus's mosaic has its brightness flattened, so its black-and-white
  two-tone is mostly gone; 3d has to put the albedo back.
- **Spacecraft maps follow a body's size on screen** (`BodyMaps`, from 3e).
  A body shows its painted surface until its radius on screen reaches
  `NEAR_PX` (12 px), then its 2K maps, then its 4K maps past `SHARP_PX` (400
  px, where 2K texels are ~1.3 screen pixels). Each level is let go only below
  a lower threshold (4 px, 250 px), so a body at the edge does not flicker, and
  leaving a body disposes its maps: all 21 2K maps at once were ~235 MB of GPU
  memory, and a Grand tour used to pile them all up. A set is shown only if it
  is still wanted when it arrives and is still the current set (a set let go
  and asked for again mid-load is being disposed); one let go mid-load is
  disposed when it lands. The painted surface is kept as the base to fall back
  to. The manifest is fetched in `build`; without it every body stays painted.
- **Phones stop at 2K** (`BodyMaps.top`): a coarse pointer, or a GPU whose
  `maxTextureSize` is under 4096. A 4K JPEG map is ~90 MB of GPU memory with
  mipmaps whatever its file size, and Earth has three. KTX2 would let phones
  have 4K at a quarter of that, at the cost of a transcoder; not done.
- **The HD download has no service worker** (`hdMaps.js`). The page reads
  the Cache API itself: `BodyMaps.fetchSet` asks `savedUrl` first and loads a
  hit as a blob URL, revoked once loaded. A worker would add a lifecycle and
  a way to serve a stale page for nothing. A saved file whose size no longer
  matches the manifest is dropped and fetched again, so regenerated maps are
  never shown stale. The offer counts what is missing from the cache, never a
  stored flag; only Not now is stored (`cosmoverse.hdMaps` in localStorage).
  The Cache API needs a secure context, so a plain-http LAN address never sees
  the offer. The offer takes the phone card's slot and hides while a card is
  open.
- **A map's 0° longitude faces the parent**, as moon maps define it. A
  sphere puts the map's centre on +X and the planet lies along −X, so moons
  turn half a turn (`mesh.rotation.y = π`); an icosahedron's UVs (the lumpy
  Phobos) already start half a turn round, so it does not. Pluto keeps its own
  0° (the sub-Charon meridian) on Charon: Charon's tick sets Pluto's rotation
  after Pluto's own spin. Checked numerically: every sub-parent longitude 0°,
  Iapetus leading with 90°W (its dark side).
- **Greyscale mosaics are tinted** to the average colour of the body's painted
  surface (`averageColour`, via `material.color`), so Pluto reads beige and
  Callisto brown; the brightness detail is all real.
- **What no spacecraft saw is filled in the pipeline** (`fillUnseen` in
  `fetchTextures.mjs`): Pluto's and Charon's south and Triton's north are
  black in the mosaics, and become the average colour of what was seen,
  feathered over a few pixels that also swallow resampling's dark fringe;
  cards say how much was seen and that the rest is left plain. Filling in the
  browser, first with the painted surface, looked like a cartoon next to real
  terrain (Triton's pink painting clashed with Voyager's colours), and at 4K
  would stall the page for seconds. Titan's `veil` is 0.96: at 0.8 and even 0.92 the ISS
  mosaic's tile edges showed through a haze that in visible light hides
  everything.
- **Earth's city lights are an emissive map masked to the night side**
  (`nightSideOnly`, an `onBeforeCompile` on the surface material: view-space
  normal against the Sun at the origin). The Black Marble's faint blue land
  all but vanishes once decoded to linear light, so it needs no masking.
- **Atmospheres** (`atmosphere.js`) are a shell shaded by how much air each
  sight line crosses, lit by the Sun, with a sunset colour at the terminator
  (Mars's is blue). Values come from NASA fact sheets in `data.js`: haze
  density per decade of surface pressure, the air reaching ~7 scale heights
  (Titan's 600 km is NASA's figure). A limb is at least 3% of the radius:
  Earth's, to scale, is under a pixel from a normal view. Titan's `veil`
  hides the ground as its haze does. The shell is front-faced, so it vanishes
  if the camera goes inside it. `half` is a reserved word in GLSL ES.
- **Every card with a surface says where it comes from** (`surfaceNote`): the
  map's credit and, if under 98% was seen, how much; otherwise "artist's
  impression", with "no spacecraft has visited it" for bodies flagged
  `unvisited`.
- **`VITE_TEXTURE_BASE`** (build-time) says where maps are served from; unset,
  it is this deploy's `textures/`. Another host must send CORS headers or
  WebGL refuses the images. Only `SolarSystem.js` reads it.
- **The Earth beacon becomes the Sun** inside ~1 kpc (it warms from blue), and
  no longer has a minimum size: at 80 pc it engulfed the camera near the Sun.
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
  rather than breaks. Rings, the sky sprites and the starfield are procedural
  (`textures.js`), and so is every moon and dwarf planet until its spacecraft
  map loads, painted with its known features; the painting stays as the
  fallback and gives a greyscale map its tint. The credit stays
  visible on phones — the hint line is what goes.
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

For the stars, wait for `namedLayer.extraObjects.length > 0` (named stars load
~1.5 s after start) and `scene.stars.ready` (the field loads within 5 kpc of
the Sun). `namedLayer.objects.find((o) => o.label === 'Proxima Centauri')`,
then `select` and `flyTo` it, exercises search, cards and the star floor.

To check a body's maps, select it (`portal.solar.select(byName.get(name))`),
wait for `follow.t >= 1`, then set the camera relative to the Sun at the
origin (the Sun behind the camera for a full disc, side-on for the
terminator) and copy the body's position into `follow.last`. Wait for the body
to leave `pendingMaps`. A map longitude for a direction `d` in the body's local
frame is `atan2(d.z, −d.x) / 2π` (+0.5 on an icosahedron), centred on 0°.

To test the map levels without the wormhole, `await portal.ensureSolar()`
then `portal.handToSolar()`. Place the camera a number of radii from a body
(set `solar.follow` to it with that offset, so it rides along) and read
`body.maps.want`, `.shown` and `.sets` and `renderer.info.memory.textures`;
wait for `shown === want` before reading. Playwright's `isMobile` + `hasTouch`
gives a coarse pointer, so `solar.maps.top` is `'2k'` there.

The HD offer is `portal.solar.offer` (`el`, `text`, `buttons.yes/no/cancel`,
`progress`, `files`); `offer()` shows it again. A localhost download finishes
in about a second, so to test Cancel, throttle with CDP
(`Network.emulateNetworkConditions`, ~2 MB/s). Read the cache with
`caches.open('cosmoverse-maps')` and check its `keys()` hold nothing but map
files. Record `page.on('request')` to confirm a saved map is not fetched again.

To test the Earth layer, select Earth (`solar.select(byName.get('Earth'))`),
wait for `follow.t >= 1`, then place the Solar System camera r Earth radii
from Earth's centre along its line of sight (and copy Earth's position into
`follow.last`). Past the hand-over (`solar.earth.owns`) move
`solar.earth.camera` instead: `position.setLength(radius + altitudeKm)`.
`earth.opacity`, `earth.tiles.tiles` (each with `state`, `level`, `mesh`) and
`solar.years` (held while owned) say where you are. To check the layers agree,
project a lat/lon through both cameras (the Solar System's through
`earth.mesh.matrixWorld`); it should be 0 px. This sandbox's Chromium does not
trust the proxy's CA, so GIBS fails there with `ERR_CERT_AUTHORITY_INVALID`;
do not disable certificate checks. Route `https://gibs.earthdata.nasa.gov/**`
through Playwright to Node's `fetch` (run with `NODE_USE_ENV_PROXY=1`), which
verifies the chain, and fulfil with the response plus
`Access-Control-Allow-Origin: *`. With time held, wait on animation frames,
not the Solar System's clock.

To test the continuous zoom, click `[data-landmark="earth"]` (aims at the Sun)
and move whichever camera owns the view along its line of sight:
`scene.camera.position.setLength(mpc)` while `portal.active` is false,
`portal.solar.camera.position.setLength(mpc / MPC_PER_UNIT)` once true.
`portal.band`, `portal.active` and `portal.ownsFrame` say where you are.
SwiftShader draws a few frames a second, so wait on a clock rather than a
timeout: `portal.solar.moonClock + scene.uniforms.uTime.value` advances
whichever layer draws. To check the layers agree, project the same
directions through `scene.camera` and `portal.solar.camera` (converting with
the obliquity rotation) and compare pixels; it should be 0. Playwright's wheel
events arrive too slowly for `accelerateZoom`; dispatch `WheelEvent`s in the
page on a timer to test it.

To reach the Solar System by the wormhole, search "Milky Way" (it flies to 0.077 Mpc, inside
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
