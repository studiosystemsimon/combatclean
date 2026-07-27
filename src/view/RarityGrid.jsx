// Rarity Display Grid — reusable rarity-probability strip.
// A horizontal row of value pairs (16×37 each): a colour hero icon on top with the "%" straddling
// its bottom outline, and the number underneath. Only OBTAINABLE rarities (weight > 0) are shown.
// Read-only presentation; used anywhere rarity odds appear (gacha tiles, drop tables, chests…).
import { useId } from 'react';
import { HERO_RARITIES, HERO_RARITY_ORDER } from '../data/rarities.js';

// percentage text: ≥10 → integer, ≥1 → one decimal, <1 → two decimals (matches the approved mockup)
function fmtPct(v) {
  if (v >= 10) return String(Math.round(v));
  if (v >= 1) return (Math.round(v * 10) / 10).toString();
  return (Math.round(v * 100) / 100).toString();
}

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
const lighten = (hex, amt) => {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  r = Math.round(r + (255 - r) * amt); g = Math.round(g + (255 - g) * amt); b = Math.round(b + (255 - b) * amt);
  return `rgb(${r},${g},${b})`;
};

export default function RarityGrid({ weights, align = 'left' }) {
  const uid = useId().replace(/:/g, ''); // unique, url(#…)-safe id for the prismatic gradient
  const keys = HERO_RARITY_ORDER.filter((k) => (weights[k] || 0) > 0);
  return (
    <div className="rdg" style={{ justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
      {keys.map((k) => {
        const meta = HERO_RARITIES[k];
        const prism = !!meta.prismatic;
        const bg = prism
          ? 'linear-gradient(180deg,#3a1240,#101a2e)'
          : `linear-gradient(180deg,${rgba(meta.color, 0.32)},${rgba(meta.color, 0.08)})`;
        const hf = prism ? `url(#${uid}-pr)` : lighten(meta.color, 0.35);
        const num = fmtPct(weights[k]);
        const fs = num.length <= 2 ? 9 : num.length === 3 ? 8 : 6; // fits inside the 16px box
        return (
          <div className="rdg-cell" key={k} aria-label={`${meta.name} ${num}%`}>
            <div className="rdg-icon" style={{ '--rdg-c': meta.color, '--rdg-bg': bg, '--hf': hf }}>
              <svg viewBox="0 0 48 48" aria-hidden="true">
                {prism ? (
                  <defs>
                    <linearGradient id={`${uid}-pr`} x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#ff5ea8" />
                      <stop offset=".33" stopColor="#b46bff" />
                      <stop offset=".66" stopColor="#5ad1ff" />
                      <stop offset="1" stopColor="#8affc4" />
                    </linearGradient>
                  </defs>
                ) : null}
                <g fill="var(--hf)">
                  <ellipse cx="24" cy="17.5" rx="8.2" ry="8.6" />
                  <path d="M9.5 43c0-8.3 6.2-12.4 14.5-12.4S38.5 34.7 38.5 43a1 1 0 0 1-1 1h-27a1 1 0 0 1-1-1z" />
                </g>
              </svg>
            </div>
            <div className="rdg-num" style={{ fontSize: fs }}>{num}</div>
            <div className="rdg-pcsign">%</div>
          </div>
        );
      })}
    </div>
  );
}
