// Teluk Cahaya — combat slice (core simulation, pure: no three.js).
// Owns state.enemies, the pistol + fists, and enemy AI (idle / chase /
// attack / down). Missions call spawnEnemy / clearEnemies. wanted.js reacts
// to 'crimeSeen' / 'healthChanged' here; pedestrians react to 'punch' /
// 'crimeSeen' (panic + witness reports).

export const MAG_SIZE = 12;
export const RESERVE_START = 48;
export const PUNCH_RANGE = 2.2;
export const PUNCH_HALF_ARC = Math.PI / 6; // 60 deg arc total, +/-30 deg
export const PUNCH_DAMAGE = 25;
export const PUNCH_COOLDOWN = 0.45;
export const GUN_DAMAGE = 34;
export const GUN_RANGE = 40;
export const GUN_COOLDOWN = 0.3;
export const AIM_RANGE = 30;
export const AIM_HALF_ANGLE = Math.PI / 12; // 15 deg off the camera axis
export const RELOAD_TIME = 1.2;
export const ENEMY_AGGRO_RANGE = 25; // idle -> chase
export const ENEMY_LOSE_RANGE = 30; // chase -> idle (hysteresis vs 25)
export const ENEMY_CHASE_SPEED = 4.5;
export const ENEMY_ATTACK_RANGE = 1.8; // chase -> attack
export const ENEMY_ATTACK_EXIT = 2.2; // attack -> chase (hysteresis vs 1.8)
export const ENEMY_HIT_DAMAGE = 8;
export const ENEMY_ATTACK_COOLDOWN = 1;
export const FLINCH_TIME = 0.3;
export const DOWN_TIME = 5;
const TOAST_THROTTLE = 3;

let nextId = 1;
let subscribed = false;
// Runtime timers (reset by init; one game instance like the other slices).
let rt = null;
function freshRt() {
  return { punchCd: 0, gunCd: 0, reloadT: 0, toasts: {} };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// A discrete action: buffer still live (direct callers) or already consumed into input.actions.
function pressed(input, action) {
  if (!input) return false;
  if (input.actions && input.actions[action]) return true;
  if (typeof input.pressed === 'function') return input.pressed(action);
  return false;
}

function aiming(input) {
  if (!input) return false;
  if (input.actions && input.actions.aim) return true;
  if (input.keys && typeof input.keys.has === 'function') {
    if (input.keys.has('Mouse2')) return true;
    if (input.binds && input.binds.aim && input.keys.has(input.binds.aim)) return true;
  }
  if (typeof input.held === 'function') return input.held('aim');
  return false;
}

// Toast helper with a per-message throttle so one state cannot spam.
function toast(state, ctx, text) {
  const last = rt.toasts[text];
  if (last !== undefined && state.time - last < TOAST_THROTTLE) return;
  rt.toasts[text] = state.time;
  if (ctx && typeof ctx.showToast === 'function') ctx.showToast(text);
}

function emitAmmo(state) {
  const a = state.ammo;
  state.events.emit('ammoChanged', { mag: a.mag, reserve: a.reserve });
  // Keep the legacy player.ammo field roughly in sync (total rounds left).
  state.player.ammo = a.mag + a.reserve;
}

function refillAmmo(state) {
  if (!state.ammo) state.ammo = { mag: MAG_SIZE, reserve: RESERVE_START };
  state.ammo.mag = MAG_SIZE;
  state.ammo.reserve = RESERVE_START;
  if (rt) rt.reloadT = 0;
  emitAmmo(state);
}

// --- public API (missions slice) --------------------------------------------
export function spawnEnemy(state, x, z, opts = {}) {
  if (!state.enemies) state.enemies = [];
  const e = {
    id: nextId++,
    x, z,
    heading: opts.heading ?? 0,
    health: opts.health ?? 100,
    state: 'idle', // 'idle' | 'chase' | 'attack' | 'down'
    attackT: 0, downT: 0,
    // Internals (owned by this slice, read by the render slice).
    flinchT: 0,
    punchT: 0,
    speed: 0,
    stuckT: 0,
    lastX: x,
    lastZ: z,
    strafeT: 0,
    strafeDir: 1,
  };
  state.enemies.push(e);
  return e.id;
}

export function clearEnemies(state) {
  if (state.enemies) state.enemies.length = 0;
}

// --- damage -------------------------------------------------------------------
function damageEnemy(state, e, dmg) {
  if (!e || e.state === 'down') return;
  e.health -= dmg;
  e.flinchT = FLINCH_TIME;
  state.events.emit('combatHit', { target: 'enemy', id: e.id, damage: dmg });
  if (e.health <= 0) {
    e.health = 0; e.state = 'down';
    e.downT = DOWN_TIME;
    e.flinchT = 0;
    e.speed = 0;
    state.events.emit('enemyDown', { id: e.id });
  }
}

function damagePlayer(state, dmg) {
  state.health = clamp(state.health - dmg, 0, 100);
  state.events.emit('healthChanged', { health: state.health, max: 100 });
}

// --- aim ----------------------------------------------------------------------
function cameraForwardXZ(ctx, state) {
  const cam = ctx && ctx.camera;
  if (cam && cam.matrixWorld && cam.matrixWorld.elements) {
    const el = cam.matrixWorld.elements;
    const fx = -el[8], fz = -el[10];
    const len = Math.hypot(fx, fz);
    if (len > 1e-6) return { x: fx / len, z: fz / len };
  }
  const h = state.player.heading; // fallback: the direction the player faces
  return { x: Math.sin(h), z: Math.cos(h) };
}

// Soft lock-on: nearest living enemy inside the aim cone and range.
function computeAimTarget(state, ctx) {
  const p = state.player;
  const fwd = cameraForwardXZ(ctx, state);
  const cosLimit = Math.cos(AIM_HALF_ANGLE);
  let best = null, bestD = AIM_RANGE;
  for (const e of state.enemies) {
    if (e.state === 'down') continue;
    const dx = e.x - p.x, dz = e.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > bestD) continue;
    const dot = (dx * fwd.x + dz * fwd.z) / (d || 1);
    if (dot < cosLimit) continue;
    best = e; bestD = d;
  }
  return best ? best.id : null;
}

