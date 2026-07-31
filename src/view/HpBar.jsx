// ─────────────────────────────────────────────────────────────────────────────
// HP BAR — reusable health bar with FrogGame's damage-feedback VFX, ported to
// DOM. Four simultaneous layers driven by ONE hit timestamp (data-driven: a frac
// DECREASE stamps hitT; a fresh hit re-stamps so the flash re-peaks). Used by
// both hero and enemy bars. See docs (FrogGame src/view/combat/hp-bars.js):
//   1. GHOST/CHIP trailing layer — lost-HP segment eases from its start to the
//      new frac over 0.5s with CUBIC EASE-IN (t³): holds at the old width, then
//      snaps down. Heal snaps instantly; ghost is always >= current.
//   2. WHOLE-BAR flash — 240ms, env=(1-t)³ : brightness 1→3.2, saturate 1→2.5,
//      white drop-shadow 0→7px.
//   3. PINK-TRAILING flash (ghost layer only) — 600ms, env=(1-t)² : brightness
//      1→2.2, saturate 1→2.5 (keeps the eye on the lost HP after the main flash).
//   4. PURE-WHITE overlay blip — 60ms, linear env=(1-t), opacity 1→0.
// ─────────────────────────────────────────────────────────────────────────────

import { useRef, useEffect } from 'react';
import { VFX_CONFIG } from '../data/config.js';
import { subscribeBar } from './fx/bar-ticker.js';

const HP = VFX_CONFIG.hpbar;
const TAIL_LERP_DURATION = HP.ghostLerpSec; // ghost catch-up (cubic ease-in), seconds
const WHOLE_FLASH_DUR = HP.wholeFlashSec; // whole-bar brightness/saturate/drop-shadow
const PINK_FLASH_DUR = HP.pinkFlashSec; // pink trailing layer (ghost only)
const WHITE_BLIP_DUR = HP.whiteBlipSec; // pure-white overlay blip

export default function HpBar({ frac, kind }) {
  const barRef = useRef(null);
  const fracRef = useRef(frac);
  const st = useRef({ prevFrac: frac, ghostFrac: frac, ghostStart: frac, hitT: -1 });

  // Keep the latest frac readable inside the single persistent rAF loop.
  fracRef.current = frac;

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return undefined;
    const ghostSpan = bar.querySelector('.hp-ghost');
    const fillSpan = bar.querySelector('.hp-fill');
    const whiteSpan = bar.querySelector('.hp-white');

    const step = () => {
      const now = performance.now() / 1000;
      const s = st.current;
      const cur = fracRef.current;

      // DAMAGE detect → restart the ghost ease FROM its current visible position.
      if (cur < s.prevFrac) {
        s.hitT = now;
        s.ghostStart = s.ghostFrac;
      } else if (cur > s.prevFrac) {
        // HEAL → snap the ghost to current (no upward ghost).
        s.ghostFrac = cur;
        s.ghostStart = cur;
        s.hitT = -1;
      }
      s.prevFrac = cur;

      // GHOST catch-up: ghost = ghostStart + (cur - ghostStart) * t³, over 0.5s.
      const age = s.hitT < 0 ? Infinity : now - s.hitT;
      if (age >= TAIL_LERP_DURATION || s.ghostStart <= cur) {
        s.ghostFrac = cur;
      } else {
        const t = Math.min(1, Math.max(0, age / TAIL_LERP_DURATION));
        s.ghostFrac = s.ghostStart + (cur - s.ghostStart) * (t * t * t);
      }
      s.ghostFrac = Math.max(cur, s.ghostFrac); // invariant: ghost >= current

      if (ghostSpan) ghostSpan.style.width = `${s.ghostFrac * 100}%`;
      if (fillSpan) fillSpan.style.width = `${cur * 100}%`;

      // (2) WHOLE-BAR flash — 240ms, env=(1-t)³.
      if (age < WHOLE_FLASH_DUR) {
        const env = (1 - age / WHOLE_FLASH_DUR) ** 3;
        bar.style.filter =
          `brightness(${(1 + HP.wholeFlash.brightness * env).toFixed(3)}) saturate(${(1 + HP.wholeFlash.saturate * env).toFixed(3)}) ` +
          `drop-shadow(0 0 ${(HP.wholeFlash.dropShadowPx * env).toFixed(2)}px ${HP.wholeFlash.shadowColor})`;
      } else if (bar.style.filter) {
        bar.style.filter = '';
      }

      // (3) PINK-TRAILING flash on the ghost layer — 600ms, env=(1-t)².
      if (ghostSpan) {
        if (age < PINK_FLASH_DUR) {
          const env = (1 - age / PINK_FLASH_DUR) ** 2;
          ghostSpan.style.filter = `brightness(${(1 + HP.pinkFlash.brightness * env).toFixed(3)}) saturate(${(1 + HP.pinkFlash.saturate * env).toFixed(3)})`;
        } else if (ghostSpan.style.filter) {
          ghostSpan.style.filter = '';
        }
      }

      // (4) PURE-WHITE blip — 60ms, linear.
      if (whiteSpan) {
        if (age < WHITE_BLIP_DUR) whiteSpan.style.opacity = `${1 - age / WHITE_BLIP_DUR}`;
        else if (whiteSpan.style.opacity !== '0') whiteSpan.style.opacity = '0';
      }
    };

    return subscribeBar(step); // one shared rAF drives all bars; parks when none are mounted (#7)
  }, []);

  const ghostColor = kind === 'enemy' ? HP.ghostColor.enemy : HP.ghostColor.hero;

  return (
    <div ref={barRef} className={`bar hp ${kind === 'enemy' ? 'enemy' : ''} ${frac < HP.lowFrac ? 'low' : ''}`}>
      <span className="hp-ghost" style={{ background: ghostColor }} />
      <span className="hp-fill" />
      <span className="hp-white" />
    </div>
  );
}
