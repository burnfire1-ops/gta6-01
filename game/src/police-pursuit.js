import * as CFG from './config.js';
import { clamp, turnToward } from './vehicles.js';

const ROAD_BAND = (CFG.POLICE && typeof CFG.POLICE.roadBand === 'number')
  ? CFG.POLICE.roadBand : 3.0;
const SPORT_MAX = 38; // top speed mobil sport pemain (vehicles.js)
const POLICE_MAX = SPORT_MAX * 0.92; // sedikit di bawah sport: kabur selalu mungkin
const UNITS_PER_LEVEL = [0, 1, 2, 3, 4, 5];

export function nodePos(graph, id) {
  if (graph && graph.nodeById && graph.nodeById.get(id)) return graph.nodeById.get(id);
  if (graph && Array.isArray(graph.nodes)) return graph.nodes.find((n) => n.id === id) || null;
  return null;
}

/** Garis pandang: 3 sample point di segmen a->b terhadap collider gedung. */
export function hasLineOfSight(a, b, colliders) {
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

/** Pilih node jauh dari target: tier pertama yang punya kandidat menang.
 *  tiers = [jarakMin, dotMax] (dotMax null = tanpa syarat arah pandang).
 *  top3 = pilih acak dari 3 terjauh, bukan dari semua kandidat. */
function farNode(nodes, tp, vd, rand, tiers, top3) {
  const dist = (n) => Math.hypot(n.x - tp.x, n.z - tp.z);
  const dot = (n) => ((n.x - tp.x) * vd.x + (n.z - tp.z) * vd.z) / (dist(n) || 1);
  for (const [minD, maxDot] of tiers) {
    const cands = nodes.filter((n) => dist(n) > minD && (maxDot === null || dot(n) < maxDot));
    if (cands.length) {
      if (top3) cands.sort((a, b) => dist(b) - dist(a));
      return cands[Math.floor(rand() * (top3 ? Math.min(3, cands.length) : cands.length))];
    }
  }
  return null;
}

export function createPolice(scene, graph, fleet, rng) {
  const rand = typeof rng === 'function' ? rng : Math.random;

  const api = {
    wanted: 0,
    units: [],
    wantedEscaping: false,
    autoSpawn: true,
    addWanted,
    reportCrime,
    clearWanted,
    update,
    spawnPursuitUnit,
    pinTargetToRoad,
    enforceRoadBand,
    isOnRoad,
    onVehicleSwapped,
    setAutoSpawn,
    clearUnits,
  };
  const S = {
    time: 0,
    escapeTimer: 0,
    captureTimer: 0,
    lastCtx: null,
    lastCar: null,
  };

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

  function viewDir() {
    const ctx = S.lastCtx;
    const yaw = ctx?.cameraYaw ?? ctx?.player?.heading ?? 0;
    return { x: Math.sin(yaw), z: Math.cos(yaw) };
  }

  function newUnit(car, state) {
    return {
      car, state,
      path: [], wp: 0,
      perceptionTimer: rand() * 0.2,
      canSee: false,
      lastKnown: { x: car.pos.x, z: car.pos.z },
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
  }

  function spawnPursuitUnit(targetPos) {
    const tp = targetPos || (S.lastCtx && S.lastCtx.player ? S.lastCtx.player.pos : { x: 0, z: 0 });
    const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
    const best = farNode(nodes, tp, viewDir(), rand, [[45, 0.3], [40, null], [-1, null]], true);
    const car = fleet.spawnCar('police', best || { x: tp.x + 60, z: tp.z });
    car.driver = 'npc';
    car.sirenOn = true;
    car.maxSpeed = POLICE_MAX;
    const unit = newUnit(car, 'pursue');
    unit.lastKnown = { x: tp.x, z: tp.z };
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
    const unit = newUnit(car, 'patrol');
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
    if (!api.autoSpawn) return;
    let count = activeUnits().length;
    const playerPos = S.lastCtx && S.lastCtx.player ? S.lastCtx.player.pos : { x: 0, z: 0 };
    while (count < n) {
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
    const extra = activeUnits().slice(n);
    for (const u of extra) {
      u.state = 'giveup';
      u.giveupTimer = 0;
      if (u.car) u.car.sirenOn = false;
    }
  }

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

  function setAutoSpawn(on) {
    api.autoSpawn = on !== false;
  }

  function clearUnits() {
    for (const u of [...api.units]) despawn(u);
  }

  function policeStationNode() {
    const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
    const b = nodes.find((n) => n.policeStation)
      || nodes.find((n) => typeof n.district === 'string'
        && n.district.toLowerCase().includes('boulevard'));
    if (b) return b;
    return nodes[0] || { x: 0, z: 0 };
  }

  function busted(ctx) {
    const player = ctx && ctx.player;
    const cap = (CFG.MISSIONS && typeof CFG.MISSIONS.fineOnCaught === 'number')
      ? CFG.MISSIONS.fineOnCaught : 100;
    const have = (ctx && typeof ctx.money === 'number') ? ctx.money : 0;
    const fine = Math.max(0, Math.min(have, cap));
    if (ctx && typeof ctx.money === 'number') ctx.money -= fine;
    if (ctx && typeof ctx.toast === 'function') {
      ctx.toast(`Tertangkap polisi! Denda Rp ${fine}. Dibawa ke kantor polisi Boulevard.`);
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

  function update(dt, ctx) {
    const d = Math.min(Math.max(dt || 0, 0), 0.1);
    if (ctx) S.lastCtx = ctx;
    S.time += d;
    const player = ctx && ctx.player;
    if (!player || !player.pos) {
      for (const u of [...api.units]) stepUnit(u, null, null, d, ctx);
      return;
    }
    const pPos = player.pos;
    const pVel = {
      x: Math.sin(player.heading || 0) * (player.speed || 0),
      z: Math.cos(player.heading || 0) * (player.speed || 0),
    };
    const colliders = ctx && ctx.city ? ctx.city.colliders : null;

    const curCar = player.currentCar || null;
    if (curCar !== S.lastCar) {
      const wasSeen = api.units.some((u) => u.canSee);
      if (S.lastCar && curCar && !wasSeen) onVehicleSwapped();
      S.lastCar = curCar;
    }

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

    api.wantedEscaping = api.wanted > 0 && api.units.length > 0
      && !api.units.some((u) => u.canSee);

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

    const stoppedInCar = !player.onFoot && player.currentCar
      && Math.abs(player.speed || 0) < 0.5
      && Math.abs(player.currentCar.speed || 0) < 0.5;
    if (api.wanted > 0 && (player.onFoot || stoppedInCar)) {
      const capR = stoppedInCar ? 5.5 : 3; // CP19: separasi 4.4 > 3, in-car tak pernah kena
      const close = api.units.some((u) => u.state === 'pursue'
        && Math.hypot(u.car.pos.x - pPos.x, u.car.pos.z - pPos.z) < capR);
      S.captureTimer = close ? S.captureTimer + d : 0;
      if (S.captureTimer >= 2) {
        S.captureTimer = 0;
        busted(ctx);
        return;
      }
    } else {
      S.captureTimer = 0;
    }

    for (const u of [...api.units]) {
      if (u.state === 'giveup') {
        u.giveupTimer += d;
        u.car.speed = Math.max(0, u.car.speed - 10 * d);
        u.car.pos.x += Math.sin(u.car.heading) * u.car.speed * d;
        u.car.pos.z += Math.cos(u.car.heading) * u.car.speed * d;
        enforceRoadBand(u, d);
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

    let target = null;
    let cruise = 10;
    if (u.state === 'pursue' && pPos) {
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
    const dest = wpPos || target || { x: car.pos.x, z: car.pos.z };

    const dx = dest.x - car.pos.x;
    const dz = dest.z - car.pos.z;
    const wantHeading = Math.atan2(dx, dz);
    let dh = wantHeading - car.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const turnRate = 2.6;
    car.heading = turnToward(car.heading, wantHeading, turnRate * d);
    const speedTarget = Math.abs(dh) > 0.8 ? cruise * 0.6 : cruise;
    car.speed += clamp(speedTarget - car.speed, -18 * d, 12 * d);
    car.pos.x += Math.sin(car.heading) * car.speed * d;
    car.pos.z += Math.cos(car.heading) * car.speed * d;
    enforceRoadBand(u, d);

    u.stuckTimer += d;
    if (u.stuckTimer >= 2) {
      const moved = Math.hypot(car.pos.x - u.lastProgress.x, car.pos.z - u.lastProgress.z);
      if (moved < 0.5 && car.speed > 0.5) {
        u.stuckCount++;
        if (target && u.stuckCount >= 2) {
          const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
          const pp = ctx && ctx.player ? ctx.player.pos : car.pos;
          const pick = farNode(nodes, pp, viewDir(), rand,
            [[45, 0.3], [40, 0.3], [40, null]], false);
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

  spawnPatrolUnit();

  return api;
}
