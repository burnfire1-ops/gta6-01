import * as THREE from 'three';

const FALLBACK_TYPES = {
  sedan:  { maxSpeed: 26, accel: 14, color: 0x9aa3ad },
  taxi:   { maxSpeed: 24, accel: 13, color: 0xf2c94c },
  van:    { maxSpeed: 20, accel: 10, color: 0x7a8a99 },
  pickup: { maxSpeed: 24, accel: 12, color: 0xb0563a },
  sport:  { maxSpeed: 38, accel: 22, color: 0x14b8a6 },
  police: { maxSpeed: 35, accel: 20, color: 0x14181d },
};

function typeSpec(type) { return FALLBACK_TYPES[type] || FALLBACK_TYPES.sedan; }

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

export function turnToward(heading, target, maxStep) {
  let d = target - heading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return heading + clamp(d, -maxStep, maxStep);
}

export function normalizeDriveInput(input) {
  const out = { throttle: 0, steer: 0, handbrake: false };
  if (!input || typeof input !== 'object') return out;
  if (typeof input.throttle === 'number' || typeof input.steer === 'number') {
    out.throttle = clamp(input.throttle || 0, -1, 1);
    out.steer = clamp(input.steer || 0, -1, 1);
    out.handbrake = !!input.handbrake;
    return out;
  }
  // CP18: axes live; forward +1 = W, strafe +1 = D; steer = -strafe.
  const ax = input.axes;
  if (ax && typeof ax === 'object') {
    const f = typeof ax.forward === 'number' ? ax.forward : 0;
    const s = typeof ax.strafe === 'number' ? ax.strafe : 0;
    if (f || s) {
      out.throttle = clamp(f, -1, 1);
      out.steer = clamp(-s, -1, 1);
      out.handbrake = !!input.handbrake; // CP19: Space saat W/A/S/D ditahan
      return out;
    }
  }
  const keys = input.keys;
  const has = (c) => {
    if (!keys) return false;
    if (typeof keys.has === 'function') return keys.has(c);
    if (Array.isArray(keys)) return keys.includes(c);
    return !!keys[c];
  };
  const any = (...codes) => codes.some(has);
  const fwd = !!(input.forward || input.up || input.accelerate || any('KeyW', 'ArrowUp'));
  const back = !!(input.back || input.down || input.brake || any('KeyS', 'ArrowDown'));
  const left = !!(input.left || any('KeyA', 'ArrowLeft'));
  const right = !!(input.right || any('KeyD', 'ArrowRight'));
  out.throttle = (fwd ? 1 : 0) - (back ? 1 : 0);
  out.steer = (left ? 1 : 0) - (right ? 1 : 0);
  out.handbrake = !!(input.handbrake || input.drift || input.space || has('Space'));
  return out;
}

