// === FtueLayer — the coachmark driver + guided-tutorial overlay (view) ===
// Reads {state, actions}, records completed beats, and drives the three guided-tutorial affordances a
// beat can declare — all optional, all inline-styled, all detach cleanly with the layer:
//   • pause   — freezes the sim while the beat is on screen (via flags.ftuePaused; honoured by the
//               controller battle tick). Equipment / first-loss / explain beats use it.
//   • screen  — navigates to a set screen when the beat activates (once; won't fight the user after).
//   • target  — spotlights a DOM element (a CSS selector, or a fn(state)→selector for step-dependent
//               targets). `mask:true` GREYS OUT everything but the target AND blocks input outside it;
//               otherwise it's a non-blocking glow RING. The hole tracks the element's live rect, so it
//               fits a button of any shape or size. Combat heroes live on the canvas (not the DOM) so
//               those beats stay card-only.
//
// COMPLETION IS DECOUPLED FROM SELECTION: a recorder marks ANY unseen beat seen the moment its
// `done(state)` is met — even if that same tick flips its `show()` false.
import { useEffect, useState, useRef } from 'react';
import { useGame } from '../../controller/GameContext';
import { FTUE_BEATS } from './beats.js';

// A beat's target may be a selector string or a fn(state)→selector (for step-dependent targets).
const resolveTarget = (beat, state) => {
  const t = beat && beat.target;
  return (typeof t === 'function' ? t(state) : t) || null;
};

