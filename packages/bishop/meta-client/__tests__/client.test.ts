import { describe, expect, it, vi } from "vitest";
import type { IAuthProvider } from "../src/auth.js";
import { MetaClient } from "../src/client.js";
import { ClientError, type Transport, type WireResponse } from "../src/transport.js";

function auth(over: Partial<IAuthProvider> = {}): IAuthProvider {
	return {
		getToken: async () => "tok",
		refresh: async () => "fresh",
		relogin: async () => {},
		...over,
	};
}

const meBody = (version: number, resources: Record<string, number> = {}) => ({
	account: { schemaVersion: 1, resources, unlocks: [], items: [], profile: {}, features: {} },
	version,
});

const ok = (body: unknown, status = 200): WireResponse => ({ status, body });

describe("MetaClient.getMe", () => {
	it("resets the mirror from the full slice", async () => {
		const transport: Transport = vi.fn(async () => ok(meBody(3, { "5000": 10 })));
		const client = new MetaClient({ transport, auth: auth() });
		const me = await client.getMe();
		expect(me.version).toBe(3);
		expect(client.mirror.version).toBe(3);
		expect(client.mirror.state?.resources["5000"]).toBe(10);
	});
});

describe("MetaClient.action", () => {
	it("applies the delta when version == last+1", async () => {
		const transport = vi
			.fn<Transport>()
			.mockResolvedValueOnce(ok(meBody(0)))
			.mockResolvedValueOnce(ok({ patch: [{ op: "inc", path: "resources/5000", amount: 500 }], version: 1 }, 201));
		const client = new MetaClient({ transport, auth: auth() });
		await client.getMe();
		await client.action("/example/grant");
		expect(client.mirror.version).toBe(1);
		expect(client.mirror.state?.resources["5000"]).toBe(500);
	});

	it("full re-reads on a version gap instead of applying", async () => {
		const transport = vi
			.fn<Transport>()
			.mockResolvedValueOnce(ok(meBody(0))) // initial getMe
			.mockResolvedValueOnce(ok({ patch: [], version: 5 }, 201)) // mutate returns a gap
			.mockResolvedValueOnce(ok(meBody(5, { "5000": 999 }))); // re-read
		const client = new MetaClient({ transport, auth: auth() });
		await client.getMe();
		await client.action("/example/noop");
		expect(transport).toHaveBeenCalledTimes(3); // getMe + mutate + re-read
		expect(client.mirror.version).toBe(5);
		expect(client.mirror.state?.resources["5000"]).toBe(999);
	});

	it("retries once with the SAME guid on a network fault (lost ack)", async () => {
		const seenGuids: string[] = [];
		const transport = vi.fn<Transport>(async (req) => {
			if (req.method === "POST") {
				seenGuids.push((req.body as { guid: string }).guid);
				if (seenGuids.length === 1) throw new Error("network reset"); // lost ack
			}
			return ok({ patch: [], version: 1 }, 201);
		});
		const client = new MetaClient({ transport, auth: auth(), genGuid: () => "fixed-guid" });
		await client.action("/example/noop");
		expect(seenGuids).toEqual(["fixed-guid", "fixed-guid"]);
	});
});

