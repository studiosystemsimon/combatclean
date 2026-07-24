// run-changeset — the changeset executor (the SOLE runner).
//
// Runs the whole deterministic pipeline as code:
//   Parse     → an agent reads + parses the changeset into changes + routing, AND
//               annotates each change with `provides`/`requires` tokens (symbols/
//               types/states/data-keys it introduces vs. assumes already exist).
//               A pure-JS graph pass turns those into a dependency edge set and
//               assigns each change to wave 1 (no known dependency) or wave 2
//               (requires something another change in this set provides).
//   Implement → WAVE 1: one isolated-worktree agent per wave-1 change, in parallel,
//               cut from `main` (unchanged from before). Each commits its own
//               branch and returns a structured report — including, if it hits a
//               dependency the parse step DIDN'T predict, a `blocked` sub-step
//               status (never a silent scope cut).
//   Integrate → ONE Bash agent merges the clean wave-1 branches onto a fresh
//               INTEGRATION branch in its own dedicated worktree (repo ROOT never
//               touched).
//   Implement → WAVE 2: changes parse-time-flagged as dependent, PLUS any wave-1
//               change that self-reported `blocked` (the runtime safety net for
//               dependencies the graph pass missed), are retried NOW — cut from
//               the INTEGRATION branch (which already has the wave-1 producers'
//               output), not from `main`. These agents manage their own worktree
//               via Bash (mirrors the integrator's pattern) since the harness's
//               built-in worktree isolation always cuts from the default branch.
//   Integrate → the same integrator pattern appends the clean wave-2 branches onto
//               the SAME integration branch/worktree.
//   Gate      → the `qa` agent runs a CONSOLIDATED functional check (tsc + build +
//               the game's test/balance harness + determinism grep + a content-
//               coverage check) over the WHOLE integration branch, after BOTH
//               waves — catches cross-change type/build breaks the per-change
//               self-checks cannot see, and catches entities left missing
//               generated content for a newly-added enum/state member even when
//               every agent reported success (the concrete failure mode this
//               two-wave design exists for: a change that adds new members to a
//               per-entity content enum, and a change that regenerates per-entity
//               content, running in parallel without either seeing the other).
//   Review    → the canonical `arch-review` runs over the integrated range, but
//               ONLY once qa has already PASSED (unless TUNING-only, which skips
//               review entirely).
//   Report    → completeness is aggregated in-script from the structured reports
//               across both waves.
//
// SAFETY MODEL (safe to run unattended, even with unrelated uncommitted work present):
//   The script sandbox has no Bash/filesystem, so it CANNOT touch git itself — all git
//   runs inside worker agents, which work ONLY in dedicated worktrees (wave 1 via the
//   harness's isolation:'worktree'; the integrator and wave 2 via self-managed worktrees
//   under `.claude/worktrees/`). Nothing ever checks out, stashes, resets, or cleans the
//   repo ROOT, so unrelated uncommitted changes there are safe. The single irreversible
//   step — fast-forwarding `main` — is deliberately NOT done here; the workflow hands
//   back a reviewed integration branch + worktree and the exact ff command. A bad run is
//   discarded with `git worktree remove --force … && git branch -D …`, never a `main`
//   revert.
//
// Invoke:  Workflow({ scriptPath: ".claude/workflows/run-changeset.mjs", args: "changesets/CHANGES_001.md" })
//   args = changeset path (optional; if absent the parse agent picks the most
//   recently modified file under changesets/).
//
// DEPENDENCY MODEL. Three complementary layers, cheapest/most-general first:
//   1. STRUCTURAL PREDICTION (Parse phase): every change declares `provides` (symbols/
//      types/states/data-keys it introduces) and `requires` (ones it assumes exist). A
//      pure-JS pass (no agent) matches requires against provides across the change set
//      and schedules a dependent change into wave 2 automatically — it never even
//      attempts wave 1. This generalizes what used to be a single hardcoded special case
//      (art produced → renderer consumes it); that case still gets called out explicitly
//      in the parse instructions as a worked example, but the mechanism is general now.
//   2. RUNTIME SAFETY NET (`blocked` self-report): prediction from changeset prose is
//      necessarily lossy — an LLM parsing text before any code exists is guessing at
//      symbols that don't exist yet. If a wave-1 agent discovers mid-flight that a
//      sub-step needs something that isn't there, it MUST report that sub-step
//      `blocked` (with what's missing) rather than quietly narrowing its own scope to
//      "done". Blocked changes get one automatic wave-2 retry against the post-wave-1
//      integration branch — no human round-trip needed for the common case.
//   3. OUTCOME-LEVEL INVARIANT CHECK (qa gate): even (1)+(2) only catch dependencies
//      someone thought to name. The qa gate directly verifies content-coverage
//      invariants on the RESULT (e.g. "every entity has content for every member of a
//      per-entity enum") regardless of how the integrated diff got there — the backstop
//      for a dependency nobody modeled.

export const meta = {
  name: 'run-changeset',
  description: 'Autonomously execute a changeset onto an integration branch across up to two dependency-aware implement waves: fan out worktree agents per change, merge clean branches onto integration/<slug>, retry dependent/blocked changes in a second wave, run arch-review, run a consolidated qa gate (tsc/build/harness/content-coverage) over the integrated result, and report completeness. Never touches main.',
  phases: [
    { title: 'Parse' },
    { title: 'Implement wave 1' },
    { title: 'Integrate wave 1' },
    { title: 'Implement wave 2' },
    { title: 'Integrate wave 2' },
    { title: 'Gate' },
    { title: 'Review' },
    { title: 'Report' },
  ],
};

