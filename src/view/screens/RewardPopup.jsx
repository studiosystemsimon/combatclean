// Reward popup — reveals a server-resolved reward (from a minigame or any future source) and grants it
// on claim (CLOSE_REWARD adds it to the wallet). Reads state.rewardPopup.reward; icons + fmtK match the
// currency bar. A modal over the current screen (combat resumes underneath), mirroring the AFK popup.
import { useGame } from '../../controller/GameContext';
import { resolve } from '../assets.js';
import Art from '../Art.jsx';
import { fmtK as fmt } from '../fmt.js';

const ROWS = [
  { key: 'coins', icon: 'ui.coin' },
  { key: 'heroXp', icon: 'ui.heroXp' },
  { key: 'gearXp', icon: 'ui.gearXp' },
];

export default function RewardPopup() {
  const { state, actions } = useGame();
  const rp = state.rewardPopup;
  if (!rp) return null;
  const r = rp.reward || {};
  const rows = ROWS.filter((x) => (r[x.key] || 0) > 0);
  return (
    <div className="reward-pop">
      <div className="reward-dim" onClick={actions.closeReward} />
      <div className="reward-card">
        <div className="reward-title">Rewards</div>
        <div className="reward-rows">
          {rows.map((x) => (
            <div key={x.key} className="reward-row">
              <Art a={resolve(x.icon)} className="reward-ic" />
              <span className="reward-amt">+{fmt(r[x.key])}</span>
            </div>
          ))}
        </div>
        <button type="button" className="reward-claim" onClick={actions.closeReward}>Collect</button>
      </div>
    </div>
  );
}
