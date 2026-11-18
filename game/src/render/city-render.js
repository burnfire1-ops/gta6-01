// City rendering: instanced buildings in 4 procedural facade archetypes,
// rooftop clutter, palms, lamps, a canvas-textured road ground, sea,
// seawall and lighthouse. All procedural, from the same seed as the
// simulation city in core/city.js — the meshes are views of that data.
import * as THREE from 'three';
import { makeRng } from '../core/rng.js';
import { nightFactor } from '../core/clock.js';
import { HALF, SPACING } from '../core/city.js';

// Deterministic 0..1 hash of a position, for archetype picks and rooftop
// clutter placement. Stateless, so the result never depends on build order.
function hash2(x, z) {
  let h = (Math.round(x * 100) * 374761393 + Math.round(z * 100) * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- facades
// Four archetypes, each a 128x256 day map + emissive map (lit windows only,
// so at night the buildings light up room by room). All painted on canvas,
// no external textures.

// (a) Art-deco pastel plaster: pale plaster, cornice + chevron band,
// pilaster strips, 5x11 window grid.
function paintPlaster(d, e, rng) {
  d.fillStyle = '#efe8da'; d.fillRect(0, 0, 128, 256);
  e.fillStyle = '#000000'; e.fillRect(0, 0, 128, 256);
  d.fillStyle = '#d8cbb6'; d.fillRect(0, 246, 128, 10); // plinth
  d.fillStyle = '#e0d4c0'; d.fillRect(0, 0, 128, 10); // cornice
  d.fillStyle = '#d9c9a8'; // deco chevron band under the cornice
  for (let x = 0; x < 128; x += 16) {
    d.beginPath();
    d.moveTo(x, 22); d.lineTo(x + 8, 13); d.lineTo(x + 16, 22);
    d.lineTo(x + 16, 26); d.lineTo(x + 8, 17); d.lineTo(x, 26);
    d.closePath(); d.fill();
  }
  d.fillStyle = '#e6dcc8'; // pilasters between window columns
  for (const x of [0, 24, 49, 74, 99, 124]) d.fillRect(x, 28, 4, 216);
  for (let row = 0; row < 11; row++) {
    for (let col = 0; col < 5; col++) {
      const x = 8 + col * 24, y = 32 + row * 20;
      const lit = rng.chance(0.4);
      d.fillStyle = lit ? '#ffd98a' : '#3a4a63';
      d.fillRect(x, y, 12, 12);
      if (lit) { e.fillStyle = '#ffbe5a'; e.fillRect(x, y, 12, 12); }
    }
  }
}

// (b) Glass curtain wall: deep teal gradient, dense 8x16 pane grid, some
// panes lit (warm or cool) at night.
function paintGlass(d, e, rng) {
  const grad = d.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#2a6a7a'); grad.addColorStop(1, '#17404e');
  d.fillStyle = grad; d.fillRect(0, 0, 128, 256);
  e.fillStyle = '#000000'; e.fillRect(0, 0, 128, 256);
  const cols = 8, rows = 16, cw = 128 / cols, ch = 256 / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw + 1.5, y = r * ch + 1.5, w = cw - 3, h = ch - 3;
      const shade = Math.round(rng.range(-14, 14));
      const lit = rng.chance(0.28);
      d.fillStyle = lit ? '#cfe8d8' : `rgb(${38 + shade},${96 + shade},${112 + shade})`;
      d.fillRect(x, y, w, h);
      if (lit) {
        e.fillStyle = rng.chance(0.5) ? '#ffd98a' : '#bfe8ff';
        e.fillRect(x, y, w, h);
      }
    }
  }
}

// (c) Horizontal floor lines: concrete bands with long strip windows,
// split into lit/unlit segments per floor.
function paintSlab(d, e, rng) {
  d.fillStyle = '#b8b0a4'; d.fillRect(0, 0, 128, 256);
  e.fillStyle = '#000000'; e.fillRect(0, 0, 128, 256);
  const floors = 10, fh = 256 / floors;
  for (let f = 0; f < floors; f++) {
    const y = f * fh;
    d.fillStyle = '#a39a8c'; d.fillRect(0, y, 128, 3); // floor slab line
    const wy = y + 7, wh = 9;
    for (let s = 0; s < 4; s++) {
      const x = 8 + s * 30, w = 24;
      const lit = rng.chance(0.45);
      d.fillStyle = lit ? '#ffe1a0' : '#33455c';
      d.fillRect(x, wy, w, wh);
      if (lit) { e.fillStyle = '#ffbe5a'; e.fillRect(x, wy, w, wh); }
    }
  }
  d.fillStyle = '#8f8678'; d.fillRect(0, 250, 128, 6); // base
}

