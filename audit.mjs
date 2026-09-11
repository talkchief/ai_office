// An append-only record of configuration changes: who, when, what changed. Secrets are redacted.
// The actor is the signed-in person's email in a hosted office, 'ceo' in a single-owner one.
import { currentUser } from './server/request-context.mjs';
const SECRET = /(api_?key|token|secret|password|authorization|verifier|client_secret|refresh|credential)/i;
export function redact(value, depth = 0) {
  if (depth > 8) return '…';
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET.test(k) && v ? '[redacted]' : redact(v, depth + 1)]));
  return value;
}
const isObject = x => x && typeof x === 'object' && !Array.isArray(x);
const keyed = list => Array.isArray(list) && list.length > 0 && list.every(x => isObject(x) && (x.id || x.name));
// Field-level differences; lists of records are compared by id so a reordered roster is not a change.
export function diff(before, after, prefix = '', out = []) {
  if (out.length >= 200 || JSON.stringify(before) === JSON.stringify(after)) return out;
  const last = prefix.split(/[.[\]]/).filter(Boolean).at(-1) || '';
  if (SECRET.test(last)) { out.push({ path: prefix, before: before ? '[redacted]' : before ?? null, after: after ? '[redacted]' : after ?? null }); return out; }
  if (isObject(before) && isObject(after)) { for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) diff(before[key], after[key], prefix ? `${prefix}.${key}` : key, out); return out; }
  if ((keyed(before) || keyed(after)) && (Array.isArray(before) || before == null) && (Array.isArray(after) || after == null)) {
    const id = x => x.id || x.name, b = new Map((before || []).map(x => [id(x), x])), a = new Map((after || []).map(x => [id(x), x]));
    for (const key of new Set([...b.keys(), ...a.keys()])) diff(b.get(key), a.get(key), `${prefix}[${key}]`, out); return out;
  }
  out.push({ path: prefix || '(all)', before: redact(before ?? null), after: redact(after ?? null) }); return out;
}
export class AuditLog {
  constructor({ db, bus = null }) {
    this.db = db; this.bus = bus;
    db.exec('CREATE TABLE IF NOT EXISTS office_audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, area TEXT NOT NULL, summary TEXT NOT NULL, diff TEXT); CREATE INDEX IF NOT EXISTS office_audit_at ON office_audit(at DESC);');
  }
  // Pass before/after snapshots; nothing is written when nothing changed.
  record({ area, summary, before, after, actor = currentUser()?.email || 'ceo' }) {
    const changes = before === undefined && after === undefined ? [] : diff(before, after);
    if ((before !== undefined || after !== undefined) && !changes.length) return null;
    const row = { at: Date.now(), actor, area, summary: String(summary).slice(0, 300), diff: changes };
    const info = this.db.prepare('INSERT INTO office_audit(at, actor, area, summary, diff) VALUES (?,?,?,?,?)').run(row.at, actor, area, row.summary, JSON.stringify(changes));
    const saved = { seq: info.lastInsertRowid, ...row }; this.bus?.publish('audit.recorded', { seq: saved.seq, area, summary: row.summary }); return saved;
  }
  list({ limit = 200, area = null } = {}) {
    const rows = area ? this.db.prepare('SELECT * FROM office_audit WHERE area = ? ORDER BY seq DESC LIMIT ?').all(area, Math.min(1000, limit)) : this.db.prepare('SELECT * FROM office_audit ORDER BY seq DESC LIMIT ?').all(Math.min(1000, limit));
    return rows.map(r => ({ seq: r.seq, at: r.at, actor: r.actor, area: r.area, summary: r.summary, diff: JSON.parse(r.diff || '[]') }));
  }
}
