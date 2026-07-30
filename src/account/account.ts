// === Player account — MergeCombat's economy on the six-section blob (transactions → applyPatch) ===
//
// MergeCombat is continuous-state (no discrete runs), so MOST persisted state is the account:
//   resources (WALLET, id-keyed) — coins, heroXp, gearXp, energy, + 6 ascension crystals.
//   items (INSTANCES)            — owned hero characters + gear pieces (one instance each; v5 model).
//   unlocks (id set)             — reserved for one-time permanent grants.
//   profile                      — clearedLevel, ordersCompleted, pity, squad (hero iids), lastSeen, haptics.
//   features                     — the continuous meta-state: merge.board, orders.rail, battle.level.
// Every change is a TRANSACTION emitting an AccountPatch, applied by the ONE pure applyPatch. `inc`
// for wallets. Well-known resource ids come from _global.json#refs via getRef — never a literal.
import { applyPatch, type AccountPatch, type ClientAccountView, type ItemInstance } from '@bishop/meta-contract';
import { getRef, energy, battle } from '../data/config/repository.ts';

export const ACCOUNT_DOC = 'combatclean.account';
const SCHEMA_VERSION = 1;

// ── well-known resource ids (data-driven; no hardcoded numbers) ──
export const RES = {
  coins: () => getRef('coinsResourceId'),
  heroXp: () => getRef('heroXpResourceId'),
  gearXp: () => getRef('gearXpResourceId'),
  energy: () => getRef('energyResourceId'),
  crystal: (rarityKey: string) => getRef(`crystal${rarityKey.replace(/^./, (c) => c.toUpperCase())}ResourceId`),
};

/** A fresh account: six sections seeded data-driven from config. features.merge/orders are seeded by
 *  their systems from config on first sim init (Phase 4); the account holds them once written. */
export function freshAccount(now = 0): ClientAccountView {
  const resources: Record<string, number> = {
    [RES.coins()]: 0, [RES.heroXp()]: 0, [RES.gearXp()]: 0, [RES.energy()]: energy.start,
  };
  // one starter hero character as an item instance (rarity/stats derive from its config).
  const starter: ItemInstance = { iid: newIid(), configId: getRef('starterHeroConfigId'), kind: 'hero', level: 1, abilityLevel: 0, ascensions: 0 };
  return {
    schemaVersion: SCHEMA_VERSION,
    resources,
    unlocks: [],
    items: [starter],
    profile: {
      clearedLevel: battle.startLevel - 1, // highest level BEATEN (AFK/progression stream); 0 for a fresh account
      ordersCompleted: 0,
      pity: {},
      squad: [starter.iid],
      hapticsEnabled: true,
      lastSeen: now,
    },
    features: { battle: { level: battle.startLevel } },
  };
}

// ── reads ──
export function balance(view: ClientAccountView, resourceConfigId: number): number {
  return view.resources[String(resourceConfigId)] ?? 0;
}
export function itemsOfKind(view: ClientAccountView, kind: string): ItemInstance[] {
  return view.items.filter((i) => i.kind === kind);
}
export function findItem(view: ClientAccountView, iid: string): ItemInstance | undefined {
  return view.items.find((i) => i.iid === iid);
}
export function newIid(): string {
  return crypto.randomUUID();
}
export function canAfford(view: ClientAccountView, resourceConfigId: number, cost: number): boolean {
  return balance(view, resourceConfigId) >= cost;
}

// ── transaction primitives (each returns AccountPatch ops; storage-nature routed) ──

/** Grant/spend a wallet resource — delta-preserving `inc`. Negative to spend. */
export function incResource(resourceConfigId: number, amount: number): AccountPatch {
  return amount === 0 ? [] : [{ op: 'inc', path: `resources/${resourceConfigId}`, amount }];
}

/** Spend a resource with an affordability guard (a plausible-reject, like the server later). */
export function spendResource(view: ClientAccountView, resourceConfigId: number, cost: number): AccountPatch {
  if (!canAfford(view, resourceConfigId, cost)) throw new Error(`[account] insufficient balance: need ${cost}, have ${balance(view, resourceConfigId)}`);
  return incResource(resourceConfigId, -cost);
}

/** Grant a new item INSTANCE (hero or gear). The caller supplies the game-shaped fields + a fresh iid. */
export function grantItem(entry: Omit<ItemInstance, 'iid'> & { iid?: string }): AccountPatch {
  return [{ op: 'append', path: 'items', entry: { iid: entry.iid ?? newIid(), ...entry } }];
}

/** Update an item instance in place (remove + re-append with merged fields — arrays mutate by iid). */
export function updateItem(view: ClientAccountView, iid: string, patch: Record<string, unknown>): AccountPatch {
  const cur = findItem(view, iid);
  if (!cur) return [];
  return [
    { op: 'remove', path: 'items', id: iid },
    { op: 'append', path: 'items', entry: { ...cur, ...patch } },
  ];
}

/** Remove an item instance (e.g. an ascension sacrifice, gear fusion fodder). */
export function removeItem(iid: string): AccountPatch {
  return [{ op: 'remove', path: 'items', id: iid }];
}

/** Grant a permanent one-time unlock (flat set — no-op if already present). */
export function grantUnlock(view: ClientAccountView, configId: number): AccountPatch {
  return view.unlocks.includes(configId) ? [] : [{ op: 'append', path: 'unlocks', entry: configId }];
}

/** Set a profile field (clearedLevel, ordersCompleted, squad, pity, …). */
export function setProfile(field: string, value: unknown): AccountPatch {
  return [{ op: 'set', path: `profile/${field}`, value }];
}

/** Set a feature-slice value (merge.board, orders.rail, battle.level — namespaced per feature). */
export function setFeature(slicePath: string, value: unknown): AccountPatch {
  return [{ op: 'set', path: `features/${slicePath}`, value }];
}

/** Apply a transaction's patch to the account (the ONE pure applier; never mutates the input). */
export function applyTransaction(view: ClientAccountView, patch: AccountPatch): ClientAccountView {
  return applyPatch(view, patch);
}
