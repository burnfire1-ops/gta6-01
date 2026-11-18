// ui/bigmap.js — fullscreen city map overlay, drawn from the REAL road graph
// (core/city.js), same projection rules as ui/minimap.js but bigger, labelled,
// and with landmarks. Toggle with M, close with M or Escape. The world keeps
// running behind it: state.mode is never touched here.
//
// Owns its DOM: a backdrop div + canvas + legend, created in init() and
// appended to document.body (index.html is not modified).
const SIZE = 720;
const MARGIN = 20;
const SPAN = 560; // world -280..280, so the lighthouse (-268,-268) fits
const SCALE = (SIZE - MARGIN * 2) / SPAN;

let ctxRef = null;
let overlay = null;
let canvas = null;
let g = null;
let open = false;

// World -> bigmap screen coordinates. North is up (-z maps to screen up),
// same as the minimap.
function toX(x) { return MARGIN + (x + 280) * SCALE; }
function toY(z) { return MARGIN + (z + 280) * SCALE; }

// Mission marker, wherever the missions slice keeps it. Same helper as
// ui/minimap.js, copied here so this slice does not import the minimap.
function missionMarker(state) {
  const m = state && state.mission;
  if (!m) return null;
  if (m.marker && Number.isFinite(m.marker.x) && Number.isFinite(m.marker.z)) return m.marker;
  if (m.data && m.data.marker) return m.data.marker;
  const obj = Array.isArray(m.objectives) ? m.objectives[m.objectiveIdx] : null;
  if (obj && obj.marker) return obj.marker;
  if (obj && Number.isFinite(obj.x) && Number.isFinite(obj.z)) return { x: obj.x, z: obj.z };
  return null;
}

function dot(x, y, r, fill, stroke) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); }
}

function diamond(x, y, r, fill, stroke) {
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x + r, y);
  g.lineTo(x, y + r);
  g.lineTo(x - r, y);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); }
}

function square(x, y, half, fill, stroke) {
  g.fillStyle = fill;
  g.fillRect(x - half, y - half, half * 2, half * 2);
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.strokeRect(x - half, y - half, half * 2, half * 2); }
}

function star(x, y, r, fill, stroke) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); }
}

// Readable label: white bold text with a dark outline, so it stays legible
// over roads and district tints.
function label(text, x, y) {
  g.font = 'bold 13px system-ui, sans-serif';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(10,16,32,0.9)';
  g.strokeText(text, x, y);
  g.fillStyle = '#f2ede4';
  g.fillText(text, x, y);
}

function drawRoads(city) {
  g.strokeStyle = 'rgba(242,237,228,0.6)';
  g.lineWidth = 3;
  g.beginPath();
  for (const n of city.nodes || []) {
    const list = city.edges ? city.edges.get(n.id) : null;
    if (!list) continue;
    for (const e of list) {
      if (e.to <= n.id) continue;
      const t = city.nodes[e.to];
      if (!t) continue;
      g.moveTo(toX(n.x), toY(n.z));
      g.lineTo(toX(t.x), toY(t.z));
    }
  }
  g.stroke();
}

function drawPois(city) {
  const pois = city.pois || {};
  if (pois.safehouse) { dot(toX(pois.safehouse.x), toY(pois.safehouse.z), 7, '#58c98a', '#0e1a33'); label('Safehouse', toX(pois.safehouse.x) + 11, toY(pois.safehouse.z)); }
  if (pois.garage) { square(toX(pois.garage.x), toY(pois.garage.z), 6, '#f2c14e', '#0e1a33'); label('Garasi', toX(pois.garage.x) + 11, toY(pois.garage.z)); }
  if (pois.missionGiver) { diamond(toX(pois.missionGiver.x), toY(pois.missionGiver.z), 8, '#c98ae0', '#0e1a33'); label('Pemberi Misi', toX(pois.missionGiver.x) + 12, toY(pois.missionGiver.z)); }
  if (pois.policeStation) { square(toX(pois.policeStation.x), toY(pois.policeStation.z), 6, '#5fb8d8', '#0e1a33'); label('Kantor Polisi', toX(pois.policeStation.x) + 11, toY(pois.policeStation.z)); }
  if (pois.portWarehouse) { dot(toX(pois.portWarehouse.x), toY(pois.portWarehouse.z), 6, '#b8a890', '#0e1a33'); label('Gudang Pelabuhan', toX(pois.portWarehouse.x) + 11, toY(pois.portWarehouse.z)); }
  if (pois.paintShop) { dot(toX(pois.paintShop.x), toY(pois.paintShop.z), 6, '#f28a5f', '#0e1a33'); label('Bengkel Cat', toX(pois.paintShop.x) + 11, toY(pois.paintShop.z)); }
  if (pois.lighthouse) { star(toX(pois.lighthouse.x), toY(pois.lighthouse.z), 8, '#f2ede4', '#0e1a33'); label('Mercusuar', toX(pois.lighthouse.x) + 12, toY(pois.lighthouse.z)); }
}

