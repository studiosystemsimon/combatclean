# data — live-HMR tuning globals + the view's presentation barrels

Two distinct jobs live here:

1. **Sim/view live-HMR globals** — `store.ts` deep-clones each tuning `*.json` into a mutable export
   and patches it **in place** on edit (Vite dep-accept), so the running sim reads new values next
   frame with no reload. `types.ts` types every tunable.
2. **Presentation barrels** — `_ui.js` + `heroes.js` / `gear.js` / `generators.js` / `enemies.js` /
   `rarities.js` / `zones.js` / `banners.js` / `assets.js` / `strings.js` recombine the logical
   config (`C`, from `src/game/content.ts`) with the UI registry (`C.ui`) into the shape the ported
   view reads. The config **registry itself** lives in `src/data/config` (see its README).

**Invariants**
- `store.ts`: `import.meta.hot.accept('./x.json', …)` calls must be **literal** (Vite's static
  analyzer can't follow aliases/loops); every tunable has a typed field in `types.ts`; consumers read
  the exported object (`gameConfig.foo`), never re-import the JSON.
- Barrels merge **presentation only** onto the logical entry and MUST strip the UI entry's identity
  `id`/`key` — a spread that lets `uiEntry.id` (numeric) clobber the logical slug `id` is the class of
  bug that made gacha `banner.id` become `6000` → `C.BANNERS[6000]` missed → silent no-op. Identity
  stays logical; barrels carry no logic (pure re-combine).
