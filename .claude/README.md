# .claude — web game governance

Architecture-enforcement agents + orchestrators used during feature work to keep a web game bootstrapped from this framework true to the rules in [`../CLAUDE.md`](../CLAUDE.md).

## Reviewer agents (`agents/arch-*.md`)

Read-only. Report violations as `file:line — issue — minimal fix`.

| Agent | Enforces |
|---|---|
| `arch-view` | **Overriding rule:** no game logic in `src/view`; no rendering/DOM in `src/game` — view is a read-only renderer of game state. |
| `arch-modularity` | Module-per-folder; independent, removable modules. |
| `arch-di` | All wiring in the composition root; resolve by token; no cross-module construction. |
| `arch-events` | Cross-module comms via signals, not direct references. |
| `arch-composition` | Composition over inheritance (data + systems + brains). |
| `arch-specificity` | Specificity over premature generalization during prototyping. |
| `arch-ui` | Modular, reusable React UI decoupled via the game-app facade. |
| `arch-module-docs` | Docs-track-code: changed module ⇒ updated `README.md` + `CLAUDE.md` index. |
| `arch-data-values` | No hardcoded tuning — every gameplay value in `src/data/*.json`, read via `store.ts`. |

## Fixer agents (`agents/arch-fix-*.md`)

Each fixer is paired with its reviewer. When violations are found, the fixer applies minimal edits and records what it learned in its own `## Learned patterns` section — accumulating domain knowledge over time. (These are project-owned copies once scaffolded, so learnings stay with the game.)

| Agent | Fixes |
|---|---|
| `arch-fix-view` | Moves game logic to game side; removes DOM/canvas from game; converts concrete to `import type`. |
| `arch-fix-modularity` | Reroutes direct cross-module imports through signals/DI; moves misplaced files. |
| `arch-fix-di` | Moves construction to the composition root; adds missing tokens to `tokens.ts`. |
| `arch-fix-events` | Replaces direct cross-module calls with signal dispatches; adds missing cleanup. |
| `arch-fix-composition` | Flattens concrete base classes into interfaces + data fields + systems/brains. |
| `arch-fix-specificity` | Inlines speculative abstractions; splits back into concrete implementations. |
| `arch-fix-ui` | Replaces game-internal imports with facade access; extracts duplicated UI into components. |
| `arch-fix-module-docs` | Updates stale/missing `README.md` files and the `CLAUDE.md` module index. |
| `arch-fix-data-values` | Moves hardcoded tuning literals to `src/data/*.json` and wires reads via `store.ts`. |
| `arch-fix-refactor` | Extracts interfaces, utility functions, and shared UI components to reduce duplication. Always asks before multi-file changes. (Paired with the manually-triggered `arch-refactor` — see the Refactor agents section above.) |

## Refactor agents (`agents/arch-refactor.md` + `agents/arch-fix-refactor.md`)

Triggered **manually** as a periodic pass when the codebase is in a stable state. Scans `src/` for duplication, reuse opportunities, and abstraction candidates (interfaces, utility functions, shared React components). Respects all CLAUDE.md rules — composition over inheritance, no base classes, no premature generalization. Always checks git history first to skip modules that have changed recently (HOT/ACTIVE); only recommends refactors on settled, stable code. Both read the game's module layout from `CLAUDE.md` — no game specifics are baked in.

| Agent | Scope |
|---|---|
| `arch-refactor` | Read-only analysis: duplicated logic, duck-typed objects, repeated UI patterns. Produces a structured findings report. |
| `arch-fix-refactor` | Applies findings from `arch-refactor`. Always asks before multi-file changes. Self-improves via `## Learned patterns`. |

```js
// Step 1 — get findings
Agent({ subagent_type: "arch-refactor", prompt: "Run a full refactor analysis of the web game source." })

// Step 2 — apply findings (paste the report into the prompt)
Agent({ subagent_type: "arch-fix-refactor", prompt: "<paste arch-refactor findings here>" })
```

## Special agents (`agents/*.md`)

Triggered manually for cross-cutting concerns outside the per-dimension review loop.

| Agent | Scope |
|---|---|
| `web-perf` | Static performance analysis of `src/` — GC/allocation pressure, algorithmic complexity, canvas rendering, RAF loop health, React UI overhead, memory leaks — plus advisory optimisation tactics. Respects all CLAUDE.md rules (data-values, view separation, module boundaries). |
| `icon-gen` | Search-before-generate UI/HUD icon generation. Searches `assets/`/`public/` for an existing match first; generates via the house diffusion pipeline only when nothing suitable is found, then runs deterministic post-processing. Project-configurable icon style. |
| `android-perf` | On-device Android WebView performance audit via `adb` + the Chrome DevTools Protocol (CDP). Requires a per-game performance harness to be present in the project. |

