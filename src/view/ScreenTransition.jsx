// Screen-crumble transition overlay. ALWAYS mounted (sibling of FtueLayer), self-gates on
// state.transition — renders nothing when idle. When a special-orb merge arms state.transition,
// it mounts a top-z canvas and plays the chaos-orb cinematic (src/view/fx/chaos-orb-transition.js),
// which OUTLIVES the minigame mount (FxLayer/.reveal-overlay unmount at that instant). At the POP
// apex it launches the minigame (onApex → startMinigame); when the crumble finishes it clears the
// flag (onDone → clearTransition). Pure reader: reads state, dispatches via the controller actions.
//
// FAILSAFE: the host is pointer-events:auto (locks input during the cinematic), so it MUST always
// clear. Three guards: (1) the module wraps its frame loop in try/catch → onDone on any error;
// (2) a duration watchdog force-clears if onDone never arrives; (3) unmount-mid-run clears the flag
// so a remount can't replay the cinematic over an already-open minigame.
import { useEffect, useRef } from 'react';
import { useMetaGame } from '../controller/GameContext';
import { playChaosOrbTransition } from './fx/chaos-orb-transition.js';
import { VFX_CONFIG } from '../data/config.js';

export default function ScreenTransition() {
  // Meta view: `transition` is a non-battle/fx field, so metaState tracks it — and this overlay
  // won't re-render on the 5 Hz combat tick. It reads only state.transition (no battle/fx).
  const { state, actions } = useMetaGame();
  const active = !!state.transition;
  const canvasRef = useRef(null);
  const runRef = useRef(null);

  useEffect(() => {
    if (!active || runRef.current) return;                 // start once per armed transition
    const canvas = canvasRef.current;
    const t = state.transition;
    if (!canvas || !t) return;
    let done = false;
    const finishOnce = () => { if (done) return; done = true; runRef.current = null; actions.clearTransition(); };
    runRef.current = playChaosOrbTransition(canvas, {
      onApex: () => { if (t.minigame) actions.startMinigame(t.minigame.id, t.minigame.input); },
      onDone: finishOnce,
    });
    // Watchdog: hard cap = full timeline + buffer; force-clears if the run ever fails to report done
    // (the overlay is input-blocking, so it must never strand).
    const c = VFX_CONFIG.transition;
    const maxMs = (c.rushT + c.growT) * 1000 + c.igniteMs + c.crumbleMs * (1 + c.crumbleTail) + 2000;
    const watchdog = setTimeout(() => { if (runRef.current) runRef.current.cancel(); finishOnce(); }, maxMs);
    return () => {
      clearTimeout(watchdog);
      if (runRef.current) { runRef.current.cancel(); runRef.current = null; if (!done) actions.clearTransition(); }
    };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) return null;
  return <div className="screen-transition"><canvas ref={canvasRef} /></div>;
}
