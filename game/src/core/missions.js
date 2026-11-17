// Teluk Cahaya — missions slice (core sim, pure: no three.js).
// 8 story missions, linear, each teaching one system (open-world-crime
// skill §4): 1 driving, 2 steal, 3 wanted & escape, 4 night/neon,
// 5 chase & ramming, 6 on-foot combat, 7 timed route/minimap,
// 8 final cross-city escape at max wanted. Teach cheap, test under
// pressure, rest before the climax (level-design pacing).
//
// Fail-forward: 'busted' / 'wasted' during a mission, or the mission-7
// timer running out, returns the player to the mission-start checkpoint
// with a small $25 loss and restarts the mission from stage 0. Never a
// game over. Progression is SOFT: the physical city is always open
// (no invisible walls); "unlocking districts" is expressed through the
// mission giver's targets moving along the story arc
// (Boulevard -> Neon -> Port -> cross-city), never through a gate.
//
// State contract (extends the ARCHITECTURE.md mission shape, keeps it
// save-compatible): state.mission.active = {id, name, stage, objectives,
// startedAt, startPos, startMoney, ...}, state.mission.completed = [ids],
// state.mission.marker = {x, z, label} | null. HUD reads
// state.mission.data.{title,text}; the minimap reads state.mission.marker.
// Events emitted: 'objectiveChanged' {id, title, text, stage},
// 'missionComplete' {id, name, reward}, 'missionFailed' {id, reason},
// 'moneyChanged' {money, delta}. Events consumed: 'busted', 'wasted',
// 'vehicleEntered', 'vehicleExited', 'enemyDown', 'wantedChanged'.
import { makeRng } from './rng.js';
import { DAY_LENGTH } from './clock.js';
import { spawnVehicle, stepVehicle } from './vehicles.js';
import { addWanted } from './wanted.js';
import { nodeCoords, nearestNodeId } from './city.js';

// Clock offset mirrors main.js: clock 0 = 06:00, state.time counts
// session seconds, and state.clock = clockFromTime(time + 0.08*DAY_LENGTH).
const CLOCK_OFFSET = 0.08 * DAY_LENGTH;
const GOTO_RADIUS = 6;      // arrive radius for goto/driveTo stages
const GIVER_RADIUS = 4;     // F range at the mission giver / pickup
const CHASE_CAPTURE_RANGE = 8; // F range to finish the chase target
const FAIL_FINE = 25;       // small money loss on mission failure
const CHASE_STOP_HEALTH = 30; // target stops fleeing at/below this health

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function dist2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function fmtClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// Mission table. A stage target is either a POI key ('giver', 'garage',
// 'port', 'safehouse') resolved against city.pois, or a literal
// {x, z, label} on a road (multiples of 40, clear of buildings).
export const MISSIONS = [
  {
    id: 1, name: 'Paket Pertama', reward: 150,
    stages: [
      { text: 'Ambil paket dari pemberi misi — tekan F', target: 'giver' },
      { text: 'Antar paket ke Boulevard', target: { x: -40, z: -200, label: 'Titik Antar' } },
    ],
  },
  {
    id: 2, name: 'Mobil Pinjaman', reward: 200,
    stages: [
      { text: 'Curi mobil TERKUNCI (tahan F di dekat mobil)', target: 'giver' },
      { text: 'Antar mobil curian ke bengkel', target: 'garage' },
    ],
  },
  {
    id: 3, name: 'Dilihat Orang', reward: 250,
    stages: [
      { text: 'Buat keributan sampai wanted naik ke 1 bintang', target: null },
      { text: 'Hilangkan wanted sampai 0 bintang', target: null },
    ],
  },
  {
    id: 4, name: 'Antar Malam', reward: 300,
    stages: [
      { text: 'Antar ke Distrik Neon (titik 1/2)', target: { x: 120, z: -200, label: 'Neon 1/2' } },
      { text: 'Antar ke Distrik Neon (titik 2/2)', target: { x: 200, z: -80, label: 'Neon 2/2' } },
    ],
  },
  {
    id: 5, name: 'Kejar Dia', reward: 400,
    stages: [
      { text: 'Tabrak mobil target sampai rusak', target: null },
      { text: 'Dekati target dan tekan F', target: null },
    ],
  },
  {
    id: 6, name: 'Gudang Pelabuhan', reward: 450,
    stages: [
      { text: 'Pergi ke Gudang Pelabuhan', target: 'port' },
      { text: 'Kalahkan 3 penjaga gudang', target: 'port' },
    ],
  },
  {
    id: 7, name: 'Konvoi Tiga Titik', reward: 500, timeLimit: 240,
    stages: [
      { text: 'Antar ke titik 1/3', target: { x: 160, z: -200, label: 'Titik 1/3' } },
      { text: 'Antar ke titik 2/3', target: { x: -200, z: 160, label: 'Titik 2/3' } },
      { text: 'Antar ke titik 3/3', target: { x: 200, z: 200, label: 'Titik 3/3' } },
    ],
  },
  {
    id: 8, name: 'Kabur Besar', reward: 800,
    stages: [
      { text: 'Capai safehouse selagi wanted aktif', target: 'safehouse' },
      { text: 'Bersihkan wanted sampai 0 bintang', target: null },
    ],
  },
];