export function buildCarMesh(type) {
  const spec = typeSpec(type);
  const sp = type === 'sport' ? 0.08 : 0;
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({
    color: new THREE.Color(spec.color), metalness: 0.55, roughness: 0.35,
  });
  const glass = new THREE.MeshStandardMaterial({ color: 0x16222e, metalness: 0.9, roughness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0e11, roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 4.2), paint);
  body.position.y = 0.55 - sp;
  body.castShadow = true;
  g.add(body);

  // M14: bemper + grille + spion (semua varian), pakai ulang material dark.
  const mk = (m, w, h, d, x, y, z) => { const q = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); q.position.set(x, y, z); g.add(q); };
  mk(dark, 2.06, 0.22, 0.18, 0, 0.42, 2.14);
  mk(dark, 2.06, 0.22, 0.18, 0, 0.42, -2.14);
  mk(dark, 0.8, 0.22, 0.06, 0, 0.62, 2.13);
  for (const s of [-1, 1]) mk(paint, 0.14, 0.12, 0.24, s * 1.02, 1.05, 0.5);
  if (type === 'taxi') mk(new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xcc9900, emissiveIntensity: 1.2 }), 0.9, 0.22, 0.4, 0, 1.62, -0.2);
  if (type === 'sport') mk(dark, 1.8, 0.08, 0.5, 0, 0.86, -1.95);

  const cabinLen = type === 'van' ? 3.0 : type === 'pickup' ? 1.4 : 2.0;
  const cabinH = type === 'van' ? 0.85 : 0.6;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, cabinH, cabinLen), glass);
  cabin.position.set(0, 0.9 + cabinH / 2 - sp, type === 'pickup' ? 0.9 : -0.2);
  cabin.castShadow = true;
  g.add(cabin);

  if (type === 'pickup') {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.35, 1.6), dark);
    bed.position.set(0, 0.95, -1.2);
    g.add(bed);
  }
  if (type === 'police') {
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.4, roughness: 0.4 });
    for (const s of [-1, 1]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 1.6), white);
      door.position.set(s * 1.01, 0.55, 0.1);
      g.add(door);
    }
    const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.14, 0.45), dark);
    barBase.position.set(0, 1.55, -0.2);
    g.add(barBase);
    const redMat = new THREE.MeshStandardMaterial({
      color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 2,
    });
    const blueMat = new THREE.MeshStandardMaterial({
      color: 0x2244ff, emissive: 0x0022ff, emissiveIntensity: 2,
    });
    for (const [lx, mat] of [[-0.32, redMat], [0.32, blueMat]]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.4), mat);
      lamp.position.set(lx, 1.66, -0.2);
      g.add(lamp);
    }
    g.userData.lightbar = { red: redMat, blue: blueMat };
  }

  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff2c0, emissive: 0xffe9a0, emissiveIntensity: 1.4,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xcc1111, emissive: 0xff0000, emissiveIntensity: 1.2,
  });
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.1), headMat);
    h.position.set(s * 0.62, 0.6, 2.12);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.1), tailMat);
    t.position.set(s * 0.62, 0.62, -2.12);
    g.add(h, t);
  }

  const hubMat = new THREE.MeshStandardMaterial({ color: 0xe8ebee, emissive: 0x555555, emissiveIntensity: 0.6 });
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 14);
  const wheels = [];
  for (const [wx, wz] of [[-0.95, 1.35], [0.95, 1.35], [-0.95, -1.35], [0.95, -1.35]]) {
    const w = new THREE.Mesh(wheelGeo, [dark, hubMat, hubMat]);
    w.position.set(wx, 0.36, wz);
    w.rotation.z = Math.PI / 2;
    w.castShadow = true;
    g.add(w);
    wheels.push(w);
  }
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 4.8), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.08;
  g.add(blob);
  g.userData.wheels = wheels;
  g.userData.type = type;
  return g;
}

function syncMesh(car) {
  car.mesh.position.set(car.pos.x, 0, car.pos.z);
  car.mesh.rotation.y = car.heading;
}

export function driveVehicle(car, input, dt, ctx) {
  const inp = normalizeDriveInput(input);
  const p = car.pos;
  const spec = typeSpec(car.type);
  const healthFactor = 0.55 + 0.45 * clamp(car.health / 100, 0, 1);
  const top = car.maxSpeed * healthFactor;
  const reverseTop = top * 0.45;

  if (inp.throttle > 0) {
    car.speed += car.accel * inp.throttle * dt;
  } else if (inp.throttle < 0) {
    if (car.speed > 0.5) car.speed -= car.accel * 1.6 * dt;
    else car.speed -= car.accel * 0.7 * dt;
  }
  car.speed -= car.speed * (inp.handbrake ? 1.4 : 0.35) * dt;
  if (Math.abs(car.speed) < 0.05 && inp.throttle === 0) car.speed = 0;
  car.speed = clamp(car.speed, -reverseTop, top);

  const steerAuthority = clamp(Math.abs(car.speed) / 6, 0, 1);
  const turnRate = (inp.handbrake ? 3.4 : 2.3) * steerAuthority;
  const dir = car.speed >= 0 ? 1 : -1;
  car.heading += inp.steer * turnRate * dir * dt;

  p.x += Math.sin(car.heading) * car.speed * dt;
  p.z += Math.cos(car.heading) * car.speed * dt;

  const colliders = ctx && ctx.city && Array.isArray(ctx.city.colliders) ? ctx.city.colliders : null;
  if (colliders) {
    for (const c of colliders) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const d2 = dx * dx + dz * dz;
      const minD = c.r + 1.4;
      if (d2 < minD * minD && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d;
        p.x = c.x + nx * minD;
        p.z = c.z + nz * minD;
        const impact = Math.abs(car.speed);
        car.speed *= 0.4;
        if (impact > 8) car.health = Math.max(0, car.health - Math.min(15, (impact - 8) * 1.2));
      }
    }
  }

  if (car._bounds) {
    p.x = clamp(p.x, car._bounds.minX, car._bounds.maxX);
    p.z = clamp(p.z, car._bounds.minZ, car._bounds.maxZ);
  }
  syncMesh(car);
  return car;
}

