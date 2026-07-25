// Root shell: top currency bar, a PERSISTENT combat panel (the autobattler,
// same area on every screen), a swappable CONTEXT panel driven by the navbar,
// the bottom nav, and the VFX overlay.
import { useGame } from '../controller/GameContext';
import Header from './Header.jsx';
import NavBar from './NavBar.jsx';
import FxLayer from './FxLayer.jsx';
import Autobattler from './Autobattler.jsx';
import MergeScreen from './screens/MergeScreen.jsx';
import HeroesScreen from './screens/HeroesScreen.jsx';
import GearScreen from './screens/GearScreen.jsx';
import GachaScreen from './screens/GachaScreen.jsx';
import MapScreen from './screens/MapScreen.jsx';
import HeroMenu from './screens/HeroMenu.jsx';

export default function Game() {
  const { state } = useGame();
  // While the full-screen hero menu is open, combat is NOT rendered underneath and its
  // tick is paused (see GameContext) — the overlay owns the screen so nothing grinds.
  const menuOpen = !!state.menuHeroId;
  return (
    <div className="app">
      <Header />
      {/* The persistent combat panel shows on every screen EXCEPT the map (its own full
          view) and while the hero menu is open. Combat keeps ticking underneath off-map
          (panel just unmounted); the hero menu instead PAUSES the tick + unmounts FxLayer. */}
      {state.screen !== 'map' && !menuOpen && (
        <div className="combat-panel">
          <Autobattler />
        </div>
      )}
      {/* The hero menu takes over the CONTEXT area (below the currency bar, above the nav),
          so the top currency bar + bottom nav stay put; combat panel + FxLayer are suspended. */}
      <div className="context-panel">
        {menuOpen ? <HeroMenu /> : (<>
          {state.screen === 'merge' && <MergeScreen />}
          {state.screen === 'heroes' && <HeroesScreen />}
          {state.screen === 'gear' && <GearScreen />}
          {state.screen === 'gacha' && <GachaScreen />}
          {state.screen === 'map' && <MapScreen />}
        </>)}
      </div>
      <NavBar />
      {!menuOpen && <FxLayer />}
    </div>
  );
}
