// Top currency bar: energy (+countdown), coins, hero XP, gear XP.
// `data-stat` marks the landing target for the currency-explosion VFX.
import { useState, useEffect } from 'react';
import { useGame } from '../controller/GameContext';
import { resolve } from './assets.js';
import Art from './Art.jsx';
import { msToNext } from '../model/energy.js';
import { subscribe, syncToState, getDisplay } from './fx/counter-tween.js';
import { fmtK } from './fmt.js';

function Stat({ statKey, iconKey, val, sub }) {
  return (
    <div className="stat" data-stat={statKey}>
      <div className="stat-row">
        <Art a={resolve(iconKey)} className="stat-icon" />
        <span className="stat-val">{val}</span>
      </div>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

function TweenableStat({ statKey, iconKey, stateValue, sub }) {
  const [displayVal, setDisplayVal] = useState(stateValue);

  useEffect(() => {
    const unsub = subscribe(statKey, setDisplayVal);
    return unsub;
  }, [statKey]);

  useEffect(() => {
    syncToState(statKey, stateValue);
  }, [statKey, stateValue]);

  return <Stat statKey={statKey} iconKey={iconKey} val={fmtK(displayVal)} sub={sub} />;
}

export default function Header() {
  const { state, actions } = useGame();
  const { energy, coins, heroXp, gearXp, now } = state;
  const full = energy.current >= energy.max;
  const secs = full ? null : Math.ceil(msToNext(energy, now) / 1000);
  const onReset = () => { if (window.confirm('Reset ALL progress? This cannot be undone.')) actions.resetGame(); };
  return (
    <header className="header">
      <Stat statKey="energy" iconKey="ui.energy" val={`${energy.current}/${energy.max}`} sub={full ? 'full' : `+1 ${secs}s`} />
      <TweenableStat statKey="coins" iconKey="ui.coin" stateValue={coins} />
      <TweenableStat statKey="heroXp" iconKey="ui.heroXp" stateValue={heroXp} />
      <TweenableStat statKey="gearXp" iconKey="ui.gearXp" stateValue={gearXp} />
      <button type="button" className="bg-btn" title="Test minigame (harness)" onClick={() => actions.startMinigame('test-button', {})}>🎮</button>
      <button type="button" className="bg-btn" title="Background mode — hide visuals, keep the engine running" onClick={() => actions.setHeadless(true)}>☾</button>
      <button type="button" className="reset-btn" title="Reset progress" onClick={onReset}>⟲</button>
    </header>
  );
}
