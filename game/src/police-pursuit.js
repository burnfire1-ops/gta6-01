// police-pursuit.js — Polisi & wanted Teluk Cahaya (GTA6-01 round 3).
// FILE PALING PENTING. Aturan yang dijaga di sini (diturunkan dari tesis +
// skill open-world-crime, BUKAN dari kode lama):
//  - Semua steering memakai target yang sudah dipin ke jalan (pinTargetToRoad).
//  - Gerak polisi dibatasi pita jalan 3,0 unit dari centerline (enforceRoadBand).
//  - Persepsi 5-10 Hz + garis pandang (gedung memblokir), bukan tiap frame.
//  - Spawn selalu di luar pandangan pemain, jarak > 45, radius minimum 40.
//  - Top speed polisi = 0,92 x sport pemain: kabur selalu mungkin.
//  - Anti-macet: < 0,5 unit dalam 2 detik -> hitung ulang A*.
//  - Hysteresis waypoint: ganti waypoint bila < 4 unit ATAU sudah dilewati (dot).
//  - Kabur = putus kontak (escape 8 detik di wanted 1-2, 12 detik di 3+);
//    ganti mobil di tempat sepi memotong sisa escapeTime jadi setengah.
//  - Tertangkap: unit < 3 unit dari pemain jalan kaki selama 2 detik -> denda $100,
//    wanted 0, pemain dipindah ke kantor polisi (node distrik Boulevard).
import * as CFG from './config.js';
import { clamp, turnToward } from './vehicles.js';

const ROAD_BAND = (CFG.POLICE && typeof CFG.POLICE.roadBand === 'number')
  ? CFG.POLICE.roadBand : 3.0;
const SPORT_MAX = (CFG.VEHICLE && CFG.VEHICLE.sport && typeof CFG.VEHICLE.sport.maxSpeed === 'number')
  ? CFG.VEHICLE.sport.maxSpeed : 38;
const POLICE_MAX = SPORT_MAX * 0.92; // sedikit di bawah sport pemain
const UNITS_PER_LEVEL = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 };

function nodePos(graph, id) {
  if (graph && graph.nodeById && graph.nodeById.get(id)) return graph.nodeById.get(id);
  if (graph && Array.isArray(graph.nodes)) return graph.nodes.find((n) => n.id === id) || null;
  return null;
}

/** Garis pandang: 3 sample point di segmen a->b terhadap collider gedung. */
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

