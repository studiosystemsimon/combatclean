// TEMPLATE MINIGAME — copy this file to author a new minigame, then:
//   1. register it in src/view/minigame/registry.js   (id → component)
//   2. add its id to the launch pool — src/data/config/game/_minigame.json → "pool" (a special-orb
//      merge picks a random pooled minigame) — or launch directly via actions.startMinigame('my-game', input).
//
// THE CONTRACT (the entire harness surface — see src/game/minigame/README.md):
//   • You receive `input` — arbitrary launch data (the chaos-orb special merge passes { source: 'special-merge' }).
//   • Call `onComplete({ score })` EXACTLY ONCE when the player finishes. `score` (a number) drives the
//     reward: reward = _minigame.json.reward + perScore × score (resolved server-side, granted on claim).
//   • Touch nothing else — no combat / account / reward access. The harness owns everything before
//     `input` and after `onComplete`. A minigame is a full screen; the engine runs headless underneath.
import { useState } from 'react';

export default function TemplateGame({ input, onComplete }) {
  // Demo "play": each tap raises the score, proving score comes from play (not a constant). Replace
  // this body with your real minigame — just keep the { input, onComplete({ score }) } contract.
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  // Latch: the contract is onComplete EXACTLY ONCE — guard against a double tap / re-entry.
  const complete = () => { if (done) return; setDone(true); onComplete({ score }); };
  return (
    <div className="mg-template">
      <div className="minigame-title">Template Minigame</div>
      <div className="mg-hint">Copy this component to build a real minigame. Tap to raise the score, then finish.</div>
      <button type="button" className="mg-complete" disabled={done} onClick={() => setScore((n) => n + 1)}>Score: {score}</button>
      <button type="button" className="mg-complete" disabled={done} onClick={complete}>Complete</button>
      {input ? <div className="mg-input">input: {JSON.stringify(input)}</div> : null}
    </div>
  );
}
