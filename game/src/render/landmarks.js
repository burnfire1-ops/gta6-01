// Landmarks + residential houses: procedural render views of core/city.js.
// Houses (city.buildings with house:true), Menara Cahaya, Taman Cahaya and
// Stadion Teluk. All geometry is primitive three.js, no external assets.
// city-render.js owns the instanced commercial boxes; this slice owns
// everything the city data flags as a house or a landmark.
import * as THREE from 'three';
import { nightFactor } from '../core/clock.js';
import { makeRng } from '../core/rng.js';

let beaconMat = null; // spire beacon: glows at night (sync)
let floodMat = null;  // stadium floodlight heads: on at night (sync)

// Unit triangular prism (gable roof): triangle (-0.5,0)-(0.5,0)-(0,1),
// extruded 1 deep, centred on z. Scaled per house: (w+ov, roofH, d+ov).
function unitGableGeo() {
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 1); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return g;
}

// Unit hip roof: 4-sided cone, base at y=0, apex at y=1, square base of
// side sqrt(2) after the 45-degree turn. Scaled per house.
function unitHipGeo() {
  const g = new THREE.ConeGeometry(1, 1, 4);
  g.rotateY(Math.PI / 4);
  g.translate(0, 0.5, 0);
  return g;
}

function roofHeight(b) { return 1.4 + (b.h - 3) * 0.45; } // 1.4..2.3 for h 3..5

