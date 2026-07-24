// @bishop/meta-contract — framework-free client↔server wire contract.
// Imported by BOTH the engine (server) and the client REST proxy. The @bishop/meta-contract version
// IS the apiVersion axis (Backend TDD ch.2/ch.10).

export {
	ErrorCode,
	ERROR_SPEC,
	type ErrorTier,
	type ErrorBody,
	httpStatusFor,
	shouldFlagAbuse,
} from "./errors.js";
export {
	zPatchOp,
	zAccountPatch,
	zSetOp,
	zAppendOp,
	zRemoveOp,
	zIncOp,
	type PatchOp,
	type SetOp,
	type AppendOp,
	type RemoveOp,
	type IncOp,
	type AccountPatch,
} from "./patch.js";
export { applyPatch } from "./apply-patch.js";
export { diffToPatch, deepEqual } from "./diff.js";
export {
	type AccountBlob,
	type ClientAccountView,
	type AccountRecord,
	type ItemInstance,
	type ServerSection,
	CLIENT_SECTIONS,
	projectForClient,
} from "./account.js";
export {
	zActionRequest,
	type ActionRequest,
	type MutationResponse,
	type ResourceDelta,
	type ResourceSnapshot,
	type GetMeResponse,
} from "./envelope.js";
export { API_VERSION, VERSION_HEADERS, type ClientVersions } from "./versions.js";
export { type InboxReward, type InboxRewardLine, type InboxMessage } from "./inbox.js";
