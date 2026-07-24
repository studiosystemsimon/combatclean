import { type AccountPatch, applyPatch, type ClientAccountView } from "@bishop/meta-contract";

export type ApplyOutcome = "applied" | "noop" | "gap";

// The client's local mirror of the account. Applies a returned delta when it lines up with the last
// known version (Backend TDD ch.5); a version gap means an out-of-band write landed → the caller
// must full-re-read. Uses the SHARED applyPatch so the mirror can never drift from the server.
export class AccountMirror {
	private account: ClientAccountView | null = null;
	private lastVersion = -1;

	get state(): ClientAccountView | null {
		return this.account;
	}
	get version(): number {
		return this.lastVersion;
	}

	// Full slice from GET /me — resets the mirror.
	reset(account: ClientAccountView, version: number): void {
		this.account = account;
		this.lastVersion = version;
	}

	// Apply a mutation delta. Returns:
	//   "applied" — version == last+1, patch applied;
	//   "noop"    — version == last (a replayed/duplicate result already reflected);
	//   "gap"     — anything else (out-of-band write) → caller does a full re-read.
	applyDelta(patch: AccountPatch, version: number): ApplyOutcome {
		if (this.account === null) return "gap";
		if (version === this.lastVersion) return "noop";
		if (version === this.lastVersion + 1) {
			this.account = applyPatch(this.account, patch);
			this.lastVersion = version;
			return "applied";
		}
		return "gap";
	}
}

// The client's local mirror of ONE own-table feature (the active run today; a split-out inventory/resources
// tall table later) — its own table, its own CAS version, its own patch stream, but composed into the
// client's single `profile` document. Structurally identical to AccountMirror but generic over the feature's
// (game-shaped, engine-opaque) state; a feature can be absent (null = nothing, e.g. no active run) and become
// present via a full-state reset or a first patch. Uses the SAME shared applyPatch — cannot drift.
export class ResourceMirror<T extends object = Record<string, unknown>> {
	private value: T | null = null;
	private lastVersion = -1;

	get state(): T | null {
		return this.value;
	}
	get version(): number {
		return this.lastVersion;
	}

	// Full state (from GET /me, or a mutation that (re)sets the feature) — resets this feature's mirror.
	// A null state clears it (e.g. a run dropped at terminal settle).
	reset(state: T | null, version: number): void {
		this.value = state;
		this.lastVersion = version;
	}

	// Apply a mutation delta. Same version discipline as the account: applied on last+1, noop on a replay
	// (== last), gap otherwise → caller full-re-reads (GET /me rehydrates every feature atomically).
	applyDelta(patch: AccountPatch, version: number): ApplyOutcome {
		if (version === this.lastVersion) return "noop";
		if (version === this.lastVersion + 1) {
			// A patch can create the feature from nothing (first write) — start from an empty object.
			this.value = applyPatch((this.value ?? {}) as T, patch);
			this.lastVersion = version;
			return "applied";
		}
		return "gap";
	}
}
