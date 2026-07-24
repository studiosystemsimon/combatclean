---
name: transcript-to-changeset
model: sonnet
description: >-
  Turn a recorded play-session feedback transcript into a categorized changeset
  Markdown file (CHANGES / FIXES / TUNING / FEATURES / VISUAL) ready for the
  run-changeset skill. Trigger when the user says "transcript to changeset",
  "process this transcript", "turn this transcript into a changeset",
  "/transcript-to-changeset", or similar. The args are an optional path to a
  transcript file — if omitted, the most recently modified file in
  node_modules/.cache/transcripts/ is used automatically. Review-first: this
  skill WRITES the changeset and STOPS — it does not run it.
---

# transcript-to-changeset

Converts a raw spoken-feedback **transcript** (captured while playtesting the
game with the editor open) into a **categorized changeset** Markdown file that the
`run-changeset` skill can execute. This is the "process that transcript and create
a new changeset" step of the audio-feedback workflow.

This skill is **review-first**: it produces the changeset file and then **stops**.
It never runs the changeset itself — the user reviews the file and then invokes
`run-changeset` separately.

## Inputs

The capture inbox is **`.cache/markdown/`** (the Marksman dev tool writes here; see
`src/marksman/README.md`). Two kinds of capture land there, both processed by this skill:

- **Marksman markup captures** — a `<slug>.md` (raw note, frontmatter `source: marksman` /
  `raw: true`) paired with `assets/<slug>/screenshot.png` and `assets/<slug>/annotations.json`
  (the *identity bundle* resolving each mark to a DOM `file:line` or a canvas
  `entityType`/`configPath`).
- **Voice / text transcripts** — a `<slug>.md` (also `source: marksman`, no screenshot) or a
  legacy hand-written `transcript-*.txt`.

The capture path comes from the skill args. If no path was given, glob `.cache/markdown/*.md`
(and, for backward compatibility, `node_modules/.cache/transcripts/transcript-*.txt`), sort by
modification time, and use the **most recently modified** file. Tell the user which file you
selected before proceeding. If no captures exist, say so and stop. Read the file with the Read
tool.

## Step 1 — Read and understand the capture

