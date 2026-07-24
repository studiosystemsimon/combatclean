// Shared VFX math/helpers (view layer). Lifted once so the fx engine, the
// currency engine, and the reveal engine share one copy (per the porting guide).

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const lerp = (a, b, t) => a + (b - a) * t;

// Easing set.
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInQuad = (t) => t * t;
export const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
export const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
// Quadratic bezier scalar.
export const bezier2 = (t, p0, p1, p2) => {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
};

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export const rgbStr = (hex) => {
  const { r, g, b } = hexToRgb(hex);
  return `${r},${g},${b}`;
};
export function lerpHex(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return `rgb(${Math.round(lerp(A.r, B.r, t))},${Math.round(lerp(A.g, B.g, t))},${Math.round(lerp(A.b, B.b, t))})`;
}

// Pre-bake a radial-gradient glow sprite (never use ctx.shadowBlur in the loop).
export function bakeGlow(hex, peak = 0.7) {
  const SZ = 64;
  const c = document.createElement('canvas');
  c.width = c.height = SZ;
  const g = c.getContext('2d');
  const cx = SZ / 2;
  const rgb = rgbStr(hex);
  const grad = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grad.addColorStop(0.0, `rgba(${rgb},${peak})`);
  grad.addColorStop(0.35, `rgba(${rgb},${peak * 0.55})`);
  grad.addColorStop(0.7, `rgba(${rgb},${peak * 0.2})`);
  grad.addColorStop(1.0, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, SZ, SZ);
  return c;
}
