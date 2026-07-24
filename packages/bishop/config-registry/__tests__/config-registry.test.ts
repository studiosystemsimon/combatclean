import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	ALL_MEMBERS_TOKEN,
	assertValidMerged,
	buildInspectContext,
	buildRefIndex,
	collectRefs,
	configRecord,
	configRef,
	expand,
	findRefs,
	getTagValue,
	inLane,
	lintRefNaming,
	type Manifest,
	nextId,
	resolveRefOrAll,
	stringConfigRef,
	stringConfigRefOrAll,
	validateMerged,
	zConfig,
	zKeyConfig,
} from "../src/index.js";
import { isIdCategory } from "../src/manifest.js";

// A tiny game to exercise the engine: two id-kind categories (enemies ref abilities + a drop table),
// one key-kind category (elements, keyed by "element"), and a cross-kind string ref.
// Deliberately NON-strict schemas — the ENGINE enforces strict top-level keys (schema is the SSOT of
// allowed fields), so authors don't have to remember `.strict()` on every schema.
const zAbility = zConfig;
const zEnemy = zConfig.extend({
	abilityConfigIds: z.array(configRef("abilities")),
	dropTableConfigId: configRef("dropTables").optional(),
	elementConfigId: stringConfigRef("elements", "key").optional(),
});
const zDropTable = zConfig;
const zElement = zKeyConfig; // key-kind, identity in the "key" field (the zKeyConfig contract)

const manifest: Manifest = [
	{ kind: "id", name: "abilities", folder: "abilities", schema: zAbility, idRange: [1, 99] },
	{ kind: "id", name: "enemies", folder: "enemies", schema: zEnemy, idRange: [100, 199] },
	{ kind: "id", name: "dropTables", folder: "drop-tables", schema: zDropTable, idRange: [9000, 9099] },
	{ kind: "key", name: "elements", folder: "elements", schema: zElement, keyField: "key" },
];

const goodMerged = () => ({
	abilities: [{ id: 1, displayName: "Slash" }],
	enemies: [
		{ id: 100, displayName: "Slime", abilityConfigIds: [1], dropTableConfigId: 9000, elementConfigId: "fire" },
	],
	dropTables: [{ id: 9000, displayName: "Slime loot" }],
	elements: [{ key: "fire" }],
});

describe("ref index from Zod meta", () => {
	it("derives ref fields + targets from configRef()/stringConfigRef() metadata", () => {
		const index = buildRefIndex(manifest);
		expect(index.numeric.get("abilityConfigIds")).toEqual(["abilities"]);
		expect(index.numeric.get("dropTableConfigId")).toEqual(["dropTables"]);
		expect(index.string.get("elementConfigId")).toEqual({ targets: ["elements"], keyField: "key" });
	});
});

describe("validateMerged", () => {
	it("passes a well-formed catalog", () => {
		expect(validateMerged(goodMerged(), manifest).errors).toEqual([]);
	});

	it("catches an unknown top-level key (engine-enforced strict, even on non-strict schemas)", () => {
		const m = goodMerged();
		(m.enemies[0] as Record<string, unknown>).bogus = 1;
		expect(validateMerged(m, manifest).errors.join("\n")).toMatch(/unknown field "bogus"/);
	});

	it("catches a dangling numeric ref", () => {
		const m = goodMerged();
		m.enemies[0].abilityConfigIds = [42];
		expect(validateMerged(m, manifest).errors.join("\n")).toMatch(/abilityConfigIds=42/);
	});

	it("catches a dangling string ref", () => {
		const m = goodMerged();
		m.enemies[0].elementConfigId = "lava";
		expect(validateMerged(m, manifest).errors.join("\n")).toMatch(/elementConfigId="lava"/);
	});

	it("catches a globally duplicate id and an out-of-lane id", () => {
		const m = goodMerged();
		m.abilities.push({ id: 100, displayName: "Clash" }); // dup with enemy 100 + out of lane
		const errs = validateMerged(m, manifest).errors.join("\n");
		expect(errs).toMatch(/globally duplicate id/);
		expect(errs).toMatch(/out of lane/);
	});
});

describe("expand / findRefs", () => {
	it("inlines outgoing refs with _meta", () => {
		const m = goodMerged();
		const index = buildRefIndex(manifest);
		const ctx = buildInspectContext(m, manifest, index);
		const tree = expand(100, ctx);
		expect(tree.abilityConfigIds[0].displayName).toBe("Slash");
		expect(tree.abilityConfigIds[0]._meta).toEqual({ id: 1, category: "abilities", file: null });
		expect(tree.dropTableConfigId.displayName).toBe("Slime loot");
	});

	it("reverse-walks who references an id", () => {
		const m = goodMerged();
		const index = buildRefIndex(manifest);
		const ctx = buildInspectContext(m, manifest, index);
		const hits = findRefs(1, ctx);
		expect(hits).toHaveLength(1);
		expect(hits[0]).toMatchObject({ fromId: 100, category: "enemies", keys: ["abilityConfigIds"] });
	});
});

