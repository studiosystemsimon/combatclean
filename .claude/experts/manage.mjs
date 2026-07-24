#!/usr/bin/env node
// manage.mjs — the deterministic engine behind expert customisation.
//
// `.claude/experts/registry.json` is the single source of truth for this project's
// EXPERTS (the role-based subagents run-changeset routes to). This script mutates
// that registry and REGENERATES every scattered wiring spot from it, between clearly
// delimited marker regions, so add/disable never has to hand-edit five files.
//
// Usage (run from anywhere; Node 18+):
//   node .claude/experts/manage.mjs list
//   node .claude/experts/manage.mjs sync
//   node .claude/experts/manage.mjs add <spec.json>
//   node .claude/experts/manage.mjs disable <name>
//   node .claude/experts/manage.mjs enable  <name>
//
// The /add-expert and /disable-expert skills are the natural-language front-ends;
// this script is what they call. `sync` is idempotent — running it on an unchanged
// registry produces no diff.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));   // <repo>/.claude/experts
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');            // <repo>
const REGISTRY = path.join(SCRIPT_DIR, 'registry.json');
const DISABLED_DIR = path.join(SCRIPT_DIR, 'disabled');
const AGENTS_DIR = path.join(REPO_ROOT, '.claude', 'agents');

const GROUPS = ['execution', 'creative', 'advisory', 'gate'];
const MODELS = ['haiku', 'sonnet', 'opus'];

// ── registry io ────────────────────────────────────────────────────────────
function loadRegistry() {
  if (!fs.existsSync(REGISTRY)) fail(`No registry at ${rel(REGISTRY)}.`);
  let reg;
  try { reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); }
  catch (e) { fail(`registry.json is not valid JSON: ${e.message}`); }
  reg.teams = reg.teams || {};
  reg.experts = reg.experts || [];
  return reg;
}
function saveRegistry(reg) {
  fs.writeFileSync(REGISTRY, JSON.stringify(reg, null, 2) + '\n');
}

// ── validation ───────────────────────────────────────────────────────────────
function validate(reg) {
  const errs = [];
  const seen = new Set();
  for (const e of reg.experts) {
    if (!e.name) { errs.push('an expert has no name'); continue; }
    if (seen.has(e.name)) errs.push(`duplicate expert name: ${e.name}`);
    seen.add(e.name);
    if (!GROUPS.includes(e.group)) errs.push(`${e.name}: invalid group "${e.group}" (want ${GROUPS.join('|')})`);
    if (e.model && !MODELS.includes(e.model)) errs.push(`${e.name}: invalid model "${e.model}"`);
    for (const t of e.teams || []) {
      if (!reg.teams[t]) errs.push(`${e.name}: references unknown team "${t}"`);
    }
    if (isSelectable(e)) {
      for (const f of ['routeHint', 'ownsLabel', 'focus']) {
        if (!e[f]) errs.push(`${e.name}: selectable expert missing "${f}"`);
      }
      if (typeof e.order !== 'number' || typeof e.routePriority !== 'number') {
        errs.push(`${e.name}: selectable expert needs numeric order + routePriority`);
      }
    }
    if (e.group === 'advisory') {
      for (const f of ['consultFor', 'consultShort']) {
        if (!e[f]) errs.push(`${e.name}: advisory expert missing "${f}"`);
      }
    }
  }
  const enabledSelectable = reg.experts.filter((e) => e.enabled && isSelectable(e));
  if (enabledSelectable.length === 0) errs.push('no enabled selectable (execution/creative) experts — routing would have an empty vocabulary');
  if (errs.length) fail('registry validation failed:\n  - ' + errs.join('\n  - '));
}

const isSelectable = (e) => e.group === 'execution' || e.group === 'creative';
const byOrder = (a, b) => (a.order ?? 99) - (b.order ?? 99);
const byRoute = (a, b) => (a.routePriority ?? 99) - (b.routePriority ?? 99);
const tick = (s) => '`' + s + '`';

// ── renderers (must reproduce the seeded wiring byte-for-byte) ────────────────
function enabled(reg) { return reg.experts.filter((e) => e.enabled); }
function selectable(reg) { return enabled(reg).filter(isSelectable).sort(byOrder); }
function advisory(reg) { return enabled(reg).filter((e) => e.group === 'advisory').sort(byOrder); }

