// The CEO's inbox: every event that needs the owner, with read and acknowledged timestamps.
import { randomUUID } from 'node:crypto';

export const KINDS = ['ceo_decision', 'ceo_approval', 'question', 'blocked', 'escalated', 'done', 'overdue', 'digest', 'routine_failed', 'config_changed', 'provider_error'];
const ACTION_KINDS = new Set(['ceo_decision', 'ceo_approval', 'question', 'blocked', 'escalated', 'overdue', 'provider_error']);

export class Notifications {
  constructor({ db, bus = null }) {
    this.db = db; this.bus = bus;
    db.exec(`CREATE TABLE IF NOT EXISTS office_notifications (id TEXT PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, severity TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT, job_id TEXT, agent TEXT, dept TEXT, action TEXT, dedupe TEXT, read_at INTEGER, acked_at INTEGER);
      CREATE INDEX IF NOT EXISTS office_notifications_at ON office_notifications(at DESC);
      CREATE INDEX IF NOT EXISTS office_notifications_job ON office_notifications(job_id);`);
    // Hosted offices address an item to a person; an older table gets the column once.
    if (!db.prepare('PRAGMA table_info(office_notifications)').all().some(c => c.name === 'user_id')) db.exec('ALTER TABLE office_notifications ADD COLUMN user_id TEXT');
  }
  // The rows one viewer may see: everything for the single owner or an office admin, else only items addressed to them.
  scope({ userId = null, admin = true } = {}) { return admin || !userId ? { sql: '', args: [] } : { sql: 'user_id = ?', args: [userId] }; }
  row(r) { return r && { id: r.id, at: r.at, kind: r.kind, severity: r.severity, title: r.title, body: r.body || '', jobId: r.job_id, agent: r.agent, dept: r.dept, userId: r.user_id || null, action: r.action ? JSON.parse(r.action) : null, readAt: r.read_at, ackedAt: r.acked_at }; }
  get(id) { return this.row(this.db.prepare('SELECT * FROM office_notifications WHERE id = ?').get(id)); }
  // `dedupe` keeps one open item per subject (for example one "overdue" per task) and refreshes it instead of stacking copies.
  notify({ kind, title, body = '', jobId = null, agent = null, dept = null, action = null, severity, dedupe = null, userId = null }) {
    if (!KINDS.includes(kind)) throw new Error('Unknown notification kind: ' + kind);
    const level = severity || (ACTION_KINDS.has(kind) ? 'action' : 'info');
    if (dedupe) {
      const open = this.db.prepare('SELECT id FROM office_notifications WHERE dedupe = ? AND acked_at IS NULL').get(dedupe);
      if (open) {
        this.db.prepare('UPDATE office_notifications SET at = ?, title = ?, body = ?, action = ?, read_at = NULL WHERE id = ?').run(Date.now(), String(title).slice(0, 300), String(body).slice(0, 4000), action ? JSON.stringify(action) : null, open.id);
        const item = this.get(open.id); this.bus?.publish('notification.new', item); return item;
      }
    }
    const item = { id: randomUUID(), at: Date.now() };
    this.db.prepare('INSERT INTO office_notifications(id, at, kind, severity, title, body, job_id, agent, dept, action, dedupe, user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(item.id, item.at, kind, level, String(title).slice(0, 300), String(body).slice(0, 4000), jobId, agent, dept, action ? JSON.stringify(action) : null, dedupe, userId || null);
    const saved = this.get(item.id); this.bus?.publish('notification.new', saved); return saved;
  }
  list({ limit = 100, unread = false, open = false, userId = null, admin = true } = {}) {
    const scope = this.scope({ userId, admin });
    const where = [unread ? 'read_at IS NULL' : '', open ? 'acked_at IS NULL' : '', scope.sql].filter(Boolean).join(' AND ');
    return this.db.prepare(`SELECT * FROM office_notifications ${where ? 'WHERE ' + where : ''} ORDER BY at DESC, rowid DESC LIMIT ?`).all(...scope.args, Math.min(500, limit)).map(r => this.row(r));
  }
  counts({ userId = null, admin = true } = {}) {
    const scope = this.scope({ userId, admin });
    const r = this.db.prepare(`SELECT SUM(read_at IS NULL) AS unread, SUM(severity = 'action' AND acked_at IS NULL) AS needsYou FROM office_notifications ${scope.sql ? 'WHERE ' + scope.sql : ''}`).get(...scope.args);
    return { unread: r.unread || 0, needsYou: r.needsYou || 0 };
  }
  read(id) { this.db.prepare('UPDATE office_notifications SET read_at = COALESCE(read_at, ?) WHERE id = ?').run(Date.now(), id); const item = this.get(id); this.bus?.publish('notification.read', { ids: [id] }); return item; }
  readAll({ userId = null, admin = true } = {}) { const scope = this.scope({ userId, admin }), and = scope.sql ? ' AND ' + scope.sql : ''; const ids = this.db.prepare('SELECT id FROM office_notifications WHERE read_at IS NULL' + and).all(...scope.args).map(r => r.id); this.db.prepare('UPDATE office_notifications SET read_at = ? WHERE read_at IS NULL' + and).run(Date.now(), ...scope.args); this.bus?.publish('notification.read', { ids }); return this.counts({ userId, admin }); }
  readForJob(jobId) { const ids = this.db.prepare('SELECT id FROM office_notifications WHERE job_id = ? AND read_at IS NULL').all(jobId).map(r => r.id); if (ids.length) { this.db.prepare('UPDATE office_notifications SET read_at = ? WHERE job_id = ? AND read_at IS NULL').run(Date.now(), jobId); this.bus?.publish('notification.read', { ids }); } return ids.length; }
  // Taking the linked action acknowledges the item, even if it was never opened.
  ackForJob(jobId, kinds = null) {
    const rows = this.db.prepare('SELECT id, kind FROM office_notifications WHERE job_id = ? AND acked_at IS NULL').all(jobId).filter(r => !kinds || kinds.includes(r.kind));
    const now = Date.now();
    for (const r of rows) this.db.prepare('UPDATE office_notifications SET acked_at = ?, read_at = COALESCE(read_at, ?) WHERE id = ?').run(now, now, r.id);
    if (rows.length) this.bus?.publish('notification.read', { ids: rows.map(r => r.id), acked: true });
    return rows.length;
  }
  ack(id) { const now = Date.now(); this.db.prepare('UPDATE office_notifications SET acked_at = COALESCE(acked_at, ?), read_at = COALESCE(read_at, ?) WHERE id = ?').run(now, now, id); this.bus?.publish('notification.read', { ids: [id], acked: true }); return this.get(id); }
}
