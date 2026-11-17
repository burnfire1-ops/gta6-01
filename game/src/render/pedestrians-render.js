// Teluk Cahaya — pedestrian meshes (render view of core/pedestrians.js).
// One shared person rig per ped (makePerson/syncPerson from the shared
// characters rig), coloured from fixed palettes by ped id. A yellow "!"
// octahedron bobs above a ped that is reporting a crime, so the player can
// read the witness fairly.
import * as THREE from 'three';
import { makePerson, syncPerson } from './characters-render.js';

let scene = null;
let timeAcc = 0;

const JACKETS = [0xd84a4a, 0x4a7ad8, 0x4ad87a, 0xd8b84a, 0x8a4ad8, 0xd87a4a, 0x4ad8c8, 0x9a9a9a];
const PANTS = [0x2a3242, 0x3a3a3a, 0x4a3a2a, 0x2a4a3a, 0x5a5a6a];
const SKINS = [0xc98a5e, 0x8a5a3a, 0xe8b88a, 0x6a4530];
const CAPS = [0x1d2f52, 0x7a2f2f, 0x2f6b4f, 0x8a6a3a, 0x3a3a3a];

let markGeo = null;
let markMat = null;

// id -> { group, mark }
const meshes = new Map();

export function init(ctx) {
  scene = ctx.scene;
  timeAcc = 0;
  if (!markGeo) {
    markGeo = new THREE.OctahedronGeometry(0.22);
    markMat = new THREE.MeshStandardMaterial({
      color: 0xffd23a, emissive: 0xffc800, emissiveIntensity: 1.4, roughness: 0.4,
    });
  }
}

export function sync(state, dt) {
  if (!scene) return;
  timeAcc += dt;
  const seen = new Set();
  for (const ped of state.peds) {
    seen.add(ped.id);
    let entry = meshes.get(ped.id);
    if (!entry) {
      const group = makePerson({
        jacket: JACKETS[ped.id % JACKETS.length],
        pants: PANTS[ped.id % PANTS.length],
        skin: SKINS[ped.id % SKINS.length],
        cap: CAPS[ped.id % CAPS.length],
      });
      const mark = new THREE.Mesh(markGeo, markMat);
      mark.position.y = 2.35;
      mark.visible = false;
      group.add(mark);
      scene.add(group);
      entry = { group, mark };
      meshes.set(ped.id, entry);
    }
    // Walk speed drives the rig's phase (panic speed 7 = visibly faster).
    syncPerson(entry.group, ped.x, 0, ped.z, ped.heading, ped.speed, dt);
    // Reporting witness: yellow "!" bobbing and spinning above the head.
    const reporting = ped.reportT > 0;
    entry.mark.visible = reporting;
    if (reporting) {
      entry.mark.position.y = 2.35 + Math.sin(timeAcc * 5 + ped.id * 1.7) * 0.12;
      entry.mark.rotation.y += dt * 2;
    }
  }
  // Drop meshes for peds that despawned.
  for (const [id, entry] of meshes) {
    if (!seen.has(id)) {
      scene.remove(entry.group);
      meshes.delete(id);
    }
  }
}