function renderExpertsArray(reg) {
  const names = [...selectable(reg).map((e) => e.name), 'general-purpose'];
  return `const EXPERTS = [${names.map((n) => `'${n}'`).join(', ')}];`;
}
function renderRoutingLine(reg) {
  const clauses = selectable(reg).slice().sort(byRoute).map((e) => `${e.routeHint} → ${e.name}`).join('; ');
  return `    '- expert (first match wins): explicit {expert:} tag; else ${clauses}; otherwise general-purpose.',`;
}
function renderExecRolesComma(reg) { return selectable(reg).map((e) => tick(e.name)).join(', '); }
function renderExecRolesSlash(reg) { return selectable(reg).map((e) => tick(e.name)).join(' / '); }
function renderAdvisoryInline(reg) {
  return advisory(reg).map((e) => `${tick(e.name)} (${e.consultShort})`).join(' or ');
}
function renderExecTable(reg) {
  return selectable(reg).map((e) => `| ${tick(e.name)} | ${e.ownsLabel} | ${e.focus} |`).join('\n');
}
function renderAdvisoryTable(reg) {
  return advisory(reg).map((e) => `| ${tick(e.name)} | ${e.consultFor} |`).join('\n');
}
function renderGovernance(reg) {
  const grp = (g, label) => {
    const names = enabled(reg).filter((e) => e.group === g).sort(byOrder).map((e) => tick(e.name));
    return names.length ? `${label} (${names.join(', ')})` : null;
  };
  const parts = [grp('execution', 'execution'), grp('creative', 'creative'), grp('advisory', 'read-only advisory')].filter(Boolean);
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function effectiveRefs(reg, e) {
  const refs = [...(e.references || [])];
  for (const t of e.teams || []) refs.push(...((reg.teams[t] && reg.teams[t].references) || []));
  return [...new Set(refs)];
}

// ── region replacement ────────────────────────────────────────────────────────
// Keeps the START/END tokens; rewrites only what's between them. Inline regions
// pass a bare string; block regions pass "\n<content>\n" so tokens stay on their
// own lines. Returns { text, found }.
function replaceRegion(text, start, end, inner) {
  const s = text.indexOf(start);
  if (s === -1) return { text, found: false };
  const afterStart = s + start.length;
  const e = text.indexOf(end, afterStart);
  if (e === -1) return { text, found: false };
  return { text: text.slice(0, afterStart) + inner + text.slice(e), found: true };
}
function block(content) { return `\n${content}\n`; }

// file (relative to repo root) → [ { start, end, inner(reg) } ]
function regionPlan(reg) {
  return {
    '.claude/workflows/run-changeset.mjs': [
      { start: '// EXPERTS:ARRAY:START', end: '// EXPERTS:ARRAY:END', inner: () => block(renderExpertsArray(reg)) },
      { start: '    // EXPERTS:ROUTING:START', end: '    // EXPERTS:ROUTING:END', inner: () => block(renderRoutingLine(reg)) },
    ],
    '.claude/skills/transcript-to-changeset/SKILL.md': [
      { start: '<!--EXPERTS:EXEC_ROLES:START-->', end: '<!--EXPERTS:EXEC_ROLES:END-->', inner: () => renderExecRolesComma(reg) },
      { start: '<!--EXPERTS:ADVISORY:START-->', end: '<!--EXPERTS:ADVISORY:END-->', inner: () => renderAdvisoryInline(reg) },
    ],
    '.claude/router/policy.md': [
      { start: '<!--EXPERTS:EXEC_ROLES_SLASH:START-->', end: '<!--EXPERTS:EXEC_ROLES_SLASH:END-->', inner: () => renderExecRolesSlash(reg) },
    ],
    '.claude/README.md': [
      { start: '<!-- EXPERTS:EXEC_TABLE:START -->', end: '<!-- EXPERTS:EXEC_TABLE:END -->', inner: () => block(renderExecTable(reg)) },
      { start: '<!-- EXPERTS:ADVISORY_TABLE:START -->', end: '<!-- EXPERTS:ADVISORY_TABLE:END -->', inner: () => block(renderAdvisoryTable(reg)) },
    ],
    // Root CLAUDE.md exists in a generated game (from templates/CLAUDE.md). Absent
    // in the framework repo itself → skipped gracefully.
    'CLAUDE.md': [
      { start: '<!--EXPERTS:GOVERNANCE:START-->', end: '<!--EXPERTS:GOVERNANCE:END-->', inner: () => renderGovernance(reg) },
    ],
  };
}

// ── agent .md ## References sections (injected from own + team references) ──────
const REF_START = '<!-- EXPERTS:REFERENCES:START -->';
const REF_END = '<!-- EXPERTS:REFERENCES:END -->';
function refsBlock(refs) {
  const lines = [
    REF_START,
    '## References',
    '',
    'Read these before starting (injected from the expert registry — do not edit by hand):',
    '',
    ...refs.map((r) => `- \`${r}\``),
    REF_END,
  ];
  return lines.join('\n');
}
function syncReferences(reg, changed) {
  for (const e of enabled(reg)) {
    const file = path.join(AGENTS_DIR, `${e.name}.md`);
    if (!fs.existsSync(file)) continue;
    let text = fs.readFileSync(file, 'utf8');
    const refs = effectiveRefs(reg, e);
    const s = text.indexOf(REF_START);
    let next = text;
    if (refs.length === 0) {
      if (s !== -1) {
        const eIdx = text.indexOf(REF_END, s);
        // strip the block plus one leading blank line if present
        const from = text.lastIndexOf('\n', s) >= 0 ? text.lastIndexOf('\n', s - 1) : s;
        next = (text.slice(0, from).replace(/\s+$/, '') + '\n' + text.slice(eIdx + REF_END.length).replace(/^\s+/, '\n')).replace(/\n{3,}/g, '\n\n');
      }
    } else if (s !== -1) {
      const r = replaceRegion(text, REF_START, REF_END, refsBlock(refs).slice(REF_START.length, -REF_END.length));
      next = r.text;
    } else {
      next = text.replace(/\s*$/, '') + '\n\n' + refsBlock(refs) + '\n';
    }
    if (next !== text) { fs.writeFileSync(file, next); changed.push(`.claude/agents/${e.name}.md`); }
  }
}

// ── commands ──────────────────────────────────────────────────────────────────
function cmdSync() {
  const reg = loadRegistry();
  validate(reg);
  const changed = [];
  const plan = regionPlan(reg);
  for (const [relPath, regions] of Object.entries(plan)) {
    const file = path.join(REPO_ROOT, relPath);
    if (!fs.existsSync(file)) continue;
    let text = fs.readFileSync(file, 'utf8');
    let fileChanged = false;
    for (const r of regions) {
      const res = replaceRegion(text, r.start, r.end, r.inner());
      if (res.found && res.text !== text) { text = res.text; fileChanged = true; }
      else if (res.found) { text = res.text; }
    }
    if (fileChanged) { fs.writeFileSync(file, text); changed.push(relPath); }
  }
  syncReferences(reg, changed);
  if (changed.length === 0) console.log('sync: already up to date (no changes).');
  else { console.log('sync: regenerated ->'); for (const c of [...new Set(changed)]) console.log(`  - ${c}`); }
  return changed;
}

function cmdList() {
  const reg = loadRegistry();
  const order = { execution: 0, creative: 1, advisory: 2, gate: 3 };
  const sorted = reg.experts.slice().sort((a, b) => (order[a.group] - order[b.group]) || byOrder(a, b));
  console.log(`Experts (${reg.experts.filter((e) => e.enabled).length} enabled / ${reg.experts.length} total):\n`);
  for (const e of sorted) {
    const flag = e.enabled ? ' ' : '✗';
    const teams = (e.teams || []).length ? `  teams: ${e.teams.join(', ')}` : '';
    const refs = effectiveRefs(reg, e).length ? `  refs: ${effectiveRefs(reg, e).length}` : '';
    console.log(`  [${flag}] ${e.name.padEnd(16)} ${e.group.padEnd(10)} ${e.model || '-'}  ${e.role || ''}${teams}${refs}`);
  }
  const teamNames = Object.keys(reg.teams);
  if (teamNames.length) {
    console.log('\nTeams:');
    for (const t of teamNames) console.log(`  - ${t}: ${(reg.teams[t].references || []).length} reference(s) — ${reg.teams[t].description || ''}`);
  }
}

function scaffoldAgent(e, spec) {
  const tools = isSelectable(e)
    ? 'Read, Grep, Glob, Bash, Edit, MultiEdit, Write'
    : 'Read, Grep, Glob, Bash';
  const description = spec.description || `${e.role}. ${isSelectable(e) ? `Owns ${e.owns.join(', ')}.` : 'Advisory / read-only.'}`;
  const ownsBody = e.ownsLabel || (e.owns || []).map((o) => `\`${o}\``).join(', ') || '_(no owned paths)_';
  const resp = (e.responsibilities || []).map((r) => `- ${r}`).join('\n') || '- _(fill in)_';
  const expertise = spec.expertise ? `\n${spec.expertise.trim()}\n` : '';
  const tail = isSelectable(e)
    ? [
        '## When it\'s not you',
        'Defer work outside your owned paths to the appropriate expert; escalate genuinely cross-cutting work rather than forcing it into one module.',
        '',
        '## Working inside a changeset',
        'When spawned by run-changeset, your CHANGE + ordered SUB-STEPS + the worktree/commit/self-check contract arrive in the prompt — follow them exactly. Apply your expertise above; don\'t restate the contract.',
      ].join('\n')
    : [
        '## Rules',
        '- **Read-only.** You never edit code, data, or docs. Your output is a recommendation an execution expert implements.',
        '',
        '## How you\'re invoked',
        `Directly (\`Agent({ subagent_type: "${e.name}", prompt: "..." })\`), or as an optional pre-flight while authoring a changeset. You are **not** a required step in \`run-changeset\` and never run inside a worktree.`,
      ].join('\n');
  return [
    '---',
    `name: ${e.name}`,
    `description: ${description}`,
    `tools: ${tools}`,
    `model: ${e.model}`,
    '---',
    '',
    `You are the **${e.name}** for this web game (see \`CLAUDE.md\` for the game's identity).`,
    expertise,
    '## You own',
    ownsBody,
    '',
    '## Responsibilities',
    resp,
    '',
    tail,
    '',
  ].join('\n');
}

function cmdAdd(specPath) {
  if (!specPath) fail('add: pass a spec JSON file — node .claude/experts/manage.mjs add <spec.json>');
  if (!fs.existsSync(specPath)) fail(`add: spec file not found: ${specPath}`);
  let spec;
  try { spec = JSON.parse(fs.readFileSync(specPath, 'utf8')); }
  catch (e) { fail(`add: spec is not valid JSON: ${e.message}`); }
  if (!spec.name) fail('add: spec needs a "name".');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(spec.name)) fail('add: name must be kebab-case (a-z, 0-9, dashes).');

  const reg = loadRegistry();
  if (reg.experts.some((e) => e.name === spec.name)) fail(`add: an expert named "${spec.name}" already exists (use enable/disable, or a different name).`);
  const group = spec.group || 'execution';
  if (!GROUPS.includes(group)) fail(`add: invalid group "${group}".`);

  // Create any brand-new teams named in the spec.
  reg.teams = reg.teams || {};
  for (const t of spec.teams || []) {
    if (!reg.teams[t]) reg.teams[t] = { description: (spec.newTeams && spec.newTeams[t] && spec.newTeams[t].description) || '', references: (spec.newTeams && spec.newTeams[t] && spec.newTeams[t].references) || [] };
  }

  const selectableExisting = reg.experts.filter(isSelectable);
  const advisoryExisting = reg.experts.filter((e) => e.group === 'advisory');
  const nextOrder = (arr) => (arr.length ? Math.max(...arr.map((e) => e.order ?? 0)) + 1 : 1);

  const e = {
    name: spec.name,
    group,
    enabled: true,
    model: spec.model || 'sonnet',
    role: spec.role || spec.name,
    owns: spec.owns || [],
    responsibilities: spec.responsibilities || [],
    teams: spec.teams || [],
    references: spec.references || [],
  };
  if (isSelectable(e)) {
    e.order = spec.order ?? nextOrder(selectableExisting);
    e.routePriority = spec.routePriority ?? (selectableExisting.length ? Math.max(...selectableExisting.map((x) => x.routePriority ?? 0)) + 1 : 1);
    e.routeHint = spec.routeHint || `mostly ${(e.owns[0] || 'src/**')}`;
    e.ownsLabel = spec.ownsLabel || e.owns.map((o) => `\`${o}\``).join(', ');
    e.focus = spec.focus || e.role;
  }
  if (group === 'advisory') {
    e.order = spec.order ?? nextOrder(advisoryExisting);
    e.consultFor = spec.consultFor || e.role;
    e.consultShort = spec.consultShort || e.role;
  }

  reg.experts.push(e);
  validate(reg);

  // Scaffold the agent definition file (unless one already exists — never clobber).
  const agentFile = path.join(AGENTS_DIR, `${e.name}.md`);
  if (!fs.existsSync(agentFile)) fs.writeFileSync(agentFile, scaffoldAgent(e, spec));

  saveRegistry(reg);
  console.log(`Added expert "${e.name}" (${e.group}, ${e.model}).`);
  console.log(`  - agent definition: .claude/agents/${e.name}.md`);
  cmdSync();
}

