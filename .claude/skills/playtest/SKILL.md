---
name: playtest
model: sonnet
description: >-
  End-to-end playtest pipeline: process ALL transcripts in the transcripts
  folder into individual changesets, intelligently merge them into one combined
  changeset (resolving conflicts in favour of the latest, combining complementary
  changes to the same area), then run the merged changeset (parallel worktrees,
  sequential sub-steps, merge, conditional arch-review). Trigger when the user
  says "process and run", "playtest", "run the playtest", "run the latest
  transcript", "/playtest", or similar. The args are an optional path to a
  specific transcript file — if provided, only that file is processed (single-
  file mode, no merge step needed). Combines transcript-to-changeset + merge +
  run-changeset in one uninterrupted flow.
---

# playtest

End-to-end playtest feedback pipeline. Processes ALL spoken-feedback transcripts
into individual changesets, merges them intelligently into one combined changeset,
then runs it. The review gate is the parsed-plan confirmation in Phase 3 — the user
sees every change and model assignment before any worktrees are launched.

## Phase 1 — Transcripts → Individual Changesets

For every transcript file found, apply the `transcript-to-changeset` skill logic,
**omitting the "stop and hand off" step** (Step 5 of that skill).

1. **Resolve capture files.** If a path was given in args, use only that file
   (single-file mode — skip Phase 2 and go straight to Phase 3 with the one
   changeset produced). Otherwise glob the capture inbox `.cache/markdown/*.md`
   (Marksman markup + voice captures) plus, for backward compatibility,
   `node_modules/.cache/transcripts/transcript-*.txt`, and sort by **modification time
   oldest-first** (so order reflects session order). A Marksman markup capture also has
   a paired `.cache/markdown/assets/<slug>/` folder — note it; you will stage its
   screenshot + annotations per `transcript-to-changeset` Step 3a. Tell the user how
   many files were found and list them. If no files exist, say so and stop.

2. **For each transcript file, in order:**

   a. Read the file. If it is empty or contains no actionable feedback after
      filtering, note it as skipped. **Delete the file immediately** (it has been
      read and contains nothing worth keeping) then continue to the next. Do not
      write an empty changeset.

   b. Apply the full `transcript-to-changeset` pipeline — Step 1 (read + understand),
      Step 1b (relevance filter), Step 1c (confidence assessment + low-confidence
      confirmation gate), Step 2 (categorize + group), Step 3 (write changeset).
      Use the category rules, confidence rules, and grouping rules from that skill
      exactly. The confirmation gate in Step 1c applies per-transcript: pause, ask
      the user, and wait for a response before proceeding to Step 2 for that file.

   c. Write the intermediate changeset to
      `changesets/intermediate/<transcript-filename-stem>.md` (not the final
      `changesets/` folder — keep intermediates separate so the user can inspect
      them if needed).

   d. **Delete the source transcript file** after writing its changeset (same as
      `transcript-to-changeset` Step 4). Warn but continue if the delete fails.

3. **Sweep the capture inbox.** After processing all files, glob `.cache/markdown/*.md`
   (and `node_modules/.cache/transcripts/transcript-*.txt`) once more. Delete any files
   still present — plus any spent `.cache/markdown/assets/<slug>/` folders whose capture
   you processed — these are either files that failed to delete in step 2d or any that
   appeared during processing. Warn the user for each but do not abort. **Never touch
   `changesets/assets/`** — that holds the committed copies.

4. If all transcripts were skipped (all empty / all filtered), say so and stop.

## Phase 2 — Merge Changesets Intelligently

Take all intermediate changesets written in Phase 1 (in the order the transcripts
were processed, oldest → newest) and merge them into a single canonical changeset.
This is where the intelligence lives.

### 2a — Load all intermediates

Read each intermediate changeset file in session order. Parse each into its
category → change → sub-steps structure (same parser as `run-changeset` Step 1).
Track which changeset (by session index, 1-based) each item came from.

### 2b — Resolve conflicts (same area, conflicting value or intent)

Two items **conflict** when they target the same tunable value, the same parameter
field, or the same narrow behaviour, but specify different outcomes. Conflicting
items are **never** combined — **the latest session wins**.

Detection heuristics (apply all; flag matches for manual inspection if unsure):

- **TUNING conflicts:** both items name the same JSON key or the same data field
  (e.g. both adjust the same `src/data/*.json` value). Keep only the item from the
  later session; discard the earlier one. Record the discard in the merge log
  (see 2d).
- **CHANGES/FEATURES conflicts:** both items describe a behaviour change to the
  same small, named feature (same mechanic, same UI screen), but their intent is
  mutually exclusive (e.g. "remove the mute button" vs "add a mute button"). Keep
  the later one; discard the earlier.
- **Opposite-polarity changes:** one item adds something, a later item removes the
  same thing (or vice versa) — keep only the latest.

When uncertain whether two items truly conflict (they could be complementary),
treat them as complementary (see 2c) and add a `<!-- merge-note: ... -->` comment
flagging the potential conflict for the user to review.

### 2c — Combine complementary items (same area, additive intent)

Two items are **complementary** when they both affect the same module, system,
feature area, or UI screen, but their intents do not contradict each other —
they are additive. Complementary items from any number of sessions are folded into
**one change** with all their sub-steps listed in session order.

