// ui/hud.js — HUD DOM, driven by events (game-ui-ux: subscribe, never poll
// sim state every frame; set the initial value once, signals don't replay).
// The minimap is part of this slice: hud.js imports and inits it, because
// systems.js has no separate minimap slot.
import { init as initMinimap, missionMarker } from './minimap.js';

let ctxRef = null;
let els = {};
let prevMoney = null;
let prevHealth = null;
let objectiveBase = '';
let vignetteTimer = null;
let dialogTimer = null;

function $(id) { return document.getElementById(id); }

function fmtMoney(n) {
  const v = Math.floor(Number(n) || 0);
  return '$' + v.toLocaleString('en-US');
}

function clamp01(v) {
  const n = Number(v) || 0;
  return Math.max(0, Math.min(100, n));
}

function renderMoney() {
  const s = ctxRef.state;
  els.money.textContent = fmtMoney(s.money);
  if (prevMoney !== null && s.money !== prevMoney) {
    const d = s.money - prevMoney;
    const sign = d > 0 ? '+' : '';
    ctxRef.showToast(sign + fmtMoney(d));
  }
  prevMoney = s.money;
}

function renderHealth() {
  const s = ctxRef.state;
  els.healthFill.style.width = clamp01(s.health) + '%';
  els.armorFill.style.width = clamp01(s.armor) + '%';
  if (prevHealth !== null && s.health < prevHealth) flashVignette();
  prevHealth = s.health;
}

function renderAmmo() {
  const a = ctxRef.state.ammo || { mag: 0, reserve: 0 };
  els.ammoMag.textContent = a.mag;
  els.ammoReserve.textContent = a.reserve;
  // Hide while driving (no shooting from cars); show on foot.
  els.ammo.classList.toggle('hidden', !!ctxRef.state.player && !ctxRef.state.player.onFoot);
}

function flashVignette() {
  if (!els.vignette) return;
  els.vignette.style.boxShadow = 'inset 0 0 120px rgba(216,60,60,0.6)';
  clearTimeout(vignetteTimer);
  vignetteTimer = setTimeout(() => {
    els.vignette.style.boxShadow = 'inset 0 0 120px rgba(216,60,60,0)';
  }, 260);
}

function renderStars() {
  const w = ctxRef.state.wanted || { stars: 0, hideT: 0 };
  const stars = Math.max(0, Math.min(5, w.stars | 0));
  let html = '';
  for (let i = 0; i < 5; i++) {
    html += i < stars ? '<span>★</span>' : '<span class="off">★</span>';
  }
  els.stars.innerHTML = html;
  els.stars.classList.toggle('blink', w.hideT > 0);
}

function renderObjective() {
  const s = ctxRef.state;
  const m = s.mission || {};
  const d = m.data || {};
  const title = d.title || (m.id ? 'Misi ' + m.id : 'Teluk Cahaya');
  objectiveBase = d.text || d.objective
    || 'Jelajahi kota. Temui pemberi misi di boulevard.';
  els.objectiveTitle.textContent = title;
  renderObjectiveDistance();
}

function renderObjectiveDistance() {
  const s = ctxRef.state;
  const marker = missionMarker(s);
  let text = objectiveBase;
  if (marker && s.player) {
    const dist = Math.round(Math.hypot(marker.x - s.player.x, marker.z - s.player.z));
    text += ' · ' + dist + ' m';
  }
  els.objectiveText.textContent = text;
}

function showDialog(data) {
  if (!data || !data.text) return;
  const seconds = Number(data.seconds) || 4;
  els.dialog.textContent = data.text;
  els.dialog.classList.remove('hidden');
  clearTimeout(dialogTimer);
  dialogTimer = setTimeout(() => els.dialog.classList.add('hidden'), seconds * 1000);
}

function vehicleLabel(v) {
  if (!v) return 'Kendaraan';
  return v.model || v.name || v.type || 'Kendaraan';
}

