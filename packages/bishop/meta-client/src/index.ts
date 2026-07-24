// @bishop/meta-client — the thin, framework-free client REST proxy for the meta server.
export { MetaClient, type MetaClientOptions } from "./client.js";
export { AccountMirror, ResourceMirror, type ApplyOutcome } from "./mirror.js";
export type { IAuthProvider } from "./auth.js";
export {
	ClientError,
	type Transport,
	type WireRequest,
	type WireResponse,
} from "./transport.js";