describe("allocation (never-reuse, monotonic)", () => {
	const enemies = manifest.find((c) => c.name === "enemies");
	it("allocates max+1 within the lane, respecting the ledger high-water", () => {
		if (!enemies || !isIdCategory(enemies)) throw new Error("test setup");
		expect(nextId(enemies, [100, 101], undefined)).toBe(102);
		// deleting 101 must NOT free it — ledger high-water 101 keeps the next at 102.
		expect(nextId(enemies, [100], 101)).toBe(102);
	});
	it("clamps to the lane and throws when exhausted", () => {
		if (!enemies || !isIdCategory(enemies)) throw new Error("test setup");
		expect(() => nextId(enemies, [199], 199)).toThrow(/exhausted/);
	});
});

describe("lintRefNaming + inLane", () => {
	it("passes when every ref field is *ConfigId(s)", () => {
		expect(lintRefNaming(manifest)).toEqual([]);
	});
	it("flags a misnamed ref field", () => {
		const bad: Manifest = [
			{ kind: "id", name: "abilities", folder: "abilities", schema: zConfig.strict(), idRange: [1, 99] },
			{
				kind: "id",
				name: "enemies",
				folder: "enemies",
				schema: zConfig.extend({ ability: configRef("abilities") }).strict(),
				idRange: [100, 199],
			},
		];
		expect(lintRefNaming(bad).join("\n")).toMatch(/"ability" must be named/);
	});
	it("inLane honors extraIds", () => {
		const cat = { kind: "id" as const, name: "x", folder: "x", schema: zConfig, idRange: [1, 9] as [number, number], extraIds: [999] };
		expect(inLane(cat, 5)).toBe(true);
		expect(inLane(cat, 999)).toBe(true);
		expect(inLane(cat, 50)).toBe(false);
	});
});

describe("assertValidMerged", () => {
	it("throws with a readable summary", () => {
		const m = goodMerged();
		m.enemies[0].abilityConfigIds = [42];
		expect(() => assertValidMerged(m, manifest)).toThrow(/validation failed/);
	});
});

// A tiny game exercising the two ref-vocabulary features: record-KEY refs (configRecord) and the
// category wildcard (stringConfigRefOrAll). rarities + slots are key-kind categories.
const zLoot = zConfig.extend({
	// map KEYS are rarities refs; values are weights
	rarityWeights: configRecord("rarities", "key", z.number()),
	// each element is a slots key OR the "*" wildcard = all slots
	kinds: z.array(stringConfigRefOrAll("slots", "key")),
});
const refVocabManifest: Manifest = [
	{ kind: "key", name: "rarities", folder: "rarities", schema: zKeyConfig, keyField: "key" },
	{ kind: "key", name: "slots", folder: "slots", schema: zKeyConfig, keyField: "key" },
	{ kind: "id", name: "loot", folder: "loot", schema: zLoot, idRange: [1, 99] },
];
const lootMerged = () => ({
	rarities: [{ key: "common" }, { key: "rare" }],
	slots: [{ key: "head" }, { key: "chest" }],
	loot: [{ id: 1, displayName: "L", rarityWeights: { common: 10, rare: 5 }, kinds: ["head", "chest"] }],
});

describe("record-KEY refs (configRecord — G1)", () => {
	it("indexes the record's key-ref target + keyField", () => {
		const index = buildRefIndex(refVocabManifest);
		expect(index.recordKey.get("rarityWeights")).toEqual({ targets: ["rarities"], keyField: "key" });
	});
	it("collectRefs emits each record KEY as a string ref carrying its keyField", () => {
		const index = buildRefIndex(refVocabManifest);
		const { string } = collectRefs(lootMerged().loot[0], index);
		expect(string).toEqual(
			expect.arrayContaining([
				{ key: "rarityWeights", value: "common", targets: ["rarities"], keyField: "key" },
				{ key: "rarityWeights", value: "rare", targets: ["rarities"], keyField: "key" },
			]),
		);
	});
	it("passes when every record key resolves", () => {
		expect(validateMerged(lootMerged(), refVocabManifest).errors).toEqual([]);
	});
	it("flags a dangling record KEY (the former runtime-only / silent gap)", () => {
		const m = lootMerged();
		(m.loot[0].rarityWeights as Record<string, number>).bogus = 3;
		const errs = validateMerged(m, refVocabManifest).errors.join("\n");
		expect(errs).toMatch(/rarityWeights="bogus"/);
		expect(errs).toMatch(/no rarities with key "bogus"/);
	});
});

