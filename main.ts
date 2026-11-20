// Teluk Cahaya — make.fun entrypoint (main.ts)
//
// What this script does, in three moves:
//   1. Copy this repo's game/ and screenshots/ into the output directory.
//   2. Build dossier.json there with the kit's buildDossier helper.
//   3. Exit 0 and say what it wrote, or fail loudly if a source is missing.
//
// Run it with Node 22: `node main.ts`
// The grader sets MAKEFUN_OUTPUT_DIR to /output; locally you can point it
// anywhere, e.g. `MAKEFUN_OUTPUT_DIR=/tmp/out node main.ts`.
// An entry without its game or its screenshots is not an entry, so a
// missing source directory is a hard error, not a warning.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// Bounty caps from the competition kit (reference/gate.json).
// The dossier text may hold at most 160 KiB; at most 4 screenshots of at
// most 256 KiB each; the game itself at most 993 files and 48 MiB in total;
// no single game path longer than 1000 bytes. buildDossier enforces all of
// these, so an entry that outgrew the caps fails here, at build time,
// instead of silently producing a dossier the scorer would reject.
const ENTRY_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

// The repo root is the folder holding this file. The output directory comes
// from the environment when the grader runs it, and defaults to /output.
function repoDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function outDir(): string {
  const envDir = process.env.MAKEFUN_OUTPUT_DIR;
  if (envDir !== undefined && envDir !== '') return resolve(envDir);
  return '/output';
}

// Count every entry (files plus directories) under a directory, walking
// it recursively. Used only for the log line, so an unreadable entry is
// counted once and skipped instead of aborting the count.
function tally(dir: string): number {
  let total = 0;
  const walk = (current: string): void => {
    let names: string[];
    try {
      names = readdirSync(current);
    } catch {
      return;
    }
    for (const name of names) {
      total += 1;
      const entryPath = join(current, name);
      try {
        if (statSync(entryPath).isDirectory()) walk(entryPath);
      } catch {
        // Counted already; leave it alone.
      }
    }
  };
  walk(dir);
  return total;
}

// Copy one source tree into the output directory. Throws with a clear
// message when the source does not exist, and reports how many entries
// moved so the run log shows the copy actually happened.
function copyInto(src: string, dest: string, label: string): number {
  if (!existsSync(src)) {
    throw new Error(`${label} not found — expected it at ${src}`);
  }
  const moved = tally(src);
  cpSync(src, dest, { recursive: true, force: true });
  return moved;
}

// Ask the kit library for the dossier bytes and write them next to the
// copied game/ and screenshots/. Returns the byte length for the log.
function buildAndWriteDossier(out: string): number {
  const dossier = buildDossier(out, ENTRY_CAPS);
  writeFileSync(join(out, 'dossier.json'), dossier);
  return dossier.length;
}

function main(): void {
  const root = repoDir();
  const out = outDir();

  mkdirSync(out, { recursive: true });

  // Clear any previous copy first: without this, a re-run into a
  // non-empty output directory could leave stale files behind (a game
  // file deleted since the last run would survive in the output and
  // end up in the dossier). Removing only the two trees this script
  // owns keeps the rest of the output directory untouched.
  rmSync(join(out, 'game'), { recursive: true, force: true });
  rmSync(join(out, 'screenshots'), { recursive: true, force: true });

  const gameMoved = copyInto(join(root, 'game'), join(out, 'game'), 'game/');
  const shotsMoved = copyInto(
    join(root, 'screenshots'),
    join(out, 'screenshots'),
    'screenshots/',
  );
  const dossierSize = buildAndWriteDossier(out);

  console.log(`[main] entry written to ${out}`);
  console.log(`[main] game/: ${gameMoved} entries copied`);
  console.log(`[main] screenshots/: ${shotsMoved} entries copied`);
  console.log(`[main] dossier.json: ${dossierSize} bytes`);
}

main();