function renderVehicleEntered(data) {
  const s = ctxRef.state;
  const v = (data && data.vehicle) || data
    || (stateVehicle(s));
  els.vehicleName.textContent = vehicleLabel(v);
  els.vehicleInfo.classList.remove('hidden');
  renderVehicleHealth();
  renderAmmo();
}

function stateVehicle(s) {
  if (!s.player || s.player.vehicleId === null || s.player.vehicleId === undefined) return null;
  return (s.vehicles || []).find((x) => x.id === s.player.vehicleId) || null;
}

function renderVehicleHealth() {
  const s = ctxRef.state;
  const v = stateVehicle(s);
  if (!v) return;
  els.vehicleHealth.style.width = clamp01(v.health) + '%';
}

function renderVehicleExited() {
  els.vehicleInfo.classList.add('hidden');
  renderAmmo();
}

// Cheap per-frame work only: vehicle health bar, objective distance, prompt.
function onFrame() {
  const s = ctxRef.state;
  if (!s || s.mode !== 'playing') return;
  if (s.player && !s.player.onFoot) renderVehicleHealth();
  renderObjectiveDistance();
  renderPrompt(s.uiPrompt);
}

function renderPrompt(prompt) {
  if (!prompt || !prompt.text) {
    if (!els.prompt.classList.contains('hidden')) {
      els.prompt.classList.add('hidden');
      els.prompt.textContent = '';
    }
    return;
  }
  els.prompt.classList.remove('hidden');
  els.prompt.textContent = '';
  if (prompt.key) {
    const b = document.createElement('b');
    b.textContent = prompt.key;
    els.prompt.appendChild(b);
  }
  els.prompt.appendChild(document.createTextNode(prompt.text));
  if (typeof prompt.progress === 'number') {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'height:4px;background:rgba(255,255,255,0.2);border-radius:2px;margin-top:5px;overflow:hidden';
    const fill = document.createElement('i');
    fill.style.cssText = 'display:block;height:100%;background:#f2c14e;border-radius:2px;width:'
      + Math.max(0, Math.min(100, prompt.progress * 100)) + '%';
    wrap.appendChild(fill);
    els.prompt.appendChild(wrap);
  }
}

export function init(ctx) {
  ctxRef = ctx;
  els = {
    money: $('money'),
    healthFill: $('health-fill'),
    armorFill: $('armor-fill'),
    stars: $('stars'),
    objectiveTitle: document.querySelector('#objective h2'),
    objectiveText: document.querySelector('#objective p'),
    prompt: $('prompt'),
    dialog: $('dialog'),
    vehicleInfo: $('vehicle-info'),
    vehicleName: $('vehicle-name'),
    vehicleHealth: $('vehicle-health'),
    ammo: $('ammo'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    vignette: $('vignette'),
  };
  const ev = ctx.state.events;
  ev.on('moneyChanged', renderMoney);
  ev.on('healthChanged', renderHealth);
  ev.on('ammoChanged', renderAmmo);
  ev.on('wantedChanged', renderStars);
  ev.on('objectiveChanged', renderObjective);
  ev.on('dialog', showDialog);
  ev.on('vehicleEntered', renderVehicleEntered);
  ev.on('vehicleExited', renderVehicleExited);
  ev.on('missionComplete', () => ctx.showToast('Misi selesai!'));
  ev.on('missionFailed', () => ctx.showToast('Misi gagal.'));
  ev.on('busted', () => ctx.showToast('Tertangkap! Denda dibayar.'));
  ev.on('wasted', () => ctx.showToast('Kamu pingsan. Bangun di titik aman.'));
  ev.on('frame', onFrame);
  // Initial values once: events do not replay.
  prevMoney = null;
  prevHealth = null;
  renderMoney();
  renderHealth();
  renderAmmo();
  renderStars();
  renderObjective();
  initMinimap(ctx);
}
