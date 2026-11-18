
import * as THREE from 'three';
import { CITY, PALETTE } from './config.js';
import { districtAt } from './road-graph.js';

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function win(g, c, r, cols, rows, w, h) {
  g.fillRect(10 + c * ((w - 20) / cols) + 3, 18 + r * ((h - 30) / rows) + 3,
    (w - 20) / cols - 6, (h - 30) / rows - 8);
}

function facadeTextures(base, rng, litRatio) {
  const cols = 4 + Math.floor(rng() * 3);
  const rows = 5 + Math.floor(rng() * 4);
  const map = canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, 0, w, 10);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const lit = rng() < litRatio;
        g.fillStyle = lit ? '#ffe9a8' : '#23414f';
        win(g, c, r, cols, rows, w, h);
      }
    }
  });
  const emissiveMap = canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, w, h);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (rng() < litRatio) {
          g.fillStyle = '#ffd27a';
          win(g, c, r, cols, rows, w, h);
        }
      }
    }
  });
  return { map, emissiveMap };
}

function roadTexture() {
  const tex = canvasTexture(128, 32, (g, w, h) => {
    g.fillStyle = '#333a4a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#f4f1e6';
    g.fillRect(8, h / 2 - 2, 44, 4);
    g.fillRect(76, h / 2 - 2, 44, 4);
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function buildCity(scene, graph, rng) {
  const colliders = [];
  const lamps = [];
  const group = new THREE.Group();
  group.name = 'city';
  scene.add(group);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.size + 40, CITY.size + 40),
    new THREE.MeshStandardMaterial({ color: 0xc9d6a0, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(320, CITY.size + 120),
    new THREE.MeshStandardMaterial({ color: PALETTE.tealSea, roughness: 0.35, metalness: 0.05 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(CITY.seaEdgeX - 160, -0.25, 0);
  group.add(sea);

  const beach = new THREE.Mesh(
    new THREE.PlaneGeometry(14, CITY.size + 40),
    new THREE.MeshStandardMaterial({ color: PALETTE.sand, roughness: 1 }),
  );
  beach.rotation.x = -Math.PI / 2;
  beach.position.set(CITY.seaEdgeX - 5, 0.02, 0);
  group.add(beach);

  const asphaltTex = roadTexture();
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: PALETTE.sidewalk, roughness: 1 });
  for (const edge of graph.edges) {
    const a = graph.nodeById.get(edge.a);
    const b = graph.nodeById.get(edge.b);
    const len = edge.length;
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const angle = Math.atan2(b.x - a.x, b.z - a.z);
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(11, len), sidewalkMat);
    walk.rotation.x = -Math.PI / 2;
    walk.rotation.z = -angle;
    walk.position.set(mx, 0.03, mz);
    walk.receiveShadow = true;
    group.add(walk);
    const tex = asphaltTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(Math.max(1, Math.round(len / 16)), 1);
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(7.5, len),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }),
    );
    road.rotation.x = -Math.PI / 2;
    road.rotation.z = -angle;
    road.position.set(mx, 0.05, mz);
    road.receiveShadow = true;
    group.add(road);
  }

  const dialects = {
    artdeco: { base: '#ffb08a', hMin: 10, hMax: 22, lit: 0.35, roof: 0xe86a5a },
    neon: { base: '#7fd4d0', hMin: 18, hMax: 38, lit: 0.55, roof: 0xff5da2 },
    port: { base: '#b0a89c', hMin: 8, hMax: 14, lit: 0.25, roof: 0x6b6259 },
    residential: { base: '#ffe8c9', hMin: 8, hMax: 16, lit: 0.4, roof: 0x9fc98a },
  };
  const facadeMats = {};
  for (const [key, d] of Object.entries(dialects)) {
    const { map, emissiveMap } = facadeTextures(d.base, rng, d.lit);
    const mat = new THREE.MeshStandardMaterial({
      map, emissiveMap, emissive: 0xffd27a, emissiveIntensity: 0, roughness: 0.85,
    });
    mat.userData.glow = true;
    const roofMat = new THREE.MeshStandardMaterial({ color: d.roof, roughness: 0.9 });
    facadeMats[key] = { mat, roofMat, hMin: d.hMin, hMax: d.hMax };
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const roofGeo = new THREE.BoxGeometry(1, 1, 1);

  const half = CITY.half;
  const spacing = CITY.roadSpacing;
  for (let bz = -half + spacing / 2; bz < half; bz += spacing) {
    for (let bx = -half + spacing / 2; bx < half; bx += spacing) {
      const district = districtAt(bx, bz);
      const d = facadeMats[district];
      const count = rng() < 0.3 ? 2 : 1;
      for (let i = 0; i < count; i += 1) {
        const ox = count === 1 ? 0 : (i === 0 ? -8 : 8);
        const oz = count === 1 ? 0 : (i === 0 ? -7 : 7);
        const w = 12 + rng() * 10;
        const dep = 12 + rng() * 8;
        const h = d.hMin + rng() * (d.hMax - d.hMin);
        const x = bx + ox;
        const z = bz + oz;
        if (Math.abs(x) < 26 && Math.abs(z) < 26) continue;
        const mesh = new THREE.Mesh(boxGeo, d.mat);
        mesh.scale.set(w, h, dep);
        mesh.position.set(x, h / 2, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        const roof = new THREE.Mesh(roofGeo, d.roofMat);
        roof.scale.set(w + 0.8, 0.8, dep + 0.8);
        roof.position.set(x, h + 0.4, z);
        group.add(roof);
        colliders.push({ x, z, r: Math.max(w, dep) * 0.62 });
      }
    }
  }

  const towerMat = new THREE.MeshStandardMaterial({
    color: PALETTE.glassTeal, roughness: 0.25, metalness: 0.4,
    emissive: 0xffd27a, emissiveIntensity: 0,
  });
  towerMat.userData.glow = true;
  const tower = new THREE.Mesh(boxGeo, towerMat);
  tower.scale.set(22, 72, 22);
  tower.position.set(20, 36, -20);
  tower.castShadow = true;
  group.add(tower);
  const towerTopMat = new THREE.MeshStandardMaterial({ color: PALETTE.neonPink, emissive: PALETTE.neonPink, emissiveIntensity: 0.4 });
  towerTopMat.userData.glow = true;
  const towerTop = new THREE.Mesh(boxGeo, towerTopMat);
  towerTop.scale.set(24, 2, 24);
  towerTop.position.set(20, 73, -20);
  group.add(towerTop);
  colliders.push({ x: 20, z: -20, r: 16 });

  const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x8a7f72, roughness: 0.9 });
  const bridge = new THREE.Mesh(boxGeo, bridgeMat);
  bridge.scale.set(84, 1.2, 10);
  bridge.position.set(-260, 1.2, 120);
  bridge.castShadow = true;
  group.add(bridge);
  for (const dz of [-5.4, 5.4]) {
    const rail = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.6 }));
    rail.scale.set(84, 1, 0.4);
    rail.position.set(-260, 2.2, 120 + dz);
    group.add(rail);
  }
  const island = new THREE.Mesh(
    new THREE.CylinderGeometry(16, 20, 2, 10),
    new THREE.MeshStandardMaterial({ color: PALETTE.sand, roughness: 1 }),
  );
  island.position.set(-300, -0.4, 120);
  group.add(island);

  const lighthouse = new THREE.Group();
  lighthouse.position.set(-300, 1, 120);
  const lhBase = new THREE.Mesh(
    new THREE.CylinderGeometry(3.2, 4.2, 18, 10),
    new THREE.MeshStandardMaterial({ color: 0xfff6e8, roughness: 0.8 }),
  );
  lhBase.position.y = 9;
  lhBase.castShadow = true;
  lighthouse.add(lhBase);
  const lhStripe = new THREE.Mesh(
    new THREE.CylinderGeometry(3.55, 3.8, 3, 10),
    new THREE.MeshStandardMaterial({ color: 0xe86a5a, roughness: 0.8 }),
  );
  lhStripe.position.y = 11;
  lighthouse.add(lhStripe);
  const lhLampMat = new THREE.MeshStandardMaterial({
    color: 0xfff2b0, emissive: 0xffe9a8, emissiveIntensity: 1.2,
  });
  lhLampMat.userData.glow = true;
  const lhLamp = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 10), lhLampMat);
  lhLamp.position.y = 19;
  lighthouse.add(lhLamp);
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(4, 34, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xfff2b0, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  beam.rotation.z = Math.PI / 2;
  beam.position.set(18, 19, 0);
  beam.userData.spinBeam = true;
  lighthouse.add(beam);
  group.add(lighthouse);
  colliders.push({ x: -300, z: 120, r: 7 });

  const palmSpots = [];
  for (const edge of graph.edges) {
    const a = graph.nodeById.get(edge.a);
    const b = graph.nodeById.get(edge.b);
    if (rng() < 0.55) {
      const t = 0.25 + rng() * 0.5;
      const px = a.x + (b.x - a.x) * t;
      const pz = a.z + (b.z - a.z) * t;
      const side = rng() < 0.5 ? 5.6 : -5.6;
      const along = Math.atan2(b.x - a.x, b.z - a.z);
      palmSpots.push({ x: px + Math.cos(along) * side, z: pz - Math.sin(along) * side });
    }
  }
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.35, 4.5, 6);
  const crownGeo = new THREE.IcosahedronGeometry(2.1, 0);
  crownGeo.scale(1, 0.45, 1);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 1 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x3f9e57, roughness: 1, flatShading: true });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, Math.max(1, palmSpots.length));
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, Math.max(1, palmSpots.length));
  const m4 = new THREE.Matrix4();
  palmSpots.forEach((p, i) => {
    m4.makeTranslation(p.x, 2.25, p.z);
    trunks.setMatrixAt(i, m4);
    m4.makeTranslation(p.x, 4.9, p.z);
    crowns.setMatrixAt(i, m4);
  });
  trunks.castShadow = true;
  crowns.castShadow = true;
  group.add(trunks);
  group.add(crowns);

  const lampHeadMat = new THREE.MeshStandardMaterial({
    color: 0xfff2b0, emissive: 0xffe9a8, emissiveIntensity: 0,
  });
  lampHeadMat.userData.glow = true;
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 5.2, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c3444, roughness: 0.7, metalness: 0.4 });
  const lampNodes = graph.nodes.filter((nd, i) => i % 2 === 0 && nd.x > -220);
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, Math.max(1, lampNodes.length));
  const headGeo = new THREE.SphereGeometry(0.42, 8, 6);
  lampNodes.forEach((nd, i) => {
    const lx = nd.x + 4.6;
    const lz = nd.z + 4.6;
    m4.makeTranslation(lx, 2.6, lz);
    poles.setMatrixAt(i, m4);
    const head = new THREE.Mesh(headGeo, lampHeadMat);
    head.position.set(lx, 5.3, lz);
    group.add(head);
    lamps.push(head);
  });
  group.add(poles);

  const benchMat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 1 });
  for (let i = 0; i < 10; i += 1) {
    const bench = new THREE.Mesh(boxGeo, benchMat);
    bench.scale.set(2.4, 0.5, 0.9);
    bench.position.set(-200 + i * 40, 0.55, -84.5);
    group.add(bench);
  }
  const signTex = canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#ffd166';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#101a33';
    g.font = 'bold 34px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('TC', w / 2, h / 2 + 12);
  });
  for (const [sx, sz] of [[-180, -180], [180, -180], [-180, 180], [180, 180], [0, 0]]) {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.scale.set(1, 0.6, 1);
    pole.position.set(sx + 4.6, 1.6, sz + 4.6);
    group.add(pole);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshStandardMaterial({ map: signTex, side: THREE.DoubleSide, roughness: 0.8 }),
    );
    sign.position.set(sx + 4.6, 3.6, sz + 4.6);
    group.add(sign);
  }

  const neonMat = new THREE.MeshStandardMaterial({
    color: PALETTE.neonPink, emissive: PALETTE.neonPink, emissiveIntensity: 0,
  });
  neonMat.userData.glow = true;
  for (let i = 0; i < 14; i += 1) {
    const strip = new THREE.Mesh(boxGeo, neonMat);
    strip.scale.set(10 + rng() * 8, 0.5, 0.5);
    strip.position.set(20 + rng() * 180, 6 + rng() * 18, -200 + rng() * 20);
    group.add(strip);
  }

  return { colliders, landmarks: { tower, lighthouse, bridge }, lamps };
}
