// arch-review — the architecture-enforcement orchestrator.
// Scouts the diff first, then runs only the agents whose trigger paths
// intersect with changed files. Skips agents with no relevant changes
// to keep cost proportional to the scope of each change.
//
// There is no separate "which agents to run" agent — that decision is cheap and
// deterministic (path-prefix matching + diff size), so it stays in-script rather
// than paying for an LLM call to make a computable decision. Every spawned agent
// pays a large FIXED boot cost (project context + tool schemas) independent of
// task size, so the dominant cost lever is the NUMBER of agents spawned, not how
// much each one does. Three levers live here: (1) a SMALL-DIFF fast path that
// collapses every triggered dimension into ONE agent call (a tiny diff doesn't
// need several agents each re-reading the same few lines), (2) for anything
// bigger, TIER-BUCKETING — one consolidated agent per model tier (at most 2 calls
// total: one haiku call covering every triggered mechanical/pattern-shaped rule,
// one sonnet call covering every triggered judgment-call rule) instead of one
// agent per dimension, since most dimensions in a tier trigger together anyway,
// and (3) per-dimension model tiers within those buckets — mechanical rules run
// on a cheaper model; the dimensions that need real judgment (the overriding
// view/logic split, composition-vs-inheritance calls, premature-generalization
// calls) stay on the stronger model.
//
// These agents are advisory + read-only — they report violations, they do not edit.

export const meta = {
  name: 'arch-review',
  description: 'Run architecture-enforcement agents (consolidated per model tier), filtered to changed file areas.',
  phases: [{ title: 'Scout' }, { title: 'Review' }, { title: 'Aggregate' }],
};

// A diff at or under these limits gets ONE consolidated review agent (applying
// every triggered dimension's rule in a single pass) instead of the tier-bucketed
// path below. Gated primarily on line count — a handful of trivial files (a
// README note + a couple of one-line call sites) is still a "small diff" even if
// it technically spans 3-4 files, and shouldn't pay for a second agent spawn.
const SMALL_DIFF_MAX_FILES = 4;
const SMALL_DIFF_MAX_LINES = 60;

// Optional diff scope. `args` may be:
//   - a non-empty string — a git ref or range such as "d0af0942..HEAD" — to review
//     that COMMITTED diff instead of the working tree (absent → working-tree diff).
//   - an object { range, changedFiles, totalLinesChanged } — same range behaviour,
//     PLUS pre-computed scout data. run-changeset's integrator agent already knows
//     every file it merged, so it reports this directly and we skip spawning our
//     own scout-diff agent to re-derive the same facts (one fewer fixed agent-boot
//     cost paid per run-changeset invocation).
const diffScope =
  (typeof args === 'string' && args.trim()) ? args.trim()
  : (args && typeof args === 'object' && typeof args.range === 'string' && args.range.trim()) ? args.range.trim()
  : null;
// Only trust caller-supplied data if it actually lists files — an empty array
// most likely means the caller's own report step was skipped/failed, not that
// zero files changed (a truly empty integration never reaches this workflow at
// all; run-changeset only invokes it after a non-empty merge). Falling back to
// the real scout agent in that case is the safe default over silently no-op'ing.
const precomputedScout =
  (args && typeof args === 'object' && Array.isArray(args.changedFiles) && args.changedFiles.length > 0)
    ? { changedFiles: args.changedFiles, totalLinesChanged: Number(args.totalLinesChanged) || 0 }
    : null;

