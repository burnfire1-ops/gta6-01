// Save Teluk Cahaya —
// Dibangun dari tesis §5
// tulis atomik (kunci
// load memvalidasi versi
// Semua dalam try/catch:
//
// Kontrak: createSaveSyst
// deleteSave(slot), listS
// Bentuk data (data polos
//   { version: 1, savedAt
//     activeMission,
// save() mengembalikan

export const SAVE_VERSION = 1;
const PREFIX = 'teluk-cahaya.save.';
const VALID_SLOTS = ['1', '2', '3', 'auto'];

function keyFor(slot) {
  return PREFIX + String(slot);
}

function isValidSlot(slot) {
  return VALID_SLOTS.includes(String(slot));
}

function storage() {
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

// Migrasi bertahap v ->
function migrate(data) {
  let v = typeof data.version === 'number' ? Math.floor(data.version) : 1;
  if (v > SAVE_VERSION) return null; // save
  while (v < SAVE_VERSION) {
    // Migrasi masa depan
    v += 1;
  }
  data.version = v;
  return data;
}

function validate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const migrated = migrate(data);
  if (!migrated) return null;
  // Validasi ringan: fiel
  if (migrated.money !== undefined && typeof migrated.money !== 'number') return null;
  if (migrated.health !== undefined && typeof migrated.health !== 'number') return null;
  if (migrated.timeHours !== undefined && typeof migrated.timeHours !== 'number') return null;
  if (migrated.missionsCompleted !== undefined && !Array.isArray(migrated.missionsCompleted)) return null;
  if (migrated.ownedCars !== undefined && !Array.isArray(migrated.ownedCars)) return null;
  return migrated;
}

function tryParse(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    return validate(JSON.parse(raw));
  } catch {
    return null; // JSON r
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
    // Field tambahan dari
    // apa adanya selama b
    for (const k of Object.keys(data)) {
      if (!(k in payload)) {
        try {
          JSON.stringify(data[k]);
          payload[k] = data[k];
        } catch {
          // Nilai tak bis
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
      // 1) Tulis kunci se
      store.setItem(key + '.tmp', json);
      // 2) Salin save lam
      const old = store.getItem(key);
      if (old !== null) store.setItem(key + '.bak', old);
      // 3) Baru timpa kun
      store.setItem(key, json);
      store.removeItem(key + '.tmp');
      return true;
    } catch {
      try {
        store.removeItem(key + '.tmp');
      } catch {
        // Abaikan: member
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
      // Utama dulu, cadan
      return tryParse(store.getItem(key)) ?? tryParse(store.getItem(key + '.bak'));
    } catch {
      return null;
    }
  }

  function hasSave(slot) {
    return load(slot) !== null;
  }

  function deleteSave(slot) {
    if (!isValidSlot(slot)) return false;
    const store = storage();
    if (!store) return false;
    const key = keyFor(slot);
    try {
      store.removeItem(key);
      store.removeItem(key + '.bak');
      store.removeItem(key + '.tmp');
      return true;
    } catch {
      return false;
    }
  }

  // Slot yang punya save
  function listSlots() {
    const out = [];
    for (const slot of VALID_SLOTS) {
      const data = load(slot);
      if (data) out.push({ slot, savedAt: data.savedAt || null });
    }
    return out;
  }

  return { save, load, hasSave, deleteSave, listSlots };
}
