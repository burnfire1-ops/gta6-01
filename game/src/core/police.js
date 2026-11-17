// Teluk Cahaya — police slice (core simulation, pure: no three.js).
// Owns state.police: 5 Hz staggered perception, the FSM patrol / suspicious /
// chase / search / giveup, out-of-view spawns, lead/intercept steering with
// lateral fan-out, the 1-star tail-only rule, the capture meter, and
// anti-stuck repath + off-view relocate. Police top speed (28) is below the
// player's sports car (32) — that number lives in vehicles.js. Genre: open-world-crime §1-§3.

import { makeRng } from './rng.js';
import { nodeCoords, nearestNodeId } from './city.js';
import { spawnVehicle, stepVehicle, damageVehicle } from './vehicles.js';

const SIGHT_RANGE = 60;      // police see the player inside this distance
const SIGHT_HALF_ANGLE = Math.PI * 100 / 360; // 100-degree view cone
const CLOSE_RANGE = 12;      // inside this, vision is 360 degrees
const PERCEPTION_DT = 0.2;   // 5 Hz
const MIN_STATE_T = 2;       // minimum seconds in any FSM state
const LOST_TO_SEARCH = 4;    // seconds unseen in chase before searching
const SEARCH_SECONDS = 6;    // seconds looking around lastKnown
const CAPTURE_RANGE = 6;     // on-foot capture distance
const MIN_SPAWN_DIST = 50;   // never spawn closer than this
const DESPAWN_DIST = 150;    // giveup units despawn beyond this
const TAIL_DISTANCE = 15;    // 1 star: keep this distance, no ramming

let nextId = 1;
let rng = null;
let cityRef = null;

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Player velocity in world XZ, from the driven car or on foot.
function playerVelocity(state) {
  const p = state.player;
  if (!p.onFoot && p.vehicleId !== null) {
    const car = state.vehicles.find((x) => x.id === p.vehicleId);
    if (car) return { x: Math.sin(car.heading) * car.speed, z: Math.cos(car.heading) * car.speed };
  }
  return { x: p.vx || 0, z: p.vz || 0 };
}

// Cheap-to-expensive sight check: squared distance, then view cone,
// then a single line-of-sight ray. A wrecked car sees nothing.
export function unitSeesPlayer(state, city, unit) {
  const car = state.vehicles.find((x) => x.id === unit.vehicleId);
  if (!car || car.health <= 0) return false;
  const p = state.player;
  const dx = p.x - car.x, dz = p.z - car.z;
  const d2 = dx * dx + dz * dz;
  if (d2 > SIGHT_RANGE * SIGHT_RANGE) return false;
  const d = Math.sqrt(d2);
  if (d > CLOSE_RANGE) {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const dot = (dx * fx + dz * fz) / (d || 1);
    if (dot < Math.cos(SIGHT_HALF_ANGLE)) return false;
  }
  return !city.segmentBlocked(car.x, car.z, p.x, p.z);
}

function setState(unit, next) {
  unit.state = next;
  unit.stateT = 0;
}

// A* a fresh route from the unit's car to a road-graph node.
function repath(unit, targetNodeId) {
  const car = unit.vehicle;
  if (!car) return;
  const from = nearestNodeId(car.x, car.z);
  unit.route = cityRef.astar(from, targetNodeId);
  unit.nodeIdx = 0;
  unit.repathT = 0;
}

function randomNodeId() {
  return rng.int(0, 168);
}

// Spawn point 60-90 units out, out of the player's view (building-blocked,
// or far + outside the ~50-degree camera cone) and outside the min radius.
// Returns {x, z} or null after 12 tries.
function pickSpawnPoint(state, ctx) {
  const p = state.player;
  const cam = ctx && ctx.camera ? ctx.camera.position : null;
  // The camera looks at the player, so its forward is player minus camera.
  let camFx = 0, camFz = 0;
  if (cam) {
    const cl = Math.hypot(p.x - cam.x, p.z - cam.z) || 1;
    camFx = (p.x - cam.x) / cl; camFz = (p.z - cam.z) / cl;
  }
  for (let i = 0; i < 12; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const r = rng.range(60, 90);
    const x = p.x + Math.sin(ang) * r;
    const z = p.z + Math.cos(ang) * r;
    if (Math.abs(x) > 255 || Math.abs(z) > 255) continue;
    const distP = Math.hypot(x - p.x, z - p.z);
    if (distP < MIN_SPAWN_DIST) continue;
    let outOfView = cityRef.segmentBlocked(p.x, p.z, x, z);
    if (!outOfView && distP > 80 && cam) {
      // Far away and outside the camera cone (~50 deg total, 25 half).
      const dx = x - cam.x, dz = z - cam.z;
      const dl = Math.hypot(dx, dz) || 1;
      const dot = (dx * camFx + dz * camFz) / dl;
      if (dot < Math.cos(Math.PI * 25 / 180)) outOfView = true;
    }
    if (outOfView) {
      const nid = nearestNodeId(x, z);
      const c = nodeCoords(nid);
      if (Math.hypot(c.x - p.x, c.z - p.z) >= MIN_SPAWN_DIST) return c;
    }
  }
  return null;
}

