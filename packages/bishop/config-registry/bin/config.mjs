#!/usr/bin/env node
// Generic logical-config CLI — driven entirely by an injected game manifest. Same create/validate code
// the build + editor run ("fails here ⇒ fails there").
//
//   config-registry --manifest <module> --game-dir <path> <command> [args]
//
//   (no cmd) | list                 categories: counts + next id + lane
//   list <category>                 every entry: id/key + displayName + tags
//   expand <id>                     entity with its refs inlined (+ _meta)
//   refs <id>                       every entity that references <id>
//   fields <category>               each field's type + description (from the Zod schema)
//   validate                        FATAL-validate the whole catalog (schema + refs + ids); exit non-zero on error
//   lint                            check *ConfigId naming ↔ configRef() metadata
//   create <category> [--name "…"] [--set field=value …]
//
// The --manifest module must export `CATEGORIES` (the manifest array); it may export `gameDir` as a default.
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
	assertValidMerged,
	buildInspectContext,
	buildRefIndex,
	expand,
	findRefs,
	isIdCategory,
	lintRefNaming,
	nextIds,
	validateMerged,
} from "../dist/index.js";
import { createEntity, loadContext, readLedger, scanConfigDir, writeEntity } from "../dist/node.js";

const args = process.argv.slice(2);
let manifestMod;
let gameDir;
const rest = [];
const flags = { name: undefined, forId: undefined, sets: {} };
for (let i = 0; i < args.length; i++) {
	const a = args[i];
	if (a === "--manifest") manifestMod = args[++i];
	else if (a === "--game-dir") gameDir = args[++i];
	else if (a === "--name") flags.name = args[++i];
	else if (a === "--for") flags.forId = args[++i];
	else if (a === "--set") {
		const [k, ...v] = args[++i].split("=");
		flags.sets[k] = parseValue(v.join("="));
	} else rest.push(a);
}

