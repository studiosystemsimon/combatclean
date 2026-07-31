// Minigame HARNESS host. A minigame is a FULL SCREEN (engine runs headless underneath). This looks the
// active minigame up in the registry, renders it with its `input`, and on completion routes the result
// to the server (controller.submitMinigame → meta endpoint) which resolves the reward + opens the reward
// popup. A corner ✕ leaves without completing. Modular: minigames only implement { input, onComplete }.
import { useMetaGame } from '../../controller/GameContext';
import { MINIGAMES } from '../minigame/registry.js';

export default function MinigameScreen() {
  // Meta view: reads only state.minigame (+ actions) — no battle/fx, so it doesn't re-render on the 5 Hz tick.
  const { state, actions } = useMetaGame();
  const mg = state.minigame || {};
  const Game = MINIGAMES[mg.id];
  return (
    <div className="minigame">
      {Game ? (
        <Game input={mg.input} onComplete={(result) => actions.submitMinigame(mg.id, result)} />
      ) : (
        <div className="minigame-body">
          <div className="minigame-title">Unknown minigame: {mg.id}</div>
        </div>
      )}
      <button type="button" className="minigame-exit" title="Leave" onClick={actions.exitMinigame}>✕</button>
    </div>
  );
}