// (d) Brick / retail: warm brick courses, 5x8 upper windows, ground-floor
// shopfront with bigger windows under an awning band.
function paintBrick(d, e, rng) {
  d.fillStyle = '#a86048'; d.fillRect(0, 0, 128, 256);
  e.fillStyle = '#000000'; e.fillRect(0, 0, 128, 256);
  d.fillStyle = 'rgba(0,0,0,0.18)'; // mortar: horizontal courses + staggered joints
  for (let y = 4; y < 256; y += 8) d.fillRect(0, y, 128, 1);
  for (let y = 0; y < 256; y += 8) {
    const off = ((y / 8) % 2) ? 8 : 0;
    for (let x = off; x < 128; x += 16) d.fillRect(x, y, 1, 8);
  }
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 5; col++) {
      const x = 10 + col * 23, y = 14 + row * 20;
      const lit = rng.chance(0.35);
      d.fillStyle = lit ? '#ffd98a' : '#2f3d55';
      d.fillRect(x, y, 12, 12);
      if (lit) { e.fillStyle = '#ffbe5a'; e.fillRect(x, y, 12, 12); }
    }
  }
  d.fillStyle = '#7a4a38'; d.fillRect(0, 196, 128, 60); // shopfront base
  d.fillStyle = '#3f6a4a'; d.fillRect(0, 192, 128, 8); // awning band
  for (let col = 0; col < 4; col++) {
    const x = 8 + col * 31;
    const lit = rng.chance(0.6);
    d.fillStyle = lit ? '#ffe9b0' : '#2c3848';
    d.fillRect(x, 206, 24, 34);
    if (lit) { e.fillStyle = '#ffc86a'; e.fillRect(x, 206, 24, 34); }
  }
}

function facadeArchetypes(seed) {
  const defs = [
    { paint: paintPlaster, rough: 0.85, metal: 0.05, tint: 0xffffff, glow: 0.9 },
    { paint: paintGlass, rough: 0.25, metal: 0.3, tint: 0x9adfe0, glow: 1.2 },
    { paint: paintSlab, rough: 0.8, metal: 0.1, tint: 0xffffff, glow: 0.9 },
    { paint: paintBrick, rough: 0.9, metal: 0.0, tint: 0xffffff, glow: 0.9 },
  ];
  return defs.map((def, i) => {
    const rng = makeRng(seed * 7 + 3 + i * 101);
    const day = document.createElement('canvas'); day.width = 128; day.height = 256;
    const emi = document.createElement('canvas'); emi.width = 128; emi.height = 256;
    def.paint(day.getContext('2d'), emi.getContext('2d'), rng);
    const dayTex = new THREE.CanvasTexture(day);
    dayTex.colorSpace = THREE.SRGBColorSpace;
    const emiTex = new THREE.CanvasTexture(emi);
    emiTex.colorSpace = THREE.SRGBColorSpace;
    return { ...def, dayTex, emiTex };
  });
}

// Archetype per building, deterministic from district + position hash.
// Glass towers (b.glass / landmark) always get the curtain wall.
function archetypeFor(b, h) {
  if (b.glass || b.landmark) return 1;
  switch (b.district) {
    case 'boulevard': return h < 0.55 ? 0 : 3;
    case 'neon': return h < 0.5 ? 1 : 2;
    case 'port': return h < 0.5 ? 2 : 3;
    case 'residential': return 0;
    default: return 0;
  }
}

