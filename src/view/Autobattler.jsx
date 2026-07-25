// AFK autobattler: enemies on top, heroes below, over a cinematic battlefield.
// Each hero has its OWN limit break (the gold bar becomes a tap button when
// charged). HP bars animate down. data-battle-* attributes let the FX layer aim
// attack trails. Boss levels swap to a dramatic red backdrop + a big boss sticker
// and telegraph/slam VFX (fired via the fx queue in FxLayer). Pure presentation
// on top of the existing battle simulation + fx pipeline.
import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useGame } from '../controller/GameContext';
import { heroAsset, resolve, anchorStyle } from './assets.js';
import Art from './Art.jsx';
import HpBar from './HpBar.jsx';
import { normalChargeFrac, limitChargeFrac, isLimitReady } from '../model/battle.js';
import { isBossLevel } from '../model/map.js';
import { zoneForLevel } from '../data/zones.js'; // MERGED zone (presentation: biome/keyArt/nameKey), not the logical sim selector
import { ENEMY_BY_ID } from '../data/enemies.js'; // per-enemy combatScale (in-combat chip size) + name/asset
import { STRINGS } from '../data/strings.js';
import { ANIM } from '../data/config.js';

const AB = ANIM.autobattler;
const nextIsBoss = (level) => isBossLevel(level + 1);

// Ambient embers — presentation constants in _anim (no runtime randomness so it stays a
// pure render). Each entry {l:left%, d:delay s, dur:duration s, s:size px}; a handful of
// always-on animating DOM nodes spread across the width read as ambient life cheaply.
const EMBERS = AB.embers;

function LevelTrack({ level }) {
  const N = AB.trackWindow;
  const start = Math.max(1, level - AB.trackPast);
  const dots = [];
  for (let i = 0; i < N; i++) {
    const lv = start + i;
    const boss = isBossLevel(lv);
    const cls = ['ldot', boss && 'boss', lv < level && 'past', lv === level && 'current'].filter(Boolean).join(' ');
    dots.push(<span key={lv} className={cls} title={`Level ${lv}${boss ? ' (Boss)' : ''}`} />);
  }
  return (
    <div className="level-track">
      <div className="track-line" />
      <div className="dots">{dots}</div>
    </div>
  );
}

function HeroChip({ h, onLimit, fighting }) {
  const dead = h.hp <= 0;
  const lbReady = isLimitReady(h); // charged (from board orders) — drives the golden glow
  const canFire = lbReady && fighting; // actually TAPPABLE (fireLimitBreak needs status:fighting)
  const ha = heroAsset(h.hero); // resolved once → art + registration-point placement
  return (
    <div className={`chip hero-chip ${dead ? 'dead' : ''} ${lbReady ? 'lb-ready' : ''}`} data-battle-hero={h.id}>
      <div className="hero-charge" aria-hidden="true">
        {Array.from({ length: AB.chargePips }, (_, i) => (
          <span key={i} className="cp" />
        ))}
      </div>
      <div className="chip-art">
        <Art a={ha} className="chip-emoji" style={anchorStyle(ha)} />
      </div>
      <HpBar frac={h.hp / h.maxHp} kind="hero" />
      <div className="bar normal">
        <span style={{ width: `${Math.round(100 * normalChargeFrac(h))}%` }} />
      </div>
      <button
        type="button"
        className={`bar limit lb-btn ${canFire ? 'ready' : ''}`}
        disabled={!canFire}
        onClick={() => onLimit(h.id)}
        title="Limit Break"
      >
        <span style={{ width: `${Math.round(100 * limitChargeFrac(h))}%` }} />
        {canFire && <em className="lb-flash">💥</em>}
      </button>
    </div>
  );
}

