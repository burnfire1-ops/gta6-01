// Teluk Cahaya — wanted system: heat, hiding, escape, BUSTED / WASTED.
// Pure sim: no three.js. Owns state.wanted only; police.js owns the cops
// themselves (spawns, perception, capture meter) and missions.js raises
// heat through addWanted(). The HUD, minimap and audio listen to the
// 'wantedChanged' / 'busted' / 'wasted' events — they never poll.
//
// Rules (ARCHITECTURE §5 + tesis): at most +1 star per incident, cap 5.
// While unseen the hide timer runs — 6 s at 1-2 stars, 10 s at 3, 15 s
// at 4-5 — and each expiry drops one star. Leaving the search circle
// unseen doubles the timer; sitting still and quiet on foot shortens it.
// The safehouse clears 1-2 stars only, unseen. A respray at the paint
// shop clears any heat in a car, unseen, for a fee. Getting held by the
// police on foot, or going down with heat on you, means BUSTED; going
// down clean means WASTED. Neither is game over.

const MAX_STARS = 5;
const BLINK_SECONDS = 3; // warning window before a star drops
const CAPTURE_FULL = 3; // seconds held by police on foot before BUSTED
const CAPTURE_DECAY = 2; // capture meter drains this fast once free (per s)
const CAPTURE_RANGE = 6; // must match police.js capture distance
const SEARCH_BASE_R = 45; // search circle radius at 1 star
const SEARCH_PER_STAR = 12; // extra radius per star
const SAFEHOUSE_RADIUS = 14;
const PAINTSHOP_RADIUS = 14;
const RESPRAY_FEE_PER_STAR = 60;
const BUSTED_FINE_BASE = 40;
const BUSTED_FINE_PER_STAR = 80;
const WASTED_FINE = 60;
const QUIET_SPEED = 0.5; // standing still on foot counts as hiding quiet
const QUIET_RATE = 1.5; // quiet hiding runs the timer this much faster
const OUTSIDE_CIRCLE_RATE = 2; // outside the search circle, unseen: 2x

// Edge latch so entering the safehouse fires 'safehouseEntered' once per
// visit (save.js autosaves and combat.js refills ammo on that event).
let atSafehouse = false;

// --- small helpers ---------------------------------------------------------

