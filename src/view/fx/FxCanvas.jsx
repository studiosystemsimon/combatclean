// Full-screen Canvas2D overlay for trails + impacts. pointer-events:none so it
// never eats board drags; sits above the board, below modals.
import { useEffect, useRef } from 'react';
import { fx } from './fx-engine.js';

export default function FxCanvas() {
  const ref = useRef(null);
  useEffect(() => {
    fx.mount(ref.current);
    return () => fx.unmount();
  }, []);
  return (
    <canvas
      ref={ref}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 50 }}
    />
  );
}
