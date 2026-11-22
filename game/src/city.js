
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
const MM = (o) => new THREE.MeshStandardMaterial(o); // CP24 M2: alias hemat byte

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

function roadTexture(){
 const t=canvasTexture(128,32,(g,w,h)=>{
  g.fillStyle='#333a4a';g.fillRect(0,0,w,h);
  g.fillStyle='#ffd166';g.fillRect(w/2-6,2,4,28);g.fillRect(w/2+2,2,4,28);
  g.fillStyle='#f4f1e6';g.fillRect(2,0,2,h);g.fillRect(w-4,0,2,h);});
 t.wrapS=THREE.RepeatWrapping;t.wrapT=THREE.RepeatWrapping;return t;}

// CP24 M1: 5 blok digusur (Opsi C). Klinik (120,160) tetap — sketsa §3.2 tulis 6/150, salah.
const FACILITIES = { '120,-120': 'mall', '120,120': 'park', '-200,120': 'fair', '-160,80': 'industrial', '-80,-120': 'hospital' };

// Bakar rng() sebanyak cabang generik (1 jumlah + 3/bangunan) — aliran sesudahnya identik.
function burnRngForBlock(rng) {
  const count = rng() < 0.3 ? 2 : 1;
  for (let i = 0; i < count; i += 1) { rng(); rng(); rng(); }
}

const textTex=(w,h,bg,fg,font,txt)=>canvasTexture(w,h,(g)=>{g.fillStyle=bg;g.fillRect(0,0,w,h);g.fillStyle=fg;g.font=font;g.textAlign='center';g.fillText(txt,w/2,h/2+14);});
const F='bold 40px system-ui, sans-serif';
// CP24 M2: Mall Cahaya Plaza (120,-120), 28x22x13, parkir + neon. Tetap, tanpa rng().
function buildMall(group, colliders, boxGeo, neonMat) {
  const glassMat = MM({ color: PALETTE.glassTeal, roughness: 0.15, metalness: 0.6, emissive: 0x19e6d2 });
  glassMat.userData.glow = true; // day-night apply() yang mengatur intensitas (bukan ctor)
  const BM = (mat) => new THREE.Mesh(boxGeo, mat);
  const add = (m, x, y, z, sx, sy, sz) => { m.scale.set(sx, sy, sz); m.position.set(x, y, z); group.add(m); return m; };
  const mall = add(BM(glassMat), 120, 6.5, -124, 28, 13, 22);
  mall.castShadow = true; mall.receiveShadow = true;
  const bandMat = MM({ color: 0x0e2a33, roughness: 0.7 });
  for (const fy of [4.4, 8.8]) add(BM(bandMat), 120, fy, -124, 28.6, 0.4, 22.6);
  add(BM(MM({ color: 0xff1f8a, roughness: 0.9 })), 120, 13.4, -124, 28.8, 0.8, 22.8);
  const signTex = textTex(512, 64, '#101a33', '#ffd166', F, 'CAHAYA PLAZA');
  const signMat = MM({ map: signTex, emissiveMap: signTex, emissive: 0xffffff, roughness: 0.6 });
  signMat.userData.glow = true;
  add(new THREE.Mesh(new THREE.PlaneGeometry(20, 2.5), signMat), 120, 10.5, -112.9, 1, 1, 1);
  add(BM(neonMat), 120, 13.9, -112.8, 28.6, 0.5, 0.5); // strip neon atap
  add(BM(neonMat), 120, 3.4, -112.6, 8, 0.4, 1); // strip neon pintu masuk
  const pTex = textTex(64, 64, '#101a33', '#19e6d2', F, 'P');
  const pMat = MM({ map: pTex, emissiveMap: pTex, emissive: 0xffffff, side: THREE.DoubleSide });
  pMat.userData.glow = true;
  const poleMat = MM({ color: 0x2c3444, roughness: 0.7, metalness: 0.4 });
  for (const px of [106, 134]) {
    add(BM(poleMat), px, 1.5, -104, 0.3, 3, 0.3);
    add(new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), pMat), px, 3.6, -104, 1, 1, 1);
  }
  const lotTex = canvasTexture(128, 64, (g, w, h) => { g.fillStyle = '#2c3140'; g.fillRect(0, 0, w, h); g.fillStyle = '#f4f1e6'; for (let i = 0; i <= 6; i += 1) g.fillRect(4 + i * 20, 6, 2, h - 12); });
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), MM({ map: lotTex, roughness: 0.95 }));
  lot.rotation.x = -Math.PI / 2;
  lot.position.set(120, 0.08, -109);
  lot.receiveShadow = true;
  group.add(lot);
  colliders.push({ x: 120, z: -124, r: 18 });
}

