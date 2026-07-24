// postinstall: make sure git-lfs is wired up so binary art (*.png, audio, fonts)
// is real bytes, not 130-byte pointer stubs. Non-fatal — warns and continues if
// git-lfs isn't installed, so `npm install` never hard-fails on a fresh machine.

import { execSync } from 'node:child_process';

function tryRun(cmd) {
  try {
    execSync(cmd, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const hasLfs = tryRun('git lfs version');
if (!hasLfs) {
  console.warn(
    '[lfs-setup] git-lfs not found on PATH. Binary assets tracked by LFS will ' +
    'stay as pointer stubs and image/audio loads will fail.\n' +
    '            Install from https://git-lfs.com then run: git lfs install && git lfs pull',
  );
  process.exit(0);
}

// Only meaningful inside a git work tree.
if (!tryRun('git rev-parse --is-inside-work-tree')) {
  console.log('[lfs-setup] Not a git repo yet — skipping LFS smudge/pull.');
  process.exit(0);
}

tryRun('git lfs install');
if (tryRun('git lfs pull')) {
  console.log('[lfs-setup] git-lfs ready; blobs pulled.');
} else {
  console.warn('[lfs-setup] git lfs pull failed (no remote yet?) — re-run after first fetch.');
}