let ctxRef = null;
let cityRef = null;
let rng = null;

function toast(text) {
  if (ctxRef && ctxRef.showToast) ctxRef.showToast(text);
}

function nextHint(state) {
  const next = nextMissionId(state);
  if (!next) return 'Semua misi selesai! Jelajahi kota sesukamu.';
  return 'Temui pemberi misi di boulevard untuk misi berikutnya.';
}

export function nextMissionId(state) {
  const done = (state.mission && Array.isArray(state.mission.completed))
    ? state.mission.completed : [];
  for (let i = 1; i <= 8; i++) if (!done.includes(i)) return i;
  return null;
}

// Set the city clock to an hour (0-24). state.clock is recomputed from
// state.time every frame by main.js, so both are set together.
export function setClockHour(state, hour) {
  const target = (((hour - 6) / 24) % 1 + 1) % 1;
  state.time = (((target * DAY_LENGTH) - CLOCK_OFFSET) % DAY_LENGTH + DAY_LENGTH) % DAY_LENGTH;
  state.clock = target;
}

function resolveTarget(t, city) {
  if (!t) return null;
  const pois = (city && city.pois) || {};
  if (t === 'giver' && pois.missionGiver) {
    return { x: pois.missionGiver.x, z: pois.missionGiver.z, label: 'Pemberi Misi' };
  }
  if (t === 'garage' && pois.garage) {
    return { x: pois.garage.x, z: pois.garage.z, label: 'Bengkel' };
  }
  if (t === 'port') {
    const p = pois.portWarehouse || pois.port;
    if (p) return { x: p.x, z: p.z, label: 'Gudang Pelabuhan' };
    return null;
  }
  if (t === 'safehouse' && pois.safehouse) {
    return { x: pois.safehouse.x, z: pois.safehouse.z, label: 'Safehouse' };
  }
  return { x: t.x, z: t.z, label: t.label || 'Tujuan' };
}

function objectiveText(state, active) {
  const def = MISSIONS[active.id - 1];
  let text = def.stages[active.stage].text;
  if (active.id === 6 && active.stage === 1) {
    text += ' (' + (active.kills || 0) + '/3)';
    if (active.data.waitingCombat) text += ' — menunggu slice combat';
    else if (active.data.warnInCar) text += ' — Turun dari mobil!';
  }
  if (active.id === 7) text += ' · ' + fmtClock(active.timer);
  if (active.id === 8 && active.stage === 0 && state.wanted.stars === 0) {
    text += ' — Wanted hilang! Buat keributan dulu.';
  }
  return text;
}

