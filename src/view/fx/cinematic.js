// ─────────────────────────────────────────────────────────────────────────────
// CINEMATIC COORDINATION LOCK (view layer).
// The chest choreography (chest-smash.js) and the level/area/boss INTROS
// (intro-director.js) are two independent view-layer VFX systems that must never
// play over the top of each other. The operator's contract:
//   • An intro must NOT start until ALL in-flight chests have resolved.
//   • A chest must NOT launch onto the screen once an intro has begun — it waits.
// Whoever is already running holds the stage; the other awaits its turn. This is a
// pure presentation gate — it never touches game state.
// ─────────────────────────────────────────────────────────────────────────────

let chests = 0;          // chests currently on screen (launch → fully resolved)
let introOn = false;     // an intro sequence is playing
const chestWaiters = []; // resolvers waiting for the intro to finish
const introWaiters = []; // resolvers waiting for every chest to resolve

const flush = (arr) => arr.splice(0).forEach((r) => r());

export const chestsBusy = () => chests > 0;
export const introBusy = () => introOn;

// ── chest side ──────────────────────────────────────────────────────────────
// A chest wants to launch: resolves once no intro is playing (immediately if none).
export const awaitClearForChest = () => (introOn ? new Promise((r) => chestWaiters.push(r)) : Promise.resolve());
export const chestStarted = () => { chests += 1; };
export const chestEnded = () => { chests = Math.max(0, chests - 1); if (chests === 0) flush(introWaiters); };

// ── intro side ──────────────────────────────────────────────────────────────
// An intro wants to play: resolves once every chest has resolved (immediately if none).
export const awaitClearForIntro = () => (chests > 0 ? new Promise((r) => introWaiters.push(r)) : Promise.resolve());
export const introStarted = () => { introOn = true; };
export const introEnded = () => { introOn = false; flush(chestWaiters); };
