// Teluk Cahaya — wanted slice (core sim, pure: no three.js).
// Owns state.wanted: the witnessed meter, the hide timer, escape rules
// (search circle, profile swap, alley stop, safehouse, respray) and the
// BUSTED / WASTED outcomes. Police perception writes
// state.wanted.seenByPolice; this module only reads it (one frame of lag
// is accepted: wanted updates before police in the slice order).
// Genre rules: open-world-crime skill §1-§2.

export function hideThresholdFor(stars) {
  if (stars >= 4) return 15;
  if (stars === 3) return 10;
  return 6; // 1-2 stars
}

function distToBuildings(city, x, z) {
  // Distance from a point to the nearest building AABB (0 when inside).
  let best = Infinity;
  const list = city.buildings || [];
  for (const b of list) {
    const dx = Math.max(b.minX - x, 0, x - b.maxX);
    const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
    const d = Math.hypot(dx, dz);
    if (d < best) best = d;
    if (best === 0) break;
  }
  return best;
}

function exitPlayerVehicle(state) {
  const p = state.player;
  if (p.vehicleId !== null && p.vehicleId !== undefined) {
    const v = state.vehicles.find((x) => x.id === p.vehicleId);
    if (v) { v.driver = null; v.parked = true; }
  }
  p.onFoot = true;
  p.vehicleId = null;
  p.speed = 0;
  p.vx = 0; p.vz = 0;
}

function clearWanted(state) {
  const w = state.wanted;
  w.stars = 0;
  w.hideT = 0;
  w.blinkT = 0;
  w.captureT = 0;
  w.searchCircle = null;
}

function doBusted(state, ctx) {
  const w = state.wanted;
  const fine = Math.min(state.money, 100 + w.stars * 50);
  state.money -= fine;
  clearWanted(state);
  const ps = ctx.city.pois.policeStation;
  exitPlayerVehicle(state);
  const p = state.player;
  p.x = ps.x; p.z = ps.z; p.y = 0; p.vy = 0; p.grounded = true;
  p.heading = Math.PI;
  state.health = 100;
  state.events.emit('healthChanged', { health: state.health });
  state.events.emit('moneyChanged', { money: state.money });
  state.events.emit('busted', { fine });
  state.events.emit('wantedChanged', { stars: 0 });
  if (ctx.showToast) ctx.showToast(`Tertangkap! Denda $${fine}.`);
}

function doWasted(state, ctx) {
  const fine = Math.min(state.money, 50);
  state.money -= fine;
  clearWanted(state);
  const sh = ctx.city.pois.safehouse;
  exitPlayerVehicle(state);
  const p = state.player;
  p.x = sh.x; p.z = sh.z; p.y = 0; p.vy = 0; p.grounded = true;
  p.heading = Math.PI;
  state.health = 100;
  state.events.emit('healthChanged', { health: state.health });
  state.events.emit('moneyChanged', { money: state.money });
  state.events.emit('wasted', { fine });
  state.events.emit('wantedChanged', { stars: 0 });
  if (ctx.showToast) ctx.showToast(`Pingsan! Denda $${fine}.`);
}

// Max +1 star per incident. The same incident key within 1 s adds nothing.
export function addWanted(state, amount, cause) {
  const w = state.wanted;
  if (!w || w.stars >= 5) return false;
  const key = cause || 'unknown';
  const now = state.time || 0;
  if (w.lastIncidentKey === key && now - (w.lastIncidentT || -99) < 1) return false;
  w.lastIncidentKey = key;
  w.lastIncidentT = now;
  w.stars = Math.min(5, w.stars + Math.min(1, amount || 1));
  w.hideT = 0;
  w.blinkT = 0;
  state.events.emit('wantedChanged', { stars: w.stars });
  return true;
}

let cityRef = null;
let ctxRef = null;
let alleyT = 0;

function onVehicleEntered(state) {
  // Profile swap: entering a stolen car while unseen shortens the escape.
  const w = state.wanted;
  if (!w || w.stars <= 0 || w.seenByPolice) return;
  const p = state.player;
  if (p.vehicleId === null || p.vehicleId === undefined) return;
  const v = state.vehicles.find((x) => x.id === p.vehicleId);
  if (v && v.stolen) {
    w.hideT += 4;
    if (ctxRef && ctxRef.showToast) ctxRef.showToast('Ganti mobil, jejak mengabur.');
  }
}

function onHealthChanged(state, data) {
  const health = data && data.health !== undefined ? data.health : state.health;
  if (health > 0 || !ctxRef) return;
  // Health 0 while wanted -> BUSTED; health 0 with no wanted -> WASTED.
  if (state.wanted.stars > 0) doBusted(state, ctxRef);
  else doWasted(state, ctxRef);
}

function onWitnessReported(state, data) {
  addWanted(state, 1, 'witness');
}

