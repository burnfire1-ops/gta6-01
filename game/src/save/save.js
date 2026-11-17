// Save slice — versioned localStorage slots + autosave (Teluk Cahaya).
// Owns only the save format, slots and atomic writes. It never touches
// rendering, sim logic or other slices. Plain JSON data only, no live refs.
//
// Format (version 1):
//   { version: 1, savedAt, player: {x,z,heading,health,armor,money,ammo,hasPistol},
//     clock, mission: {id, objectiveIdx}, flags, vehiclesOwned, packagesFound }
// Keys: 'teluk-cahaya-save-1'..'3', 'teluk-cahaya-autosave', backup '<key>-bak'.
// Atomic write: temp '<key>-tmp' -> old main to backup -> temp into main -> drop temp.
// Load: main first, backup on failure. localStorage may be absent (private
// mode): every storage access is guarded, save fails quietly with false.

export const SAVE_VERSION = 1;

const SLOT_KEYS = {
  1: 'teluk-cahaya-save-1',
  2: 'teluk-cahaya-save-2',
  3: 'teluk-cahaya-save-3',
  autosave: 'teluk-cahaya-autosave',
};

// The live state, bound in init(). load()/hasSave() work without it; save()
// and applySave() need it.
let _state = null;

function keyFor(slot) {
  if (slot === 'autosave') return SLOT_KEYS.autosave;
  const n = Number(slot);
  if (n === 1 || n === 2 || n === 3) return SLOT_KEYS[n];
  return null;
}

// --- guarded storage access (localStorage may not exist / may throw) ---
function storageGet(key) {
  try { return window.localStorage.getItem(key); } catch (e) { return null; }
}
function storageSet(key, value) {
  try { window.localStorage.setItem(key, value); return true; }
  catch (e) { return false; }
}
function storageRemove(key) {
  try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
}

// --- capture / validate / migrate ---

