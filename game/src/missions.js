// dan beacon kuning;
import * as THREE from 'three';
import { buildWalkerMesh } from './pedestrians.js';

const REWARDS = [200, 150, 250, 300, 400, 450, 500, 1000];

function isNight(timeHours) {
  if (typeof timeHours !== 'number') return false;
  return timeHours >= 18 || timeHours < 6;
}

function readInteract(input) {
  if (!input || typeof input !== 'object') return false;
  if (input.interact || input.action || input.use) return true;
  const keys = input.keys;
  if (!keys) return false;
  if (typeof keys.has === 'function') return keys.has('KeyF');
  if (Array.isArray(keys)) return keys.includes('KeyF');
  return !!keys.KeyF;
}

export function createMissions(ctx) {
  const graph = ctx && ctx.graph;
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];

  function pickNode(keywords, fallbackIdx) {
    if (keywords.includes('boulevard')) {
      const st = nodes.find((n) => n.policeStation);
      if (st) return { x: st.x, z: st.z };
      let best = null;
      let bestD = Infinity;
      for (const n of nodes) {
        if (n.district !== 'artdeco') continue;
        const d = (n.x + 20) ** 2 + (n.z + 20) ** 2;
        if (d < bestD) { bestD = d; best = n; }
      }
      if (best) return { x: best.x, z: best.z };
    }
    for (const n of nodes) {
      const d = typeof n.district === 'string' ? n.district.toLowerCase() : '';
      if (keywords.some((k) => d.includes(k))) return { x: n.x, z: n.z };
    }
    if (nodes.length) {
      const n = nodes[Math.min(fallbackIdx, nodes.length - 1)];
      return { x: n.x, z: n.z };
    }
    return { x: 0, z: 0 };
  }

  function farthestNode(from) {
    let best = null;
    let bestD = -1;
    for (const n of nodes) {
      const d = Math.hypot(n.x - from.x, n.z - from.z);
      if (d > bestD) { bestD = d; best = n; }
    }
    return best ? { x: best.x, z: best.z } : { x: 100, z: 100 };
  }

  const port = pickNode(['pelabuhan', 'port', 'harbour', 'industri', 'industrial'], 2);
  const boulevard = pickNode(['boulevard'], 0);
  const neon = pickNode(['neon'], 1);
  const hill = pickNode(['bukit', 'residential', 'hill'], 3);

  const list = [
    { index: 0, title: 'Paket Pertama', desc: 'Antar paket dari pelabuhan dengan mobil pinjaman. Berkendara ke marker kuning.', reward: REWARDS[0], district: 'Pelabuhan', targetPos: port },
    { index: 1, title: 'Mobil Sendiri', desc: 'Curi mobil dari jalan, lalu bawa ke marker di Boulevard. Mobil terkunci butuh saksi yang tidak melihat.', reward: REWARDS[1], district: 'Boulevard', targetPos: boulevard },
    { index: 2, title: 'Lolos Patroli', desc: 'Patroli mengejarmu di wanted 2. Putus garis pandang dan kabur sampai wanted 0.', reward: REWARDS[2], district: 'Boulevard', targetPos: boulevard },
    { index: 3, title: 'Antar Malam', desc: 'Antar paket lewat Distrik Neon. Paket hanya diterima saat malam (18:00-06:00).', reward: REWARDS[3], district: 'Neon', targetPos: neon },
    { index: 4, title: 'Kejar Target', desc: 'Target kabur dengan mobil. Tabrak mobilnya sampai hancur (health 0).', reward: REWARDS[4], district: 'Pelabuhan', targetPos: port },
    { index: 5, title: 'Gudang Pelabuhan', desc: 'Masuk gudang dan kalahkan 3 penjaga. Dekati penjaga lalu tekan F untuk memukul.', reward: REWARDS[5], district: 'Pelabuhan', targetPos: port },
    { index: 6, title: 'Konvoi Tiga Titik', desc: 'Lewati 3 checkpoint sebelum waktu habis: Boulevard, Neon, Pelabuhan.', reward: REWARDS[6], district: 'Teluk Cahaya', targetPos: boulevard },
    { index: 7, title: 'Pelarian Final', desc: 'Lintasi kota dengan wanted 5 dan capai ujung kota. Semua sistem sekaligus.', reward: REWARDS[7], district: 'Bukit', targetPos: hill },
  ];

  const state = {
    active: null,
    completed: new Set(),
    objectiveText: 'Pilih misi dari daftar. Free roam selalu terbuka.',
    beacon: null,
    beaconLight: null,
    beaconT: 0,
    prevInteract: false,
  };

  function ensureBeacon() {
    if (state.beacon) return state.beacon;
    const scene = ctx && ctx.scene;
    if (!scene || typeof scene.add !== 'function') return null;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffd23f, emissive: 0xffc400, emissiveIntensity: 1.6,
      transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false,
    });
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 7, 16, 1, true), mat);
    beacon.visible = false;
    const light = new THREE.PointLight(0xffd23f, 30, 32);
    light.position.y = 4;
    beacon.add(light);
    scene.add(beacon);
    state.beacon = beacon;
    state.beaconLight = light;
    return beacon;
  }

  function showBeacon(pos) {
    const b = ensureBeacon();
    if (!b || !pos) return;
    b.position.set(pos.x, 3.5, pos.z);
    b.visible = true;
  }

  function hideBeacon() {
    if (state.beacon) state.beacon.visible = false;
  }

  function cleanupActive() {
    const a = state.active;
    if (!a) return;
    if (a.targetCar) {
      const fleet = ctx && (ctx.vehicles || ctx.fleet);
      if (fleet && typeof fleet.removeCar === 'function') fleet.removeCar(a.targetCar);
      else if (ctx && ctx.scene) ctx.scene.remove(a.targetCar.mesh);
      a.targetCar = null;
    }
    if (a.dummies) {
      for (const dum of a.dummies) {
        if (ctx && ctx.scene) ctx.scene.remove(dum.mesh);
      }
      a.dummies = null;
    }
  }

  function payReward(mission) {
    if (ctx && typeof ctx.addMoney === 'function') ctx.addMoney(mission.reward);
    else if (ctx && typeof ctx.money === 'number') ctx.money += mission.reward;
  }

  function completeMission() {
    const a = state.active;
    if (!a) return;
    payReward(a);
    state.completed.add(a.index);
    if (ctx && typeof ctx.toast === 'function') {
      ctx.toast(`Misi selesai: ${a.title} +Rp ${a.reward}`);
    }
    if (ctx && typeof ctx.save === 'function') {
      try { ctx.save(); } catch (e) { /* autosave gagal -> lanjut */ }
    }
    cleanupActive();
    state.active = null;
    state.objectiveText = 'Misi selesai. Pilih misi berikutnya atau jelajahi kota.';
    hideBeacon();
  }

  function failMission(reason) {
    const a = state.active;
    cleanupActive();
    state.active = null;
    state.objectiveText = reason || 'Misi gagal. Coba lagi dari awal misi.';
    if (ctx && typeof ctx.toast === 'function') ctx.toast(state.objectiveText);
    hideBeacon();
  }

  function startMission(index) {
    const def = list[index];
    if (!def) return null;
    if (state.active) cleanupActive();
    const player = ctx && ctx.player;
    const startPos = player && player.pos ? { x: player.pos.x, z: player.pos.z } : { x: 0, z: 0 };
    const a = {
      ...def,
      markerPos: { ...def.targetPos },
      state: 'running',
      sawWanted2: false,
      timer: 0,
      checkpointIndex: 0,
      checkpoints: null,
      targetCar: null,
      dummies: null,
      dummyHits: 0,
      ramCooldown: 0,
      standTimer: 0,
    };

    if (index === 2) {
      if (ctx && ctx.police && typeof ctx.police.addWanted === 'function') {
        ctx.police.addWanted(2);
        a.sawWanted2 = true;
      }
      state.objectiveText = 'Kabur dari patroli! Putus garis pandang sampai wanted 0.';
    } else if (index === 4) {
      const fleet = ctx && (ctx.vehicles || ctx.fleet);
      if (fleet && typeof fleet.spawnCar === 'function') {
        const targetCar = fleet.spawnCar('sedan', {
          x: def.targetPos.x + 6, z: def.targetPos.z + 6,
        });
        targetCar.driver = 'npc';
        targetCar.health = 100;
        a.targetCar = targetCar;
      }
      state.objectiveText = 'Tabrak mobil target sampai hancur! (health target 100)';
    } else if (index === 5) {
      // Gudang Pelabuhan:
      a.dummies = [];
      for (let i = 0; i < 3; i++) {
        const mesh = buildWalkerMesh(0xcc2222);
        const px = def.targetPos.x + (i - 1) * 4;
        const pz = def.targetPos.z + 5;
        mesh.position.set(px, 0, pz);
        if (ctx && ctx.scene) ctx.scene.add(mesh);
        a.dummies.push({ mesh, pos: { x: px, z: pz }, alive: true });
      }
      state.objectiveText = 'Kalahkan 3 penjaga gudang: dekati lalu tekan F. (0/3)';
    } else if (index === 6) {
      a.checkpoints = [boulevard, neon, port];
      a.timer = 150;
      a.markerPos = { ...a.checkpoints[0] };
      state.objectiveText = 'Checkpoint 1/3: Boulevard. Sisa waktu 150 detik.';
    } else if (index === 7) {
      if (ctx && ctx.police && typeof ctx.police.addWanted === 'function') {
        ctx.police.addWanted(5);
      }
      a.markerPos = farthestNode(startPos);
      state.objectiveText = 'WANTED 5! Lintasi kota dan capai marker di ujung kota.';
    } else if (index === 1) {
      state.objectiveText = 'Curi mobil apa saja, lalu bawa ke marker Boulevard.';
    } else if (index === 3) {
      state.objectiveText = 'Antar paket ke Distrik Neon saat malam (18:00-06:00).';
    } else {
      state.objectiveText = 'Antar paket ke marker kuning di Pelabuhan.';
    }

    state.active = a;
    showBeacon(a.markerPos);
    return a;
  }

  function distToMarker(a) {
    const player = ctx && ctx.player;
    if (!player || !player.pos) return Infinity;
    return Math.hypot(player.pos.x - a.markerPos.x, player.pos.z - a.markerPos.z);
  }

  function update(dt) {
    const d = Math.min(Math.max(dt || 0, 0), 0.1);
    // Denyut beacon.
    if (state.beacon && state.beacon.visible) {
      state.beaconT += d;
      const s = 1 + Math.sin(state.beaconT * 3) * 0.15;
      state.beacon.scale.set(s, 1, s);
      state.beacon.rotation.y += d * 0.5;
    }
    const a = state.active;
    if (!a) return;
    const player = ctx && ctx.player;
    const wanted = ctx && ctx.police ? (ctx.police.wanted || 0) : 0;

    if (a.index === 2) {
      if (wanted >= 2) a.sawWanted2 = true;
      state.objectiveText = a.sawWanted2
        ? `Kabur! Wanted ${wanted} bintang — putus garis pandang sampai 0.`
        : 'Tunggu patroli datang…';
      if (a.sawWanted2 && wanted === 0) { completeMission(); return; }
      if (!ctx.police && distToMarker(a) < 6) { completeMission(); return; }
      return;
    }

    if (a.index === 3) {
      const night = isNight(ctx ? ctx.timeHours : undefined);
      state.objectiveText = night
        ? 'Malam tiba. Antar paket ke marker Neon!'
        : `Masih siang (${ctx && typeof ctx.timeHours === 'number' ? ctx.timeHours.toFixed(1) : '?'}.00). Paket diterima malam hari.`;
      if (night && distToMarker(a) < 6) { completeMission(); return; }
      return;
    }

    if (a.index === 4 && a.targetCar) {
      const tc = a.targetCar;
      if (player && player.pos) {
        const away = Math.atan2(tc.pos.x - player.pos.x, tc.pos.z - player.pos.z);
        tc.heading = away;
        tc.speed = 12;
        tc.pos.x += Math.sin(tc.heading) * tc.speed * d;
        tc.pos.z += Math.cos(tc.heading) * tc.speed * d;
        if (graph && typeof graph.projectToRoad === 'function') {
          const road = graph.projectToRoad(tc.pos.x, tc.pos.z);
          if (road) {
            tc.pos.x += (road.x - tc.pos.x) * Math.min(1, 2 * d);
            tc.pos.z += (road.z - tc.pos.z) * Math.min(1, 2 * d);
          }
        }
        a.ramCooldown = Math.max(0, (a.ramCooldown || 0) - d);
        const pc = player.currentCar;
        if (pc && a.ramCooldown <= 0
          && Math.hypot(pc.pos.x - tc.pos.x, pc.pos.z - tc.pos.z) < 4) {
          const dmg = Math.max(6, Math.min(30, Math.abs(pc.speed) * 1.2));
          tc.health = Math.max(0, tc.health - dmg);
          a.ramCooldown = 0.6;
          tc.pos.x += Math.sin(tc.heading) * 0.6;
          tc.pos.z += Math.cos(tc.heading) * 0.6;
        }
      }
      state.objectiveText = `Kejar dan tabrak mobil target! Health target: ${Math.ceil(tc.health)}`;
      if (tc.health <= 0) { completeMission(); return; }
      return;
    }

    if (a.index === 5 && a.dummies) {
      const pressed = (ctx && ctx.interactPressed) || readInteract(ctx ? ctx.input : null);
      const edge = pressed && !state.prevInteract;
      state.prevInteract = pressed;
      if (edge && player && player.pos) {
        for (const dum of a.dummies) {
          if (dum.alive && Math.hypot(player.pos.x - dum.pos.x, player.pos.z - dum.pos.z) < 9) {
            dum.alive = false;
            dum.mesh.visible = false;
            a.dummyHits++;
            break;
          }
        }
      }
      state.objectiveText = `Kalahkan penjaga gudang (F saat dekat). (${a.dummyHits}/3)`;
      if (a.dummyHits >= 3) { completeMission(); return; }
      return;
    }

    if (a.index === 6 && a.checkpoints) {
      a.timer -= d;
      if (a.timer <= 0) { failMission('Waktu habis! Konvoi gagal — coba lagi.'); return; }
      state.objectiveText = `Checkpoint ${a.checkpointIndex + 1}/3 — sisa ${Math.ceil(a.timer)} detik.`;
      if (distToMarker(a) < 6) {
        a.checkpointIndex++;
        if (a.checkpointIndex >= a.checkpoints.length) { completeMission(); return; }
        a.markerPos = { ...a.checkpoints[a.checkpointIndex] };
        showBeacon(a.markerPos);
      }
      return;
    }

    if (a.index === 1) {
      if (player && player.currentCar && distToMarker(a) < 6) { completeMission(); return; }
      return;
    }

    if (distToMarker(a) < 6) { completeMission(); return; }
  }

  const api = {
    list,
    get active() { return state.active; },
    startMission,
    update,
    get objectiveText() { return state.objectiveText; },
    get markerPos() { return state.active ? state.active.markerPos : null; },
    get completed() { return [...state.completed]; },
  };
  return api;
}
