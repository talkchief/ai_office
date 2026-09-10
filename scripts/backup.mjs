// Backups of everything the office cannot recreate: the data folder (tasks, memory, keys, connectors, projects) and the Brain.
//
//   node scripts/backup.mjs                 → backups/<timestamp>/ with data/ and brain/, keeping the newest 7
//   node scripts/backup.mjs --keep 30       → keep more
//   node scripts/backup.mjs --list          → what is there
//   node scripts/backup.mjs --restore NAME  → put a backup back (stop the office first; the current state is saved as a backup before)
//
// Paths follow the office's own configuration (AO_DATA, AO_BRAIN, office.config*.json). Schedule it with the OS: a daily
// cron entry or a Windows scheduled task running `npm run backup`.
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
const DATA = path.resolve(process.env.AO_DATA || path.join(ROOT, 'data'));
const BRAIN = path.resolve(cfg.brainPath || process.env.AO_BRAIN || path.join(ROOT, 'brain'));
const BACKUPS = path.resolve(process.env.AO_BACKUPS || path.join(ROOT, 'backups'));
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const size = dir => { let total = 0; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else total += fs.statSync(f).size; } }; if (fs.existsSync(dir)) walk(dir); return total; };
const mb = bytes => (bytes / 1048576).toFixed(1) + ' MB';
// Scratch that a restore does not need: task workspaces are rebuilt by a retry, the search index by a rebuild.
const SKIP = new Set(['workspaces', 'knowledge-index']);

// A live SQLite file is copied through SQLite's own backup API, so the copy is consistent even while the office writes;
// its -wal and -shm companions are then not needed.
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
    if (entry.isDirectory()) copy(src, dest, { skip: new Set() });
    else if (entry.isFile() && entry.name.endsWith('.sqlite')) pending.push(copyDatabase(src, dest));
    else if (entry.isFile()) fs.copyFileSync(src, dest);
  }
}
function list() { if (!fs.existsSync(BACKUPS)) return []; return fs.readdirSync(BACKUPS).filter(n => fs.existsSync(path.join(BACKUPS, n, 'manifest.json'))).sort(); }
async function backup({ keep = 7, reason = 'scheduled' } = {}) {
  const name = stamp(), dir = path.join(BACKUPS, name);
  if (!fs.existsSync(DATA)) throw new Error(`No data folder at ${DATA}: nothing to back up yet.`);
  copy(DATA, path.join(dir, 'data'), { skip: SKIP });
  if (fs.existsSync(BRAIN)) copy(BRAIN, path.join(dir, 'brain'));
  await Promise.all(pending.splice(0));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ at: new Date().toISOString(), reason, data: DATA, brain: BRAIN, skipped: [...SKIP], bytes: size(dir) }, null, 2));
  const old = list().filter(n => n !== name).slice(0, Math.max(0, list().length - keep));
  for (const n of old) fs.rmSync(path.join(BACKUPS, n), { recursive: true, force: true });
  return { name, dir, bytes: size(dir), removed: old };
}
async function restore(name) {
  const dir = path.join(BACKUPS, name);
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) throw new Error(`No backup named ${name}. Run with --list to see them.`);
  if (fs.existsSync(path.join(DATA, 'workflows.sqlite-wal'))) throw new Error('The office looks like it is running (workflows.sqlite-wal exists). Stop it before restoring.');
  const safety = await backup({ keep: 50, reason: `before restoring ${name}` });
  for (const [from, to] of [[path.join(dir, 'data'), DATA], [path.join(dir, 'brain'), BRAIN]]) {
    if (!fs.existsSync(from)) continue;
    for (const entry of fs.readdirSync(to, { withFileTypes: true })) if (!SKIP.has(entry.name)) fs.rmSync(path.join(to, entry.name), { recursive: true, force: true });
    copy(from, to);
  }
  return { restored: name, safety: safety.name };
}

await (async () => { try {
  if (args.includes('--list')) {
    const names = list(); if (!names.length) console.log(`No backups under ${BACKUPS}.`);
    for (const n of names) { const m = JSON.parse(fs.readFileSync(path.join(BACKUPS, n, 'manifest.json'), 'utf8')); console.log(`${n}  ${mb(m.bytes)}  ${m.reason}`); }
  } else if (flag('--restore')) {
    const r = await restore(flag('--restore'));
    console.log(`Restored ${r.restored}. The state from before is kept as ${r.safety}. Start the office and rebuild the search index under Settings → Brain.`);
  } else {
    const r = await backup({ keep: Number(flag('--keep')) || 7, reason: args.includes('--before-upgrade') ? 'before upgrade' : 'manual' });
    console.log(`Backed up to ${r.dir} (${mb(r.bytes)})${r.removed.length ? `; removed ${r.removed.length} older backup${r.removed.length === 1 ? '' : 's'}` : ''}.`);
  }
} catch (error) { console.error(error.message); process.exit(1); } })();
