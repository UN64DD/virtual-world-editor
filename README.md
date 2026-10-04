# virtual-world-editor

A browser-based 2D/3D virtual world editor and driving simulator. Plain JavaScript, no
external libraries, no build step — open `index.html` through a static server and it runs.

![screenshot](docs/screenshot.png)

## Quick start

```bash
npm run dev          # python3 -m http.server 8080
# then open http://localhost:8080
```

A file:// URL will not work: the app is split into ES modules, so it needs HTTP.
`node tools/serve.mjs` starts an equivalent Node server if Python is unavailable.

## Features

**Editing**

- Nine tools: select, road, junction, building, surface, prop, marking, vehicle, measure.
- Road drawing with class-based lane counts, angle snapping, auto-junction creation,
  and multi-segment chains committed as a single history entry.
- Marquee selection, shift-click toggling, alt-drag duplication, drag-move, and
  Delete/Backspace to remove.
- Layers with independent visibility, plus a layers panel showing per-layer counts.
- Inspector panel with live geometry editing; numeric fields derive dependent values
  (e.g. floors x floor height -> height) rather than storing stale numbers.
- Snapping engine for nodes, roads, edges, and grid.

**Simulation model**

- Lane graph built from the road network, with centre lines, left/right boundaries,
  predecessor/successor topology and turn classification.
- Routing between lanes, and an autonomy export format (`toAutonomyFormat`) carrying
  centrelines, boundaries, widths, speed limits in both m/s and kph, and junction nodes.
- Georeferencing via `unproject`, so a world can be anchored to real coordinates.

**Traffic**

- Vehicles are part of the world: they save, load, undo, and move with the simulation.
  Five presets (car, van, truck, bus, sports car) set dimensions, handling, and colour.
- `DriveSim` drives every `autonomous` vehicle along the lane graph: adaptive pure
  pursuit with cross-track correction, lane routing with recency penalties, leader and
  parked-car braking, signals with junction setback, and junction yielding.
- Vehicles hold position in junctions, keep to the left, and hand over between lanes on
  curved connectors; heavy vehicles lean into corners rather than cutting them.
- Per-vehicle telemetry (state, reason, speed, distance, lane, signal) is shown in the
  inspector, with live `Drive` / `Pause` control in the status bar (`P`).
- Vehicles render in 2D and 3D, appear on the minimap, and can be picked in both views.

**Import / export**

- OpenStreetMap import (`src/app/osm.js`).
- JSON save/load, download, and localStorage autosave.

**Viewing**

- 2D renderer with layered draw order, theming, and sprites.
- 3D mode with orbit camera, extruded buildings, and screen-space picking.
- Minimap, scale bar, status bar, toasts, and a modal dialog system.

## Keyboard

| Key | Action |
| --- | --- |
| `V` `R` `J` `B` `G` `O` `M` `C` `D` | Select, road, junction, building, surface, prop, marking, vehicle, measure |
| `P` | Start or pause the traffic simulation |
| `2` / `3` | Top-down 2D / 3D view |
| `F` | Fit world |
| `Tab` | Cycle active layer |
| `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+Y` | Undo / redo |
| `Ctrl/Cmd+S` / `Ctrl/Cmd+O` | Save / open |
| `Ctrl/Cmd+D` | Duplicate selection |
| Arrow keys | Nudge selection (`Shift` for 5 m steps) |
| `Delete` / `Backspace` | Delete selection |
| `Escape` | Cancel the current draft |
| `Enter` | Commit the current road or surface draft |
| Wheel, middle- or right-drag, `Alt`-drag | Zoom, pan |

## Architecture

```
index.html          shell: topbar, toolbar, sidebar, statusbar, modal host
styles/app.css      all styling
src/
  main.js           app shell: input binding, picking, tool orchestration, render loop
  snap.js           snapping engine and screen-space tolerances
  core/             camera (2D + inertia), geometry, mat4, event emitter, history, utils
  model/            world data, schema/factories, lane network, geo, paint, demo world
                    driver.js holds the traffic simulation (DriveSim)
  render/           2D renderer, 3D scene + renderer, orbit camera, sprites, theme
  app/              tools, inspector, minimap, OSM import, persistence, self-test
tools/              test harnesses (see Testing)
```

Data flows one way: tools mutate the world through a transaction, the world records
inverse operations onto a history stack, and the renderer draws whatever the world
currently holds. There is no framework and no virtual DOM; `src/app/dom.js` has small
helpers for the imperative panels.

## Testing

```bash
npm test              # smoke + functional + render3d
npm run test:smoke    # every module imports cleanly under a stubbed DOM
npm run test:functional  # builds a world, exercises the model pipeline and DriveSim
npm run test:render3d    # verifies 3D projection and picking math
node tools/browser.mjs   # full in-browser run (needs Chrome)
```