function die(msg, code = 1) {
	console.error(msg);
	process.exit(code);
}
function parseValue(raw) {
	if (raw === "true") return true;
	if (raw === "false") return false;
	if (raw === "null") return null;
	if (raw !== "" && !Number.isNaN(Number(raw))) return Number(raw);
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

if (!manifestMod) die("usage: config-registry --manifest <module> --game-dir <path> <command> [args]", 2);

const requireFromCwd = createRequire(pathToFileURL(join(process.cwd(), "noop.js")));
const mod = await import(pathToFileURL(requireFromCwd.resolve(manifestMod)).href);
const manifest = mod.CATEGORIES ?? mod.default;
if (!Array.isArray(manifest)) die(`--manifest module "${manifestMod}" must export CATEGORIES (an array)`, 2);
gameDir ??= mod.gameDir;
if (!gameDir) die("no --game-dir and the manifest module exports no gameDir", 2);

const cmd = rest[0];
const byNameMap = new Map(manifest.map((c) => [c.name, c]));

if (!cmd || cmd === "list") {
	if (rest[1]) cmdListCategory(rest[1]);
	else cmdList();
} else if (cmd === "expand") cmdExpand(rest[1]);
else if (cmd === "refs") cmdRefs(rest[1]);
else if (cmd === "fields") cmdFields(rest[1]);
else if (cmd === "validate") cmdValidate();
else if (cmd === "lint") cmdLint();
else if (cmd === "create") cmdCreate(rest[1]);
else die(`unknown command "${cmd}" (run with no args for usage)`, 2);

function cmdList() {
	const merged = scanConfigDir(gameDir, manifest);
	const next = nextIds(manifest, merged, readLedger(gameDir));
	console.log("Logical config categories (create: config-registry create <category>):\n");
	for (const cat of manifest) {
		const count = Array.isArray(merged[cat.name]) ? merged[cat.name].length : 0;
		const meta = isIdCategory(cat)
			? `next id ${next[cat.name] >= 0 ? next[cat.name] : "?"} (lane ${cat.idRange[0]}-${cat.idRange[1]})`
			: `key-kind (${cat.keyField})`;
		console.log(`  ${cat.name.padEnd(15)} config/game/${cat.folder.padEnd(16)} ${String(count).padStart(3)} entries   ${meta}`);
	}
}

function cmdListCategory(name) {
	const cat = byNameMap.get(name);
	if (!cat) die(`unknown category "${name}" (run list)`);
	const merged = scanConfigDir(gameDir, manifest);
	const arr = Array.isArray(merged[name]) ? merged[name] : [];
	console.log(`${name} — ${arr.length} entries:`);
	for (const e of arr) {
		const ident = isIdCategory(cat) ? `#${e.id}` : `"${e[cat.keyField]}"`;
		const tags = Array.isArray(e.tags) && e.tags.length ? `  [${e.tags.join(", ")}]` : "";
		console.log(`  ${ident.padEnd(8)} ${String(e.displayName ?? "").padEnd(28)}${tags}`);
	}
}

function parseId(raw) {
	const id = Number(raw);
	if (!raw || Number.isNaN(id)) die(`expected a numeric id, got "${raw ?? ""}"`);
	return id;
}

function cmdExpand(raw) {
	const { ctx } = loadContext(gameDir, manifest);
	const tree = expand(parseId(raw), ctx);
	if (!tree) die(`no entity with id ${raw}`);
	console.log(JSON.stringify(tree, null, 2));
}

function cmdRefs(raw) {
	const id = parseId(raw);
	const { ctx } = loadContext(gameDir, manifest);
	const label = ctx.byId.get(id)?.displayName ?? id;
	const head = `${ctx.categoryOfId.get(id) ?? "?"} #${id} "${label}"`;
	const hits = findRefs(id, ctx);
	if (!hits.length) return console.log(`${head} — referenced by nothing.`);
	console.log(`${head} — referenced by ${hits.length}:`);
	for (const h of hits) {
		const ident = h.fromId != null ? `#${h.fromId}` : `"${h.fromKey}"`;
		console.log(`  ${h.category.padEnd(14)} ${ident.padEnd(8)} ${`"${h.label}"`.padEnd(24)} via ${h.keys.join(", ")}`);
	}
}

function cmdFields(name) {
	const cat = byNameMap.get(name);
	if (!cat) die(`unknown category "${name}"`);
	const json = z.toJSONSchema(cat.schema, { unrepresentable: "any", io: "input" });
	const props = json.properties ?? {};
	const required = new Set(json.required ?? []);
	console.log(`  fields (from the ${name} Zod schema):`);
	for (const [field, d] of Object.entries(props)) {
		const opt = required.has(field) ? " " : "?";
		const type = d.enum ? d.enum.map((e) => `"${e}"`).join("|") : (d.type ?? (d.anyOf ? "union" : "any"));
		const ref = d.configRef ? ` →${[].concat(d.configRef).join("/")}` : d.stringConfigRef ? ` →${[].concat(d.stringConfigRef).join("/")}` : "";
		console.log(`    ${field}${opt}: ${String(type + ref).padEnd(24)} ${d.description ?? ""}`);
	}
}

function cmdValidate() {
	const merged = scanConfigDir(gameDir, manifest);
	const { errors } = validateMerged(merged, manifest);
	if (!errors.length) {
		console.log(`[config-registry] ✓ no validation errors`);
		process.exit(0);
	}
	for (const e of errors) console.error(`  ${e}`);
	console.error(`\n[config-registry] ✗ ${errors.length} error(s)`);
	process.exit(1);
}

function cmdLint() {
	const violations = lintRefNaming(manifest);
	if (!violations.length) {
		console.log(`[config-registry] ✓ ref naming clean`);
		process.exit(0);
	}
	for (const v of violations) console.error(`  ${v}`);
	process.exit(1);
}

function cmdCreate(name) {
	const cat = byNameMap.get(name);
	if (!cat) die(`unknown category "${name}" (run list)`);
	const overrides = { ...flags.sets };
	if (flags.name) overrides.displayName = flags.name;
	const { entity, merged } = createEntity(gameDir, manifest, name, overrides);
	const candidate = { ...merged, [name]: [...(merged[name] ?? []), entity] };
	try {
		assertValidMerged(candidate, manifest);
	} catch (err) {
		die(`✗ validation failed — nothing written:\n  ${String(err).split("\n").slice(0, 6).join("\n  ")}`);
	}
	const folder = writeEntity(gameDir, manifest, name, entity);
	const ident = isIdCategory(cat) ? `#${entity.id}` : `"${entity[cat.keyField]}"`;
	console.log(`✓ created ${name} ${ident} "${entity.displayName}" → config/game/${folder}/`);
}
