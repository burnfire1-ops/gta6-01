
import * as THREE from 'three';
import { MISSIONS, SEED } from './config.js';
import { createRandom } from './random.js';
import { createRoadGraph } from './road-graph.js';
import { buildCity } from './city.js';
import { createDayNight } from './day-night.js';
import {
  ACTION_ATTACK,
  ACTION_CONFIRM,
  ACTION_INTERACT,
  ACTION_JUMP,
  ACTION_MAP,
  ACTION_PAUSE,
  createInput,
} from './input.js';
import { createPlayer } from './player.js';
import { createChaseCamera } from './camera.js';
import { createVehicleFleet } from './vehicles.js';
import { createTraffic } from './traffic.js';
import { createPedestrians } from './pedestrians.js';
import { createPolice } from './police-pursuit.js';
import { createMissions } from './missions.js';
import { createPackages } from './packages.js';
import { createBigMap } from './bigmap.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createSaveSystem } from './save.js';
import { stageShot } from './shots.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);
const rng = createRandom(seed || SEED);

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const status = $('status');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 900);
camera.position.set(0, 6, -12);

const graph = createRoadGraph();
const city = buildCity(scene, graph, rng);
const dayNight = createDayNight(scene);
const input = createInput(canvas);
const player = createPlayer(scene, graph, rng);
const chaseCamera = createChaseCamera(camera);
const fleet = createVehicleFleet(scene, graph, rng);
const traffic = createTraffic(scene, graph, fleet, rng);
const pedestrians = createPedestrians(scene, graph, rng);
const police = createPolice(scene, graph, fleet, rng);
const hud = createHud();
const audio = createAudio();
const saveSystem = createSaveSystem();
// Satu ctx untuk semua subsistem.
// missions DULU menerima objek lain tanpa money/toast/input/timeHours/scene,
// getter baru dipanggil saat permainan jalan, setelah `game` ada.
const ctx = {
  player,
  fleet,
  police,
  traffic,
  pedestrians,
  graph,
  city,
  scene,
  dayNight,
  input,
  save: saveSystem,
  cameraYaw: 0,
  interactPressed: false,
  toast: (m) => hud.toast(m),
  get money() { return game.state.money; },
  set money(v) { game.state.money = v; },
  get timeHours() {
    return dayNight.timeHours;
  },
};
const missions = createMissions(ctx);
ctx.missions = missions;
const packages = createPackages(scene, graph, rng);
const bigMap = createBigMap($('bigmap'));

const game = {
  player,
  police,
  vehicles: fleet,
  traffic,
  pedestrians,
  missions,
  packages,
  graph,
  dayNight,
  hud,
  city,
  scene,
  camera,
  renderer,
  seed,
  state: { wanted: 0, money: MISSIONS.startMoney, health: player.health },
};
window.__game = game;
window.__shotReady = false;
window.__renderer = renderer;

function announce(message) {
  if (status) status.textContent = message;
}

let screen = 'title';
let lastObjective = '';
let last = performance.now();

function showScreen(name) {
  screen = name;
  const gameoverMenu = $('menu-gameover');
  if (gameoverMenu) gameoverMenu.style.display = name === 'gameover' ? 'flex' : 'none';
  const mapMenu = $('menu-map');
  if (mapMenu) {
    mapMenu.style.display = name === 'map' ? 'flex' : 'none';
    mapMenu.classList.toggle('open', name === 'map');
  }
  if (name === 'play') hud.hideMenus();
  else hud.showMenu(name === 'title' ? 'title' : name === 'paused' ? 'pause' : 'none');
}

function drawMap() {
  bigMap.draw({
    graph,
    playerPos: player.pos,
    playerHeading: player.heading,
    missionMarker: missions.markerPos || null,
    packages: packages.markers(),
    police: police.units || [],
    wanted: game.state.wanted,
  });
}

function startGame(fresh) {
  if (fresh) {
    game.state.money = MISSIONS.startMoney;
    player.health = 100;
    player.armor = 0;
    if (missions.reset) missions.reset();
    if (police.reset) police.reset();
    packages.reset();
  } else {
    const saved = saveSystem.load(1);
    if (saved) {
      if (typeof saved.money === 'number') game.state.money = saved.money;
      if (typeof saved.health === 'number') player.health = saved.health;
      if (typeof saved.timeHours === 'number') dayNight.setTime(saved.timeHours);
      if (missions.loadState) missions.loadState(saved);
      if (Array.isArray(saved.packages)) packages.loadCollected(saved.packages);
    }
  }
  audio.ensure();
  showScreen('play');
  announce('Bermain di Teluk Cahaya.');
  chaseCamera.snapTo({ pos: player.pos, heading: player.heading }, 'foot');
}

function endGame(reason) {
  const fine = Math.min(game.state.money, MISSIONS.fineOnCaught);
  game.state.money -= fine;
  const text = $('gameover-text');
  if (text) {
    text.textContent = reason === 'caught'
      ? `Polisi menangkap Raka. Denda Rp ${fine.toLocaleString('id-ID')} — wanted bersih, mulai lagi dari kantor polisi.`
      : `Raka pingsan dan bangun di titik aman. Denda Rp ${fine.toLocaleString('id-ID')} untuk biaya rumah sakit.`;
  }
  player.health = 100;
  if (police.reset) police.reset();
  showScreen('gameover');
  announce('Game over.');
}

