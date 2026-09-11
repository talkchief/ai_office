// Moves a self-hosted office (its data/ and brain/) into a hosted tenant's folder pair.
//
//   node scripts/tenant-import.mjs --tenant <tenantId> [--data ./data] [--brain ./brain] [--tenants ./tenants] [--force]
//
// Stop both offices first. The tenant must already exist (registered in hosted mode); its folders must be empty or absent.
// providers.json is not copied (models are the platform's in hosted mode); the search index is rebuilt on first start.
// On the next start the office assigns every task, project and routine without an owner to the tenant's owner.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadConfig } from '../config.mjs';
const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const cfg = loadConfig();
const SKIP = new Set(['knowledge-index', 'providers.json', 'accounts.sqlite', 'platform', 'server.log']); // workspaces come along: they hold the files finished tasks produced

// A live SQLite file is copied through SQLite's own backup API (same as scripts/backup.mjs), so the copy is consistent.
function copyDatabase(src, dest) {
  try { const Database = require('better-sqlite3'); const db = new Database(src, { readonly: true }); return db.backup(dest).then(r => { db.close(); return r; }, error => { db.close(); throw error; }); }
  catch { fs.copyFileSync(src, dest); for (const ext of ['-wal', '-shm']) if (fs.existsSync(src + ext)) fs.copyFileSync(src + ext, dest + ext); }
}
const pending = [];
function copy(from, to, { skip = new Set() } = {}) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip.has(entry.name) || /\.sqlite-(wal|shm)$/.test(entry.name)) continue;
    const src = path.join(from, entry.name), dest = path.join(to, entry.name);
    if (entry.isDirectory()) copy(src, dest);
    else if (entry.isFile() && entry.name.endsWith('.sqlite')) pending.push(copyDatabase(src, dest));
    else if (entry.isFile()) fs.copyFileSync(src, dest);
  }
}

export async function importTenant({ tenantId, data, brain, tenants, force = false }) {
  if (!/^t_[a-z2-7]{10}$/.test(tenantId || '')) throw new Error('Name the tenant: --tenant t_xxxxxxxxxx (from the platform admin panel).');
  if (!fs.existsSync(path.join(data, 'office.json'))) throw new Error(`No office at ${data} (office.json missing).`);
  if (fs.existsSync(path.join(data, 'workflows.sqlite-wal')) && !force) throw new Error('The office looks like it is running (workflows.sqlite-wal exists). Stop it first, or pass --force if it was stopped without a clean shutdown.');
  const root = path.join(tenants, tenantId), target = { data: path.join(root, 'data'), brain: path.join(root, 'brain') };
  for (const dir of Object.values(target)) if (fs.existsSync(dir) && fs.readdirSync(dir).some(n => !['knowledge-index', '.gitkeep'].includes(n))) throw new Error(`${dir} is not empty. Import into a fresh tenant, or clear its folders first.`);
  copy(data, target.data, { skip: SKIP });
  if (fs.existsSync(brain)) copy(brain, target.brain);
  await Promise.all(pending.splice(0));
  return target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const target = await importTenant({ tenantId: flag('--tenant'), data: path.resolve(flag('--data') || process.env.AO_DATA || path.join(ROOT, 'data')), brain: path.resolve(flag('--brain') || cfg.brainPath), tenants: path.resolve(flag('--tenants') || process.env.AO_TENANTS_DIR || path.join(ROOT, 'tenants')), force: args.includes('--force') });
    console.log(`Imported into ${target.data} and ${target.brain}. Start the hosted office; the tenant's owner takes over every task, project and routine, and the search index is rebuilt.`);
  } catch (error) { console.error(error.message); process.exit(1); }
}
