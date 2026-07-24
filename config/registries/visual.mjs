/**
 * visual registry — the per-entity VSM (Visual State Machine) config. Schema = the ONE source at
 * src/view/combat/vsm/schema.ts (the SAME schema the build compose + the edit hook validate against).
 *
 * Data:   src/data/visual-config/<category>/<id>.json   (id = the SAME id as the logical entry)
 *
 * combatclean note: THIN + opt-in. The shipped visuals are the asset registry; the VSM is the
 * contract for animated combat visuals when added.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatFields } from '@bishop/config-registry';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const VISUAL_DIR = join(ROOT, 'src/data/visual-config');
function die(m) { console.error(m); process.exit(1); }
async function schema() { return import(join(ROOT, 'src/view/combat/vsm/schema.ts')); }

function categories() {
  if (!existsSync(VISUAL_DIR)) return [];
  return readdirSync(VISUAL_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
}
function entries(cat) {
  const dir = join(VISUAL_DIR, cat);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ file: join(dir, f), data: JSON.parse(readFileSync(join(dir, f), 'utf-8')) }));
}

export function list(cat) {
  if (cat) {
    const es = entries(cat);
    console.log(`${cat} — ${es.length} visual entries:`);
    for (const e of es) console.log(`  #${e.data.id}  states: ${Object.keys(e.data.states ?? {}).join(', ')}`);
    return;
  }
  console.log('visual categories (src/data/visual-config/**):\n');
  for (const c of categories()) console.log(`  ${c.padEnd(16)} ${entries(c).length} entries`);
}

export async function fields() {
  const { zVisualConfig } = await schema();
  console.log(formatFields(zVisualConfig, 'visual — VisualConfig schema'));
}

export function show(cat, id) {
  const e = entries(cat).find((x) => String(x.data.id) === String(id));
  if (!e) die(`no visual ${cat} #${id}`);
  console.log(JSON.stringify(e.data, null, 2));
}

export async function validate() {
  const { zVisualConfig } = await schema();
  const errs = [];
  for (const cat of categories()) {
    for (const e of entries(cat)) {
      const r = zVisualConfig.safeParse(e.data);
      if (!r.success) for (const i of r.error.issues) errs.push(`${cat} #${e.data.id}: ${i.path.join('.') || '(root)'}: ${i.message}`);
    }
  }
  if (errs.length) { for (const x of errs) console.error(`  ${x}`); die(''); }
  console.log('✓ visual valid');
}
