import * as THREE from 'three';
import { CITY } from './config.js';

const TOTAL = 8;
const REWARD = 150;
const RADIUS = 2.5;
const DISTRICTS = ['artdeco', 'neon', 'port', 'residential'];

export function createPackages(scene, graph, rng) {
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
  const rand = typeof rng === 'function' ? rng : Math.random;
  const items = [];
  const used = new Set();
  // Offset diagonal 4,6: paket di sudut trotoar; node tepi (±220) dikecualikan.
  const EDGE = CITY.half - 20;
  for (const d of DISTRICTS) {
    const pool = nodes.filter((n) => n.district === d
      && Math.abs(n.x) < EDGE && Math.abs(n.z) < EDGE);
    for (let k = 0; k < 2 && pool.length; k++) {
      let n = null;
      for (let t = 0; t < 8; t++) {
        const c = pool[Math.floor(rand() * pool.length)];
        if (!used.has(c.id)) { n = c; break; }
      }
      if (!n) continue;
      used.add(n.id);
      items.push({ id: items.length,
        x: n.x + (rand() < 0.5 ? -4.6 : 4.6), z: n.z + (rand() < 0.5 ? -4.6 : 4.6),
        group: null, taken: false });
    }
  }

  function buildMesh(it) {
    if (!scene || typeof scene.add !== 'function') return;
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.6),
      new THREE.MeshStandardMaterial({ color: 0xf2c94c, emissive: 0xffc400, emissiveIntensity: 1.4 }));
    box.position.y = 0.5;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 5, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xf2c94c, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.y = 2.5;
    g.add(box, beam);
    g.position.set(it.x, 0, it.z);
    scene.add(g);
    it.group = g;
  }
  for (const it of items) buildMesh(it);

  const collected = new Set();

  function collect(it, ctx) {
    it.taken = true;
    collected.add(it.id);
    if (it.group) it.group.visible = false;
    if (ctx && typeof ctx.money === 'number') ctx.money += REWARD;
    if (ctx && typeof ctx.toast === 'function') ctx.toast(`Paket tersembunyi +Rp ${REWARD} (${collected.size}/${TOTAL})`);
  }

  function update(dt, ctx) {
    const p = ctx && ctx.player;
    if (!p || !p.pos || !p.onFoot) return;
    for (const it of items) {
      if (!it.taken && Math.hypot(p.pos.x - it.x, p.pos.z - it.z) < RADIUS) collect(it, ctx);
    }
  }

  function reset() {
    collected.clear();
    for (const it of items) { it.taken = false; if (it.group) it.group.visible = true; }
  }

  function loadCollected(ids) {
    reset();
    if (!Array.isArray(ids)) return;
    for (const id of ids) {
      const it = items.find((i) => i.id === id);
      if (it) { it.taken = true; collected.add(it.id); if (it.group) it.group.visible = false; }
    }
  }

  return {
    update,
    reset,
    loadCollected,
    collectedIds() { return [...collected].sort((a, b) => a - b); },
    count() { return collected.size; },
    total: TOTAL,
    markers() { return items.filter((i) => !i.taken).map(({ x, z }) => ({ x, z })); },
  };
}
