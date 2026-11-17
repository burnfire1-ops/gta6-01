# Teluk Cahaya — Architecture (GDD contract for builders)

Game: open-world crime, three.js r187, offline static files. Design source:
`~/workspace/your_files/tesis-desain-game-gta6/tesis-desain-game-gta6.pdf`
(21 pp). Genre rules: `open-world-crime` skill. Do NOT change design decisions.

## 0. Golden rules

- All content 100% original (procedural + geometric + canvas textures). NO Rockstar
  content, NO network requests at runtime, NO external files. three.js r187 vendored
  in `game/vendor/` (`three.module.min.js` + `three.core.js`, verified REVISION 187).
- Pure sim core: `game/src/core/*` NEVER imports `three`. Sim state is plain data;
  render modules are views that copy state onto meshes each frame (gta7 lesson).
- Write your own code line by line via write/edit. Never paste code from outside.
- File ownership is strict: touch only the files your slice owns (see §4).
- Gate: `game/` ≤993 files / 48 MiB; screenshots 3–4 files, each ≤256 KiB, long
  side ≤1280 px, short side ≥480 px; `index.html` ≤1 MiB. Dossier text cap
  160 KiB applies to OUR source only (vendor/ + *.min.js are excluded).

## 1. Coordinates and city layout

- World: x = east, z = south, y = up. Ground plane y = 0. North = -z (minimap
  north-up: screen up = -z).
- City: grid of streets every 40 units, nodes at x,z in {-240,-200,...,240}
  (13x13 = 169 nodes). Roads run along grid lines; blocks are 40x40.
- Districts by quadrant (node region):
  - NW (x<0,z<0): Boulevard Art-Deco (start, shops/cafes, medium traffic)
  - NE (x>0,z<0): Distrik Neon (nightlife, busiest at night)
  - SW (x<0,z>0): Pelabuhan & Industri (warehouses, trucks, wide roads)
  - SE (x>0,z>0): Bukit Residensial (houses, locked cars, denser patrol)
- Sea: water plane beyond the city edge (y=-0.5). Lighthouse prop at the north
  coast (-260,-260 area, offshore rock). Landmarks: tallest glass tower (Neon
  centre), lighthouse, bridges (decorative arches on the central boulevard).
- Day length ~12 real minutes. Clock `t` in [0,1): 0 = 06:00, 0.5 = 18:00.
  Sun elevation/azimuth, sky colour, window emissive, street lights, traffic
  density and ped schedules ALL read the same clock (one clock, one graph).

## 2. Road graph (core/city.js — the single source of truth)

```js
city = {
  seed, nodes: [{id, x, z, district}],           // id = z*13+x index
  edges: Map<nodeId, [{to, len}>],               // 4-neighbour grid
  blocks: [{cx, cz, district, buildings: [...]}],
  pois: { safehouse, garage, portWarehouse, missionGiver, shops:[], packages:[] },
  trafficLights: [{nodeId, phase, period}],
  nodeAt(x,z), nearestNode(x,z), astar(fromId, toId) -> [nodeIds],
  segmentBlocked(x0,z0,x1,z1) -> bool,           // LOS vs building AABBs
  randomRoute(rng, fromId) -> [nodeIds],
}
```

- A* is in `core/city.js` (pure). Traffic, police and peds all route on this
  graph. The minimap draws from this graph. A minimap that is not the real
  graph is a lie.
- Buildings are AABBs `{minX,maxX,minZ,maxZ,h}` per block, generated
  deterministically from the seed. LOS checks use segment-vs-AABB (pure math).

## 3. Sim state (core/state.js)

```js
state = {
  seed, time, clock, // clock in [0,1), time = seconds since session start
  money, health, armor,
  player: { x, z, y, heading, speed, onFoot, vehicleId, vy, grounded, ... },
  vehicles: [{ id, type, x, z, heading, speed, steer, color, health,
               driver: 'player'|'npc'|null, parked, locked, stolen,
               wantedMarked, model }],
  traffic: [{ id, vehicleId, route:[], nodeIdx, state, ... }],
  peds: [{ id, x, z, heading, state, speed, isWitness, reportT }],
  police: [{ id, vehicleId, state, lastKnown:{x,z}, perceptionT, ... }],
  wanted: { stars, hideT, blinkT, searchCircle:{x,z,r}|null, captureT },
  mission: { id, objectiveIdx, objectives:[...], state, timer },
  flags: { districtsUnlocked, packagesFound, vehiclesOwned:[], storyDone },
  settings: { music, sfx, ambience, ui, sensitivity, invertY, shadows },
  mode: 'title'|'playing'|'paused'|'busted'|'wasted',
}
```

- Event bus (in state.js): `emit(name, data)` / `on(name, fn)`. HUD, menus and
  audio subscribe; they NEVER poll sim state every frame. Events:
  `wantedChanged`, `moneyChanged`, `healthChanged`, `objectiveChanged`,
  `missionComplete`, `missionFailed`, `busted`, `wasted`, `vehicleEntered`,
  `vehicleExited`, `crimeSeen`, `saveDone`, `dialog`.
- Sim tick: `update(state, input, dt)` with dt clamped to 0.1 s. Police
  perception runs at 5 Hz (every 0.2 s, staggered), never every frame.
- Deterministic seed: `?seed=N` in URL (default 1). Same seed → same city,
  same traffic patterns, same screenshot.

## 4. Modules and file ownership

