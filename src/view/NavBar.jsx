// Bottom navigation: Heroes · Gear · Merge · Gacha · Map.
import { useGame } from '../controller/GameContext';
import { resolve } from './assets.js';
import Art from './Art.jsx';
import { STRINGS } from '../data/strings.js';

// icon = asset-registry key (resolved via <Art>); label copy stays as-is.
const TABS = [
  { key: 'heroes', label: 'Heroes', icon: 'ui.nav.heroes' },
  { key: 'gear', label: 'Gear', icon: 'ui.nav.gear' },
  { key: 'merge', label: 'Merge', icon: 'ui.nav.merge' },
  { key: 'gacha', label: 'Gacha', icon: 'ui.nav.gacha' },
  { key: 'map', label: STRINGS.screens.map, icon: 'ui.nav.map' },
];

export default function NavBar() {
  const { state, actions } = useGame();
  return (
    <nav className="navbar">
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          data-nav={t.key}
          className={`nav-btn ${state.screen === t.key ? 'active' : ''}`}
          onClick={() => actions.setScreen(t.key)}
        >
          <Art a={resolve(t.icon)} className="nav-icon" />
          <span className="nav-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
