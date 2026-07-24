// === GameSignals — the cross-module signal hub (exposed on world.bus) ===
//
// One typed Signal per cross-module event, REPLACING MergeCombat's pure-data `state.fx` queue: the
// sim/systems dispatch; the view/UI + FX subscribe (never dispatch — that's the input path's job).
// A publisher never knows its subscribers. This keeps combat/merge/economy logic decoupled from the
// renderer while preserving MergeCombat's every VFX/haptic trigger point (each fx event → a signal).
import { Signal } from '../core/events/signal.ts';
import type { GameSignals } from './types.ts';

export function createGameSignals(): GameSignals {
  return {
    merge: new Signal(),
    generatorTap: new Signal(),
    orderFulfilled: new Signal(),
    heroAttack: new Signal(),
    enemyAttack: new Signal(),
    abilityFired: new Signal(),
    limitBreak: new Signal(),
    combo: new Signal(),
    bossTelegraph: new Signal(),
    bossSpecial: new Signal(),
    bossHeal: new Signal(),
    bossRaise: new Signal(),
    waveClear: new Signal(),
    levelComplete: new Signal(),
    win: new Signal(),
    lose: new Signal(),
    gachaReveal: new Signal(),
    currencyChange: new Signal(),
  };
}
