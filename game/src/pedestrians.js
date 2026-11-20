import * as THREE from 'three';
import { hasLineOfSight } from './police-pursuit.js';

const SHIRT_COLORS = [0xe8b4b8, 0x8fb8d8, 0xd8c98f, 0x9fd8a8, 0xc9a0d8, 0xd8d8d8, 0xe07856, 0x5a7a9a];
const SKIN_COLORS = [0xe8b88a, 0xc98e6a, 0x8a5a3a, 0xf0c8a0, 0x6a4530];

const PANTS_COLORS = [0x2c3444, 0x3a3a3a, 0x1f2a44];
export function part(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function buildWalkerMesh(color) {
  const g = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true });
  const skin = new THREE.MeshStandardMaterial({
    color: SKIN_COLORS[Math.floor(Math.random() * SKIN_COLORS.length)], roughness: 0.9, flatShading: true,
  });
  const pants = new THREE.MeshStandardMaterial({
    color: PANTS_COLORS[Math.floor(Math.random() * PANTS_COLORS.length)], roughness: 0.9, flatShading: true,
  });
  g.add(part(0.55, 0.7, 0.3, shirt, 0, 1.15, 0));
  g.add(part(0.4, 0.4, 0.4, skin, 0, 1.7, 0));
  const armL = part(0.16, 0.65, 0.16, skin, -0.36, 1.45, 0);
  const armR = part(0.16, 0.65, 0.16, skin, 0.36, 1.45, 0);
  armL.geometry.translate(0, -0.28, 0);
  armR.geometry.translate(0, -0.28, 0);
  g.add(armL, armR);
  const legL = part(0.22, 0.8, 0.22, pants, -0.2, 0.8, 0);
  const legR = part(0.22, 0.8, 0.22, pants, 0.2, 0.8, 0);
  legL.geometry.translate(0, -0.3, 0);
  legR.geometry.translate(0, -0.3, 0);
  g.add(legL, legR);
  g.userData.type = 'walker';
  return g;
}

