#!/usr/bin/env bash
# generate.sh <slug> [subject]
# Deploy-a-Claude-instance + generate ONE hero class end-to-end, staging into
# trim/assets/heroes/ (via gen.sh's OUT), so the trim tool can show it immediately.
#
# If <slug> has no classes.tsv subject and none is passed (arg or $GEN_SUBJECT),
# a headless `claude -p` instance authors the subject line in the locked style.
#
#   FORCE=1   (default here) regenerate even if the png already exists
#   DRY_RUN=1 skip claude + gen.sh; fake an output PNG (for tool-plumbing tests)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
SLUG="${1:?usage: generate.sh <slug> [subject]}"
SUBJECT="${2:-${GEN_SUBJECT:-}}"
TSV="$ROOT/classes.tsv"
OUT="$ROOT/trim/assets/heroes"
LOG="$ROOT/logs/gen-$SLUG.log"
mkdir -p "$ROOT/logs" "$OUT"
: > "$LOG"
log(){ echo "$*" | tee -a "$LOG"; }

row_exists(){ grep -qiE "^${SLUG}"$'\t' "$TSV" 2>/dev/null; }

if [ "${DRY_RUN:-0}" = "1" ]; then
  log "[dry-run] simulating generation of '$SLUG'"; sleep 2
  src="$(ls "$OUT"/*.png 2>/dev/null | grep -vE '_(trim|256)\.png$' | head -1)"
  [ -n "$src" ] && cp "$src" "$OUT/$SLUG.png"
  log "[dry-run] wrote $OUT/$SLUG.png"; exit 0
fi

if [ -n "$SUBJECT" ]; then
  log "using provided subject"
  tmp="$(mktemp)"; grep -viE "^${SLUG}"$'\t' "$TSV" > "$tmp" 2>/dev/null || true
  printf '%s\t%s\n' "$SLUG" "$SUBJECT" >> "$tmp"; mv "$tmp" "$TSV"
elif ! row_exists; then
  log "deploying a Claude instance to author the subject for '$SLUG'…"
  PROMPT="You are the combatclean hero-art-pipeline. Write ONE classes.tsv SUBJECT line for the fantasy RPG character class \"$SLUG\" in the locked chibi style. Describe ONLY: gender; hair colour as a root-to-tip gradient; an ornate Honkai-Impact-style layered costume; the signature weapon; and a dynamic combat pose. Do NOT mention art style, proportions, outlines, background, or visual effects (those are locked in gen.sh). Reply with ONLY the subject text on a single line — no quotes, no slug, no preamble."
  SUBJECT="$(claude -p "$PROMPT" 2>>"$LOG" | tr -d '\r' | sed '/^[[:space:]]*$/d' | head -1)"
  if [ -z "$SUBJECT" ]; then log "FAIL: claude produced no subject"; exit 1; fi
  log "subject: $SUBJECT"
  printf '%s\t%s\n' "$SLUG" "$SUBJECT" >> "$TSV"
else
  log "using existing classes.tsv subject for '$SLUG'"
fi

log "running gen.sh $SLUG (FORCE=${FORCE:-1})…"
FORCE="${FORCE:-1}" bash "$ROOT/gen.sh" "$SLUG" 2>&1 | tee -a "$LOG"

if [ -f "$OUT/$SLUG.png" ]; then log "DONE: $OUT/$SLUG.png"; exit 0; fi
log "FAIL: no output produced"; exit 1
