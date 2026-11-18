// render/storefronts.js — readable shop fronts + name signs on commercial
// buildings facing the main avenues (boulevard + neon districts). Purely
// additive meshes on top of the instanced buildings in city-render.js.
// All names are original Indonesian shop names; no copied branding.
//
// Selection: commercial buildings (not houses, not landmarks) in the
// boulevard/neon districts whose nearest grid line (road) is within ~25
// units, closest-to-road first, capped at 24 so only the most visible
// fronts get signs. Each gets a ground-floor storefront box (shop colour,
// glass front, slightly proud of the facade) and a canvas-textured sign
// plane facing the road. Signs use MeshBasicMaterial so the text stays
// readable day and night; the storefront boxes glow a little at night
// via sync() (emissive driven by the city clock).
import * as THREE from 'three';
import { nightFactor } from '../core/clock.js';
import { HALF, SPACING, GRID_N } from '../core/city.js';

const MAX_STOREFRONTS = 24;
const ROAD_DIST_MAX = 25;

// Original Indonesian shop names (cycled in order, one per storefront).
const SHOP_NAMES = [
  'WARUNG KOPI', 'TOKO BAJU', 'BENGKEL MOTOR', 'APOTEK',
  'KEDAI MIE', 'TOKO BUAH', 'BARBERSHOP', 'LAUNDRY',
  'WARTEG BAROKAH', 'TOKO KELONTONG', 'FOTOKOPI CEPAT', 'BAKSO PAK JO',
  'ROTI BAKAR 88', 'SATE AYAM MADURA', 'JUS BUAH SEGAR', 'TOKO ELEKTRONIK',
  'SALON CANTIK', 'WARUNG NASI', 'TOKO SEPATU', 'PULSA & KUOTA',
  'ES TEH MANIS', 'MARTABAK MANIS', 'GORENGAN BU SRI', 'TOKO MAINAN',
];

// Shop accent colours (hex), cycled with the names.
const SHOP_COLORS = [
  0xd86a3a, 0x3a7bd8, 0x58a05c, 0x3aa88f,
  0xc23a4e, 0xd8a03a, 0x7a5fd0, 0x3a9ab0,
  0xb03a6a, 0x5c8a3a, 0x8a6a3a, 0xd83a3a,
  0x3a6ad8, 0xa03a7a, 0x2f8a6a, 0x6a5ad8,
  0xc25e8a, 0x4a7a3a, 0x3a8ab0, 0xd8c23a,
  0x7a3ad8, 0xa85c2a, 0x2a9a8a, 0xb03a3a,
];

let group = null;
let litMats = []; // storefront box materials, emissive ramps up at night

// Nearest grid line (road) to a coordinate, and its distance.
function nearestGridLine(v) {
  const k = Math.round((v + HALF) / SPACING);
  const line = -HALF + Math.max(0, Math.min(GRID_N - 1, k)) * SPACING;
  return { line, dist: Math.abs(v - line) };
}

// Which side of the building faces its nearest road: 'x' (+/-) or 'z' (+/-).
// Returns { axis: 'x'|'z', sign: 1|-1, dist }.
function facingSide(b) {
  const gx = nearestGridLine(b.x);
  const gz = nearestGridLine(b.z);
  if (gx.dist <= gz.dist) return { axis: 'x', sign: gx.line >= b.x ? 1 : -1, dist: gx.dist };
  return { axis: 'z', sign: gz.line >= b.z ? 1 : -1, dist: gz.dist };
}

