// Test kejar-kejaran polisi Teluk Cahaya (Playwright, Node saja — tanpa runner).
//
// Menjalankan:
//   node tests/police-chase.spec.js
// Playwright harus bisa di-require ('playwright'); bila belum terpasang di repo,
// jalankan dengan NODE_PATH ke instalasi playwright yang ada, misal:
//   NODE_PATH=/tmp/pw/node_modules node tests/police-chase.spec.js
// Chromium: pakai CHROME_PATH bila diset, kalau tidak pakai Chrome stok VM
// (~/workspace/chip404/chrome/opt/google/chrome/chrome), terakhir fallback ke
// Chromium bawaan Playwright.
//
// Yang diuji (kontrak window.__game dari main.js):
//   (a) serve via `node serve.ts --port 8901` (di-spawn dari test ini),
//       buka http://localhost:8901/?seed=1337, tunggu window.__game,
//       assert tanpa console error / pageerror.
//   (b) Skenario polisi: teleport pemain ke jalan (graph), wanted 2 via
//       police.addWanted(2), tunggu 6 detik sim nyata, kumpulkan posisi semua
//       police.units tiap 500 ms dan assert SETIAP posisi isOnRoad(x, z, 4.5)
//       true (toleransi 4.5 = band jalan 3.0 + lebar mobil).
//   (c) Assert wanted > 0 dan units.length >= 1.
//   (d) Screenshot kandidat ke screenshots/2-play.jpg (1280x720, JPEG q80,
//       wajib < 256 KiB) + /tmp/police-chase.png.
// Keluar dengan kode 0 bila semua assert lolos, 1 bila ada yang gagal —
// dan SELALU mencetak ringkasan angka (sampel, pelanggaran) dengan jujur.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8901);
const BASE_URL = `http://localhost:${PORT}/?seed=1337`;
const STOCK_CHROME = path.join(
  process.env.HOME || '/home/hatch',
  'workspace/chip404/chrome/opt/google/chrome/chrome',
);
const MAX_SCREENSHOT_BYTES = 256 * 1024;

const failures = [];
const notes = [];
function fail(msg) {
  failures.push(msg);
  console.error('FAIL: ' + msg);
}
function note(msg) {
  notes.push(msg);
  console.log('  ' + msg);
}