export default function FtueLayer() {
  const { state, actions } = useGame();
  const active = !!(state.flags && state.flags.ftueActive);
  const isSeen = (id) => !!(state.flags && state.flags['ftueSeen_' + id]);
  const beat = active ? FTUE_BEATS.find((b) => !isSeen(b.id) && b.show(state)) : null;
  const complete = !!(beat && beat.done && beat.done(state));
  const shown = beat && !complete ? beat : null; // the beat actually rendered this frame
  const wantPause = !!(shown && shown.pause);
  const paused = !!(state.flags && state.flags.ftuePaused);
  const targetSel = shown ? resolveTarget(shown, state) : null;

  // Recorder: mark seen any unseen ACTION beat whose completion condition is met (decoupled from show).
  useEffect(() => {
    if (!active) return;
    for (const b of FTUE_BEATS) if (b.done && !isSeen(b.id) && b.done(state)) actions.setFlag('ftueSeen_' + b.id, true);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Pause sync: freeze the sim while a `pause` beat is shown; resume otherwise (self-heals a stale pause).
  useEffect(() => {
    if (wantPause !== paused) actions.setFlag('ftuePaused', wantPause);
  }, [wantPause, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate: when the shown beat names a screen, drive there ONCE per activation (so it won't fight the
  // user if they navigate away afterwards; a fresh beat re-arms it).
  const navedRef = useRef(null);
  useEffect(() => {
    if (!shown) { navedRef.current = null; return; }
    if (shown.screen && navedRef.current !== shown.id && state.screen !== shown.screen) {
      navedRef.current = shown.id;
      actions.setScreen(shown.screen);
    }
  }, [shown, state.screen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Spotlight: track the target element's rect (relative to this overlay's box) while the beat is shown.
  // Polls on a light interval so a moving / late-mounting target (screen just switched) is picked up.
  const boxRef = useRef(null);
  const [rect, setRect] = useState(null);
  useEffect(() => {
    if (!targetSel) { setRect(null); return undefined; }
    const measure = () => {
      const el = document.querySelector(targetSel);
      const origin = boxRef.current && boxRef.current.getBoundingClientRect();
      if (el && origin) {
        const r = el.getBoundingClientRect();
        const next = { top: r.top - origin.top, left: r.left - origin.left, width: r.width, height: r.height, oh: origin.height };
        setRect((p) => (p && p.top === next.top && p.left === next.left && p.width === next.width && p.height === next.height ? p : next));
      } else setRect(null);
    };
    measure();
    const id = setInterval(measure, 120);
    return () => clearInterval(id);
  }, [targetSel]);

  if (!shown) return null;
  const info = !shown.done; // info beats have no completion detector → dismissed by GOT IT
  const advance = () => actions.setFlag('ftueSeen_' + shown.id, true);
  const gate = shown.style === 'gate';
  const accent = gate ? '#b46bff' : '#ffd45e';
  const masking = !!(shown.mask && rect); // grey-out-but-target only once the target is actually found
  // Hole = the target rect, padded a little so the highlight frames the element.
  const PAD = 8;
  const hx = rect ? rect.left - PAD : 0, hy = rect ? rect.top - PAD : 0;
  const hw = rect ? rect.width + PAD * 2 : 0, hh = rect ? rect.height + PAD * 2 : 0;
  // Keep the card off the target: if the target sits in the lower half, float the card at the top.
  const cardTop = !!(rect && rect.top + rect.height / 2 > rect.oh * 0.5);

  return (
    // Click-through container (fills the .app box); children opt back into pointer events as needed.
    <div ref={boxRef} style={overlay}>
      {/* MASK: four dim blockers around the hole — grey out everything but the target AND capture input
          so only the target is tappable. Rendered only when a target is found, so we never trap input. */}
      {masking && (<>
        <div style={{ ...dim, left: 0, right: 0, top: 0, height: Math.max(0, hy) }} />
        <div style={{ ...dim, left: 0, right: 0, top: hy + hh, bottom: 0 }} />
        <div style={{ ...dim, left: 0, top: hy, width: Math.max(0, hx), height: hh }} />
        <div style={{ ...dim, left: hx + hw, right: 0, top: hy, height: hh }} />
      </>)}
      {/* RING: glow frame around the target (highlight). pointer-events off so taps reach the element. */}
      {rect && (
        <div style={{ position: 'absolute', left: hx, top: hy, width: hw, height: hh, borderRadius: 12, border: `2px solid ${accent}`, boxShadow: `0 0 0 2px ${accent}55, 0 0 16px ${accent}aa`, pointerEvents: 'none' }} />
      )}
      {/* CARD: the coachmark copy. Only GOT IT (info beats) captures input. */}
      <div style={{ ...cardWrap, ...(cardTop ? { top: 20 } : { bottom: 78 }) }}>
        <div style={{ ...card, borderColor: accent + '88' }}>
          <div style={{ ...tagS, color: gate ? '#e2c8ff' : '#ffe39a', borderColor: accent + '55' }}>
            {info ? 'TUTORIAL' : 'DO THIS'}
          </div>
          <div style={copyS}>{shown.copy}</div>
          {shown.sub && <div style={subS}>{shown.sub}</div>}
          {info && <button style={btn} onClick={advance}>GOT IT</button>}
        </div>
      </div>
    </div>
  );
}

const overlay = { position: 'absolute', inset: 0, zIndex: 900, pointerEvents: 'none' };
const dim = { position: 'absolute', background: 'rgba(6,9,20,.72)', pointerEvents: 'auto' };
const cardWrap = { position: 'absolute', left: 0, right: 0, display: 'flex', justifyContent: 'center', padding: '0 16px', pointerEvents: 'none' };
const card = { pointerEvents: 'auto', maxWidth: 340, width: '100%', background: 'linear-gradient(180deg,#1b2340,#131834)', border: '1px solid', borderRadius: 14, padding: '13px 16px', boxShadow: '0 10px 30px rgba(0,0,0,.45)', textAlign: 'center' };
const tagS = { display: 'inline-block', fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', border: '1px solid', borderRadius: 99, padding: '2px 10px', marginBottom: 7 };
const copyS = { fontSize: 15, fontWeight: 800, color: '#eaf0ff', lineHeight: 1.35 };
const subS = { fontSize: 12, color: '#9fb0d0', marginTop: 4, lineHeight: 1.4 };
const btn = { pointerEvents: 'auto', marginTop: 11, fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#0b1220', background: '#ffd45e', border: 'none', borderRadius: 9, padding: '8px 22px', cursor: 'pointer' };
