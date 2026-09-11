// Durable conversations. A task's thread id is the task id; an agent's own thread is "agent:<id>", or "agent:<id>:<userId>"
// in a hosted office, where every member has their own conversation with each person.
export const MESSAGE_KINDS = ['message', 'question', 'correction', 'note', 'answer', 'system'];

export class Threads {
  constructor({ db, bus = null }) {
    this.db = db; this.bus = bus;
    db.exec(`CREATE TABLE IF NOT EXISTS office_threads (id TEXT PRIMARY KEY, kind TEXT NOT NULL, ref TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS office_messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, at INTEGER NOT NULL, role TEXT NOT NULL,
        agent TEXT, kind TEXT NOT NULL DEFAULT 'message', text TEXT NOT NULL, job_id TEXT, meta TEXT, delivered_at INTEGER);
      CREATE INDEX IF NOT EXISTS office_messages_thread ON office_messages(thread_id, seq);`);
  }
  static taskThread(jobId) { return jobId; }
  static agentThread(agentId, userId = null) { return 'agent:' + agentId + (userId ? ':' + userId : ''); }
  ensure(kind, ref, { userId = null } = {}) {
    const id = kind === 'task' ? Threads.taskThread(ref) : Threads.agentThread(ref, userId), now = Date.now();
    this.db.prepare('INSERT OR IGNORE INTO office_threads(id, kind, ref, created_at, updated_at) VALUES (?,?,?,?,?)').run(id, kind, ref, now, now);
    return id;
  }
  row(r) { return r && { seq: r.seq, threadId: r.thread_id, at: r.at, role: r.role, agent: r.agent, kind: r.kind, text: r.text, jobId: r.job_id, meta: r.meta ? JSON.parse(r.meta) : {}, deliveredAt: r.delivered_at }; }
  append(threadId, { role, agent = null, kind = 'message', text, jobId = null, meta = {}, delivered = true }) {
    if (!['ceo', 'agent', 'system'].includes(role)) throw new Error('Unknown message role.');
    if (!MESSAGE_KINDS.includes(kind)) throw new Error('Unknown message kind.');
    const body = String(text ?? '').trim(); if (!body) throw Object.assign(new Error('Write a message first.'), { status: 400 });
    const now = Date.now();
    const info = this.db.prepare('INSERT INTO office_messages(thread_id, at, role, agent, kind, text, job_id, meta, delivered_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(threadId, now, role, agent, kind, body.slice(0, 20000), jobId, JSON.stringify(meta), delivered ? now : null);
    this.db.prepare('UPDATE office_threads SET updated_at = ? WHERE id = ?').run(now, threadId);
    const message = this.get(info.lastInsertRowid); this.bus?.publish('thread.message', message); return message;
  }
  get(seq) { return this.row(this.db.prepare('SELECT * FROM office_messages WHERE seq = ?').get(seq)); }
  list(threadId, { after = 0, limit = 200 } = {}) { return this.db.prepare('SELECT * FROM office_messages WHERE thread_id = ? AND seq > ? ORDER BY seq LIMIT ?').all(threadId, after, Math.min(1000, limit)).map(r => this.row(r)); }
  // Notes posted while a run is active wait here until the next turn boundary; they survive restarts.
  pending(threadId) { return this.db.prepare('SELECT * FROM office_messages WHERE thread_id = ? AND delivered_at IS NULL ORDER BY seq').all(threadId).map(r => this.row(r)); }
  markDelivered(seqs) { const now = Date.now(); for (const seq of seqs) this.db.prepare('UPDATE office_messages SET delivered_at = ? WHERE seq = ?').run(now, seq); if (seqs.length) this.bus?.publish('thread.delivered', { seqs, at: now }); }
}
