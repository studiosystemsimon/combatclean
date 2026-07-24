# orders — the order rail — arrivals, fulfilment, filler, reroll, rewards

**Invariants** — pure functions; reads config via `../content.ts` (`C`); any randomness comes from an injected `rng`. No DOM, no game numbers as literals (all tuning is config).