function cmdDisable(name) {
  if (!name) fail('disable: pass an expert name.');
  const reg = loadRegistry();
  const e = reg.experts.find((x) => x.name === name);
  if (!e) fail(`disable: no expert named "${name}".`);
  if (e.group === 'gate') fail(`disable: "${name}" is the functional gate — it cannot be disabled.`);
  if (!e.enabled) { console.log(`"${name}" is already disabled.`); return; }
  const enabledSelectable = reg.experts.filter((x) => x.enabled && isSelectable(x));
  if (isSelectable(e) && enabledSelectable.length <= 1) fail(`disable: "${name}" is the last enabled execution/creative expert — disabling it would leave routing with no specialists. Add another first.`);

  e.enabled = false;
  fs.mkdirSync(DISABLED_DIR, { recursive: true });
  const from = path.join(AGENTS_DIR, `${name}.md`);
  const to = path.join(DISABLED_DIR, `${name}.md`);
  if (fs.existsSync(from)) { fs.renameSync(from, to); console.log(`  - moved .claude/agents/${name}.md -> .claude/experts/disabled/${name}.md (not deleted)`); }
  saveRegistry(reg);
  console.log(`Disabled expert "${name}" (registry entry retained with enabled:false).`);
  cmdSync();
}

function cmdEnable(name) {
  if (!name) fail('enable: pass an expert name.');
  const reg = loadRegistry();
  const e = reg.experts.find((x) => x.name === name);
  if (!e) fail(`enable: no expert named "${name}".`);
  if (e.enabled) { console.log(`"${name}" is already enabled.`); return; }
  e.enabled = true;
  const from = path.join(DISABLED_DIR, `${name}.md`);
  const to = path.join(AGENTS_DIR, `${name}.md`);
  if (fs.existsSync(from)) { fs.renameSync(from, to); console.log(`  - restored .claude/experts/disabled/${name}.md -> .claude/agents/${name}.md`); }
  saveRegistry(reg);
  console.log(`Enabled expert "${name}".`);
  cmdSync();
}

// ── entry ─────────────────────────────────────────────────────────────────────
const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case 'sync': cmdSync(); break;
  case 'list': cmdList(); break;
  case 'add': cmdAdd(arg); break;
  case 'disable': cmdDisable(arg); break;
  case 'enable': cmdEnable(arg); break;
  default:
    console.log('Usage: node .claude/experts/manage.mjs <list|sync|add <spec.json>|disable <name>|enable <name>>');
    process.exit(cmd ? 1 : 0);
}

function rel(p) { return path.relative(REPO_ROOT, p) || p; }
function fail(msg) { console.error(`\nerror: ${msg}\n`); process.exit(1); }
