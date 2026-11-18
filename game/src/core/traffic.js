// Teluk Cahaya — traffic AI (core sim, pure: no three.js).
// Ambient cars keep the streets alive around the player: each one follows
// a route on the road graph, stops at red lights, keeps a gap to the car
// ahead, pulls over while the player is wanted, and despawns once it is
// far away. Cars are plain entries in state.vehicles (driver 'npc') so the
// vehicle renderer draws them with no extra wiring.
import { trafficDensity } from './clock.js';

// --- tuning ---------------------------------------------------------------
const GRID_HALF = 240;      // city spans -240..240 on x and z
const GRID_STEP = 40;       // street spacing
const GRID_N = 13;          // nodes per side
const WORLD_BOUND = 258;    // hard clamp for stray cars
const DESPAWN_DIST = 210;   // beyond this a traffic car is removed
const SPAWN_MIN = 55;       // never pop in right next to the player
const SPAWN_MAX = 170;      // ...or absurdly far away
const BASE_TARGET = 5;      // cars on the road even at the quietest hour
const DENSITY_TARGET = 15;  // extra cars at full density
const CRUISE_MIN = 9;       // slowest traffic cruise speed (units/s)
const CRUISE_MAX = 14;      // fastest traffic cruise (still below the player)
const ACCEL = 4.5;          // gentle pull-away
const BRAKE = 9;            // firmer stop
const TURN_RATE = 2.4;      // max yaw speed (rad/s)
const NODE_ARRIVE = 3.5;    // close enough to count a node as reached
const LIGHT_STOP_DIST = 13; // start obeying a light this far out
const FOLLOW_GAP = 9;       // bumper gap to hold behind the car ahead
const STUCK_SECONDS = 7;    // crawling nowhere this long -> reroute

const CAR_TYPES = ['sedan', 'sedan', 'taksi', 'van', 'pikap'];
const PAINT = {
  sedan: [0xd8d8d8, 0x3a5a8c, 0x8c2f2f, 0x2f6b4f, 0xc8a03a, 0x4a4a4a],
  taksi: [0xf2c14e],
  van: [0xe8e8e8, 0x5a6a7a, 0x8a6a3a],
  pikap: [0x7a2f2f, 0x2f4a6b, 0x4a4a4a],
};

// Vehicle ids live far above the ids vehicles.js hands out (hero car + the
// parked set), so a traffic car can never collide with a parked one.
let nextTrafficId = 1;
let nextVehicleId = 10000;
let rng = null;
let rngSeed = null;

// --- tiny local rng (mulberry32) ------------------------------------------
function makeLocalRng(seed) {
  let a = (seed >>> 0) || 1;
  function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    int(min, max) { return min + Math.floor(next() * (max - min + 1)); },
    range(min, max) { return min + next() * (max - min); },
    pick(arr) { return arr[Math.floor(next() * arr.length)]; },
  };
}

function localRngFor(state) {
  if (!rng || rngSeed !== state.seed) {
    rng = makeLocalRng((state.seed || 1) * 7919 + 13);
    rngSeed = state.seed;
  }
  return rng;
}

// --- small helpers ---------------------------------------------------------
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// District by quadrant (same rule as the city generator).
function districtOf(x, z) {
  if (x < 0 && z < 0) return 'boulevard';
  if (x >= 0 && z < 0) return 'neon';
  if (x < 0 && z >= 0) return 'port';
  return 'residential';
}

// Nearest intersection id for a world position (grid math, no lookup).
function nearestNodeId(x, z) {
  const ix = clamp(Math.round((x + GRID_HALF) / GRID_STEP), 0, GRID_N - 1);
  const iz = clamp(Math.round((z + GRID_HALF) / GRID_STEP), 0, GRID_N - 1);
  return iz * GRID_N + ix;
}

// Traffic lights keyed by node id; rebuilt only when the city changes.
let lightCacheCity = null;
let lightCacheMap = null;
function lightsByNode(city) {
  if (city !== lightCacheCity) {
    lightCacheMap = new Map();
    for (const light of city.trafficLights || []) lightCacheMap.set(light.nodeId, light);
    lightCacheCity = city;
  }
  return lightCacheMap;
}

