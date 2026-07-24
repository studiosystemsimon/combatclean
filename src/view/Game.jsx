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

export default function Game() {
  const { state } = useGame();
  return (
    <div className="app">
      <Header />
      {/* The persistent combat panel shows on every screen EXCEPT the map, which is a
          full-screen view of its own. Combat keeps ticking underneath (the panel is
          just unmounted); the intro director + FxLayer both no-op on missing DOM. */}
      {state.screen !== 'map' && (
        <div className="combat-panel">
          <Autobattler />
        </div>
      )}
      <div className="context-panel">
        {state.screen === 'merge' && <MergeScreen />}
        {state.screen === 'heroes' && <HeroesScreen />}
        {state.screen === 'gear' && <GearScreen />}
        {state.screen === 'gacha' && <GachaScreen />}
        {state.screen === 'map' && <MapScreen />}
      </div>
      <NavBar />
      <FxLayer />
    </div>
  );
}
