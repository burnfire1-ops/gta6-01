// Teluk Cahaya — combat render slice (view of core/combat.js).
// One dark-red person rig per enemy (makePerson/syncPerson from the shared
// characters rig), a 'down' enemy lies flat for 5 s, and a small crosshair
// div appears only while aiming on foot. This is the only DOM this slice
// creates; every other HUD element belongs to the HUD slice.
import * as THREE from 'three';
import { makePerson, syncPerson } from './characters-render.js';

let scene = null;
let crosshair = null;
let crosshairDot = null;
let crosshairRing = null;

// id -> THREE.Group
const meshes = new Map();

const SKINS = [0xc98a5e, 0x8a5a3a, 0xe8b88a, 0x6a4530];
const ENEMY_JACKET = 0x7a1f24; // dark red: enemies read apart from peds
const ENEMY_PANTS = 0x26262e;
const ENEMY_CAP = 0x3a0d0d;

function buildCrosshair() {
  const hud = document.querySelector('#hud');
  if (!hud || crosshair) return;
  crosshair = document.createElement('div');
  crosshair.id = 'crosshair';
  crosshair.style.position = 'absolute';
  crosshair.style.left = '50%';
  crosshair.style.top = '50%';
  crosshair.style.width = '26px';
  crosshair.style.height = '26px';
  crosshair.style.margin = '-13px 0 0 -13px';
  crosshair.style.pointerEvents = 'none';
  crosshair.style.display = 'none';
  crosshairDot = document.createElement('div');
  crosshairDot.style.position = 'absolute';
  crosshairDot.style.left = '50%';
  crosshairDot.style.top = '50%';
  crosshairDot.style.width = '4px';
  crosshairDot.style.height = '4px';
  crosshairDot.style.margin = '-2px 0 0 -2px';
  crosshairDot.style.borderRadius = '50%';
  crosshairDot.style.background = '#fff';
  crosshairRing = document.createElement('div');
  crosshairRing.style.position = 'absolute';
  crosshairRing.style.left = '0';
  crosshairRing.style.top = '0';
  crosshairRing.style.width = '22px';
  crosshairRing.style.height = '22px';
  crosshairRing.style.border = '2px solid #fff';
  crosshairRing.style.borderRadius = '50%';
  crosshairRing.style.opacity = '0.9';
  crosshair.appendChild(crosshairRing);
  crosshair.appendChild(crosshairDot);
  hud.appendChild(crosshair);
}

export function init(ctx) {
  scene = ctx.scene;
  buildCrosshair();
}

export function sync(state, dt) {
  if (!scene) return;

  // Crosshair: only while aiming on foot in play; yellow when locked on.
  if (crosshair) {
    const show = state.mode === 'playing' && !!state.aiming
      && !!state.player && state.player.onFoot;
    crosshair.style.display = show ? 'block' : 'none';
    if (show) {
      const locked = state.aimTarget != null;
      const color = locked ? '#ffd23a' : '#ffffff';
      crosshairDot.style.background = color;
      crosshairRing.style.borderColor = color;
    }
  }

  const seen = new Set();
  for (const e of state.enemies || []) {
    seen.add(e.id);
    let group = meshes.get(e.id);
    if (!group) {
      group = makePerson({
        jacket: ENEMY_JACKET,
        pants: ENEMY_PANTS,
        skin: SKINS[e.id % SKINS.length],
        cap: ENEMY_CAP,
      });
      scene.add(group);
      meshes.set(e.id, group);
    }
    syncPerson(group, e.x, 0, e.z, e.heading, e.speed || 0, dt, e.punchT || 0);
    // Down enemies lie flat on their back until the core removes them.
    group.rotation.x = e.state === 'down' ? -Math.PI / 2 : 0;
  }
  // Remove meshes for enemies the core dropped (down timer expired / cleared).
  for (const [id, group] of meshes) {
    if (!seen.has(id)) {
      scene.remove(group);
      meshes.delete(id);
    }
  }
}
