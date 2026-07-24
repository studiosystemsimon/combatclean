import { z } from "zod";
import type { ClientAccountView } from "./account.js";
import type { AccountPatch } from "./patch.js";

// Client↔server wire DTOs (Backend TDD ch.5).
// Mutation responses return the DELTA ({patch, version}) — never the full slice; GET /me returns the
// full slice on boot/resync. The client applies the patch when version == last+1, else version-gap
// → full re-read.

// The action IS the endpoint (POST /offers/:id/buy, POST /quests/:id/claim, …) — the server resolves
// it from ITS config. So the wire carries no free-form "intent": every mutating request shares only
// the idempotency `guid`; each endpoint extends this with its own body/route params. Feature DTOs do
// `zActionRequest.extend({ ... })`.
export const zActionRequest = z.object({
	guid: z.string().min(1),
});
export type ActionRequest = z.infer<typeof zActionRequest>;

// The DELTA the client applies to its mirror. Only `patch` + `version` ride the wire — the client applies
// the patch (which already carries the actual granted deltas) and tracks version. (There was a `result`
// member carrying `{transaction, granted}`; nothing consumed it — the mirror never read it — so it was
// dropped to cut per-mutation bytes. Re-add a lean `granted`-only field if a reward ceremony ever needs the
// actual-granted bundle, which differs from `patch` only under cap-overflow.)
//
// UNIFIED PROFILE (own-table feature extensions): the account is ONE resource with its own CAS version. A
// game extends the engine with FEATURES; a feature normally lives in `account.features.<slice>` (in-blob),
// but a feature may instead own its OWN TABLE ("tall-table feature" — the active run today; a split-out
// inventory/resources later) for clean separation. An own-table feature has its OWN version + patch stream,
// but is composed into the client's ONE `profile` document (the client never learns which came from which
// table). A mutation may write more than one (a run node/end writes the run AND banks to the account), so a
// response carries a delta PER own-table feature in `resources` (keyed by name). `patch`/`version` remain the
// ACCOUNT resource; a feature whose delta rides `resources` applies to its own sub-mirror + version.
export interface ResourceDelta {
	patch: AccountPatch; // the applier is generic over any object → it patches a run/inventory blob too
	version: number;
}

export interface MutationResponse {
	// The ACCOUNT delta. OPTIONAL: a mutation may write only own-table feature(s) and not touch the account
	// (a run node/start), in which case the account patch/version are omitted — not every mutation is an
	// account write. Account actions (levelup/cook/buy/…) always set them; a run node/end that settles rewards
	// sets them too.
	patch?: AccountPatch;
	version?: number;
	// Own-table features this mutation wrote (name → delta).
	resources?: Record<string, ResourceDelta>;
	// Own-table features this mutation REMOVED (dropped server-side, e.g. a run at terminal settle) — the
	// client clears each named sub-mirror. Distinct from a resources delta (which mutates in place).
	removedResources?: string[];
}

// An own-table feature's snapshot from GET /me: the full state + its version (for the mirror's gap detection).
export interface ResourceSnapshot {
	state: unknown; // the feature's client-projected document (game-shaped; the engine treats it opaquely)
	version: number;
}

export interface GetMeResponse {
	account: ClientAccountView;
	version: number;
	contentHash?: string;
	// Own-table features delivered AT LOGIN (name → snapshot), so the client holds the whole profile after one
	// /me — no per-feature follow-up read. Absent when the player has none (e.g. no active run).
	resources?: Record<string, ResourceSnapshot>;
}