function emitObjective(state) {
  const m = state.mission;
  const active = m.active;
  if (!active) return;
  const def = MISSIONS[active.id - 1];
  m.data.title = def.name;
  m.data.text = objectiveText(state, active);
  m.data.marker = m.marker;
  state.events.emit('objectiveChanged', {
    id: active.id, title: def.name, text: m.data.text, stage: active.stage,
  });
}

function refreshObjective(state) {
  if (state.mission.active) emitObjective(state);
}

function applyStage(state, city) {
  const m = state.mission;
  const active = m.active;
  if (!active) return;
  const def = MISSIONS[active.id - 1];
  const stage = def.stages[active.stage];
  m.objectiveIdx = active.stage;
  m.marker = stage.target ? resolveTarget(stage.target, city) : null;
  if (active.id === 5) {
    // Chase target: the marker follows the fleeing car.
    const t = state.vehicles.find((v) => v.id === active.targetVehicleId);
    if (t) m.marker = { x: t.x, z: t.z, label: 'Target' };
  }
  emitObjective(state);
}

function advanceStage(state, ctx) {
  const active = state.mission.active;
  if (!active) return;
  const def = MISSIONS[active.id - 1];
  active.stage += 1;
  if (active.stage >= def.stages.length) {
    completeMission(state, ctx);
    return;
  }
  // Stage-enter hook: mission 6 spawns its guards on arrival at the port.
  if (active.id === 6 && active.stage === 1) spawnEnemies(state, ctx);
  applyStage(state, ctx.city || cityRef);
}

// --- combat slice (lands in parallel): guarded, never statically imported.
function combatModule() {
  if (typeof window !== 'undefined' && window.__systems && window.__systems.loaded) {
    return window.__systems.loaded.get('combat') || null;
  }
  return null;
}

function spawnEnemies(state, ctx) {
  const active = state.mission.active;
  if (!active) return 0;
  const combat = combatModule();
  if (!combat || typeof combat.spawnEnemy !== 'function') {
    active.data.waitingCombat = true;
    active.spawnRetryT = 0;
    return 0;
  }
  active.data.waitingCombat = false;
  const city = ctx.city || cityRef;
  const base = (city.pois.portWarehouse || city.pois.port);
  const spots = [[10, -10], [-12, 6], [0, 14]];
  const ids = [];
  for (const [dx, dz] of spots) {
    const id = combat.spawnEnemy(state, base.x + dx, base.z + dz, {});
    if (id !== undefined && id !== null) ids.push(id);
  }
  active.enemyIds = ids;
  active.spawnedEnemies = ids.length;
  return ids.length;
}

function clearEnemies(state) {
  const combat = combatModule();
  if (combat && typeof combat.clearEnemies === 'function') {
    try { combat.clearEnemies(state); } catch (e) { /* combat slice owns its errors */ }
  }
}

function cleanupMission(state, active) {
  // Remove the chase target car (mission 5) so a retry spawns a fresh one.
  if (active.targetVehicleId !== null && active.targetVehicleId !== undefined) {
    const i = state.vehicles.findIndex((v) => v.id === active.targetVehicleId);
    if (i >= 0) {
      const v = state.vehicles[i];
      if (v.driver === 'player') {
        state.player.onFoot = true;
        state.player.vehicleId = null;
        state.player.speed = 0;
      }
      state.vehicles.splice(i, 1);
    }
    active.targetVehicleId = null;
  }
  if (active.id === 6) clearEnemies(state);
}

function exitPlayerVehicle(state) {
  const p = state.player;
  if (p.vehicleId !== null && p.vehicleId !== undefined) {
    const v = state.vehicles.find((x) => x.id === p.vehicleId);
    if (v) { v.driver = null; v.parked = true; v.speed = 0; }
  }
  p.onFoot = true;
  p.vehicleId = null;
  p.speed = 0;
  p.vx = 0; p.vz = 0;
}