const PARK_TREES = [[108,108],[132,108],[108,132],[112,110],[128,110],[110,128],[124,130],[114,133]];
const FAIR_PALMS = [[-224,104],[-224,118],[-224,132],[-224,142]];
// CP24 M4: taman ria.
function buildFair(g,c,b){
 const A=(mt,x,y,z,sx,sy,sz,rz)=>{const m=new THREE.Mesh(b,mt);m.scale.set(sx,sy,sz);m.position.set(x,y,z);if(rz)m.rotation.z=rz;g.add(m);return m;};
 A(MM({color:0xe8c98a}),-200,0.06,120,30,0.1,30).receiveShadow=true;
 const lm=MM({color:0x8a6a4a,roughness:0.8});
 A(lm,-203.5,5.5,120,1,12.5,1,0.5);A(lm,-196.5,5.5,120,1,12.5,1,-0.5);
 const wh=new THREE.Group();wh.position.set(-200,11,120);wh.userData.spin='z';g.add(wh);
 const rm=MM({color:0xff1f8a,roughness:0.5,emissive:0xff1f8a});rm.userData.glow=true;
 wh.add(new THREE.Mesh(new THREE.TorusGeometry(9,0.35,6,28),rm));
 const sm=MM({color:0xffd166,roughness:0.6});
 for(let i=0;i<4;i++){const s=new THREE.Mesh(b,sm);s.scale.set(0.35,17.6,0.35);s.rotation.z=i*Math.PI/4;wh.add(s);}
 const hb=new THREE.Mesh(new THREE.CylinderGeometry(0.9,0.9,1.4,10),sm);hb.rotation.x=Math.PI/2;wh.add(hb);
 const gc=[0xff5a5a,0xffd166,0x17ddd6,0x2ec96a,0xff8a3d,0x9b5de5,0xffffff,0xff1f8a];
 for(let i=0;i<8;i++){const a=i*Math.PI/4;const k=new THREE.Mesh(b,MM({color:gc[i],roughness:0.6}));k.scale.set(1.8,1.8,1.8);k.position.set(Math.cos(a)*9,Math.sin(a)*9,0);wh.add(k);}
 const cb=new THREE.Mesh(new THREE.CylinderGeometry(4,4.4,0.8,12),MM({color:0xfff2c0,roughness:0.7}));cb.position.set(-188,0.4,108);g.add(cb);
 const ct=new THREE.Group();ct.position.set(-188,0.8,108);ct.userData.spin='y';g.add(ct);
 const cp=new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.3,4.4,8),sm);cp.position.y=2.2;ct.add(cp);
 const rf=new THREE.Mesh(new THREE.ConeGeometry(4.6,2.4,8),MM({color:0xff1f8a,roughness:0.6}));rf.position.y=5.2;ct.add(rf);
 for(let i=0;i<4;i++){const a=i*Math.PI/2;const h=new THREE.Mesh(b,MM({color:gc[i],roughness:0.6}));h.scale.set(0.8,1.6,0.8);h.position.set(Math.cos(a)*2.6,1.6,Math.sin(a)*2.6);ct.add(h);}
 for(const [x,z] of [[-224,110],[-224,126],[-227,138]]){A(MM({color:0x8a6a4a}),x,1,z,0.2,2,0.2);const u=new THREE.Mesh(new THREE.ConeGeometry(1.8,1,8),MM({color:0xff5a5a,roughness:0.7}));u.position.set(x,2.4,z);g.add(u);}
 c.push({x:-200,z:120,r:8},{x:-188,z:108,r:5});
}
// CP24 M3: taman.
function buildPark(g, c, b) {
  const A = (mt, x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(b, mt); m.scale.set(sx, sy, sz); m.position.set(x, y, z); g.add(m); return m; };
  A(MM({ color: 0x58b368 }), 120, 0.06, 120, 29, 0.1, 29).receiveShadow = true;
  for(const [w,d] of [[29,3],[3,29]]) A(MM({ color: 0xd8cfae }), 120, 0.07, 120, w, 0.1, d);
  const gm = MM({ color: 0xfff2c0, emissive: 0xffd27a });
  gm.userData.glow = true;
  A(MM({ color: 0xcfc8b8 }), 120, 1, 120, 6, 2, 6);
  A(gm, 120, 6.5, 120, 2, 9, 2).castShadow = true;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.6, 4), gm);
  tip.position.set(120,12.3,120);g.add(tip);
  for(const [x,z] of [[114,116],[126,116],[114,124],[126,124]]) A(MM({ color: 0x7a5a3a }), x, 0.55, z, 2.4, 0.5, 0.9);
  c.push({x:120,z:120,r:6});
}
// CP24 M5: industri.
function buildInd(g,c,b){
 const A=(mt,x,y,z,sx,sy,sz)=>{const m=new THREE.Mesh(b,mt);m.scale.set(sx,sy,sz);m.position.set(x,y,z);g.add(m);return m;};
 const rm=MM({color:0x3a3a3a});
 A(MM({color:0x9a8f80}),-165,4.5,74,18,9,12).castShadow=true;
 A(rm,-165,9.3,74,18.6,0.6,12.6);
 A(MM({color:0x8f7d68}),-151,3.5,86,11,7,10).castShadow=true;
 A(rm,-151,7.3,86,11.6,0.6,10.6);
 let ch=new THREE.Mesh(new THREE.CylinderGeometry(1.2,1.7,20,10),MM({color:0x9a8a7a}));
 ch.position.set(-172,10,90);g.add(ch);
 ch=new THREE.Mesh(new THREE.CylinderGeometry(1.35,1.35,1.4,10),MM({color:0x2a2a2a}));
 ch.position.set(-172,19.8,90);g.add(ch);
 const cc=[[0xd94f3d,-153,70,1.25],[0x2e7fd9,-149,70,1.25],[0x2ec96a,-153,70,3.75],[0xffd166,-149,77,1.25],[0xff8a3d,-153,77,1.25]];
 for(const [k,x,z,y] of cc)A(MM({color:k}),x,y,z,2.5,2.5,6);
 c.push({x:-160,z:80,r:16});
}

