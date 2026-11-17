// Teluk Cahaya — pedestrians slice (core sim, pure: no three.js).
// Sidewalk walkers around the player: node-to-node routes with a lateral
// sidewalk offset, stop-and-look pauses, sidestep avoidance of cars,
// panic flight, and witnesses who report a seen crime after ~2 s unless
// interrupted. State lives in state.peds; the render slice mirrors it.
import { makeRng } from './rng.js';
import { nodeCoords, nearestNodeId } from './city.js';

const TARGET_PEDS = 14;
const SPAWN_NEAR = 30;       // spawn band around the player (avoid pops)
const SPAWN_FAR = 120;
const DESPAWN_FAR = 180;
const REPORT_RANGE = 25;     // witness line-of-sight range
const REPORT_TIME = 2;       // seconds of uninterrupted reporting
const PANIC_PUNCH_RANGE = 10;
const PANIC_CAR_RANGE = 6;
const PANIC_SPEED = 7;
const AVOID_RANGE = 4.5;
const LEG_TIMEOUT = 10;      // give up on a leg after this long (stuck guard)

let rng = makeRng(1);
let nextId = 1;
let spawnT = 0;
let subscribed = false;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Distance from (x,z) to the nearest road centre line (grid lines every 40).
function roadDist(x, z) {
  const gx = ((x + 240) % 40 + 40) % 40;
  const gz = ((z + 240) % 40 + 40) % 40;
  return Math.min(Math.min(gx, 40 - gx), Math.min(gz, 40 - gz));
}

// A route that always has at least two nodes.
function planRoute(city, fromId) {
  for (let i = 0; i < 4; i++) {
    const route = city.randomRoute(rng, fromId);
    if (route && route.length >= 2) return route;
  }
  const edges = city.edges.get(fromId);
  if (edges && edges.length > 0) return [fromId, edges[0].to];
  return [fromId];
}

// Target point for the current leg: the next node, pushed sideways onto
// the sidewalk (fixed side + offset per ped), then out of any building.
function legTarget(ped, city) {
  const nodeId = ped.route[ped.nodeIdx];
  const prevId = ped.route[Math.max(0, ped.nodeIdx - 1)];
  const nc = nodeCoords(nodeId);
  const pc = nodeCoords(prevId);
  const dx = nc.x - pc.x, dz = nc.z - pc.z;
  const len = Math.hypot(dx, dz) || 1;
  const px = -dz / len * ped.side * ped.offset;
  const pz = dx / len * ped.side * ped.offset;
  const c = city.collideCircle(nc.x + px, nc.z + pz, 0.6);
  return { x: c.x, z: c.z };
}

function spawnPed(state, city) {
  const p = state.player;
  let nodeId = -1, x = p.x, z = p.z;
  for (let i = 0; i < 24; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(SPAWN_NEAR, SPAWN_FAR);
    const id = nearestNodeId(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
    const c = nodeCoords(id);
    if (Math.hypot(c.x - p.x, c.z - p.z) <= SPAWN_FAR) { nodeId = id; break; }
  }
  if (nodeId < 0) nodeId = nearestNodeId(p.x + SPAWN_NEAR, p.z);
  const route = planRoute(city, nodeId);
  const side = rng.sign();
  const offset = rng.range(6, 10);
  const c0 = nodeCoords(nodeId);
  const start = city.collideCircle(
    c0.x + rng.range(-4, 4), c0.z + rng.range(-4, 4), 0.6);
  x = start.x; z = start.z;
  const ped = {
    id: nextId++,
    x, z,
    heading: rng.range(0, Math.PI * 2),
    state: 'walk', // 'walk' | 'stop' | 'avoid' | 'panic'
    speed: 0,
    target: { x, z },
    isWitness: rng.chance(0.3),
    reportT: 0,
    panicT: 0,
    // --- internals (not in the ARCHITECTURE shape, owned by this slice) ---
    baseSpeed: rng.range(1.2, 2),
    route,
    nodeIdx: 1,
    side,
    offset,
    stopT: 0,
    lookDir: 1,
    avoidT: 0,
    avoidX: 0,
    avoidZ: 0,
    fleeX: 0,
    fleeZ: 0,
    reportX: 0,
    reportZ: 0,
    legT: 0,
  };
  ped.target = legTarget(ped, city);
  state.peds.push(ped);
  return ped;
}

function startPanic(ped, fromX, fromZ, dur) {
  // Panic cancels an in-progress report (the witness flees instead).
  ped.reportT = 0;
  ped.state = 'panic';
  ped.panicT = dur ?? rng.range(3, 5);
  let dx = ped.x - fromX, dz = ped.z - fromZ;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) { dx = 1; dz = 0; }
  else { dx /= len; dz /= len; }
  ped.fleeX = dx; ped.fleeZ = dz;
  ped.heading = Math.atan2(dx, dz);
  ped.speed = PANIC_SPEED;
}

