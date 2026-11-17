// Teluk Cahaya — story missions (core simulation, no three.js here).
//
// Eight linear story missions for Raka. Each one introduces exactly one
// system, cheap to fail first and harder later (open-world-crime §4,
// level-design pacing: teach -> test -> rest -> climax):
//   1 drive a delivery, 2 steal a car, 3 earn and lose a wanted star,
//   4 drive at night through Neon, 5 ram a fleeing target, 6 fight on
//   foot at the port, 7 run a timed three-point route, 8 escape across
//   the city at maximum wanted.
//
// Failing never ends the game (fail-forward): being busted or wasted,
// or letting the mission-7 timer run out, drops the player back at the
// checkpoint where the mission started, takes a small $25 fine, and
// restarts the same mission from its first stage.
//
// Districts are never hard-gated: the whole city is always walkable and
// drivable. "Unlocking" is narrative only — the giver's targets travel
// further along the arc (Boulevard -> Neon -> Port -> cross-city) as
// missions complete, and flags.districtsUnlocked tracks that arc.
//
// State shape (save-compatible, mirrors ARCHITECTURE.md):
//   state.mission.active    = { id, name, stage, objectives, startedAt,
//                               startPos, startMoney, timer, kills, ... }
//   state.mission.completed = [ids in completion order]
//   state.mission.marker    = { x, z, label } | null (minimap + markers)
//   state.mission.data      = { title, text } (HUD objective line)
// Events out: 'objectiveChanged' { id, title, text, stage },
//   'missionComplete' { id, name, reward }, 'missionFailed' { id, reason },
//   'moneyChanged' { money, delta }.
// Events in: 'busted', 'wasted', 'vehicleEntered', 'vehicleExited',
//   'enemyDown', 'wantedChanged', 'saveLoaded'.
import { makeRng } from './rng.js';
import { DAY_LENGTH } from './clock.js';
import { spawnVehicle, stepVehicle } from './vehicles.js';
import { addWanted } from './wanted.js';
import { nodeCoords, nearestNodeId } from './city.js';

// main.js runs the clock as clockFromTime(time + 0.08 * DAY_LENGTH),
// with clock 0 meaning 06:00, so the same offset is applied here when
// a mission needs to jump the time of day.
const CLOCK_OFFSET = 0.08 * DAY_LENGTH;
const ARRIVE_RADIUS = 6;       // how close counts as "reached" a goto point
const GIVER_RADIUS = 4;        // F range at the giver / pickup point
const CAPTURE_RANGE = 8;       // F range to grab the mission-5 target
const FAIL_FINE = 25;          // money lost when a mission fails
const TARGET_WRECKED_AT = 30;  // chase target stops fleeing at/below this hp

