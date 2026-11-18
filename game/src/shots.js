// Screenshot scenes Teluk Cahaya di balik ?shot=start|play|end.
// Tulis ulang total untuk rebuild round 3 — DITURUNKAN DARI TESIS, bukan dari
// kode game lama. Setiap scene memainkan simulasi nyata maju beberapa detik
// (bukan pose mati) supaya frame-nya hidup: traffic jalan, pejalan kaki jalan,
// polisi mengejar.
//
// Kontrak: stageShot(name, game) -> { screen: 'title' | 'play' }.
// game = objek dari main.js: { player, police, vehicles, traffic, pedestrians,
// missions, graph, dayNight, hud, state, ... }.
// DITULIS DEFENSIF: tiap subsistem dicek keberadaannya sebelum dipakai, karena
// main.js bisa memanggil stageShot sebelum semua sistem siap. Yang tidak ada
// dilewati diam-diam — main.js yang menandai window.__shotReady setelah 2x paint.
//
// Scene (tesis §3):
//   start — siang (jam 10), pemain jalan kaki di zebra cross boulevard dekat
//           menara kaca, traffic + pejalan kaki berjalan, HUD title tampil.
//   play  — golden hour (jam 17.5), pemain di mobil sport teal, wanted 2,
//           2 unit pursuit di belakang, misi 1 aktif + marker terlihat.
//   end   — malam neon (jam 21), wanted 5, 4 unit pursuit, mobil pemain di
//           persimpangan pelabuhan.

const STEP = 1 / 60;
const SIM_SECONDS = 4;

function isFn(v) {
  return typeof v === 'function';
}

// Ambil posisi {x, z} dari berbagai bentuk: {x,z}, {x,y}, {x,y,z}.
function readPos(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const p = obj.pos || obj.position || obj;
  if (typeof p.x !== 'number') return null;
  const z = typeof p.z === 'number' ? p.z : typeof p.y === 'number' ? p.y : 0;
  return { x: p.x, z };
}

function writePos(obj, x, z) {
  if (!obj || typeof obj !== 'object') return false;
  const p = obj.pos || obj.position || null;
  if (p && typeof p.x === 'number') {
    p.x = x;
    if (typeof p.z === 'number') p.z = z;
    else if (typeof p.y === 'number') p.y = 0;
    return true;
  }
  if (typeof obj.x === 'number') {
    obj.x = x;
    if (typeof obj.z === 'number') obj.z = z;
    return true;
  }
  return false;
}

function setHeading(obj, radians) {
  if (!obj || typeof obj !== 'object') return;
  try {
    if (typeof obj.heading === 'number') obj.heading = radians;
    else if (obj.rotation && typeof obj.rotation.y === 'number') obj.rotation.y = radians;
  } catch {
    // Heading tidak bisa diset: abaikan.
  }
}

