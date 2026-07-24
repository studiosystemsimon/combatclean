# Router policy — Combat Clean

Per-project brain for the generic prompt router (`.claude/hooks/route-prompt.mjs` +
`.claude/skills/{router,change}`). Two audiences:

- The **hook** injects only the block between the `ROUTER:INJECT` markers below, on every
  non-raw prompt.
- The **`change` skill** reads the **Pipeline** section when it runs.

Everything project-specific lives here; the engine files stay generic.

> **Template note (delete this block once reviewed).** This file was scaffolded from the
> bishop-game-framework template using this repo's fixed module layout (`src/game`, `src/core`,
> `src/app`, `src/input`, `src/data/*.json`, `src/ui`, `src/view`, `public/**`). If you add,
> rename, or remove a top-level module, update the path lists below to match.

<!-- ROUTER:INJECT:START -->
[router] Decide how to handle the user's request (this is a routing directive, not a task):

- If it is a QUESTION, explanation, investigation, or targets NON-GAME areas — `.claude/**`
  governance, docs & `plans/**`, `CLAUDE.md`/`ARCHITECTURE.md`, build/infra (`vite.config`,
  `package.json`, `scripts/**`, `tsconfig`), or git/meta — OR it is a reply / continuation of
  work already in progress → handle it DIRECTLY. Do NOT route.

- If it asks to CHANGE THE GAME — gameplay/logic (`src/game`, `src/core`, `src/app`,
  `src/input`), tuning (`src/data/*.json`), UI overlay (`src/ui`), rendering (`src/view`), or
  art (`public/**`) → do NOT edit directly. Invoke the `change` skill (Skill tool) with the
  user's request VERBATIM as args, and say one line first: "→ routing as a change (auto-merges
  if green)".

- If genuinely unsure which lane, ask the user rather than silently doing heavy work.

Raw override: a prompt starting with `raw:` or `!!`, or `/router raw`, bypasses this entirely.
<!-- ROUTER:INJECT:END -->

## Pipeline (read by the `change` skill)

- **Runner workflow:** `.claude/workflows/run-changeset.mjs` (invoke via
  `Workflow({ scriptPath, args: "<changeset path>" })`). It returns
  `{ ok, allDelivered, qa, archReview, integrationBranch, integrationWorktree, base, head,
  changes, completeness, nextStep }` and never touches `main`.
- **Author conventions:** follow `.claude/skills/transcript-to-changeset/SKILL.md` **Step 2
  (categorize)** and **Step 3 (file structure)** — categories `CHANGES / FIXES / TUNING /
  FEATURES / VISUAL`, strict TUNING (pure `src/data/*.json` value edits), combine related
  feedback into one change with ordered sub-steps, split independent work cleanly, optional
  `{expert: <role>}` heading tag (<!--EXPERTS:EXEC_ROLES_SLASH:START-->`engineer` / `ui` / `game-tuning` / `tech-artist` / `artist` / `merge-icon-author`<!--EXPERTS:EXEC_ROLES_SLASH:END-->). **Skip** the transcript-only ceremony (relevance gate 1b, confidence gate 1c,
  filtered-audit comments) — a typed instruction is direct intent, not noisy speech.
- **Changeset location:** write to `changesets/auto-<slug>.md` (suffix `-2`, `-3` on collision).
- **Merge policy:** `auto-green` — auto-merge to the default branch when the run is green;
  otherwise present findings and ask.
- **Default branch:** `main`.
- **Green =** `allDelivered === true` (all sub-steps delivered + merged, `qa.status === "PASS"`,
  no skips) AND `archReview` is null (skipped) or reports no concrete violations.

## Notes

- The explicit `/run-changeset` skill is unchanged: it stays **human-gated** (always confirm
  before touching `main`). The `auto-green` policy applies only to the transparent `change`
  lane, so a deliberate manual run still gets the confirmation gate.
- Keep the INJECT block short — it is injected on every routed prompt.
