// ─────────────────────────────────────────────────────────────────────────────
// MERGE BOARD (view layer) — a faithful port of the merge-board mockup
// (docs/mockups/merge-board-mockup.html), driven by the reducer's `state.board`.
//
// MVC: `state.board` is the ONLY source of truth. Every state change is dispatched
// through the controller (actions.moveOrMerge / actions.tapGenerator); the merge
// RULES come from the model (Merge.canMerge / Merge.maxLevel) — never re-derived
// here. Combat VFX routes through the shared fx engine (src/view/fx). Tiles are
// absolutely-positioned DOM elements tracked by item id and reconciled from
// `state.board`; all animation is ephemeral, view-only presentation. A gesture
// animates optimistically and dispatches; the reducer echo reconciles (a merge
// births its result, a spawn throws from the generator, a move/swap FLIP-eases),
// while EXTERNAL board changes (an order consuming cells) reconcile with a fade.
// JUICE is baked at 1.5.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useGame } from '../controller/GameContext';
import { BOARD, TIER_PRESENTATION } from '../data/config.js';
import { canMerge, maxLevel } from '../model/merge.js';
import { STRINGS } from '../data/strings.js';
import { itemAsset, generatorAsset } from './assets.js';
import { fx } from './fx/fx-engine.js';

const N = BOARD.cols * BOARD.rows;
// Rarity colour ramp (config) + tier labels (strings) — no inlined presentation.
const RARITY = TIER_PRESENTATION.colors;
const TIER_NAME = STRINGS.merge.tierNames;
const rarity = (t) => RARITY[Math.min(t, RARITY.length - 1)];
const tierName = (t) => TIER_NAME[Math.min(t, TIER_NAME.length - 1)];
const intensity = (t) => (t >= 6 ? 'crit' : t >= 4 ? 'heavy' : 'normal');
const JUICE = 1.5;
// Held-tile lift (config) — a dragged icon rises above the finger so a thumb never
// covers it. Amount is a factor of tile height (scale-independent); the ease makes
// the grab/release feel natural. Rides the .mb-bob wrapper so finger tracking stays 1:1.
const DRAG = BOARD.drag;
const RM = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Two items are a merge pair iff the model says so (same chain + level, not maxed).
const pair = (a, b) => canMerge(a, b);

