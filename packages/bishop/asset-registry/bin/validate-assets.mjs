#!/usr/bin/env node
// Validate an asset database against the zod schemas of the declared formats.
//
//   validate-assets <assetsRoot> --schema <module> [--schema <module> …]
//
// Each --schema module is imported for its registerAssetSchema side-effects. Prints
// every validation error and exits non-zero if any are found (CI / pre-commit / agent
// hook friendly).

import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateAssetsDir } from "../dist/node.js";

const args = process.argv.slice(2);
const schemaModules = [];
let root;
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--schema") schemaModules.push(args[++i]);
	else if (!root) root = args[i];
}

if (!root) {
	console.error("usage: validate-assets <assetsRoot> --schema <module> [--schema <module> …]");
	process.exit(2);
}

// Resolve schema modules from the caller's CWD (not this package), so a bare specifier
// like "@bishop/asset-types-2d/schema" resolves against the project's node_modules.
const requireFromCwd = createRequire(pathToFileURL(join(process.cwd(), "noop.js")));
for (const m of schemaModules) {
	await import(pathToFileURL(requireFromCwd.resolve(m)).href);
}

const errors = validateAssetsDir(root);
if (errors.length === 0) {
	console.log(`[asset-registry] ✓ no validation errors in ${root}`);
	process.exit(0);
}

for (const e of errors) {
	console.error(`  ${e.file ?? "?"} · ${e.assetId ?? ""} — ${e.message}`);
}
console.error(`\n[asset-registry] ✗ ${errors.length} validation error(s)`);
process.exit(1);
