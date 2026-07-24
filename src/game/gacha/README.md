# gacha — banner summons — weighted pulls, pity, exclusive pool

**Invariants** — pure functions; reads config via `../content.ts` (`C`); any randomness comes from an injected `rng`. No DOM, no game numbers as literals (all tuning is config).