`tools/browser.mjs` boots the real page in headless Chrome, checks the console for
errors, takes a screenshot, decodes it via `tools/png.mjs`, and asserts on pixels
(the map is populated, the map centre is opaque, the sidebar renders separately from
the canvas). It also runs `src/app/selftest.js` in-page — 97 assertions covering
round-tripping, picking, each drawing tool, undo/redo, marquee selection, 3D
projection, the autonomy export, and a live traffic run (spawning a vehicle with the
vehicle tool, stepping the simulation, checking that it stays on the road, respects
speed limits, writes back to the world, and renders in 2D and 3D).

Chrome is located via `$CHROME_BIN`, falling back to `google-chrome`. The browser
suite is not part of `npm test` because it needs a browser binary; run it before
claiming a change is visually safe.

## Development update

The last session delivered persistent traffic: vehicles are world objects now, and
`src/model/driver.js` drives every autonomous one along the lane graph. The second
half of the session closed the gaps between that simulation and the app — inspector
telemetry, 3D rendering, dropping vehicles onto roads, and a crash that broke 3D mode
entirely.

### Bug fixes

- **3D mode threw on every frame.** Drawing the 3D view called
  `this.scene3d?.vehiclePrisms()`, which Chrome rejected with
  `this.scene3d?.vehiclePrisms is not a function` even though the method was present
  and callable. Vehicle geometry is now built by an exported plain function,
  `buildVehiclePrims(scene, vehicles)`, called from `App.vehiclePrims3d()` for both
  rendering and picking. (`src/main.js`, `src/render/scene3d.js`)
- **3D vehicles were unpickable and drew in the object pass.** `boxPrism` hard-coded
  the prop sublayer and left `id` unset, so vehicle polygons inherited prop settings.
  It now takes `sub`, `tag`, and `id`. (`src/render/scene3d.js`)
- **Dropped vehicles started off the road.** The vehicle tool used the nearest lane
  only for its heading and kept the raw click position, so a click beside a road
  spawned a vehicle the simulator then had to rescue. Vehicles now snap to the nearest
  centreline within 8 m and warn otherwise. (`src/app/tools.js`)
- **The inspector re-rendered 60 times a second.** `stepDrive` called
  `refreshInspector()` on every animation frame while nothing was selected. Status and
  inspector refreshes are now throttled to 400 ms, and the inspector only refreshes
  while something is selected. (`src/main.js`)
- **The traffic button never changed state.** `Drive` kept its label and never picked
  up the `live` class once traffic was running. (`src/main.js`)
- **Junctions were invisible to the simulator.** `isJunction` read `road.from` /
  `road.to`, which do not exist — roads store `a` and `b` — so junction lookups always
  failed and the junction radius was always zero. (`src/model/driver.js`)
- **Signal timing changed on every reload.** Phase offsets hashed entity ids, which are
  generated randomly per world. They are now hashed from node geometry, so the same
  town produces the same signal timing in every process. (`src/model/driver.js`)
- **Vehicles stopped inside junctions.** Stop lines used a fixed setback. `stopS()`
  now adds half the vehicle length and is capped by the lane length. (`src/model/driver.js`)

### Simulation tuning

- The lane-quality harness measured centre distance, which reports phantom collisions
  for opposing traffic on narrow lanes. `tools/scratch-fleet.mjs` now uses oriented-box
  SAT overlap and excludes junction-adjacent samples, since junction handling is scored
  separately. Fixed 300-second demo run: 8/8 vehicles driving, 12.6 km, zero body
  overlap, zero non-finite states.
- Junction reservation was removed. Claims produced queues and deadlocks while the
  overlap detector showed no real contact; vehicles now hold position and yield while a
  junction is physically occupied.
- Corner handling was retuned (junction setback 3–4 m, smoother plan shifts, a heading
  gate on lane handover). Wide swings from trucks and buses on narrow roads are an
  accepted consequence of their turning circle, not a bug to tune away.

### Test results

| Suite | Result |
| --- | --- |
| `tools/smoke.mjs` | all modules import cleanly (now covers `driver.js` and `demo.js`) |
| `tools/functional.mjs` | 95 passed, 0 failed |
| `tools/render3d.mjs` | 49 passed, 0 failed |
| `tools/browser.mjs` | 112 passed, 0 failed (in-page self-test 97/97) |

New coverage: a `DriveSim` block in the functional suite (spawn, driving, road
adherence, speed limits, telemetry, parked and deleted agents, per-preset dimensions), a
vehicle-geometry block in the 3D suite (sublayer, ids, determinism, layer visibility,
picking), and an in-page traffic run that drives a spawned vehicle and checks the
vehicle tool, the traffic button and status bar, the inspector, and both renderers.

### Known limitations

- `tools/browser.mjs` needs a Chrome binary and is therefore not wired into
  `npm test`.
- The browser suite is a single 1440x900 viewport; there is no coverage of small
  screens or touch input.
- OSM import is one-way; there is no export back to OSM.
- Vehicles follow the lane graph forwards only: no reversing, parking manoeuvres, or
  discretionary lane changes.
- Junction coordination is co-operative (yield while occupied) rather than reserved, so
  heavy traffic can queue at busy junctions.
- Simulation steps clamp to 120 ms, so a backgrounded tab resumes where it left off
  rather than fast-forwarding the fleet.

## License

MIT. See `LICENSE`.