function onCrimeSeen(state, data) {
  // Police who see the crime directly raise wanted instantly. If no unit
  // has line of sight, leave it to the witness chain — do not raise here.
  if (!cityRef || !state.police) return;
  const p = state.player;
  for (const u of state.police) {
    const v = state.vehicles.find((x) => x.id === u.vehicleId);
    if (!v) continue;
    const d = Math.hypot(v.x - p.x, v.z - p.z);
    if (d > 60) continue;
    if (cityRef.segmentBlocked(v.x, v.z, p.x, p.z)) continue;
    addWanted(state, 1, (data && data.kind) || 'crime');
    return;
  }
}

export function init(ctx) {
  const { state, city } = ctx;
  cityRef = city;
  ctxRef = ctx;
  if (!state.wanted) state.wanted = { stars: 0, hideT: 0, blinkT: 0, searchCircle: null, captureT: 0 };
  const w = state.wanted;
  if (w.seenByPolice === undefined) w.seenByPolice = false;
  if (w.lastIncidentKey === undefined) w.lastIncidentKey = null;
  if (w.lastIncidentT === undefined) w.lastIncidentT = -99;
  alleyT = 0;
  state.events.on('vehicleEntered', () => onVehicleEntered(state));
  state.events.on('healthChanged', (data) => onHealthChanged(state, data));
  state.events.on('witnessReported', (data) => onWitnessReported(state, data));
  state.events.on('crimeSeen', (data) => onCrimeSeen(state, data));
}

export function update(state, input, dt, ctx) {
  if (!state || state.mode !== 'playing') return;
  const w = state.wanted;
  const p = state.player;
  if (!w) return;
  const seen = !!w.seenByPolice;
  const city = ctx.city;

  // --- BUSTED: capture meter filled ---------------------------------------
  if (w.stars > 0 && w.captureT >= 3) {
    doBusted(state, ctx);
    return;
  }
  // Capture meter bleeds off when no police unit is holding the player.
  if (w.captureT > 0) {
    let held = false;
    if (p.onFoot) {
      for (const u of state.police) {
        const v = state.vehicles.find((x) => x.id === u.vehicleId);
        if (v && Math.hypot(v.x - p.x, v.z - p.z) < 8) { held = true; break; }
      }
    }
    if (!held) w.captureT = Math.max(0, w.captureT - dt * 2);
  }

  if (w.stars <= 0) {
    w.hideT = 0; w.blinkT = 0; w.searchCircle = null;
    return;
  }

  // --- search circle (3+ stars): centred on the player while seen, ------
  // frozen while unseen so the player can actually leave it.
  if (w.stars >= 3) {
    if (seen || !w.searchCircle) {
      w.searchCircle = { x: p.x, z: p.z, r: 60 + w.stars * 10 };
    }
  } else {
    w.searchCircle = null;
  }

  // --- hide timer: only runs while no police unit sees the player --------
  if (seen) {
    w.hideT = 0;
    w.blinkT = 0;
    alleyT = 0;
  } else {
    const threshold = hideThresholdFor(w.stars);
    let rate = 1;
    if (w.searchCircle) {
      const d = Math.hypot(p.x - w.searchCircle.x, p.z - w.searchCircle.z);
      if (d > w.searchCircle.r) rate = 2; // outside the search area: 2x faster
    }
    w.hideT += dt * rate;
    // Alley stop: standing still next to a building, unseen, for 2 s
    // doubles the progress on top of the base rate.
    const speed = Math.abs(p.speed || 0);
    if (speed < 0.5 && distToBuildings(city, p.x, p.z) < 8) {
      alleyT += dt;
      if (alleyT >= 2) w.hideT += dt * 2;
    } else {
      alleyT = 0;
    }
    if (w.hideT >= threshold) {
      w.stars -= 1;
      w.hideT = 0;
      w.blinkT = 0;
      alleyT = 0;
      if (w.stars < 3) w.searchCircle = null;
      state.events.emit('wantedChanged', { stars: w.stars });
      return; // star dropped; safehouse/respray checks run next tick
    }
    // Blink warning in the last 3 s before the drop.
    w.blinkT = w.hideT >= threshold - 3 ? threshold - w.hideT : 0;
  }

  // --- safehouse: clears 1-2 stars, only when unseen on entry ------------
  if (!seen && w.stars >= 1 && w.stars <= 2) {
    const sh = city.pois.safehouse;
    if (Math.hypot(p.x - sh.x, p.z - sh.z) < 6) {
      clearWanted(state);
      state.events.emit('wantedChanged', { stars: 0 });
      state.events.emit('safehouseEntered', { x: sh.x, z: sh.z });
      if (ctx.showToast) ctx.showToast('Wanted bersih.');
      return;
    }
  }

  // --- respray: in a car, unseen, fee $200 --------------------------------
  if (!seen && !p.onFoot && p.vehicleId !== null && state.money >= 200) {
    const ps = city.pois.paintShop;
    if (Math.hypot(p.x - ps.x, p.z - ps.z) < 8) {
      state.money -= 200;
      clearWanted(state);
      state.events.emit('moneyChanged', { money: state.money });
      state.events.emit('wantedChanged', { stars: 0 });
      if (ctx.showToast) ctx.showToast('Mobil dicat ulang. Wanted bersih.');
    }
  }
}

export function sync(state, dt) {
  // No render state of its own; the HUD reads state.wanted directly.
}