function onCrimeSeen(state, city, data) {
  if (!data) return;
  // One report at a time: if a witness is already reporting, ignore.
  for (const ped of state.peds) if (ped.reportT > 0) return;
  let best = null, bestD = REPORT_RANGE;
  for (const ped of state.peds) {
    if (!ped.isWitness || ped.state === 'panic') continue;
    const d = Math.hypot(ped.x - data.x, ped.z - data.z);
    if (d > bestD) continue;
    if (city.segmentBlocked(ped.x, ped.z, data.x, data.z)) continue;
    best = ped; bestD = d;
  }
  if (!best) return;
  best.reportT = REPORT_TIME;
  best.reportX = data.x;
  best.reportZ = data.z;
  best.state = 'stop';
  best.stopT = 0;
  best.speed = 0;
  best.heading = Math.atan2(data.x - best.x, data.z - best.z);
}

function onPunch(state, data) {
  // A punch nearby panics every ped in range (player position at emit time).
  const px = state.player.x, pz = state.player.z;
  for (const ped of state.peds) {
    if (ped.state === 'panic') continue;
    if (Math.hypot(ped.x - px, ped.z - pz) <= PANIC_PUNCH_RANGE) {
      startPanic(ped, px, pz);
    }
  }
}

export function init(ctx) {
  const { state, city } = ctx;
  state.peds = [];
  rng = makeRng((state.seed || 1) + 23);
  nextId = 1;
  spawnT = 0;
  if (!subscribed) {
    subscribed = true;
    state.events.on('crimeSeen', (data) => onCrimeSeen(state, city, data));
    state.events.on('punch', () => onPunch(state));
  }
  for (let i = 0; i < TARGET_PEDS; i++) spawnPed(state, city);
}