// Is this light green for traffic moving north-south right now?
function lightGreenNs(city, light, time) {
  if (typeof city.lightState === 'function') return city.lightState(light, time) === 'ns';
  const period = light.period || 12;
  const phase = (time + (light.offset || 0)) % period;
  return phase < period / 2;
}

// Free gap to the nearest vehicle ahead in this car's lane (Infinity if
// the road ahead is clear). Only cars roughly straight ahead count.
function gapAhead(state, v) {
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  let best = Infinity;
  for (const o of state.vehicles) {
    if (o === v || o.health <= 0) continue;
    const dx = o.x - v.x, dz = o.z - v.z;
    const along = dx * fx + dz * fz;
    if (along < 0 || along > 26) continue;
    const side = Math.abs(dx * fz - dz * fx);
    if (side > 3.2) continue;
    if (along < best) best = along;
  }
  return best;
}

function freshRoute(city, rngObj, fromId) {
  const route = city.randomRoute(rngObj, fromId);
  return route && route.length > 0 ? route : [fromId];
}

// --- spawning --------------------------------------------------------------
// Try to put one new traffic car on the road. Returns true on success.
function trySpawn(state, city, rngObj) {
  const p = state.player;
  for (let attempt = 0; attempt < 8; attempt++) {
    const nodeId = rngObj.int(0, city.nodes.length - 1);
    const node = city.nodes[nodeId];
    if (!node) continue;
    const d = Math.hypot(node.x - p.x, node.z - p.z);
    if (d < SPAWN_MIN || d > SPAWN_MAX) continue;
    // Avoid materialising in the player's forward view when close.
    if (d < 95) {
      const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
      const ahead = ((node.x - p.x) * fx + (node.z - p.z) * fz) / d;
      if (ahead > 0.4) continue;
    }
    let crowded = false;
    for (const o of state.vehicles) {
      if (Math.hypot(o.x - node.x, o.z - node.z) < 9) { crowded = true; break; }
    }
    if (crowded) continue;

    const route = freshRoute(city, rngObj, nodeId);
    if (route.length < 2) continue;
    const next = city.nodes[route[1]];
    const type = rngObj.pick(CAR_TYPES);
    const paints = PAINT[type] || PAINT.sedan;
    const v = {
      id: nextVehicleId++,
      type,
      x: node.x, z: node.z,
      heading: Math.atan2(next.x - node.x, next.z - node.z),
      speed: 0, steer: 0,
      color: rngObj.pick(paints),
      health: 100,
      driver: 'npc',
      parked: false, locked: false, stolen: false, wantedMarked: false,
    };
    state.vehicles.push(v);
    state.traffic.push({
      id: nextTrafficId++,
      vehicleId: v.id,
      route,
      nodeIdx: 1,
      state: 'drive',
      waitT: 0,
      cruise: rngObj.range(CRUISE_MIN, CRUISE_MAX),
      stuckT: 0,
    });
    return true;
  }
  return false;
}

