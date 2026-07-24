// === energy — regenerating energy wallet (ported from MergeCombat model/energy.js) ===
// Time passed in as `now` (ms epoch) — never read inline — so these stay pure.
import { C } from '../content.ts';

export interface Energy { current: number; max: number; lastRegenAt: number }

export const initEnergy = (now: number): Energy => ({ current: C.ENERGY.start, max: C.ENERGY.max, lastRegenAt: now });

export const regen = (energy: Energy, now: number): Energy => {
  if (energy.current >= energy.max) return { ...energy, lastRegenAt: now };
  const ticks = Math.floor((now - energy.lastRegenAt) / C.ENERGY.regenMs);
  if (ticks <= 0) return energy;
  const current = Math.min(energy.max, energy.current + ticks * C.ENERGY.regenAmount);
  const lastRegenAt = current >= energy.max ? now : energy.lastRegenAt + ticks * C.ENERGY.regenMs;
  return { ...energy, current, lastRegenAt };
};

export const canSpend = (energy: Energy, amount: number) => energy.current >= amount;

export const spend = (energy: Energy, amount: number, now: number): Energy => {
  if (!canSpend(energy, amount)) return energy;
  const wasFull = energy.current >= energy.max;
  return { ...energy, current: energy.current - amount, lastRegenAt: wasFull ? now : energy.lastRegenAt };
};

export const msToNext = (energy: Energy, now: number) => {
  if (energy.current >= energy.max) return 0;
  const rem = C.ENERGY.regenMs - ((now - energy.lastRegenAt) % C.ENERGY.regenMs);
  return rem <= 0 ? C.ENERGY.regenMs : rem;
};
