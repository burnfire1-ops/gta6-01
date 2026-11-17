// ui/hud.js — HUD DOM layer.
//
// The HUD never polls simulation state: it subscribes to state events
// (game-ui-ux: event-driven HUD) and paints the initial values once on
// connect, since events do not replay. The only per-frame work is the
// cheap stuff — vehicle health, objective distance, prompt — on 'frame'.
// The minimap lives in this slice too: hud.js imports and initialises it,
// because systems.js has no separate minimap slot.
import { init as initMinimap, missionMarker } from './minimap.js';

// Module state: the game context, cached DOM nodes, and previous values
// used to detect changes worth reacting to (money delta toast, damage flash).
let ctx = null;
let el = {};
let lastMoney = null;
let lastHealth = null;
let lastOnFoot = null;
let objectiveText = '';
let vignetteTimeout = null;
let dialogTimeout = null;

const byId = (id) => document.getElementById(id);

function moneyString(n) {
  const v = Math.floor(Number(n) || 0);
  return '$' + v.toLocaleString('en-US');
}

function pct(v) {
  return Math.max(0, Math.min(100, Number(v) || 0));
}

// --- money ---------------------------------------------------------------

function paintMoney() {
  const s = ctx.state;
  el.money.textContent = moneyString(s.money);
  if (lastMoney !== null && s.money !== lastMoney) {
    const delta = s.money - lastMoney;
    ctx.showToast((delta > 0 ? '+' : '') + moneyString(delta));
  }
  lastMoney = s.money;
}

// --- health / armor ------------------------------------------------------

function paintHealth() {
  const s = ctx.state;
  el.healthFill.style.width = pct(s.health) + '%';
  el.armorFill.style.width = pct(s.armor) + '%';
  if (lastHealth !== null && s.health < lastHealth) flashDamage();
  lastHealth = s.health;
}

function flashDamage() {
  if (!el.vignette) return;
  el.vignette.style.boxShadow = 'inset 0 0 120px rgba(216,60,60,0.6)';
  clearTimeout(vignetteTimeout);
  vignetteTimeout = setTimeout(() => {
    el.vignette.style.boxShadow = 'inset 0 0 120px rgba(216,60,60,0)';
  }, 260);
}

// --- ammo ----------------------------------------------------------------

function paintAmmo() {
  const a = ctx.state.ammo || { mag: 0, reserve: 0 };
  el.ammoMag.textContent = a.mag;
  el.ammoReserve.textContent = a.reserve;
  // No shooting from cars: hide the counter while driving, show on foot.
  el.ammo.classList.toggle('hidden', !!ctx.state.player && !ctx.state.player.onFoot);
}

// --- wanted stars --------------------------------------------------------

function paintStars() {
  const w = ctx.state.wanted || { stars: 0, hideT: 0 };
  const lit = Math.max(0, Math.min(5, w.stars | 0));
  let html = '';
  for (let i = 0; i < 5; i++) {
    html += i < lit ? '<span>★</span>' : '<span class="off">★</span>';
  }
  el.stars.innerHTML = html;
  el.stars.classList.toggle('blink', w.hideT > 0);
}

// --- mission objective ---------------------------------------------------

function paintObjective() {
  const s = ctx.state;
  const m = s.mission || {};
  const d = m.data || {};
  const title = d.title || (m.id ? 'Misi ' + m.id : 'Teluk Cahaya');
  objectiveText = d.text || d.objective
    || 'Jelajahi kota. Temui pemberi misi di boulevard.';
  el.objectiveTitle.textContent = title;
  paintObjectiveDistance();
}

function paintObjectiveDistance() {
  const s = ctx.state;
  const marker = missionMarker(s);
  let text = objectiveText;
  if (marker && s.player) {
    const dist = Math.round(Math.hypot(marker.x - s.player.x, marker.z - s.player.z));
    text += ' · ' + dist + ' m';
  }
  el.objectiveText.textContent = text;
}

// --- dialog line ---------------------------------------------------------

function showDialogLine(data) {
  if (!data || !data.text) return;
  const seconds = Number(data.seconds) || 4;
  el.dialog.textContent = data.text;
  el.dialog.classList.remove('hidden');
  clearTimeout(dialogTimeout);
  dialogTimeout = setTimeout(() => el.dialog.classList.add('hidden'), seconds * 1000);
}

// --- vehicle panel -------------------------------------------------------