function EnemyChip({ e, focused, onFocus, art, scale = 1, gone, conceal, lv, onDecayEnd }) {
  const dead = e.hp <= 0;
  const boss = e.specialMs !== undefined;
  return (
    <div
      className={`chip enemy-chip ${boss ? 'boss-chip' : ''} ${dead ? 'dead' : ''} ${gone ? 'gone' : ''} ${conceal ? 'concealed' : ''} ${focused ? 'focused' : ''}`}
      data-battle-enemy={e.uid}
      onClick={() => !dead && !conceal && onFocus(e.uid)}
      onAnimationEnd={(ev) => { if (ev.animationName === 'enemyDecay') onDecayEnd(e.uid); }}
    >
      <span className="lv-badge"><s>{STRINGS.combat.lvAbbr}</s>{lv}</span>
      {/* SIZE = the authored combat.scale (CSS `scale` on the chip-art box, matching the combat-editor);
          composes with the sway animation. POSITION = the img's registration-point anchor below. */}
      <div className="chip-art" style={scale !== 1 ? { scale: String(scale) } : undefined}>
        {/* Regular enemies stand on their authored registration point (anchor), like heroes. Bosses
            are hand-positioned by the boss-mode CSS transform, so they skip the inline anchor. */}
        <Art a={art} className="chip-emoji" style={boss ? undefined : anchorStyle(art)} />
      </div>
      <HpBar frac={e.hp / e.maxHp} kind="enemy" />
      {conceal && <span className="conceal-q" aria-hidden="true">?</span>}
      {focused && <span className="focus-reticle" aria-hidden="true">🎯</span>}
    </div>
  );
}

