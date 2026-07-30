# gear — gear pieces — power, equip, fuse, chest tiers, per-hero gear power

**Loadout / slots (generic modular)** — a hero-CLASS declares its equip slots (`C.HEROES[slug].slots`,
else `C.GEAR_LOADOUT.defaultSlots`); resolve with `slotsForClass(slug)` / `heroClassOf(slug)`. Equip is
gated by `canEquip(gearItem, cls)` = right slot family + the class HAS that slot + (for `classBound`
slots, e.g. `classAccessory`) the piece's `classKey` matches the class's `classKey`. auto-equip /
candidates / fuse-fodder iterate the CLASS's slots (never a global list) and take `cls`. `rollGear`
excludes class-bound (`classKey`) pieces — they are special drops.

**Invariants** — pure functions; reads config via `../content.ts` (`C`); any randomness comes from an injected `rng`. No DOM, no game numbers as literals (all tuning is config).
