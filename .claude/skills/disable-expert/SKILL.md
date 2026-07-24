---
name: disable-expert
model: sonnet
description: >-
  Disable an expert so run-changeset no longer routes to it — removes it from every
  workflow and doc (the EXPERTS enum, routing rule, valid-roles lists, roster tables),
  and moves its agent definition to .claude/experts/disabled/ (kept, never deleted). Also
  re-enables a disabled expert. Trigger when the user says "disable an expert", "remove an
  expert", "turn off <expert>", "re-enable <expert>", "/disable-expert", or similar. The
  args are the expert name (and optionally "enable" to restore one).
---

# disable-expert

Disables (or re-enables) an expert via `.claude/experts/manage.mjs`. Disabling flips the registry
entry to `enabled: false` (the entry is **kept**, not deleted), moves `agents/<name>.md` to
`.claude/experts/disabled/<name>.md` (so the harness stops discovering it), and regenerates every
wiring spot so the expert disappears from routing, the valid-roles lists, and the roster tables.

## Step 1 — Resolve the target

Parse the expert **name** from the args. If the user's intent is to **re-enable** a previously
disabled expert (e.g. "re-enable audio", "turn audio back on"), treat it as an `enable`. If unsure
which experts exist or their state, run `node .claude/experts/manage.mjs list` first.

You **cannot** disable the `qa` gate, and you cannot disable the last remaining execution/creative
expert (that would leave routing with no specialists) — the script refuses both. If the user asks
for one of these, explain why and stop.

## Step 2 — Run the manager

Disable:

```bash
node .claude/experts/manage.mjs disable <name>
```

Re-enable:

```bash
node .claude/experts/manage.mjs enable <name>
```

The script updates the registry, moves the `.md` file, and runs `sync`.

## Step 3 — Report

Report what the script printed: that the expert was disabled (and its definition **moved to
`.claude/experts/disabled/<name>.md`, not deleted**), and which wiring files `sync` regenerated. Note
that it can be restored later with `/disable-expert enable <name>` (or `manage.mjs enable <name>`).

## Notes

- Disable is non-destructive: the registry entry and the agent definition are both preserved, just
  deactivated and archived. Nothing is lost.
- Any changeset that still tags a disabled expert via `{expert: <name>}` will fail the parse-schema
  validation (the name is no longer in the `EXPERTS` enum) — that's expected; the expert is off.
- This skill manages **execution / creative / advisory** experts only (not the `qa` gate or the
  `arch-*` pairs). Adding is the inverse: `/add-expert <description>`.
