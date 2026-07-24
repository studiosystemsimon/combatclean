// === Visual-config runtime repository ===
//
// Fronts the baked `visual` section of virtual:game-config with id → VisualConfig lookup. Imports
// ONLY the inferred TYPE from schema.ts (import type is erased), so zod never enters the browser
// bundle. Opt-in: an entity with no visual entry returns undefined and the caller falls back to its
// asset (MergeCombat-style key→art).
import bundle from 'virtual:game-config';
import type { VisualConfig } from './schema.ts';

const VISUAL: Record<string, VisualConfig> = (bundle.visual ?? {}) as unknown as Record<string, VisualConfig>;

/** The visual config for a content id, or undefined (→ caller falls back to the asset). */
export function getVisualConfig(id: number): VisualConfig | undefined {
  return VISUAL[String(id)];
}

/** True if an entity has an authored visual config (vs. asset-only rendering). */
export function hasVisualConfig(id: number): boolean {
  return VISUAL[String(id)] !== undefined;
}
