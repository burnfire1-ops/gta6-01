// polisi mengejar.
// game = objek dari main.
// dilewati diam-diam —
// Scene (tesis §3):
//           menara kaca,

const STEP = 1 / 60;
const SIM_SECONDS = 4;

function isFn(v) {
  return typeof v === 'function';
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

// Heading mobil pemain: player.update MENIMPA heading pemain dengan
// heading mobil saat mengemudi, jadi heading yang di-set di stageShot
// hilang selama advanceSim bila hanya pemain yang di-set. Set keduanya.
function setVehicleHeading(vehicle, radians) {
  if (!vehicle || typeof vehicle !== 'object') return;
  try {
    if (typeof vehicle.heading === 'number') vehicle.heading = radians;
    if (vehicle.mesh) vehicle.mesh.rotation.y = radians;
  } catch {
    // Heading mobil tidak bisa di-set.
  }
}

function mulberry32(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRoadNode(graph, prefer, rng) {
  if (!graph) return { x: 0, z: 0 };
  const rand = typeof rng === 'function' ? rng : mulberry32(1);
  try {
    if (prefer && isFn(graph.nearestNode)) {
      const p = readPos(graph.nearestNode(prefer.x, prefer.z));
      if (p) return p;
    }
  } catch {
    // nearestNode gagal:
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
    // Spawn manual gagal:
  }
}

// Posisikan unit pursuit ke dalam frame.
// dari pemain dan sim 4 dtk tidak cukup mendekatkan mereka.
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
      // Tetap di titik hitung.
    }
    u.car.pos.x = x;
    u.car.pos.z = z;
    u.car.heading = h + Math.PI;
    u.car.speed = 0;
    u.car.sirenOn = true;
    u.state = 'pursue';
    try {
      if (u.car.mesh) {
        u.car.mesh.position.set(x, 0, z);
        u.car.mesh.rotation.y = u.car.heading;
      }
    } catch {
      // Mesh tidak bisa disinkron.
    }
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
  // 2) Minta dibuatkan.
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
      // Lanjut.
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
    // {...state} (spread)
    try {
      game.player.onFoot = false;
      game.player.currentCar = vehicle;
    } catch {
    }
    return true;
  } catch {
    // Masuk mobil gagal.
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
    // Keluar mobil gagal:
  }
}

function startFirstMission(game) {
  const missions = game.missions;
  if (!missions || !isFn(missions.startMission)) return;
  const tries = [1, 0, 'misi-1', 'mission-1'];
  try {
    if (Array.isArray(missions.list) && missions.list.length > 0) {
      const first = missions.list[0];
      if (first && first.id !== undefined) tries.unshift(first.id);
    }
  } catch {
  }
  for (const id of tries) {
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
    if (!camera || !player) return;
    if (!camera.position || typeof camera.position.set !== 'function') return;
    if (typeof camera.lookAt !== 'function') return;
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

export function stageShot(name, game) {
  const g = game || {};
  // RNG game bila ada,
  const rng = typeof g.rng === 'function' ? g.rng : mulberry32(1);
  if (g.police && isFn(g.police.setAutoSpawn)) g.police.setAutoSpawn(false);
  if (g.police && isFn(g.police.clearUnits)) g.police.clearUnits();

  if (name === 'play') {
    setTime(g, 17.5);
    const node = pickRoadNode(g.graph, { x: 0, z: 0 }, rng);
    if (g.player) {
      writePos(g.player, node.x, node.z);
      setHeading(g.player, 0);
    }
    const vehicle = findOrSpawnVehicle(g, node);
    enterVehicle(g, vehicle);
    setVehicleHeading(vehicle, 0);
    setWanted(g, 2);
    spawnPursuit(g, 2);
    startFirstMission(g);
    advanceSim(g, SIM_SECONDS);
    if (g.police && Array.isArray(g.police.units) && g.police.units.length === 0) {
      spawnPursuit(g, 2);
      advanceSim(g, 1);
    }
    framePursuitUnits(g, 2);
    if (g.hud && isFn(g.hud.showMenu)) g.hud.showMenu('none');
    frameChaseCamera(g);
    pushHudState(g);
    return { screen: 'play' };
  }

  if (name === 'end') {
    setTime(g, 21);
    const node = pickEdgeNode(g.graph);
    // Hadap sepanjang jalan ke tengah kota, bukan diagonal keluar peta.
    const head = Math.abs(node.x) >= Math.abs(node.z)
      ? (node.x > 0 ? -Math.PI / 2 : Math.PI / 2)
      : (node.z > 0 ? Math.PI : 0);
    if (g.player) {
      writePos(g.player, node.x, node.z);
      setHeading(g.player, head);
    }
    const vehicle = findOrSpawnVehicle(g, node);
    enterVehicle(g, vehicle);
    setVehicleHeading(vehicle, head);
    setWanted(g, 5);
    spawnPursuit(g, 4);
    advanceSim(g, SIM_SECONDS);
    if (g.police && Array.isArray(g.police.units) && g.police.units.length < 4) {
      spawnPursuit(g, 4);
      advanceSim(g, 1);
    }
    framePursuitUnits(g, 4);
    if (g.hud && isFn(g.hud.showMenu)) g.hud.showMenu('none');
    frameChaseCamera(g);
    pushHudState(g);
    return { screen: 'play' };
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
