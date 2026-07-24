# @bishop/meta-client

The **thin, framework-free client REST proxy** for the meta server (D-53). Engine scope (`@bishop/*`) —
game-AGNOSTIC. It hides the API behind a small async surface; a game extends it from the OUTSIDE by
wrapping `action()` with named methods. Only dep: `@bishop/meta-contract`.

## What it holds

- **`MetaClient`** — `getMe()` (full slice → resets the mirror) and `action(path, body?, guid?)` (calls
  ONE specific endpoint). Attaches the JWT, stamps the idempotency guid, applies the returned delta.
- **`AccountMirror`** — the local account copy. `applyDelta(patch, version)` applies when `version ==
  last+1`, is a no-op on a replay (`== last`), else returns `"gap"` → caller full-re-reads. Uses the
  contract's shared `applyPatch` so the mirror can never drift from the server.
- **`IAuthProvider`** — a PORT: `getToken` / `refresh` / `relogin`. The host wires a Fortis-backed impl.
- **`Transport`** — a PORT: the HTTP boundary. A rejected promise = network fault (safe to retry the
  same guid); a resolved 4xx = a server verdict (`ClientError`, not retried).

## Principles (Backend TDD ch.5/ch.7)

- One request at a time; **one idempotency guid per action**. A lost ack (network fault) retries ONCE
  with the SAME guid → the server replays the stored result.
- Apply the delta on `version == last+1`; a **version gap → full re-read** (`GET /me`), skip the patch.
- The account `version` is a **server-internal CAS counter** — the client never sends it, there is no
  client-facing 409.
- `TOKEN_EXPIRED` → `auth.refresh()` → retry once; `TOKEN_INVALID` → never retry; refresh fails →
  `auth.relogin()` (hard relogin). Token refresh is entirely client-SDK-side.

## DO

- Extend for a game by WRAPPING `action()`: `buyOffer(id) => this.action(\`/offers/\${id}/buy\`)`.
- Wire `IAuthProvider` over `@fortis/sdk-client` and `Transport` over `fetch` in the HOST, not here.
- Reuse `applyPatch` from `@bishop/meta-contract` — it is the single shared applier.

## DON'T

- **No framework deps** — no React / firebase / `@fortis/sdk-client` here. Those belong in the host's
  auth adapter (kept behind the `IAuthProvider` port so this stays a pure, testable lib).
- Never send the account `version` (server-internal CAS).
- Never reimplement patch application — always go through the contract's `applyPatch`.
- Don't build a generic "send any mutation" method — mirror the server: one method per specific action.

## Session learnings

- Auth + transport are **ports** specifically so the React/firebase Fortis SDK stays OUT of this
  agnostic lib; the host supplies the concrete adapters.
- The mirror deliberately reuses the server's `applyPatch`, so a returned delta applied client-side
  yields byte-identical state to the server's write — no second, drift-prone applier.