export function startMission(state, city, ctx, id) {
  ctx = ctx || ctxRef;
  city = city || cityRef;
  const def = MISSIONS.find((d) => d.id === id);
  if (!def) return false;
  const m = state.mission;
  if (!m || m.active) return false; // one mission at a time
  if (Array.isArray(m.completed) && m.completed.includes(id)) return false;
  const active = {
    id: def.id, name: def.name, stage: 0,
    objectives: def.stages.map((s) => s.text),
    startedAt: state.time,
    startPos: { x: state.player.x, z: state.player.z },
    startMoney: state.money,
    timer: def.timeLimit || 0,
    kills: 0, killsTarget: 3,
    stolenVehicleId: null, targetVehicleId: null,
    enemyIds: [], spawnedEnemies: 0, spawnRetryT: 0,
    lastTimerText: null,
    data: {},
  };
  m.active = active;
  m.id = id;
  m.objectiveIdx = 0;
  m.state = 'active';
  m.timer = active.timer;
  // Per-mission start hooks.
  if (id === 4) setClockHour(state, 21);
  if (id === 5) spawnChaseTarget(state, city, active);
  if (id === 8) {
    // Final: wanted straight to 3 stars, one star per distinct cause
    // (addWanted caps at +1 star per incident).
    addWanted(state, 1, 'm8-cause-1');
    addWanted(state, 1, 'm8-cause-2');
    addWanted(state, 1, 'm8-cause-3');
  }
  applyStage(state, city);
  toast('Misi dimulai: ' + def.name);
  return true;
}

export function completeMission(state, ctx) {
  ctx = ctx || ctxRef;
  const m = state.mission;
  const active = m.active;
  if (!active) return false;
  const def = MISSIONS[active.id - 1];
  cleanupMission(state, active);
  state.money += def.reward;
  m.completed.push(active.id);
  if (state.flags) {
    state.flags.missionsDone = m.completed.slice();
    state.flags.districtsUnlocked = Math.min(4, m.completed.length + 1);
    if (active.id === 8) state.flags.storyDone = true;
  }
  const done = { id: active.id, name: def.name, reward: def.reward };
  m.active = null;
  m.id = 0;
  m.objectiveIdx = 0;
  m.state = 'none';
  m.timer = 0;
  m.marker = null;
  m.data = { title: 'Teluk Cahaya', text: nextHint(state), marker: null };
  state.events.emit('moneyChanged', { money: state.money, delta: def.reward });
  state.events.emit('missionComplete', done);
  state.events.emit('objectiveChanged', { id: 0, title: 'Teluk Cahaya', text: m.data.text, stage: 0 });
  toast('Misi selesai! +$' + def.reward);
  return true;
}

export function failMission(state, ctx, reason) {
  ctx = ctx || ctxRef;
  const m = state.mission;
  const active = m.active;
  if (!active) return false;
  const id = active.id;
  cleanupMission(state, active);
  // Checkpoint: back to where the mission started, on foot.
  exitPlayerVehicle(state);
  state.player.x = active.startPos.x;
  state.player.z = active.startPos.z;
  state.player.y = 0;
  state.player.vy = 0;
  state.player.grounded = true;
  state.player.heading = active.startPos.heading !== undefined
    ? active.startPos.heading : state.player.heading;
  state.money = Math.max(0, state.money - FAIL_FINE);
  state.events.emit('moneyChanged', { money: state.money, delta: -FAIL_FINE });
  state.events.emit('missionFailed', { id, reason });
  toast('Misi gagal: ' + reason + '. -$' + FAIL_FINE + '. Coba lagi.');
  // Restart the same mission from stage 0 (fresh attempt).
  m.active = null;
  startMission(state, ctx.city || cityRef, ctx, id);
  return true;
}