```js
Agent({ subagent_type: "web-perf", prompt: "Run a full static performance analysis of the web game source." })
Agent({ subagent_type: "icon-gen", prompt: "Provide an icon for the special charge HUD indicator." })
Agent({ subagent_type: "android-perf", prompt: "Audit on-device WebView performance during a typical play session." })
```

## Expert roles (`agents/*.md`)

Specialist subagents that give focused work a role — owned paths, responsibilities, and a quality bar. They come in three kinds by **where they attach** to the workflow. Each is a **thin overlay**: the role file carries only expertise; when spawned by `run-changeset` the worktree/commit/self-check contract is prepended from the skill's prompt template. Each defers the game's identity + invariants to `CLAUDE.md`, so the same role file works for any game bootstrapped from this framework.

**Execution + creative** (edit code/data or assets; run inside `run-changeset` worktrees):

| Agent | Owns | Focus |
|---|---|---|
<!-- EXPERTS:EXEC_TABLE:START -->
| `engineer` | `src/game`, `src/core`, `src/app`, `src/input`, `src/data/types.ts` | Simulation logic, systems/brains, DI/signals, core invariants. The default for logic work. |
| `ui` | `src/ui` | React overlay; reads via the `GameApp` facade + signals; Tailwind static-vs-dynamic-style rule. |
| `game-tuning` | `src/data/*.json` (not `types.ts`) | Balance/feel numbers only, no code changes. Routes to `haiku`. |
| `tech-artist` | `src/view`, the asset pipeline | Renderer + asset pipeline (slicer/registry/draw); view stays a pure reader; sheet sizes inferred, not hardcoded. |
| `artist` | image assets under `public/**` | Search-before-generate; house diffusion; satisfy the project's asset-sheet contract. Broader than `icon-gen`; hands wiring to `tech-artist`. |
| `merge-icon-author` | the merge chains (`assets/combatclean/merge`, `config …/chains`, `config ui/generators`, `art/refs`) + the merge/gen entries in the shared `assets.json` / `src/data/assets.js` | Merge-item + generator icon ladders: design (Three Cardinal Laws), generate, chroma-key, self-review, and wire art/labels through the three registries. Not drop-table tuning (`game-tuning`) or the renderer (`tech-artist`). |
<!-- EXPERTS:EXEC_TABLE:END -->
<!-- ^ Generated from .claude/experts/registry.json by .claude/experts/manage.mjs — edit the registry, then run `sync`; see the "Managing experts" section below. -->

_Add or disable execution/advisory experts with the `/add-expert` and `/disable-expert` skills — see **Managing experts** below._

**Advisory** (read-only; **do not** run in worktrees — consult directly or while authoring a changeset):

| Agent | Consult for |
|---|---|
<!-- EXPERTS:ADVISORY_TABLE:START -->
| `product-owner` | Scoping, prioritisation, MVP cut-lines, acceptance criteria (against `plans/` + `CLAUDE.md`). |
| `game-designer` | Mechanic / feel / loop design intent an execution expert then implements. |
<!-- EXPERTS:ADVISORY_TABLE:END -->

**Routing.** `run-changeset` picks an execution/creative expert per change (in its parse phase) from an optional `{expert: <role>}` tag on the change heading, else from category + changed-file paths, falling back to **`general-purpose`** when nothing fits — so a task that needs no specialist still runs on the generic worker. Advisory roles are not selectable there; they're an optional pre-flight before running.

```js
// Advisory / creative direct-invoke
Agent({ subagent_type: "product-owner", prompt: "Scope the next milestone against plans/ and CLAUDE.md." })
Agent({ subagent_type: "game-designer", prompt: "The core loop feels dead — design a fix that keeps the game's premise." })
Agent({ subagent_type: "artist", prompt: "Generate a sprite sheet for a new entity skin, anchored to the established style." })
```

### Integration gate

`run-changeset` runs every changeset the same way (parse + dependency graph → implement wave 1 →
integrate → implement wave 2 (dependents + `blocked` retries) → integrate → arch-review → qa →
completeness → human ff). Before the human ff-merge, one functional gate runs over the **whole
integrated result, after both waves**:

| Agent | Kind | Role |
|---|---|---|
| `qa` | functional gate | **Does it work** — `tsc --noEmit` / `npm run build` / the game's `src/testing` harness / determinism check / a content-coverage check (every entity has content for every member of a per-entity enum) over the `integration/<slug>` branch. Catches cross-change type/build breaks the per-worktree self-checks can't see, and catches missing generated content even when every agent reported success. Reports PASS/FAIL; a FAIL withholds the `main` ff-merge. |

