// Teluk Cahaya — traffic slice (core sim, pure: no three.js).
// NPC cars driving the road graph around the player: route following,
// red-light stops, queueing behind stopped cars, pull-over at wanted,
// density from the city clock, anti-jam replan. Cars are plain vehicles
// in state.vehicles (driver 'npc'); this module owns the traffic entries
// in state.traffic and drives them through stepVehicle.
import { makeRng } from './rng.js';
import { trafficDensity } from './clock.js';
import { nodeCoords, nearestNodeId, districtAt } from './city.js';
import { spawnVehicle, stepVehicle, VEHICLE_TYPES } from './vehicles.js';

const BASE_TARGET = 10;      // cars at density 1.0
const SPAWN_NEAR = 60;       // spawn band around the player (avoid pops)
const SPAWN_FAR = 150;
const DESPAWN_FAR = 220;
const LANE_OFFSET = 2.4;     // right-hand lane offset from the centre line
const LIGHT_STOP_MIN = 5;    // do not stop once this close to the node
const LIGHT_STOP_MAX = 18;   // start braking inside this range
const FOLLOW_DIST = 12;      // car-ahead check range
const FOLLOW_LAT = 3;        // car-ahead lateral tolerance
const STUCK_DIST = 0.5;      // anti-jam: less than this in STUCK_TIME = stuck
const STUCK_TIME = 3;

let rng = makeRng(1);
let nextId = 1;
let spawnT = 0;
const lightByNode = new Map(); // nodeId -> traffic light

const TYPES = ['sedan', 'sedan', 'sedan', 'taksi', 'taksi', 'van', 'pikap', 'sport'];
const SEDAN_COLORS = [0xd8d8d8, 0x3a5a8c, 0x8c2f2f, 0x2f6b4f, 0xc8a03a, 0x4a4a4a];

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

// A route that always has at least two nodes (so there is a leg to drive).
function makeRoute(city, fromId) {
  for (let i = 0; i < 4; i++) {
    const route = city.randomRoute(rng, fromId);
    if (route && route.length >= 2) return route;
  }
  const edges = city.edges.get(fromId);
  if (edges && edges.length > 0) return [fromId, edges[0].to];
  return [fromId];
}

