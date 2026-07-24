// Entry point — mounts the React game (GameProvider = reducer + timers + persistence; Game = the view)
// into #ui-root. Content C self-inits at import (src/game/content.ts pulls virtual:game-config), so the
// tree renders against the baked registries. Keeps the verification markers (data-source log) + the
// dev-only device preview + Marksman overlay from the scaffold.
import './game/boot-content.ts'; // MUST be first — inits content C before the view's data barrels eval.
import { createRoot } from 'react-dom/client';
import { GameProvider } from './controller/GameContext.tsx';
import Game from './view/Game.jsx';
import './index.css';
import { summary } from './data/config/repository';
import { registry as assetRegistry } from 'virtual:asset-registry';

// Verification marker — proves the running build + that content came from the baked registries.
const cfg = summary();
const DATA_SOURCE = `cfg#${cfg.schemaVersion} · ${cfg.categories.length} categories · ${cfg.entries} entries · ${assetRegistry.size} assets`;
console.log(`[boot] Combat Clean — ${DATA_SOURCE} — categories: ${cfg.categories.join(', ')}`);

// Dev-only device-frame preview (src/preview) — iframes a fresh load in a phone bezel. Never ships.
if (import.meta.env.DEV && window.self === window.top) {
  import('./preview').then(({ mountDevicePreview }) => mountDevicePreview());
}
// Dev-only Marksman overlay (src/marksman) — mounts inside the preview iframe (self !== top). Never ships.
if (import.meta.env.DEV && window.self !== window.top) {
  import('./marksman').then(({ mountMarksmanOverlay }) => mountMarksmanOverlay());
}

const root = document.getElementById('ui-root');
if (!root) throw new Error('[boot] #ui-root not found');
createRoot(root).render(
  <GameProvider>
    <Game />
  </GameProvider>,
);
