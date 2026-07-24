// === rng — seeded PRNG for the sim (deterministic, headless-testable) ===
//
// MergeCombat used unseeded Math.random in the controller; combatclean injects a SEEDED rng at the
// sim boundary so a run is reproducible (the auto-play harness + determinism gate rely on it). Same
// distributions — only the specific sequence is now seed-derived. `makeRng(seed)()` → [0,1).
export type Rng = () => number;

/** mulberry32 — a fast, well-distributed seedable PRNG. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic string→uint hash (MergeCombat's per-instance attack-jitter/phase seed — pure, not rng). */
export function hash32(id: string | number): number {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
