
export const SAVE_VERSION = 1;
const PREFIX = 'teluk-cahaya.save.';
const VALID_SLOTS = ['1', '2', '3', 'auto'];

function keyFor(slot) { return PREFIX + String(slot); }

function isValidSlot(slot) { return VALID_SLOTS.includes(String(slot)); }

function storage() {
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

function migrate(data) {
  const v = typeof data.version === 'number' ? Math.floor(data.version) : 1;
  if (v > SAVE_VERSION) return null;
  data.version = SAVE_VERSION;
  return data;
}

function validate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const m = migrate(data);
  if (!m) return null;
  for (const k of ['money', 'health', 'timeHours']) {
    if (m[k] !== undefined && typeof m[k] !== 'number') return null;
  }
  for (const k of ['missionsCompleted', 'ownedCars']) {
    if (m[k] !== undefined && !Array.isArray(m[k])) return null;
  }
  return m;
}

function tryParse(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    return validate(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function createSaveSystem() {
  function save(slot, data) {
    if (!isValidSlot(slot)) return false;
    const store = storage();
    if (!store) return false;
    if (!data || typeof data !== 'object') return false;
    const key = keyFor(slot);
    const payload = {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      playerPos: data.playerPos ?? null,
      money: data.money ?? 0,
      health: data.health ?? 100,
      missionsCompleted: Array.isArray(data.missionsCompleted) ? data.missionsCompleted : [],
      activeMission: data.activeMission ?? null,
      timeHours: data.timeHours ?? 10,
      ownedCars: Array.isArray(data.ownedCars) ? data.ownedCars : [],
    };
    for (const k of Object.keys(data)) {
      if (!(k in payload)) {
        try {
          JSON.stringify(data[k]);
          payload[k] = data[k];
        } catch {
        }
      }
    }
    let json;
    try {
      json = JSON.stringify(payload);
    } catch {
      return false;
    }
    try {
      store.setItem(key + '.tmp', json);
      const old = store.getItem(key);
      if (old !== null) store.setItem(key + '.bak', old);
      store.setItem(key, json);
      store.removeItem(key + '.tmp');
      return true;
    } catch {
      try {
        store.removeItem(key + '.tmp');
      } catch {
      }
      return false;
    }
  }

  function load(slot) {
    if (!isValidSlot(slot)) return null;
    const store = storage();
    if (!store) return null;
    const key = keyFor(slot);
    try {
      return tryParse(store.getItem(key)) ?? tryParse(store.getItem(key + '.bak'));
    } catch {
      return null;
    }
  }

  function hasSave(slot) {
    return load(slot) !== null;
  }

  return { save, load, hasSave };
}