// ── Constants (routing vocabulary — mirrors the skill) ────────────────────────
const CATEGORIES = ['CHANGES', 'FIXES', 'TUNING', 'FEATURES', 'VISUAL'];
// EXPERTS:ARRAY:START
const EXPERTS = ['engineer', 'ui', 'game-tuning', 'tech-artist', 'artist', 'merge-icon-author', 'general-purpose'];
// EXPERTS:ARRAY:END
// ^ Generated from .claude/experts/registry.json by .claude/experts/manage.mjs — do
//   not hand-edit the line between the markers; edit the registry and run `sync`.
const MODELS = ['haiku', 'sonnet', 'opus'];
// arch-review self-filters by changed-file path, so the only safe PRE-skip is a
// changeset that is DEFINITIONALLY data-only: every change is TUNING (pure
// src/data/*.json value edits, no code). Anything else — including CHANGES/VISUAL,
// which routinely touch code/wiring — runs review and lets arch-review's own path
// scout decide (it cheaply no-ops if no monitored path changed). This closes the
// gap where a real fix mislabelled CHANGES silently skipped the architecture gate.
const DATA_ONLY_CATEGORY = 'TUNING';

const changesetArg = (typeof args === 'string' && args.trim()) ? args.trim() : null;

// ── Phase 1: Parse + route + dependency graph ─────────────────────────────────
// The script can't read files, so an agent parses the changeset AND makes the
// per-change model/expert routing calls the skill's Step 2 describes, PLUS names
// what each change provides/requires so a pure-JS pass can schedule waves.
phase('Parse');

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    changesetPath: { type: 'string' },
    slug: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          branch: { type: 'string' },
          category: { type: 'string', enum: CATEGORIES },
          expert: { type: 'string', enum: EXPERTS },
          model: { type: 'string', enum: MODELS },
          subSteps: { type: 'array', items: { type: 'string' } },
          // Committed repo-relative paths to visual context for this change — a
          // Marksman capture's screenshot.png / annotations.json, staged under
          // `changesets/assets/<slug>/` so they are visible INSIDE the implementer's
          // worktree (which is cut from a committed branch; `.cache/**` is gitignored
          // and would NOT be checked out). Empty/absent for text-only changes.
          attachments: { type: 'array', items: { type: 'string' } },
          // Dependency-graph tokens (short strings like "EnumName.newMember",
          // "data-file.json:key", "GameSignals.someEvent"). Empty arrays are fine
          // — most changes provide/require nothing cross-change.
          provides: { type: 'array', items: { type: 'string' } },
          requires: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'branch', 'category', 'expert', 'model', 'subSteps'],
      },
    },
  },
  required: ['changesetPath', 'slug', 'changes'],
};

const plan = await agent(
  [
    changesetArg
      ? `Read the changeset markdown file at "${changesetArg}".`
      : 'Find the most recently modified markdown file under `changesets/` (Glob + git/ls by mtime), then read it. Report which file you chose as changesetPath.',
    '',
    'Parse it per these rules:',
    '- Categories are top-level headings whose text (case-insensitive, punctuation-ignored) is one of CHANGES / FIXES / TUNING / FEATURES / VISUAL. If the file has no category headings, treat every change as category CHANGES.',
    '- A CHANGE is a unit nested under a category (a deeper heading, or a top-level list item). A change heading may carry a `{expert: <role>}` tag — strip it from the title and honour it.',
    '- SUB-STEPS are the ordered items nested under a change; if none, the change body is a single sub-step.',
    '- ATTACHMENTS: a change may carry an `Attachments:` line (or an `**Attachments:**` bullet) listing',
    '  one or more repo-relative file paths — a Marksman capture\'s screenshot.png / annotations.json,',
    '  staged under `changesets/assets/<slug>/`. Collect those paths into the change\'s `attachments`',
    '  array (verbatim, do NOT invent or alter paths). Omit the field if there is no such line. These are',
    '  visual/identity context for the implementer, NOT sub-steps — never turn an attachment path into a',
    '  sub-step.',
    '',
    'NORMALIZE producer→consumer pairs (art→renderer): if the changeset contains a separate',
    'asset-GENERATION change (creates a sprite/skin/key-art/background under `public/**` or a',
    '`*.png`) AND a separate renderer/slicer change (`src/view/**` or the asset-pipeline module) that',
    'CONSUMES that SAME asset, MERGE them into ONE change whose ordered sub-steps are [generate',
    'the real asset FIRST, then wire it into the renderer]. The consumer needs the producer’s',
    'actual output, and sub-steps run strictly in order in one worktree — so this dependency is',
    'satisfied without any cross-change scheduling. Route the merged change to `artist` (art-first',
    'quality) or `tech-artist`. NEVER emit such a pair as two independent changes. This is one',
    'concrete case of the GENERAL dependency mechanism below — apply that mechanism for every',
    'other case instead of inventing more hardcoded pairs.',
    '',
    'DEPENDENCY TOKENS — for EVERY change, also fill `provides` and `requires` (empty arrays are',
    'fine and common). These let a later pass schedule genuinely dependent changes into a second',
    'wave automatically, instead of running them in parallel against code that does not exist yet.',
    '- `provides`: symbols/types/enum-members/data-keys/signals this change INTRODUCES that another',
    '  change in THIS SAME changeset might need. Examples: "AnimStateKey.newVariant",',
    '  "combat.json:someNewKey", "GameSignals.someNewEvent", "ItemType.newKind". Do NOT list things',
    '  that already exist before this changeset — only genuinely NEW symbols/states.',
    '- `requires`: symbols/types/enum-members/data-keys/signals this change ASSUMES exist (whether',
    '  pre-existing OR introduced by another change in this changeset) because a sub-step reads,',
    '  extends, or generates content keyed to them. Examples: a sub-step "regenerate content for the',
    '  new enum members" requires the enum type (or the specific new members if named); a sub-step',
    '  "wire the HUD to the new signal" requires that signal\'s name.',
    '- Use short, consistent, dotted-style tokens (`Type.member`, `file:key`, `Namespace.name`) so a',
    '  plain substring match across changes can find the overlap — do not write full sentences here.',
    '- If you cannot name a specific token but suspect a change reads output another change produces,',
    '  still write your best-guess token rather than leaving `requires` empty — a false-positive edge',
    '  only costs one extra wave-2 attempt; a missed edge costs a silent gap in the shipped result.',
    '',
    'For EACH change, pick routing:',
    '- model (cheapest that fits): TUNING→haiku; FIXES/VISUAL→haiku or sonnet; CHANGES→sonnet; FEATURES→sonnet or opus (opus only for cross-cutting / subtle timing-math / architecturally load-bearing). When unsure, sonnet.',
    // EXPERTS:ROUTING:START
    '- expert (first match wins): explicit {expert:} tag; else TUNING or all-sub-steps-in-src/data → game-tuning; asset generation (public/**, *.png) → artist; mostly the merge chains — merge-item + generator icon ladders and their wiring (assets/combatclean/merge, config chains + ui/generators presentation, merge entries in assets.json / src/data/assets.js) → merge-icon-author; mostly src/ui → ui; mostly src/view or the asset-pipeline module → tech-artist; mostly src/game|core|app|input (or src/data/types.ts) → engineer; otherwise general-purpose.',
    // EXPERTS:ROUTING:END
    '- branch: kebab-case of the title (suffix -2, -3 on collision).',
    '',
    'Also return `slug`: a kebab-case slug for the whole changeset (from the filename, minus extension).',
    'Return ONLY the structured plan.',
  ].join('\n'),
  { label: 'parse-changeset', model: 'sonnet', phase: 'Parse', schema: PLAN_SCHEMA },
);