// CP24 M6: RS Teluk Cahaya (-80,-120): gedung putih 4 lantai + salib merah + helipad. Tetap, tanpa rng().
function buildHospital(g,c,b){
 const A=(mt,x,y,z,sx,sy,sz)=>{const m=new THREE.Mesh(b,mt);m.scale.set(sx,sy,sz);m.position.set(x,y,z);g.add(m);return m;};
 const wm=MM({color:0xf5f7f5,roughness:0.85});
 A(wm,-80,8.5,-120,22,17,20).castShadow=true;
 A(MM({color:0xd8d8d8}),-80,17.2,-120,22.6,0.4,20.6);
 const dm=MM({color:0x23414f,roughness:0.7});
 for(let f=0;f<4;f++)A(dm,-80,3+f*4,-109.7,18,1.4,0.2);
 const rm=MM({color:0xd91e1e,roughness:0.6});
 A(rm,-80,11,-109.6,1.4,5.5,0.3);
 A(rm,-80,11,-109.6,5.5,1.4,0.3);
 A(rm,-80,11,-130.4,1.4,5.5,0.3);
 A(rm,-80,11,-130.4,5.5,1.4,0.3);
 A(MM({color:0x2c3140}),-80,17.55,-120,9,0.3,9);
 const hm=MM({color:0xffd166,roughness:0.6});
 A(hm,-81.2,17.85,-120,0.5,0.15,3);
 A(hm,-78.8,17.85,-120,0.5,0.15,3);
 A(hm,-80,17.85,-120,1.9,0.15,0.5);
 c.push({x:-80,z:-120,r:16});
}

