
import { createRandom } from './random.js';

const STEP = 1 / 60;
const SIM_SECONDS = 4;

function isFn(v) {
  return typeof v === 'function';
}

function setMeshPos(o, x, z, heading) {
  try {
    if (o && o.mesh) {
      o.mesh.position.set(x, 0, z);
      o.mesh.rotation.y = heading;
    }
  } catch {
  }
}

function readPos(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const p = obj.pos || obj.position || obj;
  if (typeof p.x !== 'number') return null;
  const z = typeof p.z === 'number' ? p.z : typeof p.y === 'number' ? p.y : 0;
  return { x: p.x, z };
}

function writePos(obj, x, z) {
  if (!obj || typeof obj !== 'object') return false;
  const p = obj.pos || obj.position || null;
  if (p && typeof p.x === 'number') {
    p.x = x;
    if (typeof p.z === 'number') p.z = z;
    else if (typeof p.y === 'number') p.y = 0;
    return true;
  }
  if (typeof obj.x === 'number') {
    obj.x = x;
    if (typeof obj.z === 'number') obj.z = z;
    return true;
  }
  return false;
}

function setHeading(obj, radians) {
  if (!obj || typeof obj !== 'object') return;
  try {
    if (typeof obj.heading === 'number') obj.heading = radians;
    else if (obj.rotation && typeof obj.rotation.y === 'number') obj.rotation.y = radians;
  } catch {
  }
}

function setVehicleHeading(vehicle, radians) {
  if (!vehicle || typeof vehicle !== 'object') return;
  try {
    if (typeof vehicle.heading === 'number') vehicle.heading = radians;
    if (vehicle.mesh) vehicle.mesh.rotation.y = radians;
  } catch {
  }
}