// RNG kecil deterministik (mulberry32) — dipakai saat game tidak menyediakan
// rng-nya sendiri, supaya scene screenshot bisa direproduksi persis.
function mulberry32(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Satu node jalan sebagai {x, z}, dari API graph apa pun yang tersedia.
// randomRoadNode butuh rng sebagai argumen pertama — jangan panggil tanpa rng.
function pickRoadNode(graph, prefer, rng) {
  if (!graph) return { x: 0, z: 0 };
  const rand = typeof rng === 'function' ? rng : mulberry32(1);
  try {
    if (prefer && isFn(graph.nearestNode)) {
      const p = readPos(graph.nearestNode(prefer.x, prefer.z));
      if (p) return p;
    }
  } catch {
    // nearestNode gagal: lanjut ke cara berikut.
  }
  try {
    if (isFn(graph.randomRoadNode)) {
      const p = readPos(graph.randomRoadNode(rand));
      if (p) return p;
    }
  } catch {
    // randomRoadNode gagal: lanjut ke daftar node.
  }
  try {
    if (Array.isArray(graph.nodes) && graph.nodes.length > 0) {
      if (prefer) {
        let best = null;
        let bestD = Infinity;
        for (const n of graph.nodes) {
          const p = readPos(n);
          if (!p) continue;
          const d = (p.x - prefer.x) ** 2 + (p.z - prefer.z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        if (best) return best;
      }
      const p = readPos(graph.nodes[0]);
      if (p) return p;
    }
  } catch {
    // Daftar node tidak bisa dibaca.
  }
  return { x: 0, z: 0 };
}

// Node jalan terjauh dari pusat — perkiraan persimpangan pelabuhan (tepi kota).
function pickEdgeNode(graph) {
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    return pickRoadNode(graph, null);
  }
  let best = null;
  let bestD = -1;
  for (const n of graph.nodes) {
    const p = readPos(n);
    if (!p) continue;
    const d = Math.abs(p.x) + Math.abs(p.z);
    if (d > bestD) {
      bestD = d;
      best = p;
    }
  }
  return best || { x: 0, z: 0 };
}

function setTime(game, hours) {
  try {
    if (game.dayNight && isFn(game.dayNight.setTime)) game.dayNight.setTime(hours);
    else if (isFn(game.setTime)) game.setTime(hours);
    else if (game.dayNight && typeof game.dayNight.timeHours === 'number') game.dayNight.timeHours = hours;
    else if (game.state && typeof game.state.timeHours === 'number') game.state.timeHours = hours;
  } catch {
    // Jam kota tidak bisa diset: abaikan.
  }
}

function setWanted(game, level) {
  try {
    if (game.police && isFn(game.police.addWanted)) {
      game.police.addWanted(level);
      return;
    }
  } catch {
    // addWanted gagal: jatuh ke set langsung.
  }
  try {
    if (game.police && typeof game.police.wanted === 'number') game.police.wanted = level;
    if (game.state && typeof game.state.wanted === 'number') game.state.wanted = level;
  } catch {
    // Wanted tidak bisa diset: abaikan.
  }
}

function spawnPursuit(game, count) {
  if (!game.police) return;
  try {
    if (isFn(game.police.spawnPursuitUnit)) {
      for (let i = 0; i < count; i += 1) game.police.spawnPursuitUnit();
    }
  } catch {
    // Spawn manual gagal: update loop polisi yang akan memunculkan unit.
  }
}

// Cari kendaraan yang sudah ada, atau minta sistem kendaraan membuatkannya.
function findOrSpawnVehicle(game, pos) {
  const vehicles = game.vehicles;
  if (!vehicles) return null;
  // 1) Kendaraan yang sudah ada: pilih sport, kalau tidak ada ambil yang pertama.
  //    Fleet menyimpan daftarnya di `.cars` (bukan `.list`).
  try {
    const list = Array.isArray(vehicles.cars)
      ? vehicles.cars
      : Array.isArray(vehicles.list)
        ? vehicles.list
        : Array.isArray(vehicles)
          ? vehicles
          : null;
    if (list) {
      const sport =
        list.find((v) => /sport/i.test(String(v.type || v.name || ''))) || list[0] || null;
      if (sport) {
        writePos(sport, pos.x, pos.z + 2);
        if ('color' in sport) sport.color = '#2ec4b6';
        return sport;
      }
    }
  } catch {
    // Daftar kendaraan belum siap.
  }
  // 2) Minta dibuatkan. Fleet memakai spawnCar(type, pos); sisanya fallback.
  const makers = [vehicles.spawnCar, vehicles.spawn, vehicles.create, vehicles.spawnVehicle, game.spawnVehicle];
  for (const make of makers) {
    if (!isFn(make)) continue;
    try {
      const v = make.call(vehicles, 'sport', { x: pos.x, z: pos.z }, { color: '#2ec4b6' });
      if (v) return v;
    } catch {
      // Satu signature gagal: coba pembuat berikutnya.
    }
    try {
      const v = make.call(vehicles, { x: pos.x, z: pos.z });
      if (v) return v;
    } catch {
      // Lanjut.
    }
  }
  return null;
}

function enterVehicle(game, vehicle) {
  if (!vehicle) return false;
  try {
    // Nama metode di modul player adalah enterCar (bukan enterVehicle).
    if (game.player && isFn(game.player.enterCar)) {
      game.player.enterCar(vehicle);
    } else if (game.player && isFn(game.player.enterVehicle)) {
      game.player.enterVehicle(vehicle);
    } else if (isFn(game.enterVehicle)) {
      game.enterVehicle(vehicle);
    } else if (game.player && 'currentCar' in game.player) {
      game.player.currentCar = vehicle;
      game.player.onFoot = false;
    } else {
      return false;
    }
    // Sinkronkan snapshot luar player: createPlayer mengembalikan
    // {...state} (spread) sehingga onFoot/currentCar di objek luar adalah
    // SALINAN STALE — enterCar mengubah state internal, tapi main.js membaca
    // player.onFoot/currentCar dari salinan itu (mode kamera, HUD kendaraan).
    // Tulis salinannya juga supaya dunia luar melihat pemain sudah di mobil.
    // (Perbaikan benar: player.js harus mengembalikan getter live / state
    // itu sendiri — dicatat sebagai temuan integrasi, bukan diperbaiki di sini.)
    try {
      game.player.onFoot = false;
      game.player.currentCar = vehicle;
    } catch {
      // Properti read-only: abaikan.
    }
    return true;
  } catch {
    // Masuk mobil gagal.
  }
  return false;
}

function exitVehicle(game) {
  try {
    if (game.player && isFn(game.player.exitCar)) game.player.exitCar();
    else if (game.player && isFn(game.player.exitVehicle)) game.player.exitVehicle();
    else if (isFn(game.exitVehicle)) game.exitVehicle();
    else if (game.player && 'currentCar' in game.player) {
      game.player.currentCar = null;
      game.player.onFoot = true;
    }
    // Sinkronkan snapshot luar juga (lihat enterVehicle).
    try {
      game.player.onFoot = true;
      game.player.currentCar = null;
    } catch {
      // Properti read-only: abaikan.
    }
  } catch {
    // Keluar mobil gagal: abaikan.
  }
}

function startFirstMission(game) {
  const missions = game.missions;
  if (!missions || !isFn(missions.startMission)) return;
  const tries = [1, 0, 'misi-1', 'mission-1'];
  try {
    if (Array.isArray(missions.list) && missions.list.length > 0) {
      const first = missions.list[0];
      if (first && first.id !== undefined) tries.unshift(first.id);
    }
  } catch {
    // Daftar misi belum siap.
  }
  for (const id of tries) {
    try {
      missions.startMission(id);
      return;
    } catch {
      // Coba id berikutnya.
    }
  }
}

// Majukan simulasi secukupnya supaya frame hidup (bukan pose mati).
function advanceSim(game, seconds) {
  const steps = Math.round(seconds / STEP);
  const updaters = [];
  if (isFn(game.update)) updaters.push((dt) => game.update(dt));
  else {
    const subs = [game.player, game.police, game.vehicles, game.traffic, game.pedestrians, game.missions, game.dayNight];
    for (const s of subs) {
      if (s && isFn(s.update)) updaters.push((dt) => s.update(dt));
    }
  }
  for (let i = 0; i < steps; i += 1) {
    for (const u of updaters) {
      try {
        u(STEP);
      } catch {
        // Satu subsistem gagal di satu langkah: lanjutkan langkah berikutnya.
      }
    }
  }
}

// Susun state HUD dari objek game untuk satu panggilan hud.update().
// Penting: runShot di main.js TIDAK menjalankan frame loop (hanya render 2x),
// jadi tanpa panggilan ini HUD di screenshot hanya menampilkan isi awal HTML.
function pushHudState(g) {
  const hud = g.hud;
  if (!hud || !isFn(hud.update)) return;
  try {
    const player = g.player || {};
    const police = g.police || {};
    const missions = g.missions || {};
    const dayNight = g.dayNight || {};
    const state = g.state || {};
    const car = player.currentCar || player.vehicle || null;
    const objective = missions.objectiveText || '';
    if (typeof objective === 'string' && objective && isFn(hud.setObjective)) {
      hud.setObjective(objective);
    }
    hud.update({
      playerHealth: typeof player.health === 'number' ? player.health : 100,
      armor: typeof player.armor === 'number' ? player.armor : 0,
      money: typeof state.money === 'number' ? state.money : 0,
      wanted: typeof police.wanted === 'number' ? police.wanted : typeof state.wanted === 'number' ? state.wanted : 0,
      missionTitle: missions.active && missions.active.title ? missions.active.title : null,
      objectiveText: objective,
      vehicleName: car ? car.name || car.type || null : null,
      vehicleHealth: car && typeof car.health === 'number' ? car.health : undefined,
      minimap: {
        graph: g.graph,
        playerPos: player.pos || player.position || null,
        playerHeading: player.heading,
        policeUnits: Array.isArray(police.units) ? police.units : [],
        missionMarker: missions.markerPos || null,
        safehouse: g.safehouse || null,
      },
      timeHours: typeof dayNight.timeHours === 'number' ? dayNight.timeHours : state.timeHours,
      speedKmh: 0,
    });
  } catch {
    // HUD gagal di-update: frame 3D tetap jalan, screenshot tetap diambil.
  }
}

// Bingkai kamera chase untuk scene mengemudi (play/end): letakkan kamera di
// belakang mobil pemain dan arahkan ke depan mobil. Diperlukan karena runShot
// di main.js TIDAK menjalankan frame loop — kamera chase tidak pernah update
// mengikuti pemain, sehingga tanpa ini mobil pemain di luar frame.
// Konvensi heading sama dengan player.js: forward = (sin h, cos h) di (x, z).
function frameChaseCamera(game) {
  try {
    const camera = game.camera;
    const player = game.player;
    if (!camera || !player) return;
    if (!camera.position || typeof camera.position.set !== 'function') return;
    if (typeof camera.lookAt !== 'function') return;
    const p = readPos(player);
    if (!p) return;
    const h = typeof player.heading === 'number' ? player.heading : 0;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    camera.position.set(p.x - fx * 9, 3.5, p.z - fz * 9);
    camera.lookAt(p.x + fx * 6, 1.2, p.z + fz * 6);
  } catch {
    // Kamera tidak bisa dibingkai: biarkan posisi awalnya.
  }
}

export function stageShot(name, game) {
  const g = game || {};
  // RNG game bila ada, kalau tidak rng deterministik sendiri (seed tetap).
  const rng = typeof g.rng === 'function' ? g.rng : mulberry32(1);

  if (name === 'play') {
    // Golden hour, mobil sport teal, wanted 2, misi 1 aktif.
    setTime(g, 17.5);
    const node = pickRoadNode(g.graph, { x: 0, z: 0 }, rng);
    if (g.player) {
      writePos(g.player, node.x, node.z);
      setHeading(g.player, 0);
    }
    const vehicle = findOrSpawnVehicle(g, node);
    enterVehicle(g, vehicle);
    setWanted(g, 2);
    spawnPursuit(g, 2);
    startFirstMission(g);
    advanceSim(g, SIM_SECONDS);
    // Unit pursuit bisa butuh update loop untuk muncul bila spawn manual gagal.
    if (g.police && Array.isArray(g.police.units) && g.police.units.length === 0) {
      spawnPursuit(g, 2);
      advanceSim(g, 1);
    }
    if (g.hud && isFn(g.hud.showMenu)) g.hud.showMenu('none');
    frameChaseCamera(g);
    pushHudState(g);
    return { screen: 'play' };
  }

  if (name === 'end') {
    // Malam neon, wanted 5, 4 unit pursuit, persimpangan pelabuhan.
    setTime(g, 21);
    const node = pickEdgeNode(g.graph);
    if (g.player) {
      writePos(g.player, node.x, node.z);
      setHeading(g.player, Math.PI / 4);
    }
    const vehicle = findOrSpawnVehicle(g, node);
    enterVehicle(g, vehicle);
    setWanted(g, 5);
    spawnPursuit(g, 4);
    advanceSim(g, SIM_SECONDS);
    if (g.police && Array.isArray(g.police.units) && g.police.units.length < 4) {
      spawnPursuit(g, 4);
      advanceSim(g, 1);
    }
    if (g.hud && isFn(g.hud.showMenu)) g.hud.showMenu('none');
    frameChaseCamera(g);
    pushHudState(g);
    return { screen: 'play' };
  }

  // start (dan nama lain yang tak dikenal): siang, jalan kaki, HUD title.
  setTime(g, 10);
  const node = pickRoadNode(g.graph, { x: 0, z: 0 }, rng);
  exitVehicle(g);
  if (g.player) {
    writePos(g.player, node.x, node.z);
    setHeading(g.player, 0);
  }
  // Traffic + pejalan kaki ikut jalan selama sim dimajukan.
  advanceSim(g, SIM_SECONDS);
  if (g.hud && isFn(g.hud.showMenu)) g.hud.showMenu('title');
  pushHudState(g);
  return { screen: 'title' };
}
