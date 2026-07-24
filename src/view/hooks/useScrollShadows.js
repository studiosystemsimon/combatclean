// ─────────────────────────────────────────────────────────────────────────────
// SCROLL SHADOWS HOOK (view layer)
// Returns { ref, top, bottom } booleans indicating whether there is hidden content
// above/below the visible scroll area. Used by PeekScroll to show/hide edge-fade
// gradients. Measures on scroll + RAF re-measure + ResizeObserver + window resize.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';

export function useScrollShadows() {
  const elRef = useRef(null);
  const [shadows, setShadows] = useState({ top: false, bottom: false });
  const rafRef = useRef(null);

  const measure = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const top = scrollTop > 1;
    const bottom = scrollTop + clientHeight < scrollHeight - 1;
    setShadows((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
  }, []);

  const onScroll = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(measure);
  }, [measure]);

  const ref = useCallback(
    (el) => {
      elRef.current = el;
      if (!el) return;
      measure();
      el.addEventListener('scroll', onScroll, { passive: true });
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      if (el.firstElementChild) ro.observe(el.firstElementChild);
      const onResize = () => measure();
      window.addEventListener('resize', onResize);
      return () => {
        el.removeEventListener('scroll', onScroll);
        ro.disconnect();
        window.removeEventListener('resize', onResize);
      };
    },
    [measure, onScroll],
  );

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { ref, top: shadows.top, bottom: shadows.bottom };
}