export function createPolice(scene, graph, fleet, rng) {
  const rand = typeof rng === 'function' ? rng : Math.random;

  const api = {
    wanted: 0,
    units: [],
    addWanted,
    reportCrime,
    clearWanted,
    update,
    spawnPursuitUnit,
    pinTargetToRoad,
    enforceRoadBand,
    isOnRoad,
    onVehicleSwapped,
  };
  const S = {
    time: 0,
    escapeTimer: 0,
    captureTimer: 0,
    lastCtx: null,
    lastCar: null,
  };

  // ---------- Proyeksi & pita jalan ----------
  function pinTargetToRoad(x, z) {
    if (graph && typeof graph.nearestPointOnGraph === 'function') {
      try {
        const p = graph.nearestPointOnGraph(x, z);
        if (p && typeof p.x === 'number') return { x: p.x, z: p.z };
      } catch (e) { /* fallback di bawah */ }
    }
    if (graph && typeof graph.nearestNode === 'function') {
      const n = graph.nearestNode(x, z);
      if (n) return { x: n.x, z: n.z };
    }
    return { x, z };
  }

  function isOnRoad(x, z) {
    if (graph && typeof graph.isOnRoad === 'function') {
      try { return !!graph.isOnRoad(x, z, ROAD_BAND); } catch (e) { /* fallback */ }
    }
    const p = pinTargetToRoad(x, z);
    return Math.hypot(p.x - x, p.z - z) <= ROAD_BAND;
  }

  /** Batasi gerak unit ke pita 3,0 unit di sekitar centerline terdekat. */
  function enforceRoadBand(unit, dt) {
    const car = unit.car;
    if (!car) return;
    const center = pinTargetToRoad(car.pos.x, car.pos.z);
    const dx = car.pos.x - center.x;
    const dz = car.pos.z - center.z;
    const lateral = Math.hypot(dx, dz);
    if (lateral > ROAD_BAND) {
      // Steer balik ke centerline, lalu clamp posisi ke dalam pita.
      if (dt) {
        car.heading = turnToward(
          car.heading, Math.atan2(center.x - car.pos.x, center.z - car.pos.z), 3.0 * dt,
        );
      }
      const s = ROAD_BAND / lateral;
      car.pos.x = center.x + dx * s;
      car.pos.z = center.z + dz * s;
    }
  }

  // ---------- Path A* ----------
  function planPath(unit, targetPos) {
    if (!graph || typeof graph.findPathAStar !== 'function') return null;
    const from = graph.nearestNode ? graph.nearestNode(unit.car.pos.x, unit.car.pos.z) : null;
    const to = graph.nearestNode ? graph.nearestNode(targetPos.x, targetPos.z) : null;
    if (!from || !to) return null;
    try {
      const path = graph.findPathAStar(from.id, to.id);
      return Array.isArray(path) && path.length ? path : null;
    } catch (e) { return null; }
  }

  function repath(unit, targetPos) {
    const path = planPath(unit, targetPos);
    if (path) {
      unit.path = path;
      unit.wp = 0;
      unit.repathTimer = 0;
      unit.lastRepathTarget = { x: targetPos.x, z: targetPos.z };
      return true;
    }
    return false;
  }

  // ---------- Spawn ----------
  function viewDir() {
    const ctx = S.lastCtx;
    const yaw = ctx && typeof ctx.cameraYaw === 'number' ? ctx.cameraYaw
      : (ctx && ctx.player && typeof ctx.player.heading === 'number' ? ctx.player.heading : 0);
    return { x: Math.sin(yaw), z: Math.cos(yaw) };
  }

  function spawnPursuitUnit(targetPos) {
    const tp = targetPos || (S.lastCtx && S.lastCtx.player ? S.lastCtx.player.pos : { x: 0, z: 0 });
    const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
    const vd = viewDir();
    let best = null;
    // Syarat ketat dulu: jarak > 45 DAN di luar kerucut pandang (dot < 0,3).
    const tiers = [
      (n) => Math.hypot(n.x - tp.x, n.z - tp.z) > 45
        && ((n.x - tp.x) * vd.x + (n.z - tp.z) * vd.z) / (Math.hypot(n.x - tp.x, n.z - tp.z) || 1) < 0.3,
      (n) => Math.hypot(n.x - tp.x, n.z - tp.z) > 40,
      () => true,
    ];
    for (const test of tiers) {
      const cands = nodes.filter(test);
      if (cands.length) {
        // Pilih yang terjauh dari pemain (spawn tidak pernah "di atas" pemain).
        cands.sort((a, b) =>
          Math.hypot(b.x - tp.x, b.z - tp.z) - Math.hypot(a.x - tp.x, a.z - tp.z));
        best = cands[Math.floor(rand() * Math.min(3, cands.length))];
        break;
      }
    }
    const car = fleet.spawnCar('police', best || { x: tp.x + 60, z: tp.z });
    car.driver = 'npc';
    car.sirenOn = true;
    car.maxSpeed = POLICE_MAX;
    const unit = {
      car,
      state: 'pursue', // 'patrol' | 'pursue' | 'search' | 'giveup'
      path: [], wp: 0,
      perceptionTimer: rand() * 0.2,
      canSee: false,
      lastKnown: { x: tp.x, z: tp.z },
      lastSeenT: -100,
      repathTimer: 0,
      lastRepathTarget: null,
      searchTimer: 0,
      giveupTimer: 0,
      stuckTimer: 0,
      stuckCount: 0,
      lastProgress: { x: car.pos.x, z: car.pos.z },
      ramCooldown: 0,
      stateTime: 0,
    };
    repath(unit, pinTargetToRoad(tp.x, tp.z));
    api.units.push(unit);
    return unit;
  }

  function spawnPatrolUnit() {
    const node = graph && typeof graph.randomRoadNode === 'function'
      ? graph.randomRoadNode(rand, 0)
      : (graph && graph.nodes ? graph.nodes[Math.floor(rand() * graph.nodes.length)] : null);
    const car = fleet.spawnCar('police', node || { x: 0, z: 0 });
    car.driver = 'npc';
    car.sirenOn = false;
    car.maxSpeed = POLICE_MAX;
    const unit = {
      car, state: 'patrol', path: [], wp: 0,
      perceptionTimer: rand() * 0.2, canSee: false,
      lastKnown: { x: car.pos.x, z: car.pos.z }, lastSeenT: -100,
      repathTimer: 0, lastRepathTarget: null,
      searchTimer: 0, giveupTimer: 0, stuckTimer: 0, stuckCount: 0,
      lastProgress: { x: car.pos.x, z: car.pos.z },
      ramCooldown: 0, stateTime: 0,
    };
    const dest = graph && typeof graph.randomRoadNode === 'function'
      ? graph.randomRoadNode(rand, 0) : null;
    if (dest) repath(unit, { x: dest.x, z: dest.z });
    api.units.push(unit);
    return unit;
  }

  function activeUnits() {
    return api.units.filter((u) => u.state !== 'giveup');
  }

  function ensureUnits(n) {
    let count = activeUnits().length;
    const playerPos = S.lastCtx && S.lastCtx.player ? S.lastCtx.player.pos : { x: 0, z: 0 };
    while (count < n) {
      // Unit patroli yang ada ikut mengejar dulu sebelum spawn baru.
      const patroller = api.units.find((u) => u.state === 'patrol');
      if (patroller) {
        patroller.state = 'pursue';
        patroller.stateTime = 0;
        patroller.sirenOn = true;
        if (patroller.car) patroller.car.sirenOn = true;
        repath(patroller, pinTargetToRoad(playerPos.x, playerPos.z));
      } else {
        spawnPursuitUnit(playerPos);
      }
      count = activeUnits().length;
    }
    // Kelebihan unit -> menyerah (despawn setelah 20 detik via update).
    const extra = activeUnits().slice(n);
    for (const u of extra) {
      u.state = 'giveup';
      u.giveupTimer = 0;
      if (u.car) u.car.sirenOn = false;
    }
  }

  // ---------- Wanted ----------
  function addWanted(n) {
    const before = api.wanted;
    api.wanted = clamp(api.wanted + (n || 1), 0, 5);
    if (api.wanted > before) {
      S.escapeTimer = 0;
      ensureUnits(UNITS_PER_LEVEL[api.wanted] || 1);
    }
    return api.wanted;
  }

  function reportCrime(pos) {
    // Max +1 bintang per insiden: hanya naik dari 0.
    if (api.wanted === 0) {
      api.wanted = 1;
      S.escapeTimer = 0;
      ensureUnits(1);
    }
  }

  function clearWanted() {
    api.wanted = 0;
    S.escapeTimer = 0;
    S.captureTimer = 0;
    for (const u of api.units) {
      if (u.state !== 'giveup') {
        u.state = 'giveup';
        u.giveupTimer = 0;
        if (u.car) u.car.sirenOn = false;
      }
    }
  }

  /** Ganti mobil di tempat sepi: sisa escapeTime dipotong jadi setengah. */
  function onVehicleSwapped() {
    if (api.wanted <= 0) return;
    const escapeTime = api.wanted <= 2 ? 8 : 12;
    S.escapeTimer += (escapeTime - S.escapeTimer) / 2;
  }

  function policeStationNode() {
    const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
    const b = nodes.find((n) => typeof n.district === 'string'
      && n.district.toLowerCase().includes('boulevard'));
    if (b) return b;
    return nodes[0] || { x: 0, z: 0 };
  }

  function busted(ctx) {
    const player = ctx && ctx.player;
    if (ctx && typeof ctx.money === 'number') ctx.money -= 100;
    if (ctx && typeof ctx.toast === 'function') {
      ctx.toast('Tertangkap polisi! Denda $100. Dibawa ke kantor polisi Boulevard.');
    }
    const st = policeStationNode();
    if (player) {
      player.pos.x = st.x;
      player.pos.z = st.z;
      player.heading = 0;
      player.speed = 0;
      if (player.currentCar) {
        player.currentCar.driver = null;
        player.currentCar = null;
      }
      player.onFoot = true;
      if (player.mesh) player.mesh.position.set(st.x, 0, st.z);
    }
    clearWanted();
  }

  function despawn(unit) {
    const i = api.units.indexOf(unit);
    if (i >= 0) api.units.splice(i, 1);
    if (fleet && typeof fleet.removeCar === 'function') fleet.removeCar(unit.car);
    else if (unit.car && unit.car.mesh && scene) scene.remove(unit.car.mesh);
  }

  // ---------- Update ----------
  function update(dt, ctx) {
    const d = Math.min(Math.max(dt || 0, 0), 0.1);
    if (ctx) S.lastCtx = ctx;
    S.time += d;
    const player = ctx && ctx.player;
    if (!player || !player.pos) {
      // Tanpa pemain: patroli tetap jalan.
      for (const u of [...api.units]) stepUnit(u, null, null, d, ctx);
      return;
    }
    const pPos = player.pos;
    const pVel = {
      x: Math.sin(player.heading || 0) * (player.speed || 0),
      z: Math.cos(player.heading || 0) * (player.speed || 0),
    };
    const colliders = ctx && ctx.city ? ctx.city.colliders : null;

    // Ganti mobil (terdeteksi otomatis) di tempat sepi -> potong escapeTime.
    const curCar = player.currentCar || null;
    if (curCar !== S.lastCar) {
      const wasSeen = api.units.some((u) => u.canSee);
      if (S.lastCar && curCar && !wasSeen) onVehicleSwapped();
      S.lastCar = curCar;
    }

    // Persepsi per unit (throttled 5-10 Hz) + transisi FSM berbasis hasil persepsi.
    for (const u of api.units) {
      u.perceptionTimer -= d;
      if (u.perceptionTimer <= 0) {
        u.perceptionTimer = 0.1 + rand() * 0.1;
        const dist = Math.hypot(u.car.pos.x - pPos.x, u.car.pos.z - pPos.z);
        const seen = dist < 60 && hasLineOfSight(u.car.pos, pPos, colliders);
        u.canSee = seen;
        if (seen) {
          u.lastKnown = { x: pPos.x, z: pPos.z };
          u.lastSeenT = S.time;
        }
      }
      u.stateTime += d;
      if (api.wanted > 0 && u.state === 'patrol') {
        u.state = 'pursue'; u.stateTime = 0; u.car.sirenOn = true;
        repath(u, pinTargetToRoad(pPos.x, pPos.z));
      } else if (api.wanted === 0 && (u.state === 'pursue' || u.state === 'search')) {
        u.state = 'patrol'; u.stateTime = 0; u.car.sirenOn = false;
      }
      if (u.state === 'pursue' && !u.canSee && S.time - u.lastSeenT > 4) {
        u.state = 'search'; u.stateTime = 0; u.searchTimer = 0;
        repath(u, pinTargetToRoad(u.lastKnown.x, u.lastKnown.z));
      } else if (u.state === 'search' && u.canSee) {
        u.state = 'pursue'; u.stateTime = 0;
      }
    }

    // Escape: hanya saat TIDAK ADA unit yang melihat pemain.
    if (api.wanted > 0) {
      const anySeen = api.units.some((u) => u.canSee);
      if (anySeen) {
        S.escapeTimer = 0;
      } else {
        const escapeTime = api.wanted <= 2 ? 8 : 12;
        S.escapeTimer += d;
        if (S.escapeTimer >= escapeTime) {
          S.escapeTimer = 0;
          api.wanted -= 1;
          if (api.wanted <= 0) clearWanted();
          else ensureUnits(UNITS_PER_LEVEL[api.wanted] || 1);
        }
      }
    }

    // Tertangkap: unit < 3 unit dari pemain jalan kaki selama 2 detik berturut-turut.
    if (api.wanted > 0 && player.onFoot) {
      const close = api.units.some((u) => u.state === 'pursue'
        && Math.hypot(u.car.pos.x - pPos.x, u.car.pos.z - pPos.z) < 3);
      S.captureTimer = close ? S.captureTimer + d : 0;
      if (S.captureTimer >= 2) {
        S.captureTimer = 0;
        busted(ctx);
        return;
      }
    } else {
      S.captureTimer = 0;
    }

    // Gerakkan semua unit.
    for (const u of [...api.units]) {
      if (u.state === 'giveup') {
        u.giveupTimer += d;
        u.car.speed = Math.max(0, u.car.speed - 10 * d);
        u.car.pos.x += Math.sin(u.car.heading) * u.car.speed * d;
        u.car.pos.z += Math.cos(u.car.heading) * u.car.speed * d;
        if (u.giveupTimer >= 20) despawn(u);
        continue;
      }
      stepUnit(u, pPos, pVel, d, ctx);
    }
  }

  function stepUnit(u, pPos, pVel, d, ctx) {
    const car = u.car;
    if (!car) return;
    if (u.ramCooldown > 0) u.ramCooldown -= d;

    // Tentukan target jalan (selalu hasil pinTargetToRoad, bukan posisi mentah).
    let target = null;
    let cruise = 10;
    if (u.state === 'pursue' && pPos) {
      // Intercept: posisi pemain diantisipasi 0,8 detik ke depan, lalu pin ke jalan.
      const ix = pPos.x + pVel.x * 0.8;
      const iz = pPos.z + pVel.z * 0.8;
      const pinned = pinTargetToRoad(ix, iz);
      target = pinned;
      cruise = POLICE_MAX;
      u.repathTimer += d;
      const moved = !u.lastRepathTarget
        || Math.hypot(pinned.x - u.lastRepathTarget.x, pinned.z - u.lastRepathTarget.z) > 10;
      if ((u.repathTimer > 0.5 && moved) || !u.path.length) repath(u, pinned);
    } else if (u.state === 'search') {
      target = pinTargetToRoad(u.lastKnown.x, u.lastKnown.z);
      cruise = 16;
      if (!u.path.length) repath(u, target);
    } else { // patrol
      cruise = 10;
      if (!u.path.length || u.wp >= u.path.length) {
        const dest = graph && typeof graph.randomRoadNode === 'function'
          ? graph.randomRoadNode(rand, 0) : null;
        if (dest) repath(u, { x: dest.x, z: dest.z });
        else { car.speed = 0; return; }
      }
    }

    // Ikuti waypoint dengan hysteresis: < 4 unit ATAU sudah dilewati (dot).
    let wpPos = null;
    if (u.path.length && u.wp < u.path.length) {
      const wpNode = nodePos(graph, u.path[u.wp]);
      if (wpNode) wpPos = { x: wpNode.x, z: wpNode.z };
      if (wpPos) {
        const dx = wpPos.x - car.pos.x;
        const dz = wpPos.z - car.pos.z;
        const dist = Math.hypot(dx, dz);
        let passed = false;
        if (u.wp > 0) {
          const prev = nodePos(graph, u.path[u.wp - 1]);
          if (prev) {
            const ex = wpPos.x - prev.x;
            const ez = wpPos.z - prev.z;
            passed = (car.pos.x - wpPos.x) * ex + (car.pos.z - wpPos.z) * ez > 0;
          }
        }
        if (dist < 4 || passed) {
          u.wp++;
          const next = u.path[u.wp] ? nodePos(graph, u.path[u.wp]) : null;
          if (next) wpPos = { x: next.x, z: next.z };
        }
      }
    }
    // Bila tidak ada waypoint (rute habis / A* gagal): kejar target langsung.
    const dest = wpPos || target || { x: car.pos.x, z: car.pos.z };

    // Steering ke waypoint + enforceRoadBand tiap frame.
    const dx = dest.x - car.pos.x;
    const dz = dest.z - car.pos.z;
    const wantHeading = Math.atan2(dx, dz);
    let dh = wantHeading - car.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const turnRate = 2.6;
    car.heading = turnToward(car.heading, wantHeading, turnRate * d);
    // Pelan saat belok tajam agar tidak selip keluar pita jalan.
    const speedTarget = Math.abs(dh) > 0.8 ? cruise * 0.6 : cruise;
    car.speed += clamp(speedTarget - car.speed, -18 * d, 12 * d);
    car.pos.x += Math.sin(car.heading) * car.speed * d;
    car.pos.z += Math.cos(car.heading) * car.speed * d;
    enforceRoadBand(u, d);

    // Anti-macet: tidak maju 0,5 unit dalam 2 detik -> hitung ulang jalur.
    u.stuckTimer += d;
    if (u.stuckTimer >= 2) {
      const moved = Math.hypot(car.pos.x - u.lastProgress.x, car.pos.z - u.lastProgress.z);
      if (moved < 0.5 && car.speed > 0.5) {
        u.stuckCount++;
        if (target && u.stuckCount >= 2) {
          // Pindah ke node terdekat di luar pandangan pemain, lalu rute baru.
          const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
          const pp = ctx && ctx.player ? ctx.player.pos : car.pos;
          const far = nodes.filter((n) => Math.hypot(n.x - pp.x, n.z - pp.z) > 40);
          const pick = far.length ? far[Math.floor(rand() * far.length)] : null;
          if (pick) { car.pos.x = pick.x; car.pos.z = pick.z; }
          u.stuckCount = 0;
        }
        if (target) repath(u, target);
      } else {
        u.stuckCount = 0;
      }
      u.lastProgress = { x: car.pos.x, z: car.pos.z };
      u.stuckTimer = 0;
    }

    // Search: sampai di posisi terakhir terlihat -> amati 3 detik -> menyerah.
    if (u.state === 'search' && target) {
      if (Math.hypot(car.pos.x - target.x, car.pos.z - target.z) < 4) {
        u.searchTimer += d;
        car.speed = Math.max(0, car.speed - 12 * d);
        if (u.searchTimer > 3) {
          u.state = 'giveup';
          u.giveupTimer = 0;
          car.sirenOn = false;
        }
      }
    }

    // Ramming ringan ke mobil pemain (bukan damage besar — ini kejar-kejaran).
    const ctxPlayer = ctx && ctx.player;
    if (ctxPlayer && ctxPlayer.currentCar && u.state === 'pursue' && u.ramCooldown <= 0) {
      const pc = ctxPlayer.currentCar;
      if (Math.hypot(car.pos.x - pc.pos.x, car.pos.z - pc.pos.z) < 3.2) {
        u.ramCooldown = 0.5;
        pc.speed *= 0.85;
        pc.health = Math.max(0, pc.health - 1);
        const nx = pc.pos.x - car.pos.x;
        const nz = pc.pos.z - car.pos.z;
        const nl = Math.hypot(nx, nz) || 1;
        pc.pos.x += (nx / nl) * 0.4;
        pc.pos.z += (nz / nl) * 0.4;
      }
    }
  }

  // Satu unit patroli ambient sejak awal (wanted 0 -> patrol; wanted naik -> pursue).
  spawnPatrolUnit();

  return api;
}