// ---------------------------------------------------------------- ground
// Ground texture: navy asphalt with noise speckles, pale sidewalk blocks
// with a thin paving grid, white road-edge lines, yellow centre dashes,
// white stop lines at every intersection, white crosswalks at major
// (80-unit) intersections, a grass patch on the park block (-60,-60) and
// small yard strips on residential blocks.
function groundTexture(city) {
  const S = 1024, W = 560; // world -280..280 maps onto 0..1024 px
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  const rng = makeRng(city.seed * 13 + 5);
  const toPx = (v) => ((v + W / 2) / W) * S;
  const px = S / W; // pixels per world unit
  g.fillStyle = '#2e3442'; g.fillRect(0, 0, S, S); // asphalt
  for (let i = 0; i < 5000; i++) { // asphalt noise speckles
    g.fillStyle = rng.chance(0.5) ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
    g.fillRect(rng.range(0, S), rng.range(0, S), 1.5, 1.5);
  }
  for (const b of city.blocks) {
    const bx = toPx(b.cx - 15), bz = toPx(b.cz - 15), s = 30 * px;
    const isPark = b.cx === -60 && b.cz === -60;
    if (isPark) {
      g.fillStyle = '#5f8f4e'; g.fillRect(bx, bz, s, s); // park grass
      for (let i = 0; i < 40; i++) { // darker grass blotches
        g.fillStyle = rng.chance(0.5) ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.06)';
        g.fillRect(bx + rng.range(0, s), bz + rng.range(0, s), rng.range(2, 6), rng.range(2, 6));
      }
    } else {
      g.fillStyle = '#c9b6a4'; g.fillRect(bx, bz, s, s);
      g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 1; // paving grid
      for (let k = 1; k < 6; k++) {
        g.beginPath(); g.moveTo(bx + (k * s) / 6, bz); g.lineTo(bx + (k * s) / 6, bz + s); g.stroke();
        g.beginPath(); g.moveTo(bx, bz + (k * s) / 6); g.lineTo(bx + s, bz + (k * s) / 6); g.stroke();
      }
    }
    if (b.district === 'residential') { // small yard strip, north edge
      g.fillStyle = '#5f8f4e';
      g.fillRect(bx, bz, s, 5 * px);
    }
  }
  g.fillStyle = 'rgba(232,232,232,0.85)'; // white road-edge lines
  for (let v = -HALF; v <= HALF; v += SPACING) {
    g.fillRect(toPx(-HALF), toPx(v - 5) - 0.18 * px, 560 * px, 0.36 * px);
    g.fillRect(toPx(-HALF), toPx(v + 5) - 0.18 * px, 560 * px, 0.36 * px);
    g.fillRect(toPx(v - 5) - 0.18 * px, toPx(-HALF), 0.36 * px, 560 * px);
    g.fillRect(toPx(v + 5) - 0.18 * px, toPx(-HALF), 0.36 * px, 560 * px);
  }
  g.fillStyle = '#f2c14e'; // yellow centre dashes
  for (let v = -HALF; v <= HALF; v += SPACING) {
    for (let u = -HALF; u < HALF; u += 8) {
      g.fillRect(toPx(u), toPx(v) - 0.4 * px, 4 * px, 0.8 * px);
      g.fillRect(toPx(v) - 0.4 * px, toPx(u), 0.8 * px, 4 * px);
    }
  }
  g.fillStyle = '#e8e8e8'; // stop lines, 4 approaches per intersection
  for (let x = -HALF; x <= HALF; x += SPACING) {
    for (let z = -HALF; z <= HALF; z += SPACING) {
      g.fillRect(toPx(x) - 1.75 * px, toPx(z - 6.5) - 0.35 * px, 3.5 * px, 0.7 * px);
      g.fillRect(toPx(x) - 1.75 * px, toPx(z + 6.5) - 0.35 * px, 3.5 * px, 0.7 * px);
      g.fillRect(toPx(x - 6.5) - 0.35 * px, toPx(z) - 1.75 * px, 0.7 * px, 3.5 * px);
      g.fillRect(toPx(x + 6.5) - 0.35 * px, toPx(z) - 1.75 * px, 0.7 * px, 3.5 * px);
    }
  }
  g.fillStyle = '#e8e8e8'; // crosswalks at major (80-unit) intersections
  for (let x = -HALF; x <= HALF; x += 80) {
    for (let z = -HALF; z <= HALF; z += 80) {
      for (let i = -3; i <= 3; i++) {
        g.fillRect(toPx(x + i * 1.6) - 0.6 * px, toPx(z - 5), 1.2 * px, 10 * px);
      }
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Small paving texture for the raised sidewalk slabs, so the paving joints
// read on the slab tops too (the ground texture underneath is covered).
function pavingTexture() {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#efe8da'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(90,70,50,0.18)'; g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const p = k * 32 + 0.5;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 128); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(128, p); g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ------------------------------------------------------- rooftop clutter
// One merged geometry (AC box + water tank cylinder) shared by a single
// instanced mesh. Merged by hand — no addons import in the import map.
function clutterGeometry() {
  const box = new THREE.BoxGeometry(1.5, 0.9, 1.5);
  box.translate(0, 0.45, 0);
  const tank = new THREE.CylinderGeometry(0.55, 0.55, 1.2, 10);
  tank.translate(1.15, 0.6, 0.55);
  const pos = [], nor = [], uv = [];
  for (const part of [box, tank]) {
    const flat = part.toNonIndexed();
    pos.push(...flat.attributes.position.array);
    nor.push(...flat.attributes.normal.array);
    uv.push(...flat.attributes.uv.array);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}

export function createCityRender(scene, city) {
  const group = new THREE.Group();
  group.name = 'city';
  scene.add(group);

  // Ground plane with the procedural road texture.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(560, 560),
    new THREE.MeshStandardMaterial({ map: groundTexture(city), roughness: 0.9, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Raised sidewalk slabs, one instanced mesh for every block. Per-instance
  // colour: pale sidewalk everywhere, grass green on the park block (-60,-60)
  // so the park reads above the slab that covers the ground texture.
  const slabGeo = new THREE.BoxGeometry(30, 0.5, 30);
  const slabMat = new THREE.MeshStandardMaterial({
    map: pavingTexture(), color: 0xffffff, roughness: 0.95,
  });
  const slabs = new THREE.InstancedMesh(slabGeo, slabMat, city.blocks.length);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  city.blocks.forEach((b, i) => {
    m4.makeTranslation(b.cx, 0.25, b.cz);
    slabs.setMatrixAt(i, m4);
    const isPark = b.cx === -60 && b.cz === -60;
    slabs.setColorAt(i, col.setHex(isPark ? 0x5f8f4e : 0xd8c8b4));
  });
  slabs.receiveShadow = true;
  group.add(slabs);

  // Small yard strips on residential blocks: thin grass boxes on the slab
  // tops, north edge of each block (the matching strip is also painted in
  // the ground texture underneath).
  const residentialBlocks = city.blocks.filter((b) => b.district === 'residential');
  const yardGeo = new THREE.BoxGeometry(30, 0.14, 5);
  yardGeo.translate(0, 0.07, 0);
  const yardMat = new THREE.MeshStandardMaterial({ color: 0x5f8f4e, roughness: 1 });
  const yards = new THREE.InstancedMesh(yardGeo, yardMat, Math.max(1, residentialBlocks.length));
  residentialBlocks.forEach((b, i) => {
    m4.makeTranslation(b.cx, 0.5, b.cz - 12.5);
    yards.setMatrixAt(i, m4);
  });
  yards.receiveShadow = true;
  group.add(yards);

  // Buildings: one unit box scaled per building, one InstancedMesh per
  // facade archetype (4 meshes), each with its own material + textures.
  // Houses (b.house) are skipped — another module renders them.
  const archetypes = facadeArchetypes(city.seed);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0); // scale from the base, not the centre
  const lists = [[], [], [], []];
  for (const b of city.buildings) {
    if (b.house) continue;
    lists[archetypeFor(b, hash2(b.x, b.z))].push(b);
  }
  const buildingMats = archetypes.map((a, i) => {
    const mat = new THREE.MeshStandardMaterial({
      map: a.dayTex, emissiveMap: a.emiTex, emissive: 0xffffff, emissiveIntensity: 0,
      color: a.tint, roughness: a.rough, metalness: a.metal,
    });
    const mesh = new THREE.InstancedMesh(boxGeo, mat, Math.max(1, lists[i].length));
    lists[i].forEach((b, j) => {
      m4.makeScale(b.w, b.h, b.d);
      m4.setPosition(b.x, 0.5, b.z);
      mesh.setMatrixAt(j, m4);
      mesh.setColorAt(j, col.setHex(b.color));
    });
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    return mat;
  });

  // Rooftop clutter: 1-2 AC/tank units per building with h >= 8 (houses
  // excluded), placed inside the roof footprint.
  const clutterSpots = [];
  for (const b of city.buildings) {
    if (b.house || b.h < 8) continue;
    const n = hash2(b.x + 1, b.z + 1) < 0.45 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const h1 = hash2(b.x + k * 7.3, b.z + k * 3.1);
      const h2 = hash2(b.x + k * 3.7, b.z + k * 9.2);
      clutterSpots.push({
        x: b.x + (h1 - 0.5) * (b.w - 5.2),
        z: b.z + (h2 - 0.5) * (b.d - 5.2),
        y: 0.5 + b.h,
        rot: hash2(b.x + k, b.z - k) * Math.PI * 2,
        s: 0.9 + hash2(b.x - k, b.z + k) * 0.3,
      });
    }
  }
  const clutterMat = new THREE.MeshStandardMaterial({ color: 0x9a9a92, roughness: 0.9, metalness: 0.15 });
  const clutter = new THREE.InstancedMesh(clutterGeometry(), clutterMat, Math.max(1, clutterSpots.length));
  const scl = new THREE.Vector3();
  clutterSpots.forEach((c, i) => {
    m4.makeRotationY(c.rot);
    m4.scale(scl.set(c.s, c.s, c.s));
    m4.setPosition(c.x, c.y, c.z);
    clutter.setMatrixAt(i, m4);
    clutter.setColorAt(i, col.setScalar(0.85 + hash2(c.x, c.z) * 0.15));
  });
  clutter.castShadow = true;
  group.add(clutter);

  // Palms along the boulevard streets (the outer ring roads and a mid ring).
  const palmRng = makeRng(city.seed + 11);
  const palmSpots = [];
  for (let v = -HALF + 20; v <= HALF - 20; v += 40) {
    palmSpots.push([-220, v], [220, v], [v, -220], [v, 220]);
    if (palmRng.chance(0.6)) palmSpots.push([-140, v], [140, v]);
  }
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 7, 6);
  trunkGeo.translate(0, 3.5, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 1 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmSpots.length);
  const leafGeo = new THREE.ConeGeometry(3.2, 2.2, 6);
  leafGeo.translate(0, 7.6, 0);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4a9a5a, roughness: 0.9, flatShading: true });
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, palmSpots.length);
  palmSpots.forEach(([x, z], i) => {
    m4.makeRotationY(palmRng.range(0, Math.PI * 2));
    m4.setPosition(x, 0.5, z);
    trunks.setMatrixAt(i, m4);
    leaves.setMatrixAt(i, m4);
  });
  trunks.castShadow = true;
  group.add(trunks); group.add(leaves);

  // Street lamps at the traffic-light intersections; the heads glow at night.
  const lampGeo = new THREE.CylinderGeometry(0.12, 0.18, 6, 5);
  lampGeo.translate(0, 3, 0);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.6, metalness: 0.4 });
  const headGeo = new THREE.SphereGeometry(0.45, 8, 6);
  headGeo.translate(0, 6.1, 0);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff2c8, emissive: 0xffd98a, emissiveIntensity: 0, roughness: 0.4,
  });
  const lampSpots = city.trafficLights.map((l) => {
    const c = city.nodes[l.nodeId];
    return [c.x + 6, c.z + 6];
  });
  const poles = new THREE.InstancedMesh(lampGeo, lampMat, lampSpots.length);
  const heads = new THREE.InstancedMesh(headGeo, headMat, lampSpots.length);
  lampSpots.forEach(([x, z], i) => {
    m4.makeTranslation(x, 0.5, z);
    poles.setMatrixAt(i, m4);
    heads.setMatrixAt(i, m4);
  });
  group.add(poles); group.add(heads);

  // Sea plane, seawall ring and the lighthouse at its POI.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(1800, 1800),
    new THREE.MeshStandardMaterial({ color: 0x2a8a9a, roughness: 0.25, metalness: 0.1 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.6;
  group.add(water);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 1 });
  for (const [x, z, w, d] of [[0, -252, 520, 6], [0, 252, 520, 6], [-252, 0, 6, 520], [252, 0, 6, 520]]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 2.5, d), wallMat);
    wall.position.set(x, 1.25, z);
    wall.receiveShadow = true;
    group.add(wall);
  }
  const lh = new THREE.Group();
  const lhWhite = new THREE.MeshStandardMaterial({ color: 0xf2ede4, roughness: 0.8 });
  const lhRed = new THREE.MeshStandardMaterial({ color: 0xd84a4a, roughness: 0.8 });
  const lhBase = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4, 18, 10), lhWhite);
  lhBase.position.y = 9;
  const lhBand = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.1, 3, 10), lhRed);
  lhBand.position.y = 12;
  const lhLampMat = new THREE.MeshStandardMaterial({
    color: 0xfff2c8, emissive: 0xffe9a0, emissiveIntensity: 1.5,
  });
  const lhLamp = new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 8), lhLampMat);
  lhLamp.position.y = 19;
  lh.add(lhBase, lhBand, lhLamp);
  lh.position.set(city.pois.lighthouse.x, -0.5, city.pois.lighthouse.z);
  lh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  group.add(lh);

  // Night pass: all facade archetypes glow, lamp heads glow, the
  // lighthouse lamp pulses.
  function sync(state) {
    const night = nightFactor(state.clock);
    buildingMats.forEach((mat, i) => { mat.emissiveIntensity = night * archetypes[i].glow; });
    headMat.emissiveIntensity = night * 3.0;
    lhLampMat.emissiveIntensity = 1.0 + night * 1.5 + Math.sin(state.time * 2) * 0.4;
  }
  return { group, sync };
}