function pickRoadNode(graph, prefer, rng) {
  if (!graph) return { x: 0, z: 0 };
  const rand = typeof rng === 'function' ? rng : createRandom(1);
  try {
    if (prefer && isFn(graph.nearestNode)) {
      const p = readPos(graph.nearestNode(prefer.x, prefer.z));
      if (p) return p;
    }
  } catch {
  }
  try {
    if (isFn(graph.randomRoadNode)) {
      const p = readPos(graph.randomRoadNode(rand));
      if (p) return p;
    }
  } catch {
  }
  try {
    if (Array.isArray(graph.nodes) && graph.nodes.length > 0) {
      if (prefer) {
        let best = null;
        let bestD = Infinity;
        for (const n of graph.nodes) {
          const p = readPos(n);
          if (!p) continue;
          const d = (p.x - prefer.x) ** 2 + (p.z - prefer.z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        if (best) return best;
      }
      const p = readPos(graph.nodes[0]);
      if (p) return p;
    }
  } catch {
  }
  return { x: 0, z: 0 };
}

function pickEdgeNode(graph) {
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    return pickRoadNode(graph, null);
  }
  let best = null;
  let bestD = -1;
  for (const n of graph.nodes) {
    const p = readPos(n);
    if (!p) continue;
    const d = Math.abs(p.x) + Math.abs(p.z);
    if (d > bestD) {
      bestD = d;
      best = p;
    }
  }
  return best || { x: 0, z: 0 };
}

function setTime(game, hours) {
  try {
    if (game.dayNight && isFn(game.dayNight.setTime)) game.dayNight.setTime(hours);
    else if (isFn(game.setTime)) game.setTime(hours);
    else if (game.dayNight && typeof game.dayNight.timeHours === 'number') game.dayNight.timeHours = hours;
    else if (game.state && typeof game.state.timeHours === 'number') game.state.timeHours = hours;
  } catch {
  }
}

function setWanted(game, level) {
  try {
    if (game.police && isFn(game.police.addWanted)) {
      game.police.addWanted(level);
      return;
    }
  } catch {
  }
  try {
    if (game.police && typeof game.police.wanted === 'number') game.police.wanted = level;
    if (game.state && typeof game.state.wanted === 'number') game.state.wanted = level;
  } catch {
  }
}

function spawnPursuit(game, count) {
  if (!game.police) return;
  try {
    if (isFn(game.police.spawnPursuitUnit)) {
      for (let i = 0; i < count; i += 1) game.police.spawnPursuitUnit();
    }
  } catch {
  }
}

function framePursuitUnits(g, count) {
  const police = g.police;
  if (!police || !Array.isArray(police.units)) return;
  const p = readPos(g.player);
  if (!p) return;
  const h = typeof g.player.heading === 'number' ? g.player.heading : 0;
  const fx = Math.sin(h);
  const fz = Math.cos(h);
  const rx = Math.cos(h);
  const rz = -Math.sin(h);
  while (police.units.length < count) {
    const before = police.units.length;
    try { spawnPursuit(g, 1); } catch { break; }
    if (police.units.length === before) break;
  }
  const spots = [[13, -3.2], [18, 3.2], [23, -3.2], [28, 3.2]];
  const n = Math.min(count, police.units.length);
  for (let i = 0; i < n; i += 1) {
    const u = police.units[i];
    if (!u || !u.car) continue;
    const spot = spots[i % spots.length];
    let x = p.x + fx * spot[0] + rx * spot[1];
    let z = p.z + fz * spot[0] + rz * spot[1];
    try {
      if (g.graph && isFn(g.graph.nearestPointOnGraph)) {
        const rp = g.graph.nearestPointOnGraph(x, z);
        if (rp && typeof rp.x === 'number') { x = rp.x; z = rp.z; }
      }
    } catch {
    }
    u.car.pos.x = x;
    u.car.pos.z = z;
    u.car.heading = h + Math.PI;
    u.car.speed = 0;
    u.car.sirenOn = true;
    u.state = 'pursue';
    setMeshPos(u.car, x, z, u.car.heading);
  }
}

function findOrSpawnVehicle(game, pos) {
  const vehicles = game.vehicles;
  if (!vehicles) return null;
  try {
    const list = Array.isArray(vehicles.cars)
      ? vehicles.cars
      : Array.isArray(vehicles.list)
        ? vehicles.list
        : Array.isArray(vehicles)
          ? vehicles
          : null;
    if (list) {
      const sport =
        list.find((v) => /sport/i.test(String(v.type || v.name || ''))) || list[0] || null;
      if (sport) {
        writePos(sport, pos.x, pos.z + 2);
        if ('color' in sport) sport.color = '#2ec4b6';
        return sport;
      }
    }
  } catch {
  }
  const makers = [vehicles.spawnCar, vehicles.spawn, vehicles.create, vehicles.spawnVehicle, game.spawnVehicle];
  for (const make of makers) {
    if (!isFn(make)) continue;
    try {
      const v = make.call(vehicles, 'sport', { x: pos.x, z: pos.z }, { color: '#2ec4b6' });
      if (v) return v;
    } catch {
    }
    try {
      const v = make.call(vehicles, { x: pos.x, z: pos.z });
      if (v) return v;
    } catch {
    }
  }
  return null;
}

function enterVehicle(game, vehicle) {
  if (!vehicle) return false;
  try {
    if (game.player && isFn(game.player.enterCar)) {
      game.player.enterCar(vehicle);
    } else if (game.player && isFn(game.player.enterVehicle)) {
      game.player.enterVehicle(vehicle);
    } else if (isFn(game.enterVehicle)) {
      game.enterVehicle(vehicle);
    } else if (game.player && 'currentCar' in game.player) {
      game.player.currentCar = vehicle;
      game.player.onFoot = false;
    } else {
      return false;
    }
    try {
      game.player.onFoot = false;
      game.player.currentCar = vehicle;
    } catch {
    }
    return true;
  } catch {
  }
  return false;
}

function exitVehicle(game) {
  try {
    if (game.player && isFn(game.player.exitCar)) game.player.exitCar();
    else if (game.player && isFn(game.player.exitVehicle)) game.player.exitVehicle();
    else if (isFn(game.exitVehicle)) game.exitVehicle();
    else if (game.player && 'currentCar' in game.player) {
      game.player.currentCar = null;
      game.player.onFoot = true;
    }
    try {
      game.player.onFoot = true;
      game.player.currentCar = null;
    } catch {
    }
  } catch {
  }
}

function brightenCar(vehicle, night) {
  if (!vehicle || !vehicle.mesh || !isFn(vehicle.mesh.traverse)) return;
  vehicle.mesh.traverse((o) => {
    const m = o.material;
    if (!m || !m.color || typeof m.color.getHex !== 'function') return;
    const c = m.color.getHex();
    if (c === 0x2ec4b6 || c === 0x14b8a6) {
      m.color.setHex(0x7ef0dd);
      if (m.emissive && typeof m.emissive.setHex === 'function') {
        if (night) {
          m.emissive.setHex(0x0f766e);
          m.emissiveIntensity = 0.5;
        } else m.emissiveIntensity = 0;
      }
    } else if (c === 0xcc1111 && m.emissive) {
      m.emissiveIntensity = 2.6;
    }
  });
}

function axisPointOnHeading(g, x, z, fx, fz) {
  const graph = g.graph;
  if (!graph || !Array.isArray(graph.edges) || !graph.nodeById) return null;
  let best = null;
  let bestD = Infinity;
  for (const e of graph.edges) {
    const a = graph.nodeById.get(e.a);
    const b = graph.nodeById.get(e.b);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len === 0) continue;
    if (Math.abs((dx * fx + dz * fz) / len) < 0.7) continue;
    let t = ((x - a.x) * dx + (z - a.z) * dz) / (len * len);
    t = Math.max(0, Math.min(1, t));
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < bestD) { bestD = d; best = { x: px, z: pz }; }
  }
  return best;
}