// M12: toko+gerobak+billboard.
const SHOPS={'80,-120':['KOPI','#ff8a3d'],'80,120':['WARUNG','#2ec96a'],'-40,-120':['APOTEK','#2e7fd9'],'-120,80':['BENGKEL','#ffd166'],'40,40':['ROTI','#ff5a5a'],'-160,120':['BAR','#9b5de5']};
function buildStreet(g,b){
 const A=(mt,x,y,z,sx,sy,sz)=>{const m=new THREE.Mesh(b,mt);m.scale.set(sx,sy,sz);m.position.set(x,y,z);g.add(m);};
 const dk=MM({color:0x2c3444});
 for(const [x,z] of [[108,-105.8],[128,105.8]]){
  A(MM({color:0x7a5a3a}),x,.7,z,1.8,1,1.2);
  A(MM({color:0xff8a3d}),x,1.5,z,2,.15,1.4);
  A(dk,x,.3,z,1.65,.6,.25);
 }
 const t=textTex(512,128,'#101a33','#ffd166','bold 64px system-ui, sans-serif','TELUK CAHAYA');
 const bm=MM({map:t,emissiveMap:t,emissive:0xffffff});bm.userData.glow=true;
 for(const px of [142,146])A(dk,px,2.5,-105.5,.4,5,.4);
 const p=new THREE.Mesh(new THREE.PlaneGeometry(10,2.5),bm);p.position.set(144,6.5,-105.5);g.add(p);
}