This gate is distinct from `arch-review` (architecture) and the workflow's completeness check
(delivery). **No team mode** (no cross-worktree *ordering*), but the workflow IS
**dependency-aware across two implement waves**: every change declares `provides`/`requires`
tokens at parse time; a change that requires something another change provides is scheduled
straight into wave 2 (retried against the wave-1 integration branch, not `main`). A change that
hits an *unpredicted* dependency mid-flight self-reports a `blocked` sub-step (never a silent
scope cut) and gets the same automatic wave-2 retry. The one previously-hardcoded special case
(art→renderer, normalized into one change with ordered sub-steps) is now a worked example of this
general mechanism. It isn't perfect — the graph is a heuristic substring match, not a full
topological sort — so the qa gate's content-coverage check is the last-resort backstop for a
dependency neither mechanism caught.

## Managing experts (`experts/`)

The execution + advisory experts above are **customisable per project**. Their single source of
truth is [`experts/registry.json`](experts/registry.json) — one entry per expert (role, owned
paths, responsibilities, team membership, context references) plus a `teams` map. Every scattered
wiring spot (the `EXPERTS` enum + routing rule in `run-changeset.mjs`, the valid-roles lists in
`transcript-to-changeset` / `router/policy.md`, the tables above, and each expert's `## References`
section) is **generated** from it between marker regions — never hand-edit inside the markers.