function dist2d(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

function hideDuration(stars) {
  if (stars >= 4) return 15;
  if (stars === 3) return 10;
  return 6;
}

function searchRadius(stars) {
  return SEARCH_BASE_R + SEARCH_PER_STAR * Math.max(0, stars);
}

function emit(state, name, data) {
  if (state.events && typeof state.events.emit === 'function') {
    state.events.emit(name, data);
  }
}

function emitWanted(state) {
  emit(state, 'wantedChanged', { stars: state.wanted.stars });
}

// Freshest last-known player position from any police unit, else the
// player's live position (used when heat is first raised).
function lastKnownPosition(state) {
  let best = null;
  let bestAt = -Infinity;
  for (const unit of state.police || []) {
    const known = unit && unit.lastKnown;
    if (!known || !Number.isFinite(known.x) || !Number.isFinite(known.z)) continue;
    const at = Number.isFinite(unit.lastSeenAt) ? unit.lastSeenAt : 0;
    if (at >= bestAt) { bestAt = at; best = known; }
  }
  if (best) return { x: best.x, z: best.z };
  return { x: state.player.x, z: state.player.z };
}

function nearestCopDistance(state) {
  const p = state.player;
  let nearest = Infinity;
  for (const unit of state.police || []) {
    const car = unit && unit.vehicle;
    if (car && Number.isFinite(car.x) && Number.isFinite(car.z)) {
      const d = dist2d(p.x, p.z, car.x, car.z);
      if (d < nearest) nearest = d;
    }
  }
  return nearest;
}

function playerSpeed(state) {
  const p = state.player;
  if (Number.isFinite(p.speed)) return Math.abs(p.speed);
  const vx = Number.isFinite(p.vx) ? p.vx : 0;
  const vz = Number.isFinite(p.vz) ? p.vz : 0;
  return Math.hypot(vx, vz);
}

// Take `amount` from the wallet (never below zero) and tell the HUD.
function payFine(state, amount) {
  const fine = Math.max(0, Math.min(Math.floor(amount) || 0, state.money || 0));
  if (fine > 0) {
    state.money -= fine;
    emit(state, 'moneyChanged', { money: state.money, delta: -fine });
  }
  return fine;
}

// Heat to zero, timers cleared, circle gone. Emits 'wantedChanged'
// only when there was actually heat to clear.
function clearWanted(state) {
  const w = state.wanted;
  const hadHeat = w.stars > 0;
  w.stars = 0;
  w.hideT = 0;
  w.blinkT = 0;
  w.searchCircle = null;
  w.captureT = 0;
  if (hadHeat) emitWanted(state);
}

function bustPlayer(state) {
  const fine = payFine(state, BUSTED_FINE_BASE + BUSTED_FINE_PER_STAR * state.wanted.stars);
  clearWanted(state);
  state.mode = 'busted';
  emit(state, 'busted', { fine });
}

function wastePlayer(state) {
  const fine = payFine(state, WASTED_FINE);
  clearWanted(state);
  state.mode = 'wasted';
  emit(state, 'wasted', { fine });
}

// --- public API ------------------------------------------------------------

// Raise heat by at most one star per call (one incident), capped at 5.
// `reason` is a free-form tag for debugging (e.g. 'm8-cause-1'); callers
// that need three stars fire three separate incidents.
export function addWanted(state, stars, reason) {
  if (!state || !state.wanted) return;
  const w = state.wanted;
  const before = w.stars | 0;
  const gain = Math.max(0, Math.min(1, Math.floor(stars) || 0));
  if (gain <= 0) return;
  const now = Math.min(MAX_STARS, before + gain);
  if (now === before) return;
  w.stars = now;
  // Fresh chase: the hide timer only starts once the player is unseen.
  w.hideT = 0;
  w.blinkT = 0;
  if (before === 0) {
    // First star: police converge on where the player was just seen.
    const pos = lastKnownPosition(state);
    w.searchCircle = { x: pos.x, z: pos.z, r: searchRadius(now) };
  } else if (w.searchCircle) {
    w.searchCircle.r = searchRadius(now);
  }
  emitWanted(state);
}

// --- per-tick update -------------------------------------------------------

export function update(state, input, dt, ctx) {
  if (!state || !state.wanted) return;
  if (state.mode !== 'playing') return;
  if (!(dt > 0)) return;

  const w = state.wanted;
  const p = state.player;
  const city = ctx && ctx.city;
  const pois = (city && city.pois) || {};
  const seen = w.seenByPolice === true;

  // --- going down ----------------------------------------------------------
  // Health 0 with heat: BUSTED. Health 0 clean: WASTED (smaller fine).
  if (state.health <= 0) {
    if (w.stars > 0) bustPlayer(state);
    else wastePlayer(state);
    return;
  }

  // --- capture meter -------------------------------------------------------
  // police.js fills captureT while a cop holds the on-foot player close.
  // It never drains it, so the drain lives here: free again and the
  // meter bleeds off; held for CAPTURE_FULL seconds straight: BUSTED.
  const held = p.onFoot && nearestCopDistance(state) < CAPTURE_RANGE;
  if (!held && w.captureT > 0) {
    w.captureT = Math.max(0, w.captureT - dt * CAPTURE_DECAY);
  }
  if (w.captureT >= CAPTURE_FULL) {
    bustPlayer(state);
    return;
  }

  if (w.stars <= 0) {
    w.hideT = 0;
    w.blinkT = 0;
    w.searchCircle = null;
    return;
  }

  // --- seen / unseen -------------------------------------------------------
  if (seen) {
    // Spotted again: escape clock resets, the search circle is stale —
    // the cops know exactly where the player is right now.
    w.hideT = 0;
    w.blinkT = 0;
    w.searchCircle = null;
  } else {
    // Unseen: the escape clock runs.
    if (w.stars >= 3 && !w.searchCircle) {
      const pos = lastKnownPosition(state);
      w.searchCircle = { x: pos.x, z: pos.z, r: searchRadius(w.stars) };
    }
    if (w.hideT <= 0) w.hideT = hideDuration(w.stars);
    let rate = 1;
    if (w.searchCircle && dist2d(p.x, p.z, w.searchCircle.x, w.searchCircle.z) > w.searchCircle.r) {
      rate *= OUTSIDE_CIRCLE_RATE; // slipped out of the search area
    }
    if (p.onFoot && playerSpeed(state) < QUIET_SPEED) {
      rate *= QUIET_RATE; // lying low in a quiet spot
    }
    w.hideT -= dt * rate;
    // Last BLINK_SECONDS before a star drops: HUD flashes the stars.
    w.blinkT = w.hideT <= BLINK_SECONDS ? Math.max(0, w.hideT) : 0;
    if (w.hideT <= 0) {
      w.stars = Math.max(0, w.stars - 1);
      w.hideT = 0;
      w.blinkT = 0;
      if (w.stars === 0) {
        w.searchCircle = null;
      } else if (w.searchCircle) {
        w.searchCircle.r = searchRadius(w.stars);
      }
      emitWanted(state);
      if (w.stars === 0) return;
    }
  }

  // --- safehouse -----------------------------------------------------------
  // Clears 1-2 stars only, and only when no cop can see the player.
  // Entering also fires 'safehouseEntered' (autosave + ammo refill).
  const home = pois.safehouse;
  const nearHome = home && dist2d(p.x, p.z, home.x, home.z) < SAFEHOUSE_RADIUS;
  if (nearHome && !atSafehouse) {
    atSafehouse = true;
    emit(state, 'safehouseEntered', { x: home.x, z: home.z });
    if (!seen && w.stars >= 1 && w.stars <= 2) clearWanted(state);
  } else if (!nearHome) {
    atSafehouse = false;
  }

  // --- respray -------------------------------------------------------------
  // In a car, unseen, at the paint shop: a fresh coat clears the heat
  // for a fee. Triggered by an explicit respray flag or the interact
  // action; the fee scales with the heat. Broke players stay hot.
  const shop = pois.paintShop;
  if (shop && !p.onFoot && p.vehicleId !== null && !seen && w.stars > 0
    && dist2d(p.x, p.z, shop.x, shop.z) < PAINTSHOP_RADIUS) {
    const flagged = state.flags && state.flags.resprayReady === true;
    const asked = input && input.actions && input.actions.interact === true;
    if (flagged || asked) {
      const fee = RESPRAY_FEE_PER_STAR * w.stars;
      if ((state.money || 0) >= fee) {
        state.money -= fee;
        emit(state, 'moneyChanged', { money: state.money, delta: -fee });
        if (state.flags) state.flags.resprayReady = false;
        clearWanted(state);
      }
    }
  }
}
