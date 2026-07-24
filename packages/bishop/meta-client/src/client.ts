import { ErrorCode, type GetMeResponse, type MutationResponse } from "@bishop/meta-contract";
import type { IAuthProvider } from "./auth.js";
import { AccountMirror, ResourceMirror } from "./mirror.js";
import { ClientError, type Transport, type WireRequest, type WireResponse } from "./transport.js";

// A request before the auth token is attached (send() adds it per attempt).
type PendingRequest = Omit<WireRequest, "token">;

export interface MetaClientOptions {
	transport: Transport;
	auth: IAuthProvider;
	genGuid?: () => string;
}

// The thin async REST client proxy (Backend TDD ch.5/ch.7). Hides the API from the game: attaches the
// JWT, stamps one idempotency guid per intent, applies the returned delta to a local mirror (or full
// re-reads on a version gap), and does the TOKEN_EXPIRED → refresh-once dance.
export class MetaClient {
	readonly mirror = new AccountMirror();
	// Own-table feature mirrors (the active run today; a split-out inventory/resources tall table later) —
	// each its own server table + version, but composed into ONE client `profile` document. Created lazily on
	// first sight (GET /me snapshot or a mutation delta). The game reads `profile` / `resource(name)` — it
	// never learns which feature is which DB table.
	private readonly resources = new Map<string, ResourceMirror>();
	private readonly transport: Transport;
	private readonly auth: IAuthProvider;
	private readonly genGuid: () => string;

	constructor(opts: MetaClientOptions) {
		this.transport = opts.transport;
		this.auth = opts.auth;
		this.genGuid = opts.genGuid ?? (() => crypto.randomUUID());
	}

	/** One own-table feature's mirror (null state when absent). Lazily created. */
	resource(name: string): ResourceMirror {
		let m = this.resources.get(name);
		if (!m) {
			m = new ResourceMirror();
			this.resources.set(name, m);
		}
		return m;
	}

	/** The unified profile document: the account sections + every own-table feature's state, as ONE object.
	 *  The game reads this; it does not care that a feature lives in its own table. Null before login. */
	get profile(): Record<string, unknown> | null {
		const account = this.mirror.state;
		if (account === null) return null;
		const out: Record<string, unknown> = { ...account };
		for (const [name, m] of this.resources) out[name] = m.state;
		return out;
	}

	async getMe(): Promise<GetMeResponse> {
		const res = await this.send({ method: "GET", path: "/me" });
		const me = res.body as GetMeResponse;
		this.mirror.reset(me.account, me.version);
		// Rehydrate every own-table feature; one the player no longer has (omitted) resets to null.
		const snapshots = me.resources ?? {};
		for (const [name, snap] of Object.entries(snapshots))
			this.resource(name).reset(snap.state as Record<string, unknown> | null, snap.version);
		for (const [name, m] of this.resources)
			if (!(name in snapshots)) m.reset(null, m.version);
		return me;
	}

	// Calls ONE specific action endpoint (the game wraps this: `buyOffer(id)` → action(`/offers/${id}/buy`)).
	// Stamps the idempotency guid; a lost ack (network fault) retries ONCE with the SAME guid → the
	// server replays the stored result. On a version gap the mirror can't apply the delta → full re-read.
	async action(
		path: string,
		body: Record<string, unknown> = {},
		guid: string = this.genGuid(),
	): Promise<MutationResponse> {
		const req: PendingRequest = { method: "POST", path, body: { guid, ...body } };
		const res = await this.sendWithNetworkRetry(req);
		const mut = res.body as MutationResponse;
		// Apply the account delta (when present — a run node/start writes no account) + any own-table feature
		// deltas (a mutation can write more than one — a run node/end settles the run AND banks to the account)
		// + clear any removed features (a run dropped at terminal settle). A gap on ANY stream → full re-read
		// (GET /me rehydrates every feature atomically), so we never apply the rest onto a stale base.
		let gap = false;
		if (mut.patch !== undefined && mut.version !== undefined)
			gap = this.mirror.applyDelta(mut.patch, mut.version) === "gap";
		for (const [name, delta] of Object.entries(mut.resources ?? {}))
			if (this.resource(name).applyDelta(delta.patch, delta.version) === "gap") gap = true;
		for (const name of mut.removedResources ?? []) this.resource(name).reset(null, -1);
		if (gap) await this.getMe();
		return mut;
	}

	private async sendWithNetworkRetry(req: PendingRequest): Promise<WireResponse> {
		try {
			return await this.send(req);
		} catch (err) {
			// A server verdict (ClientError) is NOT retried; a network fault is safe to retry (same guid).
			if (err instanceof ClientError) throw err;
			return this.send(req);
		}
	}

	private async send(req: PendingRequest): Promise<WireResponse> {
		const token = await this.auth.getToken();
		let res = await this.transport({ ...req, token });

		if (res.status === 401 && codeOf(res) === ErrorCode.TOKEN_EXPIRED) {
			let fresh: string;
			try {
				fresh = await this.auth.refresh();
			} catch {
				await this.auth.relogin();
				throw new ClientError(ErrorCode.TOKEN_EXPIRED, "refresh failed", 401);
			}
			res = await this.transport({ ...req, token: fresh });
		}

		if (res.status >= 400) {
			throw new ClientError(codeOf(res) ?? ErrorCode.INTERNAL, messageOf(res), res.status);
		}
		return res;
	}
}

function codeOf(res: WireResponse): string | undefined {
	return (res.body as { code?: string } | null)?.code;
}
function messageOf(res: WireResponse): string {
	return (res.body as { message?: string } | null)?.message ?? `HTTP ${res.status}`;
}
