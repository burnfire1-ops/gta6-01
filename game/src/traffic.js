import { clamp, turnToward } from './vehicles.js';
import { nodePos } from './police-pursuit.js';

const NPC_TYPES = ['sedan', 'taxi', 'van', 'pickup', 'sedan', 'taxi', 'sedan'];
const LANE = 2.5; // offset lajur kanan dari as jalan (CP17)
const CAR_GAP = 4.4; // jarak pusat minimum antar mobil (CP17)
let sepFrame = 0;

function separateCars(cars) {
  sepFrame++;
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    if (!a || !a.pos) continue;
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      if (!b || !b.pos) continue;
      if (!a.driver && !b.driver) continue;
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= CAR_GAP * CAR_GAP || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d, nz = dz / d;
      const push = (CAR_GAP - d) / (a.driver && b.driver ? 2 : 1);
      if (a.driver) { a.pos.x -= nx * push; a.pos.z -= nz * push; }
      if (b.driver) { b.pos.x += nx * push; b.pos.z += nz * push; }
      const avx = Math.sin(a.heading) * a.speed, avz = Math.cos(a.heading) * a.speed;
      const bvx = Math.sin(b.heading) * b.speed, bvz = Math.cos(b.heading) * b.speed;
      const closing = (avx - bvx) * nx + (avz - bvz) * nz;
      if (closing > 6 && a.driver && b.driver) {
        if (sepFrame - (a._sepDmg || 0) > 30) {
          a.health = Math.max(0, a.health - Math.min(15, (closing - 6) * 1.2));
          a._sepDmg = sepFrame;
        }
        if (sepFrame - (b._sepDmg || 0) > 30) {
          b.health = Math.max(0, b.health - Math.min(15, (closing - 6) * 1.2));
          b._sepDmg = sepFrame;
        }
        const as = a.speed, bs = b.speed;
        a.speed = as * 0.3 + bs * 0.7;
        b.speed = bs * 0.3 + as * 0.7;
      }
      const fa = Math.sin(a.heading) * nx + Math.cos(a.heading) * nz;
      const fb = Math.sin(b.heading) * nx + Math.cos(b.heading) * nz;
      if (fa * a.speed > 0 && Math.abs(fa) > 0.5) a.speed = 0;
      if (fb * b.speed < 0 && Math.abs(fb) > 0.5) b.speed = 0;
    }
  }
}

function randomNode(graph, rand) {
  if (graph && typeof graph.randomRoadNode === 'function') {
    const n = graph.randomRoadNode(rand, 0);
    if (n) return n;
  }
  return null;
}

function planRoute(graph, fromId, toId) {
  if (graph && typeof graph.findPathAStar === 'function') {
    try {
      const path = graph.findPathAStar(fromId, toId);
      if (Array.isArray(path) && path.length) return path;
    } catch (e) {  }
  }
  return [fromId, toId].filter((v, i, a) => a.indexOf(v) === i);
}

function advance(c, d) {
  c.pos.x += Math.sin(c.heading) * c.speed * d;
  c.pos.z += Math.cos(c.heading) * c.speed * d;
}

