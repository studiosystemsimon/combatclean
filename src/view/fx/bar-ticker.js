// ─────────────────────────────────────────────────────────────────────────────
// SHARED BAR TICKER (#7). One requestAnimationFrame drives EVERY combat bar (HP +
// limit): each bar registers a per-frame callback; the single loop calls them all.
// It runs only while there are subscribers and PARKS when the set empties (no idle
// rAF). Replaces ~15 independent per-bar 60fps loops with one loop.
// ─────────────────────────────────────────────────────────────────────────────
const subs = new Set();
let raf = 0;

function tick(now) {
  for (const fn of subs) { try { fn(now); } catch { /* one dead bar must not kill the shared loop */ } }
  raf = subs.size ? requestAnimationFrame(tick) : 0;
}

// Register a per-frame callback; returns an unsubscribe fn. Starts the loop on the first subscriber and
// stops it when the last unsubscribes (no rAF churns while no bars are mounted / out of combat).
export function subscribeBar(fn) {
  subs.add(fn);
  if (!raf) raf = requestAnimationFrame(tick);
  return () => { subs.delete(fn); if (!subs.size && raf) { cancelAnimationFrame(raf); raf = 0; } };
}
