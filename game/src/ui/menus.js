// ui/menus.js — menu stack: title, pause, settings, save/load overlays.
// Screens are a stack (game-ui-ux): one overlay at a time, focus on open,
// focus returns to the screen below when it closes. Settings persist to
// localStorage and are applied to state.settings + the renderer.
const SETTINGS_KEY = 'teluk-cahaya-settings';
const SAVE_KEYS = [
  'teluk-cahaya-save-1',
  'teluk-cahaya-save-2',
  'teluk-cahaya-save-3',
  'teluk-cahaya-autosave',
];

let ctxRef = null;
let overlayEl = null;
let overlayReturnFocus = null;

function $(id) { return document.getElementById(id); }

function saveSlice() {
  const handle = (typeof window !== 'undefined' && window.__systems)
    ? window.__systems.loaded.get('save') : null;
  return handle || null;
}

function storageGet(key) {
  try { return window.localStorage.getItem(key); } catch (e) { return null; }
}

function hasAnySave() {
  for (const k of SAVE_KEYS) if (storageGet(k) !== null) return true;
  return false;
}

function refreshContinueButton() {
  const btn = $('btn-continue');
  if (!btn) return;
  if (hasAnySave()) btn.removeAttribute('disabled');
  else btn.setAttribute('disabled', '');
}

// --- overlay stack ---

function openOverlay(title) {
  closeOverlay();
  overlayReturnFocus = document.activeElement;
  const el = document.createElement('div');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', title);
  el.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;'
    + 'align-items:center;justify-content:center;z-index:50;'
    + 'background:rgba(14,26,51,0.82);color:#f2ede4;';
  const h = document.createElement('h2');
  h.textContent = title;
  h.style.cssText = 'margin:0 0 18px;font-size:26px;color:#f2c14e;letter-spacing:2px';
  el.appendChild(h);
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:10px;min-width:300px;'
    + 'max-width:520px;padding:0 16px';
  el.appendChild(body);
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Tutup';
  closeBtn.style.cssText = 'margin-top:18px;font-size:15px;padding:10px 22px;border-radius:10px;'
    + 'border:1px solid rgba(242,237,228,0.35);background:rgba(14,26,51,0.8);color:#f2ede4;cursor:pointer';
  closeBtn.addEventListener('click', closeOverlay);
  el.appendChild(closeBtn);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeOverlay(); }
  });
  document.body.appendChild(el);
  overlayEl = el;
  closeBtn.focus();
  return { el, body, closeBtn };
}

function closeOverlay() {
  if (!overlayEl) return;
  overlayEl.remove();
  overlayEl = null;
  if (overlayReturnFocus && overlayReturnFocus.focus) {
    try { overlayReturnFocus.focus(); } catch (e) { /* ignore */ }
  }
  overlayReturnFocus = null;
}

function menuButton(text) {
  const b = document.createElement('button');
  b.textContent = text;
  b.style.cssText = 'font-size:16px;padding:12px 18px;border-radius:10px;text-align:left;'
    + 'border:1px solid rgba(242,237,228,0.35);background:rgba(14,26,51,0.8);color:#f2ede4;cursor:pointer';
  return b;
}

function slotLabel(slot) {
  const raw = storageGet('teluk-cahaya-save-' + slot);
  if (!raw) return 'Slot ' + slot + ' — kosong';
  try {
    const d = JSON.parse(raw);
    const when = d.savedAt ? new Date(d.savedAt).toLocaleString('id-ID') : '';
    const money = d.player && typeof d.player.money === 'number' ? ' · $' + d.player.money : '';
    return 'Slot ' + slot + ' — ' + when + money;
  } catch (e) {
    return 'Slot ' + slot + ' — tersimpan';
  }
}

// --- settings ---

function loadSettings() {
  const s = ctxRef.state.settings;
  let saved = null;
  try { saved = JSON.parse(storageGet(SETTINGS_KEY) || 'null'); } catch (e) { saved = null; }
  if (saved && typeof saved === 'object') {
    for (const k of ['music', 'sfx', 'ambience', 'ui']) {
      if (typeof saved[k] === 'number' && Number.isFinite(saved[k])) {
        s[k] = Math.max(0, Math.min(1, saved[k]));
      }
    }
    if (typeof saved.sensitivity === 'number' && Number.isFinite(saved.sensitivity)) {
      s.sensitivity = Math.max(0.5, Math.min(2, saved.sensitivity));
    }
    if (typeof saved.invertY === 'boolean') s.invertY = saved.invertY;
    if (saved.shadows !== undefined) s.shadows = normalizeShadows(saved.shadows);
  }
  applyShadows(s.shadows);
}

function persistSettings() {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(ctxRef.state.settings));
  } catch (e) { /* storage unavailable: settings still apply in-session */ }
}

function normalizeShadows(v) {
  if (v === 1 || v === '1' || v === 'high') return 'high';
  if (v === 0 || v === '0' || v === 'off') return 'off';
  if (v === 'low') return 'low';
  return 'high';
}

