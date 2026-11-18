// pedestrians.js — Pejala
// 16 warga di trotoar
// melihat kejahatan (jara
// jeda lapor 2 detik,
// cooldown 10 detik per
// di pos": walker radius
import * as THREE from 'three';

const SHIRT_COLORS = [0xe8b4b8, 0x8fb8d8, 0xd8c98f, 0x9fd8a8, 0xc9a0d8, 0xd8d8d8, 0xe07856, 0x5a7a9a];
const SKIN_COLORS = [0xe8b88a, 0xc98e6a, 0x8a5a3a, 0xf0c8a0, 0x6a4530];

/** Cek garis pandang: 3 sample point di segmen a->b terhadap collider gedung. */
function hasLineOfSight(a, b, colliders) {
  if (!colliders || !colliders.length) return true;
  for (const s of [0.25, 0.5, 0.75]) {
    const x = a.x + (b.x - a.x) * s;
    const z = a.z + (b.z - a.z) * s;
    for (const c of colliders) {
      if (Math.hypot(x - c.x, z - c.z) < c.r) return false;
    }
  }
  return true;
}

/** Rig pejalan kaki: kapsul + kepala, gaya yang sama dengan rig pemain. */
export function buildWalkerMesh(color) {
  const g = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({
    color: SKIN_COLORS[Math.floor(Math.random() * SKIN_COLORS.length)], roughness: 0.8,
  });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.7, 4, 10), shirt);
  body.position.y = 1.0;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), skin);
  head.position.y = 1.68;
  head.castShadow = true;
  g.add(body, head);
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
    let base = null;
    if (graph && typeof graph.randomRoadNode === 'function') {
      base = graph.randomRoadNode(rand, 0);
    } else if (graph && Array.isArray(graph.nodes) && graph.nodes.length) {
      base = graph.nodes[Math.floor(rand() * graph.nodes.length)];
    }
    if (!base) return { x: (rand() - 0.5) * 80, z: (rand() - 0.5) * 80 };
    // Trotoar: titik jala
    const a = rand() * Math.PI * 2;
    return { x: base.x + Math.cos(a) * 5, z: base.z + Math.sin(a) * 5 };
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
      walkSpeed: 1.2 + rand() * 0.6, // 1.2-1.8
      state: 'walk', // 'w
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

  for (let i = 0; i < 16; i++) walkers.push(makeWalker());

  /** Logika saksi + panik untuk satu kejahatan di pos. Dipakai reportCrime()
   *  dan oleh update() bila ctx.crime diset main (pos + t unik). */
  function onCrimeSeen(pos) {
    crimeSeq++;
    const colliders = lastCtx && lastCtx.city ? lastCtx.city.colliders : null;
    for (const w of walkers) {
      const d = Math.hypot(w.pos.x - pos.x, w.pos.z - pos.z);
      if (d < 20) {
        // Panik: lari men
        w.state = 'panic';
        w.panicTimer = 3;
        w.threatPos = { x: pos.x, z: pos.z };
      }
      if (d < 25 && w.reportCooldown <= 0 && w.reportedSeq !== crimeSeq) {
        // Saksi: harus me
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

  /** Kejahatan terjadi di pos: walker radius 20 panik, saksi radius 25 mulai lapor. */
  function reportCrime(pos) {
    if (!pos) return;
    onCrimeSeen(pos);
  }

  /** Ambil penanda pengemudi yang dikeluarkan saat mobil dicuri (vehicles.js). */
  function collectEjectedDrivers(ctx) {
    if (!ctx || !ctx.vehicles || !Array.isArray(ctx.vehicles.cars)) return;
    for (const car of ctx.vehicles.cars) {
      if (car.ejectedPedestrian && !car.ejectedPedestrian.consumed) {
        car.ejectedPedestrian.consumed = true;
        onCrimeSeen({ x: car.ejectedPedestrian.x, z: car.ejectedPedestrian.z });
        // Pengemudi yang
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
    const colliders = ctx && ctx.city ? ctx.city.colliders : null;

    // Kejahatan baru dari
    if (ctx && ctx.crime && ctx.crime.pos) {
      const key = `${ctx.crime.t || 0}|${ctx.crime.pos.x},${ctx.crime.pos.z}`;
      if (update._lastCrimeKey !== key) {
        update._lastCrimeKey = key;
        onCrimeSeen(ctx.crime.pos);
      }
    }
    collectEjectedDrivers(ctx);

    // Selesaikan jeda lap
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

    for (const w of walkers) {
      if (w.reportCooldown > 0) w.reportCooldown -= d;

      // Panik: mobil di t
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
        if (w.avoidTarget && stepToward(w, w.avoidTarget, 2.5, d)) {
          w.state = 'walk';
          w.avoidTarget = null;
        }
      } else { // walk
        // Menghindar: mob
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
        } else if (stepToward(w, w.target, w.walkSpeed, d)) {
          w.state = 'idle';
          w.idleTimer = 2 + rand() * 3; // berhenti melihat 2-5 detik
        }
      }

      w.mesh.position.set(w.pos.x, 0, w.pos.z);
      w.mesh.rotation.y = w.heading;
      // Ayunan jalan sede
      w.mesh.position.y = w.speed > 0.1 ? Math.abs(Math.sin(Date.now() * 0.008 + w.pos.x)) * 0.05 : 0;
    }
    void colliders;
  }

  return { walkers, update, reportCrime };
}