export function createPedestrians(scene, graph, rng) {
  const rand = typeof rng === 'function' ? rng : Math.random;
  const walkers = [];
  let lastCtx = null;
  let crimeSeq = 0;
  const pendingReports = [];

  function randomPoi() {
    const es = graph && graph.edges;
    if (es && es.length && graph.nodeById) {
      const e = es[Math.floor(rand() * es.length)];
      const a = graph.nodeById.get(e.a), b = graph.nodeById.get(e.b);
      if (a && b) {
        const t = rand(), l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const s = rand() < 0.5 ? 4.5 : -4.5;
        return { x: a.x + (b.x - a.x) * t + (b.z - a.z) / l * s,
          z: a.z + (b.z - a.z) * t - (b.x - a.x) / l * s };
      }
    }
    const ns = graph && graph.nodes;
    if (!ns || !ns.length) return { x: (rand() - 0.5) * 80, z: (rand() - 0.5) * 80 };
    const n = ns[Math.floor(rand() * ns.length)];
    return { x: n.x, z: n.z };
  }

  function makeWalker() {
    const color = SHIRT_COLORS[Math.floor(rand() * SHIRT_COLORS.length)];
    const mesh = buildWalkerMesh(color);
    const start = randomPoi();
    const w = {
      mesh, color,
      pos: { x: start.x, z: start.z },
      heading: rand() * Math.PI * 2,
      speed: 0,
      walkSpeed: 1.2 + rand() * 0.6,
      state: 'walk',
      target: randomPoi(),
      idleTimer: 0,
      panicTimer: 0,
      avoidTarget: null,
      threatPos: null,
      reportCooldown: 0,
      reportedSeq: -1,
    };
    mesh.position.set(w.pos.x, 0, w.pos.z);
    mesh.rotation.y = w.heading;
    if (scene && typeof scene.add === 'function') scene.add(mesh);
    return w;
  }

  for (let i = 0; i < 48; i++) walkers.push(makeWalker());

  function onCrimeSeen(pos) {
    crimeSeq++;
    const colliders = lastCtx && lastCtx.city ? lastCtx.city.colliders : null;
    for (const w of walkers) {
      const d = Math.hypot(w.pos.x - pos.x, w.pos.z - pos.z);
      if (d < 20) {
        w.state = 'panic';
        w.panicTimer = 3;
        w.threatPos = { x: pos.x, z: pos.z };
      }
      if (d < 25 && w.reportCooldown <= 0 && w.reportedSeq !== crimeSeq) {
        const dx = pos.x - w.pos.x;
        const dz = pos.z - w.pos.z;
        const facing = (Math.sin(w.heading) * dx + Math.cos(w.heading) * dz) / (d || 1);
        if (facing > 0.0 && hasLineOfSight(w.pos, pos, colliders)) {
          w.reportedSeq = crimeSeq;
          pendingReports.push({ walker: w, pos: { x: pos.x, z: pos.z }, timer: 2, seq: crimeSeq });
        }
      }
    }
  }

  function reportCrime(pos) {
    if (!pos) return;
    onCrimeSeen(pos);
  }

  function collectEjectedDrivers(ctx) {
    if (!ctx || !ctx.vehicles || !Array.isArray(ctx.vehicles.cars)) return;
    for (const car of ctx.vehicles.cars) {
      if (car.ejectedPedestrian && !car.ejectedPedestrian.consumed) {
        car.ejectedPedestrian.consumed = true;
        onCrimeSeen({ x: car.ejectedPedestrian.x, z: car.ejectedPedestrian.z });
        let best = null;
        let bestD = Infinity;
        for (const w of walkers) {
          const d = Math.hypot(w.pos.x - car.pos.x, w.pos.z - car.pos.z);
          if (d < bestD) { bestD = d; best = w; }
        }
        if (best && bestD < 30) {
          best.state = 'panic';
          best.panicTimer = 3;
          best.threatPos = { x: car.pos.x, z: car.pos.z };
        }
      }
    }
  }

  function stepToward(w, target, speed, dt) {
    const dx = target.x - w.pos.x;
    const dz = target.z - w.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return true;
    const want = Math.atan2(dx, dz);
    let dh = want - w.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    w.heading += Math.max(-3 * dt, Math.min(3 * dt, dh));
    w.speed = speed;
    w.pos.x += Math.sin(w.heading) * speed * dt;
    w.pos.z += Math.cos(w.heading) * speed * dt;
    return d < 0.6;
  }

  function update(dt, ctx) {
    const d = Math.min(Math.max(dt || 0, 0), 0.1);
    if (ctx) lastCtx = ctx;

    if (ctx && ctx.crime && ctx.crime.pos) {
      const key = `${ctx.crime.t || 0}|${ctx.crime.pos.x},${ctx.crime.pos.z}`;
      if (update._lastCrimeKey !== key) {
        update._lastCrimeKey = key;
        onCrimeSeen(ctx.crime.pos);
      }
    }
    collectEjectedDrivers(ctx);

    for (let i = pendingReports.length - 1; i >= 0; i--) {
      const r = pendingReports[i];
      r.timer -= d;
      if (r.timer <= 0) {
        pendingReports.splice(i, 1);
        if (r.walker.reportCooldown <= 0 && lastCtx && lastCtx.police
          && typeof lastCtx.police.reportCrime === 'function') {
          r.walker.reportCooldown = 10;
          lastCtx.police.reportCrime(r.pos);
        }
      }
    }

    const fleetCars = ctx && ctx.vehicles ? ctx.vehicles.cars
      : (ctx && ctx.fleet ? ctx.fleet.cars : []);
    const wanted = ctx && ctx.police ? (ctx.police.wanted || 0) : 0;
    const cols = lastCtx && lastCtx.city ? lastCtx.city.colliders : null;

    for (const w of walkers) {
      if (w.reportCooldown > 0) w.reportCooldown -= d;

      if (w.state !== 'panic') {
        let threat = w.threatPos;
        for (const car of fleetCars || []) {
          const dc = Math.hypot(car.pos.x - w.pos.x, car.pos.z - w.pos.z);
          if (dc < 3.5 && Math.abs(car.speed) > 1) { threat = { x: car.pos.x, z: car.pos.z }; break; }
        }
        if (!threat && wanted > 0 && ctx && ctx.police && Array.isArray(ctx.police.units)) {
          for (const u of ctx.police.units) {
            if (u.car && Math.hypot(u.car.pos.x - w.pos.x, u.car.pos.z - w.pos.z) < 15
              && u.state === 'pursue') { threat = { x: u.car.pos.x, z: u.car.pos.z }; break; }
          }
        }
        if (threat) {
          w.state = 'panic';
          w.panicTimer = 3;
          w.threatPos = threat;
        }
      }

      if (w.state === 'panic') {
        w.panicTimer -= d;
        const th = w.threatPos || w.pos;
        const away = Math.atan2(w.pos.x - th.x, w.pos.z - th.z);
        const fleeTarget = {
          x: w.pos.x + Math.sin(away) * 10,
          z: w.pos.z + Math.cos(away) * 10,
        };
        stepToward(w, fleeTarget, 4, d);
        if (w.panicTimer <= 0) { w.state = 'walk'; w.target = randomPoi(); w.threatPos = null; }
      } else if (w.state === 'idle') {
        w.speed = 0;
        w.idleTimer -= d;
        if (w.idleTimer <= 0) { w.state = 'walk'; w.target = randomPoi(); }
      } else if (w.state === 'avoid') {
        w.idleTimer -= d;
        if ((w.avoidTarget && stepToward(w, w.avoidTarget, 2.5, d)) || w.idleTimer <= 0) {
          w.state = 'walk';
          w.avoidTarget = null;
        }
      } else {
        let dodge = null;
        for (const car of fleetCars || []) {
          const dc = Math.hypot(car.pos.x - w.pos.x, car.pos.z - w.pos.z);
          if (dc < 4.5 && Math.abs(car.speed) > 2) {
            const side = Math.atan2(w.pos.x - car.pos.x, w.pos.z - car.pos.z);
            dodge = { x: w.pos.x + Math.sin(side) * 6, z: w.pos.z + Math.cos(side) * 6 };
            break;
          }
        }
        if (dodge) {
          w.state = 'avoid';
          w.avoidTarget = dodge;
          w.idleTimer = 4;
        } else if (stepToward(w, w.target, w.walkSpeed, d)) {
          w.state = 'idle';
          w.idleTimer = 2 + rand() * 3;
        }
      }

      // Push-out collider gedung; target di dalam collider diganti baru.
      // Nudge tangensial: tanpa ini walker yang jalurnya menembus tengah gedung diam di titik terdekat.
      if (cols) for (const c of cols) {
        const dx = w.pos.x - c.x, dz = w.pos.z - c.z, r = c.r + 0.4;
        if (dx * dx + dz * dz < r * r) {
          const dd = Math.hypot(dx, dz) || 1;
          w.pos.x = c.x + dx / dd * r; w.pos.z = c.z + dz / dd * r;
          if (Math.hypot(w.target.x - c.x, w.target.z - c.z) < c.r) w.target = randomPoi();
          const k = (dx * (w.target.z - w.pos.z) - dz * (w.target.x - w.pos.x) >= 0 ? 1 : -1) * 1.5 * d / dd;
          w.pos.x += -dz * k; w.pos.z += dx * k;
        }
      }

      w.mesh.position.set(w.pos.x, 0, w.pos.z);
      w.mesh.rotation.y = w.heading;
      w.mesh.position.y = w.speed > 0.1 ? Math.abs(Math.sin(Date.now() * 0.008 + w.pos.x)) * 0.05 : 0;
    }
  }

  return { walkers, update, reportCrime };
}
