---
name: change
model: sonnet
description: >-
  The transparent auto-lane for turning a natural-language request into a change,
  end to end: author a changeset from the request, run the project's changeset
  runner, and apply the project's merge policy (for this repo: auto-merge to main
  when green, otherwise present findings and ask). Generic + portable — all
  project specifics (runner, author conventions, merge policy, default branch)
  are read from .claude/router/policy.md. Invoked automatically by the prompt
  router for in-scope change requests, or directly via "/change <request>". The
  args are the user's request text, verbatim.
---

# change

The auto-lane orchestrator behind the prompt router. It fuses **authoring** (request →
changeset) with **execution** (the runner workflow) and **merge** (per policy) so a
non-expert can just describe a change and have it land safely — no command to remember.

This skill is **generic**. It hardcodes no project paths or vocabulary: it reads
`.claude/router/policy.md` (the **Pipeline** section) for the runner, author conventions,
merge policy, and default branch. If that file is missing or declares no runner, degrade
gracefully (see Step 5).

The request text is the skill args. If empty, ask the user what to change and stop.

## Step 0 — Load the project pipeline

Read `.claude/router/policy.md`. From its **Pipeline** section note: the runner workflow path,
the author-conventions reference, the changeset location pattern, the merge policy, the default
branch, and the definition of "green". Everything below uses those values (the defaults quoted
are this repo's).

## Step 1 — Scope: fast vs full

Judge the request:

- **Fast** — a single, self-contained, low-risk ask (one system; or a pure `src/data/*.json`
  value nudge). → author a **one-change** changeset. The runner already fast-paths a single
  change (one worktree; TUNING skips arch-review), so "fast" needs no special execution path.
- **Full** — multiple items, broad, cross-cutting, or risky. → author a **multi-change**
  changeset.

Say one line up front stating the lane you chose (transparency), e.g. *"→ fast lane: one TUNING
change."* or *"→ full lane: 3 changes (ui, tuning, fix)."*

## Step 2 — Author the changeset

Write to the changeset location from the Pipeline section (default `changesets/auto-<slug>.md`;
suffix `-2`, `-3` on collision). Follow the author conventions it names — for this repo,
`transcript-to-changeset` **Step 2 (categorize)** + **Step 3 (file structure)**:

- Sort into `CHANGES / FIXES / TUNING / FEATURES / VISUAL`; be strict about TUNING (pure
  `src/data/*.json` value edits only).
- Combine related feedback into one change with ordered sub-steps; keep genuinely independent
  work as separate changes; normalize a producer→consumer pair (art→renderer) into one change
  with ordered sub-steps.
- Add an optional `{expert: <role>}` heading tag only if auto-routing would mis-route.
- **Skip** the transcript-only ceremony (relevance gate, confidence gate, filtered-audit
  comments) — a typed instruction is direct intent, not noisy speech.

Use the exact heading structure the runner parses (category `##` → change `###` → numbered
sub-steps). Ground file references with a quick grep when obvious, but stay lightweight — the
runner's agents do the real implementation.

**If a sub-step names a specific signal/event/API whose exact timing matters** (e.g. "hide X
when the match starts"), verify the real dispatch point first — grep for where it fires and
read the surrounding phase/lifecycle logic — rather than picking the name that merely sounds
right. Say so explicitly in the sub-step (name the correct signal/call and, if relevant, name
the one that would look right but isn't) so the runner's implementer doesn't have to re-derive
it and doesn't repeat the guess. A wrong-signal guess here isn't caught until the qa gate, which
costs a full wasted implement+integrate+gate round-trip.

## Step 3 — Run the runner

Invoke the runner from the Pipeline section:

```js
Workflow({ scriptPath: "<runner path>", args: "<changeset path>" })
```

It runs the whole pipeline on an `integration/<slug>` branch and **never touches the default
branch**, returning a summary object
`{ ok, allDelivered, qa, archReview, integrationBranch, integrationWorktree, base, head,
changes, completeness, nextStep }`.

If `ok` is false or `integrationBranch` is null (nothing merged), report the failure + per-change
results and stop — do not merge.

## Step 4 — Present the result

Show, from the summary: a per-change line (`[category] title → expert/model — branch —
success ✅/❌ — merged ✅/❌`), the completeness table, the `archReview` outcome, and the `qa`
outcome (status + checks + findings). One-line verdict from `allDelivered`.

## Step 5 — Merge per policy

Apply the Pipeline section's merge policy. For this repo it is **`auto-green`**:

- **Green** (`allDelivered === true` AND `archReview` is null or has no concrete violations) →
  **auto-merge**, no prompt. From the repo root:
  1. `git checkout <default branch> && git merge --ff-only <integrationBranch>`. If the
     fast-forward fails (branch moved), do **not** force — tell the user and offer
     `git merge --no-ff <integrationBranch>` or a rebase; let them choose.
  2. Clean up: `git worktree remove --force <integrationWorktree> && git branch -d <integrationBranch>`.
  3. Delete the changeset file (`rm <changeset path>`); warn and continue if it fails.
  4. Report: *"Change complete — auto-merged `<integrationBranch>` to `<default branch>`; all N
     sub-steps delivered (qa PASS)."*

- **Not green** (any sub-step failed/unmerged, `qa.status === "FAIL"`, or `archReview` has
  concrete violations) → do **NOT** merge. Surface the gaps/violations/qa findings plainly and
  ask how to proceed, offering:
  - `Workflow({ scriptPath: ".claude/workflows/arch-fix.mjs", args: "<base>..<head>" })` to
    auto-fix architecture violations on the integration branch (re-present after) — note this
    does not fix qa/build failures, which need a real code fix; or
  - discard: `git worktree remove --force <integrationWorktree> && git branch -D <integrationBranch>`; or
  - merge anyway (only if the user explicitly says so).

**Degrade gracefully:** if `policy.md` is missing or declares no runner, do not fabricate a
pipeline — tell the user there is no changeset runner configured and offer to make the change
directly following the repo's `CLAUDE.md` (i.e. behave like the raw lane).

## Notes

- **Division of labour:** the runner workflow owns everything deterministic and everything on
  the integration branch; this skill owns authoring, presentation, and the policy-driven merge.
  Don't re-implement fan-out/integration here.
- **Two merge policies by design:** explicit `/run-changeset` stays human-gated (always
  confirm); this transparent lane uses the project's policy (`auto-green` here). Both are
  documented in `.claude/router/policy.md`.
- **Safety:** the runner did all git work in a dedicated worktree and left the repo root
  untouched, so a bad run is discarded with `git worktree remove --force <wt> && git branch -D
  <branch>`, never a default-branch revert.
