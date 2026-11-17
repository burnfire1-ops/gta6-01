// Teluk Cahaya — boot, main loop, camera, shot hooks.
// Sim is pure data (src/core); render modules are views. No network, no audio
// files, no Rockstar content: everything is original and procedural.
import * as THREE from 'three';
import { createCity } from './core/city.js';
import { createState } from './core/state.js';
import { clockFromTime, DAY_LENGTH } from './core/clock.js';
import { updatePlayer } from './core/player.js';
import { createInput } from './input/input.js';
import { createRenderer } from './render/renderer.js';
import { createCityRender } from './render/city-render.js';
import { makePerson, syncPerson } from './render/characters-render.js';
import { loadSystems } from './systems.js';

const params = new URLSearchParams(location.search);
const seed = parseInt(params.get('seed') || '1', 10) || 1;
const shot = params.get('shot') || '';

const state = createState(seed);
const city = createCity(seed);
const canvas = document.querySelector('#game');
const { renderer, scene, camera, update: updateLights } = createRenderer(canvas);
const cityRender = createCityRender(scene, city);
const playerMesh = makePerson({ jacket: 0xf2b234, pants: 0x2a3242, skin: 0xc98a5e, cap: 0x1d2f52 });
scene.add(playerMesh);
const input = createInput();
input.attach(canvas);

// Clock starts at 08:00: state.time is session seconds, clock = f(time + offset).
const CLOCK_OFFSET = 0.08 * DAY_LENGTH;
state.clock = clockFromTime(state.time + CLOCK_OFFSET);

const hud = {
  title: document.querySelector('#title'),
  pause: document.querySelector('#pause'),
  hud: document.querySelector('#hud'),
  toast: document.querySelector('#toast'),
};
let toastT = null;
function showToast(text) {
  hud.toast.textContent = text;
  hud.toast.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => hud.toast.classList.remove('show'), 2200);
}

function startGame() {
  state.mode = 'playing';
  hud.title.classList.add('hidden');
  hud.pause.classList.add('hidden');
  hud.hud.classList.remove('hidden');
  state.events.emit('gameStarted', {});
  canvas.focus();
}
function quitToTitle() {
  state.mode = 'title';
  hud.title.classList.remove('hidden');
  hud.hud.classList.add('hidden');
  hud.pause.classList.add('hidden');
}
// Menu buttons are wired by ui/menus.js (systems registry). Fallback wiring
// below runs only if the menus slice is absent, so the title screen always works.
let systemsHandle = null;
function wireFallbackMenus() {
  document.querySelector('#btn-new').addEventListener('click', startGame);
  document.querySelector('#btn-resume').addEventListener('click', () => {
    state.mode = 'playing';
    hud.pause.classList.add('hidden');
  });
  document.querySelector('#btn-quit').addEventListener('click', quitToTitle);
  document.querySelectorAll('[data-todo]').forEach((el) => {
    el.addEventListener('click', () => showToast('Segera hadir di build berikutnya.'));
  });
}

// Third-person camera: orbit by mouse (drag or pointer lock), spring-arm style
// pull-in when a building blocks the view. Driving switches to chase camera.
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  const p = state.player;
  const smooth = 1 - Math.exp(-10 * dt);
  if (state.mode === 'title') {
    const t = state.time * 0.02;
    camera.position.set(Math.sin(t) * 150, 70, Math.cos(t) * 150);
    camera.lookAt(0, 0, -40);
    camera.fov = 55;
    camera.updateProjectionMatrix();
    return;
  }
  let yaw, pitch, dist;
  if (!p.onFoot && p.vehicleId !== null) {
    const v = state.vehicles.find((x) => x.id === p.vehicleId);
    if (v) {
      const fovT = Math.min(1, Math.abs(v.speed) / 30);
      camera.fov += ((58 + fovT * 10) - camera.fov) * smooth;
      camera.updateProjectionMatrix();
      yaw = Math.atan2(Math.sin(v.heading), Math.cos(v.heading));
      pitch = 0.22; dist = 11;
      camTarget.set(v.x + Math.sin(v.heading) * 8, 1.6, v.z + Math.cos(v.heading) * 8);
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      const pos = camTarget.clone().addScaledVector(dir, -dist);
      pos.y = Math.max(1.2, pos.y);
      camera.position.lerp(pos, smooth);
      camera.lookAt(camTarget);
      return;
    }
  }
  camera.fov += (60 - camera.fov) * smooth;
  camera.updateProjectionMatrix();
  yaw = input.camYaw; pitch = input.camPitch; dist = input.camDist;
  const vx = p.vx || 0, vz = p.vz || 0;
  camTarget.set(p.x + vx * 0.25, 1.7 + p.y, p.z + vz * 0.25);
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  // Spring arm: step the distance down until the camera is out of buildings.
  let pos = null;
  for (const d of [dist, 6, 4, 2.5]) {
    const tryPos = camTarget.clone().addScaledVector(dir, -d);
    tryPos.y = Math.max(0.8, tryPos.y);
    const c = city.collideCircle(tryPos.x, tryPos.z, 1);
    if (!c.hit || d === 2.5) { pos = tryPos; break; }
  }
  camera.position.lerp(pos, smooth);
  camera.lookAt(camTarget);
}

