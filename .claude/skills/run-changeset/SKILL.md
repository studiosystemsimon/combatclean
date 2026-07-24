---
name: run-changeset
model: sonnet
description: >-
  Execute a changeset Markdown file (the sole runner). Invokes the run-changeset.mjs
  workflow to fan out one worktree agent per change, merge the clean branches onto an
  integration/<slug> branch (NOT main), run arch-review, run a consolidated qa gate
  (tsc/build/harness) over the integrated result, and report completeness — then
  performs the ONE human-gated step: fast-forwarding main after you confirm.
  Trigger when the user says "run this changeset", "run changeset", "execute this
  changeset", "apply this changeset", "/run-changeset", or similar AND provides
  (or implies) a changeset Markdown file. The args are the path to that file.
---

# run-changeset

The sole changeset runner. It is a **thin wrapper** around
`.claude/workflows/run-changeset.mjs`: the workflow does all the deterministic work
(parse → dependency graph → implement wave 1 → integrate → implement wave 2 → integrate →
arch-review → qa gate → completeness) on an **`integration/<slug>` branch and never touches
`main`**, and this skill adds the two things a background workflow can't: **present the
result** and **perform the single irreversible `main` fast-forward behind a human
confirmation.**

There is **no team mode** in the old cross-worktree-ordering sense, but the workflow IS
dependency-aware across (at most) two waves:
- **Parse time**: every change declares `provides`/`requires` tokens (symbols/types/
  states/data-keys). A pure-JS pass matches them across the change set and schedules any
  change that requires something another change provides straight into **wave 2** — it's
  never even attempted in wave 1. The one previously-hardcoded case (art produced →
  renderer consumes it) is now a worked example of this general mechanism, not a special
  case.
- **Runtime safety net**: an agent that discovers mid-flight that a sub-step needs
  something another change is supposed to provide reports that sub-step `blocked` (with
  `blockedOn` naming the missing thing) instead of silently narrowing its own scope. Any
  `blocked` change gets ONE automatic wave-2 retry against the post-wave-1 integration
  branch — no human round-trip for the common case.
- **Attachments (visual context)**: a change may carry an `Attachments:` line listing
  committed `changesets/assets/<slug>/...` paths — a Marksman markup capture's
  `screenshot.png` + `annotations.json` (identity bundle). The parse picks these into the
  change's `attachments`, and the implementer prompt tells the agent to Read them so it can
  see the reviewer's marks and edit the exact resolved target. They must be committed under
  `changesets/` (not `.cache/`) so they exist inside the isolated worktree — the
  `transcript-to-changeset` skill stages them there.
- **Outcome-level backstop**: the qa gate directly checks content-coverage invariants on
  the result (e.g. every fighter has art for every animation state), independent of
  whether either mechanism above caught the dependency.

This means a **clean split is still valuable but no longer load-bearing the way it used to
be** — see Notes.

## Step 1 — Run the workflow