// --- player attacks ------------------------------------------------------------
function resolvePunch(state) {
  const p = state.player;
  const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
  const cosLimit = Math.cos(PUNCH_HALF_ARC);
  // One 'punch' event per swing (audio + ped panic listen); combat owns it,
  // player.js only animates. Hit resolution follows.
  state.events.emit('punch', { x: p.x, z: p.z });
  // Nearest enemy inside range + the 60 deg arc.
  let bestE = null, bestD = PUNCH_RANGE;
  for (const e of state.enemies) {
    if (e.state === 'down') continue;
    const dx = e.x - p.x, dz = e.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > bestD) continue;
    if ((dx * fx + dz * fz) / (d || 1) < cosLimit) continue;
    bestE = e; bestD = d;
  }
  if (bestE) {
    damageEnemy(state, bestE, PUNCH_DAMAGE);
    return;
  }
  // No enemy: a ped in the same arc takes the hit (assault, witnessed).
  const peds = state.peds || [];
  let bestP = null;
  bestD = PUNCH_RANGE;
  for (const ped of peds) {
    const dx = ped.x - p.x, dz = ped.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > bestD) continue;
    if ((dx * fx + dz * fz) / (d || 1) < cosLimit) continue;
    bestP = ped; bestD = d;
  }
  if (bestP) {
    state.events.emit('combatHit', { target: 'ped', id: bestP.id, damage: PUNCH_DAMAGE });
    state.events.emit('crimeSeen', { kind: 'assault', x: p.x, z: p.z });
    return;
  }
  // Whiff: nothing in range; the 'punch' event above already fired.
}

function resolveShot(state, ctx) {
  const p = state.player;
  const a = state.ammo;
  if (a.mag <= 0) {
    if (a.reserve <= 0) {
      toast(state, ctx, 'Amunisi habis — kembali ke safehouse');
    } else {
      toast(state, ctx, 'Magasin kosong — tekan R untuk isi ulang');
    }
    return;
  }
  a.mag -= 1;
  rt.gunCd = GUN_COOLDOWN;
  emitAmmo(state);
  state.events.emit('gunshot', { x: p.x, z: p.z });
  // Shooting is a crime: witnesses / police react via crimeSeen.
  state.events.emit('crimeSeen', { kind: 'shooting', x: p.x, z: p.z });
  const target = state.aimTarget != null
    ? state.enemies.find((e) => e.id === state.aimTarget)
    : null;
  if (target && target.state !== 'down') {
    const d = Math.hypot(target.x - p.x, target.z - p.z);
    if (d <= GUN_RANGE) damageEnemy(state, target, GUN_DAMAGE);
  }
}

