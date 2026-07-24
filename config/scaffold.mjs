#!/usr/bin/env node
/**
 * scaffold.mjs — the ONE agent-facing front door for authoring Combat Clean content across the three
 * registries, so an AI (or human) can DISCOVER schemas + inspect/author/validate WITHOUT reading
 * source. Every registry speaks the SAME verb vocabulary; the same Zod schemas power the CLI, the
 * build (virtual:game-config), and the edit hook ("fails in one → fails in all").
 *
 *   node config/scaffold.mjs <registry> <verb> [args]     registry ∈ config | visual | assets
 *
 *   list [category]              categories + counts, or entries in one
 *   fields <category>            the Zod schema as a field table (the authoring contract)
 *   show <category> <id>         one raw entry
 *   expand <id> | <category> <id>  entry with references/dependencies resolved (inlined)
 *   refs <id|assetId>            reverse — who references this
 *   create <…>                   scaffold the INITIAL file, then edit it directly (the hook validates)
 *   validate                     full registry gate (CI / hook)
 *   lint                         (config) ref-naming check
 *
 * The CLI owns discovery + initial creation only. Ongoing edits are made DIRECTLY to the JSON;
 * the PreToolUse hook (config/validate-edit-hook.mjs) re-validates every write against the schema.
 */

const REGISTRIES = { config: './registries/config.mjs', visual: './registries/visual.mjs', assets: './registries/assets.mjs' };

function help() {
  console.log('scaffold — authoring front door for the three Combat Clean registries:\n');
  console.log('  node config/scaffold.mjs <registry> <verb> [args]   registry ∈ config | visual | assets\n');
  console.log('  config   gameplay logical config   src/data/config/game/**        (@bishop/config-registry)');
  console.log('  visual   per-entity VSM config      src/data/visual-config/**       (src/view/combat/vsm/schema.ts)');
  console.log('  assets   asset database             assets/**/assets.json          (@bishop/asset-registry)');
  console.log('\nverbs: list [cat] | fields <cat> | show <cat> <id> | expand <id> | refs <id> | create … | validate');
  console.log('\nExamples:');
  console.log('  node config/scaffold.mjs config fields enemies');
  console.log('  node config/scaffold.mjs config expand 5000');
  console.log('  node config/scaffold.mjs config refs 3001');
  console.log('  node config/scaffold.mjs assets refs hero.knight');
}

// ── parse: <registry> <verb> [positionals] [--name X] [--set k=v …] ──
const argv = process.argv.slice(2);
const registry = argv[0];
if (!registry || registry === '--help' || registry === '-h') { help(); process.exit(0); }
if (!REGISTRIES[registry]) { console.error(`Unknown registry "${registry}". Known: ${Object.keys(REGISTRIES).join(', ')}`); process.exit(1); }

const verb = argv[1] || 'list';
const pos = [];
let name;
const sets = {};
function parseVal(raw) {
  if (raw === 'true') return true; if (raw === 'false') return false; if (raw === 'null') return null;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  try { return JSON.parse(raw); } catch { return raw; }
}
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === '--name') name = argv[++i];
  else if (argv[i] === '--set') { const [k, ...r] = argv[++i].split('='); sets[k] = parseVal(r.join('=')); }
  else pos.push(argv[i]);
}

const mod = await import(REGISTRIES[registry]);
const VERB_FN = { list: 'list', fields: 'fields', show: 'show', expand: 'expandEntry', refs: 'refs', create: 'create', validate: 'validate', lint: 'lint' };
const fnName = VERB_FN[verb];
const fn = fnName && mod[fnName];
if (!fn) { console.error(`Unknown/unsupported verb "${verb}" for ${registry}. Verbs: ${Object.keys(VERB_FN).filter((v) => mod[VERB_FN[v]]).join(', ')}`); process.exit(1); }

await fn(pos[0], pos[1], { name, sets });