function handleActions(actions) {
  if (actions & ACTION_MAP) {
    if (screen === 'play') {
      showScreen('map');
      drawMap();
      announce('Peta Teluk Cahaya.');
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    } else if (screen === 'map') {
      showScreen('play');
      announce('Lanjut.');
    }
    return;
  }
  if (actions & ACTION_PAUSE) {
    if (screen === 'play') {
      showScreen('paused');
      announce('Jeda.');
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    } else if (screen === 'paused') {
      showScreen('play');
      announce('Lanjut.');
    } else if (screen === 'map') {
      showScreen('play');
      announce('Lanjut.');
    }
    return;
  }
  if (screen === 'title' && (actions & (ACTION_CONFIRM | ACTION_JUMP))) startGame(true);
  else if (screen === 'gameover' && (actions & (ACTION_CONFIRM | ACTION_JUMP))) startGame(true);
  else if (screen === 'paused' && (actions & ACTION_CONFIRM)) showScreen('play');
}

function handleInteract() {
  if (player.onFoot) {
    const car = fleet.nearestCar(player.pos, 4);
    if (car) {
      if (player.enterCar(car)) {
        audio.blip();
        hud.toast(`Masuk ${car.name || car.type || 'mobil'}`);
      }
      return;
    }
  } else if (player.exitCar()) {
    audio.blip();
    hud.toast('Keluar dari mobil');
  }
}

function step(dt) {
  const actions = input.takeActions();
  input._actions = actions;
  ctx.interactPressed = Boolean(actions & ACTION_INTERACT);
  ctx.cameraYaw = chaseCamera.yaw;

  handleActions(actions);
  if (screen === 'title') {
    const t = performance.now() * 0.00002;
    camera.position.set(Math.sin(t) * 120, 55, Math.cos(t) * 120);
    camera.lookAt(0, 8, 0);
    input.resetMouse();
    return;
  }
  if (screen !== 'play') {
    input.resetMouse();
    return;
  }
  if (actions & ACTION_INTERACT) handleInteract();
  if (actions & ACTION_ATTACK) player.attack();

  player.update(dt, input, ctx);
  fleet.update(dt, ctx);
  if (!player.onFoot && player.currentCar) {
    player.pos.x = player.currentCar.pos?.x ?? player.currentCar.x ?? player.pos.x;
    player.pos.z = player.currentCar.pos?.z ?? player.currentCar.z ?? player.pos.z;
    player.heading = player.currentCar.heading ?? player.heading;
    player.speed = Math.abs(player.currentCar.speed ?? 0);
  }
  traffic.update(dt, ctx);
  pedestrians.update(dt, ctx);
  police.update(dt, ctx);
  missions.update(dt, ctx);
  packages.update(dt, ctx);
  dayNight.update(dt);

  const mode = player.onFoot ? 'foot' : 'drive';
  chaseCamera.update(dt, {
    pos: player.pos,
    heading: player.heading,
    speed: player.speed,
    colliders: city.colliders,
  }, mode, input.mouseDX, input.mouseDY);
  input.resetMouse();

  game.state.wanted = police.wanted ?? 0;
  game.state.health = player.health;
  if (player.health <= 0) {
    endGame(game.state.wanted > 0 ? 'caught' : 'down');
    return;
  }
  const objective = missions.objectiveText || '';
  if (objective !== lastObjective) {
    lastObjective = objective;
    hud.setObjective(objective);
  }
  hud.update({
    wanted: game.state.wanted,
    wantedEscaping: police.wantedEscaping,
    money: game.state.money,
    health: player.health,
    armor: player.armor,
    speed: player.speed,
    vehicle: player.currentCar ? (player.currentCar.name || player.currentCar.type) : null,
    vehicleHealth: player.currentCar?.health,
    objective,
    timeHours: dayNight.timeHours,
    isNight: dayNight.isNight(),
    playerPos: player.pos,
    playerHeading: player.heading,
    graph,
    police: police.units || [],
    missionMarker: missions.markerPos || null,
    packages: packages.markers(),
    packagesCount: packages.count(),
  });

  if (audio.setEngine) {
    const rpm = player.onFoot ? 0 : Math.min(1, player.speed / 38);
    audio.setEngine(rpm);
  }
  if (audio.siren) audio.siren(game.state.wanted > 0);
  if (audio.setMood) audio.setMood(game.state.wanted > 0 ? 'tense' : (missions.active ? 'mission' : 'calm'));
}

function frame(now) {
  const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05);
  last = now;
  step(dt);
  renderer.render(scene, camera);
}

function runShot(name) {
  let staged = null;
  try {
    staged = stageShot(name, game);
  } catch (err) {
    console.error('stageShot failed:', err);
  }
  if (staged && staged.screen === 'gameover') showScreen('gameover');
  else showScreen(staged && staged.screen === 'title' ? 'title' : 'play');
  let painted = 0;
  function paint() {
    dayNight.update(0);
    renderer.render(scene, camera);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const bind = (id, fn) => {
    const el = $(id);
    if (el) el.addEventListener('click', fn);
  };
  bind('btn-new', () => startGame(true));
  bind('btn-continue', () => startGame(false));
  bind('btn-resume', () => showScreen('play'));
  bind('btn-save', () => {
    saveSystem.save(1, {
      money: game.state.money,
      health: player.health,
      timeHours: dayNight.timeHours,
      mission: missions.active,
      packages: packages.collectedIds(),
      pos: player.pos,
    });
    hud.toast('Disimpan ke slot 1');
  });
  bind('btn-quit', () => showScreen('title'));
  bind('btn-quit2', () => showScreen('title'));
  bind('btn-restart', () => startGame(true));

  const continueBtn = $('btn-continue');
  if (continueBtn && !saveSystem.hasSave(1)) continueBtn.disabled = true;

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === 'play') showScreen('paused');
  });

  showScreen('title');
  announce('Teluk Cahaya. Tekan Enter atau New Game untuk mulai.');
  renderer.setAnimationLoop(frame);
}

if (shot) runShot(shot);
else runGame();
