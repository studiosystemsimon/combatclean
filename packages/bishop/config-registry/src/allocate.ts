import { type IdCategory, isIdCategory, type Manifest } from "./manifest.js";

/** Per-category high-water mark: the highest id EVER issued for a category (persisted independent of
 *  live data so deleting the highest id never frees it). See @bishop/config-registry/node for read/bump. */
export type IdLedger = Record<string, number>;

/** True if `id` sits inside a category's lane, or its extraIds allowlist. */
export function inLane(cat: IdCategory, id: number): boolean {
	const [min, max] = cat.idRange;
	if (id >= min && id <= max) return true;
	return cat.extraIds?.includes(id) ?? false;
}

/**
 * Next id to allocate for an id-kind category — MONOTONIC, never-reuse. Takes the max of the persisted
 * high-water mark and the highest id currently in data, +1, clamped to the lane. Throws if the lane is
 * exhausted. `ledgerHigh` is the category's stored high-water (0/undefined if none yet).
 */
export function nextId(cat: IdCategory, idsInData: number[], ledgerHigh: number | undefined): number {
	const [min, max] = cat.idRange;
	const inLaneIds = idsInData.filter((id) => id >= min && id <= max);
	const dataHigh = inLaneIds.length ? Math.max(...inLaneIds) : min - 1;
	const high = Math.max(ledgerHigh ?? min - 1, dataHigh);
	const candidate = high + 1;
	if (candidate > max) {
		throw new Error(
			`[config] id lane exhausted for "${cat.name}" (${min}-${max}); widen idRange in the manifest.`,
		);
	}
	return candidate;
}

/**
 * In-memory next id for a category, off a merged config that already carries the `nextIds` seed
 * (precomputed by the node merge/scan). Browser-safe (no disk, no manifest) — for editors that add
 * several entities before a reload: uses the seed, then skips any id already taken in `config`. Falls
 * back to a scratch `nextId` counter when no seed exists.
 */
export function nextIdForConfig(config: Record<string, unknown>, category: string): number {
	const seed = (config?.nextIds as Record<string, number> | undefined)?.[category];
	if (typeof seed !== "number" || seed < 0) {
		const id = (config.nextId as number) ?? 1;
		config.nextId = id + 1;
		return id;
	}
	const used = new Set<number>();
	for (const value of Object.values(config)) {
		if (!Array.isArray(value)) continue;
		for (const e of value) {
			if (typeof (e as { id?: unknown })?.id === "number") used.add((e as { id: number }).id);
		}
	}
	let id = seed;
	while (used.has(id)) id++;
	return id;
}

/** The next allocatable id for every id-kind category, seeded off the merged data + ledger (for `--list`). */
export function nextIds(
	manifest: Manifest,
	merged: Record<string, unknown>,
	ledger: IdLedger,
): Record<string, number> {
	const out: Record<string, number> = {};
	for (const cat of manifest) {
		if (!isIdCategory(cat)) continue;
		const arr = merged[cat.name];
		const ids = Array.isArray(arr)
			? arr.map((e) => (e as { id?: unknown }).id).filter((id): id is number => typeof id === "number")
			: [];
		try {
			out[cat.name] = nextId(cat, ids, ledger[cat.name]);
		} catch {
			out[cat.name] = -1; // lane full — surfaced as "?" by the CLI.
		}
	}
	return out;
}
