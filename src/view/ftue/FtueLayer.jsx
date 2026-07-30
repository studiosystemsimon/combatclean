// === FtueLayer — the coachmark driver (view overlay) ===
// Reads {state, actions}, records completed beats, drives the sim-pause for `pause` beats, and renders
// the active beat's coachmark. Gated by `flags.ftueActive` — off → nothing. Inline-styled + contained.
//
// COMPLETION IS DECOUPLED FROM SELECTION: a recorder marks ANY unseen beat seen the moment its
// `done(state)` is met — even if that same tick flips its `show()` false (delivering the potion both
// charges the hero and clears the order). That's why the limit break no longer bounces back to potion.
//
// PAUSE: a beat with `pause:true` freezes the sim while it's on screen (via `flags.ftuePaused`, which
// the controller's battle tick honours) — used for the "explain the Alchemist's limit" beat.
import { useEffect } from 'react';
import { useGame } from '../../controller/GameContext';
import { FTUE_BEATS } from './beats.js';

export default function FtueLayer() {
  const { state, actions } = useGame();
  const active = !!(state.flags && state.flags.ftueActive);
  const isSeen = (id) => !!(state.flags && state.flags['ftueSeen_' + id]);
  const beat = active ? FTUE_BEATS.find((b) => !isSeen(b.id) && b.show(state)) : null;
  const complete = !!(beat && beat.done && beat.done(state));
  const shown = beat && !complete ? beat : null; // the beat actually rendered this frame
  const wantPause = !!(shown && shown.pause);
  const paused = !!(state.flags && state.flags.ftuePaused);

  // Recorder: mark seen any unseen ACTION beat whose completion condition is met (decoupled from show).
  useEffect(() => {
    if (!active) return;
    for (const b of FTUE_BEATS) {
      if (b.done && !isSeen(b.id) && b.done(state)) actions.setFlag('ftueSeen_' + b.id, true);
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Pause sync: freeze the sim while a `pause` beat is shown; resume otherwise (also self-heals a stale
  // persisted pause on reload — if no pause beat is active, it clears the flag).
  useEffect(() => {
    if (wantPause !== paused) actions.setFlag('ftuePaused', wantPause);
  }, [wantPause, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shown) return null;
  const info = !shown.done; // info beats have no completion detector → dismissed by GOT IT
  const advance = () => actions.setFlag('ftueSeen_' + shown.id, true);
  const gate = shown.style === 'gate';

  return (
    // Click-through wrapper so the player can forge / merge / deliver / tap beneath; only GOT IT captures input.
    <div style={wrap}>
      <div style={{ ...card, borderColor: gate ? '#b46bff88' : '#ffd45e88' }}>
        <div style={{ ...tagS, color: gate ? '#e2c8ff' : '#ffe39a', borderColor: gate ? '#b46bff55' : '#ffd45e55' }}>
          {info ? 'TUTORIAL' : 'DO THIS'}
        </div>
        <div style={copyS}>{shown.copy}</div>
        {shown.sub && <div style={subS}>{shown.sub}</div>}
        {info && <button style={btn} onClick={advance}>GOT IT</button>}
      </div>
    </div>
  );
}

const wrap = { position: 'absolute', left: 0, right: 0, bottom: 78, display: 'flex', justifyContent: 'center', padding: '0 16px', pointerEvents: 'none', zIndex: 900 };
const card = { pointerEvents: 'auto', maxWidth: 340, width: '100%', background: 'linear-gradient(180deg,#1b2340,#131834)', border: '1px solid', borderRadius: 14, padding: '13px 16px', boxShadow: '0 10px 30px rgba(0,0,0,.45)', textAlign: 'center' };
const tagS = { display: 'inline-block', fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', border: '1px solid', borderRadius: 99, padding: '2px 10px', marginBottom: 7 };
const copyS = { fontSize: 15, fontWeight: 800, color: '#eaf0ff', lineHeight: 1.35 };
const subS = { fontSize: 12, color: '#9fb0d0', marginTop: 4, lineHeight: 1.4 };
const btn = { pointerEvents: 'auto', marginTop: 11, fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#0b1220', background: '#ffd45e', border: 'none', borderRadius: 9, padding: '8px 22px', cursor: 'pointer' };