if (!plan || !plan.changes || plan.changes.length === 0) {
  log('Parse failed or changeset has no changes — aborting.');
  return { ok: false, reason: 'parse-failed' };
}

const changes = plan.changes;
const integrationBranch = `integration/${plan.slug}`;
log(`Parsed ${changes.length} change(s) from ${plan.changesetPath} → will integrate onto ${integrationBranch}.`);
for (const c of changes) log(`  [${c.category}] ${c.title} → ${c.expert} / ${c.model}`);

// ── Dependency graph (pure JS, no agent) ───────────────────────────────────────
// Heuristic, not a full topological sort: substring-matches `requires` tokens
// against every OTHER change's `provides` tokens. Any hit schedules the requiring
// change into wave 2 — it is not even attempted in wave 1, saving a doomed
// attempt. This deliberately does not handle multi-level chains or cycles; the
// `blocked` self-report (below) is the backstop for anything this heuristic
// misses or gets subtly wrong.
function normalizeToken(s) {
  return String(s || '').toLowerCase().replace(/[`'"]/g, '').trim();
}

function computeDependencies(list) {
  const provides = list.map((c) => (c.provides || []).map(normalizeToken).filter(Boolean));
  const dependsOn = list.map(() => new Set());
  list.forEach((c, i) => {
    const reqs = (c.requires || []).map(normalizeToken).filter(Boolean);
    reqs.forEach((req) => {
      list.forEach((_other, j) => {
        if (i === j) return;
        const hit = provides[j].some((p) => p === req || p.includes(req) || req.includes(p));
        if (hit) dependsOn[i].add(j);
      });
    });
  });
  return dependsOn;
}

const dependsOn = computeDependencies(changes);
changes.forEach((c, i) => {
  c._wave = dependsOn[i].size > 0 ? 2 : 1;
  c._dependsOnTitles = [...dependsOn[i]].map((j) => changes[j].title);
});

const predictedWave2 = changes.filter((c) => c._wave === 2);
if (predictedWave2.length > 0) {
  log(`Dependency graph: ${predictedWave2.length} change(s) scheduled directly to wave 2 (depends on another change in this set):`);
  for (const c of predictedWave2) log(`  - ${c.title} → depends on: ${c._dependsOnTitles.join(', ')}`);
} else {
  log('Dependency graph: no cross-change requires/provides overlap detected — all changes start in wave 1.');
}

// ── Shared schema + prompt builder for change-implementer agents ──────────────
const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    worktreePath: { type: 'string' },
    success: { type: 'boolean' }, // true only if EVERY sub-step completed (status 'done')
    subSteps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          step: { type: 'string' },
          status: { type: 'string', enum: ['done', 'blocked', 'failed'] },
          note: { type: 'string' },
          // Only for status='blocked': the specific missing symbol/state/file this
          // step needed but could not find in the worktree. Feeds the wave-2 retry
          // and the final completeness report — never leave this vague.
          blockedOn: { type: 'string' },
        },
        required: ['step', 'status'],
      },
    },
    selfCheck: { type: 'string' }, // 'clean' or the remaining violations
    // Optional audit trail: which attachment paths (if any) you actually opened to
    // ground the work. Omit when the change had no attachments.
    attachmentsUsed: { type: 'array', items: { type: 'string' } },
  },
  required: ['branch', 'success', 'subSteps', 'selfCheck'],
};

function sharedRules(c) {
  return [
    'Rules:',
    '- Implement real code changes per each sub-step. Honour every rule in CLAUDE.md',
    '  (data/logic/view/ui separation, all tuning in src/data/*.json via the store,',
    '  update the module README.md + CLAUDE.md Module index for structural changes).',
    '- VERIFY, do not assume: if a sub-step names a specific signal, event, or function',
    '  whose exact TIMING or semantics matter (e.g. "hide X when Y starts"), grep for',
    '  where it is actually dispatched/called and read the surrounding logic BEFORE',
    "  wiring it up — do not trust that a signal's name matches its real firing point.",
    '  A signal name that merely sounds right can fire at the wrong moment in the',
    '  lifecycle (e.g. on object creation rather than on the phase transition it sounds',
    '  like it means); the qa gate will catch a wrong-signal guess, but verifying the',
    '  dispatch site first avoids the wasted round-trip. Note what you verified in your',
    '  selfCheck.',
    '- BLOCKED vs FAILED — this distinction matters, use it precisely: if a sub-step needs',
    '  a symbol/type/state/data-key that does not exist in this worktree and you believe',
    "  ANOTHER change in this same changeset is supposed to introduce it, mark that step",
    '  `blocked` (not `failed`, and NEVER silently narrow your own scope to something the',
    '  sub-step did not ask for) and set `blockedOn` to the exact missing thing (e.g.',
    '  "ItemType.newKind does not exist in src/data/types.ts yet"). A blocked step gets an',
    '  automatic retry once the dependency lands — a `failed` step does not. Reserve',
    '  `failed` for a step that is blocked on nothing external — a real bug, missing tool,',
    '  or a genuinely impossible instruction.',
    '  (Concrete failure mode this exists for: a content-regeneration change once found the',
    '  new enum members it was asked to cover did not exist in the shared types file yet —',
    '  it quietly regenerated content only for the pre-existing members and reported',
    '  success. That silently shipped entities with no distinct content for the new',
    '  members. Reporting `blocked` with a `blockedOn` naming the missing member instead',
    '  would have triggered the automatic wave-2 retry once the change that adds those',
    '  members landed, and the content would have shipped complete.)',
    '- NEVER substitute a placeholder for a required deliverable. An asset-generation',
    '  sub-step must produce the REAL asset via the project image-gen pipeline (the',
    '  house diffusion pipeline). If that pipeline is unreachable, mark the step failed —',
    '  do NOT commit a placeholder and mark it done.',
    '',
    'SELF-CHECK after all sub-steps: apply the architecture-enforcement rules to your',
    'own diff by READING the relevant `.claude/agents/arch-*.md` definitions and',
    'checking your diff against them, and run `tsc --noEmit`. Do NOT call Workflow (it',
    'is parent-only and unavailable to you). Fix any concrete violation you find; the',
    'canonical aggregated arch-review runs later over the merged result, so this is a',
    'first pass, not the final gate.',
    '',
    'FINALLY:',
    `- Stage ONLY the files you changed (never \`git add -A\`) and commit them on a new`,
    `  branch named \`${c.branch}\` with a clear message.`,
    '- Return the structured report: branch, worktreePath (absolute path of this',
    '  worktree), success (true only if every sub-step is `done`), per-sub-step status',
    "  (`done`/`blocked`/`failed`, plus `blockedOn` when blocked), and selfCheck ('clean'",
    '  or the remaining violations).',
  ];
}

// Visual/identity context for a change (Marksman capture screenshots + the resolved
// identity bundle), staged into the repo so they exist inside the worktree. Returns []
// when the change has no attachments (text-only changes — the common case).
function attachmentsBlock(c) {
  if (!Array.isArray(c.attachments) || c.attachments.length === 0) return [];
  return [
    '',
    'ATTACHMENTS — visual context for this change (from a Marksman markup capture). READ',
    'these before implementing; they are committed in the repo so they exist in this worktree:',
    ...c.attachments.map((a) => `  - ${a}`),
    'How to use them:',
    '  - A `screenshot.png` shows the game frame with the reviewer\'s marks (circle / arrow /',
    '    label) — Read it to SEE what the note refers to, especially for visual/layout changes.',
    '  - An `annotations.json` is the identity bundle: it resolves each mark to a concrete target',
    '    — a DOM element (`selector` / `component` / `sourceFile` as `file:line`) or a canvas',
    '    entity (`entityType` / `configPath`). Treat those as the AUTHORITATIVE pointer to the',
    '    code to edit; the sub-steps above already summarize them, but the bundle is ground truth.',
    '  - These are context, NOT deliverables — do not commit or modify them.',
  ];
}

function changePrompt(c) {
  return [
    'You are implementing ONE change from a changeset for this web game, in an',
    'isolated git worktree. First read ./CLAUDE.md and the relevant module README.md',
    'files so you follow the architecture + data-values + docs-track-code rules. If your',
    'agent definition has a `## References` section, read the files it lists first too.',
    '',
    `CHANGE: ${c.title}`,
    '',
    'SUB-STEPS — execute STRICTLY IN ORDER. Do not start a step until the prior one',
    'is done. Use TaskCreate/TaskUpdate so progress is visible.',
    ...c.subSteps.map((s, i) => `  ${i + 1}. ${s}`),
    ...attachmentsBlock(c),
    '',
    ...sharedRules(c),
  ].join('\n');
}

// Wave-2 changes need a base OTHER than main (the integration branch, which now
// carries the wave-1 producers' output) — the harness's built-in isolation:'worktree'
// always cuts from the default branch, so these agents self-manage their worktree
// via Bash, the same pattern the integrator agent already uses.
function changePromptWave2(c, integrationBranch) {
  const wtPath = `.claude/worktrees/${c.branch}-w2`;
  return [
    'You are implementing ONE change from a changeset for this web game. This change',
    `depends on another change already merged onto \`${integrationBranch}\` (either detected`,
    'at parse time, or because you/another agent reported it `blocked` earlier) — so you',
    'must work from THAT branch, not `main`.',
    '',
    'STEP 0 — set up your own dedicated worktree (do this BEFORE anything else):',
    `  - If \`${wtPath}\` already exists: `,
    `      \`git worktree remove --force ${wtPath}\` (ignore errors), then \`git worktree prune\`.`,
    `  - If branch \`${c.branch}\` already exists: \`git branch -D ${c.branch}\` (ignore errors).`,
    `  - Create it: \`git worktree add -b ${c.branch} ${wtPath} ${integrationBranch}\`.`,
    `  - Do ALL following work \`cd\`'d into (or via \`git -C\`) \`${wtPath}\` — never touch the repo`,
    '    ROOT working tree.',
    '',
    'Then read ./CLAUDE.md and the relevant module README.md files (inside your worktree) so',
    'you follow the architecture + data-values + docs-track-code rules. If your agent',
    'definition has a `## References` section, read the files it lists first too.',
    '',
    `CHANGE: ${c.title}`,
    c._dependsOnTitles?.length ? `(depends on: ${c._dependsOnTitles.join(', ')})` : '',
    '',
    'SUB-STEPS — execute STRICTLY IN ORDER. Do not start a step until the prior one',
    'is done. Use TaskCreate/TaskUpdate so progress is visible. The dependency you were',
    'waiting on should now be present in this worktree — verify it (grep/read) before',
    'proceeding; if it is STILL missing, mark the relevant step `blocked` again rather than',
    'guessing.',
    ...c.subSteps.map((s, i) => `  ${i + 1}. ${s}`),
    ...attachmentsBlock(c),
    '',
    ...sharedRules(c),
    `- Report \`worktreePath\` as \`${wtPath}\` (the absolute path).`,
  ].filter(Boolean).join('\n');
}

// ── Reusable: run one implement wave (parallel agents) ─────────────────────────
async function runWave(waveChanges, { wave }) {
  if (waveChanges.length === 0) return [];
  const reports = await parallel(
    waveChanges.map((c) => () => {
      const opts = wave === 1
        ? {
            label: c.branch,
            phase: 'Implement wave 1',
            model: c.model,
            agentType: EXPERTS.includes(c.expert) ? c.expert : 'general-purpose',
            isolation: 'worktree',
            schema: REPORT_SCHEMA,
          }
        : {
            label: `${c.branch} (wave 2)`,
            phase: 'Implement wave 2',
            model: c.model,
            agentType: EXPERTS.includes(c.expert) ? c.expert : 'general-purpose',
            schema: REPORT_SCHEMA,
          };
      const prompt = wave === 1 ? changePrompt(c) : changePromptWave2(c, integrationBranch);
      return agent(prompt, opts)
        .then((r) => ({ change: c, report: r }))
        .catch(() => ({ change: c, report: null }));
    }),
  );
  return reports.filter(Boolean).map((r) => ({ change: r.change, report: r.report, merged: false, wave }));
}

// ── Reusable: integrate a set of clean results onto the integration branch ────
const INTEGRATION_SCHEMA = {
  type: 'object',
  properties: {
    integrationBranch: { type: 'string' },
    integrationWorktree: { type: 'string' },
    base: { type: 'string' },
    head: { type: 'string' },
    merged: { type: 'array', items: { type: 'string' } },
    skipped: {
      type: 'array',
      items: {
        type: 'object',
        properties: { branch: { type: 'string' }, reason: { type: 'string' } },
        required: ['branch', 'reason'],
      },
    },
    cleanedWorktrees: { type: 'array', items: { type: 'string' } },
    changedFiles: { type: 'array', items: { type: 'string' } },
    totalLinesChanged: { type: 'number' },
  },
  required: ['integrationBranch', 'integrationWorktree', 'base', 'head', 'merged', 'skipped'],
};

async function runIntegrator({ freshBranch, integrationWorktree, cleanResults, waveLabel }) {
  const changeList = cleanResults
    .map((r) => `  - id "${r.change.branch}" — worktree: ${r.report.worktreePath || '(not reported — fall back to the named branch)'}`)
    .join('\n');

  const setupSteps = freshBranch
    ? [
        '1. Record the current `main` SHA as `base` (`git rev-parse main`).',
        `2. Prepare a FRESH integration worktree at \`${integrationWorktree}\` on a new branch`,
        `   \`${integrationBranch}\` cut from \`main\`:`,
        `     - If branch \`${integrationBranch}\` already exists: \`git branch -D ${integrationBranch}\`.`,
        `     - If a stale worktree exists there: \`git worktree remove --force ${integrationWorktree}\` (ignore errors), then \`git worktree prune\`.`,
        `     - Create it: \`git worktree add -b ${integrationBranch} ${integrationWorktree} main\`.`,
      ]
    : [
        `1. The integration worktree at \`${integrationWorktree}\` on branch \`${integrationBranch}\` ALREADY`,
        '   EXISTS from a prior wave — do NOT recreate it. Record its current HEAD SHA as `base`',
        `   (\`git -C ${integrationWorktree} rev-parse HEAD\`) — this is the baseline THIS wave merges onto,`,
        '   not the original `main` SHA.',
        '2. (nothing to prepare — reusing the existing worktree from step 1)',
      ];

  return agent(
    [
      `You are the integrator (${waveLabel}). Do ALL git work in a DEDICATED worktree — NEVER touch`,
      'the repo ROOT working tree. The user may have unrelated uncommitted changes at the root: do',
      'NOT run `git stash`, `git reset`, `git checkout`, or `git clean` at the root, and do NOT',
      'require the root to be clean. You only create/read branches + one dedicated worktree.',
      '',
      'Steps (report exact SHAs + the integration worktree path):',
      ...setupSteps,
      '3. Integrate each change below into the integration worktree, ONE at a time, in order. Each',
      '   change has an `id` (its assigned branch name — report this VERBATIM) and the path to the',
      '   WORKTREE its agent worked in. IMPORTANT: the change\'s commit is the HEAD of that WORKTREE,',
      '   regardless of what branch (if any) the agent named — so integrate from the worktree HEAD,',
      '   NOT by assuming a branch called <id> exists (haiku agents often commit on the framework\'s',
      '   `worktree-*` branch instead of creating <id>):',
      '     a. Resolve the commit: `git -C <worktreePath> rev-parse HEAD` → <sha>.',
      `     b. Merge it: \`git -C ${integrationWorktree} merge --ff-only <sha>\`; if that fails, fall back`,
      `        to \`git -C ${integrationWorktree} merge --no-ff <sha> -m "integrate <id>"\`. On CONFLICT:`,
      `        \`git -C ${integrationWorktree} merge --abort\`, add {branch:"<id>", reason:"conflict"} to \`skipped\`, continue.`,
      '     c. On success, add the change\'s `id` (verbatim) to `merged` — report the id, never the sha',
      '        or the `worktree-*` branch name; the id is how the workflow matches the merge to the change.',
      '     If a worktree path is missing/invalid, fall back to merging the named branch `<id>`; if that',
      '     has no commit beyond `main` either, add {branch:"<id>", reason:"no-commit"} to `skipped`.',
      '   Changes to integrate:',
      changeList,
      '4. For each SUCCESSFULLY integrated change, clean up its worktree + branch: `git worktree remove',
      '   --force <worktreePath>`, then delete its named branch if it exists (`git branch -D <id>`, ignore',
      '   the error if absent). Skip cleanup for a change that conflicted.',
      '5. Sweep residual framework branches merged into the integration branch:',
      '   `git branch --merged ' + integrationBranch + ' | grep worktree-agent | xargs -r git branch -d` (ignore errors).',
      `6. Record the integration branch SHA as \`head\` (\`git -C ${integrationWorktree} rev-parse HEAD\`).`,
      `7. Report \`changedFiles\`: run \`git -C ${integrationWorktree} diff --name-only base..head\` (use the`,
      '   actual `base`/`head` SHAs from the steps above — for a wave-2/append run this is the SAME',
      '   integration branch\'s diff from ITS OWN prior HEAD to its new HEAD, i.e. just this wave\'s',
      '   contribution) and list every path as a forward-slash string. Report `totalLinesChanged`: the',
      `   sum of insertions + deletions from \`git -C ${integrationWorktree} diff --shortstat base..head\``,
      '   (same SHAs). This feeds the downstream architecture review so it does not need to re-derive',
      '   the same facts itself.',
      '',
      `LEAVE the integration worktree in place at \`${integrationWorktree}\` — the qa gate and the`,
      'human review need it; the run-changeset skill removes it after the confirmed ff-merge. Do NOT',
      `touch the repo root. Return the structured report, including integrationWorktree = \`${integrationWorktree}\`.`,
    ].join('\n'),
    { label: `integrate-${waveLabel}`, model: 'sonnet', phase: waveLabel === 'wave 1' ? 'Integrate wave 1' : 'Integrate wave 2', schema: INTEGRATION_SCHEMA },
  );
}

// ── Phase 2: Implement — wave 1 (parallel, no known cross-change dependency) ──
phase('Implement wave 1');

const wave1Changes = changes.filter((c) => c._wave === 1);
const wave2PlannedChanges = changes.filter((c) => c._wave === 2);

const wave1Results = await runWave(wave1Changes, { wave: 1 });

let clean1 = wave1Results.filter((r) => r.report && r.report.success === true);
let dirty1 = wave1Results.filter((r) => !(r.report && r.report.success === true));

log(`Implement wave 1 complete: ${clean1.length}/${wave1Results.length} change(s) reported all sub-steps done.`);
if (dirty1.length > 0) {
  log(`Not eligible to merge from wave 1: ${dirty1.map((r) => r.change.branch).join(', ')}`);
}

// Runtime safety net: any wave-1 change with a `blocked` sub-step (dependency the
// parse-time graph missed) is retried in wave 2, even though it wasn't predicted.
const blockedInWave1 = dirty1.filter((r) => r.report?.subSteps?.some((s) => s.status === 'blocked'));
if (blockedInWave1.length > 0) {
  log(`${blockedInWave1.length} wave-1 change(s) self-reported blocked (unpredicted dependency) — retrying in wave 2:`);
  for (const r of blockedInWave1) {
    const blockers = r.report.subSteps.filter((s) => s.status === 'blocked').map((s) => s.blockedOn || s.step);
    log(`  - ${r.change.title} → blocked on: ${blockers.join('; ')}`);
  }
}
// Genuinely failed (not blocked) wave-1 changes are NOT retried — a real bug/missing
// tool/impossible instruction won't be fixed by running it again unchanged.
const failedInWave1 = dirty1.filter((r) => !blockedInWave1.includes(r));

// ── Phase 3: Integrate wave 1 ───────────────────────────────────────────────────
phase('Integrate wave 1');

const integrationWorktree = `.claude/worktrees/integration-${plan.slug}`;
let integration = null;

if (clean1.length === 0) {
  log('No clean wave-1 branches to integrate.');
} else {
  integration = await runIntegrator({
    freshBranch: true,
    integrationWorktree,
    cleanResults: clean1,
    waveLabel: 'wave 1',
  });
  if (integration) {
    const mergedSet = new Set(integration.merged || []);
    for (const r of clean1) r.merged = mergedSet.has(r.change.branch);
    log(`Integrated ${integration.merged?.length ?? 0} branch(es) onto ${integration.integrationBranch} (wave 1).`);
    if (integration.skipped?.length) {
      log(`Skipped at merge (wave 1): ${integration.skipped.map((s) => `${s.branch} (${s.reason})`).join(', ')}`);
    }
  } else {
    log('Integrator agent failed on wave 1 — no branches merged.');
  }
}

// ── Phase 4: Implement — wave 2 (parse-predicted dependents + blocked retries) ─
phase('Implement wave 2');

const hasIntegrationBase = integration && (integration.merged?.length ?? 0) > 0;
const wave2Attempt = [...wave2PlannedChanges, ...blockedInWave1.map((r) => r.change)];
// De-dupe (a change could theoretically appear in both lists if parse predicted it
// AND — impossible in practice since predicted changes skip wave 1 — but keep this
// defensive) and drop any whose original wave-1 attempt already merged (n/a here
// since predicted-wave-2 changes never ran wave 1, and blocked ones by definition
// did not merge).
const seenBranches = new Set();
const wave2ToRun = wave2Attempt.filter((c) => {
  if (seenBranches.has(c.branch)) return false;
  seenBranches.add(c.branch);
  return true;
});

let wave2Results = [];
if (wave2ToRun.length === 0) {
  log('No wave-2 changes to attempt.');
} else if (!hasIntegrationBase) {
  log(`${wave2ToRun.length} wave-2 change(s) cannot be attempted — no integration branch exists yet (their dependency never merged): ${wave2ToRun.map((c) => c.branch).join(', ')}.`);
  // Synthesize failed reports so they show up honestly in the final completeness table.
  wave2Results = wave2ToRun.map((c) => ({
    change: c,
    report: {
      branch: c.branch,
      success: false,
      subSteps: c.subSteps.map((s) => ({ step: s, status: 'blocked', blockedOn: 'its dependency never merged in wave 1 — no integration branch to retry against' })),
      selfCheck: '(not attempted)',
    },
    merged: false,
    wave: 2,
  }));
} else {
  log(`Attempting ${wave2ToRun.length} wave-2 change(s) against ${integration.integrationBranch}: ${wave2ToRun.map((c) => c.branch).join(', ')}`);
  wave2Results = await runWave(wave2ToRun, { wave: 2 });
}

const clean2 = wave2Results.filter((r) => r.report && r.report.success === true);
const dirty2 = wave2Results.filter((r) => !(r.report && r.report.success === true));

if (wave2Results.length > 0) {
  log(`Implement wave 2 complete: ${clean2.length}/${wave2Results.length} change(s) reported all sub-steps done.`);
}

// ── Phase 5: Integrate wave 2 (append onto the SAME integration branch) ───────
phase('Integrate wave 2');

if (clean2.length === 0) {
  log('No clean wave-2 branches to integrate.');
} else if (!hasIntegrationBase) {
  log('Cannot integrate wave 2 — no integration branch exists.');
} else {
  const integration2 = await runIntegrator({
    freshBranch: false,
    integrationWorktree,
    cleanResults: clean2,
    waveLabel: 'wave 2',
  });
  if (integration2) {
    const mergedSet = new Set(integration2.merged || []);
    for (const r of clean2) r.merged = mergedSet.has(r.change.branch);
    // Fold wave-2's contribution into the running integration record: keep the
    // ORIGINAL base (main) but advance head/changedFiles/totalLinesChanged and
    // accumulate skipped entries, so downstream qa/arch-review see the full range.
    integration.head = integration2.head;
    integration.changedFiles = [...new Set([...(integration.changedFiles || []), ...(integration2.changedFiles || [])])];
    integration.totalLinesChanged = (integration.totalLinesChanged || 0) + (integration2.totalLinesChanged || 0);
    integration.merged = [...(integration.merged || []), ...(integration2.merged || [])];
    integration.skipped = [...(integration.skipped || []), ...(integration2.skipped || [])];
    log(`Integrated ${integration2.merged?.length ?? 0} branch(es) onto ${integration.integrationBranch} (wave 2).`);
    if (integration2.skipped?.length) {
      log(`Skipped at merge (wave 2): ${integration2.skipped.map((s) => `${s.branch} (${s.reason})`).join(', ')}`);
    }
  } else {
    log('Integrator agent failed on wave 2 — wave-2 branches not merged.');
  }
}

// Combined view across both waves for everything downstream.
const results = [...wave1Results, ...wave2Results];
const clean = [...clean1, ...clean2];
const changesAttempted = new Set(results.map((r) => r.change.branch));
const unattempted = changes.filter((c) => !changesAttempted.has(c.branch));
if (unattempted.length > 0) {
  log(`Warning: ${unattempted.length} change(s) never attempted in either wave: ${unattempted.map((c) => c.branch).join(', ')}`);
}

// ── Phase 6: Gate — consolidated qa over the WHOLE integration branch ──────────
// Per-change self-checks each run tsc in their OWN worktree; two changes that each
// typecheck alone can still break when merged. One qa pass over the FINAL
// integrated result (after both waves) is the only place that catches cross-change
// type/build breaks AND missing content-coverage (e.g. a new per-entity enum
// member with no corresponding content on some entity) — the outcome-level
// backstop for dependencies neither the parse-time graph nor a `blocked`
// self-report caught.
phase('Gate');

let qa = null;
if (integration && (integration.merged?.length ?? 0) > 0) {
  const QA_SCHEMA = {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['PASS', 'FAIL'] },
      checks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            result: { type: 'string', enum: ['pass', 'fail', 'skipped'] },
            detail: { type: 'string' },
          },
          required: ['name', 'result'],
        },
      },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            line: { type: 'number' },
            issue: { type: 'string' },
            owningChange: { type: 'string' },
          },
          required: ['issue'],
        },
      },
    },
    required: ['status', 'checks'],
  };

  const changeSummary = changes.map((c) => `  - [${c.category}] ${c.title}`).join('\n');

  qa = await agent(
    [
      'You are qa. The integration branch is checked out in a DEDICATED worktree at',
      `\`${integration.integrationWorktree}\` (branch \`${integration.integrationBranch}\` — the merged`,
      'result of this whole changeset, across all implement waves). Run ALL checks INSIDE that',
      'worktree — `cd` into it (or use `git -C` / run the npm scripts from there). Do NOT run checks',
      'at the repo root (the root is on a different branch and may hold unrelated uncommitted',
      'changes). Run a CONSOLIDATED functional check over the integrated result (NOT per change).',
      '',
      'The changeset that was integrated:',
      changeSummary,
      `Integrated diff range: ${integration.base}..${integration.head}`,
      '',
      'Checks — run the minimal relevant set INSIDE the integration worktree; state the real commands',
      '+ their real output:',
      '1. `npx tsc --noEmit` — ALWAYS (strict TS gate; catches cross-change type breaks the',
      '   per-worktree self-checks cannot see).',
      '2. `npm run build` — when the diff touches src/view, src/ui, or src/app (bundle-affecting).',
      '3. The game\'s `src/testing` harness — when the diff touches gameplay/AI/tuning',
      '   (confirm no regression to absurd values or non-termination).',
      '4. Determinism grep — if the sim is deterministic (per CLAUDE.md), confirm the diff',
      '   introduced no `Math.random()` into the sim (all randomness must come from the seeded RNG).',
      '5. CONTENT-COVERAGE — when the diff adds new members to a per-entity content enum in',
      '   `src/data/types.ts` (e.g. an animation-state, item-type, or quest-stage value that entities',
      '   are expected to have generated content for), verify EVERY existing entity that already had',
      '   content for the OLD members also has content for the NEW ones — check the actual generated',
      '   files/data on disk, not just that the type/renderer compiles. A missing entry here often',
      '   causes a silent fallback (no crash, easy to miss) rather than a build failure, so `tsc`/',
      '   `build` passing is not sufficient evidence of completeness. Report a gap as a finding',
      '   naming whichever change was supposed to cover it. This check exists because exactly this',
      '   gap has shipped before: a change adding new enum members and a change regenerating',
      '   per-entity content ran without either seeing the other\'s output.',
      '',
      'Report what you OBSERVED, not what you assume. status=PASS only if every check you ran',
      'passed; otherwise FAIL with concrete findings (file:line where available, and which',
      'change likely owns each). Do NOT edit code — you run and report.',
    ].join('\n'),
    { agentType: 'qa', label: 'qa-gate', model: 'sonnet', phase: 'Gate', schema: QA_SCHEMA },
  );

  if (qa) {
    log(`qa gate: ${qa.status}${qa.findings?.length ? ` — ${qa.findings.length} finding(s)` : ''}.`);
  } else {
    log('qa gate agent failed to run.');
  }
} else {
  log('Nothing integrated — skipping qa gate.');
}

