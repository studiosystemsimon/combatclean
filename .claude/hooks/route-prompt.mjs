// route-prompt.mjs — GENERIC UserPromptSubmit router hook.
//
// Portable across projects: contains NO project-specific paths or vocabulary.
// It reads the hook JSON on stdin, resolves raw-mode, and (when routing is on)
// injects the project's routing policy — the block between the ROUTER:INJECT
// markers in `.claude/router/policy.md` — as additional context for the turn.
//
// Raw-mode precedence (first match wins → inject NOTHING):
//   1. global toggle   ~/.claude/router-global-raw            (all sessions, every project)
//   2. repo toggle     <cwd>/.claude/.router-mode == "raw"    (this project)
//   3. per-prompt sigil  prompt starts with "raw:" or "!!"    (this message only)
// Also injects nothing for slash-commands ("/…") and short acknowledgements.
//
// FAIL-OPEN: if there is no policy file or no INJECT block, inject nothing — a
// freshly copied-in repo behaves normally until a policy is authored.
//
// Registered in .claude/settings.json under hooks.UserPromptSubmit. Dependency-free
// (Node built-ins only) so it stays fast on every prompt.

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_SIGILS = ['raw:', '!!'];
const ACKS = new Set([
  'yes', 'y', 'yep', 'yeah', 'ok', 'okay', 'sure', 'go', 'continue',
  'proceed', 'next', 'done', 'stop', 'no', 'n', 'nope',
]);
const INJECT_START = '<!-- ROUTER:INJECT:START -->';
const INJECT_END = '<!-- ROUTER:INJECT:END -->';

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  let data = {};
  try {
    data = JSON.parse(readStdin() || '{}');
  } catch {
    data = {};
  }
  const prompt = typeof data.prompt === 'string' ? data.prompt : '';
  const cwd = typeof data.cwd === 'string' && data.cwd ? data.cwd : process.cwd();

  // 1. global power-user toggle — raw everywhere.
  if (existsSync(join(homedir(), '.claude', 'router-global-raw'))) return;

  // Optional per-project config (only used to override sigils).
  let sigils = DEFAULT_SIGILS;
  try {
    const cfgPath = join(cwd, '.claude', 'router', 'config.json');
    if (existsSync(cfgPath)) {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
      if (Array.isArray(cfg.sigils) && cfg.sigils.length) sigils = cfg.sigils.map(String);
    }
  } catch {
    /* bad config — fall back to defaults */
  }

  // 2. repo toggle.
  try {
    const modePath = join(cwd, '.claude', '.router-mode');
    if (existsSync(modePath)) {
      const mode = readFileSync(modePath, 'utf8').trim().toLowerCase();
      if (mode === 'raw') return;
    }
  } catch {
    /* ignore */
  }

  const trimmed = prompt.trim();
  const lower = trimmed.toLowerCase();

  // 3. per-prompt sigil.
  if (sigils.some((s) => lower.startsWith(String(s).toLowerCase()))) return;

  // Skip: explicit slash-command / skill invocation.
  if (trimmed.startsWith('/')) return;

  // Skip: short acknowledgements (1–3 words, all in the ack list).
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (
    words.length > 0 &&
    words.length <= 3 &&
    words.every((w) => ACKS.has(w.replace(/[.!,?]+$/, '').toLowerCase()))
  ) {
    return;
  }

  // Inject the project's routing policy (the INJECT block of policy.md).
  try {
    const policyPath = join(cwd, '.claude', 'router', 'policy.md');
    if (!existsSync(policyPath)) return; // fail-open
    const text = readFileSync(policyPath, 'utf8');
    const a = text.indexOf(INJECT_START);
    const b = text.indexOf(INJECT_END);
    if (a === -1 || b === -1 || b <= a) return; // fail-open
    const block = text.slice(a + INJECT_START.length, b).trim();
    if (block) process.stdout.write(block + '\n');
  } catch {
    /* fail-open */
  }
}

main();