function findSun() {
  let sun = null;
  if (!ctxRef.scene) return null;
  ctxRef.scene.traverse((o) => {
    if (o.isDirectionalLight && o.shadow
      && (!sun || o.shadow.mapSize.x > sun.shadow.mapSize.x)) sun = o;
  });
  return sun;
}

function applyShadows(value) {
  const v = normalizeShadows(value);
  ctxRef.state.settings.shadows = v;
  const renderer = ctxRef.renderer;
  if (!renderer || !renderer.shadowMap) return;
  // Note: renderer.js update() resets sun.castShadow from the day/night
  // clock every frame, so quality is applied via shadow map size, not
  // castShadow (a per-frame reset would undo it).
  const sun = findSun();
  if (v === 'off') {
    if (renderer.shadowMap.enabled) {
      renderer.shadowMap.enabled = false;
      renderer.shadowMap.needsUpdate = true;
      refreshMaterials();
    }
    return;
  }
  const size = v === 'low' ? 1024 : 2048;
  if (!renderer.shadowMap.enabled) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.needsUpdate = true;
    refreshMaterials();
  }
  if (sun && sun.shadow.mapSize.x !== size) {
    sun.shadow.mapSize.set(size, size);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
}

function refreshMaterials() {
  if (!ctxRef.scene) return;
  ctxRef.scene.traverse((o) => {
    if (o.material) o.material.needsUpdate = true;
  });
}

function sliderRow(body, label, min, max, step, value, onInput) {
  const row = document.createElement('label');
  row.style.cssText = 'display:flex;align-items:center;gap:12px;font-size:15px';
  const name = document.createElement('span');
  name.textContent = label;
  name.style.flex = '1';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.style.flex = '2';
  const val = document.createElement('span');
  val.textContent = String(value);
  val.style.minWidth = '36px';
  val.style.textAlign = 'right';
  input.addEventListener('input', () => {
    const v = Number(input.value);
    val.textContent = input.value;
    onInput(v);
  });
  row.appendChild(name);
  row.appendChild(input);
  row.appendChild(val);
  body.appendChild(row);
  return input;
}

function openSettings() {
  const s = ctxRef.state.settings;
  const { body } = openOverlay('Settings');
  sliderRow(body, 'Musik', 0, 1, 0.05, s.music, (v) => { s.music = v; persistSettings(); emitSettings(); });
  sliderRow(body, 'SFX', 0, 1, 0.05, s.sfx, (v) => { s.sfx = v; persistSettings(); emitSettings(); });
  sliderRow(body, 'Ambience', 0, 1, 0.05, s.ambience, (v) => { s.ambience = v; persistSettings(); emitSettings(); });
  sliderRow(body, 'UI', 0, 1, 0.05, s.ui, (v) => { s.ui = v; persistSettings(); emitSettings(); });
  sliderRow(body, 'Sensitivitas', 0.5, 2, 0.1, s.sensitivity, (v) => { s.sensitivity = v; persistSettings(); emitSettings(); });
  const invRow = document.createElement('label');
  invRow.style.cssText = 'display:flex;align-items:center;gap:12px;font-size:15px;cursor:pointer';
  const inv = document.createElement('input');
  inv.type = 'checkbox';
  inv.checked = !!s.invertY;
  inv.addEventListener('change', () => { s.invertY = inv.checked; persistSettings(); emitSettings(); });
  invRow.appendChild(inv);
  invRow.appendChild(document.createTextNode('Invert Y (kamera)'));
  body.appendChild(invRow);
  const shRow = document.createElement('label');
  shRow.style.cssText = 'display:flex;align-items:center;gap:12px;font-size:15px';
  const shName = document.createElement('span');
  shName.textContent = 'Kualitas bayangan';
  shName.style.flex = '1';
  const sel = document.createElement('select');
  sel.style.cssText = 'flex:2;padding:8px;border-radius:8px;background:#16233d;color:#f2ede4';
  for (const opt of [['high', 'High'], ['low', 'Low'], ['off', 'Off']]) {
    const o = document.createElement('option');
    o.value = opt[0];
    o.textContent = opt[1];
    if (normalizeShadows(s.shadows) === opt[0]) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => { applyShadows(sel.value); persistSettings(); emitSettings(); });
  shRow.appendChild(shName);
  shRow.appendChild(sel);
  body.appendChild(shRow);
}

function emitSettings() {
  try { ctxRef.state.events.emit('settingsChanged', { ...ctxRef.state.settings }); } catch (e) { /* ignore */ }
}

// --- controls overlay ---