// ── Phase 7: arch-review over the integrated range — ONLY once qa is green ─────
// Architecture review is advisory polish on a candidate that already works. Gating
// it on qa PASS means a functionally broken candidate never triggers the (larger)
// arch-review fan-out — it needs a code fix and a fresh run-changeset invocation
// regardless, so reviewing its architecture first was always wasted work. This also
// guarantees arch-review runs AT MOST ONCE per invocation, on the final candidate
// (after both implement waves).
phase('Review');

let review = null;
const anyReviewable = changes.some((c) => c.category !== DATA_ONLY_CATEGORY);

if (!integration || (integration.merged?.length ?? 0) === 0) {
  log('Nothing integrated — skipping arch-review.');
} else if (!anyReviewable) {
  log('Skipping arch-review — changeset is TUNING-only (pure src/data/*.json edits).');
} else if (!qa || qa.status !== 'PASS') {
  log('Skipping arch-review — qa gate did not pass. Fix the functional issue and re-run; architecture review would only be reviewing a candidate that cannot ship yet.');
} else {
  const range = `${integration.base}..${integration.head}`;
  log(`qa passed — running arch-review over ${range} …`);
  try {
    // Nested sub-workflow (one level deep — allowed). Reviews the COMMITTED range,
    // so it catches cross-change interactions the per-worktree self-checks cannot.
    // Pass the integrator's own file/line tally so arch-review skips its scout-diff
    // agent (the integrator already touched every merged file — no need to pay for
    // a second agent to re-derive the same facts via a fresh `git diff`).
    review = await workflow({ scriptPath: '.claude/workflows/arch-review.mjs' }, {
      range,
      changedFiles: integration.changedFiles || [],
      totalLinesChanged: integration.totalLinesChanged || 0,
    });
  } catch (e) {
    log('arch-review sub-workflow failed to run.');
    review = null;
  }
}

