// assess-whisper.mjs — recommend a local whisper.cpp model for THIS machine (or advise against it).
//
// Used two ways:
//   1. At scaffold time — new-game.mjs imports `assessWhisper()` when you opt into audio, to suggest
//      a model before writing marksman.config.json.
//   2. Later, by hand — `node scripts/assess-whisper.mjs` prints a recommendation; add `--json` for
//      machine-readable output.
//
// Heuristic only: it profiles total RAM + CPU cores (GPU acceleration isn't reliably detectable
// cross-platform from Node, so it assumes CPU inference — the conservative case). whisper.cpp runs on
// CPU fine; more RAM/cores just means a bigger model transcribes accurately at usable latency.
//
// The tool degrades safely regardless: if the recommended model isn't actually installed at
// <whisperDir>/models/, the audio feature reports available:false with a reason — it never crashes.

import os from "node:os";
import { fileURLToPath } from "node:url";

const GB = 1024 ** 3;

// Model tiers, smallest → largest. `minRamGB` is a rough floor of TOTAL system RAM for the model to
// run at usable latency alongside a dev server + browser; `diskMB` is the model download size.
// Exported so the scaffolder (new-game.mjs) can validate an explicit `--audio <model>` choice.
export const MODELS = [
  { key: "tiny", model: "ggml-tiny.en.bin", minRamGB: 2, diskMB: 75, quality: "roughest" },
  { key: "base", model: "ggml-base.en.bin", minRamGB: 4, diskMB: 145, quality: "good enough for notes" },
  { key: "small", model: "ggml-small.en.bin", minRamGB: 8, diskMB: 490, quality: "solid" },
  { key: "medium", model: "ggml-medium.en.bin", minRamGB: 16, diskMB: 1500, quality: "high" },
  { key: "large-v3-turbo", model: "ggml-large-v3-turbo.bin", minRamGB: 24, diskMB: 1600, quality: "best" },
];

/**
 * Profile the machine and recommend a whisper model.
 * @returns {{
 *   profile: { totalRamGB: number, freeRamGB: number, cpuCores: number, platform: string, arch: string },
 *   recommended: { key: string, model: string, quality: string, diskMB: number } | null,
 *   reason: string,
 *   options: Array<{ key: string, model: string, diskMB: number, quality: string, fits: boolean }>,
 * }}
 */
export function assessWhisper() {
  const totalRamGB = os.totalmem() / GB;
  const freeRamGB = os.freemem() / GB;
  const cpuCores = os.cpus()?.length ?? 1;
  const profile = {
    totalRamGB: round1(totalRamGB),
    freeRamGB: round1(freeRamGB),
    cpuCores,
    platform: process.platform,
    arch: process.arch,
  };

  const options = MODELS.map((m) => ({ ...m, fits: totalRamGB >= m.minRamGB }));

  // Below the smallest model's floor, or too few cores to be usable → advise against local whisper.
  if (totalRamGB < MODELS[0].minRamGB || cpuCores < 2) {
    return {
      profile,
      recommended: null,
      reason:
        `This machine (${profile.totalRamGB} GB RAM, ${cpuCores} core${cpuCores === 1 ? "" : "s"}) is below a ` +
        `usable floor for local whisper.cpp. Recommend NOT installing audio transcription — write notes by ` +
        `hand, or use an online transcription service (a planned follow-up; see ` +
        `src/marksman/features/audio/README.md).`,
      options,
    };
  }

  // Pick the largest model whose RAM floor we clear; nudge down one tier on a low core count so
  // latency stays bearable (bigger models are much slower per second of audio on few cores).
  let pick = [...MODELS].reverse().find((m) => totalRamGB >= m.minRamGB) ?? MODELS[0];
  if (cpuCores <= 4) {
    const idx = MODELS.findIndex((m) => m.key === pick.key);
    if (idx > 1) pick = MODELS[idx - 1]; // don't drop below `base` on a machine that cleared its floor
  }

  return {
    profile,
    recommended: { key: pick.key, model: pick.model, quality: pick.quality, diskMB: pick.diskMB },
    reason:
      `${profile.totalRamGB} GB RAM + ${cpuCores} cores → \`${pick.key}\` (${pick.model}, ~${pick.diskMB} MB, ` +
      `${pick.quality}). Larger models transcribe more accurately but need more RAM and run slower on CPU.`,
    options,
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// ── CLI ───────────────────────────────────────────────────────────────────────
// Run directly (`node scripts/assess-whisper.mjs [--json]`) to print a recommendation.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const r = assessWhisper();
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else {
    const p = r.profile;
    console.log(`whisper model assessment`);
    console.log(`  machine: ${p.totalRamGB} GB RAM (${p.freeRamGB} free), ${p.cpuCores} cores, ${p.platform}/${p.arch}`);
    if (r.recommended) {
      console.log(`  recommended: ${r.recommended.key}  (${r.recommended.model}, ~${r.recommended.diskMB} MB)`);
    } else {
      console.log(`  recommended: (none — audio transcription not advised on this machine)`);
    }
    console.log(`  ${r.reason}`);
    console.log(`  models: ${r.options.map((o) => `${o.key}${o.fits ? "" : "✗"}`).join(", ")}  (✗ = needs more RAM)`);
  }
}
