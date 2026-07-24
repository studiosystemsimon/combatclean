// === Haptics port — host abstraction for tactile output ===
// The browser impl maps impact/notification to the Vibration API (no-op where absent — desktop, or a
// mobile browser before a user gesture). A Capacitor impl (`@capacitor/haptics`) swaps in behind this
// SAME port on device (Phase 7) without touching the caller. src/view/haptics.js remains the single
// owner of the fx→haptic MAPPING/vocabulary; this port is only the low-level output primitive.
export const ImpactStyle = { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' } as const;
export const NotificationType = { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' } as const;
type Impact = (typeof ImpactStyle)[keyof typeof ImpactStyle];
type Notify = (typeof NotificationType)[keyof typeof NotificationType];

const vibrate = (pattern: number | number[]): void => {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch { /* no vibration engine — silent */ }
};

// Vibration durations per impact style / notification type (ms). Presentation-output timings, not
// game tuning — they live with the platform port that owns the output, mirroring the native styles.
const IMPACT_MS: Record<string, number> = { LIGHT: 10, MEDIUM: 20, HEAVY: 35 };
const NOTIFY_MS: Record<string, number[]> = { SUCCESS: [12, 40, 12], WARNING: [20, 60], ERROR: [30, 40, 30] };

export function impact(style: Impact): void { vibrate(IMPACT_MS[style] ?? 15); }
export function notify(type: Notify): void { vibrate(NOTIFY_MS[type] ?? [15]); }