function stageCrowd(g) {
  const p = readPos(g.player);
  if (!p) return;
  const h = typeof g.player.heading === 'number' ? g.player.heading : 0;
  const fx = Math.sin(h);
  const fz = Math.cos(h);
  const rx = Math.cos(h);
  const rz = -Math.sin(h);
  const side = (-p.x * rx + -p.z * rz) >= 0 ? 1 : -1;
  // Lateral pemain dari as jalan (4,6 = trotoar).
  let axisLat = 0;
  try {
    const a = axisPointOnHeading(g, p.x, p.z, fx, fz);
    if (a && typeof a.x === 'number') axisLat = (p.x - a.x) * rx + (p.z - a.z) * rz;
  } catch {
  }
  function placeAt(o, fwd, lat, heading) {
    const x = p.x + fx * fwd + rx * lat;
    const z = p.z + fz * fwd + rz * lat;
    o.pos.x = x;
    o.pos.z = z;
    o.heading = heading;
    setMeshPos(o, x, z, heading);
  }
  const walkers = g.pedestrians && Array.isArray(g.pedestrians.walkers) ? g.pedestrians.walkers : [];
  const wSpots = [6, 11, 17, 23, 29, 35];
  for (let i = 0; i < Math.min(6, walkers.length); i += 1) {
    const w = walkers[i];
    if (!w || !w.pos) continue;
    placeAt(w, wSpots[i], side * 4.6 - axisLat, h);
  }
  const cars = g.traffic && Array.isArray(g.traffic.cars) ? g.traffic.cars : [];
  const cSpots = [[34, -3.2], [42, 3.2]];
  for (let i = 0; i < Math.min(2, cars.length); i += 1) {
    const c = cars[i];
    if (!c || !c.pos) continue;
    const s = cSpots[i % cSpots.length];
    placeAt(c, s[0], s[1], h + Math.PI);
    c.speed = 0;
  }
  for (let i = 6; i < walkers.length; i += 1) {
    const w = walkers[i];
    if (!w || !w.pos) continue;
    if (Math.hypot(w.pos.x - p.x, w.pos.z - p.z) >= 12) continue;
    placeAt(w, 48 + (i % 3) * 8, -side * 4.6 - axisLat, h);
  }
  for (let i = 2; i < cars.length; i += 1) {
    const c = cars[i];
    if (!c || !c.pos) continue;
    if (Math.hypot(c.pos.x - p.x, c.pos.z - p.z) >= 15) continue;
    placeAt(c, 52 + (i % 3) * 8, -side * 3.2, h + Math.PI);
    c.speed = 0;
  }
}

function startFirstMission(game, want) {
  const missions = game.missions;
  if (!missions || !isFn(missions.startMission)) return;
  const first = Array.isArray(missions.list) && missions.list.length > 0 ? missions.list[0] : null;
  const fi = first && first.index !== undefined ? first.index : 1;
  const ids = want !== undefined ? [want] : [fi, 1, 0, 'misi-1', 'mission-1'];
  for (const id of ids) {
    try {
      missions.startMission(id);
      return;
    } catch {
    }
  }
}

function advanceSim(game, seconds) {
  const steps = Math.round(seconds / STEP);
  const updaters = [];
  if (isFn(game.update)) updaters.push((dt) => game.update(dt));
  else {
    const subs = [game.player, game.police, game.vehicles, game.traffic, game.pedestrians, game.missions, game.dayNight];
    for (const s of subs) {
      if (s && isFn(s.update)) updaters.push((dt) => s.update(dt));
    }
  }
  for (let i = 0; i < steps; i += 1) {
    for (const u of updaters) {
      try {
        u(STEP);
      } catch {
      }
    }
  }
}

