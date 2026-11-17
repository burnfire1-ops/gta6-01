// Teluk Cahaya — vehicle meshes (render view of core/vehicles.js).
// Parametric rig per car: body + cabin + 4 wheels + lights. Police get a
// two-tone livery and a blinking lightbar, taxis a roof sign. Geometries and
// colour-independent materials are shared across every vehicle to keep draw
// calls and GPU memory low. Per-vehicle state (position, heading, wheel spin,
// damage dent) is copied from state.vehicles each frame.
import * as THREE from 'three';

let scene = null;

// Shared geometry: built once, reused by every vehicle rig.
const GEO = {};
// Shared materials for colour-independent parts.
const MAT = {};

function buildShared() {
  GEO.body = new THREE.BoxGeometry(1.9, 0.65, 4.2);
  GEO.cabin = new THREE.BoxGeometry(1.65, 0.55, 2.0);
  GEO.hood = new THREE.BoxGeometry(1.7, 0.16, 1.1);
  GEO.wheel = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12);
  GEO.headlight = new THREE.BoxGeometry(0.38, 0.18, 0.08);
  GEO.taillight = new THREE.BoxGeometry(0.38, 0.16, 0.08);
  GEO.sign = new THREE.BoxGeometry(0.9, 0.22, 0.5);
  GEO.bar = new THREE.BoxGeometry(0.55, 0.16, 0.32);
  GEO.panel = new THREE.BoxGeometry(1.7, 0.14, 1.0);
  MAT.glass = new THREE.MeshStandardMaterial({ color: 0x1a2733, roughness: 0.25, metalness: 0.4, flatShading: true });
  MAT.tyre = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95, flatShading: true });
  MAT.hub = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.6, flatShading: true });
  MAT.head = new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xffedb0, emissiveIntensity: 1.6, roughness: 0.4 });
  MAT.tail = new THREE.MeshStandardMaterial({ color: 0x7a1010, emissive: 0xd41a1a, emissiveIntensity: 1.2, roughness: 0.4 });
  MAT.black = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.6, flatShading: true });
  MAT.sign = new THREE.MeshStandardMaterial({ color: 0xf2c14e, emissive: 0xc89010, emissiveIntensity: 0.8, roughness: 0.5 });
  MAT.barRed = new THREE.MeshStandardMaterial({ color: 0x8a0f0f, emissive: 0xff1a1a, emissiveIntensity: 0.2, roughness: 0.4 });
  MAT.barBlue = new THREE.MeshStandardMaterial({ color: 0x0f1a8a, emissive: 0x1a3aff, emissiveIntensity: 0.2, roughness: 0.4 });
}

function bodyMaterial(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.25, flatShading: true });
}

