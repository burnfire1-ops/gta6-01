// Teluk Cahaya — mission markers (render view of core/missions.js).
// Reads only plain sim state each frame and copies it onto meshes: a tall
// pulsing yellow beacon (transparent cylinder + ground ring + floating
// diamond) at state.mission.marker, and a purple-ringed yellow "!" over the
// mission giver while no mission is active. three.js lives ONLY in this
// file; the sim never imports it.
import * as THREE from 'three';

const BEACON_YELLOW = 0xf2c14e;
const GIVER_PURPLE = 0xc98ae0; // matches the minimap's giver diamond

let sceneRef = null;
let cityRef = null;
let beacon = null;      // THREE.Group: cylinder + ring + diamond
let beaconRing = null;
let beaconDiamond = null;
let beaconMat = null;
let ringMat = null;
let giverMark = null;   // THREE.Group: "!" sprite + ground ring
let giverSprite = null;
let animT = 0;
let lastMarkerKey = '';

function makeBeacon() {
  const group = new THREE.Group();
  const geoCyl = new THREE.CylinderGeometry(2.2, 2.2, 24, 16, 1, true);
  beaconMat = new THREE.MeshBasicMaterial({
    color: BEACON_YELLOW, transparent: true, opacity: 0.16,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const cyl = new THREE.Mesh(geoCyl, beaconMat);
  cyl.position.y = 12;
  group.add(cyl);
  const geoRing = new THREE.RingGeometry(2.0, 3.0, 32);
  ringMat = new THREE.MeshBasicMaterial({
    color: BEACON_YELLOW, transparent: true, opacity: 0.85,
    side: THREE.DoubleSide, depthWrite: false,
  });
  beaconRing = new THREE.Mesh(geoRing, ringMat);
  beaconRing.rotation.x = -Math.PI / 2;
  beaconRing.position.y = 0.15;
  group.add(beaconRing);
  const geoDia = new THREE.OctahedronGeometry(0.9);
  const diaMat = new THREE.MeshBasicMaterial({ color: BEACON_YELLOW });
  beaconDiamond = new THREE.Mesh(geoDia, diaMat);
  beaconDiamond.position.y = 4.2;
  group.add(beaconDiamond);
  group.visible = false;
  return group;
}

function makeBangTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = '#f2c14e';
  g.strokeStyle = '#3a2a00';
  g.lineWidth = 10;
  g.lineJoin = 'round';
  g.font = '900 96px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.strokeText('!', 64, 68);
  g.fillText('!', 64, 68);
  return new THREE.CanvasTexture(c);
}

function makeGiverMark() {
  const group = new THREE.Group();
  const tex = makeBangTexture();
  const mat = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
  });
  giverSprite = new THREE.Sprite(mat);
  giverSprite.scale.set(4, 4, 1);
  giverSprite.position.y = 4.5;
  group.add(giverSprite);
  const geoRing = new THREE.RingGeometry(1.6, 2.4, 32);
  const ringMat2 = new THREE.MeshBasicMaterial({
    color: GIVER_PURPLE, transparent: true, opacity: 0.8,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const ring = new THREE.Mesh(geoRing, ringMat2);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.15;
  group.add(ring);
  group.visible = false;
  return group;
}

export function init(ctx) {
  sceneRef = ctx.scene;
  cityRef = ctx.city;
  beacon = makeBeacon();
  sceneRef.add(beacon);
  giverMark = makeGiverMark();
  sceneRef.add(giverMark);
}

export function sync(state, dt) {
  if (!sceneRef || !state) return;
  animT += dt || 0;
  const m = state.mission || {};
  const marker = m.marker
    && Number.isFinite(m.marker.x) && Number.isFinite(m.marker.z)
    ? m.marker : null;

  // --- mission beacon ------------------------------------------------------
  if (marker) {
    const key = marker.x + ',' + marker.z;
    if (!beacon.visible || key !== lastMarkerKey) {
      // New or teleported marker: snap straight to it.
      beacon.position.set(marker.x, 0, marker.z);
      lastMarkerKey = key;
    } else {
      // Follow a moving marker (mission 5 chase target) smoothly.
      beacon.position.x += (marker.x - beacon.position.x) * Math.min(1, 8 * (dt || 0));
      beacon.position.z += (marker.z - beacon.position.z) * Math.min(1, 8 * (dt || 0));
    }
    beacon.visible = true;
    const pulse = 0.5 + 0.5 * Math.sin(animT * 3);
    const s = 1 + pulse * 0.3;
    beaconRing.scale.set(s, s, 1);
    if (ringMat) ringMat.opacity = 0.55 + pulse * 0.35;
    if (beaconMat) beaconMat.opacity = 0.12 + pulse * 0.08;
    beaconDiamond.position.y = 4.2 + Math.sin(animT * 2) * 0.5;
    beaconDiamond.rotation.y = animT * 1.5;
  } else {
    beacon.visible = false;
    lastMarkerKey = '';
  }

  // --- mission giver "!" (only while no mission is active) -----------------
  const done = Array.isArray(m.completed) ? m.completed.length : 0;
  const giver = cityRef && cityRef.pois && cityRef.pois.missionGiver;
  if (!m.active && done < 8 && giver) {
    giverMark.visible = true;
    giverMark.position.set(giver.x, 0, giver.z);
    giverSprite.position.y = 4.5 + Math.sin(animT * 2) * 0.4;
  } else {
    giverMark.visible = false;
  }
}
