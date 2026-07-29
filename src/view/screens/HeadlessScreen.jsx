// Background (headless) mode surface. The controller keeps ticking; the rest of the view is unmounted.
// Consumes ONLY the stable actions (never re-renders on ticks) so this screen itself is inert too.
import { memo } from 'react';
import { useActions } from '../../controller/GameContext';

function HeadlessScreen() {
  const actions = useActions();
  return (
    <div className="app headless">
      <img className="headless-icon" src="/app-icon.png" alt="" />
      <div className="headless-title">Running in background</div>
      <button type="button" className="headless-resume" onClick={() => actions.setHeadless(false)}>Resume</button>
    </div>
  );
}
export default memo(HeadlessScreen);