function chooseSpawnNode(state) {
  const p = state.player;
  for (let i = 0; i < 24; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(SPAWN_NEAR, SPAWN_FAR);
    const id = nearestNodeId(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
    const c = nodeCoords(id);
    const d = Math.hypot(c.x - p.x, c.z - p.z);
    if (d >= SPAWN_NEAR - 20 && d <= SPAWN_FAR) return id;
  }
  return nearestNodeId(p.x + SPAWN_NEAR, p.z);
}

function addTrafficCar(state, city) {
  const nodeId = chooseSpawnNode(state);
  const c = nodeCoords(nodeId);
  const route = makeRoute(city, nodeId);
  if (route.length < 2) return null;
  const type = rng.pick(TYPES);
  const spec = VEHICLE_TYPES[type];
  const cruise = Math.min(rng.range(8, 14), spec.top * 0.75);
  // Start on the road, heading along the first leg.
  const next = nodeCoords(route[1]);
  const legDx = next.x - c.x, legDz = next.z - c.z;
  const legLen = Math.hypot(legDx, legDz) || 1;
  // Right-hand lane: offset to the right of the leg direction.
  const rx = -legDz / legLen, rz = legDx / legLen;
  const x = c.x + rx * LANE_OFFSET + rng.range(-1, 1);
  const z = c.z + rz * LANE_OFFSET + rng.range(-1, 1);
  const heading = Math.atan2(legDx, legDz);
  const color = type === 'sedan' ? rng.pick(SEDAN_COLORS) : spec.color;
  const v = spawnVehicle(state, city, type, x, z, heading,
    { driver: 'npc', parked: false, color });
  const t = {
    id: nextId++,
    vehicleId: v.id,
    route,
    nodeIdx: 1,
    state: 'drive', // 'drive' | 'stop' | 'pullover'
    waitT: 0,
    cruise,
    stuckT: 0,
    checkX: x,
    checkZ: z,
    replans: 0,
    pullX: 0,
    pullZ: 0,
  };
  state.traffic.push(t);
  return t;
}

function dropTrafficCar(state, t) {
  const i = state.traffic.indexOf(t);
  if (i >= 0) state.traffic.splice(i, 1);
  const vi = state.vehicles.findIndex((v) => v.id === t.vehicleId);
  if (vi >= 0) state.vehicles.splice(vi, 1);
}

function replan(t, state, city, vehicle) {
  const fromId = nearestNodeId(vehicle.x, vehicle.z);
  t.route = makeRoute(city, fromId);
  t.nodeIdx = 1;
  t.stuckT = 0;
  t.checkX = vehicle.x;
  t.checkZ = vehicle.z;
}

export function init(ctx) {
  const { state, city } = ctx;
  state.traffic = [];
  rng = makeRng((state.seed || 1) + 11);
  nextId = 1;
  spawnT = 0;
  lightByNode.clear();
  for (const light of city.trafficLights) lightByNode.set(light.nodeId, light);
  const density = trafficDensity(state.clock, districtAt(state.player.x, state.player.z));
  const target = Math.round(BASE_TARGET * density);
  for (let i = 0; i < target; i++) addTrafficCar(state, city);
}

export function update(state, input, dt, ctx) {
  if (state.mode !== 'playing' || dt <= 0) return;
  const city = ctx.city;
  const p = state.player;

  // --- population: density target, spawn in, despawn out ------------------
  const density = trafficDensity(state.clock, districtAt(p.x, p.z));
  const target = Math.max(0, Math.min(12, Math.round(BASE_TARGET * density)));
  spawnT += dt;
  if (state.traffic.length < target && spawnT > 0.4) {
    spawnT = 0;
    addTrafficCar(state, city);
  }
  for (let i = state.traffic.length - 1; i >= 0; i--) {
    const t = state.traffic[i];
    const v = state.vehicles.find((x) => x.id === t.vehicleId);
    if (!v || v.health <= 0) { dropTrafficCar(state, t); continue; }
    if (v.driver !== 'npc') { // player stole it (or police took it): release
      state.traffic.splice(i, 1);
      continue;
    }
    if (dist2(v.x, v.z, p.x, p.z) > DESPAWN_FAR * DESPAWN_FAR) {
      dropTrafficCar(state, t);
    }
  }

  // --- per-car driving ------------------------------------------------------
  for (const t of state.traffic) {
    const v = state.vehicles.find((x) => x.id === t.vehicleId);
    if (!v) continue;

    // Wanted: pull over to the road edge and stop.
    if (state.wanted.stars > 0 && t.state !== 'pullover') {
      const side = rng.sign();
      const rx = -Math.cos(v.heading) * side, rz = Math.sin(v.heading) * side;
      const c = city.collideCircle(v.x + rx * 3.5, v.z + rz * 3.5, 2.2);
      t.pullX = c.x; t.pullZ = c.z;
      t.state = 'pullover';
    } else if (state.wanted.stars === 0 && t.state === 'pullover') {
      t.state = 'drive';
      replan(t, state, city, v);
    }

    if (t.state === 'pullover') {
      const dx = t.pullX - v.x, dz = t.pullZ - v.z;
      const d = Math.hypot(dx, dz);
      const desired = d > 3 ? 4 : 0;
      const steer = clamp(wrapAngle(Math.atan2(dx, dz) - v.heading) * 1.8, -1, 1);
      const throttle = clamp((desired - v.speed) * 0.4, -1, 1);
      stepVehicle(state, v, {
        throttle, steer,
        brake: desired === 0 && v.speed > 0.3, handbrake: false,
      }, dt, city);
      t.stuckT = 0;
      continue;
    }

    // --- route: current leg target (right-hand lane offset) ----------------
    if (t.nodeIdx >= t.route.length) replan(t, state, city, v);
    const nodeId = t.route[t.nodeIdx];
    const prevId = t.route[Math.max(0, t.nodeIdx - 1)];
    const nc = nodeCoords(nodeId);
    const pc = nodeCoords(prevId);
    const legDx = nc.x - pc.x, legDz = nc.z - pc.z;
    const legLen = Math.hypot(legDx, legDz) || 1;
    const rx = -legDz / legLen, rz = legDx / legLen;
    const tx = nc.x + rx * LANE_OFFSET, tz = nc.z + rz * LANE_OFFSET;
    const distToNode = Math.hypot(tx - v.x, tz - v.z);
    // Reached the node: advance. Early advance keeps turns tight.
    if (distToNode < 5) {
      t.nodeIdx++;
      if (t.nodeIdx >= t.route.length) replan(t, state, city, v);
      continue;
    }

    let desired = t.cruise;

    // Slow for a sharp turn ahead.
    if (t.nodeIdx + 1 < t.route.length && distToNode < 16) {
      const nn = nodeCoords(t.route[t.nodeIdx + 1]);
      const turn = Math.abs(wrapAngle(
        Math.atan2(nn.x - nc.x, nn.z - nc.z) - Math.atan2(legDx, legDz)));
      if (turn > 0.6) desired = Math.min(desired, 5);
    }

    // Red light at the next node: stop before the intersection.
    const light = lightByNode.get(nodeId);
    if (light && distToNode > LIGHT_STOP_MIN && distToNode < LIGHT_STOP_MAX) {
      const axis = Math.abs(legDx) > Math.abs(legDz) ? 'ew' : 'ns';
      if (city.lightState(light, state.time) !== axis) desired = 0;
    }

    // Car ahead: same direction -> follow its speed; oncoming -> ease right.
    let steerBias = 0;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const rX = -Math.cos(v.heading), rZ = Math.sin(v.heading);
    for (const other of state.vehicles) {
      if (other === v || other.health <= 0 || other.parked) continue;
      if (other.driver !== 'npc' && other.driver !== 'player') continue;
      const dx = other.x - v.x, dz = other.z - v.z;
      const fwd = dx * fx + dz * fz;
      if (fwd <= 0 || fwd > FOLLOW_DIST + 3) continue;
      const lat = dx * rX + dz * rZ;
      if (Math.abs(lat) >= FOLLOW_LAT + 1) continue;
      const sameDir = Math.sin(other.heading) * fx + Math.cos(other.heading) * fz;
      if (sameDir > 0.3) {
        // Same direction: never drive into the car ahead.
        if (fwd < FOLLOW_DIST) desired = Math.min(desired, other.speed);
        if (fwd < 6) desired = Math.min(desired, other.speed > 0.5 ? other.speed * 0.5 : 0);
      } else if (sameDir < -0.3) {
        // Oncoming in our lane: slow a touch and edge to our right.
        if (fwd < 15) {
          desired = Math.min(desired, t.cruise * 0.7);
          steerBias = (lat >= 0 ? -1 : 1) * 0.45;
        }
      }
    }

    // --- steer + throttle ---------------------------------------------------
    const steer = clamp(
      wrapAngle(Math.atan2(tx - v.x, tz - v.z) - v.heading) * 1.8 + steerBias, -1, 1);
    const throttle = clamp((desired - v.speed) * 0.4, -1, 1);
    stepVehicle(state, v, {
      throttle, steer,
      brake: desired === 0 && v.speed > 0.3, handbrake: false,
    }, dt, city);

    t.state = desired === 0 ? 'stop' : 'drive';
    if (t.state === 'stop') t.waitT += dt; else t.waitT = 0;

    // --- anti-jam: no progress while wanting to move -> replan, then teleport
    if (desired > 1) {
      if (dist2(v.x, v.z, t.checkX, t.checkZ) > STUCK_DIST * STUCK_DIST) {
        t.checkX = v.x; t.checkZ = v.z; t.stuckT = 0;
      } else {
        t.stuckT += dt;
        if (t.stuckT > STUCK_TIME) {
          t.replans++;
          if (t.replans >= 2) {
            const n = nodeCoords(nearestNodeId(v.x, v.z));
            v.x = n.x; v.z = n.z; v.speed = 0;
            t.replans = 0;
          }
          replan(t, state, city, v);
        }
      }
    } else {
      t.stuckT = 0;
      t.checkX = v.x; t.checkZ = v.z;
    }
  }
}