export function createVehicleFleet(scene, graph, rng) {
  const rand = typeof rng === 'function' ? rng : Math.random;
  const cars = [];
  let bounds = { minX: -230, maxX: 230, minZ: -230, maxZ: 230 };
  if (graph && Array.isArray(graph.nodes) && graph.nodes.length) {
    const xs = graph.nodes.map((n) => n.x);
    const zs = graph.nodes.map((n) => n.z);
    bounds = {
      minX: Math.min(...xs) - 10, maxX: Math.max(...xs) + 10,
      minZ: Math.min(...zs) - 10, maxZ: Math.max(...zs) + 10,
    };
  }

  function resolvePos(nodeIdOrPos) {
    if (nodeIdOrPos && typeof nodeIdOrPos === 'object'
      && typeof nodeIdOrPos.x === 'number' && typeof nodeIdOrPos.z === 'number') {
      return { x: nodeIdOrPos.x, z: nodeIdOrPos.z };
    }
    if ((typeof nodeIdOrPos === 'number' || typeof nodeIdOrPos === 'string')
      && graph && graph.nodeById && graph.nodeById.get(nodeIdOrPos)) {
      const n = graph.nodeById.get(nodeIdOrPos);
      return { x: n.x, z: n.z };
    }
    if (graph && typeof graph.randomRoadNode === 'function') {
      const n = graph.randomRoadNode(rand, 0);
      if (n) return { x: n.x, z: n.z };
    }
    if (graph && Array.isArray(graph.nodes) && graph.nodes.length) {
      const n = graph.nodes[Math.floor(rand() * graph.nodes.length)];
      return { x: n.x, z: n.z };
    }
    return { x: (rand() - 0.5) * 100, z: (rand() - 0.5) * 100 };
  }

  function spawnCar(type, nodeIdOrPos) {
    const spec = typeSpec(type);
    const mesh = buildCarMesh(type);
    const p = resolvePos(nodeIdOrPos);
    const car = {
      mesh, type,
      pos: { x: p.x, z: p.z },
      heading: rand() * Math.PI * 2,
      speed: 0,
      health: 100,
      maxSpeed: spec.maxSpeed,
      accel: spec.accel,
      driver: null,
      locked: false,
      color: spec.color,
      sirenOn: false,
      blinkT: 0,
      _bounds: bounds,
    };
    syncMesh(car);
    if (scene && typeof scene.add === 'function') scene.add(mesh);
    cars.push(car);
    return car;
  }

  function removeCar(car) {
    const i = cars.indexOf(car);
    if (i >= 0) cars.splice(i, 1);
    if (scene && typeof scene.remove === 'function') scene.remove(car.mesh);
  }

  function nearestCar(pos, radius) {
    let best = null;
    let bestD = radius * radius;
    for (const c of cars) {
      const d = (c.pos.x - pos.x) ** 2 + (c.pos.z - pos.z) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  const parkedTypes = ['sport', 'sport', 'sedan', 'taxi', 'van', 'pickup', 'sedan', 'taxi',
    'sedan', 'van', 'pickup', 'taxi', 'sedan', 'sedan'];
  for (const t of parkedTypes) {
    const base = resolvePos();
    const a = rand() * Math.PI * 2;
    const car = spawnCar(t, { x: base.x + Math.cos(a) * 5, z: base.z + Math.sin(a) * 5 });
    car.locked = t !== 'sport' && rand() < 0.25;
  }

  function update(dt, ctx) {
    const d = Math.min(Math.max(dt || 0, 0), 0.1);
    const player = ctx && ctx.player;
    if (player && player.currentCar && cars.includes(player.currentCar)) {
      driveVehicle(player.currentCar, ctx.input, d, ctx);
      if (player.pos) {
        player.pos.x = player.currentCar.pos.x;
        player.pos.z = player.currentCar.pos.z;
      }
    }
    for (const car of cars) {
      if (!player || player.currentCar !== car) syncMesh(car);
      const wheels = car.mesh.userData.wheels || [];
      const spin = (car.speed * d) / 0.36;
      for (const w of wheels) w.rotation.x += spin;
      if (car.type === 'police' && car.sirenOn && car.mesh.userData.lightbar) {
        car.blinkT += d;
        const redOn = Math.floor(car.blinkT * 6) % 2 === 0;
        car.mesh.userData.lightbar.red.emissiveIntensity = redOn ? 2.5 : 0.15;
        car.mesh.userData.lightbar.blue.emissiveIntensity = redOn ? 0.15 : 2.5;
      }
    }
  }

  return { cars, spawnCar, removeCar, nearestCar, update };
}