function captureState() {
  const s = _state;
  const p = s.player || {};
  return {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    player: {
      x: p.x ?? 0,
      z: p.z ?? 0,
      heading: p.heading ?? 0,
      health: s.health ?? 100,
      armor: s.armor ?? 0,
      money: s.money ?? 0,
      ammo: p.ammo ?? 0,
      hasPistol: !!p.hasPistol,
    },
    clock: s.clock ?? 0,
    mission: {
      id: s.mission ? (s.mission.id ?? 0) : 0,
      objectiveIdx: s.mission ? (s.mission.objectiveIdx ?? 0) : 0,
    },
    flags: {
      districtsUnlocked: s.flags ? (s.flags.districtsUnlocked ?? 1) : 1,
      packagesFound: s.flags ? (s.flags.packagesFound ?? 0) : 0,
      vehiclesOwned: s.flags && Array.isArray(s.flags.vehiclesOwned)
        ? s.flags.vehiclesOwned.slice() : [],
      storyDone: s.flags ? !!s.flags.storyDone : false,
      missionsDone: s.flags && Array.isArray(s.flags.missionsDone)
        ? s.flags.missionsDone.slice() : [],
    },
    // Duplicated at top level for easy inspection; flags is authoritative.
    vehiclesOwned: s.flags && Array.isArray(s.flags.vehiclesOwned)
      ? s.flags.vehiclesOwned.slice() : [],
    packagesFound: s.flags ? (s.flags.packagesFound ?? 0) : 0,
  };
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// Validate a parsed save object; returns it normalised, or null.
function validate(data) {
  if (!data || typeof data !== 'object') return null;
  if (!data.player || typeof data.player !== 'object') return null;
  if (!isFiniteNumber(data.player.x) || !isFiniteNumber(data.player.z)) return null;
  if (!isFiniteNumber(data.player.heading)) data.player.heading = 0;
  if (!isFiniteNumber(data.player.health)) data.player.health = 100;
  if (!isFiniteNumber(data.player.armor)) data.player.armor = 0;
  if (!isFiniteNumber(data.player.money)) data.player.money = 0;
  if (!isFiniteNumber(data.player.ammo)) data.player.ammo = 0;
  data.player.hasPistol = !!data.player.hasPistol;
  if (!isFiniteNumber(data.clock)) data.clock = 0;
  if (!data.mission || typeof data.mission !== 'object') data.mission = {};
  if (!isFiniteNumber(data.mission.id)) data.mission.id = 0;
  if (!isFiniteNumber(data.mission.objectiveIdx)) data.mission.objectiveIdx = 0;
  if (!data.flags || typeof data.flags !== 'object') data.flags = {};
  if (!isFiniteNumber(data.flags.districtsUnlocked)) data.flags.districtsUnlocked = 1;
  if (!isFiniteNumber(data.flags.packagesFound)) data.flags.packagesFound = 0;
  if (!Array.isArray(data.flags.vehiclesOwned)) data.flags.vehiclesOwned = [];
  if (!Array.isArray(data.flags.missionsDone)) data.flags.missionsDone = [];
  data.flags.storyDone = !!data.flags.storyDone;
  if (!Array.isArray(data.vehiclesOwned)) data.vehiclesOwned = data.flags.vehiclesOwned;
  if (!isFiniteNumber(data.packagesFound)) data.packagesFound = data.flags.packagesFound;
  return data;
}

// Stub migration for pre-v1 saves: v1 is the first shipped schema, so there
// is no older shape to convert from. A save stamped version < 1 (or with no
// version field at all) is read field-wise with defaults; if the essential
// fields (player position) cannot be recovered, it is rejected (null).
function migrateLegacy(data) {
  if (!data || typeof data !== 'object') return null;
  const v = data.version === undefined ? 0 : Number(data.version);
  if (!Number.isFinite(v) || v >= 1) return null; // not a legacy save
  const out = {
    version: SAVE_VERSION,
    savedAt: typeof data.savedAt === 'string' ? data.savedAt : null,
    player: (data.player && typeof data.player === 'object') ? data.player : {},
    clock: data.clock,
    mission: (data.mission && typeof data.mission === 'object') ? data.mission : {},
    flags: (data.flags && typeof data.flags === 'object') ? data.flags : {},
  };
  // Legacy saves may have kept money/health/armor at top level.
  if (isFiniteNumber(data.money)) out.player.money = data.money;
  if (isFiniteNumber(data.health)) out.player.health = data.health;
  if (isFiniteNumber(data.armor)) out.player.armor = data.armor;
  return validate(out);
}

function parseSave(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let data;
  try { data = JSON.parse(raw); } catch (e) { return null; }
  if (!data || typeof data !== 'object') return null;
  const v = data.version === undefined ? 0 : Number(data.version);
  if (!Number.isFinite(v)) return null;
  if (v > SAVE_VERSION) return null; // newer build: refuse, never half-load
  if (v < SAVE_VERSION) return migrateLegacy(data);
  return validate(data);
}

// --- public API ---

export function save(slot) {
  const key = keyFor(slot);
  if (!key || !_state) return false;
  let json;
  try { json = JSON.stringify(captureState()); } catch (e) { return false; }
  const tmpKey = key + '-tmp';
  const bakKey = key + '-bak';
  // 1. Write the new save to a temp key.
  if (!storageSet(tmpKey, json)) return false;
  // 2. Keep the previous good save as backup.
  const oldMain = storageGet(key);
  if (oldMain !== null) storageSet(bakKey, oldMain);
  // 3. Move temp into place, then drop the temp key.
  const tmpValue = storageGet(tmpKey);
  if (tmpValue === null || !storageSet(key, tmpValue)) {
    storageRemove(tmpKey);
    return false;
  }
  storageRemove(tmpKey);
  try { _state.events.emit('saveDone', { slot }); } catch (e) { /* ignore */ }
  return true;
}

export function load(slot) {
  const key = keyFor(slot);
  if (!key) return null;
  const fromMain = parseSave(storageGet(key));
  if (fromMain) return fromMain;
  return parseSave(storageGet(key + '-bak'));
}

export function hasSave(slot) {
  return load(slot) !== null;
}

export function loadLatest() {
  const auto = load('autosave');
  if (auto) return auto;
  for (const n of [3, 2, 1]) {
    const data = load(n);
    if (data) return data;
  }
  return null;
}

export function applySave(data) {
  if (!_state || !data) return false;
  const valid = validate(data);
  if (!valid) return false;
  const s = _state;
  const p = valid.player;
  // Force the player out of any vehicle first: a loaded position is on foot.
  s.player.onFoot = true;
  s.player.vehicleId = null;
  s.player.speed = 0;
  s.player.x = p.x;
  s.player.z = p.z;
  s.player.y = 0;
  s.player.heading = p.heading;
  s.health = p.health;
  s.armor = p.armor;
  s.money = p.money;
  s.player.ammo = p.ammo;
  s.player.hasPistol = p.hasPistol;
  s.clock = valid.clock;
  if (!s.mission) s.mission = { id: 0, objectiveIdx: 0, state: 'none', timer: 0, data: {} };
  s.mission.id = valid.mission.id;
  s.mission.objectiveIdx = valid.mission.objectiveIdx;
  if (!s.flags) s.flags = {};
  s.flags.districtsUnlocked = valid.flags.districtsUnlocked;
  s.flags.packagesFound = valid.flags.packagesFound;
  s.flags.vehiclesOwned = valid.flags.vehiclesOwned.slice();
  s.flags.storyDone = valid.flags.storyDone;
  s.flags.missionsDone = valid.flags.missionsDone.slice();
  try {
    s.events.emit('saveLoaded', { mission: valid.mission.id });
    s.events.emit('objectiveChanged', { id: valid.mission.id, objectiveIdx: valid.mission.objectiveIdx });
  } catch (e) { /* ignore */ }
  return true;
}

export function autosave() {
  return save('autosave');
}

function anySaveExists() {
  for (const slot of [1, 2, 3, 'autosave']) {
    if (hasSave(slot)) return true;
  }
  return false;
}

export function init(ctx) {
  if (ctx && ctx.state) _state = ctx.state;
  // Continue button: enabled only when a loadable save exists.
  try {
    const btn = document.querySelector('#btn-continue');
    if (btn && anySaveExists()) btn.removeAttribute('disabled');
  } catch (e) { /* DOM/storage unavailable: leave the button as-is */ }
  // Autosave at safe boundaries.
  if (_state && _state.events) {
    _state.events.on('missionComplete', () => autosave());
    _state.events.on('safehouseEntered', () => autosave());
  }
}

// Test hook (also used by the HUD/menus later): window.__save.
if (typeof window !== 'undefined') {
  window.__save = { save, load, hasSave, loadLatest, applySave, autosave, init, SAVE_VERSION };
}
