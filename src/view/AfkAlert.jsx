// AFK! alert tile — shows in the combat zone (upper-centre) when idle rewards have reached
// C.AFK.alertMs and the popup is closed. Tap → open the AFK collection popup. It disappears
// once claimed (COLLECT_AFK clears pendingAfk → Game.jsx stops rendering it).
import { useGame } from '../controller/GameContext';

export default function AfkAlert() {
  const { actions } = useGame();
  return (
    <button type="button" className="afk-alert" onClick={() => actions.setAfkOpen(true)} aria-label="Collect AFK rewards">
      <span className="afk-alert-z">💤</span>
      <span className="afk-alert-t ol">AFK!</span>
      <span className="afk-alert-sub">tap to collect</span>
    </button>
  );
}
