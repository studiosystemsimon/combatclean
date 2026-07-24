// === sim-random — the seeded rng the orchestration owns (deterministic, headless-testable) ===
// MergeCombat's reducer called Math.random inline; here the controller owns ONE seeded rng, set at
// boot via seedSim(seed). Defaults to Math.random until seeded (so nothing crashes pre-boot).
import { makeRng, type Rng } from './rng.ts';

export let rng: Rng = Math.random;
export function seedSim(seed: number): void { rng = makeRng(seed); }