// triggers: path prefixes (forward-slash) that must appear in at least one changed
// file for this agent to run. Derived from each agent's "use after" guidance.
// model: which tier-bucketed consolidated call (below) this dimension's rule gets
// folded into. Default 'haiku' — these are pattern-shaped checks (folder layout, construction
// sites, signal wiring, README presence, magic literals). The three that require
// real judgment calls stay on 'sonnet': `view` is the OVERRIDING hard rule and
// most consequential to get right; `composition` and `specificity` both hinge on
// a subjective read (is this inheritance load-bearing? is this abstraction
// premature or earned?) that a cheaper model is more likely to misjudge.
const AGENTS = [
  {
    type: 'arch-modularity', label: 'modularity', model: 'haiku',
    triggers: ['src/game/', 'src/view/', 'src/ui/', 'src/input/', 'src/app/', 'src/core/'],
  },
  {
    type: 'arch-di', label: 'di', model: 'haiku',
    triggers: ['src/game/', 'src/view/', 'src/ui/', 'src/input/', 'src/app/', 'src/core/'],
  },
  {
    type: 'arch-events', label: 'events', model: 'haiku',
    triggers: ['src/game/', 'src/view/', 'src/ui/'],
  },
  {
    type: 'arch-composition', label: 'composition', model: 'sonnet',
    triggers: ['src/game/'],
  },
  {
    type: 'arch-specificity', label: 'specificity', model: 'sonnet',
    triggers: ['src/game/', 'src/view/', 'src/ui/'],
  },
  {
    type: 'arch-view', label: 'view', model: 'sonnet',
    triggers: ['src/game/', 'src/view/', 'src/ui/'],
  },
  {
    type: 'arch-ui', label: 'ui', model: 'haiku',
    triggers: ['src/ui/'],
  },
  {
    type: 'arch-module-docs', label: 'module-docs', model: 'haiku',
    triggers: ['src/game/', 'src/view/', 'src/ui/', 'src/input/', 'src/app/', 'src/core/'],
  },
  {
    type: 'arch-data-values', label: 'data-values', model: 'haiku',
    triggers: ['src/game/', 'src/view/', 'src/ui/', 'src/input/'],
  },
];

// ── Phase 1: Scout the diff to decide which agents are needed ─────────────────
// This is the "which agents should run" decision the whole workflow needs — it's
// deliberately NOT its own judgment-based agent call. Which dimensions apply is a
// pure function of which paths changed (computable in-script below), and how many
// agents that fan-out needs is a pure function of diff size (also computable). An
// LLM call here would just be paying to make a decision plain arithmetic already
// makes. Scout's only job is to surface the raw facts (files + line count) that
// this script's own filtering (below) and the small-diff gate act on. Cheap model
// — this is transcription of a git command's output, not analysis. Skipped
// entirely when the CALLER already knows this (run-changeset's integrator agent
// touched every merged file, so it reports changedFiles/totalLinesChanged itself
// instead of paying for a second agent to re-derive the same facts via `git diff`).
phase('Scout');
let scouted;
if (precomputedScout) {
  log(`Using caller-supplied scout data — ${precomputedScout.changedFiles.length} changed file(s), ~${precomputedScout.totalLinesChanged} line(s). Skipping scout-diff agent.`);
  scouted = precomputedScout;
} else {
  const scoutCmd = diffScope
    ? `Run \`git diff --name-only ${diffScope}\` to list every file changed in that range, and \`git diff --shortstat ${diffScope}\` for the total line count.`
    : 'Run `git diff --name-only` and `git status --short` to list all modified, staged, and new files, and `git diff --shortstat` (plus `git diff --cached --shortstat` if anything is staged) for the total line count.';
  scouted = await agent(
    `${scoutCmd} Return every file path as a forward-slash string in changedFiles, and totalLinesChanged as the sum of insertions + deletions reported by --shortstat (0 if it reported nothing, e.g. new untracked files — estimate by counting lines in the new file instead). Nothing else.`,
    {
      label: 'scout-diff',
      model: 'haiku',
      schema: {
        type: 'object',
        properties: {
          changedFiles: { type: 'array', items: { type: 'string' } },
          totalLinesChanged: { type: 'number' },
        },
        required: ['changedFiles', 'totalLinesChanged'],
      },
    },
  );
}

const changedFiles = (scouted && scouted.changedFiles) ? scouted.changedFiles : null;

if (changedFiles === null) {
  log('Scout failed — falling back to running all agents.');
}

function isTriggered(agentDef) {
  if (changedFiles === null) return true;
  return agentDef.triggers.some((prefix) =>
    changedFiles.some((f) => f.replace(/\\/g, '/').includes(prefix)),
  );
}

const activeAgents = AGENTS.filter(isTriggered);
const skippedAgents = AGENTS.filter((a) => !isTriggered(a));