export function update(state, input, dt, ctx) {
  if (state.mode !== 'playing' || dt <= 0) return;
  const city = ctx.city;
  const p = state.player;

  // --- population -----------------------------------------------------------
  spawnT += dt;
  if (state.peds.length < TARGET_PEDS && spawnT > 0.5) {
    spawnT = 0;
    spawnPed(state, city);
  }
  for (let i = state.peds.length - 1; i >= 0; i--) {
    const ped = state.peds[i];
    if (Math.hypot(ped.x - p.x, ped.z - p.z) > DESPAWN_FAR) {
      state.peds.splice(i, 1);
    }
  }

  // --- per-ped FSM -----------------------------------------------------------
  for (const ped of state.peds) {
    // Reporting: stand still, face the crime; finish -> witnessReported.
    if (ped.reportT > 0) {
      ped.state = 'stop';
      ped.speed = 0;
      ped.heading = Math.atan2(ped.reportX - ped.x, ped.reportZ - ped.z);
      ped.reportT -= dt;
      if (ped.reportT <= 0) {
        ped.reportT = 0;
        state.events.emit('witnessReported', { x: ped.reportX, z: ped.reportZ });
        ped.state = 'walk';
        ped.route = planRoute(city, nearestNodeId(ped.x, ped.z));
        ped.nodeIdx = 1;
        ped.target = legTarget(ped, city);
        ped.legT = 0;
      }
      continue;
    }

    if (ped.state === 'panic') {
      ped.panicT -= dt;
      ped.speed = PANIC_SPEED;
      ped.heading = Math.atan2(ped.fleeX, ped.fleeZ);
      ped.x += ped.fleeX * PANIC_SPEED * dt;
      ped.z += ped.fleeZ * PANIC_SPEED * dt;
      const c = city.collideCircle(ped.x, ped.z, 0.5);
      ped.x = c.x; ped.z = c.z;
      if (ped.panicT <= 0) {
        ped.state = 'walk';
        ped.speed = 0;
        ped.route = planRoute(city, nearestNodeId(ped.x, ped.z));
        ped.nodeIdx = 1;
        ped.target = legTarget(ped, city);
        ped.legT = 0;
      }
      continue;
    }

    if (ped.state === 'stop') {
      ped.speed = 0;
      ped.stopT -= dt;
      // Look around while waiting.
      ped.heading += ped.lookDir * 0.4 * dt;
      if (rng.chance(dt * 0.5)) ped.lookDir *= -1;
      if (ped.stopT <= 0) {
        ped.state = 'walk';
        if (ped.nodeIdx >= ped.route.length) {
          ped.route = planRoute(city, nearestNodeId(ped.x, ped.z));
          ped.nodeIdx = 1;
        }
        ped.target = legTarget(ped, city);
        ped.legT = 0;
      }
      continue;
    }

    if (ped.state === 'avoid') {
      ped.avoidT -= dt;
      ped.speed = 2;
      ped.x += ped.avoidX * 2 * dt;
      ped.z += ped.avoidZ * 2 * dt;
      const c = city.collideCircle(ped.x, ped.z, 0.5);
      ped.x = c.x; ped.z = c.z;
      if (ped.avoidT <= 0) {
        ped.state = 'walk';
        ped.target = legTarget(ped, city);
        ped.legT = 0;
      }
      continue;
    }

    // --- walk: car on the sidewalk nearby -> panic --------------------------
    for (const v of state.vehicles) {
      if (v.health <= 0 || Math.abs(v.speed) < 2) continue;
      const d = Math.hypot(v.x - ped.x, v.z - ped.z);
      if (d < PANIC_CAR_RANGE && roadDist(v.x, v.z) > 4) {
        startPanic(ped, v.x, v.z);
        break;
      }
    }
    if (ped.state === 'panic') continue;

    // --- walk: car ahead -> sidestep ----------------------------------------
    for (const v of state.vehicles) {
      if (v.health <= 0 || Math.abs(v.speed) < 0.5) continue;
      const dx = v.x - ped.x, dz = v.z - ped.z;
      const d = Math.hypot(dx, dz);
      if (d > AVOID_RANGE) continue;
      const fx = Math.sin(ped.heading), fz = Math.cos(ped.heading);
      if ((dx * fx + dz * fz) / (d || 1) < 0.2) continue; // not ahead of us
      // Sidestep directly away from the car.
      let ax = -dx / (d || 1), az = -dz / (d || 1);
      const al = Math.hypot(ax, az) || 1;
      ped.avoidX = ax / al; ped.avoidZ = az / al;
      ped.avoidT = 0.8;
      ped.state = 'avoid';
      break;
    }
    if (ped.state === 'avoid') continue;

    // --- walk: follow the leg ------------------------------------------------
    ped.legT += dt;
    const dx = ped.target.x - ped.x, dz = ped.target.z - ped.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.2 || ped.legT > LEG_TIMEOUT) {
      ped.legT = 0;
      ped.nodeIdx++;
      if (ped.nodeIdx >= ped.route.length) {
        // End of route: sometimes pause at this spot, else a new route.
        if (rng.chance(0.35)) {
          ped.state = 'stop';
          ped.stopT = rng.range(2, 6);
          ped.speed = 0;
          ped.lookDir = rng.sign();
          continue;
        }
        ped.route = planRoute(city, nearestNodeId(ped.x, ped.z));
        ped.nodeIdx = 1;
      } else if (rng.chance(0.08)) {
        ped.state = 'stop';
        ped.stopT = rng.range(2, 4);
        ped.speed = 0;
        ped.lookDir = rng.sign();
        continue;
      }
      ped.target = legTarget(ped, city);
      continue;
    }
    ped.speed = ped.baseSpeed;
    ped.heading = Math.atan2(dx, dz);
    ped.x += (dx / d) * ped.speed * dt;
    ped.z += (dz / d) * ped.speed * dt;
    const c = city.collideCircle(ped.x, ped.z, 0.5);
    ped.x = c.x; ped.z = c.z;
  }

  // --- ped-vs-ped separation (cheap O(n^2), n ~ 14) -------------------------
  for (let i = 0; i < state.peds.length; i++) {
    for (let j = i + 1; j < state.peds.length; j++) {
      const a = state.peds[i], b = state.peds[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= 1 || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (1 - d) / 2;
      const nx = dx / d, nz = dz / d;
      a.x -= nx * push; a.z -= nz * push;
      b.x += nx * push; b.z += nz * push;
    }
  }
}
