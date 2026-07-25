// Presentation resolver (view layer): resolves a registry key to { emoji, label, img }, preferring the
// image and falling back to the emoji. Art URLs come from the SANCTIONED asset pipeline
// (virtual:asset-registry, keyed by the same view key as the config), NOT a second glob — one art path.
// emoji/label defaults come from src/data/assets.js (the plan's "resolver default" table). Keeps the
// data barrels pure.
import { urlById, registry } from 'virtual:asset-registry';
import { ASSETS } from '../data/assets.js';
import { GENERATORS } from '../data/generators.js';
import { HEROES } from '../data/heroes.js';

// urlById: assetId → { variant → url }. Take the first (only) variant for a plain image.
const firstUrl = (rec) => (rec ? (rec.url ?? Object.values(rec)[0] ?? null) : null);
export const artUrl = (key) => firstUrl(urlById[key]);

// Registration point: authored in assets.json as `anchor`, baked into the resolved registry
// (Map<assetId, ResolvedAsset>). It's the point IN the image — a fraction {x,y} — that marks where
// the asset should be PINNED when placed (e.g. a character's base). null when the asset declares none.
const anchorOf = (key) => registry.get(key)?.declaration?.anchor ?? null;

const base = (key) => ASSETS[key] ?? ASSETS.missing;
export const resolve = (key) => {
  const a = base(key);
  return { emoji: a.emoji, label: a.label, img: artUrl(key), anchor: anchorOf(key) };
};

// Place a resolved asset by its REGISTRATION POINT: pin the authored anchor point to the
// bottom-centre ground line of its box, so characters of different art proportions stand on the
// same line. Returns a transform to layer over the box-centred art; undefined when the asset
// declares no anchor (assets without one keep the default centring — no behaviour change).
export function anchorStyle(a) {
  const an = a && a.anchor;
  if (!an) return undefined;
  const ax = an.x ?? 0.5, ay = an.y ?? 1;        // registration point (fraction of the image)
  const dx = ((0.5 - ax) * 100).toFixed(2);      // align anchor.x to the box's horizontal centre
  const dy = ((1 - ay) * 100).toFixed(2);        // align anchor.y to the box's bottom (ground line)
  return { transform: `translate(${dx}%, ${dy}%)` };
}

// PORTRAIT framing (authored by the char-art trim tool, stored on the hero as `portrait`): a scale
// multiplier + normalized x/y offset over the base bottom-centre 82%-height art, cropped by an
// overflow:hidden square box. Identical math to the trim tool's tile preview so the game frames the
// bust 1:1. Consumed by the hero tile, the hero dialog, and the gacha digest. `undefined` when the
// hero has no authored portrait. (The consuming element must also set `max-width:none` to defeat
// Tailwind preflight's `img{max-width:100%}`, which would otherwise clamp the box non-square.)
export function portraitStyle(p) {
  if (!p) return undefined;
  const s = p.scale ?? 1, x = p.x ?? 0, y = p.y ?? 0;
  return { height: `${82 * s}%`, left: `calc(50% + ${x * 100}%)`, bottom: `calc(2px + ${y * 100}%)` };
}
export const assetFor = resolve;
export const itemAsset = (chain, level) => resolve(`${chain}.${level}`);
export const generatorAsset = (genId) => resolve(GENERATORS[genId].asset);
export const heroAsset = (id) => resolve(HEROES[id].asset);
