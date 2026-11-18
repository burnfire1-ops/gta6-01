// Smoke test minimal Teluk Cahaya (Node, tanpa dependensi wajib).
// Menjalankan:  node tests/smoke.mjs
// Langkah:
//   1) node --check semua file JS game (hud/audio/save/shots + main.js bila ada).
//   2) Spawn `node serve.ts --port 8902`, cek HTTP 200 untuk `/` dan
//      `/src/main.js`, lalu matikan server.
//   3) Bila modul 'playwright' bisa di-require, coba muat game headless dan
//      laporkan apakah window.__game ada (non-fatal — main.js mungkin masih
//      starter saat smoke ini dijalankan).
// Keluar 0 bila langkah 1-2 lolos, 1 bila ada yang gagal.

import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SMOKE_PORT || 8902);
const FILES_TO_CHECK = [
  'game/src/hud.js',
  'game/src/audio.js',
  'game/src/save.js',
  'game/src/shots.js',
  'game/src/main.js',
  'game/src/config.js',
  'game/src/random.js',
];

const failures = [];

function checkFile(rel) {
  return new Promise((resolve) => {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) {
      console.log(`SKIP ${rel} (tidak ada)`);
      return resolve();
    }
    execFile(process.execPath, ['--check', abs], (err) => {
      if (err) {
        failures.push(`${rel}: ${err.message.split('\n')[0]}`);
        console.log(`FAIL ${rel}: sintaks tidak valid`);
      } else {
        console.log(`OK   ${rel}`);
      }
      resolve();
    });
  });
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

async function main() {
  console.log('== 1) node --check ==');
  for (const f of FILES_TO_CHECK) await checkFile(f);

  console.log('== 2) serve.ts merespons ==');
  const server = spawn(process.execPath, ['serve.ts', '--port', String(PORT)], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));
  try {
    const up = await waitForServer(`http://localhost:${PORT}/`, 10000);
    if (!up) {
      failures.push('serve.ts tidak menjawab 200 untuk /');
      console.log(`FAIL / — log: ${serverLog.slice(0, 300)}`);
    } else {
      console.log(`OK   GET / -> 200 (port ${PORT})`);
      const mainStatus = await httpGet(`http://localhost:${PORT}/src/main.js`);
      if (mainStatus === 200) console.log('OK   GET /src/main.js -> 200');
      else {
        failures.push(`/src/main.js -> ${mainStatus}`);
        console.log(`FAIL /src/main.js -> ${mainStatus}`);
      }
    }

    console.log('== 3) headless load (opsional, bila playwright ada) ==');
    let playwright = null;
    try {
      playwright = require('playwright');
    } catch {
      console.log('SKIP playwright tidak terpasang — lewati load headless');
    }
    if (playwright) {
      const stockChrome = path.join(
        process.env.HOME || '/home/hatch',
        'workspace/chip404/chrome/opt/google/chrome/chrome',
      );
      const launchOptions = {
        headless: true,
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      };
      if (fs.existsSync(stockChrome)) launchOptions.executablePath = stockChrome;
      try {
        const browser = await playwright.chromium.launch(launchOptions);
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));
        await page.goto(`http://localhost:${PORT}/?seed=1337`, {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        const hasGame = await page
          .waitForFunction(() => window.__game, null, { timeout: 8000 })
          .then(() => true)
          .catch(() => false);
        console.log(`INFO window.__game: ${hasGame ? 'ADA' : 'TIDAK ADA (main.js mungkin masih starter)'}`);
        if (errors.length > 0) console.log(`INFO pageerror: ${errors.slice(0, 3).join(' | ')}`);
        await browser.close();
      } catch (e) {
        console.log(`INFO headless load gagal: ${e.message}`);
      }
    }
  } finally {
    server.kill();
  }

  console.log('\n== RINGKASAN SMOKE ==');
  if (failures.length === 0) {
    console.log('SMOKE LULUS');
    process.exit(0);
  } else {
    console.log(`SMOKE GAGAL (${failures.length}):`);
    for (const f of failures) console.log(' - ' + f);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('SMOKE CRASH: ' + err.message);
  process.exit(1);
});