// --- mission 5: fleeing target (game-ai layers: perceive the player's
// position only via the cached route -> decide next waypoint -> path on
// the road graph with A* -> steer with stepVehicle; repath on waypoint
// reach, anti-stuck repath after 2 s without progress).
function spawnChaseTarget(state, city, active) {
  const p = state.player;
  const x = clamp(p.x + 60, -240, 240);
  const z = p.z;
  const v = spawnVehicle(state, city, 'sedan', x, z, Math.PI / 2,
    { driver: 'target', health: 100, parked: false, locked: false });
  active.targetVehicleId = v.id;
  active.route = null;
  active.nodeIdx = 0;
  active.lastX = v.x;
  active.lastZ = v.z;
  active.stuckT = 0;
}

function updateChaseTarget(state, city, dt, active) {
  const t = state.vehicles.find((v) => v.id === active.targetVehicleId);
  if (!t) return;
  // Stopped: wrecked enough (health <= 30) or the player took the wheel.
  if (t.health <= CHASE_STOP_HEALTH || t.driver === 'player') {
    t.speed = 0;
    return;
  }
  if (!active.route || active.nodeIdx >= active.route.length) {
    const from = nearestNodeId(t.x, t.z);
    const to = rng.int(0, 168);
    active.route = city.astar(from, to) || [from];
    active.nodeIdx = 0;
  }
  const wp = nodeCoords(active.route[active.nodeIdx]);
  if (dist2(t.x, t.z, wp.x, wp.z) < 8) {
    active.nodeIdx += 1;
    return;
  }
  const desired = Math.atan2(wp.x - t.x, wp.z - t.z);
  const steer = clamp(wrapAngle(desired - t.heading) * 1.2, -1, 1);
  stepVehicle(state, t, { throttle: 1, steer, brake: false, handbrake: false }, dt, city);
  // Anti-stuck: under 1 unit of progress in 2 s -> repath once.
  if (active.lastX === undefined) { active.lastX = t.x; active.lastZ = t.z; active.stuckT = 0; }
  active.stuckT += dt;
  if (active.stuckT >= 2) {
    const moved = dist2(t.x, t.z, active.lastX, active.lastZ);
    if (moved < 1) { active.route = null; active.nodeIdx = 0; }
    active.lastX = t.x;
    active.lastZ = t.z;
    active.stuckT = 0;
  }
}

// --- F interaction ----------------------------------------------------------
function nearestVehicleDist(state, x, z) {
  let best = Infinity;
  for (const v of state.vehicles) {
    if (v.health <= 0) continue;
    const d = dist2(v.x, v.z, x, z);
    if (d < best) best = d;
  }
  return best;
}

function handleInteract(state, ctx) {
  const p = state.player;
  const city = ctx.city || cityRef;
  const m = state.mission;
  const active = m.active;
  if (!p.onFoot) return; // in a car, F means exit (vehicles slice owns it)
  if (!active) {
    const next = nextMissionId(state);
    if (!next) { toast('Semua misi selesai!'); return; }
    const g = city.pois.missionGiver;
    if (dist2(p.x, p.z, g.x, g.z) > GIVER_RADIUS) return;
    // No car within 4 units, so F cannot be mistaken for entering a car
    // (the vehicles slice runs first and would eat the press).
    if (nearestVehicleDist(state, p.x, p.z) < GIVER_RADIUS) return;
    startMission(state, city, ctx, next);
    return;
  }
  if (active.id === 1 && active.stage === 0) {
    const g = city.pois.missionGiver;
    if (dist2(p.x, p.z, g.x, g.z) <= GIVER_RADIUS) advanceStage(state, ctx);
    return;
  }
  if (active.id === 5 && active.stage === 1) {
    const t = state.vehicles.find((v) => v.id === active.targetVehicleId);
    if (t && dist2(p.x, p.z, t.x, t.z) < CHASE_CAPTURE_RANGE) {
      completeMission(state, ctx);
    }
  }
}

