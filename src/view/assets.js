// Presentation resolver (view layer): resolves a registry key to { emoji, label, img }, preferring the
// image and falling back to the emoji. Art URLs come from the SANCTIONED asset pipeline
// (virtual:asset-registry, keyed by the same view key as the config), NOT a second glob — one art path.
// emoji/label defaults come from src/data/assets.js (the plan's "resolver default" table). Keeps the
// data barrels pure.
import { urlById } from 'virtual:asset-registry';
import { ASSETS } from '../data/assets.js';
import { GENERATORS } from '../data/generators.js';
import { HEROES } from '../data/heroes.js';

// urlById: assetId → { variant → url }. Take the first (only) variant for a plain image.
const firstUrl = (rec) => (rec ? (rec.url ?? Object.values(rec)[0] ?? null) : null);
export const artUrl = (key) => firstUrl(urlById[key]);

const base = (key) => ASSETS[key] ?? ASSETS.missing;
export const resolve = (key) => {
  const a = base(key);
  return { emoji: a.emoji, label: a.label, img: artUrl(key) };
};
export const assetFor = resolve;
export const itemAsset = (chain, level) => resolve(`${chain}.${level}`);
export const generatorAsset = (genId) => resolve(GENERATORS[genId].asset);
export const heroAsset = (id) => resolve(HEROES[id].asset);
