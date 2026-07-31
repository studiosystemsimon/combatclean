// Root shell: top currency bar, a PERSISTENT combat panel (the autobattler,
// same area on every screen), a swappable CONTEXT panel driven by the navbar,
// the bottom nav, and the VFX overlay.
import { useMetaGame, isFullScreen, fxVisible } from '../controller/GameContext';
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
import HeadlessScreen from './screens/HeadlessScreen.jsx';
import MinigameScreen from './screens/MinigameScreen.jsx';
import AfkPopup from './screens/AfkPopup.jsx';
import RewardPopup from './screens/RewardPopup.jsx';
import AfkAlert from './AfkAlert.jsx';
import FtueLayer from './ftue/FtueLayer.jsx';
import ScreenTransition from './ScreenTransition.jsx';
import { AFK } from '../data/config.js';

export default function Game() {
  // Meta view — Game reads only screen/headless/menu/afk/minigame (never battle/fx), so it must NOT
  // re-render on the 5 Hz combat tick (that would re-create the whole screen subtree every 200ms).
  const { state } = useMetaGame();
  // Background mode: unmount the ENTIRE view (combat panel, board, FxLayer, canvas). The controller's
  // timers keep ticking underneath, so the engine runs with zero rendering.
  if (state.headless) return <HeadlessScreen />;
  // While the full-screen hero menu is open, combat is NOT rendered underneath and its
  // tick is paused (see GameContext) — the overlay owns the screen so nothing grinds.
  const menuOpen = !!state.menuHeroId;
  // The AFK collection popup is the same kind of full-screen overlay (combat paused underneath).
  const afkOpen = !!state.afkOpen;
  // The AFK! tile shows in the combat zone once idle rewards reach alertMs and the popup is closed.
  const afkAlert = !!state.pendingAfk && state.pendingAfk.ms >= AFK.alertMs && !afkOpen;
  // A FULL SCREEN (hero menu / minigame / map / gacha) hides the combat panel + FxLayer and runs the
  // engine headless underneath — returning re-attaches to the same, still-advancing sim (seamless).
  const full = isFullScreen(state);
  return (
    <div className="app">
      <Header />
      {/* Persistent combat panel — shown only on combat screens (merge/heroes/gear). Any full screen
          hides it while the sim keeps ticking; the AFK popup freezes it underneath its overlay. */}
      {!full && !afkOpen && (
        <div className="combat-panel">
          <Autobattler />
          {afkAlert && <AfkAlert />}
        </div>
      )}
      {/* The full screen takes over the CONTEXT area (below the currency bar, above the nav), so the
          top currency bar + bottom nav stay put. minigame ▸ hero menu ▸ the nav-selected screen. */}
      <div className="context-panel">
        {state.minigame ? <MinigameScreen /> : menuOpen ? <HeroMenu /> : (<>
          {state.screen === 'merge' && <MergeScreen />}
          {state.screen === 'heroes' && <HeroesScreen />}
          {state.screen === 'gear' && <GearScreen />}
          {state.screen === 'gacha' && <GachaScreen />}
          {state.screen === 'map' && <MapScreen />}
        </>)}
      </div>
      <NavBar />
      {fxVisible(state) && <FxLayer />}
      {afkOpen && <AfkPopup />}
      {state.rewardPopup && <RewardPopup />}
      {/* FTUE coachmark layer — self-gates on flags.ftueActive; renders nothing when the FTUE is off. */}
      <FtueLayer />
      {/* Screen-crumble transition — self-gates on state.transition; outlives the minigame mount. */}
      <ScreenTransition />
    </div>
  );
}