if (changedFiles !== null) {
  log(`${changedFiles.length} changed file(s) → running ${activeAgents.length}/${AGENTS.length} agents.`);
  if (skippedAgents.length > 0) {
    log(`Skipped (no changes in scope): ${skippedAgents.map((a) => a.label).join(', ')}`);
  }
}

if (activeAgents.length === 0) {
  log('No review agents triggered — no changes in monitored src/ paths.');
  return [];
}

// ── Phase 2: Review — ONE consolidated agent (small diff) or at most TWO,
// bucketed by model tier (everything else). Never one-agent-per-dimension: most
// dimensions in a tier trigger together anyway (touch src/game or src/ui and
// nearly every haiku-tier rule applies), so paying N separate fixed agent-boot
// costs to have N agents each independently conclude "clean" on the same diff is
// pure waste. ─────────────────────────────────────────────────────────────────
phase('Review');

const CONSOLIDATED_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { dimension: { type: 'string' }, report: { type: 'string' } },
        required: ['dimension', 'report'],
      },
    },
  },
  required: ['findings'],
};

function consolidatedPrompt(agentsSubset) {
  return [
    `Apply ${agentsSubset.length > 1 ? 'MULTIPLE architecture rules' : 'this architecture rule'} in one pass`,
    agentsSubset.length > 1 ? 'rather than one agent per rule.' : '.',
    diffScope
      ? `Review the committed diff via \`git diff ${diffScope}\` (run that exact command).`
      : 'Review the current working-tree diff (your own `git diff`/`git status`).',
    '',
    'For EACH rule below: read its definition file in full, then apply ONLY that rule to the diff.',
    'Rules to apply (dimension → definition file):',
    ...agentsSubset.map((a) => `- ${a.label} → .claude/agents/${a.type}.md`),
    '',
    'Return one findings entry per rule above (same `dimension` labels), each `report` either',
    '"clean" or concrete violations as `file:line — issue — minimal fix`. Be concise per rule —',
    agentsSubset.length > 1 ? "you're covering several rules, not writing an essay on one." : 'be concise.',
  ].join('\n');
}

async function runConsolidated(agentsSubset, model, label) {
  if (agentsSubset.length === 0) return [];
  const result = await agent(consolidatedPrompt(agentsSubset), {
    label, phase: 'Review', model, schema: CONSOLIDATED_SCHEMA,
  }).catch(() => null);
  return result?.findings?.length
    ? result.findings
    : agentsSubset.map((a) => ({ dimension: a.label, report: '(consolidated agent failed to run)' }));
}

const isSmallDiff =
  changedFiles !== null &&
  changedFiles.length > 0 &&
  changedFiles.length <= SMALL_DIFF_MAX_FILES &&
  (scouted?.totalLinesChanged ?? Infinity) <= SMALL_DIFF_MAX_LINES;

let results;
if (isSmallDiff) {
  log(`Small diff (${changedFiles.length} file(s), ~${scouted.totalLinesChanged} line(s)) — running ONE consolidated agent for all ${activeAgents.length} triggered dimension(s).`);
  results = await runConsolidated(activeAgents, 'sonnet', 'consolidated-review');
} else {
  const haikuAgents = activeAgents.filter((a) => (a.model || 'sonnet') === 'haiku');
  const sonnetAgents = activeAgents.filter((a) => (a.model || 'sonnet') !== 'haiku');
  const bucketCount = (haikuAgents.length > 0 ? 1 : 0) + (sonnetAgents.length > 0 ? 1 : 0);
  log(`Bucketing ${activeAgents.length} triggered dimension(s) into ${bucketCount} consolidated agent(s) by model tier (haiku: ${haikuAgents.length}, sonnet: ${sonnetAgents.length}).`);
  const buckets = await parallel([
    () => runConsolidated(haikuAgents, 'haiku', 'consolidated-review-haiku'),
    () => runConsolidated(sonnetAgents, 'sonnet', 'consolidated-review-sonnet'),
  ]);
  results = buckets.flat();
}

phase('Aggregate');
const findings = results.filter(Boolean);
const skipNote = skippedAgents.length > 0 ? ` (${skippedAgents.length} skipped — out of scope)` : '';
log(`arch-review complete: ${findings.length}/${activeAgents.length} dimensions reported${skipNote}.`);
return findings;
