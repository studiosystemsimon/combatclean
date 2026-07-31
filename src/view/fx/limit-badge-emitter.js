// ─────────────────────────────────────────────────────────────────────────────
// CHARGED LIMIT-BADGE BLOB EMITTER (#4). ONE shared timer (refcounted by the charged
// bars) emits POOLED DOM blobs for ALL charged bars each tick — instead of a separate
// setInterval + freshly-created/GC'd nodes per charged bar. Transform-only transitions.
// Params are data (VFX_CONFIG.combat.limitCharge.badge).
// ─────────────────────────────────────────────────────────────────────────────
import { VFX_CONFIG } from '../../data/config.js';

const B = VFX_CONFIG.combat.limitCharge.badge;
const pool = [];          // reusable detached <i> nodes (no per-blob create/GC churn)
let timer = 0;
let refs = 0;

// Fling one black blob from `emitter` in direction `dir` (-1 left / +1 right): a random angle in a
// ±arcDeg/2 cone centred on horizontal (even up/down), dragging to a stop + scaling to 0 (no fade).
function fling(emitter, dir) {
  const el = pool.pop() || Object.assign(document.createElement('i'), { className: 'lb-blob' });
  el.style.cssText = `width:${B.blobPx}px;height:${B.blobPx}px;margin:${-B.blobPx / 2}px 0 0 ${-B.blobPx / 2}px;transform:translate(0,0) scale(1);transition:none`;
  emitter.appendChild(el);
  const ang = (Math.random() - 0.5) * (B.arcDeg * Math.PI / 180);
  const dist = B.distMin + Math.random() * (B.distMax - B.distMin);
  const dx = dir * Math.cos(ang) * dist, dy = Math.sin(ang) * dist;
  void el.offsetWidth; // commit the initial frame before transitioning
  el.style.transition = `transform ${B.flyMs}ms ease-out`;
  el.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(0)`;
  setTimeout(() => { el.remove(); el.style.cssText = ''; if (pool.length < 40) pool.push(el); }, B.flyMs + 50);
}

function pulse() {
  const emits = document.querySelectorAll('.lb-btn.charged .lb-emit-l, .lb-btn.charged .lb-emit-r');
  emits.forEach((e) => fling(e, e.classList.contains('lb-emit-l') ? -1 : 1));
}

// A charged bar acquires the emitter (refcount++); the returned fn releases it. The single timer runs
// while ≥1 charged bar holds a ref and stops when the last releases. Caller gates on reduced-motion.
export function acquireLimitEmitter() {
  refs++;
  if (!timer) timer = setInterval(pulse, B.emitMs);
  return () => { if (--refs <= 0) { clearInterval(timer); timer = 0; refs = 0; } };
}