export default function Autobattler() {
  const { state, actions } = useGame();
  const { battle } = state;

  const zone = zoneForLevel(battle.level); // biome dressing + this zone's boss sticker
  const boss = isBossLevel(battle.level); // dramatic red boss backdrop
  const bossArt = boss ? resolve(`enemy.${zone.bossId}`) : null;
  const biomeImg = resolve(zone.keyArt).img; // area biome art → the combat backdrop

  // Enemies that have finished their death-decay are pulled from the flex layout so
  // the survivors redistribute evenly & symmetrically (justify-content:space-evenly).
  // Boss accomplices are NEVER marked gone → they hold their slot so the boss stays
  // centred (and can be raised back in place). Reset on each fresh wave.
  const [gone, setGone] = useState(() => new Set());
  const waveKey = battle.wave[0]?.uid;
  useEffect(() => { setGone(new Set()); }, [waveKey]);
  const onDecayEnd = (uid) => { if (!boss) setGone((g) => { const n = new Set(g); n.add(uid); return n; }); };

  // FLIP: when a decayed enemy leaves the layout, the survivors jump to their new
  // even/symmetric positions — animate that jump with a QUADRATIC EASE-OUT (fast to
  // start, slow to settle). Measured via offsetLeft so it's immune to the arena
  // shake and the chip's own transform.
  const prevX = useRef(new Map());
  // Only re-run the realign FLIP when the enemy LAYOUT can actually change (wave
  // composition or an enemy leaving the flow) — not on every combat-tick re-render,
  // which forced a querySelectorAll + per-chip offsetLeft layout read ~3-4×/s.
  const enemyLayoutSig = battle.wave.map((e) => e.uid).join(',') + '#' + gone.size;
  useLayoutEffect(() => {
    const row = document.querySelector('.enemy-row');
    const nowX = new Map();
    if (row) {
      row.querySelectorAll('.enemy-chip').forEach((node) => {
        if (node.offsetParent === null) return; // .gone / display:none → out of flow
        const uid = node.getAttribute('data-battle-enemy');
        if (uid != null) nowX.set(uid, node.offsetLeft);
      });
      nowX.forEach((nx, uid) => {
        const px = prevX.current.get(uid);
        if (px == null || Math.abs(px - nx) < 0.5) return;
        const node = row.querySelector(`.enemy-chip[data-battle-enemy="${uid}"]`);
        if (!node) return;
        node.style.transition = 'none';
        node.style.transform = `translateX(${px - nx}px)`; // invert to the old spot
        requestAnimationFrame(() => {
          node.style.transition = `transform ${AB.realignMs}ms ${ANIM.curves.easeOutQuad}`;
          node.style.transform = '';
        });
      });
    }
    prevX.current = nowX;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enemyLayoutSig]);

  const intro = battle.status === 'intro';
  const gate = battle.status === 'gate';
  // A limit break only FIRES while fighting (Battle.fireLimitBreak no-ops otherwise).
  // The button must reflect that truth — during an intro / gate / chest / clearing a
  // hero can be charged from board orders, but tapping does nothing until combat runs.
  const fighting = battle.status === 'fighting';
  // The boss + its accomplices stay hidden as silhouettes (with a ?) through the gate AND
  // the boss reveal intro — only the boss reveal un-hides them.
  const conceal = gate || (intro && boss);

  // The gate/NEXT button shows at a boss gate OR while a recovered level is being fought
  // — never over an intro cinematic.
  const showButton = gate || (battle.recovering && battle.status === 'fighting');
  const btnBoss = gate || nextIsBoss(battle.level);

  return (
    <section
      className={`battle ${boss ? 'boss-mode' : ''} ${intro ? 'intro' : ''} ${gate ? 'gate' : ''}`}
      style={{ '--biome-from': zone.biome.from, '--biome-to': zone.biome.to, '--biome-accent': zone.biome.accent, '--biome-img': biomeImg ? `url(${biomeImg})` : 'none' }}
    >
      {/* cinematic backdrop (pure presentation, behind the arena) */}
      <div className="bg bg-sky" />
      <div className="bg bg-rays" />
      <div className="bg-horizon" />
      <div className="bg fog a" />
      <div className="bg fog b" />
      <div className="bg grid" />
      {/* area biome art — the SAME key-art the intro uses, now the standard combat
          backdrop. Sits over the generic sky/grid but under the floors, fighters and
          FX so everything composites on top. */}
      <div className="bg biome-art" />
      <div className="floor enemy" />
      <div className="floor hero" />
      <div className="embers">
        {EMBERS.map((e, i) => (
          <span
            key={i}
            className="ember"
            style={{ left: `${e.l}%`, width: e.s, height: e.s, animationDelay: `${e.d}s`, animationDuration: `${e.dur}s` }}
          />
        ))}
      </div>
      <div className="bg vignette" />
      <div className="boss-loom" />
      <div className="bg-lightning" />
      {/* per-zone biome wash — LAST backdrop layer (z:0), so it tints everything
          above the cinematic bg but stays behind the fighters (rows are z:1-3). */}
      <div className="bg biome-tint" />

      <div className="battle-top">
        <div className="battle-level-main">{STRINGS.combat.level} <b>{battle.level}</b><span className="battle-zone">{STRINGS.zones[zone.nameKey]}</span></div>
        <LevelTrack level={battle.level} />
        <div className="battle-right">
          {showButton && (
            <button
              type="button"
              className={`challenge-btn ${btnBoss ? 'boss' : ''}`}
              onClick={actions.challengeNext}
            >
              {btnBoss ? STRINGS.combat.boss : STRINGS.combat.next}
            </button>
          )}
        </div>
      </div>

      <div className="arena">
        <div className="row enemy-row">
          {battle.wave.map((e) => {
            const isBoss = e.specialMs !== undefined && bossArt;
            const slug = isBoss ? zone.bossId : e.arch; // scale slug must match the art shown
            return (
            <EnemyChip
              key={e.uid}
              e={e}
              focused={battle.focusUid === e.uid}
              onFocus={actions.setFocusTarget}
              art={isBoss ? bossArt : resolve(e.asset)}
              scale={ENEMY_BY_ID[slug]?.combatScale ?? 1}
              gone={gone.has(e.uid)}
              conceal={conceal}
              lv={battle.level}
              onDecayEnd={onDecayEnd}
            />
            );
          })}
        </div>
        {/* landed chests live HERE — in front of the enemy row, behind the hero row */}
        <div className="chest-mid-layer" aria-hidden="true" />
        <div className="row hero-row">
          {battle.heroes.map((h) => (
            <HeroChip key={h.id} h={h} onLimit={actions.tapLimit} fighting={fighting} />
          ))}
        </div>
      </div>

      {/* combat VFX overlays (animated by FxLayer). .battle-fx is an empty overlay
          React never populates — safe to append imperative VFX nodes (damage numbers,
          rings) into. */}
      <div className="lb-cine" aria-hidden="true"><div className="flash" /><div className="beam" /></div>
      <div className="combo" aria-hidden="true" />
      <div className="battle-fx" aria-hidden="true" />
      <div className="boss-warn" aria-hidden="true">{STRINGS.combat.bossSpecial}</div>
      {/* level / area / boss INTRO cinematic — the intro director drives this overlay */}
      <div className="intro-layer" aria-hidden="true" />

      {battle.status === 'lost' && (
        <div className="lose-banner">
          <span className="lose-word">{STRINGS.combat.lose}</span>
        </div>
      )}
      {battle.status === 'won' && (
        <div className="win-banner">
          <span className="win-word">{STRINGS.combat.complete}</span>
        </div>
      )}
    </section>
  );
}
