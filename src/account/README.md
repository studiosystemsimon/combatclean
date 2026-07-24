# account — player account (the server-authoritative seam)

**Invariants**
- The account is `@bishop/meta-contract`'s six-section blob — `resources` (id-keyed wallet) /
  `unlocks` (id set) / `items` (instances) / `profile` / `features` (+ `schemaVersion`). NEVER add a
  7th section or a per-currency field (`state.gold`); balances live in the flat `resources` map keyed
  by resource config id.
- Every account change goes through a TRANSACTION that emits an `AccountPatch`, applied by the ONE
  pure `applyPatch` (from meta-contract). No ad-hoc mutation. `inc` is delta-preserving (maps to a
  future `UPDATE … amount + n`).
- Storage-nature routing: a category's declared persistence picks the section — `resource` →
  `resources`, `item` → `items`, `unlock` → `unlocks`.
- Well-known resource ids come from `_global.json#refs` via `getRef(...)` — never a hardcoded number.

**No backend (today) → server later (a wiring change)**
- The account is backed by a local JSON doc (`ILocalStore` → `localStorage`). Client-only,
  non-authoritative.
- The SAME blob shape + patch/apply vocabulary + idempotent transaction protocol are what a meta
  server persists. Porting the economy = wrapping the transaction layer in REST (via
  `@bishop/meta-client`, vendored in `packages/bishop/`) and moving its validation to the server.
  Gameplay stays client-authoritative throughout; this file's shapes never change.