function spawnUnit(state, ctx) {
  const spot = pickSpawnPoint(state, ctx);
  const p = state.player;
  let x, z;
  if (spot) { x = spot.x; z = spot.z; }
  else {
    // Fallback: any node 60-90 away (still outside the minimum radius).
    const ang = rng.range(0, Math.PI * 2);
    x = Math.max(-240, Math.min(240, p.x + Math.sin(ang) * 75));
    z = Math.max(-240, Math.min(240, p.z + Math.cos(ang) * 75));
    const nid = nearestNodeId(x, z);
    const c = nodeCoords(nid);
    x = c.x; z = c.z;
  }
  const heading = Math.atan2(p.x - x, p.z - z);
  const vehicle = spawnVehicle(state, cityRef, 'patroli', x, z, heading,
    { driver: 'police', parked: false, locked: false });
  const unit = {
    id: nextId++,
    vehicleId: vehicle.id,
    vehicle,
    state: state.wanted.stars > 0 ? 'chase' : 'patrol',
    lastKnown: { x: p.x, z: p.z },
    perceptionT: rng.range(0, PERCEPTION_DT),
    lastSeenAt: -99,
    lostT: 0,
    searchT: 0,
    stateT: 0,
    route: [],
    nodeIdx: 0,
    repathT: 0,
    stuckT: 0,
    stuckCount: 0,
    lastPos: { x, z },
    fanIndex: state.police.length,
  };
  unit.stateT = 0;
  repath(unit, randomNodeId());
  if (unit.state === 'chase') repath(unit, nearestNodeId(p.x, p.z));
  state.police.push(unit);
  return unit;
}

function removeUnit(state, unit) {
  const vi = state.vehicles.findIndex((x) => x.id === unit.vehicleId);
  if (vi >= 0) state.vehicles.splice(vi, 1);
  const pi = state.police.indexOf(unit);
  if (pi >= 0) state.police.splice(pi, 1);
}

// Second anti-stuck failure: move the unit to the nearest node out of view (or far away).
function relocateOutOfView(state, unit) {
  const p = state.player;
  const car = unit.vehicle;
  for (let i = 0; i < 16; i++) {
    const nid = randomNodeId();
    const c = nodeCoords(nid);
    const d = Math.hypot(c.x - p.x, c.z - p.z);
    if (d < MIN_SPAWN_DIST) continue;
    if (cityRef.segmentBlocked(p.x, p.z, c.x, c.z) || d > 80) {
      car.x = c.x; car.z = c.z; car.speed = 0;
      car.heading = Math.atan2(p.x - c.x, p.z - c.z);
      repath(unit, nearestNodeId(p.x, p.z));
      unit.stuckCount = 0;
      unit.stuckT = 0;
      unit.lastPos = { x: c.x, z: c.z };
      return;
    }
  }
  unit.stuckCount = 0;
  unit.stuckT = 0;
}

// Steering helper: the control input for stepVehicle toward a target point.
function steerTo(unit, tx, tz, cruise) {
  const car = unit.vehicle;
  const dx = tx - car.x, dz = tz - car.z;
  const want = Math.atan2(dx, dz);
  const diff = wrapAngle(want - car.heading);
  const steer = Math.max(-1, Math.min(1, diff * 1.6));
  let throttle = 1;
  if (Math.abs(diff) > 1.2) throttle = 0.4;      // hard turn: slow down
  if (Math.abs(diff) > 2.5 && Math.abs(car.speed) < 2) throttle = -0.5; // reverse out
  if (cruise !== undefined && Math.abs(car.speed) > cruise) throttle = 0;
  return { throttle, steer, brake: false, handbrake: false };
}

