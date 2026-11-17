// City rendering: instanced buildings, palms, lamps, roads from a canvas
// texture, water, seawall and lighthouse. All assets procedural from the
// same seed as the sim city. Meshes are views of core/city.js data.
import * as THREE from 'three';
import { makeRng } from '../core/rng.js';
import { nightFactor } from '../core/clock.js';
import { HALF, SPACING } from '../core/city.js';

function facadeTextures(seed) {
  // Day map: light base + dark windows; emissive map: only lit windows glow.
  const rng = makeRng(seed * 7 + 3);
  const day = document.createElement('canvas'); day.width = 128; day.height = 256;
  const emi = document.createElement('canvas'); emi.width = 128; emi.height = 256;
  const d = day.getContext('2d'), e = emi.getContext('2d');
  d.fillStyle = '#efe8da'; d.fillRect(0, 0, 128, 256);
  e.fillStyle = '#000000'; e.fillRect(0, 0, 128, 256);
  d.fillStyle = '#e0d4c0'; d.fillRect(0, 0, 128, 10); // cornice
  for (let row = 0; row < 11; row++) {
    for (let col = 0; col < 5; col++) {
      const x = 11 + col * 23, y = 18 + row * 21;
      const lit = rng.chance(0.4);
      d.fillStyle = lit ? '#ffd98a' : '#3a4a63';
      d.fillRect(x, y, 11, 12);
      if (lit) { e.fillStyle = '#ffbe5a'; e.fillRect(x, y, 11, 12); }
    }
  }
  const dayTex = new THREE.CanvasTexture(day);
  dayTex.colorSpace = THREE.SRGBColorSpace;
  const emiTex = new THREE.CanvasTexture(emi);
  emiTex.colorSpace = THREE.SRGBColorSpace;
  return { dayTex, emiTex };
}

function groundTexture(city) {
  const S = 1024, W = 560; // world -280..280 maps to 0..1024
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  const toPx = (v) => ((v + W / 2) / W) * S;
  const px = S / W; // px per unit
  g.fillStyle = '#2e3442'; g.fillRect(0, 0, S, S); // navy asphalt roads
  // Sidewalk colour only inside each block (inset 5 units, matching the slabs);
  // the 10-unit bands along grid lines stay asphalt road.
  g.fillStyle = '#c9b6a4';
  for (const b of city.blocks) {
    g.fillRect(toPx(b.cx - 15), toPx(b.cz - 15), 30 * px, 30 * px);
  }
  // Road centre dashes (yellow) along every grid line.
  g.fillStyle = '#f2c14e';
  for (let v = -HALF; v <= HALF; v += SPACING) {
    for (let u = -HALF; u < HALF; u += 8) {
      g.fillRect(toPx(u), toPx(v) - 0.4 * px, 4 * px, 0.8 * px);
      g.fillRect(toPx(v) - 0.4 * px, toPx(u), 0.8 * px, 4 * px);
    }
  }
  // Crosswalks at major intersections.
  g.fillStyle = '#e8e8e8';
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

export function createCityRender(scene, city) {
  const group = new THREE.Group();
  group.name = 'city';
  scene.add(group);

  // Ground with procedural road texture.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(560, 560),
    new THREE.MeshStandardMaterial({ map: groundTexture(city), roughness: 0.9, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Raised sidewalk slabs (one instanced mesh for all blocks).
  const slabGeo = new THREE.BoxGeometry(30, 0.5, 30);
  const slabMat = new THREE.MeshStandardMaterial({ color: 0xd8c8b4, roughness: 0.95 });
  const slabs = new THREE.InstancedMesh(slabGeo, slabMat, city.blocks.length);
  const m4 = new THREE.Matrix4();
  city.blocks.forEach((b, i) => {
    m4.makeTranslation(b.cx, 0.25, b.cz);
    slabs.setMatrixAt(i, m4);
  });
  slabs.receiveShadow = true;
  group.add(slabs);

  // Buildings: facade instanced mesh + glass instanced mesh.
  const { dayTex, emiTex } = facadeTextures(city.seed);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  const facadeMat = new THREE.MeshStandardMaterial({
    map: dayTex, emissiveMap: emiTex, emissive: 0xffffff, emissiveIntensity: 0,
    roughness: 0.85, metalness: 0.05,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    map: dayTex, emissiveMap: emiTex, emissive: 0xffffff, emissiveIntensity: 0,
    color: 0x9adfe0, roughness: 0.25, metalness: 0.25,
  });
  const facadeList = city.buildings.filter((b) => !b.glass);
  const glassList = city.buildings.filter((b) => b.glass);
  const facadeMesh = new THREE.InstancedMesh(boxGeo, facadeMat, Math.max(1, facadeList.length));
  const glassMesh = new THREE.InstancedMesh(boxGeo, glassMat, Math.max(1, glassList.length));
  const col = new THREE.Color();
  facadeList.forEach((b, i) => {
    m4.makeScale(b.w, b.h, b.d);
    m4.setPosition(b.x, 0.5, b.z);
    facadeMesh.setMatrixAt(i, m4);
    facadeMesh.setColorAt(i, col.setHex(b.color));
  });
  glassList.forEach((b, i) => {
    m4.makeScale(b.w, b.h, b.d);
    m4.setPosition(b.x, 0.5, b.z);
    glassMesh.setMatrixAt(i, m4);
    glassMesh.setColorAt(i, col.setHex(b.color));
  });
  facadeMesh.castShadow = true; facadeMesh.receiveShadow = true;
  glassMesh.castShadow = true; glassMesh.receiveShadow = true;
  group.add(facadeMesh); group.add(glassMesh);

  // Palms along the boulevard streets.
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

  // Street lamps at major intersections (emissive heads glow at night).
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

  // Sea + seawall + lighthouse.
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

  function sync(state) {
    const night = nightFactor(state.clock);
    facadeMat.emissiveIntensity = night * 0.9;
    glassMat.emissiveIntensity = night * 1.1;
    headMat.emissiveIntensity = night * 3.0;
    lhLampMat.emissiveIntensity = 1.0 + night * 1.5 + Math.sin(state.time * 2) * 0.4;
  }
  return { group, sync };
}