// --- enemy AI -------------------------------------------------------------------
function updateEnemy(state, e, dt, city) {
  const p = state.player;
  if (e.punchT > 0) e.punchT -= dt;
  if (e.state === 'down') {
    e.downT -= dt;
    return e.downT > 0; // stays visible (lying flat) until the timer expires
  }
  if (e.flinchT > 0) {
    e.flinchT -= dt;
    e.speed = 0;
    return true;
  }
  const dx = p.x - e.x, dz = p.z - e.z;
  const d = Math.hypot(dx, dz);

  if (e.state === 'idle') {
    e.speed = 0;
    if (d <= ENEMY_AGGRO_RANGE) { e.state = 'chase'; e.stuckT = 0; e.lastX = e.x; e.lastZ = e.z; }
    return true;
  }

  if (e.state === 'chase') {
    if (d > ENEMY_LOSE_RANGE) { e.state = 'idle'; e.speed = 0; return true; }
    if (d <= ENEMY_ATTACK_RANGE) { e.state = 'attack'; e.attackT = 0; e.speed = 0; return true; }
    // Steer at the player; buildings push the circle out (same as peds).
    let mx = dx / (d || 1), mz = dz / (d || 1);
    if (e.strafeT > 0) {
      // Anti-stuck sidestep: slide perpendicular for a short beat.
      e.strafeT -= dt;
      const px = -mz * e.strafeDir, pz = mx * e.strafeDir;
      mx = (mx + px) / Math.SQRT2; mz = (mz + pz) / Math.SQRT2;
    }
    const step = ENEMY_CHASE_SPEED * dt;
    const c = city.collideCircle(e.x + mx * step, e.z + mz * step, 0.6);
    e.x = c.x; e.z = c.z;
    e.heading = Math.atan2(mx, mz);
    e.speed = ENEMY_CHASE_SPEED;
    // Stuck guard: <0.5 units in 2 s -> sidestep once, then keep going.
    e.stuckT += dt;
    if (e.stuckT >= 2) {
      const moved = Math.hypot(e.x - e.lastX, e.z - e.lastZ);
      if (moved < 0.5 && e.strafeT <= 0) {
        e.strafeT = 0.6;
        e.strafeDir *= -1;
      }
      e.stuckT = 0; e.lastX = e.x; e.lastZ = e.z;
    }
    return true;
  }

  // attack
  if (d > ENEMY_ATTACK_EXIT) { e.state = 'chase'; e.speed = 0; return true; }
  e.speed = 0;
  e.heading = Math.atan2(dx, dz);
  e.attackT -= dt;
  if (e.attackT <= 0) {
    e.attackT = ENEMY_ATTACK_COOLDOWN;
    e.punchT = 0.32;
    damagePlayer(state, ENEMY_HIT_DAMAGE);
  }
  return true;
}

// Keep living enemies from stacking on one point (O(n^2), few enemies).
function separateEnemies(state) {
  const list = state.enemies;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.state === 'down' || b.state === 'down') continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= 1.44 || d2 < 1e-6) continue; // keep >= 1.2 units apart
      const d = Math.sqrt(d2);
      const push = (1.2 - d) / 2;
      const nx = dx / d, nz = dz / d;
      a.x -= nx * push; a.z -= nz * push;
      b.x += nx * push; b.z += nz * push;
    }
  }
}

// --- lifecycle ------------------------------------------------------------------
export function init(ctx) {
  const { state } = ctx;
  if (!state.enemies) state.enemies = [];
  if (!state.ammo) state.ammo = { mag: MAG_SIZE, reserve: RESERVE_START };
  state.aimTarget = null;
  state.aiming = false;
  rt = freshRt();
  if (!subscribed) {
    subscribed = true;
    state.events.on('safehouseEntered', () => refillAmmo(state));
    state.events.on('missionComplete', () => refillAmmo(state));
  }
}

export function update(state, input, dt, ctx) {
  if (!state.player || state.mode !== 'playing' || dt <= 0) {
    if (state.player) { state.aiming = false; state.aimTarget = null; }
    return;
  }
  const city = ctx.city;
  const p = state.player;
  if (rt.punchCd > 0) rt.punchCd -= dt;
  if (rt.gunCd > 0) rt.gunCd -= dt;

  // Reload: 1.2 s, then move rounds from reserve into the mag.
  if (rt.reloadT > 0) {
    rt.reloadT -= dt;
    if (rt.reloadT <= 0) {
      rt.reloadT = 0;
      const a = state.ammo;
      const moved = Math.min(MAG_SIZE - a.mag, a.reserve);
      a.mag += moved;
      a.reserve -= moved;
      emitAmmo(state);
    }
  }

  const onFoot = p.onFoot;
  const isAiming = onFoot && aiming(input);
  state.aiming = isAiming;
  state.aimTarget = isAiming ? computeAimTarget(state, ctx) : null;

  const attackPressed = pressed(input, 'attack');
  if (attackPressed && !onFoot) {
    // No shooting from cars (genre scope cut): attack does nothing.
    toast(state, ctx, 'Tidak bisa menembak dari mobil');
  } else if (attackPressed && onFoot) {
    if (isAiming) {
      if (rt.reloadT <= 0 && rt.gunCd <= 0) resolveShot(state, ctx);
    } else if (rt.punchCd <= 0) {
      rt.punchCd = PUNCH_COOLDOWN;
      resolvePunch(state);
    }
  }

  if (pressed(input, 'reload') && rt.reloadT <= 0) {
    const a = state.ammo;
    if (a.mag < MAG_SIZE && a.reserve > 0) rt.reloadT = RELOAD_TIME;
  }

  // Enemy AI.
  if (!state.enemies) state.enemies = [];
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const alive = updateEnemy(state, state.enemies[i], dt, city);
    if (!alive) state.enemies.splice(i, 1);
  }
  separateEnemies(state);
}

// Render is handled by render/combat-render.js; the sim needs no per-frame sync.
export function sync(state, dt) {}
