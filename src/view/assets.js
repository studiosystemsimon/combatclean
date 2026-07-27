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
// The raw asset declaration (assets.json entry): carries the trim-tool-authored placement params —
// `anchor` (registration point), and for merge icons `scale` + `rotation`. Baked into the registry
// entry as `.declaration` (the resolved entry hoists only id/type/files/derived, NOT these).
const declOf = (key) => registry.get(key)?.declaration ?? null;

const base = (key) => ASSETS[key] ?? ASSETS.missing;
export const resolve = (key) => {
  const a = base(key);
  const d = declOf(key);
  return { emoji: a.emoji, label: a.label, img: artUrl(key), anchor: d?.anchor ?? null, scale: d?.scale, rotation: d?.rotation };
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
// Place a MERGE icon 1:1 with the trim tool's combat/merge board (asset_tool.html applyMergeImg): the
// registration point is pinned to the tile CENTRE (merge default reg = [0.5,0.5]) + per-icon scale +
// rotation. Height is a % of the cell-art box (the tile's baseH reference); width auto, NO clamp.
export function mergeStyle(a) {
  if (!a) return undefined;
  const an = a.anchor, ax = an?.x ?? 0.5, ay = an?.y ?? 0.5; // merge default = tile centre
  const s = a.scale ?? 1, rot = a.rotation ?? 0;
  const dx = ((0.5 - ax) * 100).toFixed(2), dy = ((0.5 - ay) * 100).toFixed(2);
  return { height: `${(s * 100).toFixed(2)}%`, width: 'auto', maxWidth: 'none', transform: `translate(${dx}%, ${dy}%) rotate(${rot}deg)` };
}

// Same placement as mergeStyle but sized in PIXELS against a base — for small fixed slots (e.g. order
// tiles) where a %-height collapses the img to its natural size.
export function mergeStylePx(a, px) {
  if (!a) return undefined;
  const an = a.anchor, ax = an?.x ?? 0.5, ay = an?.y ?? 0.5;
  const s = a.scale ?? 1, rot = a.rotation ?? 0;
  const dx = ((0.5 - ax) * 100).toFixed(2), dy = ((0.5 - ay) * 100).toFixed(2);
  return { height: `${(s * px).toFixed(1)}px`, width: 'auto', maxWidth: 'none', transform: `translate(${dx}%, ${dy}%) rotate(${rot}deg)` };
}

export function portraitStyle(p) {
  if (!p) return undefined;
  const s = p.scale ?? 1, x = p.x ?? 0, y = p.y ?? 0;
  return { height: `${82 * s}%`, left: `calc(50% + ${x * 100}%)`, bottom: `calc(2px + ${y * 100}%)` };
}
export const assetFor = resolve;
export const itemAsset = (chain, level) => resolve(`${chain}.${level}`);
// Generators are levelled (1-based) — art keyed `gen.<genId>.<level>`, mirroring item ladders.
export const generatorAsset = (genId, level = 1) => resolve(`gen.${genId}.${level}`);
export const heroAsset = (id) => resolve(HEROES[id].asset);
