// ─────────────────────────────────────────────────────────────────────────────
// COUNTER TWEEN (view layer) — synchronises the header stat display with the
// currency-icon landings so the number COUNTS UP in lockstep with the coins
// hitting the counter (one transaction — never snap to the new total first and
// then play the explosion). Pure view: never mutates game state.
//
// Contract:
//   • A GAIN (state > display) is NOT snapped — the display HOLDS the old value
//     until a currency burst ticks it up icon-by-icon (finishing exactly at the
//     new total). If no burst arrives (a non-burst gain, e.g. a gacha dupe), a
//     fallback snaps after FALLBACK_MS so the counter never stalls.
//   • A SPEND (state < display) snaps down instantly (spends have no explosion).
//   • First sight of a stat initialises the display to state (snap, no anim).
//   • While a burst is active the burst owns the display and converges to target.
// ─────────────────────────────────────────────────────────────────────────────

const listeners = {}; // statKey -> Set of callbacks
const displayValues = {}; // statKey -> current displayed number
const targets = {}; // statKey -> burst target (null/undefined when not mid-burst)
const fallbackTimers = {}; // statKey -> timeout id for a non-burst gain snap

// Longer than the latest currency-burst start (clear-pause + cascade stagger +
// per-item delay), so a real burst always claims the gain before this fires.
const FALLBACK_MS = 1500;

export function subscribe(statKey, callback) {
  if (!listeners[statKey]) listeners[statKey] = new Set();
  listeners[statKey].add(callback);
  return () => listeners[statKey]?.delete(callback);
}

function notify(statKey, newDisplay) {
  displayValues[statKey] = newDisplay;
  listeners[statKey]?.forEach((cb) => cb(newDisplay));
}

function clearFallback(statKey) {
  if (fallbackTimers[statKey]) {
    clearTimeout(fallbackTimers[statKey]);
    fallbackTimers[statKey] = null;
  }
}

// Called by Header whenever the state value changes.
export function syncToState(statKey, stateValue) {
  const disp = displayValues[statKey];

  // First sight — initialise the display (snap, no animation).
  if (disp === undefined) {
    notify(statKey, stateValue);
    return;
  }
  // Mid-burst — the burst owns the display and will converge to its target.
  if (targets[statKey] !== null && targets[statKey] !== undefined) return;

  if (stateValue < disp) {
    // Spend / decrease — snap down instantly (no explosion for spends).
    clearFallback(statKey);
    notify(statKey, stateValue);
    return;
  }
  if (stateValue > disp) {
    // GAIN — do NOT snap up. Hold the old value; a currency burst will tick it
    // up in sync with the icons landing. Arm a fallback in case no burst comes.
    clearFallback(statKey);
    fallbackTimers[statKey] = setTimeout(() => {
      fallbackTimers[statKey] = null;
      if (targets[statKey] === null || targets[statKey] === undefined) notify(statKey, stateValue);
    }, FALLBACK_MS);
  }
  // Equal — nothing to do.
}

// Called by currency-pickup before the first icon spawns: lock the display at
// the (held) current value and set the target it will count up to.
export function startBurst(statKey, fromDisplay, toState) {
  clearFallback(statKey);
  targets[statKey] = toState;
  notify(statKey, fromDisplay); // ensure the header starts from the old value
}

// Called by currency-pickup as each non-final icon lands: tick up by its share.
export function incrementDisplay(statKey, delta) {
  const curr = displayValues[statKey] || 0;
  notify(statKey, Math.round(curr + delta));
}

// Called by currency-pickup when the LAST icon lands: snap to the exact target
// (no rounding drift) and release the burst lock.
export function finishBurst(statKey) {
  const finalVal = targets[statKey];
  targets[statKey] = null;
  if (finalVal !== null && finalVal !== undefined) notify(statKey, finalVal);
}

export function getDisplay(statKey, fallbackState) {
  return displayValues[statKey] !== undefined ? displayValues[statKey] : fallbackState;
}