// Shot hooks (?shot=name&seed=N): deterministic scene setups for screenshots.
function applyShot(name) {
  if (name === 'start') { state.mode = 'title'; return; }
  if (name === 'night') {
    state.time = (0.62 * DAY_LENGTH) - CLOCK_OFFSET; // ~21:00 neon district
    state.player.x = 200; state.player.z = -160; state.player.heading = Math.PI;
    input.camYaw = Math.PI;
    startGame();
    return;
  }
  if (name === 'chase' || name === 'hud') {
    // Police + missions slices implement these; fall back to the cover setup.
    console.warn(`shot "${name}" not implemented yet, falling back to cover`);
  }
  // cover (default): 10:00 on the boulevard, Raka walking west down the
  // street, sunlit facades ahead, glass tower behind the camera view.
  state.time = (0.167 * DAY_LENGTH) - CLOCK_OFFSET; // ~10:00
  state.player.x = -40; state.player.z = -200;
  state.player.heading = -Math.PI / 2;
  input.camYaw = -Math.PI / 2;
  startGame();
}

const timer = new THREE.Timer();
let frames = 0, shotFrames = 0, fpsEma = 60, lastFpsT = performance.now();
function loop() {
  timer.update();
  const dt = Math.min(Math.max(timer.getDelta(), 0), 0.1);
  state.time += dt;
  state.clock = clockFromTime(state.time + CLOCK_OFFSET);
  if (state.mode === 'playing') {
    input.update(state.settings);
    if (input.actions.pause) {
      state.mode = 'paused';
      hud.pause.classList.add('hidden');
      hud.pause.classList.remove('hidden');
    } else {
      updatePlayer(state, input, dt, city);
      if (systemsHandle) systemsHandle.update(state, input, dt);
    }
  }
  updateCamera(dt);
  updateLights(state);
  cityRender.sync(state);
  if (systemsHandle) systemsHandle.sync(state, dt);
  state.events.emit('frame', { dt });
  syncPerson(playerMesh, state.player.x, state.player.y, state.player.z,
    state.player.heading, state.player.speed || 0, dt, state.player.punchT);
  renderer.render(scene, camera);
  frames++; shotFrames++;
  const now = performance.now();
  if (now - lastFpsT > 500) {
    fpsEma = fpsEma * 0.5 + (frames * 1000 / (now - lastFpsT)) * 0.5;
    state.debug.fps = Math.round(fpsEma);
    state.debug.drawCalls = renderer.info.render.calls;
    frames = 0; lastFpsT = now;
  }
  if (shot && shotFrames === 30) window.__shotReady = true;
}

window.addEventListener('error', (e) => { window.__error = String(e.message); });
window.__game = { state, city, renderer, scene, input, startGame, showToast };
window.__version = 'teluk-cahaya-0.1-foundation';

// Load gameplay slices (vehicles, traffic, police, missions, HUD, audio, save)
// if their files exist; missing slices are skipped with a console warning.
loadSystems({ state, city, scene, renderer, camera, input, startGame, quitToTitle, showToast })
  .then((handle) => {
    systemsHandle = handle;
    window.__systems = handle;
    if (!handle.loaded.has('menus')) wireFallbackMenus();
    // Deferred shot setups (chase/hud) need the missions slice.
    if (shot === 'chase' || shot === 'hud') {
      const missions = handle.loaded.get('missions');
      if (missions?.setupShot) missions.setupShot(shot, state, city, input, startGame);
      else applyShot(shot); // falls back to cover
    }
  });

if (shot && shot !== 'chase' && shot !== 'hud') applyShot(shot);
renderer.setAnimationLoop(loop);