function openControls() {
  const { body } = openOverlay('Controls');
  const list = document.createElement('div');
  list.style.cssText = 'font-size:15px;line-height:2;color:#c8d8e8;text-align:center';
  list.innerHTML = '<b style="color:#f2c14e">WASD</b> gerak &nbsp;·&nbsp; '
    + '<b style="color:#f2c14e">Mouse</b> kamera<br>'
    + '<b style="color:#f2c14e">Shift</b> lari &nbsp;·&nbsp; '
    + '<b style="color:#f2c14e">Space</b> lompat / handbrake<br>'
    + '<b style="color:#f2c14e">F</b> interaksi / masuk mobil &nbsp;·&nbsp; '
    + '<b style="color:#f2c14e">Klik kiri</b> serang / tembak<br>'
    + '<b style="color:#f2c14e">Klik kanan</b> bidik &nbsp;·&nbsp; '
    + '<b style="color:#f2c14e">R</b> reload<br>'
    + '<b style="color:#f2c14e">M</b> peta besar &nbsp;·&nbsp; '
    + '<b style="color:#f2c14e">Esc</b> pause';
  body.appendChild(list);
}

// --- save / load overlays ---

function openSavePicker() {
  const { body } = openOverlay('Save Game');
  const mod = saveSlice();
  for (const slot of [1, 2, 3]) {
    const b = menuButton(slotLabel(slot));
    b.addEventListener('click', () => {
      if (!mod || typeof mod.save !== 'function') {
        ctxRef.showToast('Slice save belum termuat.');
        return;
      }
      const ok = mod.save(slot);
      ctxRef.showToast(ok ? 'Tersimpan di slot ' + slot + '.' : 'Gagal menyimpan.');
      if (ok) { refreshContinueButton(); closeOverlay(); }
    });
    body.appendChild(b);
  }
  const auto = document.createElement('div');
  auto.style.cssText = 'font-size:13px;color:#c8d8e8;text-align:center';
  const autoRaw = storageGet('teluk-cahaya-autosave');
  auto.textContent = autoRaw
    ? 'Autosave: tersimpan (misi selesai / masuk safehouse).'
    : 'Autosave: belum ada (otomatis saat misi selesai / masuk safehouse).';
  body.appendChild(auto);
}

function openLoadPicker() {
  const { body } = openOverlay('Load Game');
  const mod = saveSlice();
  for (const slot of [1, 2, 3]) {
    const b = menuButton(slotLabel(slot));
    b.addEventListener('click', () => {
      if (!mod || typeof mod.load !== 'function') {
        ctxRef.showToast('Slice save belum termuat.');
        return;
      }
      const data = mod.load(slot);
      if (!data) { ctxRef.showToast('Slot ' + slot + ' kosong.'); return; }
      let ok = true;
      if (typeof mod.applySave === 'function') ok = mod.applySave(data);
      if (!ok) { ctxRef.showToast('Save rusak, tidak bisa dimuat.'); return; }
      closeOverlay();
      ctxRef.startGame();
    });
    body.appendChild(b);
  }
  const autoBtn = menuButton('Autosave');
  autoBtn.addEventListener('click', () => {
    if (!mod || typeof mod.load !== 'function') {
      ctxRef.showToast('Slice save belum termuat.');
      return;
    }
    const data = mod.load('autosave');
    if (!data) { ctxRef.showToast('Belum ada autosave.'); return; }
    let ok = true;
    if (typeof mod.applySave === 'function') ok = mod.applySave(data);
    if (!ok) { ctxRef.showToast('Autosave rusak, tidak bisa dimuat.'); return; }
    closeOverlay();
    ctxRef.startGame();
  });
  body.appendChild(autoBtn);
}

function continueGame() {
  if (!hasAnySave()) {
    ctxRef.showToast('Belum ada save.');
    return;
  }
  const mod = saveSlice();
  if (!mod || typeof mod.loadLatest !== 'function') {
    ctxRef.showToast('Slice save belum termuat.');
    return;
  }
  const data = mod.loadLatest();
  if (!data) { ctxRef.showToast('Belum ada save.'); return; }
  let ok = true;
  if (typeof mod.applySave === 'function') ok = mod.applySave(data);
  if (!ok) { ctxRef.showToast('Save rusak, tidak bisa dimuat.'); return; }
  ctxRef.startGame();
}

export function init(ctx) {
  ctxRef = ctx;
  loadSettings();
  refreshContinueButton();
  if (ctx.state && ctx.state.events) {
    ctx.state.events.on('saveDone', refreshContinueButton);
  }

  // FIX 1 guard: main.js wires the core buttons synchronously at boot (so the
  // title screen works before the slice loader finishes). Skip any button
  // already wired there, so no handler ever fires twice.
  const on = (id, fn) => {
    const el = $(id);
    if (!el || el.dataset.menuWired) return;
    el.dataset.menuWired = '1';
    el.addEventListener('click', fn);
  };
  on('btn-new', () => {
    try { ctx.state.events.emit('newGame', {}); } catch (e) { /* ignore */ }
    ctx.startGame();
  });
  on('btn-continue', continueGame);
  on('btn-controls', openControls);
  on('btn-resume', () => {
    ctx.state.mode = 'playing';
    $('pause').classList.add('hidden');
  });
  on('btn-save', openSavePicker);
  on('btn-load', openLoadPicker);
  on('btn-settings', openSettings);
  on('btn-quit', () => ctx.quitToTitle());
}
