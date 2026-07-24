# @bishop/meta-contract

The **framework-free wire contract** shared by BOTH the server (`@bishop/meta-engine`) and the client
proxy (`@bishop/meta-client`). Engine scope (`@bishop/*`) — game-AGNOSTIC. Zero deps except `zod`.
Its package version is the **base/engine `apiVersion` axis** of the handshake (covers `/me`, the error
envelope, `AccountPatch`, the handshake itself). Game feature endpoints live in
`@recipe-raiders/meta-contract` and version on a SEPARATE `gameApiVersion` axis — this package only
defines the SLOT (`ClientVersions.gameApiVersion` + the header); the game supplies the number, and the
app's `ServerVersions` sets both. The two versions move independently; `checkVersion` gates each.

## What it holds (the whole client↔server surface)

- **`errors.ts`** — `ErrorCode` enum + `ERROR_SPEC` (the ONE code→{status,tier} map) + `httpStatusFor` /
  `shouldFlagAbuse`. Three tiers: ① plausible-reject (422), ② impossible/tampered (400 + abuse flag),
  ③ internal (500). The client branches on `code`, never the status number.
- **`patch.ts`** — `AccountPatch` ops `set/append/remove/inc` as Zod discriminated union + `z.infer`.
- **`apply-patch.ts`** — `applyPatch(state, patch)`: the **single** pure applier used by the server (to
  derive the new blob) AND the client mirror (to apply the delta). One source → they cannot drift.
- **`account.ts`** — `AccountBlob` (the SIX engine-owned sections) + `projectForClient` (strips `_server`).
- **`envelope.ts`** — `zActionRequest` (`{guid}` base), `MutationResponse` (`{patch,version,result}`),
  `GetMeResponse`.
- **`versions.ts`** — `API_VERSION`, `ClientVersions`, `VERSION_HEADERS`.

## DO

- Define every DTO as a **Zod schema with the TS type via `z.infer`** — one source is both the
  compile-time type and the runtime validator (no hand-written interface drifting from a validator).
- Add new error codes HERE with their `{status, tier}` in `ERROR_SPEC` (the map is exhaustive by type).
- Extend `zActionRequest` in a FEATURE's DTO (`zActionRequest.extend({...})`) — every mutating request
  shares the idempotency `guid`.
- Bump `API_VERSION` on any breaking wire change.

## DON'T

- **No framework / DB / `node:*` imports.** This must run in the browser client too. (`structuredClone`
  is a Web+Node global — fine; `node:crypto`/`node:zlib` are NOT allowed here — they live in the engine.)
- **No game-specific DTOs.** Those go in `@recipe-raiders/meta-contract` (depends on this). The engine
  never depends on the game contract.
- `AccountPatch` is **server OUTPUT only** — never accept it as client input / validate a client body into it.
- Don't add a 7th top-level blob section or fork the six kinds — the shared executor is built on exactly
  `resources / unlocks / items / profile / features / _server` (`schemaVersion` is the 7th key, the
  migration counter, not a data section).

## Session learnings

- `applyPatch` is **NOT RFC-6902 on purpose** — the mandatory `inc` op (delta-preserving, atomic-arithmetic,
  future `UPDATE … amount + n`) has no standard equivalent, so a JSON-Patch lib (`fast-json-patch`) can't
  replace it. See the `// ponytail:` note on `structuredClone` — full-clone-per-apply is the known perf
  ceiling; upgrade path is immer structural-sharing OR the jsonb→tall-table promotion, behind the same fn.
- `ItemInstance = { iid, configId, [key: string]: unknown }` — the engine owns ONLY `iid` (unique within
  the account; a tall table keys on composite `(player_id, iid)`) + `configId`; per-instance data is
  game-shaped + opaque (carried through `grantItem`'s `data`).