// --- event handlers ---------------------------------------------------------
function onVehicleEntered(state, ctx) {
  const active = state.mission.active;
  if (!active) return;
  const p = state.player;
  const v = state.vehicles.find((x) => x.id === p.vehicleId);
  if (!v) return;
  if (active.id === 2 && active.stage === 0 && v.stolen && v.locked) {
    active.stolenVehicleId = v.id;
    advanceStage(state, ctx);
    return;
  }
  if (active.id === 6 && !active.data.warnInCar) {
    active.data.warnInCar = true;
    toast('Turun dari mobil — tawuran ini jalan kaki!');
    refreshObjective(state);
  }
}

function onEnemyDown(state, ctx, data) {
  const active = state.mission.active;
  if (!active || active.id !== 6 || active.stage !== 1) return;
  if (active.enemyIds.length > 0 && data && data.id !== undefined
    && !active.enemyIds.includes(data.id)) return;
  active.kills = (active.kills || 0) + 1;
  if (active.kills >= 3) {
    completeMission(state, ctx);
  } else {
    refreshObjective(state);
  }
}

function setPrompt(state, prompt) {
  if (prompt) state.uiPrompt = { ...prompt, mission: true };
  else if (state.uiPrompt && state.uiPrompt.mission) state.uiPrompt = null;
}

function updatePrompt(state, ctx) {
  const p = state.player;
  const city = ctx.city || cityRef;
  const active = state.mission.active;
  if (!p.onFoot) { setPrompt(state, null); return; }
  if (!active) {
    const next = nextMissionId(state);
    if (!next) { setPrompt(state, null); return; }
    const g = city.pois.missionGiver;
    if (dist2(p.x, p.z, g.x, g.z) <= GIVER_RADIUS
      && nearestVehicleDist(state, p.x, p.z) >= GIVER_RADIUS) {
      setPrompt(state, { key: 'F', text: 'Mulai misi: ' + MISSIONS[next - 1].name });
    } else {
      setPrompt(state, null);
    }
    return;
  }
  if (active.id === 1 && active.stage === 0) {
    const g = city.pois.missionGiver;
    if (dist2(p.x, p.z, g.x, g.z) <= GIVER_RADIUS) {
      setPrompt(state, { key: 'F', text: 'Ambil paket' });
      return;
    }
  }
  if (active.id === 5 && active.stage === 1) {
    const t = state.vehicles.find((v) => v.id === active.targetVehicleId);
    if (t && dist2(p.x, p.z, t.x, t.z) < CHASE_CAPTURE_RANGE) {
      setPrompt(state, { key: 'F', text: 'Tangkap target' });
      return;
    }
  }
  setPrompt(state, null);
}

// --- slice lifecycle --------------------------------------------------------
export function init(ctx) {
  ctxRef = ctx;
  cityRef = ctx.city;
  rng = makeRng((ctx.state.seed || 1) + 77);
  const s = ctx.state;
  if (!s.mission) s.mission = { id: 0, objectiveIdx: 0, state: 'none', timer: 0, data: {} };
  const m = s.mission;
  if (m.active === undefined) m.active = null;
  if (!Array.isArray(m.completed)) {
    m.completed = (s.flags && Array.isArray(s.flags.missionsDone))
      ? s.flags.missionsDone.slice() : [];
  }
  if (!('marker' in m) || m.marker === undefined) m.marker = null;
  if (!m.data) m.data = {};
  if (!m.data.text) {
    m.data.title = 'Teluk Cahaya';
    m.data.text = nextHint(s);
  }
  const ev = s.events;
  ev.on('busted', () => {
    if (s.mission.active) failMission(s, ctx, 'Tertangkap polisi');
  });
  ev.on('wasted', () => {
    if (s.mission.active) failMission(s, ctx, 'Kamu pingsan');
  });
  ev.on('vehicleEntered', () => onVehicleEntered(s, ctx));
  ev.on('vehicleExited', () => {
    const a = s.mission.active;
    if (a && a.id === 6 && a.data.warnInCar) {
      a.data.warnInCar = false;
      refreshObjective(s);
    }
  });
  ev.on('enemyDown', (d) => onEnemyDown(s, ctx, d));
  ev.on('wantedChanged', () => {
    const a = s.mission.active;
    if (a && (a.id === 3 || a.id === 8)) refreshObjective(s);
  });
  ev.on('saveLoaded', () => {
    // A loaded save restores mission id/objectiveIdx only; the run itself
    // is not resumed — the player re-starts it at the giver.
    if (!s.mission.active) {
      s.mission.data = { title: 'Teluk Cahaya', text: nextHint(s), marker: null };
      s.mission.marker = null;
    }
  });
}

