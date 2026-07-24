import { z } from "zod";

// AccountPatch — the mechanical op list a Transaction emits (Backend TDD ch.6).
// The ONE representation shared by persistence, client delta, idempotency replay, audit.
// JSON-Patch-*shaped* (custom); `inc` is mandatory (atomic arithmetic + delta-preserving audit).
// `path` is "/"-separated into the account blob, e.g. "resources/5000", "features/battlepass/xp".
// SERVER OUTPUT only — never accepted as client input.

const zPath = z.string().min(1);

export const zSetOp = z.object({ op: z.literal("set"), path: zPath, value: z.unknown() });
export const zAppendOp = z.object({ op: z.literal("append"), path: zPath, entry: z.unknown() });
export const zRemoveOp = z.object({
	op: z.literal("remove"),
	path: zPath,
	id: z.union([z.string(), z.number()]),
});
export const zIncOp = z.object({ op: z.literal("inc"), path: zPath, amount: z.number() });

export const zPatchOp = z.discriminatedUnion("op", [zSetOp, zAppendOp, zRemoveOp, zIncOp]);
export const zAccountPatch = z.array(zPatchOp);

export type SetOp = z.infer<typeof zSetOp>;
export type AppendOp = z.infer<typeof zAppendOp>;
export type RemoveOp = z.infer<typeof zRemoveOp>;
export type IncOp = z.infer<typeof zIncOp>;
export type PatchOp = z.infer<typeof zPatchOp>;
export type AccountPatch = z.infer<typeof zAccountPatch>;