// ── Phase 8: Completeness aggregation (pure, from structured reports) ──────────
phase('Report');

// Cross-reference every parsed sub-step against what its change agent reported —
// using each change's FINAL attempt (wave 2 if it ran one, else wave 1).
const finalByBranch = new Map();
for (const r of results) finalByBranch.set(r.change.branch, r); // wave2 entries added after wave1, so this naturally prefers the later attempt

const completeness = [];
let doneCount = 0;
let totalSubSteps = 0;

for (const c of changes) {
  const r = finalByBranch.get(c.branch);
  const rep = r?.report;
  const repSteps = (rep && rep.subSteps) || [];
  for (let i = 0; i < c.subSteps.length; i++) {
    totalSubSteps++;
    const planStep = c.subSteps[i];
    const reported = repSteps[i];
    let status;
    if (!rep) {
      status = 'missing'; // agent died / never reported / never attempted
    } else if (!reported) {
      status = 'missing'; // sub-step silently dropped from the report
    } else if (reported.status === 'done') {
      status = r.merged ? 'done' : 'done-unmerged'; // implemented but not on the integration branch
    } else if (reported.status === 'blocked') {
      status = 'blocked'; // exhausted its retry (or had none available) and is still blocked
    } else {
      status = 'failed';
    }
    if (status === 'done') doneCount++;
    completeness.push({
      category: c.category,
      change: c.title,
      subStep: planStep,
      status,
      wave: r?.wave ?? null,
      note: reported?.note ?? (reported?.blockedOn ? `blocked on: ${reported.blockedOn}` : ''),
    });
  }
}

