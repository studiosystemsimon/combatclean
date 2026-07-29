// === minigame meta endpoint — the SERVER-AUTHORITATIVE reward resolver (simulated) ===
// A completed minigame submits its result data structure here; the "server" computes the reward from the
// config rules (C.MINIGAME) and returns it. No backend today → this resolves in-process. Swapping to a
// real server is a WIRING CHANGE: replace the body with a @bishop/meta-client round-trip that returns
// the SAME MinigameOutcome shape — callers (the controller) are unchanged.
import { C } from '../content.ts';

// A minigame's OUTPUT — a plain data structure it returns to the harness. `score` drives the reward;
// minigames may carry extra fields the (future) server reads.
export interface MinigameResult { score?: number; [k: string]: unknown }
export interface MinigameSubmission { minigameId: string; result: MinigameResult }
export interface MinigameReward { coins: number; heroXp: number; gearXp: number }
export interface MinigameOutcome { minigameId: string; reward: MinigameReward }

export function submitMinigame(sub: MinigameSubmission): Promise<MinigameOutcome> {
  const { reward, perScore } = C.MINIGAME;
  const score = Math.max(0, Math.floor(Number(sub.result?.score) || 0));
  return Promise.resolve({
    minigameId: sub.minigameId,
    reward: {
      coins: reward.coins + perScore.coins * score,
      heroXp: reward.heroXp + perScore.heroXp * score,
      gearXp: reward.gearXp + perScore.gearXp * score,
    },
  });
}