describe("MetaClient unified profile (own-table features)", () => {
	// /me delivers own-table features (the active run) alongside the account → the client holds the whole
	// profile after one login, no per-feature follow-up read. `profile` composes them into ONE document.
	it("hydrates own-table features from /me and composes them into one profile document", async () => {
		const me = {
			...meBody(2, { "5000": 10 }),
			resources: { activeRun: { state: { runToken: "t1", player: { hp: 80 } }, version: 5 } },
		};
		const transport: Transport = vi.fn(async () => ok(me));
		const client = new MetaClient({ transport, auth: auth() });
		await client.getMe();
		expect(client.resource("activeRun").version).toBe(5);
		const profile = client.profile as { resources: Record<string, number>; activeRun: { runToken: string } };
		expect(profile.resources["5000"]).toBe(10); // account section
		expect(profile.activeRun.runToken).toBe("t1"); // own-table feature — same document
	});

	// A mutation can write the account AND an own-table feature in one response (a run node/end settles the
	// run + banks rewards). Each delta applies to its own mirror + version.
	it("applies a per-feature delta from a mutation (account + run in one response)", async () => {
		const me = {
			...meBody(0),
			resources: { activeRun: { state: { player: { hp: 80 } }, version: 0 } },
		};
		const transport = vi
			.fn<Transport>()
			.mockResolvedValueOnce(ok(me))
			.mockResolvedValueOnce(
				ok(
					{
						patch: [{ op: "inc", path: "resources/5000", amount: 20 }],
						version: 1,
						resources: { activeRun: { patch: [{ op: "set", path: "player/hp", value: 55 }], version: 1 } },
					},
					201,
				),
			);
		const client = new MetaClient({ transport, auth: auth() });
		await client.getMe();
		await client.action("/run/node/end");
		expect(client.mirror.state?.resources["5000"]).toBe(20); // account banked
		expect((client.resource("activeRun").state as { player: { hp: number } }).player.hp).toBe(55); // run patched
		expect(client.resource("activeRun").version).toBe(1);
	});

	// A version gap on ANY stream → full re-read (never apply onto a stale base).
	it("full re-reads when an own-table feature delta gaps", async () => {
		const me = { ...meBody(0), resources: { activeRun: { state: { x: 1 }, version: 0 } } };
		const transport = vi
			.fn<Transport>()
			.mockResolvedValueOnce(ok(me))
			.mockResolvedValueOnce(ok({ patch: [], version: 1, resources: { activeRun: { patch: [], version: 9 } } }, 201))
			.mockResolvedValueOnce(ok({ ...meBody(1), resources: { activeRun: { state: { x: 42 }, version: 9 } } }));
		const client = new MetaClient({ transport, auth: auth() });
		await client.getMe();
		await client.action("/run/node/start");
		expect(transport).toHaveBeenCalledTimes(3); // getMe + mutate + re-read
		expect((client.resource("activeRun").state as { x: number }).x).toBe(42);
	});

	// A dropped run (terminal settle): /me omits the feature → its mirror clears to null.
	it("clears an own-table feature when a later /me omits it (run dropped)", async () => {
		const transport = vi
			.fn<Transport>()
			.mockResolvedValueOnce(ok({ ...meBody(0), resources: { activeRun: { state: { x: 1 }, version: 0 } } }))
			.mockResolvedValueOnce(ok(meBody(1))); // no resources → run gone
		const client = new MetaClient({ transport, auth: auth() });
		await client.getMe();
		expect(client.resource("activeRun").state).not.toBeNull();
		await client.getMe();
		expect(client.resource("activeRun").state).toBeNull();
	});
});

describe("MetaClient auth handling", () => {
	it("refreshes once on TOKEN_EXPIRED and retries with the fresh token", async () => {
		const refresh = vi.fn(async () => "fresh");
		const tokens: string[] = [];
		const transport = vi.fn<Transport>(async (req) => {
			tokens.push(req.token);
			return tokens.length === 1
				? ok({ code: "TOKEN_EXPIRED" }, 401)
				: ok(meBody(0));
		});
		const client = new MetaClient({ transport, auth: auth({ refresh }) });
		await client.getMe();
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(tokens).toEqual(["tok", "fresh"]);
	});

	it("never retries TOKEN_INVALID", async () => {
		const refresh = vi.fn(async () => "fresh");
		const transport = vi.fn<Transport>(async () => ok({ code: "TOKEN_INVALID" }, 401));
		const client = new MetaClient({ transport, auth: auth({ refresh }) });
		await expect(client.getMe()).rejects.toBeInstanceOf(ClientError);
		expect(refresh).not.toHaveBeenCalled();
	});

	it("hard-relogins when refresh itself fails", async () => {
		const relogin = vi.fn(async () => {});
		const transport = vi.fn<Transport>(async () => ok({ code: "TOKEN_EXPIRED" }, 401));
		const client = new MetaClient({
			transport,
			auth: auth({
				refresh: async () => {
					throw new Error("refresh token expired");
				},
				relogin,
			}),
		});
		await expect(client.getMe()).rejects.toBeInstanceOf(ClientError);
		expect(relogin).toHaveBeenCalledTimes(1);
	});
});
