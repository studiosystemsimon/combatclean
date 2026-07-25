// ─────────────────────────────────────────────────────────────────────────────
// GENERATOR UNLOCK CINEMATIC (view VFX) — a newly-unlocked merge generator MATERIALIZES at
// screen-centre (burst of light + spinning rays + expanding ring), holds, then ARCS down onto its
// board cell and SLAMS with a shockwave. Plays on the shared full-screen `.reveal-overlay`; the fly
// waits (rAF poll) for the merge board cell to mount after the auto-route to the merge tab.
//
// Decoupled + fire-and-forget: it does NOT touch board state. The generator is committed to the board
// on ACCEPT (CONTINUE); this is the celebratory delivery on top. Timings come from ANIM.areaComplete.
// ─────────────────────────────────────────────────────────────────────────────
import { resolve } from '../assets.js';
import { ANIM } from '../../data/config.js';

const AC = ANIM.areaComplete;
const mk = (cls, css) => { const d = document.createElement('div'); if (cls) d.className = cls; if (css) d.style.cssText = css; return d; };
const anim = (el, frames, opts) => { try { return el.animate(frames, opts); } catch { return null; } };

// The target board cell, retried for ~40 frames while the merge tab mounts (appear+hold covers this).
function findCell(cell, cb) {
  let tries = 0;
  const look = () => {
    const el = document.querySelector(`.context-panel [data-cell="${cell}"]`) || document.querySelector(`[data-cell="${cell}"]`);
    if (el) return cb(el);
    if (tries++ < 40) requestAnimationFrame(look); else cb(null);
  };
  look();
}

export function playGeneratorUnlock(overlay, ev, onDone) {
  const done = () => { onDone && onDone(); };
  if (!overlay || ev.cell == null) { done(); return; }
  const a = resolve(`gen.${ev.genKey}`);

  const root = mk('gu-fx', 'position:absolute;inset:0;pointer-events:none;z-index:6;');
  overlay.appendChild(root);
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight * 0.5;

  const STAGE = 150;
  const stage = mk('gu-stage', `position:absolute;left:${cx}px;top:${cy}px;width:${STAGE}px;height:${STAGE}px;margin:${-STAGE / 2}px 0 0 ${-STAGE / 2}px;`);
  const rays = mk('gu-rays', '');
  const ring = mk('gu-ring', '');
  const art = mk('gu-art', '');
  if (a.img) { const im = document.createElement('img'); im.src = a.img; im.className = 'gu-img'; im.draggable = false; art.appendChild(im); }
  else { art.textContent = a.emoji; art.classList.add('gu-emoji'); }
  stage.append(rays, ring, art);
  root.appendChild(stage);

  // APPEAR — burst from white + overshoot; ring shockwave + rays fade in.
  anim(art, [
    { opacity: 0, transform: 'scale(0.2)', filter: 'brightness(6) saturate(0)' },
    { opacity: 1, transform: 'scale(1.18)', filter: 'brightness(1.7)', offset: 0.6 },
    { opacity: 1, transform: 'scale(1)', filter: 'brightness(1)' },
  ], { duration: AC.appearMs, easing: 'cubic-bezier(.2,1,.36,1)', fill: 'both' });
  anim(ring, [{ opacity: 0.85, transform: 'scale(0.25)' }, { opacity: 0, transform: 'scale(2.4)' }], { duration: AC.appearMs + 220, easing: 'ease-out', fill: 'both' });
  anim(rays, [{ opacity: 0 }, { opacity: 0.9, offset: 0.5 }, { opacity: 0.55 }], { duration: AC.appearMs + AC.holdMs, easing: 'ease-out', fill: 'both' });

  // FLY (after appear + hold) — arc to the board cell, scaling down to cell size, then SLAM.
  setTimeout(() => {
    findCell(ev.cell, (cellEl) => {
      if (!cellEl) { root.remove(); done(); return; }
      const r = cellEl.getBoundingClientRect();
      const tx = r.left + r.width / 2 - cx;
      const ty = r.top + r.height / 2 - cy;
      const s = Math.max(0.2, Math.min(r.width, r.height) / STAGE);
      const fly = anim(stage, [
        { transform: 'translate(0,0) scale(1)' },
        { transform: `translate(${tx * 0.5}px, ${ty * 0.5 - 46}px) scale(${(1 + s) / 2})`, offset: 0.55 },
        { transform: `translate(${tx}px, ${ty}px) scale(${s})` },
      ], { duration: AC.flyMs, easing: 'cubic-bezier(.5,0,.55,1)', fill: 'both' });
      anim(rays, [{ opacity: 0.55 }, { opacity: 0 }], { duration: AC.flyMs * 0.6, easing: 'ease-out', fill: 'both' });

      const land = () => {
        // SLAM — shockwave ring at the cell + a board shake; the generator rests, then fades out.
        const shock = mk('gu-shock', `position:absolute;left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;width:${r.width}px;height:${r.height}px;margin:${-r.height / 2}px 0 0 ${-r.width / 2}px;`);
        root.appendChild(shock);
        anim(shock, [{ opacity: 0.9, transform: 'scale(0.4)' }, { opacity: 0, transform: 'scale(2.8)' }], { duration: AC.landMs + 160, easing: 'ease-out', fill: 'both' });
        anim(art, [{ transform: 'scale(1)' }, { transform: 'scale(1.22)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: AC.landMs, easing: 'cubic-bezier(.34,1.56,.64,1)' });
        const board = document.querySelector('.mb-shaker') || document.querySelector('.context-panel');
        if (board) anim(board, [{ transform: 'translateY(0)' }, { transform: 'translateY(4px)', offset: 0.4 }, { transform: 'translateY(0)' }], { duration: AC.landMs, easing: 'ease-out' });
        // rest at the cell, then fade — ACCEPT commits the real generator underneath in the meantime.
        setTimeout(() => {
          const out = anim(stage, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-in', fill: 'both' });
          const fin = () => { root.remove(); done(); };
          if (out && out.finished) out.finished.catch(() => {}).then(fin); else setTimeout(fin, 260);
        }, AC.landMs + 400);
      };
      if (fly && fly.finished) fly.finished.catch(() => {}).then(land); else setTimeout(land, AC.flyMs);
    });
  }, AC.appearMs + AC.holdMs);
}
