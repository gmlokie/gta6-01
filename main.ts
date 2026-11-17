// SOLMAR BAY — gta6-01 entrypoint (Node 22, standard library only).
//
// What this program does: it takes the game in this repository (the static
// files under game/ plus the four screenshots under screenshots/) and hands
// them in as the entry's output. It copies both folders into the output
// directory the grader provides, then writes /output/dossier.json with the
// vendored make.fun library, which summarises the game for the judge.
//
// How to run it outside the grader, where MAKEFUN_OUTPUT_DIR stands in for
// the grader's /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// The output is deterministic: the same repository always produces the same
// bytes, because the copy is a plain recursive copy and the dossier is built
// purely from the copied files (no timestamps, no random data, no network).
//
// Concurrency: the grader runs this program TWICE into the same output
// directory, and the two runs may overlap in time. A plain cpSync leaves a
// file truncated while the other run's dossier builder reads it; deleting the
// target folders first races the other run's copy and fails with ENOTEMPTY.
// So this program never deletes anything the other run might read, and every
// file is installed atomically: staged in a directory private to this
// process, then moved into place with renameSync, which a reader only ever
// sees as a complete file.

import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { buildDossier } from './vendor/makefun-game.ts';

// The repository root is the folder this file lives in.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// The grader sets /output; local runs use MAKEFUN_OUTPUT_DIR instead.
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Caps from the competition's gate: the dossier may hold at most 160 KiB of
// source text, at most 4 screenshots of at most 256 KiB each, and game/ may
// hold at most 993 entries totalling at most 48 MiB, with no path longer
// than 1000 bytes. buildDossier enforces them and fails loudly otherwise.
const DOSSIER_OPTIONS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

// Staging directory private to this process. The pid alone does NOT make it
// private: the grader runs this program in separate containers, and in a
// container whose entrypoint is node, the process IS pid 1 — so two
// concurrent runs would both stage into `.stage-1` and collide when one
// renames a staged file the other already moved (ENOENT, exit 1). A random
// 64-bit token makes the directory unique per run. It is transient (removed
// before exit) and never enters the dossier, so the handed-in bytes are
// unaffected. It lives beside the output folders, never inside game/ or
// screenshots/, so the dossier builder never sees it.
const stageDir = join(outputDir, `.stage-${process.pid}-${randomBytes(8).toString('hex')}`);
let stagedCount = 0;

function copyEntryFolder(name) {
  const source = join(repoRoot, name);
  const target = join(outputDir, name);
  if (!existsSync(source)) {
    throw new Error(`SOLMAR BAY: expected folder ${name}/ beside main.ts, but it is missing`);
  }
  mkdirSync(target, { recursive: true });
  const walk = (srcDir, dstDir) => {
    for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
      const src = join(srcDir, entry.name);
      const dst = join(dstDir, entry.name);
      if (entry.isDirectory()) {
        mkdirSync(dst, { recursive: true });
        walk(src, dst);
      } else if (entry.isFile()) {
        // Skip dotfiles: a stray .gitkeep in a copied folder fails the
        // grader's run_completes check (it requires plain relative names).
        if (entry.name.startsWith('.')) continue;
        // Stage the copy in this run's private directory, then move it into
        // place: renameSync is atomic, so a concurrent run (or the dossier
        // builder reading the output) only ever sees a complete file.
        const staged = join(stageDir, `f${stagedCount++}`);
        copyFileSync(src, staged);
        renameSync(staged, dst);
      }
      // Anything else (a symlink or special file) is left out: the dossier
      // refuses it anyway, and this entry holds plain files only.
    }
  };
  walk(source, target);
  return readdirSync(source).length;
}

mkdirSync(outputDir, { recursive: true });
mkdirSync(stageDir, { recursive: true });
const gameEntries = copyEntryFolder('game');
const shotEntries = copyEntryFolder('screenshots');

const dossier = buildDossier(outputDir, DOSSIER_OPTIONS);
// Same atomic move for the dossier itself: write it beside its final name,
// then rename it into place, so a concurrent run never observes a
// half-written dossier.json.
const dossierStage = join(stageDir, 'dossier.json');
writeFileSync(dossierStage, dossier);
renameSync(dossierStage, join(outputDir, 'dossier.json'));

// Only this run ever touches its staging directory; remove it so the
// handed-in output holds exactly game/, screenshots/ and dossier.json.
rmSync(stageDir, { recursive: true, force: true });

console.log(
  `SOLMAR BAY: handed in ${gameEntries} game entries and ${shotEntries} screenshots to ${outputDir}`,
);
