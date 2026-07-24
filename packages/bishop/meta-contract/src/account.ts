// The account blob — one jsonb document per player, in SIX engine-owned sections (Backend TDD ch.4).
// Engine owns the section KEYS + their kinds; the GAME owns the contents (which configIds populate
// them, the per-instance `stats` schema, each feature slice's shape). A game must not add a 7th
// top-level section or fork the kinds, or the shared executor breaks.

// Instance item (heroes + equipment). The ENGINE owns only `iid` (server-allocated at grant, unique
// WITHIN the account — access is always by (playerId, iid), so a future tall table keys on the
// composite (player_id, iid); iid needs no global uniqueness) and `configId` (its category). Any
// per-instance data (level, rolled stats, …) is GAME-shaped and opaque to the engine — a game
// intersects its own fields onto this type; the index signature keeps such extra keys type-legal.
export interface ItemInstance {
	iid: string;
	configId: number;
	[key: string]: unknown;
}

// Idempotency + bookkeeping — NEVER serialized to the client (allowlist-projected out).
export interface ServerSection {
	lastAction?: {
		guid: string;
		version: number;
		result: unknown;
	};
}

export interface AccountBlob {
	schemaVersion: number; // lazy upgrade chain
	resources: Record<string, number>; // WALLET — {configId → amount}, ONE flat map (no paid/free split)
	unlocks: number[]; // permanent one-time grants — ONE flat set of configIds
	items: ItemInstance[]; // INSTANCE items (heroes + equipment) in ONE list
	profile: Record<string, unknown>; // SOFT / trust-but-bound state + purchase-limit ledger
	features: Record<string, unknown>; // per-feature namespaced slices
	_server: ServerSection;
}

// What the client receives — `_server` stripped (the projection allowlist, ch.7).
export type ClientAccountView = Omit<AccountBlob, "_server">;

// Server-internal record: the blob + the CAS `version` column (outside the blob).
export interface AccountRecord {
	playerId: string;
	version: number;
	blob: AccountBlob;
}

export const CLIENT_SECTIONS = [
	"schemaVersion",
	"resources",
	"unlocks",
	"items",
	"profile",
	"features",
] as const;

// Allowlist projection — strip `_server.*` (+ anything not in the client sections). Pure.
export function projectForClient(blob: AccountBlob): ClientAccountView {
	return {
		schemaVersion: blob.schemaVersion,
		resources: blob.resources,
		unlocks: blob.unlocks,
		items: blob.items,
		profile: blob.profile,
		features: blob.features,
	};
}
