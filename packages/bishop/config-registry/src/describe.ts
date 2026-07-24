import { z } from "zod";
import { CONFIG_REF_META, RECORD_KEY_REF_META, STRING_REF_META } from "./base.js";

/**
 * Schema → format-info. The one game-AGNOSTIC place that turns a Zod object schema into a flat,
 * agent-readable field table (name / type / optional / description / ref target). It reads the
 * SAME `z.toJSONSchema` output the ref index does, so a field's declared reference target
 * (configRef/stringConfigRef) surfaces right next to its type. Works on ANY Zod object schema —
 * config categories, the visual-config (VSM) schema, and per-type asset schemas all use it, so the
 * three scaffold registries print an identical `fields` contract.
 */

// biome-ignore lint/suspicious/noExplicitAny: JSON-schema nodes are untyped by construction.
type JsonNode = Record<string, any>;

export interface FieldInfo {
	name: string;
	/** Rendered type: a scalar ("string"/"number"/…), a quoted enum union, "union", or "any". */
	type: string;
	optional: boolean;
	description?: string;
	/** Declared reference target category/categories, if this field is a configRef/stringConfigRef. */
	refTarget?: string[];
}

/** Turn a Zod object schema into a flat list of its top-level fields with types + docs + ref targets. */
export function describeSchema(schema: z.ZodType): FieldInfo[] {
	const json = z.toJSONSchema(schema, { unrepresentable: "any", io: "input" }) as JsonNode;
	const props: Record<string, JsonNode> = json.properties ?? {};
	const required = new Set<string>(json.required ?? []);
	const out: FieldInfo[] = [];
	for (const [name, d] of Object.entries(props)) {
		// configRef (numeric) / stringConfigRef (value) / configRecord (map KEYS) all surface their target.
		const refRaw = d[CONFIG_REF_META] ?? d[STRING_REF_META]?.target ?? d[RECORD_KEY_REF_META]?.target;
		out.push({
			name,
			type: d.enum
				? d.enum.map((e: unknown) => `"${e}"`).join("|")
				: (d.type ?? (d.anyOf ? "union" : "any")),
			optional: !required.has(name),
			description: d.description,
			refTarget: refRaw != null ? ([] as string[]).concat(refRaw) : undefined,
		});
	}
	return out;
}

/** Pretty one-field-per-line table (the agent/human authoring contract). */
export function formatFields(schema: z.ZodType, title?: string): string {
	const fields = describeSchema(schema);
	const lines = title ? [`  fields (${title}):`] : ["  fields:"];
	for (const f of fields) {
		const opt = f.optional ? "?" : " ";
		const ref = f.refTarget ? ` →${f.refTarget.join("/")}` : "";
		lines.push(`    ${f.name}${opt}: ${`${f.type}${ref}`.padEnd(24)} ${f.description ?? ""}`.trimEnd());
	}
	return lines.join("\n");
}
