// Gacha: 3 compact banner cards (weights + pity + on-card summon buttons).
import { useGame } from '../../controller/GameContext';
import { HEROES } from '../../data/heroes.js';
import { BANNERS, BANNER_ORDER } from '../../data/banners.js';
import { HERO_RARITIES } from '../../data/rarities.js';
import { heroAsset, resolve } from '../assets.js';
import { ownedHeroSet } from '../../model/heroes.js';
import { STRINGS } from '../../data/strings.js';
import { ANIM } from '../../data/config.js';
import Art from '../Art.jsx';
import PeekScroll from '../PeekScroll.jsx';
import RarityGrid from '../RarityGrid.jsx';
import { fmtK as fmt } from '../fmt.js';

function BannerCard({ banner, state, actions }) {
  const canX1 = state.coins >= banner.cost;
  const canX10 = state.coins >= banner.ten;
  const ftueFree = !!(state.flags && state.flags.ftueFirstPull); // the guided FTUE free pull ignores coins → keep x1 live even at 0 coins
  const pityState = state.pity[banner.id] || {};
  const bgImg = banner.bgAsset ? resolve(banner.bgAsset).img : null; // tile-background splash art

  const pityEntries = banner.pity.map((p) => {
    const cur = pityState[p.rarity] || 0;
    const near = cur / p.max >= ANIM.gacha.pityNearFrac;
    const meta = HERO_RARITIES[p.rarity];
    return { rarity: p.rarity, cur, max: p.max, near, meta };
  });

  return (
    <div className={`bcard ${banner.limited ? 'feat' : ''}`} style={{ '--bt': banner.theme + '33', '--bt2': banner.theme2 || banner.theme, '--btline': banner.theme + '88' }}>
      {banner.limited ? <div className="bcard-glow" /> : null}
      {bgImg ? <div className="bcard-bg" style={{ backgroundImage: `url(${bgImg})` }} /> : null}
      <div className="bcard-wash" />
      <div className="bcard-shine" />
      <div className="bcard-frame" />
      <div className="bcard-body">
        <div className="bcard-top">
          <div className="bcard-head">
            <div className="bcard-name">{banner.name}</div>
            <div className="bcard-sub">{banner.sub}</div>
            {banner.timer ? <span className="bcard-timer">{resolve('ui.timer').emoji} {banner.timer}</span> : null}
          </div>
          <div className="bcard-pity-col">
            <span className="plabel">{STRINGS.gacha.pity}</span>
            {pityEntries.map((p) => (
              <span key={p.rarity} className={`ppill ${p.near ? 'near' : ''}`} style={{ color: p.meta.color }}>
                <span className="pg">{resolve('ui.pity').emoji}</span>
                <span className="cname" style={{ color: p.meta.color, fontWeight: 800 }}>{p.meta.name}</span>
                <span className="pnum">{p.cur}/{p.max}</span>
              </span>
            ))}
          </div>
        </div>
        <RarityGrid weights={banner.weights} align="right" />
        <div className="bcard-btns">
          <button
            type="button"
            data-ftue="pull"
            className={`bcard-btn x1 ${(canX1 || ftueFree) ? '' : 'broke'}`}
            style={{ background: `linear-gradient(135deg, ${banner.theme}, ${banner.theme2 || banner.theme})`, boxShadow: `0 8px 22px ${banner.theme}55, 0 0 0 1px rgba(255,255,255,.14) inset` }}
            disabled={!canX1 && !ftueFree}
            onClick={() => actions.summon(banner.id, 1)}
          >
            {STRINGS.gacha.summon}
            <span className="bcost">
              <span>{resolve('ui.coin').emoji}</span>
              <span>{banner.cost}</span>
            </span>
            <span className="bgloss" />
            <span className="bshine" />
            {canX1 ? <span className="badot" /> : null}
          </button>
          <button
            type="button"
            className={`bcard-btn x10 ${canX10 ? '' : 'broke'}`}
            style={{ background: `linear-gradient(135deg, ${banner.theme2 || banner.theme}, ${banner.theme})`, boxShadow: `0 8px 22px ${banner.theme}55, 0 0 0 1px rgba(255,255,255,.14) inset` }}
            disabled={!canX10}
            onClick={() => actions.summon(banner.id, 10)}
          >
            {STRINGS.gacha.ten}
            <span className="bcost">
              <span>{resolve('ui.coin').emoji}</span>
              <span>{banner.ten}</span>
              <span className="bdisc">{STRINGS.gacha.discount}</span>
            </span>
            <span className="bgloss" />
            <span className="bshine" />
            {canX10 ? <span className="badot" /> : null}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GachaScreen() {
  const { state, actions } = useGame();
  const total = Object.keys(HEROES).length;
  const owned = ownedHeroSet(state.heroes); // distinct HERO archetypes owned (≥1 Character)
  const ownedCount = owned.size;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '12px 12px 0' }}>
      <div className="screen-head" style={{ flex: '0 0 auto' }}>
        <span>{resolve('ui.summonMachine').emoji} {STRINGS.screens.summon}</span>
        <span className="pool">{resolve('ui.coin').emoji} {fmt(state.coins)}</span>
      </div>

      <PeekScroll>
        <div className="banners-wrap">
          {BANNER_ORDER.map((id) => (
            <BannerCard key={id} banner={BANNERS[id]} state={state} actions={actions} />
          ))}
        </div>

        <div className="collection-head" style={{ flex: '0 0 auto', marginTop: 16 }}>
          {STRINGS.screens.collection} {ownedCount}/{total}
        </div>
        <div className="collection">
          {Object.keys(HEROES).map((hero) => (
            <div key={hero} className={`coll-cell ${owned.has(hero) ? 'owned' : 'locked'}`}>
              {owned.has(hero) ? <Art a={heroAsset(hero)} className="coll-emoji" /> : <span className="coll-emoji">{resolve('ui.locked').emoji}</span>}
            </div>
          ))}
        </div>
      </PeekScroll>
    </div>
  );
}