function makeSignTexture(name, accent) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = '#0e1a33';
  c.fillRect(0, 0, 512, 128);
  // Accent frame.
  c.fillStyle = `#${accent.toString(16).padStart(6, '0')}`;
  c.fillRect(0, 0, 512, 10);
  c.fillRect(0, 118, 512, 10);
  c.fillRect(0, 0, 10, 128);
  c.fillRect(502, 0, 10, 128);
  // Name, bold, shrunk to fit but never below 28px (readability floor).
  let size = 64;
  c.font = `bold ${size}px system-ui, sans-serif`;
  while (size > 28 && c.measureText(name).width > 460) {
    size -= 2;
    c.font = `bold ${size}px system-ui, sans-serif`;
  }
  c.fillStyle = '#ffffff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(name, 256, 66);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildStorefront(b, idx, scene) {
  const name = SHOP_NAMES[idx % SHOP_NAMES.length];
  const accent = SHOP_COLORS[idx % SHOP_COLORS.length];
  const side = facingSide(b);
  const halfW = b.w / 2, halfD = b.d / 2;

  // Rotation so the sign plane's +z normal points at the road.
  let rotY = 0;
  if (side.axis === 'x') rotY = side.sign > 0 ? Math.PI / 2 : -Math.PI / 2;
  else rotY = side.sign > 0 ? 0 : Math.PI;

  // Ground-floor storefront box, proud of the facade by 0.7 units.
  const frontW = Math.min((side.axis === 'x' ? b.d : b.w) * 0.85, 10);
  const boxGeo = side.axis === 'x'
    ? new THREE.BoxGeometry(0.7, 3, frontW)
    : new THREE.BoxGeometry(frontW, 3, 0.7);
  const boxMat = new THREE.MeshStandardMaterial({
    color: accent, roughness: 0.7, metalness: 0.05,
    emissive: accent, emissiveIntensity: 0,
  });
  const box = new THREE.Mesh(boxGeo, boxMat);
  if (side.axis === 'x') box.position.set(b.x + side.sign * (halfW + 0.35), 1.5, b.z);
  else box.position.set(b.x, 1.5, b.z + side.sign * (halfD + 0.35));
  group.add(box);
  litMats.push(boxMat);

  // Glass front: thin pale plane on the outer face of the box.
  const glassGeo = new THREE.PlaneGeometry(frontW * 0.9, 2.2);
  const glassMat = new THREE.MeshBasicMaterial({
    color: 0xbfd9e8, transparent: true, opacity: 0.35,
  });
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.rotation.y = rotY;
  if (side.axis === 'x') glass.position.set(b.x + side.sign * (halfW + 0.72), 1.5, b.z);
  else glass.position.set(b.x, 1.5, b.z + side.sign * (halfD + 0.72));
  group.add(glass);

  // Name sign above the storefront, facing the road.
  const signGeo = new THREE.PlaneGeometry(7, 1.75);
  const signMat = new THREE.MeshBasicMaterial({ map: makeSignTexture(name, accent) });
  const sign = new THREE.Mesh(signGeo, signMat);
  sign.rotation.y = rotY;
  if (side.axis === 'x') sign.position.set(b.x + side.sign * (halfW + 0.15), 3.9, b.z);
  else sign.position.set(b.x, 3.9, b.z + side.sign * (halfD + 0.15));
  group.add(sign);
}

export function init(ctx) {
  const city = ctx && ctx.city;
  const scene = ctx && ctx.scene;
  if (!city || !scene || !Array.isArray(city.buildings)) return;
  group = new THREE.Group();
  group.name = 'storefronts';
  litMats = [];

  // Commercial fronts only: boulevard + neon, no houses, no landmarks.
  const candidates = [];
  for (const b of city.buildings) {
    if (!b || b.house || b.landmark) continue;
    if (b.district !== 'boulevard' && b.district !== 'neon') continue;
    const side = facingSide(b);
    if (side.dist > ROAD_DIST_MAX) continue;
    candidates.push({ b, dist: side.dist });
  }
  // Closest to the road first (most visible), taller buildings first on ties.
  candidates.sort((a, c) => (a.dist - c.dist) || (c.b.h - a.b.h));
  for (let i = 0; i < Math.min(candidates.length, MAX_STOREFRONTS); i++) {
    buildStorefront(candidates[i].b, i, scene);
  }
  scene.add(group);
}

export function sync(state, dt) {
  if (!litMats.length) return;
  const night = nightFactor(state && Number.isFinite(state.clock) ? state.clock : 0);
  const glow = night * 0.55;
  for (const m of litMats) m.emissiveIntensity = glow;
}