export function createTraffic(scene, graph, fleet, rng) {
  const rand = typeof rng === 'function' ? rng : Math.random;
  const cars = [];

  function newRoute(car) {
    const from = graph && typeof graph.nearestNode === 'function'
      ? graph.nearestNode(car.pos.x, car.pos.z) : randomNode(graph, rand);
    const fromId = from ? from.id : null;
    const dest = randomNode(graph, rand);
    if (!fromId || !dest) { car._t.route = []; return; }
    car._t.route = planRoute(graph, fromId, dest.id);
    car._t.wp = 0;
    const n0 = nodePos(graph, fromId);
    if (n0 && Math.hypot(n0.x - car.pos.x, n0.z - car.pos.z) < 3) car._t.wp = 1;
  }

  for (let i = 0; i < 28; i++) {
    const type = NPC_TYPES[Math.floor(rand() * NPC_TYPES.length)];
    const car = fleet.spawnCar(type, randomNode(graph, rand));
    car.driver = 'npc';
    car._t = {
      route: [], wp: 0,
      cruise: 8 + rand() * 4,
      state: 'route',
      blockedTimer: 0,
      pullTarget: null,
    };
    newRoute(car);
    cars.push(car);
  }

  function carAhead(car) {
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    for (const other of fleet.cars) {
      if (other === car) continue;
      const dx = other.pos.x - car.pos.x;
      const dz = other.pos.z - car.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 14 && d > 0.01) {
        const dot = (dx * fx + dz * fz) / d;
        const lat = dx * fz - dz * fx;
        if (d < 8 && dot > 0.7 && Math.abs(lat) < 4) return other;
        if (dot > -0.2 && other.speed > 0.5 && lat > 0) return other;
      }
    }
    return null;
  }

  function update(dt, ctx) {
    const d = Math.min(Math.max(dt || 0, 0), 0.1);
    const player = ctx && ctx.player;
    const wanted = ctx && ctx.police ? (ctx.police.wanted || 0) : 0;
    const timeHours = ctx && typeof ctx.timeHours === 'number' ? ctx.timeHours : 12;

    for (const car of cars) {
      const t = car._t;
      if (!t) continue;

      if (wanted > 0 && player && player.pos) {
        const dp = Math.hypot(car.pos.x - player.pos.x, car.pos.z - player.pos.z);
        if (dp < 30 && t.state !== 'pullover') {
          t.state = 'pullover';
          const road = graph && typeof graph.projectToRoad === 'function'
            ? graph.projectToRoad(car.pos.x, car.pos.z) : null;
          const cx = road ? road.x : car.pos.x;
          const cz = road ? road.z : car.pos.z;
          const px = -Math.cos(car.heading);
          const pz = Math.sin(car.heading);
          t.pullTarget = { x: cx + px * 5.5, z: cz + pz * 5.5 };
        }
      }
      if (t.state === 'pullover') {
        if (wanted === 0 || !player || !player.pos
          || Math.hypot(car.pos.x - player.pos.x, car.pos.z - player.pos.z) > 60) {
          t.state = 'route';
          t.pullTarget = null;
          newRoute(car);
        } else if (t.pullTarget) {
          const dx = t.pullTarget.x - car.pos.x;
          const dz = t.pullTarget.z - car.pos.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 0.8) {
            car.heading = turnToward(car.heading, Math.atan2(dx, dz), 2.5 * d);
            car.speed = Math.min(car.speed + 6 * d, 6);
            advance(car, d);
          } else {
            car.speed = 0;
          }
          continue;
        }
      }

      if (!t.route.length || t.wp >= t.route.length) newRoute(car);
      if (!t.route.length) { car.speed = 0; continue; }
      const wpNode = nodePos(graph, t.route[t.wp]);
      if (!wpNode) { t.wp++; continue; }
      const dx = wpNode.x - car.pos.x;
      const dz = wpNode.z - car.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 3) { t.wp++; continue; }

      let wantSpeed = t.cruise;
      let atRedLight = false;
      if (dist < 14 && graph && typeof graph.trafficLightState === 'function') {
        try {
          if (graph.trafficLightState(t.route[t.wp], timeHours) === 'red') {
            atRedLight = true;
            wantSpeed = dist < 7 ? 0 : Math.max(0, t.cruise * (dist - 7) / 7);
          }
        } catch (e) {  }
      }
      if (carAhead(car)) wantSpeed = 0;
      if (t.turn && wantSpeed > 5) wantSpeed = 5;

      if (car.speed < 0.5 && !atRedLight) {
        t.blockedTimer += d;
        if (t.blockedTimer > 2) {
          t.blockedTimer = 0;
          newRoute(car);
          continue;
        }
      } else {
        t.blockedTimer = 0;
      }

      car.speed += clamp(wantSpeed - car.speed, -14 * d, 8 * d);
      if (car.speed < 0.05) car.speed = 0;
      const pv = t.wp > 0 ? nodePos(graph, t.route[t.wp - 1]) : null;
      let ux = dx, uz = dz;
      if (pv && (wpNode.x !== pv.x || wpNode.z !== pv.z)) {
        const pl = Math.hypot(wpNode.x - pv.x, wpNode.z - pv.z) || 1;
        ux = (wpNode.x - pv.x) / pl; uz = (wpNode.z - pv.z) / pl;
      } else {
        const dl = dist || 1; ux = dx / dl; uz = dz / dl;
      }
      const o = car.heading;
      car.heading = turnToward(car.heading,
        Math.atan2(wpNode.x + uz * LANE - car.pos.x, wpNode.z - ux * LANE - car.pos.z), 2.2 * d);
      t.turn = Math.abs(car.heading - o) > 1.5 * d;
      advance(car, d);
    }
    separateCars(fleet.cars);
  }

  return { cars, update };
}