// --- per-car step -----------------------------------------------------------
function stepTrafficCar(state, city, entry, v, dt, wanted) {
  // Wanted: pull over and wait it out; resume when the heat is off.
  if (wanted && entry.state !== 'pullover') {
    entry.state = 'pullover';
    entry.waitT = 0;
  } else if (!wanted && entry.state === 'pullover') {
    entry.state = 'drive';
    entry.waitT = 0;
  }

  // Route exhausted -> pick a new destination from where we are.
  if (!entry.route || entry.nodeIdx >= entry.route.length) {
    entry.route = freshRoute(city, rng, nearestNodeId(v.x, v.z));
    entry.nodeIdx = entry.route.length > 1 ? 1 : 0;
  }
  const target = city.nodes[entry.route[entry.nodeIdx]];
  if (!target) return;
  const dx = target.x - v.x, dz = target.z - v.z;
  const dist = Math.hypot(dx, dz);

  // Red light at the target intersection? Stop before the line.
  let redLight = false;
  if (dist < LIGHT_STOP_DIST + 4) {
    const light = lightsByNode(city).get(target.id);
    if (light) {
      const movingNs = Math.abs(dz) > Math.abs(dx);
      const greenNs = lightGreenNs(city, light, state.time);
      redLight = movingNs ? !greenNs : greenNs;
    }
  }

  // Desired speed: cruise, slowed by a red light or a car ahead, zero
  // while pulled over.
  let desired = entry.state === 'pullover' ? 0 : entry.cruise;
  if (redLight) desired = 0;
  if (desired > 0) {
    const gap = gapAhead(state, v);
    if (gap < FOLLOW_GAP + 6) {
      desired = Math.min(desired, Math.max(0, (gap - FOLLOW_GAP) * 1.4));
    }
  }

  // Arrive at the node (but not while waiting at a red light on top of it).
  if (dist < NODE_ARRIVE && !redLight) {
    entry.nodeIdx++;
    entry.stuckT = 0;
    return;
  }

  // Steering: ease the nose toward the target node, never snap.
  const wantHeading = Math.atan2(dx, dz);
  const dh = wrapAngle(wantHeading - v.heading);
  v.heading += clamp(dh, -TURN_RATE * dt, TURN_RATE * dt);
  v.steer = clamp(dh * 0.6, -1, 1);

  // Speed: smooth accel / firmer braking, crawl through sharp turns.
  let cap = desired;
  if (Math.abs(dh) > 0.9) cap = Math.min(cap, 4);
  if (v.speed < cap) v.speed = Math.min(cap, v.speed + ACCEL * dt);
  else if (v.speed > cap) v.speed = Math.max(cap, v.speed - BRAKE * dt);

  v.x += Math.sin(v.heading) * v.speed * dt;
  v.z += Math.cos(v.heading) * v.speed * dt;
  v.x = clamp(v.x, -WORLD_BOUND, WORLD_BOUND);
  v.z = clamp(v.z, -WORLD_BOUND, WORLD_BOUND);

  // Stuck (not a light, not traffic, just going nowhere) -> new route.
  if (entry.state === 'drive' && v.speed < 0.4 && desired > 1 && !redLight) {
    entry.stuckT += dt;
    if (entry.stuckT > STUCK_SECONDS) {
      entry.route = freshRoute(city, rng, nearestNodeId(v.x, v.z));
      entry.nodeIdx = entry.route.length > 1 ? 1 : 0;
      entry.stuckT = 0;
    }
  } else {
    entry.stuckT = 0;
  }
  if (desired === 0 && v.speed < 0.1) entry.waitT += dt;
  else entry.waitT = 0;
}

// --- slice interface --------------------------------------------------------
export function init(ctx) {
  if (ctx && ctx.state) ctx.state.traffic = [];
  nextTrafficId = 1;
  nextVehicleId = 10000;
  rng = null;
  rngSeed = null;
}

export function update(state, input, dt, ctx) {
  if (state.mode !== 'playing') return;
  if (!ctx || !ctx.city) return;
  if (!state.traffic) state.traffic = [];
  if (dt <= 0) return;
  const city = ctx.city;
  const p = state.player;
  const rngObj = localRngFor(state);

  // How many cars should be out: denser at rush hour, busier in Neon
  // at night — trafficDensity already folds the hour and district in.
  const density = trafficDensity(state.clock, districtOf(p.x, p.z));
  const target = Math.round(BASE_TARGET + density * DENSITY_TARGET);
  let spawned = 0;
  while (state.traffic.length < target && spawned < 2) {
    if (trySpawn(state, city, rngObj)) spawned++;
    else break;
  }

  const wanted = !!(state.wanted && state.wanted.stars > 0);
  for (let i = state.traffic.length - 1; i >= 0; i--) {
    const entry = state.traffic[i];
    const v = state.vehicles.find((x) => x.id === entry.vehicleId);
    if (!v) { state.traffic.splice(i, 1); continue; }
    // Wrecked, or no longer an npc car (player stole it, police took it):
    // traffic stops owning it, the vehicle itself stays in the world.
    if (v.health <= 0 || v.driver !== 'npc') {
      if (v.health <= 0) v.driver = null;
      state.traffic.splice(i, 1);
      continue;
    }
    // Too far from the player: take the car off the road entirely.
    if (Math.hypot(v.x - p.x, v.z - p.z) > DESPAWN_DIST) {
      const vi = state.vehicles.indexOf(v);
      if (vi >= 0) state.vehicles.splice(vi, 1);
      state.traffic.splice(i, 1);
      continue;
    }
    stepTrafficCar(state, city, entry, v, dt, wanted);
  }
}
