# heroes — hero roster selectors — power, rarity, max level, ascension (ascendSelection SSOT)

**Hero-class = template; Character = instance.** The logical hero entry (`C.HEROES[slug]`) is the
stateless CLASS template — base stats, abilities, rarity, weapon chain, plus `classKey` (its class →
gates class-bound equip slots) and optional `slots` (its equip loadout, else `gearLoadout.defaultSlots`).
The stateful INSTANCE is `Character` on the account (`cid`, class slug via `.hero`, + level / ascension
/ rarity); its equipped loadout = gear instances with `equippedTo === cid` (derived, never stored).

**Invariants** — pure functions; reads config via `../content.ts` (`C`); any randomness comes from an injected `rng`. No DOM, no game numbers as literals (all tuning is config).