export default function Board() {
  const { state, actions } = useGame();
  const shakerRef = useRef(null);
  const tilesRef = useRef(null);
  const connRef = useRef(null);
  const cellEls = useRef([]);
  const geo = useRef([]); // per-cell {x,y,w,h,cx,cy} in shaker-space
  const tiles = useRef(new Map()); // item/generator id -> { el, inner, cell }
  const pending = useRef(null); // {type:'merge',to} | {type:'spawn',gen,cell}
  const drag = useRef(null);
  const busy = useRef(false); // a merge in flight blocks new tile-drags (gens still dispense)
  const lastInteract = useRef(0);
  const lastWave = useRef(0);
  const bestPair = useRef(null);
  const bestShown = useRef(false);
  const boardRef = useRef(state.board);
  boardRef.current = state.board;

  // ── geometry ────────────────────────────────────────────────────────────────
  const measure = () => {
    const sh = shakerRef.current;
    if (!sh) return;
    const r0 = sh.getBoundingClientRect();
    for (let i = 0; i < N; i++) {
      const el = cellEls.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      geo.current[i] = { x: r.left - r0.left, y: r.top - r0.top, w: r.width, h: r.height, cx: r.left - r0.left + r.width / 2, cy: r.top - r0.top + r.height / 2 };
    }
  };
  const placeAt = (el, i) => {
    const g = geo.current[i];
    if (!g) { el.dataset.cell = i; return; }
    el.style.width = `${g.w}px`; el.style.height = `${g.h}px`;
    el.style.transform = `translate(${g.x}px,${g.y}px)`;
    el.dataset.cell = i;
  };

  // ── tile element factory ─────────────────────────────────────────────────────
  const makeTileEl = (cell, i) => {
    const el = document.createElement('div');
    const isGen = cell.kind === 'generator';
    el.className = `mb-tile${isGen ? ' mb-gen' : ''}${cell.locked ? ' mb-locked' : ''}`;
    const a = isGen ? generatorAsset(cell.genId) : itemAsset(cell.chain, cell.level);
    const bob = document.createElement('div'); bob.className = 'mb-bob';
    const inner = document.createElement('div'); inner.className = 'mb-inner';
    if (a && a.img) {
      const im = document.createElement('img'); im.src = a.img; im.className = 'mb-art'; im.draggable = false; inner.appendChild(im);
    } else {
      const sp = document.createElement('span'); sp.className = 'mb-emoji'; sp.textContent = (a && a.emoji) || '?'; inner.appendChild(sp);
    }
    bob.appendChild(inner); el.appendChild(bob);
    if (isGen) { const p = document.createElement('span'); p.className = 'mb-plus'; p.textContent = '⚙'; el.appendChild(p); }
    else {
      el.style.setProperty('--mb-rc', rarity(cell.level));
      el.style.setProperty('--mb-tilt', `${((cell.id * 41) % 13) - 6}deg`); // deterministic lift tilt (no view rng)
    }
    tilesRef.current.appendChild(el);
    placeAt(el, i);
    tiles.current.set(cell.id, { el, inner, cell: i });
    return el;
  };
  const removeTile = (id, fade) => {
    const rec = tiles.current.get(id);
    if (!rec) return;
    tiles.current.delete(id);
    if (fade && !RM && rec.el.animate) {
      const t = rec.el.style.transform;
      rec.el.animate([{ opacity: 1, transform: `${t} scale(1)` }, { opacity: 0, transform: `${t} scale(.4)` }], { duration: 170, easing: 'ease-in' }).onfinish = () => rec.el.remove();
    } else rec.el.remove();
  };

  // ── float label + merge VFX (via the shared fx engine, JUICE 1.5) ────────────
  const floatLabel = (i, text, color, big) => {
    const g = geo.current[i]; if (!g) return;
    const l = document.createElement('div'); l.className = 'mb-lbl'; l.textContent = text;
    l.style.color = color; l.style.fontSize = `${big ? 24 : 17}px`; l.style.left = `${g.cx}px`; l.style.top = `${g.cy - 6}px`;
    tilesRef.current.appendChild(l);
    l.addEventListener('animationend', () => l.remove(), { once: true });
    setTimeout(() => l.parentNode && l.remove(), 1300);
  };
  const mergeBurst = (i, tier) => {
    const c = fx.cellCenter(i); // app-canvas coords for the shared fx overlay
    if (!c) return;
    const rc = rarity(tier); const lvl = intensity(tier);
    // Full burst for every merge, but suppress the engine's built-in tier shake —
    // the board drives shake itself so only the big merges move the screen.
    fx.impact(c.x, c.y, { tier: lvl, color: rc, r: (lvl === 'crit' ? 12 : lvl === 'heavy' ? 9 : 6) * JUICE, shake: false });
    // Screen shake ONLY on epic-or-above merges (Elite / tier ≥ 5), kept tight
    // (small amplitude → settles in a few frames, no long rumble).
    if (tier >= 5) fx.shake(tier >= 6 ? 3 : 2);
    if (tier >= 5) fx.flash(0.85, 130); // Elite and above → white screen flash
    if (tier >= 6) fx.confetti(c.x, c.y, { colors: [rc, '#ffffff', '#ffd45e'], count: 36, power: 0.85 }); // Legendary+ → confetti pop
  };

  // ── reconcile tiles ⇄ state.board ────────────────────────────────────────────
  const reconcile = () => {
    // Geometry is cached; a ResizeObserver re-measures on any layout change, so we
    // only measure here on the very first run (avoids a forced 36-rect reflow on
    // every merge/move/tap).
    if (geo.current.length < N) measure();
    const board = boardRef.current;
    const p = pending.current; pending.current = null;
    const nowMap = new Map();
    board.forEach((c, i) => { if (c) nowMap.set(c.id, i); });

    // removals: a merge already animated its two sources (remove instantly); any
    // other disappearance (order consumed a cell) fades out gracefully.
    for (const id of Array.from(tiles.current.keys())) {
      if (!nowMap.has(id)) removeTile(id, !(p && p.type === 'merge'));
    }
    // adds + moves
    for (const [id, cell] of nowMap) {
      const obj = board[cell];
      const rec = tiles.current.get(id);
      if (!rec) {
        if (p && p.type === 'merge' && cell === p.to) birthResult(obj, cell);
        else if (p && p.type === 'spawn' && cell === p.cell) throwFromGen(obj, cell, p.gen);
        else {
          const el = makeTileEl(obj, cell);
          if (!RM && el.animate) el.querySelector('.mb-inner').animate([{ transform: 'scale(0)' }, { transform: 'scale(1.12)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 300, easing: 'cubic-bezier(.2,.8,.3,1.3)' });
        }
      } else if (rec.cell !== cell) {
        rec.cell = cell;
        if (drag.current && drag.current.id === id) continue; // don't yank the tile out from under the pointer
        rec.el.style.transition = 'transform .18s cubic-bezier(.2,.7,.3,1)';
        placeAt(rec.el, cell);
        rec.el.addEventListener('transitionend', () => { rec.el.style.transition = ''; }, { once: true });
      } else {
        placeAt(rec.el, cell);
      }
    }
    computeBest();
  };

  const birthResult = (obj, cell) => {
    const el = makeTileEl(obj, cell);
    el.style.opacity = '0'; // hidden through the hit-stop, then flash-births in
    setTimeout(() => {
      el.style.opacity = '';
      el.classList.add('mb-birth');
      el.addEventListener('animationend', () => el.classList.remove('mb-birth'), { once: true });
      floatLabel(cell, `+${tierName(obj.level)}`, rarity(obj.level), obj.level >= 6);
      busy.current = false;
    }, RM ? 0 : 40);
  };

  const throwFromGen = (obj, cell, gen) => {
    const el = makeTileEl(obj, cell);
    const gg = geo.current[gen]; const dg = geo.current[cell];
    if (gg && dg && !RM && el.animate) {
      const apexY = Math.min(gg.y, dg.y) - 70;
      el.animate([
        { transform: `translate(${gg.x}px,${gg.y}px) scale(.5) rotate(0deg)`, offset: 0 },
        { transform: `translate(${(gg.x + dg.x) / 2}px,${apexY}px) scale(.5) rotate(200deg)`, offset: 0.5 }, // 50% size in flight
        { transform: `translate(${dg.x}px,${dg.y}px) scale(1.18,.82) rotate(360deg)`, offset: 0.9 },        // scales up + squashes on land
        { transform: `translate(${dg.x}px,${dg.y}px) scale(1) rotate(360deg)`, offset: 1 },
      ], { duration: 460, easing: 'cubic-bezier(.35,.15,.5,1)' });
    }
  };

  // ── best-merge detection (highest-tier mergeable pair, cobwebs excluded) ──────
  const computeBest = () => {
    const board = boardRef.current;
    const groups = {};
    for (let i = 0; i < N; i++) {
      const c = board[i];
      if (c && c.kind === 'item' && !c.locked && c.level < maxLevel(c.chain)) (groups[`${c.chain}:${c.level}`] ||= []).push(i);
    }
    let bt = -1, cells = null;
    for (const k in groups) {
      const arr = groups[k]; if (arr.length < 2) continue;
      const t = +k.split(':')[1];
      if (t > bt) { bt = t; cells = [arr[0], arr[1]]; }
    }
    bestPair.current = cells;
    paintBest();
  };
  const paintBest = () => {
    for (const [, rec] of tiles.current) rec.el.classList.remove('mb-best');
    const show = bestPair.current && bestShown.current;
    if (connRef.current) connRef.current.style.display = show ? '' : 'none';
    if (!show) return;
    for (const i of bestPair.current) {
      const c = boardRef.current[i]; const rec = c && tiles.current.get(c.id);
      if (rec) rec.el.classList.add('mb-best');
    }
    const a = geo.current[bestPair.current[0]]; const b = geo.current[bestPair.current[1]];
    if (a && b && connRef.current) {
      const dx = b.cx - a.cx, dy = b.cy - a.cy;
      connRef.current.style.width = `${Math.hypot(dx, dy)}px`;
      connRef.current.style.left = `${a.cx}px`; connRef.current.style.top = `${a.cy}px`;
      connRef.current.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    }
  };

  // reconcile whenever the board (model) changes
  useLayoutEffect(() => { reconcile(); /* eslint-disable-next-line */ }, [state.board]);
  useEffect(() => {
    const sh = shakerRef.current;
    if (!sh || typeof ResizeObserver === 'undefined') return undefined;
    // Re-measure only when the board box actually changes size (window resize,
    // orientation, or the combat panel above reflowing) — not on every board mutation.
    const ro = new ResizeObserver(() => {
      measure();
      for (const [, rec] of tiles.current) placeAt(rec.el, rec.cell);
      paintBest();
    });
    ro.observe(sh);
    return () => ro.disconnect();
  }, []);

  // best-merge reveal after 15s idle + irregular idle "Mexican wave" bob
  useEffect(() => {
    lastInteract.current = performance.now();
    const iv = setInterval(() => {
      const now = performance.now();
      const wantBest = now - lastInteract.current >= 15000 && !!bestPair.current;
      if (wantBest !== bestShown.current) { bestShown.current = wantBest; paintBest(); }
      if (!RM && now - lastInteract.current >= 4000 && now - lastWave.current >= 4000 + Math.random() * 5000) {
        lastWave.current = now; triggerWave();
      }
    }, 400);
    return () => clearInterval(iv);
    /* eslint-disable-next-line */
  }, []);
  const triggerWave = () => {
    for (let col = 0; col < BOARD.cols; col++) {
      setTimeout(() => {
        for (let row = 0; row < BOARD.rows; row++) {
          const i = row * BOARD.cols + col; const c = boardRef.current[i];
          if (!c || c.kind !== 'item' || c.locked) continue; // skip generators + cobwebs
          const rec = tiles.current.get(c.id);
          if (!rec || rec.el.classList.contains('mb-dragging')) continue;
          rec.el.classList.remove('mb-wave'); void rec.el.offsetWidth; rec.el.classList.add('mb-wave');
          rec.el.addEventListener('animationend', () => rec.el.classList.remove('mb-wave'), { once: true });
        }
      }, col * 90);
    }
  };
  const touch = () => { lastInteract.current = performance.now(); if (bestShown.current) { bestShown.current = false; paintBest(); } };

  // ── pointer interaction (drag / merge / move / swap / gen-tap) ────────────────
  useEffect(() => {
    const tilesEl = tilesRef.current;
    // Nearest cell by GEOMETRY (not elementFromPoint — tiles sit above cells and
    // would occlude them during a drag). Mirrors the mockup's cellAtPoint.
    const cellAt = (clientX, clientY, shRect) => {
      const sh = shRect || shakerRef.current.getBoundingClientRect();
      const x = clientX - sh.left, y = clientY - sh.top;
      let best = -1, bd = Infinity;
      for (let i = 0; i < N; i++) {
        const g = geo.current[i]; if (!g) continue;
        const dx = x - g.cx, dy = y - g.cy; const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) { const g = geo.current[best]; if (Math.abs(x - g.cx) < g.w * 0.92 && Math.abs(y - g.cy) < g.h * 0.92) return best; }
      return -1;
    };
    const moveDrag = (cx, cy) => {
      const d = drag.current; if (!d) return;
      const sh = d.shRect || shakerRef.current.getBoundingClientRect(); // cached at pointerdown
      d.el.style.transform = `translate(${cx - sh.left - d.w / 2}px,${cy - sh.top - d.h / 2}px)`;
    };
    const clearDragUI = (d) => {
      if (d.hint) clearTimeout(d.hint);
      d.el.classList.remove('mb-lifted', 'mb-dragging');
      const inner = d.el.querySelector('.mb-inner'); if (inner) inner.style.transform = '';
      // Ease the lifted icon back down to rest (mirrors the grab ease).
      if (d.bob) { d.bob.style.transition = RM ? 'none' : `transform ${DRAG.easeMs}ms ${DRAG.easeCurve}`; d.bob.style.transform = ''; }
      d.el.style.removeProperty('--mb-lift-scale'); // inner eases back via its own transition

      cellEls.current.forEach((ce) => ce && ce.classList.remove('mb-dim', 'mb-dropok'));
      for (const [, rec] of tiles.current) rec.el.classList.remove('mb-canmerge', 'mb-hovok');
    };
    const snapBack = (d) => {
      d.el.style.transition = 'transform .22s cubic-bezier(.34,1.56,.64,1)';
      placeAt(d.el, d.from);
      d.el.addEventListener('transitionend', () => { d.el.style.transition = ''; }, { once: true });
    };
    const invalid = (over) => {
      const o = boardRef.current[over]; const rec = o && tiles.current.get(o.id);
      if (rec) { rec.el.classList.remove('mb-bad'); void rec.el.offsetWidth; rec.el.classList.add('mb-bad'); rec.el.addEventListener('animationend', () => rec.el.classList.remove('mb-bad'), { once: true }); }
    };

    const onDown = (e) => {
      const tileEl = e.target.closest('.mb-tile'); if (!tileEl) return;
      const cell = Number(tileEl.dataset.cell);
      const c = boardRef.current[cell]; if (!c) return;
      const isGen = c.kind === 'generator';
      if (busy.current && !isGen) return; // a merge blocks tile-drags; generators still dispense
      if (!isGen && c.locked) return; // cobweb tiles are immovable — freed only by merging a matching tile onto them
      touch();
      const g = geo.current[cell] || { w: 56, h: 56 };
      drag.current = { id: c.id, from: cell, el: tileEl, w: g.w, h: g.h, isGen, sx: e.clientX, sy: e.clientY, moved: false, hint: 0, hover: -1, shRect: shakerRef.current.getBoundingClientRect() };
      try { tileEl.setPointerCapture(e.pointerId); } catch { /* */ }
      tileEl.classList.add('mb-lifted', 'mb-dragging'); tileEl.style.transition = '';
      if (cellEls.current[cell]) cellEls.current[cell].classList.add('mb-dim');
      // Lift the icon up above the finger so a thumb never covers it, eased in from
      // rest so the grab feels natural (config: BOARD.drag). Items only — generators
      // are tapped/relocated, not held. The lift rides .mb-bob so the el transform
      // keeps tracking the finger 1:1 and the drop target stays under the finger.
      if (!isGen) {
        tileEl.style.setProperty('--mb-lift-scale', DRAG.liftScale); // held item swells (config)
        const bob = tileEl.querySelector('.mb-bob');
        if (bob) {
          const lift = Math.round(g.h * DRAG.liftFactor);
          drag.current.bob = bob;
          bob.style.transition = RM ? 'none' : `transform ${DRAG.easeMs}ms ${DRAG.easeCurve}`;
          if (RM) bob.style.transform = `translateY(${-lift}px)`;
          else requestAnimationFrame(() => { if (drag.current && drag.current.el === tileEl) bob.style.transform = `translateY(${-lift}px)`; });
        }
      }
      if (!isGen) {
        drag.current.hint = setTimeout(() => { // green "possible matches" only after holding 4s
          for (let i = 0; i < N; i++) {
            const o = boardRef.current[i];
            if (i !== cell && pair(c, o)) { const rec = tiles.current.get(o.id); if (rec) rec.el.classList.add('mb-canmerge'); }
          }
        }, 4000);
      }
      moveDrag(e.clientX, e.clientY);
    };
    const onMove = (e) => {
      const d = drag.current; if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 8) d.moved = true;
      moveDrag(e.clientX, e.clientY);
      const over = cellAt(e.clientX, e.clientY, d.shRect);
      if (over === d.hover) return; // hovered cell unchanged → skip the drop/hover class churn
      d.hover = over;
      cellEls.current.forEach((ce) => ce && ce.classList.remove('mb-dropok'));
      for (const [, rec] of tiles.current) rec.el.classList.remove('mb-hovok');
      if (over >= 0 && over !== d.from) {
        const o = boardRef.current[over]; const src = boardRef.current[d.from];
        if (o === null) { if (cellEls.current[over]) cellEls.current[over].classList.add('mb-dropok'); }
        else if (!d.isGen && pair(src, o)) { const rec = tiles.current.get(o.id); if (rec) rec.el.classList.add('mb-hovok'); }
      }
    };
    const onUp = (e) => {
      const d = drag.current; if (!d) return; drag.current = null;
      clearDragUI(d); touch();
      const over = cellAt(e.clientX, e.clientY);
      const src = boardRef.current[d.from];

      // generator: a tap (barely moved) dispenses; a drag onto an empty cell relocates it.
      if (d.isGen) {
        if (!d.moved) {
          d.el.classList.remove('mb-recoil'); void d.el.offsetWidth; d.el.classList.add('mb-recoil');
          const spawnCell = boardRef.current.indexOf(null); // the cell the reducer will fill
          if (spawnCell >= 0) {
            pending.current = { type: 'spawn', gen: d.from, cell: spawnCell };
            actions.tapGenerator(d.from);
            setTimeout(() => { if (pending.current && pending.current.type === 'spawn') pending.current = null; }, 90); // clear if energy-gated (no reconcile)
          }
          snapBack(d);
        } else if (over >= 0 && over !== d.from && boardRef.current[over] === null) {
          actions.moveOrMerge(d.from, over); // reducer relocates the generator → reconcile FLIPs it
        } else {
          snapBack(d);
        }
        return;
      }

      if (!d.moved || over < 0 || over === d.from) { snapBack(d); return; }
      const o = boardRef.current[over];
      if (o === null) { actions.moveOrMerge(d.from, over); return; } // move → reconcile FLIP
      if (o.kind === 'generator') { snapBack(d); invalid(over); return; }
      if (pair(src, o)) {
        // MERGE — slam the dragged tile into the twin, then commit at contact.
        busy.current = true;
        const gTo = geo.current[over]; const targetRec = tiles.current.get(o.id);
        if (gTo) { d.el.style.transition = 'transform .11s cubic-bezier(.55,.06,.9,.3)'; placeAt(d.el, over); }
        const dInner = d.el.querySelector('.mb-inner'); if (dInner) dInner.style.transform = 'scale(1.12)';
        if (targetRec && !RM && targetRec.inner.animate) targetRec.inner.animate([{ transform: 'scale(1)' }, { transform: 'scaleX(1.28) scaleY(.72)', offset: 0.45 }, { transform: 'scale(1)' }], { duration: 120, easing: 'ease-out' });
        setTimeout(() => {
          mergeBurst(over, src.level + 1); // VFX punch fires at contact (110ms)
          if (src.locked || o.locked) floatLabel(over, STRINGS.board.unlocked, '#ffffff', false); // cobweb freed → feedback
          pending.current = { type: 'merge', to: over };
          // Reducer flips → reconcile removes sources + births result. It ALSO emits a
          // haptic-only 'merge' fx event (drained by FxLayer → hapticForFx) — the merge
          // haptic rides the shared fx bus, not a view side-channel.
          actions.moveOrMerge(d.from, over);
          setTimeout(() => { busy.current = false; }, 700); // safety release
        }, 110);
      } else {
        actions.moveOrMerge(d.from, over); // swap → reconcile FLIP
      }
    };
    const onCancel = () => { const d = drag.current; if (!d) return; drag.current = null; clearDragUI(d); snapBack(d); };
    tilesEl.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      tilesEl.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    /* eslint-disable-next-line */
  }, [actions]);

  return (
    <div className="mb2">
      <div className="mb-shaker" ref={shakerRef} style={{ aspectRatio: `${BOARD.cols} / ${BOARD.rows}` }}>
        <div className="mb-board" style={{ gridTemplateColumns: `repeat(${BOARD.cols}, 1fr)`, gridTemplateRows: `repeat(${BOARD.rows}, 1fr)` }}>
          {Array.from({ length: N }, (_, i) => (
            <div key={i} className="mb-cell" data-cell-index={i} ref={(el) => { cellEls.current[i] = el; }} />
          ))}
        </div>
        <div className="mb-tiles" ref={tilesRef} />
        <div className="mb-conn" ref={connRef} style={{ display: 'none' }} />
      </div>
    </div>
  );
}
