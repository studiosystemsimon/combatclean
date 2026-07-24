# platform — host abstraction (browser / Capacitor)

`haptics.ts` — the haptic-output port. The browser impl maps impact/notification styles to the
Vibration API (no-op where absent). A Capacitor impl (`@capacitor/haptics`) swaps in behind this same
port on device (Phase 7) without touching callers.

**Invariants** — `src/view/haptics.js` remains the single owner of the fx→haptic MAPPING/vocabulary;
this port is only the low-level output primitive. Never throws into the render loop (all calls guarded).