// Follow the unit's cached A* route; returns a control input, or null when finished.
function followRoute(state, unit, dt, cruise) {
  const car = unit.vehicle;
  if (!unit.route || unit.nodeIdx >= unit.route.length) return null;
  const wp = nodeCoords(unit.route[unit.nodeIdx]);
  const d = Math.hypot(wp.x - car.x, wp.z - car.z);
  const reach = Math.max(4, Math.abs(car.speed) * dt + 2);
  if (d < reach) {
    unit.nodeIdx++;
    if (unit.nodeIdx >= unit.route.length) return null;
    return followRoute(state, unit, dt, cruise);
  }
  return steerTo(unit, wp.x, wp.z, cruise);
}

export function init(ctx) {
  const { state, city } = ctx;
  cityRef = city;
  rng = makeRng((state.seed || 1) + 11);
  nextId = 1;
  state.police = [];
  if (!state.wanted) state.wanted = { stars: 0, hideT: 0, blinkT: 0, searchCircle: null, captureT: 0 };
  if (state.wanted.seenByPolice === undefined) state.wanted.seenByPolice = false;
}

export function update(state, input, dt, ctx) {
  if (!state || state.mode !== 'playing' || !cityRef) return;
  const w = state.wanted;
  const p = state.player;
  const stars = w.stars;

  // --- spawn / despawn: one unit per star ---------------------------------
  const want = Math.min(5, Math.max(0, stars));
  while (state.police.length < want) spawnUnit(state, ctx);
  // Extra units (stars fell) finish their giveup instead of vanishing.
  for (const u of state.police.slice()) {
    if (u.state === 'giveup' && stars === 0) {
      const car = u.vehicle;
      if (car && Math.hypot(car.x - p.x, car.z - p.z) > DESPAWN_DIST) removeUnit(state, u);
    }
  }

  // --- perception (5 Hz, staggered) + seenByPolice aggregate ---------------
  for (const u of state.police) {
    u.perceptionT -= dt;
    if (u.perceptionT <= 0) {
      u.perceptionT = PERCEPTION_DT;
      if (unitSeesPlayer(state, cityRef, u)) {
        u.lastSeenAt = state.time;
        u.lastKnown = { x: p.x, z: p.z };
        u.lostT = 0;
      }
    }
  }
  let anySeen = false;
  for (const u of state.police) {
    if (state.time - u.lastSeenAt < 0.5) { anySeen = true; break; }
  }
  w.seenByPolice = anySeen;

  // --- FSM + driving per unit ----------------------------------------------
  const count = state.police.length;
  for (const u of state.police.slice()) {
    const car = u.vehicle;
    if (!car || car.health <= 0) {
      // Wrecked unit: its car is done; the officer gives up.
      if (u.state !== 'giveup') setState(u, 'giveup');
    }
    u.stateT += dt;
    const seenNow = state.time - u.lastSeenAt < 0.5;
    if (seenNow) u.lostT = 0; else u.lostT += dt;

    // Transitions: alerting into chase is immediate; exits need MIN_STATE_T.
    if (u.state === 'patrol') {
      if (stars > 0 || seenNow) { setState(u, 'chase'); u.lostT = 0; }
    } else if (u.state === 'suspicious') {
      if (stars > 0 || seenNow) setState(u, 'chase');
      else if (u.stateT >= MIN_STATE_T) setState(u, 'patrol');
    } else if (u.state === 'chase') {
      if (stars === 0 && u.stateT >= MIN_STATE_T) setState(u, 'giveup');
      else if (u.lostT > LOST_TO_SEARCH && u.stateT >= MIN_STATE_T) {
        setState(u, 'search');
        u.searchT = 0;
        repath(u, nearestNodeId(u.lastKnown.x, u.lastKnown.z));
      }
    } else if (u.state === 'search') {
      if (seenNow || stars > 0) setState(u, 'chase');
      else if (u.searchT >= SEARCH_SECONDS && u.stateT >= MIN_STATE_T) setState(u, 'giveup');
    } else if (u.state === 'giveup') {
      if (stars > 0 && seenNow) setState(u, 'chase');
      else if (stars === 0 && u.stateT >= MIN_STATE_T && (!u.route || u.nodeIdx >= u.route.length)) {
        // Drive away from the player; the despawn check runs at the top.
        const away = Math.atan2(car.x - p.x, car.z - p.z);
        const tx = Math.max(-240, Math.min(240, car.x + Math.sin(away) * 120));
        const tz = Math.max(-240, Math.min(240, car.z + Math.cos(away) * 120));
        repath(u, nearestNodeId(tx, tz));
        u.stateT = 0;
      }
    }

    // --- behaviour per state -------------------------------------------------
    let control = { throttle: 0, steer: 0, brake: true, handbrake: false };
    if (!car || car.health <= 0) {
      // No drivable car: stand still (the giveup path above handles removal).
    } else if (u.state === 'patrol' || u.state === 'giveup') {
      u.repathT += dt;
      if (!u.route || u.nodeIdx >= u.route.length || u.repathT > 20) {
        repath(u, randomNodeId());
      }
      control = followRoute(state, u, dt, 10) || { throttle: 0, steer: 0, brake: true, handbrake: false };
    } else if (u.state === 'suspicious') {
      // Face the player and hold position.
      control = steerTo(u, p.x, p.z, 0);
      control.throttle = 0; control.brake = true;
    } else if (u.state === 'chase') {
      // Target: live player position while seen, else last known. Lead the
      // target by 0.6 s of player velocity; fan out laterally per unit.
      const vel = playerVelocity(state);
      const tx0 = seenNow ? p.x + vel.x * 0.6 : u.lastKnown.x;
      const tz0 = seenNow ? p.z + vel.z * 0.6 : u.lastKnown.z;
      const dx = tx0 - car.x, dz = tz0 - car.z;
      const d = Math.hypot(dx, dz) || 1;
      const lat = (u.fanIndex - (count - 1) / 2) * 8;
      const tx = tx0 + (-dz / d) * lat;
      const tz = tz0 + (dx / d) * lat;
      const distP = Math.hypot(p.x - car.x, p.z - car.z);

      if (stars === 1) {
        // Tail only: keep ~15 units, never ram.
        if (distP < TAIL_DISTANCE) {
          control = { throttle: 0, steer: 0, brake: true, handbrake: false };
        } else {
          control = steerTo(u, tx, tz, 20);
        }
      } else if (!p.onFoot && distP < 25) {
        // Ram the player's car directly at close range.
        control = steerTo(u, p.x, p.z);
      } else {
        // Route on the road graph; repath when the target node moves or every 1 s.
        u.repathT += dt;
        const targetNode = nearestNodeId(tx, tz);
        const curTarget = u.chaseNode;
        if (curTarget !== targetNode || u.repathT > 1) {
          u.chaseNode = targetNode;
          repath(u, targetNode);
        }
        control = followRoute(state, u, dt) || steerTo(u, tx, tz);
      }

      // Capture: an on-foot player held within 6 units fills the meter.
      if (p.onFoot && distP < CAPTURE_RANGE) {
        w.captureT += dt;
      }
      // Contact ram damage while the player is in a car.
      if (!p.onFoot && distP < 5) {
        const pv = state.vehicles.find((x) => x.id === p.vehicleId);
        if (pv) damageVehicle(state, pv, 6 * dt);
      }
    } else if (u.state === 'search') {
      const dKnown = Math.hypot(u.lastKnown.x - car.x, u.lastKnown.z - car.z);
      if (dKnown > 5) {
        u.repathT += dt;
        if (u.repathT > 1) repath(u, nearestNodeId(u.lastKnown.x, u.lastKnown.z));
        control = followRoute(state, u, dt, 12) || { throttle: 0, steer: 0, brake: true, handbrake: false };
      } else {
        // At lastKnown: look around (slow spin) for 6 s.
        u.searchT += dt;
        control = { throttle: 0, steer: 0.6, brake: false, handbrake: false };
        car.heading += 0.6 * dt;
      }
    }

    if (car && car.health > 0) stepVehicle(state, car, control, dt, cityRef);

    // --- anti-stuck: <0.5 units in 2 s while trying to move -> repath once, then relocate ---
    u.stuckT += dt;
    if (u.stuckT >= 2) {
      const moved = Math.hypot(car.x - u.lastPos.x, car.z - u.lastPos.z);
      if (moved < 0.5 && control.throttle !== 0) {
        u.stuckCount++;
        if (u.stuckCount === 1) {
          repath(u, u.state === 'chase' ? nearestNodeId(u.lastKnown.x, u.lastKnown.z) : randomNodeId());
        } else {
          relocateOutOfView(state, u);
        }
      } else if (moved >= 0.5) {
        u.stuckCount = 0;
      }
      u.stuckT = 0;
      u.lastPos = { x: car.x, z: car.z };
    }
  }
}

export function sync(state, dt) {
  // Police cars are plain state.vehicles; vehicles-render syncs their meshes.
}
