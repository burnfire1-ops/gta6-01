// Teluk Cahaya — entrypoint (main.ts)
//
// Hands the game in to make.fun. It copies the static game files and the
// screenshots out of this repository into the output directory, then writes
// dossier.json there with buildDossier from the kit library.
//
// Run it with Node 22: `node main.ts`
// Inside the grader the output directory is /output. Outside the grader,
// set MAKEFUN_OUTPUT_DIR to the directory you want the entry written to.
// The script exits 0 when the entry is written, and throws with a clear
// message when something it needs is missing.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// ------------------------------------------------------------------ caps
//
// The bounty caps for this entry (from the competition kit): the dossier
// text holds at most 160 KiB, at most 4 screenshots of at most 256 KiB
// each, and the game itself is at most 993 files and 48 MiB. Paths are
// at most 1000 bytes. buildDossier enforces these when it writes the
// dossier, so a game that grew past them fails loudly here instead of
// silently producing a dossier the scorer would refuse.

const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

// ------------------------------------------------------------------ paths
//
// The repository root is the directory that holds this file. The game and
// the screenshots live under it; the output directory comes from the
// environment (the grader) or defaults to /output.

function repoRoot(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function outputDir(): string {
  const fromEnv = process.env.MAKEFUN_OUTPUT_DIR;
  if (fromEnv !== undefined && fromEnv !== '') return resolve(fromEnv);
  return '/output';
}

// ------------------------------------------------------------------ copy
//
// Copy one directory tree into the output directory, replacing whatever
// was there. A missing source is a hard error: an entry without its game
// or without its screenshots is not an entry. Returns how many entries
// (files and directories) the source tree held, so the log says what moved.

function countEntries(dir: string): number {
  let n = 0;
  const walk = (d: string): void => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const name of names) {
      n += 1;
      const p = join(d, name);
      try {
        if (statSync(p).isDirectory()) walk(p);
      } catch {
        // An unreadable entry is counted once and left alone.
      }
    }
  };
  walk(dir);
  return n;
}

function copyTreeInto(srcDir: string, destDir: string, label: string): number {
  if (!existsSync(srcDir)) {
    throw new Error(`${label} is missing (looked for ${srcDir})`);
  }
  const entries = countEntries(srcDir);
  cpSync(srcDir, destDir, { recursive: true, force: true });
  return entries;
}

// ------------------------------------------------------------------ dossier
//
// buildDossier reads the output directory back (game/ + screenshots/) and
// returns the dossier bytes. Writing them is what makes the entry: the
// scorer compares this file byte for byte with one it builds itself.

function writeDossier(outDir: string): number {
  const bytes = buildDossier(outDir, DOSSIER_CAPS);
  writeFileSync(join(outDir, 'dossier.json'), bytes);
  return bytes.length;
}

// ------------------------------------------------------------------ main

function main(): void {
  const root = repoRoot();
  const out = outputDir();
  const gameDir = join(root, 'game');
  const shotsDir = join(root, 'screenshots');

  mkdirSync(out, { recursive: true });

  const gameEntries = copyTreeInto(gameDir, join(out, 'game'), 'game/');
  const shotEntries = copyTreeInto(shotsDir, join(out, 'screenshots'), 'screenshots/');
  const dossierBytes = writeDossier(out);

  console.log(`[main] entry written to ${out}`);
  console.log(`[main] game/: ${gameEntries} entries copied`);
  console.log(`[main] screenshots/: ${shotEntries} entries copied`);
  console.log(`[main] dossier.json: ${dossierBytes} bytes`);
}

main();
