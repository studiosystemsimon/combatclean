// === game types — the headless sim's data records (flat, composition-over-inheritance) ===
//
// Mirrors MergeCombat's runtime shapes so the ported model stays faithful. RUN state lives in the
// World (in-memory); persistent state lives in the account (see src/account). No DOM/render types here.
import type { Signal } from '../core/events/signal.ts';

// ── merge board ──
export interface BoardItem { id: number; kind: 'item'; chain: string; level: number; locked?: boolean }
export interface BoardGenerator { id: number; kind: 'generator'; genId: string }
export type BoardCell = BoardItem | BoardGenerator | null;

// ── orders ──
export interface OrderItem { chain: string; level: number }
export interface Order { id: number; items: OrderItem[]; difficulty: number; rarity: string; pending?: boolean; dur?: number; fulfilling?: boolean }

// ── autobattler ──
export interface Enemy {
  arch: string; asset: string; name: string; uid: number;
  hp: number; maxHp: number; atk: number;
  atkMs?: number; accomplice?: boolean; isBoss?: boolean;
  specialMs?: number; specialCount?: number; telegraphed?: boolean; healMs?: number;
}
export interface BattleHero {
  id: string; hero: string; hp: number; maxHp: number; atk: number;
  abilityMul: number; normalMs: number; basicMs: number; limitOrders: number;
}
export type BattleStatus = 'intro' | 'fighting' | 'clearing' | 'won' | 'lost' | 'gate' | 'chest';
export interface BattleState {
  level: number; wave: Enemy[]; heroes: BattleHero[]; status: BattleStatus;
  recovering?: boolean; focusUid?: number | null; comboUid?: number | null; comboN?: number;
}

// ── owned instances (runtime views resolved from account items) ──
export interface Character { cid: string; hero: string; level: number; abilityLevel: number; rarity: string }
export interface GearItem { id: string; pieceId: string; slot: string; rarity: string; level: number; base: number; equippedTo: string | null; unique?: boolean }

/** The in-memory run state a sim step reads/writes; persistent results flow to the account via transactions. */
export interface World {
  bus: GameSignals;
}

// ── the cross-module signal hub (typed events on world.bus; replaces MergeCombat's fx queue) ──
export interface GameSignals {
  readonly merge: Signal<{ chain: string; level: number; cell: number }>;
  readonly generatorTap: Signal<{ genId: string; cell: number }>;
  readonly orderFulfilled: Signal<{ orderId: number; rarity: string }>;
  readonly heroAttack: Signal<{ heroId: string; weapon: string; targetUid: number; dmg: number; crit: boolean }>;
  readonly enemyAttack: Signal<{ enemyUid: number; heroId: string; dmg: number }>;
  readonly abilityFired: Signal<{ heroId: string }>;
  readonly limitBreak: Signal<{ heroId: string }>;
  readonly combo: Signal<{ uid: number; n: number }>;
  readonly bossTelegraph: Signal<{ uid: number }>;
  readonly bossSpecial: Signal<{ uid: number; heroIds: string[] }>;
  readonly bossHeal: Signal<{ uid: number; amount: number }>;
  readonly bossRaise: Signal<{ uid: number; raised: number[] }>;
  readonly waveClear: Signal<{ level: number }>;
  readonly levelComplete: Signal<{ level: number }>;
  readonly win: Signal<{ level: number }>;
  readonly lose: Signal<{ level: number }>;
  readonly gachaReveal: Signal<{ heroId: string; rarity: string; count: number }>;
  readonly currencyChange: Signal<{ resourceConfigId: number; delta: number }>;
}
