// Street props for Teluk Cahaya: varied trees, hydrants, benches and power
// poles with catenary cables. All procedural, deterministic from the city
// seed. Everything sits inside block interiors (within +/-14 of a block
// centre) or on the sidewalk strip 6-7 units off a grid line — never in the
// 5-unit road band, never on the ring roads where the palms already stand,
// and never in the reserved park / spire / stadium blocks (another slice
// owns those). Placement is checked against city.buildings AABBs at runtime,
// so landmarks added by other slices are respected too.
import * as THREE from 'three';
import { makeRng } from '../core/rng.js';
import { HALF, SPACING } from '../core/city.js';

// Reserved blocks (centres): park, spire, stadium. Also kept clear: the two
// open lots (start plaza, port warehouse yard).
const RESERVED = new Set([
  '-60,-60', '140,-140', '-140,140', // park, spire, stadium
  '-20,-20', '-180,180', // open lots
]);

const GROUND_Y = 0.5; // top of the sidewalk slabs

// Distance from a coordinate to the nearest grid line (roads run on them).
function distToGridLine(v) {
  const r = (((v + HALF) % SPACING) + SPACING) % SPACING;
  return Math.min(r, SPACING - r);
}

// True when (x, z) is clear of every building AABB expanded by `margin`,
// and at least 5.5 units from any grid line (outside the road band).
function spotClear(city, x, z, margin) {
  if (distToGridLine(x) < 5.5 || distToGridLine(z) < 5.5) return false;
  for (const b of city.buildings) {
    if (x > b.minX - margin && x < b.maxX + margin &&
        z > b.minZ - margin && z < b.maxZ + margin) return false;
  }
  return true;
}

function compose(m4, x, y, z, rotY, sx, sy, sz) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  return m4;
}

