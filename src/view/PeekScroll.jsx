// ─────────────────────────────────────────────────────────────────────────────
// PEEK SCROLL (view layer — reusable component)
// Wraps scrollable children in a hidden-scrollbar container with edge-fade gradients
// that appear when there is more content above/below. The universal UI pattern for
// scroll regions: no visible vertical scrollbar, peek affordance via shadow gradients.
// ─────────────────────────────────────────────────────────────────────────────

import { useScrollShadows } from './hooks/useScrollShadows.js';

export default function PeekScroll({ children }) {
  const shade = useScrollShadows();
  return (
    <div className="peek-wrap">
      <div className="peek-area" ref={shade.ref}>
        {children}
      </div>
      <div className={`peek-shade-top ${shade.top ? 'peek-on' : ''}`} aria-hidden="true" />
      <div className={`peek-shade-bot ${shade.bottom ? 'peek-on' : ''}`} aria-hidden="true" />
    </div>
  );
}
