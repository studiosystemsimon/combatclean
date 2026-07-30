# view — the read-only render layer (React + Canvas-FX, ported from MergeCombat)

- **Shell** — `Game.jsx`: top currency bar (`Header`), a persistent combat panel (`Autobattler`), a
  swappable context panel driven by `NavBar`, the bottom nav, and the VFX overlay (`FxLayer`).
- **Widgets** — `Board` / `Cell` / `Orders` / `HpBar` / `RarityGrid` / `EquipmentTile` / `Art` /
  `PeekScroll` / `AfkAlert` and helpers (`fmt.js`, `assets.js`, `haptics.js`).
- **`screens/`** — the per-nav panels (Merge / Heroes / Gear / Gacha / Map / Minigame) + overlays
  (`HeroMenu`, `RewardPopup`, `AfkPopup`, `HeadlessScreen`).
- **`fx/`** — the Canvas VFX engine (`fx-engine`, `reveal-engine`) + directors (gacha-reveal,
  currency-pickup, counter-tween, chest-smash, hero-fx, intro/cinematic, `perf-probe`), driven by
  subscribing to `GameSignals`.
- **`hooks/`** — view-only React hooks (`useScrollShadows`). **`combat/vsm/`** — per-entity visual
  config (its own README).

**Signals** — consumes `GameSignals` (`world.bus`) ↓; reads state via the controller. Never
dispatches game signals.

**Invariants (OVERRIDING — view is a pure reader)**
- Zero game logic, zero state writes. Reads state/actions via the controller (`useGame` /
  `useActions`) and content/presentation via the `src/data/*` barrels + the `assets.js` resolver
  (art from `virtual:asset-registry`). `import type` only across the game boundary.
- Every player-facing **quantity** number goes through `fmtK` (`src/view/fmt.js`) — never hand-roll
  k/m abbreviation.
- Lists never show scrollbars — use `PeekScroll` (peek + fade gradient).