function vehicleNameOf(v) {
  if (!v) return 'Kendaraan';
  return v.model || v.name || v.type || 'Kendaraan';
}

function currentVehicle(s) {
  if (!s.player || s.player.vehicleId === null || s.player.vehicleId === undefined) return null;
  return (s.vehicles || []).find((x) => x.id === s.player.vehicleId) || null;
}

function paintVehicleHealth() {
  const v = currentVehicle(ctx.state);
  if (!v) return;
  el.vehicleHealth.style.width = pct(v.health) + '%';
}

function paintVehicleEntered(data) {
  const s = ctx.state;
  const v = (data && data.vehicle) || data || currentVehicle(s);
  el.vehicleName.textContent = vehicleNameOf(v);
  el.vehicleInfo.classList.remove('hidden');
  paintVehicleHealth();
  paintAmmo();
}

function paintVehicleExited() {
  el.vehicleInfo.classList.add('hidden');
  paintAmmo();
}

// --- interaction prompt --------------------------------------------------

function paintPrompt(prompt) {
  if (!prompt || !prompt.text) {
    if (!el.prompt.classList.contains('hidden')) {
      el.prompt.classList.add('hidden');
      el.prompt.textContent = '';
    }
    return;
  }
  el.prompt.classList.remove('hidden');
  el.prompt.textContent = '';
  if (prompt.key) {
    const key = document.createElement('b');
    key.textContent = prompt.key;
    el.prompt.appendChild(key);
  }
  el.prompt.appendChild(document.createTextNode(prompt.text));
  if (typeof prompt.progress === 'number') {
    const track = document.createElement('div');
    track.style.cssText = 'height:4px;background:rgba(255,255,255,0.2);border-radius:2px;margin-top:5px;overflow:hidden';
    const fill = document.createElement('i');
    fill.style.cssText = 'display:block;height:100%;background:#f2c14e;border-radius:2px;width:'
      + Math.max(0, Math.min(100, prompt.progress * 100)) + '%';
    track.appendChild(fill);
    el.prompt.appendChild(track);
  }
}

// --- per-frame (cheap only) ----------------------------------------------

function onFrame() {
  const s = ctx.state;
  if (!s || s.mode !== 'playing') return;
  if (s.player && !s.player.onFoot) paintVehicleHealth();
  // Ammo visibility follows onFoot; driving state can change without a
  // vehicleEntered event, so re-check cheaply each frame.
  if (s.player && s.player.onFoot !== lastOnFoot) {
    lastOnFoot = s.player.onFoot;
    paintAmmo();
  }
  paintObjectiveDistance();
  paintPrompt(s.uiPrompt);
}

export function init(gameCtx) {
  ctx = gameCtx;
  el = {
    money: byId('money'),
    healthFill: byId('health-fill'),
    armorFill: byId('armor-fill'),
    stars: byId('stars'),
    objectiveTitle: document.querySelector('#objective h2'),
    objectiveText: document.querySelector('#objective p'),
    prompt: byId('prompt'),
    dialog: byId('dialog'),
    vehicleInfo: byId('vehicle-info'),
    vehicleName: byId('vehicle-name'),
    vehicleHealth: byId('vehicle-health'),
    ammo: byId('ammo'),
    ammoMag: byId('ammo-mag'),
    ammoReserve: byId('ammo-reserve'),
    vignette: byId('vignette'),
  };
  const ev = ctx.state.events;
  ev.on('moneyChanged', paintMoney);
  ev.on('healthChanged', paintHealth);
  ev.on('ammoChanged', paintAmmo);
  ev.on('wantedChanged', paintStars);
  ev.on('objectiveChanged', paintObjective);
  ev.on('dialog', showDialogLine);
  ev.on('vehicleEntered', paintVehicleEntered);
  ev.on('vehicleExited', paintVehicleExited);
  ev.on('missionComplete', () => ctx.showToast('Misi selesai!'));
  ev.on('missionFailed', () => ctx.showToast('Misi gagal.'));
  ev.on('busted', () => ctx.showToast('Tertangkap! Denda dibayar.'));
  ev.on('wasted', () => ctx.showToast('Kamu pingsan. Bangun di titik aman.'));
  ev.on('frame', onFrame);
  // Initial values once: events do not replay.
  lastMoney = null;
  lastHealth = null;
  paintMoney();
  paintHealth();
  paintAmmo();
  paintStars();
  paintObjective();
  initMinimap(ctx);
}
