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
  const teardownRef = useRef(null);

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

  // NB: a callback ref must NOT return a cleanup function in React 18 (it warns and ignores it —
  // leaking the listeners). Instead we stash the teardown in a ref and run it on re-attach / unmount.
  const ref = useCallback(
    (el) => {
      if (teardownRef.current) { teardownRef.current(); teardownRef.current = null; }
      elRef.current = el;
      if (!el) return;
      measure();
      el.addEventListener('scroll', onScroll, { passive: true });
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      if (el.firstElementChild) ro.observe(el.firstElementChild);
      const onResize = () => measure();
      window.addEventListener('resize', onResize);
      teardownRef.current = () => {
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
      if (teardownRef.current) { teardownRef.current(); teardownRef.current = null; }
    };
  }, []);

  return { ref, top: shadows.top, bottom: shadows.bottom };
}
