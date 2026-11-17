// Low-poly people: one shared rig (torso, head, arms, legs) with procedural
// walk/punch animation from speed. Player, pedestrians and police share it.
import * as THREE from 'three';

export function makePerson({ jacket = 0xf2b234, pants = 0x2a3242, skin = 0xc98a5e, cap = 0x1d2f52 } = {}) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.36), mat(jacket));
  torso.position.y = 1.12;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), mat(skin));
  head.position.y = 1.72;
  const capMesh = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.46), mat(cap));
  capMesh.position.y = 1.96;
  const armL = new THREE.Group(); armL.position.set(-0.38, 1.42, 0);
  const armR = new THREE.Group(); armR.position.set(0.38, 1.42, 0);
  const armGeo = new THREE.BoxGeometry(0.2, 0.62, 0.2);
  armGeo.translate(0, -0.31, 0);
  armL.add(new THREE.Mesh(armGeo, mat(jacket)));
  armR.add(new THREE.Mesh(armGeo, mat(jacket)));
  const legL = new THREE.Group(); legL.position.set(-0.16, 0.78, 0);
  const legR = new THREE.Group(); legR.position.set(0.16, 0.78, 0);
  const legGeo = new THREE.BoxGeometry(0.24, 0.78, 0.24);
  legGeo.translate(0, -0.39, 0);
  legL.add(new THREE.Mesh(legGeo, mat(pants)));
  legR.add(new THREE.Mesh(legGeo, mat(pants)));
  g.add(torso, head, capMesh, armL, armR, legL, legR);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.parts = { torso, head, armL, armR, legL, legR };
  g.userData.phase = Math.random() * Math.PI * 2;
  return g;
}

export function syncPerson(mesh, x, y, z, heading, speed, dt, punchT = 0) {
  mesh.position.set(x, y, z);
  mesh.rotation.y = heading;
  const p = mesh.userData.parts;
  const f = Math.min(1, speed / 6);
  mesh.userData.phase += dt * (4 + speed * 1.6);
  const s = Math.sin(mesh.userData.phase) * 0.55 * f;
  p.legL.rotation.x = s;
  p.legR.rotation.x = -s;
  p.armL.rotation.x = -s * 0.8;
  p.armR.rotation.x = s * 0.8;
  if (punchT > 0) {
    // Punch: right arm drives forward.
    const k = Math.sin((0.32 - punchT) / 0.32 * Math.PI);
    p.armR.rotation.x = -1.4 * k;
    p.armL.rotation.x = 0.4 * k;
  }
  // Idle breathing.
  p.torso.position.y = 1.12 + Math.sin(mesh.userData.phase * 0.5) * 0.015;
}
