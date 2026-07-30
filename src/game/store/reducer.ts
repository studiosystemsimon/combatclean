// === reducer — the game orchestration (ported from MergeCombat controller/reducer.js) ===
// Pure model transforms + owned ids/randomness/time. Emits pure-data VFX events on state.fx (the
// facade converts these to GameSignals). Reads the content singleton C; randomness = the seeded `rng`.
// State shape is MergeCombat's in-memory runtime; its PERSISTED slice maps to the six-section account.
//
// The transitions were formerly one 45-case switch; they now live as per-domain HANDLER MAPS in the
// reducer-<domain> slices (shell / board / orders / combat / gacha / heroes / gear), each keyed by the
// same action.type. This file is the thin COMBINATOR: it merges the slice maps into one dispatch table
// and routes by action.type (missing type → state unchanged, matching the old `default`). Shared
// orchestration primitives + initState/buildBattle live in reducer-helpers (re-exported here so the
// module's public surface — reducer / initState / buildBattle — is unchanged). See src/game/store/README.md.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { shellHandlers } from './reducer-shell.ts';
import { boardHandlers } from './reducer-board.ts';
import { ordersHandlers } from './reducer-orders.ts';
import { combatHandlers } from './reducer-combat.ts';
import { gachaHandlers } from './reducer-gacha.ts';
import { heroesHandlers } from './reducer-heroes.ts';
import { gearHandlers } from './reducer-gear.ts';

export { buildBattle, initState } from './reducer-helpers.ts';

type S = any; // MergeCombat's runtime state shape (dynamic); persisted slice maps to the account.
type Act = any;

// One dispatch table over all slices. Each action.type is owned by exactly one slice (verified against
// actions.ts); the spreads are collision-free by construction.
const HANDLERS: Record<string, (state: S, action: Act) => S> = {
  ...shellHandlers,
  ...boardHandlers,
  ...ordersHandlers,
  ...combatHandlers,
  ...gachaHandlers,
  ...heroesHandlers,
  ...gearHandlers,
};

export const reducer = (state: S, action: Act): S => {
  const handle = HANDLERS[action.type];
  return handle ? handle(state, action) : state; // unknown action.type → unchanged (former `default`)
};