const allChangesFinal = changes.map((c) => finalByBranch.get(c.branch)).filter(Boolean);
const allDelivered =
  doneCount === totalSubSteps &&
  totalSubSteps > 0 &&
  allChangesFinal.length === changes.length &&
  allChangesFinal.every((r) => r.report && r.report.success === true) &&
  integration &&
  (integration.skipped?.length ?? 0) === 0 &&
  // if anything was integrated, the qa gate must have run AND passed
  qa != null &&
  qa.status === 'PASS';

// Final structured result the parent/skill acts on. The workflow intentionally
// STOPS here — it does NOT merge to main.
const summary = {
  ok: true,
  changesetPath: plan.changesetPath,
  integrationBranch: integration?.integrationBranch ?? null,
  integrationWorktree: integration?.integrationWorktree ?? null,
  base: integration?.base ?? null,
  head: integration?.head ?? null,
  changes: changes.map((c) => {
    const r = finalByBranch.get(c.branch);
    return {
      title: c.title,
      category: c.category,
      expert: c.expert,
      model: c.model,
      branch: c.branch,
      wave: r?.wave ?? c._wave,
      dependsOn: c._dependsOnTitles?.length ? c._dependsOnTitles : undefined,
      success: !!(r?.report && r.report.success),
      merged: !!r?.merged,
      selfCheck: r?.report?.selfCheck ?? '(no report — never attempted)',
    };
  }),
  completeness,
  archReview: review, // null when skipped; otherwise the arch-review findings
  qa,                 // null when nothing integrated / gate failed to run; else { status, checks, findings }
  allDelivered,
  // The ONE remaining human step — deliberately not performed by the workflow.
  // The repo root was NEVER touched; the integration branch lives in its own worktree.
  nextStep: (() => {
    if (!integration || (integration.merged?.length ?? 0) === 0)
      return 'No integration branch produced — inspect the failed changes above.';
    const b = integration.integrationBranch;
    const wt = integration.integrationWorktree;
    const discard = `git worktree remove --force ${wt} && git branch -D ${b}`;
    if (qa && qa.status === 'FAIL')
      return `qa gate FAILED on ${b} — do NOT merge. Fix the findings, or discard: \`${discard}\`.`;
    if (!qa)
      return `qa gate did not run on ${b} — verify manually (tsc/build in ${wt}) before merging.`;
    return `Review ${b} (checked out at ${wt}), then from the repo root: \`git checkout main && git merge --ff-only ${b}\`, then clean up \`git worktree remove --force ${wt} && git branch -d ${b}\`. Discard instead with \`${discard}\`.`;
  })(),
};

log(
  allDelivered
    ? `Done — all ${totalSubSteps} sub-step(s) delivered onto ${summary.integrationBranch}. Awaiting human ff-merge to main.`
    : `Incomplete — ${doneCount}/${totalSubSteps} sub-step(s) delivered and merged. See completeness report.`,
);

return summary;
