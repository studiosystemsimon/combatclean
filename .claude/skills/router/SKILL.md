---
name: router
model: haiku
description: >-
  Control the prompt router's raw-mode (whether prompts are auto-routed into the
  changeset pipeline or handled by Claude directly). Manages marker files only —
  generic and portable, no project specifics. Trigger with "/router raw",
  "/router auto", "/router status", "/router power", or phrases like "turn off
  routing" / "go raw" / "enable auto routing". The args carry the sub-command
  (raw | auto | status | power) and optional --global. With NO arguments (a bare
  "/router"), it reports the current state and changes nothing.
---

# router

Toggles the prompt router (`.claude/hooks/route-prompt.mjs`) between **auto** (change requests
are routed into the changeset pipeline) and **raw** (Claude handles prompts directly). This
skill only reads/writes small marker files — it is generic and identical across projects.

**Raw-mode precedence** (the hook checks in this order; first match wins → routing off):
1. **Global** — `~/.claude/router-global-raw` exists → raw in every session, every project.
2. **Repo** — `<repo>/.claude/.router-mode` contains `raw` → raw in this project.
3. **Sigil** — a single prompt starting with `raw:` or `!!` → raw for that message only (no
   skill needed).

Parse the sub-command from args. **If the args are empty (a bare `/router`), run `status`** —
report the current state and change nothing (this is the default action). `--global` targets the
global marker; otherwise the repo marker.

## `raw` (repo) — `/router raw`
Write the text `raw` to `<repo>/.claude/.router-mode`. Report: *"Router: RAW for this repo —
prompts go straight to Claude. Re-enable with `/router auto`."*

## `auto` (repo) — `/router auto`
Write the text `auto` to `<repo>/.claude/.router-mode` (or delete the file). Report: *"Router:
AUTO for this repo — change requests route into the changeset pipeline."*

## `power` / `raw --global` — `/router power` or `/router raw --global`
Create the marker file `~/.claude/router-global-raw` (empty is fine; resolve `~` to the user's
home). Report: *"Router: RAW globally — every session in every project bypasses routing. Clear
with `/router auto --global`."*

## `auto --global` — `/router auto --global`
Delete `~/.claude/router-global-raw` if it exists. Report: *"Router: global raw cleared — repo
and sigil rules apply again."*

## `status` — `/router status`
Resolve the effective mode by checking, in order: the global marker, then the repo marker.
Report the effective mode (RAW / AUTO), **which scope set it** (global / repo / default-auto),
and the available one-off sigils (`raw:`, `!!`).

## Notes
- The repo marker `.claude/.router-mode` is gitignored (local/ephemeral) so the shared default
  stays AUTO; nobody commits a raw marker. The global marker lives in `~/.claude` and is never
  in any repo.
- Use Bash or the Write tool to manage the marker files. On Windows, resolve the home directory
  from `$HOME` / `%USERPROFILE%` (e.g. `C:\Users\<you>\.claude\router-global-raw`).