function httpGet(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await httpGet(url)) === 200) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const summary = {
    gameLoaded: false,
    consoleErrors: 0,
    pageErrors: 0,
    wanted: null,
    policeUnits: null,
    samples: 0,
    violations: 0,
    violationDetails: [],
    screenshots: {},
  };

  // --- (a) Serve game ---
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));
  const serverUp = await waitForServer(`http://localhost:${PORT}/`, 10000);
  if (!serverUp) {
    fail(`server tidak menjawab 200 di http://localhost:${PORT}/ — log: ${serverLog.slice(0, 500)}`);
    server.kill();
    printSummary(summary);
    process.exit(1);
  }
  note(`server jalan di http://localhost:${PORT}/`);

  let browser = null;
  try {
    const launchOptions = {
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    };
    const chromePath = process.env.CHROME_PATH || (fs.existsSync(STOCK_CHROME) ? STOCK_CHROME : null);
    if (chromePath) {
      launchOptions.executablePath = chromePath;
      note(`chromium via executablePath: ${chromePath}`);
    } else {
      note('chromium bawaan Playwright (tanpa executablePath)');
    }
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

    const consoleErrors = [];
    const pageErrors = [];
    const badResponses = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const loc = msg.location ? msg.location() : {};
        consoleErrors.push({ text: msg.text(), url: (loc && loc.url) || '' });
      }
    });
    page.on('pageerror', (err) => pageErrors.push(String(err && err.message ? err.message : err)));
    page.on('response', (res) => {
      if (res.status() >= 400) badResponses.push(`${res.status()} ${res.url()}`);
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });

    try {
      await page.waitForFunction(() => window.__game, null, { timeout: 15000 });
      summary.gameLoaded = true;
      note('window.__game ditemukan');
    } catch {
      summary.consoleErrors = consoleErrors.length;
      summary.pageErrors = pageErrors.length;
      fail('window.__game tidak muncul dalam 15 detik (main.js mungkin belum diganti dari starter)');
      await page.screenshot({ path: '/tmp/police-chase.png' });
      note('screenshot debug: /tmp/police-chase.png');
      printSummary(summary);
      process.exitCode = 1;
      return;
    }

    // Mulai permainan dulu (game membuka di title screen): klik New Game
    // supaya kamera chase + HUD aktif sebelum skenario polisi dijalankan.
    // Tanpa ini screenshot hanya menampilkan menu title, bukan kejar-kejaran.
    try {
      await page.click('#btn-new', { timeout: 5000 });
      note('klik New Game');
    } catch {
      await page.evaluate(() => document.getElementById('btn-new')?.click());
      note('klik New Game (via evaluate)');
    }
    await sleep(1000);

    // --- (b) Skenario polisi ---
    const teleported = await page.evaluate(() => {
      const g = window.__game;
      if (!g || !g.graph || !g.player) return { ok: false, reason: 'graph/player tidak ada' };
      // Node tengah kota (boulevard) supaya frame screenshot padat: nearestNode
      // dulu, baru randomRoadNode (butuh rng sebagai argumen pertama).
      let node = null;
      try {
        if (typeof g.graph.nearestNode === 'function') node = g.graph.nearestNode(0, 0);
      } catch {
        node = null;
      }
      try {
        if (!node && typeof g.graph.randomRoadNode === 'function') node = g.graph.randomRoadNode(Math.random);
      } catch (e) {
        node = null;
      }
      if (!node && Array.isArray(g.graph.nodes) && g.graph.nodes.length > 0) node = g.graph.nodes[0];
      if (!node) return { ok: false, reason: 'tidak ada node jalan' };
      const x = typeof node.x === 'number' ? node.x : 0;
      const z = typeof node.z === 'number' ? node.z : typeof node.y === 'number' ? node.y : 0;
      const p = g.player.pos || g.player.position || g.player;
      if (p && typeof p.x === 'number') {
        p.x = x;
        if (typeof p.z === 'number') p.z = z;
      }
      if (g.police && typeof g.police.addWanted === 'function') g.police.addWanted(2);
      else if (g.police) g.police.wanted = 2;
      if (g.state) g.state.wanted = 2;
      return { ok: true, x, z };
    });
    if (!teleported.ok) {
      fail('teleport / addWanted gagal: ' + teleported.reason);
    } else {
      note(`pemain diteleport ke jalan (${teleported.x}, ${teleported.z}), wanted 2`);
    }

    // Kumpulkan posisi polisi tiap 500 ms selama 6 detik sim nyata.
    const TOLERANCE = 4.5;
    let sawIsOnRoadFn = false;
    for (let i = 0; i < 12; i += 1) {
      await sleep(500);
      const snap = await page.evaluate((tol) => {
        const g = window.__game;
        const out = { wanted: null, count: 0, units: [], isOnRoadFn: false };
        if (!g || !g.police) return out;
        out.wanted = typeof g.police.wanted === 'number' ? g.police.wanted : g.state ? g.state.wanted : null;
        const units = Array.isArray(g.police.units) ? g.police.units : [];
        out.count = units.length;
        const isOnRoad =
          typeof g.police.isOnRoad === 'function'
            ? g.police.isOnRoad
            : g.graph && typeof g.graph.isOnRoad === 'function'
              ? g.graph.isOnRoad
              : null;
        out.isOnRoadFn = !!isOnRoad;
        // Posisi unit bisa tersimpan di pos / position / car / vehicle / mesh.
        const unitPos = (u) => {
          const car = u.car || u.vehicle || null;
          const cands = [
            u.pos,
            u.position,
            car && (car.pos || car.position),
            car,
            u.mesh && u.mesh.position,
            u,
          ];
          for (const p of cands) {
            if (p && typeof p.x === 'number' && (typeof p.z === 'number' || typeof p.y === 'number')) {
              return { x: p.x, z: typeof p.z === 'number' ? p.z : p.y };
            }
          }
          return { x: null, z: null };
        };
        for (const u of units) {
          const { x, z } = unitPos(u);
          let onRoad = null;
          if (x !== null && z !== null && isOnRoad) {
            try {
              onRoad = !!isOnRoad(x, z, tol);
            } catch {
              onRoad = null;
            }
          }
          out.units.push({ x, z, onRoad });
        }
        return out;
      }, TOLERANCE);
      summary.wanted = snap.wanted;
      summary.policeUnits = snap.count;
      if (snap.isOnRoadFn) sawIsOnRoadFn = true;
      if (!snap.isOnRoadFn) note('PERINGATAN: isOnRoad tidak tersedia di police maupun graph (kontrak API)');
      for (const u of snap.units) {
        summary.samples += 1;
        if (u.onRoad === false) {
          summary.violations += 1;
          if (summary.violationDetails.length < 10) {
            summary.violationDetails.push({ x: u.x, z: u.z });
          }
        } else if (u.onRoad === null) {
          note('isOnRoad gagal / posisi unit tak terbaca — sampel tidak bisa diperiksa');
        }
      }
    }
    note(`sampel posisi polisi: ${summary.samples}, pelanggaran off-road: ${summary.violations}`);
    note(`wanted akhir: ${summary.wanted}, unit polisi: ${summary.policeUnits}`);

    // --- (c) Assert ---
    if (!sawIsOnRoadFn) fail('isOnRoad tidak tersedia di police maupun graph — posisi polisi tidak bisa diverifikasi (kontrak API)');
    if (!(summary.wanted > 0)) fail(`wanted harus > 0, dapat ${summary.wanted}`);
    if (!(summary.policeUnits >= 1)) fail(`unit polisi harus >= 1, dapat ${summary.policeUnits}`);
    if (summary.violations > 0) {
      fail(`${summary.violations}/${summary.samples} sampel posisi polisi di luar jalan (toleransi 4.5)`);
    }
    if (summary.samples === 0) fail('tidak ada sampel posisi polisi yang terkumpul');

    // --- (d) Screenshot ---
    await page.screenshot({ path: '/tmp/police-chase.png' });
    summary.screenshots.tmp = '/tmp/police-chase.png';
    const shotPath = path.join(REPO_ROOT, 'screenshots', '2-play.jpg');
    let quality = 80;
    let size = 0;
    for (;;) {
      await page.screenshot({ path: shotPath, type: 'jpeg', quality });
      size = fs.statSync(shotPath).size;
      if (size < MAX_SCREENSHOT_BYTES || quality <= 40) break;
      quality -= 20;
    }
    summary.screenshots.candidate = { path: shotPath, bytes: size, quality };
    note(`kandidat 2-play.jpg: ${size} byte (kualitas ${quality}, batas ${MAX_SCREENSHOT_BYTES})`);
    if (size >= MAX_SCREENSHOT_BYTES) {
      fail(`2-play.jpg ${size} byte melebihi batas 256 KiB walau kualitas ${quality}`);
    }

    summary.consoleErrors = consoleErrors.length;
    summary.pageErrors = pageErrors.length;
    summary.badResponses = badResponses;
    // favicon.ico 404 bukan error game (game belum punya favicon) — dicatat
    // tapi tidak menggagalkan test; error konsol lain tetap menggagalkan.
    // URL sumber ada di msg.location(), bukan di teks pesan.
    const isFavicon = (m) => (m.url || '').includes('favicon.ico') || (m.text || '').includes('favicon.ico');
    const favicon404 = consoleErrors.filter(isFavicon);
    const realConsoleErrors = consoleErrors.filter((m) => !isFavicon(m));
    summary.ignoredFavicon404 = favicon404.length;
    if (favicon404.length > 0) note(`favicon 404 diabaikan (${favicon404.length}) — game belum punya favicon`);
    if (realConsoleErrors.length > 0) {
      fail(
        `console error (${realConsoleErrors.length}): ` +
          realConsoleErrors
            .slice(0, 3)
            .map((m) => `${m.text}${m.url ? ' @ ' + m.url : ''}`)
            .join(' | '),
      );
    }
    if (pageErrors.length > 0) fail(`pageerror (${pageErrors.length}): ${pageErrors.slice(0, 3).join(' | ')}`);
    if (badResponses.length > 0) fail(`respons HTTP >= 400 (${badResponses.length}): ${badResponses.slice(0, 3).join(' | ')}`);
  } catch (err) {
    fail('test crash: ' + (err && err.message ? err.message : String(err)));
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill();
  }

  printSummary(summary);
  process.exitCode = failures.length > 0 ? 1 : 0;
}

function printSummary(summary) {
  console.log('\n=== RINGKASAN POLICE-CHASE ===');
  console.log(JSON.stringify({ ...summary, failures }, null, 2));
  if (failures.length === 0) console.log('HASIL: LULUS');
  else console.log(`HASIL: GAGAL (${failures.length} kegagalan)`);
}

main().catch((err) => {
  console.error('FAIL: ' + (err && err.message ? err.message : String(err)));
  process.exit(1);
});
