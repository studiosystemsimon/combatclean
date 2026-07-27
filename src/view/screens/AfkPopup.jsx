// ─────────────────────────────────────────────────────────────────────────────
// AFK COLLECTION POPUP — welcome-back idle-reward screen (ported from
// docs/mockups/afk-collection-mockup.html). Opened by the AFK! tile or auto-opened
// on login when idle rewards reached C.AFK.alertMs (see reducer initState).
//
// Reuses the real systems (no parallel paths):
//   • state.pendingAfk (coins/heroXp/gearXp/ms) — the earnings, granted by COLLECT_AFK
//   • the current zone's key art + enemy pool + the player's squad (data/zones, assets)
//   • fmtK for all quantity numbers (project number rule)
//   • currencyBurst (fx/currency-pickup) for the claim explosion → arcs into the Header
//     [data-stat] counters, which tally-bounce up via counter-tween
// While open, GameContext pauses the ticks + Game.jsx unmounts combat/FxLayer.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react';
import { useGame } from '../../controller/GameContext';
import { resolve, heroAsset } from '../assets.js';
import { zoneForLevel } from '../../data/zones.js';
import { STRINGS } from '../../data/strings.js';
import { AFK, SELECTED_SLOTS } from '../../data/config.js';
import { fmtK as fmt } from '../fmt.js';
import { currencyBurst } from '../fx/currency-pickup.js';

const REVEAL_MS = 2200;      // count-up / fast-wave duration (view animation)
const PILE_CAP = 20;         // max defeated-enemy sprites in the kill pile
const SQUAD_SHOWN = 3;       // front-liners shown in the scene

const rand = (a, b) => a + Math.random() * (b - a);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const fmtT = (ms) => { const m = Math.round((ms || 0) / 60000); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };

