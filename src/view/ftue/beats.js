// === FTUE coachmark beats (view-side) ===
// The guided-opening sequence, driven purely by OBSERVABLE state + persisted ftueSeen_* flags.
// Each beat: `show(state)` (when it's relevant) and, for ACTION beats, `done(state)` (when complete →
// the driver records it seen). Info beats (no `done`) advance on a GOT IT tap.
//
// IMPORTANT — every `done` must be MONOTONIC: false until the action is done, then true (and stay true
// long enough to be recorded). The driver records completion INDEPENDENT of `show` (a beat's show can
// flip false the same tick its done becomes true — e.g. delivering the potion both charges the hero
// AND clears the order), so `show`/`done` no longer need to be mutually consistent.
//
// Copy is presentation and lives here. Removing the FTUE = delete this folder + the one <FtueLayer/>
// mount; the sim-side overrides fall through on their own (see src/data/config/schemas/ftue.ts).
import { isLimitReady } from '../../model/battle.js';
import { canFulfill } from '../../model/orders.js';

const seen = (s, id) => !!(s.flags && s.flags['ftueSeen_' + id]);
const potionOrder = (s) => (s.orders || []).find((o) => o && o.reward === 'potion' && Array.isArray(o.items) && o.items.length && !o.fulfilling && !o.pending);
const potionDeliverable = (s) => { const o = potionOrder(s); return !!o && canFulfill(s.board, o); };
const unlockedTierUp = (s) => (s.board || []).some((c) => c && c.kind === 'item' && !c.special && !c.locked && c.level >= 1);
const anyReady = (s) => (s.battle.heroes || []).some((h) => isLimitReady(h));

// Ordered. The driver shows the FIRST unseen beat whose `show(state)` holds.
export const FTUE_BEATS = [
  { id: 'firstLoss', style: 'nudge', pause: true, // reactive interrupt on the first defeat; freezes the sim (post-loss recovering fight)
    copy: 'Wiped out — time to power up your squad.',
    sub: 'Open HEROES → EQUIP your best gear on your heroes and LEVEL them to the MAX, then dive back in.',
    show: (s) => !!(s.flags && s.flags.ftueFirstLoss) && s.battle.status !== 'lost' },

  { id: 'coldOpen', style: 'nudge', // info (GOT IT)
    copy: 'Your squad fights on its own.',
    sub: 'Autos alone won’t break through — charge a LIMIT to wipe the wave.',
    show: (s) => s.battle.level === 1 },

  { id: 'forge', style: 'gate', // info (GOT IT) — the board already seeds tiles, so this teaches, not gates
    copy: 'Tap a generator to forge weapon tiles.',
    sub: 'Each tap drops a tile onto the board.',
    show: (s) => seen(s, 'coldOpen') },

  { id: 'merge', style: 'gate',
    copy: 'Drag two matching blade tiles together to merge them.',
    sub: 'Two of a kind become one of the next tier — enough to complete the 🧪 order.',
    show: (s) => seen(s, 'forge'),
    done: (s) => potionDeliverable(s) || unlockedTierUp(s) },

  { id: 'potion', style: 'gate',
    copy: 'Deliver the 🧪 LIMIT POTION order.',
    sub: 'It fills your hero’s limit bar to full.',
    show: (s) => seen(s, 'merge') && !!potionOrder(s),
    done: (s) => anyReady(s) }, // the potion fills to FULL → a hero becomes limit-ready

  { id: 'limit', style: 'gate',
    copy: 'Tap your glowing hero — unleash the LIMIT BREAK!',
    sub: 'It wipes the whole wave at once.',
    show: (s) => anyReady(s),
    done: (s) => !!(s.flags && s.flags.ftueLimitFired) },

  { id: 'summon', style: 'gate',
    copy: 'Things are getting tough — hire another hero!',
    sub: 'Head to SUMMON and recruit — your first pull is on us.',
    show: (s) => !!(s.flags && s.flags.ftueFirstPull),
    done: (s) => !!(s.flags && s.flags.ftuePulled) },

  { id: 'alchemistExplain', style: 'nudge', pause: true, // info (GOT IT); freezes the sim while it explains
    copy: 'Meet the ALCHEMIST — its LIMIT BREAK hits EVERY enemy at once.',
    sub: 'Charge it up, then unleash it to clear the whole screen.',
    show: (s) => !!(s.flags && s.flags.ftuePulled) && s.screen === 'merge' },

  { id: 'alchemistUse', style: 'gate',
    copy: 'Charge & unleash the ALCHEMIST’s limit — wipe them all!',
    sub: 'Its AOE limit hits every enemy on screen at once.',
    show: (s) => seen(s, 'alchemistExplain'),
    done: (s) => !!(s.flags && s.flags.ftueAlchemistUsed) },

  { id: 'gearUp', style: 'nudge', pause: true, // info (GOT IT); freezes the sim while it explains
    copy: 'Now GEAR UP and LEVEL UP your squad.',
    sub: 'Open HEROES to spend the XP + gear your orders drop — grow stronger for the boss.',
    show: (s) => seen(s, 'alchemistUse') },

  { id: 'bossHire', style: 'gate', // info (GOT IT); the boss GATE already holds combat, so no pause needed
    copy: 'A BOSS looms ahead — hire another hero!',
    sub: 'Head to SUMMON and recruit reinforcements before you challenge it.',
    show: (s) => s.battle.status === 'gate' },
];