export function init(ctx) {
  const city = ctx && ctx.city;
  const scene = ctx && ctx.scene;
  if (!city || !scene || !Array.isArray(city.buildings)) return;
  const group = new THREE.Group();
  group.name = 'landmarks';
  scene.add(group);
  const m4 = new THREE.Matrix4();

  // Block lookup (building object -> its block) for clamping lawns and
  // driveways inside the block.
  const blockOf = new Map();
  for (const bl of city.blocks || []) {
    for (const b of bl.buildings || []) blockOf.set(b, bl);
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---- Houses ------------------------------------------------------------
  const houses = city.buildings.filter((b) => b && b.house);
  const gables = houses.filter((b) => b.roof === 'gable');
  const hips = houses.filter((b) => b.roof === 'hip');
  const porches = houses.filter((b) => b.porch);

  // Walls: unit box, base at y=0.5 (same footing as city-render).
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  wallGeo.translate(0, 0.5, 0);
  const wallMat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, Math.max(1, houses.length));
  const col = new THREE.Color();
  houses.forEach((b, i) => {
    m4.makeScale(b.w, b.h, b.d);
    m4.setPosition(b.x, 0.5, b.z);
    walls.setMatrixAt(i, m4);
    walls.setColorAt(i, col.setHex(b.color));
  });
  walls.castShadow = true; walls.receiveShadow = true;
  group.add(walls);

  // Gable roofs (terracotta prisms).
  const gableMat = new THREE.MeshStandardMaterial({ color: 0xa85a4a, roughness: 0.9 });
  const gableMesh = new THREE.InstancedMesh(unitGableGeo(), gableMat, Math.max(1, gables.length));
  gables.forEach((b, i) => {
    m4.makeScale(b.w + 0.8, roofHeight(b), b.d + 0.8);
    m4.setPosition(b.x, 0.5 + b.h, b.z);
    gableMesh.setMatrixAt(i, m4);
  });
  gableMesh.castShadow = true;
  group.add(gableMesh);

  // Hip roofs (slate pyramids).
  const hipMat = new THREE.MeshStandardMaterial({ color: 0x5a6a7a, roughness: 0.9 });
  const hipMesh = new THREE.InstancedMesh(unitHipGeo(), hipMat, Math.max(1, hips.length));
  hips.forEach((b, i) => {
    m4.makeScale((b.w + 0.8) / Math.SQRT2, roofHeight(b), (b.d + 0.8) / Math.SQRT2);
    m4.setPosition(b.x, 0.5 + b.h, b.z);
    hipMesh.setMatrixAt(i, m4);
  });
  hipMesh.castShadow = true;
  group.add(hipMesh);

  // Porches: slab + flat roof on two posts, on the side with the most room
  // inside the block (never into the road band).
  const porchMat = new THREE.MeshStandardMaterial({ color: 0x9a7a58, roughness: 0.95 });
  const porchSlabs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), porchMat, Math.max(1, porches.length));
  const porchRoofs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), porchMat, Math.max(1, porches.length));
  const porchPosts = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), porchMat, Math.max(1, porches.length * 2));
  let postIdx = 0;
  porches.forEach((b, i) => {
    const bl = blockOf.get(b);
    const bx0 = bl ? bl.cx - 15 : b.x - 15, bx1 = bl ? bl.cx + 15 : b.x + 15;
    const bz0 = bl ? bl.cz - 15 : b.z - 15, bz1 = bl ? bl.cz + 15 : b.z + 15;
    const space = { px: bx1 - b.maxX, nx: b.minX - bx0, pz: bz1 - b.maxZ, nz: b.minZ - bz0 };
    const side = Object.entries(space).sort((a, c) => c[1] - a[1])[0][0];
    const pw = Math.min(b.w * 0.6, 5); // porch width along the wall
    let sx, sz, sw, sd, px, pz, qx, qz;
    if (side === 'pz' || side === 'nz') {
      const sgn = side === 'pz' ? 1 : -1;
      sz = (side === 'pz' ? b.maxZ : b.minZ) + sgn * 1.1;
      sx = b.x; sw = pw; sd = 2.2;
      px = sx; pz = sz + sgn * 1.0; qx = pw / 2 - 0.25; qz = 0;
    } else {
      const sgn = side === 'px' ? 1 : -1;
      sx = (side === 'px' ? b.maxX : b.minX) + sgn * 1.1;
      sz = b.z; sw = 2.2; sd = pw;
      px = sx + sgn * 1.0; pz = sz; qx = 0; qz = pw / 2 - 0.25;
    }
    m4.makeScale(sw, 0.25, sd); m4.setPosition(sx, 0.625, sz);
    porchSlabs.setMatrixAt(i, m4);
    m4.makeScale(sw, 0.12, sd + 0.3); m4.setPosition(sx, 2.32, sz);
    porchRoofs.setMatrixAt(i, m4);
    for (const [dx, dz] of [[-qx, -qz], [qx, qz]]) {
      m4.makeScale(0.18, 1.5, 0.18); m4.setPosition(px + dx, 1.5, pz + dz);
      porchPosts.setMatrixAt(postIdx++, m4);
    }
  });
  porchSlabs.receiveShadow = true;
  group.add(porchSlabs); group.add(porchRoofs); group.add(porchPosts);

  // Lawns: flat green patch around each house, clamped inside its block.
  const lawnMat = new THREE.MeshStandardMaterial({ color: 0x5a9a4a, roughness: 1 });
  const lawns = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lawnMat, Math.max(1, houses.length));
  houses.forEach((b, i) => {
    const bl = blockOf.get(b);
    const lw = Math.min(b.w + 6, 26), ld = Math.min(b.d + 6, 26);
    const cx = bl ? clamp(b.x, bl.cx - 14 + lw / 2, bl.cx + 14 - lw / 2) : b.x;
    const cz = bl ? clamp(b.z, bl.cz - 14 + ld / 2, bl.cz + 14 - ld / 2) : b.z;
    m4.makeScale(lw, 0.12, ld); m4.setPosition(cx, 0.57, cz);
    lawns.setMatrixAt(i, m4);
  });
  lawns.receiveShadow = true;
  group.add(lawns);

  // Driveways: grey strip from the house to the block edge, on the roomiest
  // side, only where at least 5 units of room exist.
  const driveMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 1 });
  const drives = [];
  for (const b of houses) {
    const bl = blockOf.get(b);
    if (!bl) continue;
    const space = {
      px: bl.cx + 15 - b.maxX, nx: b.minX - (bl.cx - 15),
      pz: bl.cz + 15 - b.maxZ, nz: b.minZ - (bl.cz - 15),
    };
    const [side, room] = Object.entries(space).sort((a, c) => c[1] - a[1])[0];
    if (room < 5) continue;
    const len = Math.min(room, 8);
    if (side === 'px') drives.push({ x: b.maxX + len / 2, z: b.z, w: len, d: 3 });
    else if (side === 'nx') drives.push({ x: b.minX - len / 2, z: b.z, w: len, d: 3 });
    else if (side === 'pz') drives.push({ x: b.x, z: b.maxZ + len / 2, w: 3, d: len });
    else drives.push({ x: b.x, z: b.minZ - len / 2, w: 3, d: len });
  }
  const driveMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), driveMat, Math.max(1, drives.length));
  drives.forEach((dv, i) => {
    m4.makeScale(dv.w, 0.12, dv.d); m4.setPosition(dv.x, 0.57, dv.z);
    driveMesh.setMatrixAt(i, m4);
  });
  driveMesh.receiveShadow = true;
  group.add(driveMesh);

  // ---- Landmarks ---------------------------------------------------------
  const marks = Array.isArray(city.landmarks) ? city.landmarks : [];
  const byId = {};
  for (const lm of marks) if (lm && lm.id) byId[lm.id] = lm;

  // Menara Cahaya: tapering stacked boxes, ~95 tall, beacon on top.
  if (byId.spire) {
    const lm = byId.spire;
    const spire = new THREE.Group();
    spire.name = 'spire';
    const tiers = [
      [18, 30, 0x7fb8c8], [12, 25, 0x6aa8c0], [8, 20, 0x5f9ab5],
    ];
    let y = 0.5;
    for (const [w, h, c] of tiers) {
      const tier = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, w),
        new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.2 }),
      );
      tier.position.y = y + h / 2;
      tier.castShadow = true;
      spire.add(tier);
      y += h;
    }
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(8 / Math.SQRT2, 19.5, 4),
      new THREE.MeshStandardMaterial({ color: 0x4a7a9a, roughness: 0.4, metalness: 0.2 }),
    );
    tip.rotation.y = Math.PI / 4;
    tip.position.y = y + 19.5 / 2;
    tip.castShadow = true;
    spire.add(tip);
    beaconMat = new THREE.MeshStandardMaterial({
      color: 0xffe9a0, emissive: 0xffc84a, emissiveIntensity: 1, roughness: 0.4,
    });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.3, 12, 10), beaconMat);
    beacon.position.y = 96;
    spire.add(beacon);
    spire.position.set(lm.x, 0, lm.z);
    group.add(spire);
  }

  // Taman Cahaya: lawn, crossing paths, fountain, trees, benches.
  if (byId.park) {
    const lm = byId.park;
    const cx = lm.cx, cz = lm.cz;
    const park = new THREE.Group();
    park.name = 'park';
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x4a8a3a, roughness: 1 });
    const lawn = new THREE.Mesh(new THREE.BoxGeometry(28, 0.3, 28), grassMat);
    lawn.position.set(cx, 0.65, cz);
    lawn.receiveShadow = true;
    park.add(lawn);
    const pathMat = new THREE.MeshStandardMaterial({ color: 0xe8ddc8, roughness: 1 });
    for (const [w, d] of [[28, 2.4], [2.4, 28]]) {
      const path = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), pathMat);
      path.position.set(cx, 0.86, cz);
      path.receiveShadow = true;
      park.add(path);
    }
    // Fountain: stone basin + water disc + centre column.
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xc8c0b0, roughness: 0.9 });
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.2, 0.9, 20), stoneMat);
    basin.position.set(cx, 1.25, cz);
    basin.castShadow = true;
    park.add(basin);
    const water = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 2.6, 0.12, 20),
      new THREE.MeshStandardMaterial({ color: 0x4a90c8, roughness: 0.15, metalness: 0.1 }),
    );
    water.position.set(cx, 1.62, cz);
    park.add(water);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.1, 8), stoneMat);
    column.position.set(cx, 2.15, cz);
    park.add(column);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), water.material);
    orb.position.set(cx, 2.85, cz);
    park.add(orb);
    // Trees: 8 broadleaf, kept off the crossing paths, inside +-13.
    const treeRng = makeRng(city.seed + 101);
    const spots = [];
    for (let tries = 0; tries < 40 && spots.length < 8; tries++) {
      const a = treeRng.range(0, Math.PI * 2);
      const r = treeRng.range(8, 12.5);
      const dx = Math.cos(a) * r, dz = Math.sin(a) * r;
      if (Math.abs(dx) < 3 || Math.abs(dz) < 3) continue;
      spots.push([cx + dx, cz + dz, treeRng.range(1.6, 2.3)]);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.4, 2.4, 6);
    trunkGeo.translate(0, 1.2, 0);
    const trunks = new THREE.InstancedMesh(
      trunkGeo, new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 1 }),
      Math.max(1, spots.length),
    );
    const canopies = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x4a9a5a, roughness: 0.9, flatShading: true }),
      Math.max(1, spots.length),
    );
    spots.forEach(([x, z, s], i) => {
      m4.makeScale(1, 1, 1); m4.setPosition(x, 0.8, z);
      trunks.setMatrixAt(i, m4);
      m4.makeScale(s, s * 0.9, s); m4.setPosition(x, 4.0, z);
      canopies.setMatrixAt(i, m4);
    });
    trunks.castShadow = true; canopies.castShadow = true;
    park.add(trunks); park.add(canopies);
    // Benches beside the paths.
    const benchMat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 1 });
    const benches = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), benchMat, 4);
    [[-6, 2.8], [6, 2.8], [-6, -2.8], [6, -2.8]].forEach(([dx, dz], i) => {
      m4.makeScale(1.8, 0.5, 0.6); m4.setPosition(cx + dx, 1.05, cz + dz);
      benches.setMatrixAt(i, m4);
    });
    park.add(benches);
    group.add(park);
  }

  // Stadion Teluk: open bowl (outer wall + stands ring + green field),
  // four floodlight poles at the corners.
  if (byId.stadium) {
    const lm = byId.stadium;
    const cx = lm.cx, cz = lm.cz;
    const st = new THREE.Group();
    st.name = 'stadium';
    const concMat = new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 1, side: THREE.DoubleSide });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(13.5, 13.5, 5, 28, 1, true), concMat);
    wall.position.set(cx, 3.0, cz);
    wall.castShadow = true;
    st.add(wall);
    const inner = new THREE.Mesh(
      new THREE.CylinderGeometry(10, 10, 2.6, 28, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x9a9080, roughness: 1, side: THREE.DoubleSide }),
    );
    inner.position.set(cx, 1.8, cz);
    st.add(inner);
    const field = new THREE.Mesh(
      new THREE.CircleGeometry(10, 28),
      new THREE.MeshStandardMaterial({ color: 0x3f8a4a, roughness: 1 }),
    );
    field.rotation.x = -Math.PI / 2;
    field.position.set(cx, 0.62, cz);
    field.receiveShadow = true;
    st.add(field);
    const stands = new THREE.Mesh(
      new THREE.RingGeometry(10, 13.2, 28),
      new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 1, side: THREE.DoubleSide }),
    );
    stands.rotation.x = -Math.PI / 2;
    stands.position.set(cx, 2.6, cz);
    st.add(stands);
    floodMat = new THREE.MeshStandardMaterial({
      color: 0xfff2c8, emissive: 0xffd98a, emissiveIntensity: 0, roughness: 0.4,
    });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.6, metalness: 0.4 });
    for (const [dx, dz] of [[-11, -11], [11, -11], [-11, 11], [11, 11]]) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.3, 8, 0.3), poleMat);
      pole.position.set(cx + dx, 4.5, cz + dz);
      st.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.6), floodMat);
      head.position.set(cx + dx, 8.7, cz + dz);
      st.add(head);
    }
    group.add(st);
  }
}

export function sync(state, dt) {
  const clock = state && Number.isFinite(state.clock) ? state.clock : 0;
  const night = nightFactor(clock);
  if (beaconMat) {
    const t = state && Number.isFinite(state.time) ? state.time : 0;
    beaconMat.emissiveIntensity = 0.4 + night * 3.0 + Math.sin(t * 2.5) * 0.5;
  }
  if (floodMat) floodMat.emissiveIntensity = night * 2.5;
}