// Landmarks land in city.landmarks from another slice (Menara Cahaya, Taman
// Cahaya, Stadion Teluk). Defensive: any shape with a position and a name
// draws; if the data is not there yet, nothing draws and nothing breaks.
function drawLandmarks(city) {
  const list = Array.isArray(city.landmarks) ? city.landmarks : [];
  for (const lm of list) {
    let x = null, z = null;
    if (Number.isFinite(lm.x) && Number.isFinite(lm.z)) { x = lm.x; z = lm.z; }
    else if (Number.isFinite(lm.cx) && Number.isFinite(lm.cz)) { x = lm.cx; z = lm.cz; }
    else if (Number.isFinite(lm.node)) {
      const n = (city.nodes || [])[lm.node];
      if (n) { x = n.x; z = n.z; }
    }
    if (x === null || z === null) continue;
    star(toX(x), toY(z), 9, '#f2c14e', '#0e1a33');
    if (typeof lm.name === 'string' && lm.name) label(lm.name, toX(x) + 13, toY(z));
  }
}

function drawPackages(city, p) {
  for (const pkg of city.packages || []) {
    if (pkg.found) continue;
    if (Math.hypot(pkg.x - p.x, pkg.z - p.z) > 120) continue;
    dot(toX(pkg.x), toY(pkg.z), 4, '#e8f7ff', '#0e1a33');
  }
}

function drawSearchCircle(wanted) {
  const sc = wanted.searchCircle;
  if (!sc || !Number.isFinite(sc.r) || sc.r <= 0) return;
  g.beginPath();
  g.arc(toX(sc.x), toY(sc.z), Math.max(2, sc.r * SCALE), 0, Math.PI * 2);
  g.strokeStyle = wanted.hideT > 0 ? 'rgba(88,201,138,0.9)' : 'rgba(242,193,78,0.85)';
  g.lineWidth = 2;
  g.stroke();
}

function drawPolice(state, wanted) {
  if (wanted.stars <= 0) return;
  for (const cop of state.police || []) {
    let pos = null;
    if (Number.isFinite(cop.x) && Number.isFinite(cop.z)) pos = cop;
    else if (cop.vehicleId !== null && cop.vehicleId !== undefined) {
      pos = (state.vehicles || []).find((v) => v.id === cop.vehicleId) || null;
    }
    if (!pos && cop.lastKnown) pos = cop.lastKnown;
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.z)) {
      dot(toX(pos.x), toY(pos.z), 5, '#3f8cff', '#0e1a33');
    }
  }
}

function drawPlayer(p) {
  g.save();
  g.translate(toX(p.x), toY(p.z));
  g.rotate(Math.PI - (p.heading || 0));
  g.beginPath();
  g.moveTo(0, -13);
  g.lineTo(9, 10);
  g.lineTo(0, 5);
  g.lineTo(-9, 10);
  g.closePath();
  g.fillStyle = '#ffffff';
  g.fill();
  g.strokeStyle = '#0e1a33';
  g.lineWidth = 2;
  g.stroke();
  g.restore();
  label('Raka', toX(p.x) + 14, toY(p.z));
}

function drawDistrictNames() {
  g.font = 'bold 22px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(242,237,228,0.28)';
  g.fillText('BOULEVARD', toX(-120), toY(-120));
  g.fillText('NEON', toX(120), toY(-120));
  g.fillText('PELABUHAN', toX(-120), toY(120));
  g.fillText('RESIDENSIAL', toX(120), toY(120));
}