Pass the changeset path through as `args` (omit if the user didn't give one — the
workflow's parse phase picks the most-recently-modified file under `changesets/`).

```js
Workflow({ scriptPath: ".claude/workflows/run-changeset.mjs", args: "<changeset-path-or-omit>" })
```

The workflow returns a structured summary object:
`{ ok, changesetPath, integrationBranch, integrationWorktree, base, head, changes[], completeness[], archReview, qa, allDelivered, nextStep }`.

If `ok` is false (parse failed) or `integrationBranch` is null (nothing merged), report the
failure and the per-change results; **do not** proceed to the merge. Stop.

## Step 2 — Present the result

Show the user, from the returned summary:

- A per-change line: `[category] title → expert/model — branch — success ✅/❌ — merged ✅/❌ — selfCheck`.
- The **completeness table** from `completeness[]` (Category | Change | Sub-step | Status | Wave),
  where status is `done` / `done-unmerged` / `blocked` / `failed` / `missing`. `blocked` means the
  change (or its wave-2 retry) is still waiting on a dependency that never landed — surface the
  `note` (carries `blockedOn`) so the gap is concrete, not vague.
- The **arch-review** outcome from `archReview` (null = skipped because the changeset is TUNING-only
  or nothing was integrated; otherwise its findings).
- The **qa gate** outcome from `qa` (`{ status, checks[], findings[] }`; null = nothing integrated
  or the gate failed to run). Show `status` (PASS/FAIL), the checks run (e.g. `tsc: clean`,
  `build: ok`, `harness: win-rate 0.52`), and any findings.
- A one-line verdict: `allDelivered` true = every sub-step done, merged, and the qa gate passed;
  false = list the gaps.

## Step 3 — The human gate: fast-forward `main`

This is the only privileged, irreversible action, and the whole reason this skill exists.

1. **If `allDelivered` is false, OR `archReview` reported concrete violations, OR `qa.status` is
   `FAIL`:** do **not** default to merging. Surface the gaps / violations / qa findings plainly and
   ask how to proceed. Offer:
   - `Workflow({ scriptPath: ".claude/workflows/arch-fix.mjs", args: "<base>..<head>" })` to auto-fix
     *architecture* violations on the integration branch (re-present after) — note this does not fix
     qa/build failures, which need a real code fix, or
   - discard the run: `git worktree remove --force <integrationWorktree> && git branch -D <integrationBranch>`
     (the workflow never touched `main` or the repo-root working tree), or
   - merge anyway (only if the user explicitly says so).

2. **If `allDelivered` is true (qa passed and arch-review is clean or was skipped):** ask the user once to confirm
   the merge into `main` (it's hard to reverse). The workflow did all its work in a dedicated worktree and
   **left the repo root untouched**, so from the repo root:

   ```
   git checkout main
   git merge --ff-only <integrationBranch>
   ```

   `--ff-only` is intentional: the workflow cut the integration branch from `main`, so if `main` hasn't
   moved this fast-forwards cleanly. If it **fails** (main advanced since the run started), do **not**
   force it — tell the user main moved, and offer `git merge --no-ff <integrationBranch>` (a real merge
   commit) or a rebase of the integration branch onto current `main`. Let them choose. (If the root has
   unrelated uncommitted changes that overlap the merged files, git will refuse — that's the user's call.)

## Step 4 — Clean up + finish

Only after a successful merge to `main`:

1. Remove the integration worktree, then delete its branch (order matters — you can't delete a branch
   checked out in a worktree): `git worktree remove --force <integrationWorktree> && git branch -d <integrationBranch>`.
2. Delete the changeset file: `rm <changesetPath>` (matches the `run-changeset` completion contract —
   completed changesets are removed on success). If the delete fails, warn and continue.
3. Report: *"Changeset complete — merged `<integrationBranch>` to main; all N sub-steps delivered."*

If the user declined the merge, leave the integration worktree + branch in place for them to inspect and
say so — `main` and the repo-root working tree are untouched either way.

## Notes

- **Division of labour:** the workflow owns everything deterministic and everything on the integration
  branch; this skill owns only presentation + the confirmed `main` ff-merge + post-merge cleanup. Keep it
  that way — don't re-implement fan-out or integration here.
- **Safety:** the workflow does all its git work in a dedicated integration worktree and never touches
  `main` or the repo-root working tree — so it's safe to run even with unrelated uncommitted changes present.
  Nothing damages `main` except Step 3, which is gated on explicit user confirmation. A bad run is discarded
  with `git worktree remove --force <wt> && git branch -D <branch>`, never a `main` revert.
- **Dependency-aware, but still benefits from a clean split.** Independent changes and merge-order
  collisions are fine (the integrator merges sequentially). Changes with a NAMED dependency (parse-time
  `provides`/`requires` overlap, or a runtime `blocked` self-report) get scheduled into wave 2 and
  retried against the wave-1 integration branch automatically — this is the fix for the failure mode
  where, e.g., a change adding new sprite/animation states and a change regenerating per-entity art both
  ran in parallel from the same base, and the art change had no way to see the new states yet. It isn't
  perfect: the parse-time graph is a heuristic substring match (not a full topological sort — multi-level
  chains or cycles aren't specially handled, they just get pushed to wave 2), and the `blocked` self-report
  depends on an agent correctly recognizing a missing dependency rather than working around it. The qa
  gate's content-coverage check is the last-resort backstop when both of those miss something — it verifies
  outcomes directly (e.g. "does every fighter actually have art for every state") rather than reasoning
  about intent. A changeset author who names dependencies explicitly (either via ordered sub-steps of one
  change, or by writing accurate `provides`/`requires`-shaped hints in the changeset prose) still gets the
  most reliable result — the graph can only schedule what it can infer.