For a **transcript** (`.txt`, or a `source: marksman` `.md` with no paired assets): it is
informal free text, one utterance per line, captured live during play — filler ("um", "okay"),
false starts, references to on-screen events ("an ability felt weak", "an enemy moves too
slowly", "the result screen layout is off"). Read the whole thing first. Identify each distinct,
actionable piece of feedback. Discard filler and non-actionable commentary. If two lines describe
the same change, merge them.

For a **Marksman markup capture** (a `<slug>.md` with a paired `assets/<slug>/` folder), read all
three parts before extracting feedback:
1. The `<slug>.md` — the reviewer's typed notes (one numbered item per mark) + any on-screen text.
2. `assets/<slug>/annotations.json` — the identity bundle. Each note has a resolved `target`
   (and often `enclosed` / `sketchPointsAt`): a DOM target (`selector` / `component` /
   `sourceFile` as `file:line`) or a canvas target (`entityType` / `configPath`). This tells you
   the EXACT code the note refers to — use it to ground every sub-step in a real file/target
   instead of guessing.
3. `assets/<slug>/screenshot.png` — Read the image (the Read tool renders it). The marks
   (red circle / cyan arrow / label) show what the reviewer pointed at; use it for
   visual/layout intent the words alone don't capture.
   Note the capture folder for staging (Step 3) — you will copy the screenshot + annotations into
   the changeset so the implementer can see them.

If the capture is empty or contains no actionable feedback, say so and stop — do not write an
empty changeset.

## Step 1b — Validate and filter for relevance

Before categorizing, pass every candidate item through a relevance gate. This
prevents junk utterances, background noise, and off-topic speech from producing
real code changes.

**The game's domain** — items are relevant if they concern any of the following.
*Tailor this domain list to your specific game's systems.*

- **Gameplay systems**: the core mechanics, entities, simulation step, movement,
  collision, win/lose rules, scoring, timers.
- **Player controls**: the input scheme, control mapping, how the player drives
  the game (keyboard / mouse / touch / gamepad).
- **UI / HUD**: menus, on-screen indicators, status displays, result screens.
- **Visual / feel**: sprites, particles, screen shake, juice, camera, colours,
  audio feedback.
- **Performance / stability**: frame rate, lag, crashes.
- **Data / tuning values**: any number that could live in `src/data/*.json`.
- **Dev tooling**: the editor, recording, console — but only feedback about the
  tooling itself, not general complaints about the development process.

**Discard** an item if it is any of the following:

| Filter | Examples |
|---|---|
| Pure filler / noise | "um", "okay", "uh", "let me think", silence markers, coughs |
| Non-game speech | "can you turn on the fan", "I need a coffee", "is the mic on" |
| Vague without a clear subject | "that was weird", "hmm interesting", "not sure about that" with no game noun |
| Already obvious / working-as-designed | a description of correct, intended behaviour with no complaint |
| Out-of-scope for this repo | Backend infrastructure, unrelated apps, platform OS issues |
| Duplicate of an already-captured item | Restatement of feedback already merged above |
| Contradicts itself within the same transcript | Note the contradiction and **drop both** — don't guess intent; the user can re-raise after reviewing |

**When in doubt, discard.** A changeset that implements five well-grounded changes
is better than one that implements eight, two of which were misheard. Add a
`<!-- filtered: "<original utterance>" — reason -->` HTML comment at the bottom of
the changeset file for every item you dropped so the user can see what was cut and
restore anything that was discarded by mistake.

If all items are filtered and nothing remains, say so and stop — do not write an
empty changeset.

## Step 1c — Confidence assessment

For every item that survived the Step 1b relevance filter, assign a **confidence**
level before categorizing:

- **High** — unambiguous intent: the speaker is clearly requesting a specific
  change. Examples: "make the dash recharge faster", "the round should be 60 seconds",
  "add a mute button to settings". Proceed without asking.

- **Medium** — probably a desired change but requires interpretation. The feedback
  names a problem or sensation rather than a solution, or the target is unclear.
  Examples: "that ability felt weak", "movement is weird in that corner", "it's hard to
  see the score". Include in the changeset, but **mark the change** with a
  `<!-- confidence: medium — <reason> -->` comment so the user can review it before
  running.

- **Low** — genuinely ambiguous: could be an observation, a passing thought, or
  frustration rather than a change request. Examples: "interesting", "I died there",
  "hmm not sure about that", "I wonder if...". **Do not include without confirmation.**

**Confirmation gate for low-confidence items:** After assessing all items in the
transcript, if any are **Low** confidence, pause before proceeding to Step 2.
Present each low-confidence item in a numbered list:

```
The following items from the transcript are ambiguous — include in the changeset?

1. "hmm not sure about that corner" — could be a movement/collision issue or just observation. Include? (y/n)
2. "I wonder if the timer could be different" — vague; no specific value or direction. Include? (y/n)
```

Wait for the user's response. For each item the user confirms (y), treat it as
**Medium** confidence and include it with a medium-confidence comment. For each
item declined (n), discard it and add a
`<!-- filtered: "<utterance>" — low confidence, user declined -->` comment.

If there are **no** low-confidence items in a transcript, skip this gate entirely
and proceed silently to Step 2.

## Step 2 — Categorize each actionable item

Sort every actionable item into exactly one of the **five categories**. These are
the categories `run-changeset` understands:

- **CHANGES** — modifications to existing systems/behaviour (logic changes that
  alter how something already works).
- **FIXES** — bug fixes (something is broken / not behaving as intended).
- **TUNING** — simple value changes only: a number/threshold/duration/rate/colour
  moved in `src/data/*.json`. No code or functional/structural change. (These are
  the cheapest to run — `run-changeset` routes them to the haiku tier.)
- **FEATURES** — brand-new functionality that does not exist yet.
- **VISUAL** — visual/rendering/UI appearance changes (look, layout, effects),
  not gameplay logic.

Rules:
- Be strict about **TUNING**: if an item only needs a value nudged (e.g. "that
  ability should recharge faster", "make the round 30 seconds longer"), it is TUNING.
  If it needs new logic or structural change, it is CHANGES or FEATURES.
- One item → one category. If an item genuinely spans two (e.g. "add a dodge AND
  make it feel snappy"), split it into separate items in the right categories.
- **Combine related feedback into one change.** If two or more pieces of feedback
  target the same system, feature, or file, merge them into a single change with
  multiple sub-steps rather than creating separate changes. Example: "the projectile
  should travel further" and "the projectile should pass through the first enemy
  instead of stopping" both touch the same ability — one change titled "Adjust that
  ability's behaviour", two sub-steps. The signal: if a single implementer would
  naturally open the same file(s) to address both items, they belong in one change.
  Keep them as separate changes only when they are genuinely independent (different
  files, different risk profile, or one could ship without the other).
- Each item (or group of related items) becomes a **change** with an ordered list
  of concrete **sub-steps** a single implementer can execute in sequence. Keep
  sub-steps specific and small; reference the likely module/file when the transcript
  makes it obvious (you may grep the repo to ground a reference, but keep this step
  lightweight — the run-changeset agents do the real implementation).
- **Ground Marksman items in the identity bundle.** For an item that came from a
  Marksman markup capture, use the resolved target from `annotations.json` to name the
  exact file/target in the sub-steps (e.g. "in `src/ui/HeaderBar.tsx:42` (from the
  capture) …", or "the canvas entity `entityType 3` — `enemies/charger.json`"). This is
  authoritative — prefer it over guessing from the words. Then record the capture's
  screenshot + annotations as the change's **attachments** (see Step 3) so the
  implementer can also SEE the mark, not just read your summary.
- **Optional expert tag.** `run-changeset` auto-routes each change to a specialist
  subagent from its category + file paths, so you normally do **not** need to tag.
  Add an explicit `{expert: <role>}` suffix to a change heading **only** when the
  category/paths would mis-route and you're confident of the right specialist —
  valid roles: <!--EXPERTS:EXEC_ROLES:START-->`engineer`, `ui`, `game-tuning`, `tech-artist`, `artist`, `merge-icon-author`<!--EXPERTS:EXEC_ROLES:END-->. Leave a
  change untagged to let auto-routing (with a `general-purpose` fallback) decide.
- **Advisory experts while authoring.** If an item's intent or design is unclear,
  you may consult the read-only <!--EXPERTS:ADVISORY:START-->`product-owner` (scoping / acceptance criteria) or `game-designer` (mechanic / feel intent)<!--EXPERTS:ADVISORY:END--> to sharpen a change before writing it —
  these never appear *in* the changeset; they only shape it.
- **Split cleanly (load-bearing).** There is no team mode / cross-worktree ordering —
  each change runs in its own worktree in parallel, and `run-changeset` merges them
  sequentially onto an integration branch. Author changes to be **independent**. A genuine
  producer→consumer pair — e.g. *generate an asset* **and** *wire it into the renderer* —
  must be **one change with ordered sub-steps** (asset first), never two separate changes,
  because the consumer needs the producer's actual output. (`{team:}` / `{after:}` tags are
  no longer used.)

## Step 3 — Stage attachments, then write the changeset file

**3a. Stage Marksman assets into the repo (do this FIRST, for markup captures only).**
The capture assets live under `.cache/markdown/assets/<slug>/`, which is **gitignored** —
so they are invisible inside the isolated worktrees `run-changeset` cuts for each change.
Copy the ones a change references into a **committed** location before writing the changeset:

- Destination: `changesets/assets/<capture-slug>/` (create it). Copy `screenshot.png` and
  `annotations.json` (and any extra images) there. Use `Bash` (`mkdir -p` + `cp`).
- These files WILL be committed with the changeset — that is intentional; it is the only way
  the implementer's worktree can open them.
- Reference the **committed** paths (`changesets/assets/<capture-slug>/screenshot.png`) in the
  changeset, never the `.cache/` originals.

**3b. Write the changeset.** Write to `changesets/<name>.md` where `<name>` is derived from the
capture (its slug or a short topic slug, kebab-cased). Do not overwrite an existing changeset —
suffix an index if needed.

Use this exact structure so `run-changeset` parses it (category heading → change heading →
numbered sub-steps, then an optional `Attachments:` line). **Omit any category with no items.**

```markdown
# <short title> — from capture <capture filename>

> Source capture: <path passed in args>

## TUNING

### <change title>
1. <sub-step>
2. <sub-step>

## FIXES

### <change title>
1. <sub-step>
Attachments: changesets/assets/<capture-slug>/screenshot.png, changesets/assets/<capture-slug>/annotations.json

## FEATURES

### <change title>
1. <sub-step>
2. <sub-step>

<!-- filtered items (review before deleting) -->
<!-- filtered: "um okay let me try again" — filler -->
<!-- filtered: "can you hear me" — non-game speech -->
```

- Only include the categories that actually have changes. Within a category, each `###` heading
  is one change; the numbered items under it are its sequential sub-steps.
- **`Attachments:`** — add this single line under a change's sub-steps ONLY when that change came
  from a Marksman markup capture, listing the committed `changesets/assets/<slug>/...` paths you
  staged in 3a (comma-separated). `run-changeset` parses it into the change's `attachments` and
  hands those files to the implementer. Omit it for text-only changes.
- Always append the `<!-- filtered: ... -->` comment block, even if nothing was filtered — use
  `<!-- filtered: none -->` in that case. This gives the user a full audit trail of every item cut.

## Step 4 — Delete the source capture

After writing the changeset, **delete the source capture** — it has been fully processed and the
changeset (with its staged `changesets/assets/`) is the durable record. Use `Bash`:

- Remove the capture file at the resolved path (`<slug>.md` or `transcript-*.txt`).
- For a Marksman markup capture, also remove its `.cache/markdown/assets/<slug>/` folder — you
  staged the copies you need into `changesets/assets/` in Step 3a, so the originals are spent.
  (`rm -rf ".cache/markdown/assets/<slug>"` on Bash; `Remove-Item -Recurse -Force` on PowerShell.)

On Windows PowerShell: `Remove-Item "<path>"`. On Bash: `rm "<path>"`. If a delete fails for any
reason, warn the user but do not abort. **Never delete anything under `changesets/`** — those are
the durable record.

## Step 5 — Stop and hand off (review-first)

Do **not** run the changeset. After writing the file and deleting the capture, report to the user:
- the path of the changeset you wrote,
- a one-line summary per category (how many changes, what they cover),
- the exact command to run it once they're happy:
  `Run /run-changeset changesets/<name>.md` (or "run this changeset" with that
  path).

Tell them to review/edit the file first — especially the TUNING vs CHANGES
classification and the sub-steps — before running it.

## Notes

- This skill only authors the changeset; `run-changeset` is the executor (parallel
  worktrees per change, sequential sub-steps, then `arch-review`).
- Respect `./CLAUDE.md`: TUNING items must be expressible as `src/data/*.json` value
  edits; if an item you classified as TUNING actually needs code, move it to
  CHANGES/FEATURES before writing.
