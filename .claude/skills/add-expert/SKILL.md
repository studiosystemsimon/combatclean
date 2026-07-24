---
name: add-expert
model: sonnet
description: >-
  Add a new expert (a role-based subagent run-changeset can route changes to) to this
  project's changeset workflow. Turns a natural-language role description into a registry
  entry + a scaffolded agent definition, optionally puts the expert on a team (a named
  group whose shared reference files are injected into each member's context), and
  regenerates every workflow/doc wiring spot from the registry. Trigger when the user says
  "add an expert", "add a new expert", "create an expert", "/add-expert", or describes a
  new specialist role they want in the changeset pipeline. The args are the description of
  the expert to add. Confirms the derived definition before writing.
---

# add-expert

Adds an expert to `.claude/experts/registry.json` (the single source of truth) and regenerates all
the scattered wiring — the `EXPERTS` enum + routing rule in `run-changeset.mjs`, the valid-roles
lists in `transcript-to-changeset` / `router/policy.md`, the roster tables in `.claude/README.md`,
and the governance note in `CLAUDE.md`. The deterministic work is done by
`.claude/experts/manage.mjs`; this skill only turns the request into a spec and confirms it.

Read `.claude/experts/README.md` (the registry schema) first if you're unsure of a field.

## Step 1 — Derive the expert from the request

From the user's description (the args), and by looking at the repo's module layout (`CLAUDE.md`
Module index, `src/` folders), decide:

- **name** — kebab-case, unique, not an existing expert. It becomes `agents/<name>.md` and the
  subagent type.
- **group** — `execution` (edits code/data), `creative` (generates assets), or `advisory`
  (read-only consultant). Only these three are addable here.
- **model** — `haiku` (cheap/mechanical), `sonnet` (default), or `opus` (hard/cross-cutting).
- **role** — one short line.
- **owns** — the path globs this expert owns (for `execution`/`creative`), e.g. `["src/audio/**"]`.
  Make sure they don't overlap an existing expert's owned paths (check the registry / README table).
- For `execution`/`creative` also derive: **routeHint** (a short "mostly src/audio" clause used in
  the first-match routing rule), **routePriority** (an integer ordering it against the existing
  hints — more specific paths get a *lower* number so they match first; the catch-all `engineer` is
  last), **ownsLabel** + **focus** (the display cells for the README table).
- For `advisory` derive: **consultFor** (README cell) + **consultShort** (short inline hint).
- **responsibilities** — 2–4 bullet points (the common definition every expert carries).
- **teams** — any teams this expert should join (see Step 2).
- **references** — extra context files to inject into this expert's context (paths in the repo).
- **description** + **expertise** — the agent-file `description:` frontmatter and a short prose
  block for the body (its quality bar / rules, in the house style of the existing `agents/*.md`).

## Step 2 — Teams (optional)

If the user wants the expert on a team, check `registry.json`'s `teams` map. For any **new** team,
ask the user for a one-line description and the shared **reference files** it should carry (these get
injected into every member's `## References` section). Pass new teams in the spec's `newTeams` map.

## Step 3 — Confirm

Present a concise summary of the derived expert (name, group, model, owned paths, teams, references,
route placement) and **ask the user to confirm or adjust** before writing anything. Do not skip this.

## Step 4 — Write the spec and run the script

Write the spec to a temp JSON file, then run the manager. Example spec:

```json
{
  "name": "audio",
  "group": "execution",
  "model": "sonnet",
  "role": "Audio & sound-design engineer",
  "owns": ["src/audio/**"],
  "routeHint": "mostly src/audio",
  "routePriority": 4,
  "ownsLabel": "`src/audio`",
  "focus": "SFX/music systems + audio asset wiring; reads tuning from data.",
  "responsibilities": ["Audio systems and mixing", "Wiring sound to game signals"],
  "teams": ["core-sim"],
  "references": [],
  "newTeams": {},
  "description": "Audio engineer. Use for changes under src/audio — SFX, music, mixing.",
  "expertise": "## What good looks like\n- Audio reacts to signals, never polls the sim.\n"
}
```

```bash
node .claude/experts/manage.mjs add /tmp/add-expert-spec.json
```

The script validates the registry, appends the entry, scaffolds `agents/<name>.md` (only if it
doesn't already exist), creates any new teams, and runs `sync`. Delete the temp spec after.

## Step 5 — Report

Report what the script printed: the new expert, its agent file, and the files `sync` regenerated. If
the user wanted specific expertise/rules in the agent file beyond the scaffold, offer to flesh out
`agents/<name>.md` (its prose body is yours to edit; only the `## References` region is generated).

## Notes

- This skill manages **execution / creative / advisory** experts only. The `qa` gate and the
  `arch-*` reviewer/fixer pairs are out of scope by design.
- If the script fails validation (e.g. duplicate name, overlapping owned paths, unknown team), fix
  the spec and re-run — it writes nothing on a validation error.
- Disabling is the inverse: `/disable-expert <name>`.