export function update(state, input, dt, ctx) {
  if (!state || state.mode !== 'playing') return;
  const city = (ctx && ctx.city) || cityRef;
  if (input && input.actions && input.actions.interact) handleInteract(state, ctx);
  updatePrompt(state, ctx);
  const active = state.mission.active;
  if (!active) return;
  const p = state.player;
  const def = MISSIONS[active.id - 1];

  // Mission 7: shared countdown; the remaining time rides in the
  // objective text (re-emitted only when the displayed second changes).
  if (active.id === 7) {
    active.timer -= dt;
    state.mission.timer = active.timer;
    const shown = fmtClock(active.timer);
    if (shown !== active.lastTimerText) {
      active.lastTimerText = shown;
      refreshObjective(state);
    }
    if (active.timer <= 0) {
      failMission(state, ctx, 'Waktu habis');
      return;
    }
  }

  switch (active.id) {
    case 1: {
      if (active.stage === 1) {
        const t = resolveTarget(def.stages[1].target, city);
        if (dist2(p.x, p.z, t.x, t.z) < GOTO_RADIUS) completeMission(state, ctx);
      }
      break;
    }
    case 2: {
      if (active.stage === 1) {
        const v = state.vehicles.find((x) => x.id === active.stolenVehicleId);
        if (v && v.health <= 0) {
          failMission(state, ctx, 'Mobil curian hancur');
          return;
        }
        const g = resolveTarget('garage', city);
        if (v && p.vehicleId === v.id && dist2(p.x, p.z, g.x, g.z) < GOTO_RADIUS) {
          completeMission(state, ctx);
        }
      }
      break;
    }
    case 3: {
      if (active.stage === 0 && state.wanted.stars >= 1) advanceStage(state, ctx);
      else if (active.stage === 1 && state.wanted.stars === 0) completeMission(state, ctx);
      break;
    }
    case 4: {
      const t = resolveTarget(def.stages[active.stage].target, city);
      if (t && dist2(p.x, p.z, t.x, t.z) < GOTO_RADIUS) {
        if (active.stage === 0) advanceStage(state, ctx);
        else completeMission(state, ctx);
      }
      break;
    }
    case 5: {
      updateChaseTarget(state, city, dt, active);
      const t = state.vehicles.find((v) => v.id === active.targetVehicleId);
      if (active.stage === 0 && t && t.health <= CHASE_STOP_HEALTH) {
        advanceStage(state, ctx);
      }
      // The marker tracks the fleeing car; refresh its position cheaply
      // (no event spam: HUD reads the marker every frame anyway).
      if (t && state.mission.marker) {
        state.mission.marker.x = t.x;
        state.mission.marker.z = t.z;
      }
      break;
    }
    case 6: {
      if (active.stage === 0) {
        const t = resolveTarget('port', city);
        if (t && dist2(p.x, p.z, t.x, t.z) < GOTO_RADIUS) advanceStage(state, ctx);
      } else {
        if (active.data.waitingCombat) {
          active.spawnRetryT += dt;
          if (active.spawnRetryT >= 1) {
            active.spawnRetryT = 0;
            if (spawnEnemies(state, ctx) > 0) refreshObjective(state);
          }
        } else if ((active.kills || 0) >= 3) {
          completeMission(state, ctx);
        }
      }
      break;
    }
    case 7: {
      const t = resolveTarget(def.stages[active.stage].target, city);
      if (t && dist2(p.x, p.z, t.x, t.z) < GOTO_RADIUS) {
        if (active.stage < def.stages.length - 1) advanceStage(state, ctx);
        else completeMission(state, ctx);
      }
      break;
    }
    case 8: {
      if (active.stage === 0) {
        const t = resolveTarget('safehouse', city);
        if (t && state.wanted.stars >= 1 && dist2(p.x, p.z, t.x, t.z) < GOTO_RADIUS) {
          advanceStage(state, ctx);
        }
      } else if (state.wanted.stars === 0) {
        completeMission(state, ctx);
      }
      break;
    }
    default:
      break;
  }
}