function draw() {
  const { state, city } = ctxRef || {};
  if (!state || !city || !g || !open) return;
  const p = state.player || { x: 0, z: 0, heading: 0 };
  const wanted = state.wanted || { stars: 0, hideT: 0, searchCircle: null };

  g.clearRect(0, 0, SIZE, SIZE);
  g.fillStyle = '#16233d';
  g.fillRect(0, 0, SIZE, SIZE);

  // District tints, one soft wash per quadrant (same layout as the minimap).
  const half = SIZE / 2;
  g.fillStyle = 'rgba(242,160,160,0.10)'; // boulevard NW
  g.fillRect(0, 0, half, half);
  g.fillStyle = 'rgba(127,212,212,0.10)'; // neon NE
  g.fillRect(half, 0, half, half);
  g.fillStyle = 'rgba(184,168,144,0.10)'; // port SW
  g.fillRect(0, half, half, half);
  g.fillStyle = 'rgba(242,200,200,0.08)'; // residential SE
  g.fillRect(half, half, half, half);

  // Blocks, faint.
  g.fillStyle = 'rgba(255,255,255,0.04)';
  for (const b of city.blocks || []) {
    g.fillRect(toX(b.cx - 20), toY(b.cz - 20), 40 * SCALE, 40 * SCALE);
  }

  drawRoads(city);
  drawDistrictNames();
  drawLandmarks(city);
  drawPois(city);
  drawPackages(city, p);
  drawSearchCircle(wanted);

  const marker = missionMarker(state);
  if (marker) {
    diamond(toX(marker.x), toY(marker.z), 11, '#f2c14e', '#0e1a33');
    label('Misi', toX(marker.x) + 15, toY(marker.z));
  }

  drawPolice(state, wanted);
  drawPlayer(p);
}

function buildDom() {
  overlay = document.createElement('div');
  overlay.id = 'bigmap-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:60;display:none;'
    + 'align-items:center;justify-content:center;flex-direction:column;gap:10px;'
    + 'background:rgba(6,10,20,0.72);color:#f2ede4;'
    + 'font-family:system-ui,-apple-system,"Segoe UI",sans-serif;';

  const title = document.createElement('div');
  title.textContent = 'PETA TELUK CAHAYA';
  title.style.cssText = 'font-size:22px;font-weight:700;letter-spacing:4px;color:#f2c14e;';
  overlay.appendChild(title);

  canvas = document.createElement('canvas');
  canvas.id = 'bigmap';
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.style.cssText = 'width:min(720px,92vmin);height:min(720px,92vmin);'
    + 'border:2px solid rgba(242,237,228,0.5);border-radius:12px;background:#16233d;';
  overlay.appendChild(canvas);

  const legend = document.createElement('div');
  legend.id = 'bigmap-legend';
  legend.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px 16px;justify-content:center;'
    + 'max-width:760px;font-size:13px;background:rgba(14,26,51,0.85);'
    + 'border:1px solid rgba(242,237,228,0.18);border-radius:10px;padding:8px 14px;';
  const entries = [
    ['●', '#58c98a', 'Safehouse'], ['■', '#f2c14e', 'Garasi'],
    ['◆', '#c98ae0', 'Pemberi Misi'], ['■', '#5fb8d8', 'Kantor Polisi'],
    ['●', '#b8a890', 'Gudang Pelabuhan'], ['●', '#f28a5f', 'Bengkel Cat'],
    ['★', '#f2ede4', 'Mercusuar'], ['★', '#f2c14e', 'Landmark'],
    ['◆', '#f2c14e', 'Misi'], ['●', '#3f8cff', 'Polisi (saat wanted)'],
    ['➤', '#ffffff', 'Raka'],
  ];
  for (const [sym, color, text] of entries) {
    const item = document.createElement('span');
    const chip = document.createElement('b');
    chip.textContent = sym;
    chip.style.cssText = `color:${color};margin-right:5px;`;
    item.appendChild(chip);
    item.appendChild(document.createTextNode(text));
    legend.appendChild(item);
  }
  overlay.appendChild(legend);

  const hint = document.createElement('div');
  hint.textContent = 'M / Esc untuk tutup';
  hint.style.cssText = 'font-size:13px;color:#c8d8e8;';
  overlay.appendChild(hint);

  document.body.appendChild(overlay);
  g = canvas.getContext('2d');
}

function setOpen(v) {
  open = v;
  if (overlay) overlay.style.display = v ? 'flex' : 'none';
  if (v) draw();
}

// Escape closes the map without pausing: the main loop pauses on the
// buffered 'pause' press, but the bigmap update never runs on that frame
// (mode flips to 'paused' first). This listener is registered after
// input.attach, so the buffer is already set when it runs — dropping it
// here keeps Esc = "close map" while the map is open.
function onKeyDown(e) {
  if (!open) return;
  if (e.code === 'Escape') {
    const input = ctxRef && ctxRef.input;
    if (input && input.buffers) delete input.buffers.pause;
    setOpen(false);
  }
}

export function init(ctx) {
  ctxRef = ctx;
  buildDom();
  if (!g) return;
  window.addEventListener('keydown', onKeyDown);
  if (ctx.state && ctx.state.events) ctx.state.events.on('frame', draw);
}

export function update(state, input, dt, ctx) {
  if (!overlay) return;
  // input.update() already consumed the 'map' press into actions.map by the
  // time slices run, so read the action flag, not input.pressed('map').
  if (input && input.actions && input.actions.map) setOpen(!open);
}