function clampNum(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function flatDist(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

function normaliseAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function clockText(seconds) {
  const left = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(left / 60);
  const secs = String(left % 60).padStart(2, '0');
  return mins + ':' + secs;
}

// The mission table. A stage target is a POI key ('giver', 'garage',
// 'port', 'safehouse') resolved against city.pois at runtime, a literal
// { x, z, label } road point (multiples of 40, clear of buildings), or
// null for a state-based stage (wanted level, chase health, kills).
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

// Slice-local handles, set by init(). The combat slice is reached
// indirectly (see combatSlice below) because it loads in parallel.
let sliceCtx = null;
let sliceCity = null;
let sliceRng = null;

function showToast(text) {
  if (sliceCtx && sliceCtx.showToast) sliceCtx.showToast(text);
}

function nextHintText(state) {
  const upcoming = nextMissionId(state);
  if (!upcoming) return 'Semua misi selesai! Jelajahi kota sesukamu.';
  return 'Temui pemberi misi di boulevard untuk misi berikutnya.';
}

export function nextMissionId(state) {
  const done = (state.mission && Array.isArray(state.mission.completed))
    ? state.mission.completed
    : [];
  for (let i = 1; i <= 8; i++) {
    if (!done.includes(i)) return i;
  }
  return null;
}

// Jump the city clock to a given hour (0-24). main.js recomputes
// state.clock from state.time every frame, so both fields move together.
export function setClockHour(state, hour) {
  const target = (((hour - 6) / 24) % 1 + 1) % 1;
  state.time = (((target * DAY_LENGTH) - CLOCK_OFFSET) % DAY_LENGTH + DAY_LENGTH) % DAY_LENGTH;
  state.clock = target;
}

// Turn a stage target into a concrete { x, z, label } map point, or null.
function resolveStageTarget(t, city) {
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

// The HUD objective line for the current stage, with live annotations:
// mission 6 shows the guard kill count, mission 7 shows the countdown,
// mission 8 warns when wanted has dropped before the safehouse run.
function buildObjectiveText(state, active) {
  const def = MISSIONS[active.id - 1];
  let text = def.stages[active.stage].text;
  if (active.id === 6 && active.stage === 1) {
    text += ' (' + (active.kills || 0) + '/3)';
    if (active.data.waitingCombat) text += ' — menunggu slice combat';
    else if (active.data.warnInCar) text += ' — Turun dari mobil!';
  }
  if (active.id === 7) text += ' · ' + clockText(active.timer);
  if (active.id === 8 && active.stage === 0 && state.wanted.stars === 0) {
    text += ' — Wanted hilang! Buat keributan dulu.';
  }
  return text;
}

function publishObjective(state) {
  const m = state.mission;
  const active = m.active;
  if (!active) return;
  const def = MISSIONS[active.id - 1];
  m.data.title = def.name;
  m.data.text = buildObjectiveText(state, active);
  m.data.marker = m.marker;
  state.events.emit('objectiveChanged', {
    id: active.id, title: def.name, text: m.data.text, stage: active.stage,
  });
}

function republishObjective(state) {
  if (state.mission.active) publishObjective(state);
}

// Point the marker at the current stage's target (or, for mission 5,
// at the fleeing chase car) and publish the objective line.
function enterStage(state, city) {
  const m = state.mission;
  const active = m.active;
  if (!active) return;
  const def = MISSIONS[active.id - 1];
  const stage = def.stages[active.stage];
  m.objectiveIdx = active.stage;
  m.marker = stage.target ? resolveStageTarget(stage.target, city) : null;
  if (active.id === 5) {
    // Chase target: the marker rides along with the fleeing car.
    const t = state.vehicles.find((v) => v.id === active.targetVehicleId);
    if (t) m.marker = { x: t.x, z: t.z, label: 'Target' };
  }
  publishObjective(state);
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
  // Stage-enter hook: mission 6 spawns its warehouse guards on arrival.
  if (active.id === 6 && active.stage === 1) spawnPortGuards(state, ctx);
  enterStage(state, ctx.city || sliceCity);
}

// --- combat slice bridge ----------------------------------------------------
// The combat slice loads in parallel with this one, so it is never
// statically imported. It is reached through the shared window registry
// when present, and every call is guarded so a missing combat slice
// degrades to "guards pending" instead of crashing the mission.
function combatSlice() {
  if (typeof window !== 'undefined' && window.__systems && window.__systems.loaded) {
    return window.__systems.loaded.get('combat') || null;
  }
  return null;
}

function spawnPortGuards(state, ctx) {
  const active = state.mission.active;
  if (!active) return 0;
  const combat = combatSlice();
  if (!combat || typeof combat.spawnEnemy !== 'function') {
    // Combat not loaded yet: remember to retry once a second (see update).
    active.data.waitingCombat = true;
    active.spawnRetryT = 0;
    return 0;
  }
  active.data.waitingCombat = false;
  const city = ctx.city || sliceCity;
  const base = (city.pois.portWarehouse || city.pois.port);
  const offsets = [[10, -10], [-12, 6], [0, 14]];
  const ids = [];
  for (const [dx, dz] of offsets) {
    const id = combat.spawnEnemy(state, base.x + dx, base.z + dz, {});
    if (id !== undefined && id !== null) ids.push(id);
  }
  active.enemyIds = ids;
  active.spawnedEnemies = ids.length;
  return ids.length;
}

function despawnPortGuards(state) {
  const combat = combatSlice();
  if (combat && typeof combat.clearEnemies === 'function') {
    try {
      combat.clearEnemies(state);
    } catch (e) {
      // The combat slice owns its own errors; missions just move on.
    }
  }
}

// Tear down anything a mission run created, so a retry starts clean:
// remove the mission-5 chase car (and put the player on foot if they
// were driving it), and clear mission-6 guards.
function teardownMissionRun(state, active) {
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
  if (active.id === 6) despawnPortGuards(state);
}

function forcePlayerOnFoot(state) {
  const p = state.player;
  if (p.vehicleId !== null && p.vehicleId !== undefined) {
    const v = state.vehicles.find((x) => x.id === p.vehicleId);
    if (v) {
      v.driver = null;
      v.parked = true;
      v.speed = 0;
    }
  }
  p.onFoot = true;
  p.vehicleId = null;
  p.speed = 0;
  p.vx = 0;
  p.vz = 0;
}

export function startMission(state, city, ctx, id) {
  ctx = ctx || sliceCtx;
  city = city || sliceCity;
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
  if (id === 4) setClockHour(state, 21); // night run: jump to 21:00
  if (id === 5) spawnChaseTarget(state, city, active);
  if (id === 8) {
    // Finale: wanted straight to 3 stars, one star per distinct cause
    // (addWanted caps at +1 star per incident).
    addWanted(state, 1, 'm8-cause-1');
    addWanted(state, 1, 'm8-cause-2');
    addWanted(state, 1, 'm8-cause-3');
  }
  enterStage(state, city);
  showToast('Misi dimulai: ' + def.name);
  return true;
}

export function completeMission(state, ctx) {
  ctx = ctx || sliceCtx;
  const m = state.mission;
  const active = m.active;
  if (!active) return false;
  const def = MISSIONS[active.id - 1];
  teardownMissionRun(state, active);
  state.money += def.reward;
  m.completed.push(active.id);
  if (state.flags) {
    state.flags.missionsDone = m.completed.slice();
    // Narrative progression: pay and the wanted cap rise as the arc
    // advances; districtsUnlocked counts completed missions + 1, max 4.
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
  m.data = { title: 'Teluk Cahaya', text: nextHintText(state), marker: null };
  state.events.emit('moneyChanged', { money: state.money, delta: def.reward });
  state.events.emit('missionComplete', done);
  state.events.emit('objectiveChanged', { id: 0, title: 'Teluk Cahaya', text: m.data.text, stage: 0 });
  showToast('Misi selesai! +$' + def.reward);
  return true;
}

export function failMission(state, ctx, reason) {
  ctx = ctx || sliceCtx;
  const m = state.mission;
  const active = m.active;
  if (!active) return false;
  const id = active.id;
  teardownMissionRun(state, active);
  // Fail-forward checkpoint: back to where the mission started, on foot.
  forcePlayerOnFoot(state);
  state.player.x = active.startPos.x;
  state.player.z = active.startPos.z;
  state.player.y = 0;
  state.player.vy = 0;
  state.player.grounded = true;
  state.player.heading = active.startPos.heading !== undefined
    ? active.startPos.heading
    : state.player.heading;
  state.money = Math.max(0, state.money - FAIL_FINE);
  state.events.emit('moneyChanged', { money: state.money, delta: -FAIL_FINE });
  state.events.emit('missionFailed', { id, reason });
  showToast('Misi gagal: ' + reason + '. -$' + FAIL_FINE + '. Coba lagi.');
  // Restart the same mission from stage 0 (a fresh attempt).
  m.active = null;
  startMission(state, ctx.city || sliceCity, ctx, id);
  return true;
}

// --- mission 5: the fleeing target ------------------------------------------
// Game-AI layers, in order: perceive the player's position only through
// the cached route -> pick the next waypoint -> path on the road graph
// with A* -> steer with stepVehicle. The route is replanned on waypoint
// reach, and an anti-stuck replan fires after 2 s without progress.
function spawnChaseTarget(state, city, active) {
  const p = state.player;
  const x = clampNum(p.x + 60, -240, 240);
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
  if (t.health <= TARGET_WRECKED_AT || t.driver === 'player') {
    t.speed = 0;
    return;
  }
  if (!active.route || active.nodeIdx >= active.route.length) {
    const from = nearestNodeId(t.x, t.z);
    const to = sliceRng.int(0, 168);
    active.route = city.astar(from, to) || [from];
    active.nodeIdx = 0;
  }
  const wp = nodeCoords(active.route[active.nodeIdx]);
  if (flatDist(t.x, t.z, wp.x, wp.z) < 8) {
    active.nodeIdx += 1;
    return;
  }
  const desired = Math.atan2(wp.x - t.x, wp.z - t.z);
  const steer = clampNum(normaliseAngle(desired - t.heading) * 1.2, -1, 1);
  stepVehicle(state, t, { throttle: 1, steer, brake: false, handbrake: false }, dt, city);
  // Anti-stuck: under 1 unit of progress in 2 s -> replan the route once.
  if (active.lastX === undefined) {
    active.lastX = t.x;
    active.lastZ = t.z;
    active.stuckT = 0;
  }
  active.stuckT += dt;
  if (active.stuckT >= 2) {
    const moved = flatDist(t.x, t.z, active.lastX, active.lastZ);
    if (moved < 1) {
      active.route = null;
      active.nodeIdx = 0;
    }
    active.lastX = t.x;
    active.lastZ = t.z;
    active.stuckT = 0;
  }
}

// --- F interaction ----------------------------------------------------------
function closestVehicleDist(state, x, z) {
  let best = Infinity;
  for (const v of state.vehicles) {
    if (v.health <= 0) continue;
    const d = flatDist(v.x, v.z, x, z);
    if (d < best) best = d;
  }
  return best;
}

function handleInteract(state, ctx) {
  const p = state.player;
  const city = ctx.city || sliceCity;
  const m = state.mission;
  const active = m.active;
  if (!p.onFoot) return; // in a car, F means exit (vehicles slice owns it)
  if (!active) {
    const next = nextMissionId(state);
    if (!next) {
      showToast('Semua misi selesai!');
      return;
    }
    const g = city.pois.missionGiver;
    if (flatDist(p.x, p.z, g.x, g.z) > GIVER_RADIUS) return;
    // No car within 4 units, so F cannot be mistaken for entering a car
    // (the vehicles slice runs first and would eat the press).
    if (closestVehicleDist(state, p.x, p.z) < GIVER_RADIUS) return;
    startMission(state, city, ctx, next);
    return;
  }
  if (active.id === 1 && active.stage === 0) {
    const g = city.pois.missionGiver;
    if (flatDist(p.x, p.z, g.x, g.z) <= GIVER_RADIUS) advanceStage(state, ctx);
    return;
  }
  if (active.id === 5 && active.stage === 1) {
    const t = state.vehicles.find((v) => v.id === active.targetVehicleId);
    if (t && flatDist(p.x, p.z, t.x, t.z) < CAPTURE_RANGE) {
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
    // Mission 2: the player just stole a locked car — that car is the cargo.
    active.stolenVehicleId = v.id;
    advanceStage(state, ctx);
    return;
  }
  if (active.id === 6 && !active.data.warnInCar) {
    active.data.warnInCar = true;
    showToast('Turun dari mobil — tawuran ini jalan kaki!');
    republishObjective(state);
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
    republishObjective(state);
  }
}

function setMissionPrompt(state, prompt) {
  if (prompt) state.uiPrompt = { ...prompt, mission: true };
  else if (state.uiPrompt && state.uiPrompt.mission) state.uiPrompt = null;
}

function updatePrompt(state, ctx) {
  const p = state.player;
  const city = ctx.city || sliceCity;
  const active = state.mission.active;
  if (!p.onFoot) {
    setMissionPrompt(state, null);
    return;
  }
  if (!active) {
    const next = nextMissionId(state);
    if (!next) {
      setMissionPrompt(state, null);
      return;
    }
    const g = city.pois.missionGiver;
    if (flatDist(p.x, p.z, g.x, g.z) <= GIVER_RADIUS
      && closestVehicleDist(state, p.x, p.z) >= GIVER_RADIUS) {
      setMissionPrompt(state, { key: 'F', text: 'Mulai misi: ' + MISSIONS[next - 1].name });
    } else {
      setMissionPrompt(state, null);
    }
    return;
  }
  if (active.id === 1 && active.stage === 0) {
    const g = city.pois.missionGiver;
    if (flatDist(p.x, p.z, g.x, g.z) <= GIVER_RADIUS) {
      setMissionPrompt(state, { key: 'F', text: 'Ambil paket' });
      return;
    }
  }
  if (active.id === 5 && active.stage === 1) {
    const t = state.vehicles.find((v) => v.id === active.targetVehicleId);
    if (t && flatDist(p.x, p.z, t.x, t.z) < CAPTURE_RANGE) {
      setMissionPrompt(state, { key: 'F', text: 'Tangkap target' });
      return;
    }
  }
  setMissionPrompt(state, null);
}

// --- slice lifecycle --------------------------------------------------------
export function init(ctx) {
  sliceCtx = ctx;
  sliceCity = ctx.city;
  sliceRng = makeRng((ctx.state.seed || 1) + 77);
  const s = ctx.state;
  if (!s.mission) s.mission = { id: 0, objectiveIdx: 0, state: 'none', timer: 0, data: {} };
  const m = s.mission;
  if (m.active === undefined) m.active = null;
  if (!Array.isArray(m.completed)) {
    m.completed = (s.flags && Array.isArray(s.flags.missionsDone))
      ? s.flags.missionsDone.slice()
      : [];
  }
  if (!('marker' in m) || m.marker === undefined) m.marker = null;
  if (!m.data) m.data = {};
  if (!m.data.text) {
    m.data.title = 'Teluk Cahaya';
    m.data.text = nextHintText(s);
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
      republishObjective(s);
    }
  });
  ev.on('enemyDown', (d) => onEnemyDown(s, ctx, d));
  ev.on('wantedChanged', () => {
    const a = s.mission.active;
    if (a && (a.id === 3 || a.id === 8)) republishObjective(s);
  });
  ev.on('saveLoaded', () => {
    // A loaded save restores mission id/objectiveIdx only; the run
    // itself is not resumed — the player re-starts it at the giver.
    if (!s.mission.active) {
      s.mission.data = { title: 'Teluk Cahaya', text: nextHintText(s), marker: null };
      s.mission.marker = null;
    }
  });
}

export function update(state, input, dt, ctx) {
  if (!state || state.mode !== 'playing') return;
  const city = (ctx && ctx.city) || sliceCity;
  if (input && input.actions && input.actions.interact) handleInteract(state, ctx);
  updatePrompt(state, ctx);
  const active = state.mission.active;
  if (!active) return;
  const p = state.player;
  const def = MISSIONS[active.id - 1];

  // Mission 7: one shared countdown; the remaining time rides in the
  // objective text (re-emitted only when the displayed second changes).
  if (active.id === 7) {
    active.timer -= dt;
    state.mission.timer = active.timer;
    const shown = clockText(active.timer);
    if (shown !== active.lastTimerText) {
      active.lastTimerText = shown;
      republishObjective(state);
    }
    if (active.timer <= 0) {
      failMission(state, ctx, 'Waktu habis');
      return;
    }
  }

  switch (active.id) {
    case 1: {
      if (active.stage === 1) {
        const t = resolveStageTarget(def.stages[1].target, city);
        if (flatDist(p.x, p.z, t.x, t.z) < ARRIVE_RADIUS) completeMission(state, ctx);
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
        const g = resolveStageTarget('garage', city);
        if (v && p.vehicleId === v.id && flatDist(p.x, p.z, g.x, g.z) < ARRIVE_RADIUS) {
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
      const t = resolveStageTarget(def.stages[active.stage].target, city);
      if (t && flatDist(p.x, p.z, t.x, t.z) < ARRIVE_RADIUS) {
        if (active.stage === 0) advanceStage(state, ctx);
        else completeMission(state, ctx);
      }
      break;
    }
    case 5: {
      updateChaseTarget(state, city, dt, active);
      const t = state.vehicles.find((v) => v.id === active.targetVehicleId);
      if (active.stage === 0 && t && t.health <= TARGET_WRECKED_AT) {
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
        const t = resolveStageTarget('port', city);
        if (t && flatDist(p.x, p.z, t.x, t.z) < ARRIVE_RADIUS) advanceStage(state, ctx);
      } else if (active.data.waitingCombat) {
        // Combat slice arrived late: retry the guard spawn each second.
        active.spawnRetryT += dt;
        if (active.spawnRetryT >= 1) {
          active.spawnRetryT = 0;
          if (spawnPortGuards(state, ctx) > 0) republishObjective(state);
        }
      } else if ((active.kills || 0) >= 3) {
        completeMission(state, ctx);
      }
      break;
    }
    case 7: {
      const t = resolveStageTarget(def.stages[active.stage].target, city);
      if (t && flatDist(p.x, p.z, t.x, t.z) < ARRIVE_RADIUS) {
        if (active.stage < def.stages.length - 1) advanceStage(state, ctx);
        else completeMission(state, ctx);
      }
      break;
    }
    case 8: {
      if (active.stage === 0) {
        const t = resolveStageTarget('safehouse', city);
        // Wanted must still be active on arrival: if it dropped to 0
        // en route, the player has to raise it again first.
        if (t && state.wanted.stars >= 1 && flatDist(p.x, p.z, t.x, t.z) < ARRIVE_RADIUS) {
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
  hero.x = x;
  hero.z = z;
  hero.heading = heading;
  hero.speed = 0;
  hero.parked = false;
  hero.driver = 'player';
  hero.health = 100;
  const p = state.player;
  p.x = x;
  p.z = z;
  p.heading = heading;
  p.onFoot = false;
  p.vehicleId = hero.id;
  p.speed = 0;
  return true;
}

export function setupShot(name, state, city, input, startGame) {
  const ctx = sliceCtx || { state, city, showToast: () => {} };
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
    p.x = -100;
    p.z = -200;
    p.heading = -Math.PI / 2;
    p.onFoot = true;
    p.vehicleId = null;
    p.speed = 0;
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
