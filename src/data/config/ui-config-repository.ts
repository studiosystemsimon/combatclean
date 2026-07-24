// === UI-config runtime repository ===
//
// The third leg of the id-contract: PRESENTATION (display name, colour, icon assetId)
// keyed by the SAME id/key as the logical entry, kept OUT of the logical config. Reads
// only the baked bundle's `ui` section — imports neither the logical repository nor any
// data adapter, so it is cycle-safe (the logical repo backfills FROM here).
import bundle from 'virtual:game-config';

type UIEntry = Record<string, unknown>;

const UI: Record<string, Record<string, UIEntry>> = (bundle.ui ?? {}) as Record<string, Record<string, UIEntry>>;

/** The UI entry for a content id/key in a category, or an empty object if none authored. */
export function getUIConfigIn(category: string, idOrKey: number | string): UIEntry {
  return UI[category]?.[String(idOrKey)] ?? {};
}

/** True if a UI entry exists for this id/key. */
export function hasUIConfigIn(category: string, idOrKey: number | string): boolean {
  return UI[category]?.[String(idOrKey)] !== undefined;
}