export function init(ctx) {
  const { city, scene } = ctx;
  const rng = makeRng(city.seed + 23);
  const group = new THREE.Group();
  group.name = 'props';
  scene.add(group);
  const m4 = new THREE.Matrix4();

  // ---- 1. Trees: broadleaf (trunk + round canopy) and conifer (trunk +
  // stacked cones), scattered in block interiors, denser in residential.
  const broadleaf = []; // {x, z, s, rot}
  const conifer = [];
  for (const b of city.blocks) {
    if (RESERVED.has(`${b.cx},${b.cz}`)) continue;
    const chance = b.district === 'residential' ? 0.55 : 0.3;
    if (!rng.chance(chance)) continue;
    for (let attempt = 0; attempt < 4; attempt++) {
      const x = b.cx + rng.range(-13, 13);
      const z = b.cz + rng.range(-13, 13);
      if (!spotClear(city, x, z, 2)) continue;
      const t = { x, z, s: rng.range(0.8, 1.3), rot: rng.range(0, Math.PI * 2) };
      if (rng.chance(0.5)) broadleaf.push(t); else conifer.push(t);
      break;
    }
  }

  // Broadleaf trunk + canopy.
  const blTrunkGeo = new THREE.CylinderGeometry(0.22, 0.38, 2.6, 6);
  blTrunkGeo.translate(0, 1.3, 0);
  const blTrunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 1 });
  const blTrunks = new THREE.InstancedMesh(blTrunkGeo, blTrunkMat, Math.max(1, broadleaf.length));
  const blCanopyGeo = new THREE.SphereGeometry(2.1, 8, 6);
  blCanopyGeo.translate(0, 3.7, 0);
  const blCanopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
  const blCanopies = new THREE.InstancedMesh(blCanopyGeo, blCanopyMat, Math.max(1, broadleaf.length));
  const leafGreen = new THREE.Color();
  broadleaf.forEach((t, i) => {
    compose(m4, t.x, GROUND_Y, t.z, t.rot, t.s, t.s, t.s);
    blTrunks.setMatrixAt(i, m4);
    blCanopies.setMatrixAt(i, m4);
    // Vary the canopy green per tree.
    leafGreen.setHSL(0.32 + rng.range(-0.03, 0.03), rng.range(0.45, 0.6), rng.range(0.32, 0.45));
    blCanopies.setColorAt(i, leafGreen);
  });
  blTrunks.castShadow = true;
  blCanopies.castShadow = true;
  group.add(blTrunks, blCanopies);

  // Conifer trunk + one cone geometry instanced 3x per tree (stacked).
  const cfTrunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 1.6, 6);
  cfTrunkGeo.translate(0, 0.8, 0);
  const cfTrunkMat = new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 1 });
  const cfTrunks = new THREE.InstancedMesh(cfTrunkGeo, cfTrunkMat, Math.max(1, conifer.length));
  const cfConeGeo = new THREE.ConeGeometry(1, 1, 7);
  cfConeGeo.translate(0, 0.5, 0); // scale from the base
  const cfConeMat = new THREE.MeshStandardMaterial({ color: 0x2f7a44, roughness: 0.9, flatShading: true });
  const cfCones = new THREE.InstancedMesh(cfConeGeo, cfConeMat, Math.max(1, conifer.length * 3));
  const coneStack = [[1.9, 2.4, 1.6], [1.45, 2.1, 3.0], [0.95, 1.8, 4.4]]; // [radius, height, baseY]
  conifer.forEach((t, i) => {
    compose(m4, t.x, GROUND_Y, t.z, t.rot, t.s, t.s, t.s);
    cfTrunks.setMatrixAt(i, m4);
    coneStack.forEach(([r, h, y], k) => {
      compose(m4, t.x, GROUND_Y + y * t.s, t.z, t.rot, r * t.s, h * t.s, r * t.s);
      cfCones.setMatrixAt(i * 3 + k, m4);
    });
  });
  cfTrunks.castShadow = true;
  cfCones.castShadow = true;
  group.add(cfTrunks, cfCones);

  // ---- 2. Hydrants: small red cylinder + cap, on sidewalks near
  // intersections that have no traffic light (lamps already occupy the
  // +6,+6 corner of the lit ones), offset 6.5 from both grid lines.
  const hydrantSpots = [];
  const nodes = [...city.nodes];
  // Deterministic shuffle so the 12 picked are spread across the city.
  for (let i = nodes.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
  }
  for (const n of nodes) {
    if (hydrantSpots.length >= 12) break;
    if (Math.abs(n.x) > 200 || Math.abs(n.z) > 200) continue; // keep off the ring edge
    if (n.ix % 2 === 0 && n.iz % 2 === 0) continue; // traffic-light intersection
    const sx = rng.sign(), sz = rng.sign();
    const x = n.x + sx * 6.5, z = n.z + sz * 6.5;
    if (!spotClear(city, x, z, 1.5)) continue;
    hydrantSpots.push([x, z]);
  }
  const hyBodyGeo = new THREE.CylinderGeometry(0.32, 0.36, 0.9, 8);
  hyBodyGeo.translate(0, 0.45, 0);
  const hyBodyMat = new THREE.MeshStandardMaterial({ color: 0xc03028, roughness: 0.6 });
  const hyBodies = new THREE.InstancedMesh(hyBodyGeo, hyBodyMat, Math.max(1, hydrantSpots.length));
  const hyCapGeo = new THREE.SphereGeometry(0.3, 8, 6);
  hyCapGeo.translate(0, 0.95, 0);
  const hyCapMat = new THREE.MeshStandardMaterial({ color: 0x8a1a14, roughness: 0.6 });
  const hyCaps = new THREE.InstancedMesh(hyCapGeo, hyCapMat, Math.max(1, hydrantSpots.length));
  hydrantSpots.forEach(([x, z], i) => {
    compose(m4, x, GROUND_Y, z, 0, 1, 1, 1);
    hyBodies.setMatrixAt(i, m4);
    hyCaps.setMatrixAt(i, m4);
  });
  group.add(hyBodies, hyCaps);

  // ---- 3. Benches: seat + backrest + two legs. Four face the park block
  // from its surrounding sidewalks; the rest sit at block edges in the
  // residential district.
  const benchSpots = []; // {x, z, rot}
  for (const [x, z, rot] of [
    [-73.5, -60, Math.PI / 2], [-46.5, -60, -Math.PI / 2],
    [-60, -73.5, 0], [-60, -46.5, Math.PI],
  ]) {
    if (spotClear(city, x, z, 1.5)) benchSpots.push({ x, z, rot });
  }
  const resBlocks = city.blocks.filter(
    (b) => b.district === 'residential' && !RESERVED.has(`${b.cx},${b.cz}`),
  );
  let guard = 0;
  while (benchSpots.length < 12 && guard++ < 200) {
    const b = resBlocks[Math.floor(rng.next() * resBlocks.length)];
    const side = Math.floor(rng.next() * 4);
    const along = rng.range(-10, 10);
    const edge = 12.5;
    let x, z, rot;
    if (side === 0) { x = b.cx + along; z = b.cz - edge; rot = 0; }
    else if (side === 1) { x = b.cx + along; z = b.cz + edge; rot = Math.PI; }
    else if (side === 2) { x = b.cx - edge; z = b.cz + along; rot = Math.PI / 2; }
    else { x = b.cx + edge; z = b.cz + along; rot = -Math.PI / 2; }
    if (!spotClear(city, x, z, 1.5)) continue;
    benchSpots.push({ x, z, rot });
  }
  const beSeatGeo = new THREE.BoxGeometry(1.8, 0.14, 0.6);
  beSeatGeo.translate(0, 0.5, 0);
  const beBackGeo = new THREE.BoxGeometry(1.8, 0.65, 0.1);
  beBackGeo.translate(0, 0.85, -0.28);
  const beLegGeo = new THREE.BoxGeometry(0.12, 0.5, 0.5);
  beLegGeo.translate(0, 0.25, 0);
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 0.9 });
  const benchDark = new THREE.MeshStandardMaterial({ color: 0x4a4a48, roughness: 0.7, metalness: 0.3 });
  const beSeats = new THREE.InstancedMesh(beSeatGeo, benchMat, Math.max(1, benchSpots.length));
  const beBacks = new THREE.InstancedMesh(beBackGeo, benchMat, Math.max(1, benchSpots.length));
  const beLegs = new THREE.InstancedMesh(beLegGeo, benchDark, Math.max(1, benchSpots.length * 2));
  benchSpots.forEach((s, i) => {
    compose(m4, s.x, GROUND_Y, s.z, s.rot, 1, 1, 1);
    beSeats.setMatrixAt(i, m4);
    beBacks.setMatrixAt(i, m4);
    // Legs are offset along the bench's local X; bake the rotation in.
    const lx = Math.cos(s.rot), lz = -Math.sin(s.rot);
    m4.makeTranslation(s.x - 0.7 * lx, GROUND_Y, s.z - 0.7 * lz);
    m4.multiply(new THREE.Matrix4().makeRotationY(s.rot));
    beLegs.setMatrixAt(i * 2, m4);
    m4.makeTranslation(s.x + 0.7 * lx, GROUND_Y, s.z + 0.7 * lz);
    m4.multiply(new THREE.Matrix4().makeRotationY(s.rot));
    beLegs.setMatrixAt(i * 2 + 1, m4);
  });
  group.add(beSeats, beBacks, beLegs);

  // ---- 4. Power poles + catenary cables along two main roads, mid-block
  // (never at intersections, where the lamps stand). Poles sit 6 units off
  // the grid line, 40 apart; a pole colliding with a building AABB is
  // skipped and the cable simply spans to the next kept pole.
  const poleRoads = [
    { axis: 'z', line: -120, off: 6, rot: 0 }, // vertical road x=-120, poles at x=-114
    { axis: 'x', line: 120, off: 6, rot: Math.PI / 2 }, // horizontal road z=120, poles at z=126
  ];
  const POLE_H = 7;
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.17, POLE_H, 6);
  poleGeo.translate(0, POLE_H / 2, 0);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x5a4a38, roughness: 0.9 });
  const armGeo = new THREE.BoxGeometry(1.6, 0.12, 0.12);
  armGeo.translate(0, POLE_H - 0.4, 0);
  const armMat = new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.9 });
  const cableMat = new THREE.LineBasicMaterial({ color: 0x1a1a1a });

  const poleSpots = []; // {x, z, rot}
  for (const road of poleRoads) {
    const kept = [];
    for (let k = 0; k < 12; k++) {
      const along = -220 + k * 40; // mid-block positions, 40 apart
      const x = road.axis === 'z' ? road.line + road.off : along;
      const z = road.axis === 'z' ? along : road.line + road.off;
      if (!spotClear(city, x, z, 1)) continue;
      kept.push({ x, z, rot: road.rot });
    }
    poleSpots.push(...kept);
    // Catenary cables between consecutive kept poles on this road.
    for (let i = 0; i + 1 < kept.length; i++) {
      const a = kept[i], b = kept[i + 1];
      const span = Math.hypot(b.x - a.x, b.z - a.z);
      if (span > 80) continue; // don't string a cable across a big gap
      const segs = 12, sag = 1.1;
      const pts = [];
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        pts.push(new THREE.Vector3(
          a.x + (b.x - a.x) * t,
          GROUND_Y + POLE_H - 0.4 - sag * 4 * t * (1 - t),
          a.z + (b.z - a.z) * t,
        ));
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), cableMat));
    }
  }
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, Math.max(1, poleSpots.length));
  const arms = new THREE.InstancedMesh(armGeo, armMat, Math.max(1, poleSpots.length));
  poleSpots.forEach((p, i) => {
    compose(m4, p.x, GROUND_Y, p.z, p.rot, 1, 1, 1);
    poles.setMatrixAt(i, m4);
    arms.setMatrixAt(i, m4);
  });
  poles.castShadow = true;
  group.add(poles, arms);

  // Keep counts visible for debugging (readable in the console / devtools).
  group.userData.props = {
    broadleaf: broadleaf.length,
    conifer: conifer.length,
    hydrants: hydrantSpots.length,
    benches: benchSpots.length,
    poles: poleSpots.length,
  };
}

// Nothing glows or animates in this slice.
export function sync(state, dt) {}