export function sync(state, dt) {
  // No render state of its own; mission-markers.js renders state.mission.marker.
}

// --- screenshot shots (?shot=chase / ?shot=hud) -----------------------------
// main.js calls setupShot AFTER the slices load, so addWanted, police and
// vehicles are all live here. Both shots must run without errors.
let shotPoliceId = 1000;

function spawnShotPolice(state, city, x, z) {
  const p = state.player;
  const vehicle = spawnVehicle(state, city, 'patroli', x, z,
    Math.atan2(p.x - x, p.z - z), { driver: 'police', parked: false, locked: false });
  const unit = {
    id: shotPoliceId++,
    vehicleId: vehicle.id,
    vehicle,
    state: 'chase',
    lastKnown: { x: p.x, z: p.z },
    perceptionT: 0,
    lastSeenAt: 0,
    lostT: 0,
    searchT: 0,
    stateT: 0,
    route: city.astar(nearestNodeId(x, z), nearestNodeId(p.x, p.z)) || [],
    nodeIdx: 0,
    repathT: 0,
    stuckT: 0,
    stuckCount: 0,
    lastPos: { x, z },
    fanIndex: state.police.length,
  };
  state.police.push(unit);
  return unit;
}

function putPlayerInSport(state, city, x, z, heading) {
  const hero = state.vehicles.find((v) => v.owned && v.type === 'sport')
    || state.vehicles.find((v) => v.type === 'sport')
    || state.vehicles[0];
  if (!hero) return false;
  hero.x = x; hero.z = z; hero.heading = heading;
  hero.speed = 0; hero.parked = false; hero.driver = 'player'; hero.health = 100;
  const p = state.player;
  p.x = x; p.z = z; p.heading = heading;
  p.onFoot = false; p.vehicleId = hero.id; p.speed = 0;
  return true;
}

export function setupShot(name, state, city, input, startGame) {
  const ctx = ctxRef || { state, city, showToast: () => {} };
  if (name === 'chase') {
    setClockHour(state, 10);
    startGame();
    // Boulevard, 80 units short of the M1 delivery point: the marker
    // stays visible ahead instead of completing on the first frame.
    putPlayerInSport(state, city, -120, -200, Math.PI / 2);
    addWanted(state, 1, 'shot-chase-1');
    addWanted(state, 1, 'shot-chase-2');
    addWanted(state, 1, 'shot-chase-3');
    spawnShotPolice(state, city, -150, -200);
    spawnShotPolice(state, city, -144, -192);
    // Active mission 1 already at its driving stage, so the marker shows.
    if (startMission(state, city, ctx, 1) && state.mission.active) {
      advanceStage(state, ctx);
    }
    return;
  }
  if (name === 'hud') {
    setClockHour(state, 10);
    startGame();
    const p = state.player;
    p.x = -100; p.z = -200; p.heading = -Math.PI / 2;
    p.onFoot = true; p.vehicleId = null; p.speed = 0;
    state.money = 1250;
    state.events.emit('moneyChanged', { money: 1250, delta: 1100 });
    state.health = 80;
    state.events.emit('healthChanged', { health: 80 });
    addWanted(state, 1, 'shot-hud');
    if (startMission(state, city, ctx, 1) && state.mission.active) {
      advanceStage(state, ctx);
    }
  }
}
