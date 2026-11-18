import { clamp, turnToward } from './vehicles.js';
import { nodePos } from './police-pursuit.js';

const NPC_TYPES = ['sedan', 'taxi', 'van', 'pickup', 'sedan', 'taxi', 'sedan'];

function randomNode(graph, rand) {
  if (graph && typeof graph.randomRoadNode === 'function') {
    const n = graph.randomRoadNode(rand, 0);
    if (n) return n;
  }
  if (graph && Array.isArray(graph.nodes) && graph.nodes.length) {
    return graph.nodes[Math.floor(rand() * graph.nodes.length)];
  }
  return null;
}

function planRoute(graph, fromId, toId) {
  if (graph && typeof graph.findPathAStar === 'function') {
    try {
      const path = graph.findPathAStar(fromId, toId);
      if (Array.isArray(path) && path.length) return path;
    } catch (e) { /* jatuh ke rute langsung */ }
  }
  return [fromId, toId].filter((v, i, a) => a.indexOf(v) === i);
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
    if (car._t.route.length && String(car._t.route[0]) === String(fromId)) car._t.wp = 1;
  }

  for (let i = 0; i < 14; i++) {
    const type = NPC_TYPES[Math.floor(rand() * NPC_TYPES.length)];
    const car = fleet.spawnCar(type, randomNode(graph, rand));
    car.driver = 'npc';
    car._t = {
      route: [], wp: 0,
      cruise: 8 + rand() * 4, // 8-1
      state: 'route', // '
      blockedTimer: 0,
      pullTarget: null,
      repathTimer: 0,
    };
    newRoute(car);
    cars.push(car);
  }

  /** Mobil lain tepat di depan (kerucut depan, < 8 unit) -> rem. */
  function carAhead(car) {
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    for (const other of fleet.cars) {
      if (other === car) continue;
      const dx = other.pos.x - car.pos.x;
      const dz = other.pos.z - car.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 8 && d > 0.01) {
        const dot = (dx * fx + dz * fz) / d;
        if (dot > 0.7) return other;
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
            car.pos.x += Math.sin(car.heading) * car.speed * d;
            car.pos.z += Math.cos(car.heading) * car.speed * d;
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
        } catch (e) { /* lampu tidak tersedia -> jalan terus */ }
      }
      if (carAhead(car)) wantSpeed = 0;

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
      car.heading = turnToward(car.heading, Math.atan2(dx, dz), 2.2 * d);
      car.pos.x += Math.sin(car.heading) * car.speed * d;
      car.pos.z += Math.cos(car.heading) * car.speed * d;
    }
  }

  return { cars, update };
}
