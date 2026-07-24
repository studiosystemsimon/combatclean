// ─────────────────────────────────────────────────────────────────────────────
// HAPTICS (view layer — tactile presentation output)
// The SINGLE owner of all haptic output. It is driven by the SAME pure-data `fx`
// feedback bus the visual layer drains: FxLayer maps each fx event to visuals, and
// calls hapticForFx() to map the same event to a haptic. There is NO parallel
// feedback channel — haptics ride the existing bus (see CLAUDE.md).
//
// Best practice for a mobile merge-2 / idle-RPG (AFK-Arena-style autobattler):
//   • RESTRAINT — combat is idle/automatic, so there is NO per-tick / per-hit
//     buzzing. Haptics are punctuation: merges, generator pops, order rewards,
//     wins, ultimates, crits, big boss hits — nothing else.
//   • INTENSITY ∝ SIGNIFICANCE — a common merge is a light tick; a rare high-tier
//     merge is heavy + a success chime; a reward/win is a success notification; a
//     loss is a warning.
//   • THROTTLED — high-frequency sources (crit, generator drop, boss slam) are
//     rate-limited so nothing machine-guns.
//   • CONSISTENT VOCABULARY — one meaning per pattern, applied everywhere.
//   • TOGGLEABLE — honours an enabled flag (default from data/config.js). A future
//     settings screen flips it via setHapticsEnabled (persist THROUGH the reducer,
//     never a second store).
//   • SAFE — every native call is guarded and never throws into the render loop.
//     No-ops on web/desktop where the Vibration API is absent (and follows a user
//     gesture where a mobile browser requires one).
//
// Refs: Android haptics design principles (developer.android.com) + mobile-UX
// haptics guidance — "haptics as punctuation, not continuous chatter."
// ─────────────────────────────────────────────────────────────────────────────

import { impact as _impact, notify as _notify, ImpactStyle, NotificationType } from '../platform/haptics.ts';
import { HAPTICS } from '../data/config.js';
import { rarityTier } from '../model/rarities.js';

let _enabled = HAPTICS.enabled;
export const isHapticsEnabled = () => _enabled;
export const setHapticsEnabled = (on) => {
  _enabled = !!on;
};

// Per-source rate gate (view-local timing; not game time). Returns true — and
// stamps — only when `minMs` has elapsed since this key last fired.
const _last = Object.create(null);
const _now = () => (typeof performance !== 'undefined' ? performance.now() : 0);
const gate = (key, minMs) => {
  const t = _now();
  if (_last[key] !== undefined && t - _last[key] < minMs) return false;
  _last[key] = t;
  return true;
};

// Low-level primitives — always guarded, never throw into rendering.
const impact = (style) => {
  if (!_enabled) return;
  try {
    _impact(style);
  } catch {
    /* no haptics engine (web/desktop) — silent */
  }
};
const notify = (type) => {
  if (!_enabled) return;
  try {
    _notify(type);
  } catch {
    /* silent */
  }
};

// Best rarity TIER (0=common … 5=primal) across a set of pulled results.
const bestRarityTier = (results) =>
  (results || []).reduce((m, r) => Math.max(m, rarityTier(r.rarity)), 0);

// Map ONE feedback event → its haptic. Called by FxLayer for every drained fx
// event, and directly by the merge board for its (view-owned) 'merge' event —
// same single owner + vocabulary either way, no parallel channel. Anything not
// listed is intentionally SILENT (basic attacks, enemy attacks, combos, boss
// telegraph/heal/raise) to keep the idle loop from buzzing.
export function hapticForFx(ev) {
  if (!_enabled || !ev) return;
  switch (ev.type) {
    case 'merge': {
      // common (light) → good (medium) → rare big merge (heavy + success chime)
      const tier = ev.tier || 0;
      if (tier >= 6) {
        impact(ImpactStyle.Heavy);
        notify(NotificationType.Success);
      } else if (tier >= 4) {
        impact(ImpactStyle.Medium);
      } else {
        impact(ImpactStyle.Light);
      }
      break;
    }
    case 'generatorDrop':
      // Every successful generator pop, but throttled so rapid tapping reads as a
      // pleasant staccato rather than a continuous buzz.
      if (gate('gen', 90)) impact(ImpactStyle.Light);
      break;
    case 'orderChest': // an order was fulfilled → chest reward
    case 'levelComplete': // a wave/level was won
      notify(NotificationType.Success);
      break;
    case 'lose': // a wave was lost
      notify(NotificationType.Warning);
      break;
    case 'limitBreak': // a hero ultimate — the big player-driven moment
      impact(ImpactStyle.Heavy);
      break;
    case 'bossSpecial': // a boss slam LANDS on the squad
      if (gate('bossSlam', 500)) impact(ImpactStyle.Heavy);
      break;
    case 'heroAttacks': // idle combat is silent EXCEPT when a crit lands
      if (ev.crit && gate('crit', 450)) impact(ImpactStyle.Light);
      break;
    case 'gachaReveal': {
      // Scale to the best rarity pulled: legendary+ = jackpot (heavy + success),
      // rare/epic = success chime, all-common = a medium thunk.
      const tier = bestRarityTier(ev.results);
      if (tier >= 3) {
        impact(ImpactStyle.Heavy);
        notify(NotificationType.Success);
      } else if (tier >= 1) {
        notify(NotificationType.Success);
      } else {
        impact(ImpactStyle.Medium);
      }
      break;
    }
    default:
      break; // silent by design
  }
}