Complementary grouping rules (apply in order):

1. **Same category, same named feature/system.** If two or more items in the same
   category target the same named thing (e.g. both are CHANGES to the settings
   screen, or both are TUNING of the same ability), merge them into one change.
   The change title is a short description that covers all sub-items; the sub-steps
   list every distinct action in session order.

2. **Shared file footprint.** If two items would likely touch the same source file
   or module, consider merging them even if the feature names differ slightly. Use
   the module index in `./CLAUDE.md` to ground this — if both items point to the same
   module path, merge them unless their sub-steps are genuinely unrelated.

3. **Different categories are never merged.** A TUNING item and a CHANGES item that
   both touch the same file stay in their respective categories (they execute
   differently in `run-changeset`).

**Carry attachments through the merge.** Each intermediate change may have an `Attachments:`
line (staged `changesets/assets/<slug>/...` paths from a Marksman capture). When you combine
complementary items into one merged change, **union all their attachment paths** onto the merged
change's `Attachments:` line — never drop a capture's visual context. When you discard a
conflicting item (2b, latest wins), its attachments go with it. The staged files under
`changesets/assets/` are already committed by Phase 1; leave them in place (do not re-stage).

### 2d — Write the merged changeset

Write the final merged changeset to `changesets/<slug>.md` where `<slug>` is a
short kebab-cased summary of the session (e.g. `playtest-session-<date>` derived
from the transcript filenames). Do not overwrite an existing file — suffix an index.

Use the same structure `run-changeset` expects:

```markdown
# Merged playtest — <date/slug>

> Source transcripts: <list of transcript filenames processed>

## TUNING

### <merged change title>
1. <sub-step from session N>
2. <sub-step from session M>

## CHANGES

### <merged change title>
1. <sub-step>
Attachments: changesets/assets/<slug-a>/screenshot.png, changesets/assets/<slug-b>/screenshot.png

<!-- ... other categories ... -->

<!-- merge log -->
<!-- discarded: "<original item>" from session 1 — superseded by "<later item>" from session 2 -->
<!-- merged: "settings volume control" (session 1) + "settings mute button" (session 2) → "Settings audio controls" -->
<!-- filtered: "<utterance>" from transcript X — filler/noise -->
```

The `<!-- merge log -->` section records every discard (conflict resolution) and
every combination (complementary merge) so the user can audit the decisions. Also
carry forward all `<!-- filtered: ... -->` comments from the individual changeset
intermediates.

### 2e — Clean up intermediate files

After writing the merged changeset, delete the `changesets/intermediate/` folder
and its contents. Use `Remove-Item -Recurse` (PowerShell) or `rm -rf` (Bash). Warn
but continue if this fails.

## Phase 3 — Merged Changeset → Run

Invoke the `run-changeset` skill on the merged changeset file written in Phase 2
(`Run /run-changeset changesets/<slug>.md`). That skill drives the
`run-changeset.mjs` workflow and performs the final human-gated `main` ff-merge:

- **Confirm before launching.** Before invoking `run-changeset`, present the parsed
  plan + per-change model/expert assignments and ask the user to confirm. This is the
  authoring review gate — the user can edit `changesets/<slug>.md` now if anything
  looks wrong (including reviewing the merge log and restoring any discarded item),
  then say yes.
- **The workflow then runs** (via `run-changeset`): fan out one worktree agent per
  change in parallel → integrate the clean branches onto an `integration/<slug>`
  branch (never `main`) → conditional `arch-review` → the consolidated `qa` gate
  (tsc/build/harness) over the integrated result → completeness aggregation.
- **The `run-changeset` skill presents** the completeness table + arch-review + qa
  outcome, then — only on your confirmation — fast-forwards `main`, deletes the
  integration branch, and deletes the merged changeset file on success.

## Notes

- Phase 2 is skipped in single-file mode (a path was passed in args) — the one
  changeset from Phase 1 goes directly to Phase 3.
- Phase 1 produces intermediates; Phase 2 merges them; Phase 3 reads the merged
  file. If Phase 1 produces only one non-skipped intermediate, Phase 2 is a
  trivial pass-through (rename the intermediate to the final path, skip merge log).
- The confirmation prompt in Phase 3 is the user's opportunity to review or edit
  the merged changeset — especially the merge log — before any code is changed. If
  the user declines at this gate, delete the merged changeset file before stopping
  (it was generated this session; leaving it risks confusion on the next run).
- **Merged changeset lifecycle:** deleted by the `run-changeset` skill only after a
  successful, confirmed `main` ff-merge (its clean-up step). If the run is incomplete,
  the qa gate fails, or you decline the merge, the merged changeset is intentionally
  left at `changesets/<slug>.md` so you can re-run or edit it without losing the merge
  work. Tell the user the file path so they know where to find it.
- All rules from both component skills apply: ./CLAUDE.md architecture rules,
  data-as-tuning, docs-track-code, scoped staging, no `git add -A`.
- The `changesets/intermediate/` folder is ephemeral — always cleaned up in Phase
  2e regardless of Phase 3 outcome. The user should never need to interact with it
  directly.