// Build one vehicle rig and return its root group. Per-vehicle handles live
// in group.userData: bodyGroup for roll/pitch, hood for the damage dent,
// wheels for steer + spin, bodyMat for disposal.
export function createVehicleMesh(vehicle) {
  const g = new THREE.Group();
  const bodyMat = bodyMaterial(vehicle.color);
  const bodyGroup = new THREE.Group();
  g.add(bodyGroup);

  const body = new THREE.Mesh(GEO.body, bodyMat);
  body.position.y = 0.62;
  body.castShadow = true;
  bodyGroup.add(body);

  const cabin = new THREE.Mesh(GEO.cabin, MAT.glass);
  cabin.position.set(0, 1.18, -0.25);
  cabin.castShadow = true;
  bodyGroup.add(cabin);

  // Hood: its own mesh so a hard-hit car can show a dented bonnet.
  const hood = new THREE.Mesh(GEO.hood, bodyMat);
  hood.position.set(0, 0.96, 1.45);
  bodyGroup.add(hood);

  // Headlights at the front (local +z), taillights at the rear (local -z).
  for (const sx of [-0.62, 0.62]) {
    const hl = new THREE.Mesh(GEO.headlight, MAT.head);
    hl.position.set(sx, 0.62, 2.11);
    bodyGroup.add(hl);
    const tl = new THREE.Mesh(GEO.taillight, MAT.tail);
    tl.position.set(sx, 0.62, -2.11);
    bodyGroup.add(tl);
  }

  if (vehicle.type === 'taksi') {
    const sign = new THREE.Mesh(GEO.sign, MAT.sign);
    sign.position.set(0, 1.56, -0.25);
    bodyGroup.add(sign);
  }
  if (vehicle.type === 'patroli') {
    // Two-tone livery: black hood + trunk panels over the white body.
    for (const pz of [1.45, -1.55]) {
      const panel = new THREE.Mesh(GEO.panel, MAT.black);
      panel.position.set(0, 0.96, pz);
      bodyGroup.add(panel);
    }
    // Lightbar: red left, blue right; the blink alternates in sync().
    const barR = new THREE.Mesh(GEO.bar, MAT.barRed);
    barR.position.set(-0.35, 1.52, -0.25);
    const barB = new THREE.Mesh(GEO.bar, MAT.barBlue);
    barB.position.set(0.35, 1.52, -0.25);
    bodyGroup.add(barR, barB);
    g.userData.lightbar = { red: MAT.barRed, blue: MAT.barBlue };
  }

  // Wheels: steer pivot (front only) -> spin pivot -> tyre + hub.
  const wheels = [];
  for (const [wx, wz, front] of [[-0.88, 1.35, true], [0.88, 1.35, true], [-0.88, -1.35, false], [0.88, -1.35, false]]) {
    const steerPivot = new THREE.Group();
    steerPivot.position.set(wx, 0.36, wz);
    const spin = new THREE.Group();
    const tyre = new THREE.Mesh(GEO.wheel, MAT.tyre);
    tyre.rotation.z = Math.PI / 2; // cylinder axis -> along x (the axle)
    tyre.castShadow = true;
    spin.add(tyre);
    steerPivot.add(spin);
    g.add(steerPivot);
    wheels.push({ steerPivot, spin, front });
  }

  g.userData.bodyGroup = bodyGroup;
  g.userData.hood = hood;
  g.userData.wheels = wheels;
  g.userData.bodyMat = bodyMat;
  g.userData.spinAngle = 0;
  g.userData.prevSpeed = 0;
  g.userData.pitchSmooth = 0;
  return g;
}

const rigs = new Map(); // vehicle id -> root group

export function init(ctx) {
  scene = ctx.scene;
  buildShared();
}

export function sync(state, dt) {
  if (!scene) return;
  const alive = new Set();
  const t = state.time || 0;
  // Police lightbar: red/blue alternate ~4 Hz; the shared materials blink
  // in sync for every patrol car.
  const phase = Math.floor(t * 4) % 2 === 0;
  MAT.barRed.emissiveIntensity = phase ? 2.6 : 0.15;
  MAT.barBlue.emissiveIntensity = phase ? 0.15 : 2.6;

  for (const v of state.vehicles) {
    alive.add(v.id);
    let g = rigs.get(v.id);
    if (!g) {
      g = createVehicleMesh(v);
      rigs.set(v.id, g);
      scene.add(g);
    }
    g.position.set(v.x, 0, v.z);
    g.rotation.y = v.heading;

    // Wheels: front yaw follows steer, all four spin with road speed.
    const spinDelta = (v.speed * dt) / 0.36;
    g.userData.spinAngle += spinDelta;
    for (const w of g.userData.wheels) {
      if (w.front) w.steerPivot.rotation.y = v.steer * 0.8;
      w.spin.rotation.x = g.userData.spinAngle;
    }

    // Body roll into corners plus a touch of pitch from acceleration.
    const speedF = Math.min(1, Math.abs(v.speed) / 15);
    const accel = dt > 0 ? (v.speed - g.userData.prevSpeed) / dt : 0;
    g.userData.prevSpeed = v.speed;
    g.userData.pitchSmooth += (Math.max(-1, Math.min(1, -accel * 0.02)) - g.userData.pitchSmooth) * Math.min(1, 6 * dt);
    g.userData.bodyGroup.rotation.z = -v.steer * speedF * 0.05;
    g.userData.bodyGroup.rotation.x = g.userData.pitchSmooth * 0.03;

    // Damage: the hood dents once health drops below 40.
    const dent = v.health < 40 ? (1 - v.health / 40) : 0;
    g.userData.hood.scale.y = 1 - dent * 0.5;
    g.userData.hood.rotation.x = dent * 0.22;
    g.visible = true;
  }

  // Drop rigs for vehicles that no longer exist.
  for (const [id, g] of rigs) {
    if (alive.has(id)) continue;
    rigs.delete(id);
    scene.remove(g);
    if (g.userData.bodyMat) g.userData.bodyMat.dispose();
  }
}