```
game/index.html                 (foundation) import map -> vendor, HUD DOM, canvas
game/src/main.js                (foundation) boot, loop, wiring, ?shot= hooks
game/src/core/rng.js            (foundation) mulberry32 + helpers
game/src/core/city.js           (foundation) graph + districts + POIs + A*
game/src/core/clock.js          (foundation) city clock, sun, density curves
game/src/core/state.js          (foundation) state shape + event bus
game/src/core/player.js         (foundation) on-foot move + jump + punch
game/src/input/input.js         (foundation) named actions, buffering, rebind
game/src/render/renderer.js     (foundation) scene/camera/lights/renderer
game/src/render/city-render.js  (foundation) buildings/roads/props (instanced)
game/src/render/characters-render.js (foundation) player mesh sync (+peds later)
game/src/core/vehicles.js       (slice: vehicles) driving + steal + damage
game/src/render/vehicles-render.js (slice: vehicles) vehicle meshes sync
game/src/core/traffic.js        (slice: traffic+peds) traffic AI
game/src/core/pedestrians.js    (slice: traffic+peds) ped FSM + witnesses
game/src/core/wanted.js         (slice: police) wanted meter + escape timer
game/src/core/police.js         (slice: police) police FSM + pursuit + spawn
game/src/core/missions.js       (slice: missions) 8 missions + side activities
game/src/ui/hud.js              (slice: hud) HUD DOM + events
game/src/ui/minimap.js          (slice: hud) canvas minimap from graph
game/src/ui/menus.js            (slice: hud) menu stack
game/src/audio/audio.js         (slice: audio) Web Audio synth
game/src/save/save.js           (slice: save) localStorage slots
```

- Render modules expose `create(scene, city)` and `sync(state, dt)`.
- Sim modules expose `create(state, city)` (optional) and `update(state, input, dt)`.
- Shared helpers live in their owner's file; do NOT create new shared files
  without asking the parent (integration owner).

## 5. Key numbers (from thesis + open-world-crime skill)

- Wanted: max +1 star per incident. Witness: LOS + <25 m + ~2 s report delay
  (cancellable if witness hit/flees). Police seeing directly: instant.
- Hide timer (unseen): 6 s @1-2 stars, 10 s @3, 15 s @4-5; blink ~3 s warning.
  Leaving search area (3+ stars) while unseen: timer 2x faster. Swapping cars
  in a quiet place / stopping in an alley: timer significantly shorter.
- Safehouse clears wanted 1-2 only, only when unseen on entry. Respray clears
  wanted in car while unseen, for a fee.
- Police top speed slightly BELOW the player's sports car. Spawn out of view
  and outside a minimum radius. Perception 5 Hz. Anti-stuck: <0.5 units in
  2 s -> recalc path once, then teleport to nearest node out of view.
- BUSTED: capture meter fills (police hold player nearby) or health 0 with
  wanted active -> fine, wanted 0, restart at nearest police station.
  WASTED: health 0, no wanted -> wake at nearest safe point, smaller fine.
  Neither is game over.
- Missions (order teaches one system each): 1 driving, 2 steal, 3 wanted &
  escape, 4 night/neon, 5 chase & vehicle combat, 6 on-foot combat, 7 timed
  route/minimap, 8 final all-systems at max wanted. Fail -> mission-start
  checkpoint, small money loss. Progression unlocks districts, raises pay and
  wanted cap. Side activities: timed deliveries, hidden packages, checkpoint
  time trials -> money + vehicle variants.
- Combat: 1 pistol (soft lock-on, RMB aim, LMB shoot, ammo bought) + fists
  (light/heavy punch, dodge, block). Ramming = vehicle combat verb (target
  health bar above target in chase missions). NO shooting from cars.
- Camera: third-person (pivot yaw/pitch by mouse, spring arm, smoothing
  1-exp(-rate*dt), look-ahead); driving = chase camera (further, lower, FOV
  widens with speed, looks ahead of car).
- Controls: WASD move, mouse orbit, Shift run, Space jump/handbrake, F
  interact/enter-exit car, LMB attack/shoot, RMB aim, R reload, M big map,
  Esc pause. Actions are named; discrete actions are buffered.
- Save: versioned plain JSON in localStorage, 3 manual slots + 1 autosave.
  Atomic write with backup. Autosave on mission complete + safehouse entry.
- Audio: buses Master/Music/SFX/Ambience/UI. Synthesized adaptive music
  layers (calm base, rhythm in missions, tense at high wanted); sirens and
  mission dialog duck music. No audio files.
- Performance: 60 fps target, instancing for buildings/palms/lamps/props,
  merged geometry per vehicle/character, ONE shadow-casting directional light
  with shadow camera following the player, agents spawned/despawned around
  the player, pixel ratio max 1.5, no big per-frame allocations.

## 6. Shot hooks (for Playwright screenshots)

`main.js` reads `?shot=<name>&seed=N`:
- `start`: title screen over the live city (camera drifting over boulevard).
- `cover`: day, third-person on the boulevard, Raka on foot near a teal car,
  traffic + peds, mission marker visible (Preview A).
- `chase`: police chase in progress, wanted 2-3 stars visible (Preview C).
- `hud`: mission 1 active, full HUD (Preview D).
- `night`: night driving in the neon district (Preview B).
Each shot sets deterministic state from the seed, then sets
`window.__shotReady = true` when the first frames have rendered.
Expose `window.__game = { state, renderer, scene }` for debugging/tests.

## 7. Verification (per slice)

Serve: `node serve.ts` (port 8080) -> http://localhost:8080.
Playwright (test only): open page, assert no console errors, assert
`window.renderer.info.render.calls > 0`, drive the slice's scenario, take
screenshots. A slice is done only when its scenario runs without console
errors. Final bar: play from title through mission 1 completion with zero
console errors.