- **`/add-expert <description>`** — adds a new expert: appends the registry entry, scaffolds
  `agents/<name>.md`, optionally puts it on a **team** (a named group whose shared references are
  injected into each member's context), and regenerates all wiring.
- **`/disable-expert <name>`** — removes an expert from every workflow, moves its definition to
  `experts/disabled/<name>.md` (kept, not deleted — re-enable with `manage.mjs enable <name>`), and
  regenerates all wiring.

Both are thin front-ends over `experts/manage.mjs`, which does the deterministic work:

```bash
node .claude/experts/manage.mjs list            # show the roster (enabled/disabled, teams, refs)
node .claude/experts/manage.mjs sync            # regenerate all wiring from the registry (idempotent)
node .claude/experts/manage.mjs add <spec.json> # add an expert from a spec
node .claude/experts/manage.mjs disable <name>  # disable + archive to experts/disabled/
node .claude/experts/manage.mjs enable  <name>  # restore a disabled expert
```

`sync` is idempotent — on an unchanged registry it produces no diff. The `arch-*` reviewer/fixer
pairs and the `qa` gate are **not** managed here (out of scope by design). See
[`experts/README.md`](experts/README.md) for the registry schema.

## Workflows (`workflows/`)

Invoke by **scriptPath**, run from the repo root so agents can resolve project files and their own definitions.

### `arch-review` — review only

Scouts the diff, then runs the **reviewer** agents whose trigger paths intersect the changed files and returns their findings. Use this to audit before committing.

```js
Workflow({ scriptPath: ".claude/workflows/arch-review.mjs" })
```

### `arch-fix` — review + fix + learn

Scouts the diff, runs the triggered reviewers, then runs the paired **fixer** for each dimension with violations. Fixers apply minimal edits and self-improve.

```js
Workflow({ scriptPath: ".claude/workflows/arch-fix.mjs" })
```

Both accept an optional `args` diff-range (a git ref or range such as `d0af0942..HEAD`) to review a committed diff instead of the working tree — useful after a merge, when the working tree is clean.

### `run-changeset` — the changeset executor (sole runner)

The engine behind the `run-changeset` skill. Parses the changeset (via an agent) AND has it annotate
every change with `provides`/`requires` dependency tokens; a pure-JS graph pass then schedules any
change that requires something another change provides straight into **wave 2** instead of running
it in parallel against code that doesn't exist yet. **Wave 1** fans out **one worktree-isolated agent
per non-dependent change** in parallel, cut from `main`; a Bash integrator agent merges the clean
branches onto a fresh **`integration/<slug>` branch — never `main`**. **Wave 2** then retries the
parse-predicted dependents, plus any wave-1 change that self-reported a `blocked` sub-step (an
unpredicted dependency it discovered mid-flight), this time cut from the integration branch so the
wave-1 producers' output is present; a second integrator pass appends the clean wave-2 branches onto
the same integration branch. Only after both waves does it run the conditional `arch-review` over the
integrated range (skipped only when the changeset is **TUNING-only** — pure `src/data/*.json` edits;
arch-review self-filters by path, so code changes mislabelled CHANGES/VISUAL are still gated), runs
the consolidated **`qa` gate** (`tsc` / `build` / `src/testing` harness / determinism check / a
content-coverage check) over the whole integrated result, and returns a schema-built completeness
report. The one irreversible step (fast-forwarding `main`) is deliberately **not** done here — the
workflow ends by handing back a reviewed integration branch and the exact ff command. The script
sandbox has no Bash, so all git runs inside worker agents (wave-1 via the harness's built-in
`isolation:'worktree'`; the integrator and wave-2 via self-managed worktrees, since wave 2 needs a
non-default base ref); targeting an integration branch keeps a bad run discardable with
`git branch -D` instead of a `main` revert.

**No team mode**, but dependency-aware across (at most) two waves. Independent changes run in
parallel; the sequential integrator resolves merge-order collisions; the one genuine producer→consumer
case (art→renderer) is normalized at parse time into a single change with ordered sub-steps — a worked
example of the general `provides`/`requires` mechanism, not a special case anymore. The parse-time
graph is a heuristic substring match, not a full topological sort, so a `blocked` self-report is the
runtime safety net for anything it misses, and the qa gate's content-coverage check is the last-resort
backstop for anything both of those miss.

```js
Workflow({ scriptPath: ".claude/workflows/run-changeset.mjs", args: "changesets/CHANGES_001.md" })
```

`args` (the changeset path) is optional — absent, the parse phase picks the most recently modified file
under `changesets/`. Driven end-to-end (including the confirmed `main` ff-merge) by the `run-changeset`
skill.

## Skills (`skills/*/SKILL.md`)

User-triggered orchestration skills (auto-discovered by folder).

| Skill | Purpose |
|---|---|
| `transcript-to-changeset` | Turns a recorded play-session feedback transcript into a categorized changeset Markdown file, then stops for review. |
| `run-changeset` | **The sole runner.** Thin wrapper over the `run-changeset.mjs` workflow: fan-out per change → integrate onto `integration/<slug>` → `qa` gate → arch-review → completeness, then presents the result and performs the single human-gated `main` fast-forward + cleanup (never touches `main` except behind explicit confirmation). No team mode. |
| `playtest` | End-to-end pipeline: process all transcripts → merge into one combined changeset → run it. |
| `change` | The transparent auto-lane behind the prompt router: authors a changeset from a natural-language request, runs `run-changeset.mjs`, and applies the project's merge policy from `.claude/router/policy.md` (auto-merge to `main` when green, otherwise present findings and ask). Generic — reads all project specifics from `policy.md`. Invoked automatically by the router hook, or directly via `/change <request>`. |
| `router` | Toggles the prompt router between **auto** (routed) and **raw** (direct) — global, per-repo, or per-prompt (`raw:` / `!!`). Manages marker files only; generic and identical across projects. |

**Changeset categories.** Changesets group their changes under five top-level categories — **CHANGES** (modify existing systems), **FIXES** (bugs), **TUNING** (pure `src/data/*.json` value changes), **FEATURES** (new functionality), **VISUAL** (appearance) — which tag each change for reporting and per-category model selection. Un-categorized legacy changesets still run (treated as `CHANGES`).

## Prompt routing (the entry point for changes)

A `UserPromptSubmit` **hook** makes change requests flow into the changeset pipeline
automatically — no command to remember — while keeping a raw escape hatch. It is split into a
**generic engine** (ports verbatim to any repo) and a **per-project policy**:

- `.claude/hooks/route-prompt.mjs` — the hook (generic). On every prompt it resolves raw-mode,
  then injects the `ROUTER:INJECT` block of `.claude/router/policy.md` as context. **Fail-open**:
  no policy / no INJECT block ⇒ nothing injected ⇒ routing simply off.
- `.claude/router/policy.md` — per-project (the brain). The INJECT block (what counts as a
  change vs raw *here*) + a **Pipeline** section (runner path / author conventions / merge
  policy / default branch) the `change` skill reads.
- `change` skill — authors a changeset from the request, runs the runner, and merges per policy
  (`auto-green`: auto-merge when all delivered + qa PASS + arch clean, else present + ask).
  Fast (one change) vs full (multi-change) is an authoring call — the runner already fast-paths
  a single change / TUNING.
- `router` skill — toggles raw-mode across three scopes (precedence: global
  `~/.claude/router-global-raw` → repo `.claude/.router-mode` → per-prompt `raw:` / `!!` sigil).

Registered in the committed `.claude/settings.json` (routing on by default for everyone in the
repo). Explicit `/run-changeset` is unchanged — it stays human-gated; `auto-green` applies only
to the transparent `change` lane.

**Port to another repo:** copy the hook + `router`/`change` skills + `settings.json`, author
`.claude/router/policy.md`, and gitignore `.claude/.router-mode`. No edits to the engine.

> Keep these agents updated as the conventions evolve — they are part of the living governance, like `CLAUDE.md`.
