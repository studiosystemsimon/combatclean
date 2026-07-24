// Shared number formatter (deduped from HeroesScreen / MapScreen / hero-fx per Phase 7).
// 1234 → "1.2k", 12345 → "12k", 999 → "999". MapScreen rounds its input before formatting.
export const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n));
