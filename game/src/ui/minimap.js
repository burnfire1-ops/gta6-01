// ui/minimap.js — canvas minimap drawn from the REAL road graph (core/city.js).
// North is always up (-z maps to screen up). Drawn on every 'frame' event;
// the draw itself is cheap (a few hundred line segments) and reads only
// plain sim state, never the 3D scene.
const SIZE = 180;
const MARGIN = 6;
const SPAN = 480; // city spans -240..240 on x and z
const SCALE = (SIZE - MARGIN * 2) / SPAN;

let ctxRef = null;
let canvas = null;
let g = null;

function toX(x) { return MARGIN + (x + 240) * SCALE; }
function toY(z) { return MARGIN + (z + 240) * SCALE; }

// Mission marker, wherever the missions slice keeps it. The missions slice
// is not landed yet, so every known shape is tried defensively.
export function missionMarker(state) {
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
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); }
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
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); }
}

function draw() {
  const { state, city } = ctxRef;
  if (!state || !city || !g) return;
  const p = state.player || { x: 0, z: 0, heading: 0 };
  const wanted = state.wanted || { stars: 0, hideT: 0, searchCircle: null };

  // Background.
  g.clearRect(0, 0, SIZE, SIZE);
  g.fillStyle = '#16233d';
  g.fillRect(0, 0, SIZE, SIZE);

  // District tints, one soft wash per quadrant.
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

  // Roads: every edge of the real graph, drawn once (to > id).
  g.strokeStyle = 'rgba(242,237,228,0.55)';
  g.lineWidth = 2;
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

  // Points of interest.
  const pois = city.pois || {};
  if (pois.safehouse) dot(toX(pois.safehouse.x), toY(pois.safehouse.z), 3.5, '#58c98a', '#0e1a33');
  if (pois.garage) {
    g.fillStyle = '#f2c14e';
    g.fillRect(toX(pois.garage.x) - 3, toY(pois.garage.z) - 3, 6, 6);
  }
  if (pois.missionGiver) diamond(toX(pois.missionGiver.x), toY(pois.missionGiver.z), 4, '#c98ae0', '#0e1a33');
  if (pois.policeStation) {
    g.fillStyle = '#5fb8d8';
    g.fillRect(toX(pois.policeStation.x) - 3, toY(pois.policeStation.z) - 3, 6, 6);
  }
  if (pois.portWarehouse) dot(toX(pois.portWarehouse.x), toY(pois.portWarehouse.z), 3, '#b8a890', '#0e1a33');
  if (pois.paintShop) dot(toX(pois.paintShop.x), toY(pois.paintShop.z), 3, '#f28a5f', '#0e1a33');

  // Hidden packages, only near the player (within 120 units) and unfound.
  for (const pkg of city.packages || []) {
    if (pkg.found) continue;
    if (Math.hypot(pkg.x - p.x, pkg.z - p.z) > 120) continue;
    dot(toX(pkg.x), toY(pkg.z), 2, '#e8f7ff', '#0e1a33');
  }

  // Wanted search circle: amber while hunted, green while hidden.
  const sc = wanted.searchCircle;
  if (sc && Number.isFinite(sc.r) && sc.r > 0) {
    g.beginPath();
    g.arc(toX(sc.x), toY(sc.z), Math.max(2, sc.r * SCALE), 0, Math.PI * 2);
    g.strokeStyle = wanted.hideT > 0 ? 'rgba(88,201,138,0.9)' : 'rgba(242,193,78,0.85)';
    g.lineWidth = 1.5;
    g.stroke();
  }

  // Mission objective marker.
  const marker = missionMarker(state);
  if (marker) diamond(toX(marker.x), toY(marker.z), 5.5, '#f2c14e', '#0e1a33');

  // Police dots, only while wanted.
  if (wanted.stars > 0) {
    for (const cop of state.police || []) {
      let pos = null;
      if (Number.isFinite(cop.x) && Number.isFinite(cop.z)) pos = cop;
      else if (cop.vehicleId !== null && cop.vehicleId !== undefined) {
        pos = (state.vehicles || []).find((v) => v.id === cop.vehicleId) || null;
      }
      if (!pos && cop.lastKnown) pos = cop.lastKnown;
      if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.z)) {
        dot(toX(pos.x), toY(pos.z), 2.5, '#3f8cff', '#0e1a33');
      }
    }
  }

  // Player arrow, rotated to heading. World dir (sin h, cos h) in (x, z)
  // maps to screen (sin h, cos h); rotating the up-pointing triangle by
  // (PI - h) points it along that screen direction.
  g.save();
  g.translate(toX(p.x), toY(p.z));
  g.rotate(Math.PI - (p.heading || 0));
  g.beginPath();
  g.moveTo(0, -7);
  g.lineTo(5, 6);
  g.lineTo(0, 3);
  g.lineTo(-5, 6);
  g.closePath();
  g.fillStyle = '#ffffff';
  g.fill();
  g.strokeStyle = '#0e1a33';
  g.lineWidth = 1.5;
  g.stroke();
  g.restore();
}

export function init(ctx) {
  ctxRef = ctx;
  canvas = document.querySelector('#minimap');
  if (!canvas) return;
  g = canvas.getContext('2d');
  if (!g) return;
  if (ctx.state && ctx.state.events) ctx.state.events.on('frame', draw);
  draw();
}