export function buildCity(scene, graph, rng) {
  const colliders = [];
  const lamps = [];
  const group = new THREE.Group();
  group.name = 'city';
  scene.add(group);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.size + 40, CITY.size + 40),
    new THREE.MeshStandardMaterial({ color: 0xa8d64e, roughness: 1 }),
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
    // CP24 M11: boulevard 13 m di ruas depan mall (z=-100), taman (z=100/140),
    // bibir pantai (x=-220); ruas lain tetap 11 m.
    const B = (mz === -100 || mz === 100 || mz === 140) && mx >= 100 && mx <= 140 || mx === -220;
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(B ? 13 : 11, len), sidewalkMat);
    walk.rotation.x = -Math.PI / 2;
    walk.rotation.z = -angle;
    walk.position.set(mx, 0.03, mz);
    walk.receiveShadow = true;
    group.add(walk);
    const tex = asphaltTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(1, Math.max(1, Math.round(len / 16)));
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(9.5, len),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }),
    );
    road.rotation.x = -Math.PI / 2;
    road.rotation.z = -angle;
    road.position.set(mx, 0.05, mz);
    road.receiveShadow = true;
    group.add(road);
  }

  const dialects = {
    artdeco: { base: '#ff9e57', hMin: 10, hMax: 22, lit: 0.35, roof: 0xff4b2e },
    neon: { base: '#17ddd6', hMin: 18, hMax: 38, lit: 0.55, roof: 0xff1f8a },
    port: { base: '#c99a5f', hMin: 8, hMax: 14, lit: 0.25, roof: 0x7a4a2e },
    residential: { base: '#ffd27a', hMin: 8, hMax: 16, lit: 0.4, roof: 0x2ec96a },
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
  // CP24 M2: strip neon dipakai mall + blok tetangga + 14 strip lama.
  const neonMat = new THREE.MeshStandardMaterial({
    color: PALETTE.neonPink, emissive: PALETTE.neonPink, emissiveIntensity: 0,
  });
  neonMat.userData.glow = true;

  const half = CITY.half;
  const spacing = CITY.roadSpacing;
  for (let bz = -half + spacing / 2; bz < half; bz += spacing) {
    for (let bx = -half + spacing / 2; bx < half; bx += spacing) {
      const kind = FACILITIES[`${bx},${bz}`];
      if (kind) { burnRngForBlock(rng); if (kind === 'mall') buildMall(group, colliders, boxGeo, neonMat); if (kind === 'park') buildPark(group, colliders, boxGeo); if (kind === 'fair') buildFair(group, colliders, boxGeo); if (kind === 'industrial') buildInd(group, colliders, boxGeo); if (kind === 'hospital') buildHospital(group, colliders, boxGeo); continue; }
      const district = districtAt(bx, bz);
      const d = facadeMats[district];
      const count = rng() < 0.3 ? 2 : 1;
      for (let i = 0; i < count; i += 1) {
        const ox = count === 1 ? 0 : (i === 0 ? -6 : 6);
        const oz = count === 1 ? 0 : (i === 0 ? -5 : 5);
        const w = 12 + rng() * Math.min(10, 12 - 2 * Math.abs(ox));
        const dep = 12 + rng() * Math.min(8, 12 - 2 * Math.abs(oz));
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
        // CP24 M2: neon di fasad selatan bangunan blok tetangga mall (80/160,-120).
        if (bz === -120 && (bx === 80 || bx === 160)) {
          const ns = new THREE.Mesh(boxGeo, neonMat);
          ns.scale.set(w * 0.8, 0.5, 0.5); ns.position.set(x, h - 1.2, z + dep / 2 + 0.3); group.add(ns);
        }
        const sh = SHOPS[`${bx},${bz}`];
        if (sh && !i) { const t = textTex(256, 64, '#101a33', sh[1], F, sh[0]); const sm = MM({ map: t, emissiveMap: t, emissive: 0xffffff }); sm.userData.glow = true; const s = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.6), sm); s.position.set(x,3.4,z+dep/2+.15); group.add(s); }
        colliders.push({ x, z, r: Math.max(w, dep) * 0.62 });
      }
    }
  }
  buildStreet(group, boxGeo);

  const towerMat = new THREE.MeshStandardMaterial({
    color: PALETTE.glassTeal, roughness: 0.25, metalness: 0.4,
    emissive: 0xffd27a, emissiveIntensity: 0,
  });
  towerMat.userData.glow = true;
  const tower = new THREE.Mesh(boxGeo, towerMat);
  tower.scale.set(22, 72, 22);
  tower.position.set(0, 36, 0);
  tower.castShadow = true;
  group.add(tower);
  const towerTopMat = new THREE.MeshStandardMaterial({ color: PALETTE.neonPink, emissive: PALETTE.neonPink, emissiveIntensity: 0.4 });
  towerTopMat.userData.glow = true;
  const towerTop = new THREE.Mesh(boxGeo, towerTopMat);
  towerTop.scale.set(24, 2, 24);
  towerTop.position.set(0, 73, 0);
  group.add(towerTop);
  colliders.push({ x: 0, z: 0, r: 16 });

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
    if (rng() < 0.75) {
      const t = 0.25 + rng() * 0.5;
      const px = a.x + (b.x - a.x) * t;
      const pz = a.z + (b.z - a.z) * t;
      const side = rng() < 0.5 ? 5.6 : -5.6;
      const along = Math.atan2(b.x - a.x, b.z - a.z);
      palmSpots.push({ x: px + Math.cos(along) * side, z: pz - Math.sin(along) * side });
    }
  }
  for (const [x, z] of PARK_TREES) palmSpots.push({ x, z });
  for (const [x, z] of FAIR_PALMS) palmSpots.push({ x, z });
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.35, 4.5, 6);
  const crownGeo = new THREE.IcosahedronGeometry(2.1, 0);
  crownGeo.scale(1, 0.45, 1);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 1 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x0ec957, roughness: 1, flatShading: true });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, Math.max(1, palmSpots.length));
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, Math.max(1, palmSpots.length));
  const m4 = new THREE.Matrix4();
  palmSpots.forEach((p, i) => {
    const hide = p.x > 105 && p.x < 135 && p.z > -115 && p.z < -103; // CP24 M2: palem di lot mall dibenam
    m4.makeTranslation(p.x, hide ? -10 : 2.25, p.z);
    trunks.setMatrixAt(i, m4);
    m4.makeTranslation(p.x, hide ? -10 : 4.9, p.z);
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
  for (const [sx, sz] of [[-180, -180], [180, -180], [-180, 180], [180, 180], [20, 20]]) {
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

  for (let i = 0; i < 14; i += 1) {
    const strip = new THREE.Mesh(boxGeo, neonMat);
    strip.scale.set(10 + rng() * 8, 0.5, 0.5);
    strip.position.set(20 + rng() * 180, 6 + rng() * 18, -200 + rng() * 20);
    group.add(strip);
  }

  return { colliders, landmarks: { tower, lighthouse, bridge }, lamps, facilities: FACILITIES };
}
