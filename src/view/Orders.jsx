// Orders rail (view). Landscape tiles: reward CHEST on the left with the REROLL die
// under it, then the required-item icons fill the rest at full height. Flat rarity
// colour (no glow, no rarity text). A fulfilled order DISAPPEARS and the rest slide
// left (position-only FLIP easing); a DISTINCT "next order" timer is appended at the
// end and fills after arrivalMs. Reroll swaps the order (almost always lower rarity)
// under a white wipe. Completing an order uses the EXISTING fulfil flow — an order
// is only tappable when the board actually holds its items (canFulfill); tapping it
// dispatches fulfillOrder, which runs the chest sequence. `data-order-id` lets the
// order-chest VFX target the exact card. The section height is LOCKED to the game's
// orders-bar height in index.css.
import { useLayoutEffect, useEffect, useRef } from 'react';
import { useGame } from '../controller/GameContext';
import { itemAsset, resolve } from './assets.js';
import Art from './Art.jsx';
import { canFulfill } from '../model/orders.js';
import { GEAR_RARITY } from '../data/gear.js';
import { STRINGS } from '../data/strings.js';

export default function Orders() {
  const { state, actions } = useGame();
  const railRef = useRef(null);
  const cardRefs = useRef({});
  const prevRects = useRef({});
  const pendingStart = useRef({}); // pending id → performance.now() when its countdown began

  const slots = state.orders; // array order IS the render order (orders left, pending at end)
  const flipKey = slots.map((o) => o.id + (o.pending ? 'p' : o.fulfilling ? 'f' : 'o')).join(',');

  // FLIP: POSITION-ONLY easing. Remember each tile's spot, then after the list
  // changes, invert to the old spot and ease to the new one. No fade — a completed
  // order just vanishes and the rest slide left.
  useLayoutEffect(() => {
    const rects = {};
    for (const id in cardRefs.current) {
      const el = cardRefs.current[id];
      if (el) rects[id] = el.getBoundingClientRect();
    }
    for (const id in rects) {
      const prev = prevRects.current[id];
      const el = cardRefs.current[id];
      if (prev && el) {
        const dx = prev.left - rects[id].left;
        const dy = prev.top - rects[id].top;
        if (dx || dy) {
          el.style.transition = 'none';
          el.style.transform = `translate(${dx}px, ${dy}px)`;
          requestAnimationFrame(() => {
            el.style.transition = 'transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)';
            el.style.transform = '';
          });
        }
      }
    }
    prevRects.current = rects;
  }, [flipKey]);

  // Pending arrival timers: the VIEW owns the countdown animation (performance.now,
  // the same view-timing source as fx-engine/chest-smash — never wall-clock game
  // time), animating each ring + seconds text over `dur` and dispatching the fill
  // when it elapses. Only runs while a pending slot exists (the effect restarts when
  // state.orders changes — i.e. a pending is created / filled).
  useEffect(() => {
    if (!state.orders.some((o) => o.pending)) return undefined;
    let raf;
    const tick = () => {
      const now = performance.now();
      for (const o of state.orders) {
        if (!o.pending) continue;
        if (pendingStart.current[o.id] == null) pendingStart.current[o.id] = now;
        const elapsed = now - pendingStart.current[o.id];
        const el = cardRefs.current[o.id];
        if (el) {
          const p = Math.min(1, elapsed / o.dur);
          const ring = el.querySelector('.ring');
          if (ring) ring.style.setProperty('--p', p.toFixed(3));
          const t = el.querySelector('.pending-time');
          if (t) {
            const secs = Math.max(0, (o.dur - elapsed) / 1000);
            t.textContent = secs > 0 ? secs.toFixed(1) + 's' : '…';
          }
        }
        if (elapsed >= o.dur) { delete pendingStart.current[o.id]; actions.fillOrderGap(o.id); } // reducer no-ops if already filled
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state.orders, actions]);

  // Drag-to-scroll the rail (mouse + touch); suppress the click that ends a drag so
  // it never fulfils / rerolls an order.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return undefined;
    let down = false, moved = false, startX = 0, startScroll = 0;
    const onDown = (e) => { down = true; moved = false; startX = e.clientX; startScroll = rail.scrollLeft; };
    const onMove = (e) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > 5) { moved = true; rail.classList.add('dragging'); try { rail.setPointerCapture(e.pointerId); } catch { /* noop */ } }
      if (moved) rail.scrollLeft = startScroll - dx;
    };
    const onUp = (e) => { if (!down) return; down = false; rail.classList.remove('dragging'); try { rail.releasePointerCapture(e.pointerId); } catch { /* noop */ } };
    const onClickCapture = (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } };
    rail.addEventListener('pointerdown', onDown);
    rail.addEventListener('pointermove', onMove);
    rail.addEventListener('pointerup', onUp);
    rail.addEventListener('pointercancel', onUp);
    rail.addEventListener('click', onClickCapture, true);
    return () => {
      rail.removeEventListener('pointerdown', onDown);
      rail.removeEventListener('pointermove', onMove);
      rail.removeEventListener('pointerup', onUp);
      rail.removeEventListener('pointercancel', onUp);
      rail.removeEventListener('click', onClickCapture, true);
    };
  }, []);

  // Reroll = white wipe over the tile: wipe to white, swap at the peak, wipe away.
  const onReroll = (e, id) => {
    e.stopPropagation();
    const card = cardRefs.current[id];
    const wipe = card && card.querySelector('.wipe');
    if (wipe && wipe.animate) {
      wipe.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 160, easing: 'ease-in', fill: 'forwards' });
    }
    setTimeout(() => {
      actions.rerollOrder(id); // swaps the order content (same id → tile stays put)
      requestAnimationFrame(() => {
        const w = cardRefs.current[id] && cardRefs.current[id].querySelector('.wipe');
        if (w && w.animate) {
          const a = w.animate([{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 0 0 100%)' }], { duration: 220, easing: 'ease-out', fill: 'forwards' });
          a.onfinish = () => { w.style.clipPath = ''; };
        }
      });
    }, 150);
  };

  return (
    <section className="orders" aria-label="Orders">
      <div className="rail" ref={railRef}>
        {slots.map((o) => {
          if (o.pending) {
            return (
              <div
                key={o.id}
                className="pending"
                ref={(el) => { cardRefs.current[o.id] = el; }}
              >
                <div className="ring"><span className="pending-time">…</span></div>
                <span className="pending-lbl">{STRINGS.orders.nextOrder}</span>
              </div>
            );
          }
          const rar = GEAR_RARITY[o.rarity];
          const ready = !o.fulfilling && canFulfill(state.board, o);
          return (
            <div
              key={o.id}
              role="button"
              aria-disabled={!ready}
              data-order-id={o.id}
              className={`order${ready ? ' ready' : ''}${o.fulfilling ? ' fulfilling' : ''}`}
              style={rar ? { '--rar': rar.color } : undefined}
              ref={(el) => { cardRefs.current[o.id] = el; }}
              onClick={() => ready && actions.fulfillOrder(o.id)}
            >
              <span className="wipe" />
              <span className="otab"><Art a={resolve(`ui.chest.${o.rarity}`)} className="otab-art" /></span>
              <div className="side">
                <button type="button" className="reroll" title={STRINGS.orders.rerollHint} onClick={(e) => onReroll(e, o.id)}><Art a={resolve('ui.reroll')} className="reroll-icon" /></button>
              </div>
              <div className="reqs">
                {o.items.map((it, i) => (
                  <span key={i} className="req"><Art a={itemAsset(it.chain, it.level)} className="req-art" /></span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
