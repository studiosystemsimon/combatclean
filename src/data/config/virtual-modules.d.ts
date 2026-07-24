// Type surface for the build-time virtual modules the Vite plugins provide.
//
// `virtual:game-config` — the merged, validated logical-config bundle emitted by
// @bishop/config-registry/vite (see vite.config.ts). Statically imported once by the
// runtime repository (Capacitor-safe: no runtime fetch of /data/*.json). The compose
// hook folds in: every category array, the singleton objects, the UI registry (`ui`),
// the well-known `refs`, `schemaVersion`, and the derived `nextIds`.
declare module 'virtual:game-config' {
  export interface GameConfigBundle {
    // id-kind + key-kind category arrays (one per manifest category).
    readonly [category: string]: unknown;
    readonly battle: Record<string, number>;
    readonly energy: Record<string, number>;
    readonly progression: Record<string, number>;
    /** UI registry: category → (id|key) → presentation entry (name/colour/iconAssetId). */
    readonly ui: Record<string, Record<string, Record<string, unknown>>>;
    /** Visual (VSM) registry: id → the entity's visual config (states/layers). */
    readonly visual: Record<string, Record<string, unknown>>;
    /** Well-known content ids code may pin (from _global.json#refs). */
    readonly refs: Record<string, number>;
    readonly schemaVersion: number;
    /** Next allocatable id per id-kind category (derived; for editors). */
    readonly nextIds: Record<string, number>;
  }
  const bundle: GameConfigBundle;
  export default bundle;
}

// `virtual:asset-registry` — the resolved asset database emitted by @bishop/asset-registry/vite.
// `registry` maps assetId → resolved asset metadata; `urlById` maps assetId → its emitted url(s).
declare module 'virtual:asset-registry' {
  export const registry: Map<string, unknown>;
  export const urlById: Record<string, Record<string, string>>;
}