export default function AfkPopup() {
  const { state, actions } = useGame();
  const p = state.pendingAfk;

  const laneRef = useRef(null), muzzleRef = useRef(null);
  const killRef = useRef(null), coinRef = useRef(null), heroRef = useRef(null), gearRef = useRef(null);
  const capRef = useRef(null), rewRef = useRef(null);
  const heroRefs = useRef([]);
  const [claimed, setClaimed] = useState(false);

  const zone = zoneForLevel(state.battle.level);
  const bg = resolve(zone.keyArt).img;
  const zoneName = STRINGS.zones?.[zone.nameKey] || zone.name || '';
  const enemyImgs = (zone.enemyPool || []).map((s) => resolve(`enemy.${s}`).img).filter(Boolean);
  const squad = state.order.slice(0, Math.min(SELECTED_SLOTS, SQUAD_SHOWN))
    .map((cid) => state.heroes[cid]).filter(Boolean);
  const earned = p ? { monsters: Math.floor(AFK.monstersPerHr * (p.ms / 3600000)), coins: p.coins, heroXp: p.heroXp, gearXp: p.gearXp } : null;

  // ── reveal: squad grinds a fast wave that piles up dead; the cache bar + all four counters
  //    rise together; after the burst NOTHING more spawns. (Runs once on mount.) ──
  useEffect(() => {
    if (!p) return undefined;
    const lane = laneRef.current; if (!lane) return undefined;
    let fastTimer = 0, raf = 0; const timers = []; const pile = [];
    const T = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };

    const fireMuzzle = () => { const m = muzzleRef.current; if (!m) return; m.classList.remove('fire'); void m.offsetWidth; m.classList.add('fire'); };
    const pop = (x, y, txt, sk) => {
      const el = document.createElement('div'); el.className = 'pop' + (sk ? ' sk' : '');
      el.textContent = txt; el.style.left = x + 'px'; el.style.bottom = y + 'px'; el.style.animation = 'afkpRise .75s ease-out forwards';
      lane.appendChild(el); T(() => el.remove(), 760);
    };
    const disintegrate = (x, y) => {
      for (let i = 0; i < 7; i++) {
        const s = document.createElement('div'); s.className = 'spark';
        s.style.left = x + 'px'; s.style.bottom = y + 'px'; lane.appendChild(s);
        const ang = rand(-Math.PI * 0.92, -Math.PI * 0.08), d = 16 + Math.random() * 30;
        s.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${Math.cos(ang) * d}px,${Math.sin(ang) * d}px) scale(.2)`, opacity: 0 }],
          { duration: 340 + Math.random() * 180, easing: 'ease-out', fill: 'forwards' });
        T(() => s.remove(), 560);
      }
    };
    const addCorpse = (cx, src) => {
      const c = document.createElement('img'); c.className = 'corpse'; c.src = src;
      c.style.left = (cx - 70 + rand(-52, 26)) + 'px'; c.style.bottom = (2 + Math.random() * 22) + 'px'; c.style.zIndex = '3';
      const rot = (58 + Math.random() * 54) * (Math.random() < 0.5 ? -1 : 1);
      c.style.transform = `rotate(${rot}deg)`; lane.appendChild(c); pile.push(c);
      if (pile.length > PILE_CAP) { const old = pile.shift(); old.remove(); }
      c.animate([{ transform: `rotate(${rot}deg) translateY(-16px) scale(.7)`, opacity: 0 }, { transform: `rotate(${rot}deg) translateY(0) scale(1)`, opacity: 1 }],
        { duration: 220, easing: 'cubic-bezier(.2,1.3,.4,1)', fill: 'forwards' });
    };
    const spawnFoe = () => {
      if (!enemyImgs.length) return;
      const W = lane.clientWidth;
      const img = document.createElement('img'); img.className = 'foe';
      img.src = enemyImgs[Math.floor(Math.random() * enemyImgs.length)];
      img.style.bottom = (8 + Math.random() * 32) + 'px'; img.style.left = '-76px'; lane.appendChild(img);
      const front = heroRefs.current[0];
      let frontX = W - 170;
      if (front) { const fr = front.getBoundingClientRect(), lr = lane.getBoundingClientRect(); frontX = fr.left - lr.left - 6; }
      const dist = frontX + 76, travel = 920 + Math.random() * 320;
      img.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${dist}px)` }], { duration: travel, easing: 'linear', fill: 'forwards' });
      T(() => {
        fireMuzzle(); img.classList.add('hit');
        const r = img.getBoundingClientRect(), l = lane.getBoundingClientRect();
        const cx = r.left - l.left + 38, cy = l.bottom - r.bottom + 38, src = img.src;
        disintegrate(cx, cy);
        pop(cx, cy + 28, Math.random() < 0.5 ? '☠' : '−' + fmt(30 + Math.floor(Math.random() * 220)), Math.random() < 0.5);
        T(() => { img.remove(); addCorpse(cx, src); }, 60);
      }, travel * 0.9);
    };

    fastTimer = setInterval(spawnFoe, 90); T(() => clearInterval(fastTimer), REVEAL_MS);
    const capPct = Math.min(1, p.ms / AFK.maxOfflineMs);
    const ci = capRef.current;
    const t0 = performance.now();
    const frame = (now) => {
      const e = easeOut(Math.min(1, (now - t0) / REVEAL_MS));
      if (ci) ci.style.width = (capPct * e * 100) + '%';
      if (killRef.current) killRef.current.textContent = fmt(earned.monsters * e);
      if (coinRef.current) coinRef.current.textContent = fmt(earned.coins * e);
      if (heroRef.current) heroRef.current.textContent = fmt(earned.heroXp * e);
      if (gearRef.current) gearRef.current.textContent = fmt(earned.gearXp * e);
      if ((now - t0) < REVEAL_MS) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => { clearInterval(fastTimer); cancelAnimationFrame(raf); timers.forEach(clearTimeout); pile.forEach((c) => c.remove()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!p || !earned) return null;

  // ── CLAIM: fire the real currency explosion (arcs into the HUD counters), drain the tiles to 0
  //    over the arc, then grant + close (COLLECT_AFK also clears pendingAfk → the AFK! tile vanishes). ──
  const doClaim = () => {
    if (claimed) return; setClaimed(true);
    const r = rewRef.current.getBoundingClientRect();
    const from = { x: r.left + r.width / 2, y: r.top + r.height * 0.4 };
    currencyBurst(from, [
      { statKey: 'coins', amount: earned.coins, img: resolve('ui.coin').img, color: '#ffcf4a' },
      { statKey: 'heroXp', amount: earned.heroXp, img: resolve('ui.heroXp').img, color: '#6db8ff' },
      { statKey: 'gearXp', amount: earned.gearXp, img: resolve('ui.gearXp').img, color: '#8be27a' },
    ]);
    // drain the popup tiles to 0 as the loot flies up
    const t0 = performance.now(), DUR = 900;
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / DUR), inv = 1 - easeOut(k);
      if (coinRef.current) coinRef.current.textContent = fmt(earned.coins * inv);
      if (heroRef.current) heroRef.current.textContent = fmt(earned.heroXp * inv);
      if (gearRef.current) gearRef.current.textContent = fmt(earned.gearXp * inv);
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(() => actions.collectAfk(), 1050); // grant + close after the arc lands
  };

  return (
    <div className="afk-popup">
      <div className="dim" onClick={(e) => e.stopPropagation()} />
      <div className="card">
        <div className="afk-bg" style={{ backgroundImage: bg ? `url(${bg})` : 'none' }} />

        <div className="head">
          <div className="wb">Welcome back — your squad held the line</div>
          <div className="zone ol">{zoneName}</div>
          <div className="away">⏳ Away for <b>{fmtT(p.ms)}</b></div>
        </div>

        <div className="scene">
          <div className="ground" />
          <div className="lane" ref={laneRef} />
          <div className="killwrap">
            <div className="lbl">Monsters defeated</div>
            <div className="killrow"><span className="sk">☠️</span><span className="killnum ol" ref={killRef}>0</span></div>
          </div>
          {squad.map((ch, i) => {
            const a = heroAsset(ch.hero); const H = 72 - i * 5; const ay = (a.anchor && a.anchor.y) || 0.92;
            return a.img
              ? <img key={ch.cid} ref={(el) => { heroRefs.current[i] = el; }} className="hero" src={a.img} alt=""
                  style={{ width: H, height: H, right: 12 + (SQUAD_SHOWN - 1 - i) * 46, bottom: Math.round(8 - (1 - ay) * H) }} />
              : null;
          })}
          <div className="muzzle" ref={muzzleRef} />
        </div>

        <div className="rew" ref={rewRef}>
          <div className="caprow">
            <span>Idle cache</span>
            <span className="cap" ref={(el) => { if (el) capRef.current = el.querySelector('i'); }}><i /></span>
            <b>{p.ms >= AFK.maxOfflineMs ? 'FULL · 8h' : `${fmtT(p.ms)} / 8h`}</b>
          </div>
          <div className="loot">
            <div className="item"><div className="sq" style={{ '--c': '#7a5a12' }}><img src={resolve('ui.coin').img} alt="" /></div><div className="n ol-sm" ref={coinRef}>0</div><div className="k">Coins</div></div>
            <div className="item"><div className="sq" style={{ '--c': '#1c4a7a' }}><img src={resolve('ui.heroXp').img} alt="" /></div><div className="n ol-sm" ref={heroRef}>0</div><div className="k">Hero XP</div></div>
            <div className="item"><div className="sq" style={{ '--c': '#1c5a34' }}><img src={resolve('ui.gearXp').img} alt="" /></div><div className="n ol-sm" ref={gearRef}>0</div><div className="k">Gear XP</div></div>
          </div>
        </div>

        <div className="cta">
          <button className={`claim${claimed ? ' done' : ''}`} disabled={claimed} onClick={doClaim}>
            {claimed ? '✓ COLLECTED' : <><img src={resolve('ui.chest.rare').img} alt="" />CLAIM</>}
          </button>
        </div>
      </div>
    </div>
  );
}