function pushHudState(g) {
  const hud = g.hud;
  if (!hud || !isFn(hud.update)) return;
  try {
    const player = g.player || {};
    const police = g.police || {};
    const missions = g.missions || {};
    const dayNight = g.dayNight || {};
    const state = g.state || {};
    const car = player.currentCar || player.vehicle || null;
    const objective = missions.objectiveText || '';
    if (typeof objective === 'string' && objective && isFn(hud.setObjective)) {
      hud.setObjective(objective);
    }
    hud.update({
      playerHealth: typeof player.health === 'number' ? player.health : 100,
      armor: typeof player.armor === 'number' ? player.armor : 0,
      money: typeof state.money === 'number' ? state.money : 0,
      wanted: typeof police.wanted === 'number' ? police.wanted : typeof state.wanted === 'number' ? state.wanted : 0,
      wantedEscaping: typeof police.wantedEscaping === 'boolean' ? police.wantedEscaping : undefined,
      missionTitle: missions.active && missions.active.title ? missions.active.title : null,
      objectiveText: objective,
      vehicleName: car ? car.name || car.type || null : null,
      vehicleHealth: car && typeof car.health === 'number' ? car.health : undefined,
      minimap: {
        graph: g.graph,
        playerPos: player.pos || player.position || null,
        playerHeading: player.heading,
        policeUnits: Array.isArray(police.units) ? police.units : [],
        missionMarker: missions.markerPos || null,
        safehouse: g.safehouse || null,
      },
      timeHours: typeof dayNight.timeHours === 'number' ? dayNight.timeHours : state.timeHours,
      speedKmh: 0,
    });
  } catch {
  }
}

function frameChaseCamera(game) {
  try {
    const camera = game.camera;
    const player = game.player;
    if (!camera || !player || !camera.position || typeof camera.position.set !== 'function'
      || typeof camera.lookAt !== 'function') return;
    const p = readPos(player);
    if (!p) return;
    const h = typeof player.heading === 'number' ? player.heading : 0;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    camera.position.set(p.x - fx * 9, 3.5, p.z - fz * 9);
    camera.lookAt(p.x + fx * 6, 1.2, p.z + fz * 6);
  } catch {
  }
}

function stageDrive(g, o) {
  setTime(g, o.time);
  const node = o.edge ? pickEdgeNode(g.graph) : pickRoadNode(g.graph, { x: 0, z: 0 }, o.rng);
  // Hadap sepanjang jalan ke tengah kota.
  const head = o.edge
    ? (Math.abs(node.x) >= Math.abs(node.z)
      ? (node.x > 0 ? -Math.PI / 2 : Math.PI / 2)
      : (node.z > 0 ? Math.PI : 0))
    : 0;
  if (g.player) {
    writePos(g.player, node.x, node.z);
    setHeading(g.player, head);
  }
  const vehicle = findOrSpawnVehicle(g, node);
  enterVehicle(g, vehicle);
  setVehicleHeading(vehicle, head);
  brightenCar(vehicle, o.night);
  setWanted(g, o.wanted);
  spawnPursuit(g, o.units);
  startFirstMission(g, o.mission);
  advanceSim(g, SIM_SECONDS);
  if (g.police && Array.isArray(g.police.units) && g.police.units.length < o.minUnits) {
    spawnPursuit(g, o.units);
    advanceSim(g, 1);
  }
  framePursuitUnits(g, o.units);
  stageCrowd(g);
  if (g.hud && isFn(g.hud.showMenu)) g.hud.showMenu('none');
  frameChaseCamera(g);
  pushHudState(g);
  return { screen: 'play' };
}

export function stageShot(name, game) {
  const g = game || {};
  const rng = typeof g.rng === 'function' ? g.rng : createRandom(1);
  if (g.police && isFn(g.police.setAutoSpawn)) g.police.setAutoSpawn(false);
  if (g.police && isFn(g.police.clearUnits)) g.police.clearUnits();

  if (name === 'play') {
    return stageDrive(g, { time: 17.5, rng, night: false, wanted: 2, units: 2, minUnits: 1 });
  }

  if (name === 'end') {
    return stageDrive(g, {
      time: 21, edge: true, rng, night: true, wanted: 5, units: 4, mission: 3, minUnits: 4,
    });
  }

  setTime(g, 10);
  const node = pickRoadNode(g.graph, { x: 0, z: 0 }, rng);
  exitVehicle(g);
  if (g.player) {
    writePos(g.player, node.x, node.z);
    setHeading(g.player, 0);
  }
  advanceSim(g, SIM_SECONDS);
  if (g.hud && isFn(g.hud.showMenu)) g.hud.showMenu('title');
  pushHudState(g);
  return { screen: 'title' };
}
