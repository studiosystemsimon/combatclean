# board — the merge-board grid: cells, placement, drag/move geometry

**Invariants** — pure functions; reads config via `../content.ts` (`C`); any randomness comes from an injected `rng`. No DOM, no game numbers as literals (all tuning is config). A `BoardGenerator` carries a 0-based `level` (`makeGenerator(id, genId, level = 0)`), mirroring 0-based item tiers — generators are levelled, mergeable board tiles; the level rides the persisted cell object.