describe("category wildcard (stringConfigRefOrAll — G2)", () => {
	it("marks the field allowAll in the index", () => {
		const index = buildRefIndex(refVocabManifest);
		expect(index.string.get("kinds")).toEqual({ targets: ["slots"], keyField: "key", allowAll: true });
	});
	it("accepts the '*' wildcard token without flagging it dangling", () => {
		const m = lootMerged();
		m.loot[0].kinds = ["*"];
		expect(validateMerged(m, refVocabManifest).errors).toEqual([]);
	});
	it("accepts a mix of real keys and the wildcard", () => {
		const m = lootMerged();
		m.loot[0].kinds = ["head", "*"];
		expect(validateMerged(m, refVocabManifest).errors).toEqual([]);
	});
	it("still flags a real dangling key alongside the wildcard support", () => {
		const m = lootMerged();
		m.loot[0].kinds = ["bogus"];
		expect(validateMerged(m, refVocabManifest).errors.join("\n")).toMatch(/kinds="bogus"/);
	});
	it("collectRefs skips the wildcard token (not a ref to resolve)", () => {
		const index = buildRefIndex(refVocabManifest);
		const { string } = collectRefs({ id: 1, displayName: "L", rarityWeights: {}, kinds: ["*", "head"] }, index);
		const kindsRefs = string.filter((r) => r.key === "kinds").map((r) => r.value);
		expect(kindsRefs).toEqual(["head"]);
	});
	it("resolveRefOrAll expands the wildcard to all members, else the literal list", () => {
		const all = ["head", "chest", "legs"];
		expect(resolveRefOrAll([ALL_MEMBERS_TOKEN], all)).toEqual(all);
		expect(resolveRefOrAll(["head", "chest"], all)).toEqual(["head", "chest"]);
		expect(resolveRefOrAll("head", all)).toEqual(["head"]);
		expect(resolveRefOrAll(null, all)).toEqual([]);
	});
});

describe("tags (UI/design grouping — record<string,string>)", () => {
	it("accepts a key→value tags map", () => {
		const m = goodMerged();
		(m.abilities[0] as Record<string, unknown>).tags = { category: "basic", theme: "fire" };
		expect(validateMerged(m, manifest).errors).toEqual([]);
	});
	it("rejects the legacy array-of-strings tags shape", () => {
		const m = goodMerged();
		(m.abilities[0] as Record<string, unknown>).tags = ["category:basic"];
		expect(validateMerged(m, manifest).errors.join("\n")).toMatch(/tags/);
	});
	it("getTagValue reads a value by key from the map", () => {
		expect(getTagValue({ category: "basic" }, "category")).toBe("basic");
		expect(getTagValue({ category: "basic" }, "missing")).toBeUndefined();
		expect(getTagValue(undefined, "category")).toBeUndefined();
	});
});

describe("deep-strict (unknown keys at any depth)", () => {
	// Non-strict schemas with a nested object, a discriminated union, a z.record, and an opaque z.custom.
	const zWidget = zConfig.extend({
		body: z.object({ hp: z.number() }), // nested closed object
		cast: z.discriminatedUnion("kind", [
			z.object({ kind: z.literal("melee"), reach: z.number() }),
			z.object({ kind: z.literal("ranged"), speed: z.number() }),
		]),
		stats: z.record(z.string(), z.number()), // dynamic keys allowed
		opaque: z.custom<{ anything: unknown }>().optional(), // interior not validated
	});
	const m: Manifest = [{ kind: "id", name: "widgets", folder: "widgets", schema: zWidget, idRange: [1, 99] }];
	const good = () => ({
		widgets: [
			{ id: 1, displayName: "W", body: { hp: 1 }, cast: { kind: "melee", reach: 2 }, stats: { a: 1 }, opaque: { anything: { x: 1 } } },
		],
	});

	it("rejects a nested unknown key", () => {
		const c = good();
		(c.widgets[0].body as Record<string, unknown>).bogus = 1;
		expect(validateMerged(c, m).errors.join("\n")).toMatch(/unknown field "body\.bogus"/);
	});
	it("rejects an unknown key inside the matched union branch", () => {
		const c = good();
		(c.widgets[0].cast as Record<string, unknown>).bogus = 1;
		expect(validateMerged(c, m).errors.join("\n")).toMatch(/unknown field "cast\.bogus"/);
	});
	it("allows dynamic keys in a z.record", () => {
		const c = good();
		(c.widgets[0].stats as Record<string, number>).anythingGoes = 5;
		expect(validateMerged(c, m).errors).toEqual([]);
	});
	it("skips the interior of an opaque z.custom", () => {
		const c = good();
		(c.widgets[0].opaque as Record<string, unknown>).whatever = 1;
		expect(validateMerged(c, m).errors).toEqual([]);
	});
	it("passes a clean nested catalog", () => {
		expect(validateMerged(good(), m).errors).toEqual([]);
	});
});
