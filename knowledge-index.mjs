// Search over the Brain: every note is split into heading-aware passages and indexed for full-text search.
// Zvec (embedded, on disk) is used when its bindings load; SQLite FTS5 is the fallback with the same results shape.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function chunk(markdown, { size = 3200, overlap = 400 } = {}) {
  const sections = []; let heading = '', lines = [];
  const push = () => { const text = lines.join('\n').trim(); if (text) sections.push({ heading, text }); };
  for (const line of String(markdown || '').split('\n')) { const h = /^(#{1,6})\s+(.+)/.exec(line); if (h) { push(); heading = h[2].trim().slice(0, 200); lines = [line]; } else lines.push(line); }
  push();
  const out = [];
  for (const s of sections) {
    if (s.text.length <= size) { out.push(s); continue; }
    for (let i = 0; i < s.text.length; i += size - overlap) { out.push({ heading: s.heading, text: s.text.slice(i, i + size) }); if (i + size >= s.text.length) break; }
  }
  return out;
}
// Plain words only: the query parsers treat punctuation (a colon, brackets) as syntax.
export const terms = query => [...new Set(String(query || '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])].slice(0, 32);
const chunkId = (notePath, n) => crypto.createHash('sha1').update(notePath).digest('hex').slice(0, 24) + '-' + n;
const folderOf = id => id.includes('/') ? id.split('/').slice(0, -1).join('/') : '';
function snippet(text, words) {
  const lower = text.toLowerCase(), hits = words.map(w => lower.indexOf(w)).filter(i => i >= 0), at = hits.length ? Math.min(...hits) : 0, start = Math.max(0, at - 120);
  return (start ? '…' : '') + text.slice(start, start + 420).replace(/\s+/g, ' ').trim() + (start + 420 < text.length ? '…' : '');
}

class ZvecBackend {
  constructor(dir) { this.dir = dir; }
  async open() {
    const zv = (await import('@zvec/zvec')).default, { ZVecCreateAndOpen, ZVecOpen, ZVecCollectionSchema, ZVecDataType: T, ZVecIndexType: I } = zv;
    const schema = new ZVecCollectionSchema({ name: 'brain', fields: [
      { name: 'path', dataType: T.STRING, indexParams: { indexType: I.INVERT } }, { name: 'folder', dataType: T.STRING, indexParams: { indexType: I.INVERT } },
      { name: 'heading', dataType: T.STRING }, { name: 'text', dataType: T.STRING, indexParams: { indexType: I.FTS, filters: ['lowercase', 'stemmer'] } }] });
    this.c = fs.existsSync(this.dir) ? ZVecOpen(this.dir) : ZVecCreateAndOpen(this.dir, schema);
  }
  upsert(docs) { for (let i = 0; i < docs.length; i += 500) this.c.upsertSync(docs.slice(i, i + 500).map(d => ({ id: d.id, fields: { path: d.path, folder: d.folder, heading: d.heading, text: d.text } }))); }
  remove(ids) { for (let i = 0; i < ids.length; i += 500) this.c.deleteSync(ids.slice(i, i + 500)); }
  query(words, { folder, k }) {
    // Every word is a literal term: an agent that searches for `"q4 campaign" OR "campaign"` means the words, not the FTS operators.
    const literal = words.filter(w => !/^(and|or|not|near)$/i.test(w)).map(w => '"' + w.replace(/"/g, '') + '"');
    if (!literal.length) return [];
    try {
      return this.c.querySync({ fieldName: 'text', fts: { queryString: literal.join(' ') }, topk: k, ...(folder ? { filter: `folder = ${JSON.stringify(folder)}` } : {}) })
        .map(d => ({ path: d.fields.path, heading: d.fields.heading, text: d.fields.text, score: d.score }));
    } catch (error) { console.warn('Brain search:', error.message); return []; }
  }
  count() { return this.c.stats.docCount; }
  close() { try { this.c?.closeSync(); } catch {} }
}
class SqliteBackend {
  constructor(file) { this.file = file; }
  async open() {
    const { default: Database } = await import('better-sqlite3');
    this.db = new Database(this.file); this.db.pragma('journal_mode = WAL');
    this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS passages USING fts5(id UNINDEXED, path UNINDEXED, folder UNINDEXED, heading, text, tokenize = 'porter unicode61')");
  }
  upsert(docs) { const del = this.db.prepare('DELETE FROM passages WHERE id = ?'), add = this.db.prepare('INSERT INTO passages(id, path, folder, heading, text) VALUES (?,?,?,?,?)'); this.db.transaction(() => { for (const d of docs) { del.run(d.id); add.run(d.id, d.path, d.folder, d.heading, d.text); } })(); }
  remove(ids) { const del = this.db.prepare('DELETE FROM passages WHERE id = ?'); this.db.transaction(() => { for (const id of ids) del.run(id); })(); }
  query(words, { folder, k }) {
    const match = words.map(w => `"${w.replace(/"/g, '')}"`).join(' OR ');
    return this.db.prepare(`SELECT path, heading, text, bm25(passages) AS rank FROM passages WHERE passages MATCH ? ${folder ? 'AND folder = ?' : ''} ORDER BY rank LIMIT ?`).all(...[match, ...(folder ? [folder] : []), k]).map(r => ({ path: r.path, heading: r.heading, text: r.text, score: -r.rank }));
  }
  count() { return this.db.prepare('SELECT count(*) AS n FROM passages').get().n; }
  close() { try { this.db?.close(); } catch {} }
}

export class KnowledgeIndex {
  constructor({ dir, store, backend = 'auto' }) { this.dir = dir; this.store = store; this.prefer = backend; this.manifestFile = path.join(dir, 'manifest.json'); this.kind = null; }
  async open() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (this.prefer !== 'sqlite') { try { const b = new ZvecBackend(path.join(this.dir, 'zvec')); await b.open(); this.backend = b; this.kind = 'zvec'; } catch (error) { console.warn('Brain search: Zvec unavailable, using SQLite full-text search:', error.message); } }
    if (!this.backend) { this.backend = new SqliteBackend(path.join(this.dir, 'fts.sqlite')); await this.backend.open(); this.kind = 'sqlite'; }
    this.manifest = fs.existsSync(this.manifestFile) ? JSON.parse(fs.readFileSync(this.manifestFile, 'utf8')) : {};
    if (this.manifest.$backend !== this.kind) this.manifest = { $backend: this.kind };
    return this;
  }
  saveManifest() { fs.writeFileSync(this.manifestFile + '.tmp', JSON.stringify(this.manifest)); fs.renameSync(this.manifestFile + '.tmp', this.manifestFile); }
  // Follow the store: every write re-indexes that note, every archive removes it.
  attach() {
    this.store.on('write', (id, content) => this.upsertNote(id, content, this.mtime(id)));
    this.store.on('remove', id => this.removeNote(id));
    return this;
  }
  mtime(id) { try { return fs.statSync(this.store.resolve(id)).mtimeMs; } catch { return Date.now(); } }
  upsertNote(id, content, mtime = Date.now()) {
    const pieces = chunk(content), before = this.manifest[id]?.chunks || 0, folder = folderOf(id);
    this.backend.upsert(pieces.map((c, n) => ({ id: chunkId(id, n), path: id, folder, heading: c.heading, text: c.text })));
    if (before > pieces.length) this.backend.remove([...Array(before - pieces.length).keys()].map(i => chunkId(id, pieces.length + i)));
    this.manifest[id] = { mtime, chunks: pieces.length }; this.saveManifest();
  }
  removeNote(id) { const old = this.manifest[id]; if (!old) return; this.backend.remove([...Array(old.chunks).keys()].map(n => chunkId(id, n))); delete this.manifest[id]; this.saveManifest(); }
  // Catch up with the folder: new or edited notes are indexed, removed notes leave the index.
  sync() {
    let indexed = 0, removed = 0; const notes = this.store.list(), present = new Set(notes.map(n => n.id));
    for (const note of notes) if (this.manifest[note.id]?.mtime !== note.updatedAt) { this.upsertNote(note.id, this.store.read(note.id).content, note.updatedAt); indexed++; }
    for (const id of Object.keys(this.manifest)) if (id !== '$backend' && !present.has(id)) { this.removeNote(id); removed++; }
    return { indexed, removed, ...this.status() };
  }
  rebuild() { for (const id of Object.keys(this.manifest)) if (id !== '$backend') this.removeNote(id); return this.sync(); }
  search(query, { folder = '', k = 6 } = {}) {
    const words = terms(query); if (!words.length) return [];
    const limit = Math.min(12, Math.max(1, Number(k) || 6)), perNote = new Map(), out = [];
    for (const row of this.backend.query(words, { folder: String(folder || '').trim(), k: limit * 4 })) {
      const seen = perNote.get(row.path) || 0; if (seen >= 2) continue; perNote.set(row.path, seen + 1);
      out.push({ path: row.path, heading: row.heading || '', snippet: snippet(row.text, words), score: +Number(row.score).toFixed(3) });
      if (out.length >= limit) break;
    }
    return out;
  }
  status() { const notes = Object.keys(this.manifest).filter(k => k !== '$backend'); return { backend: this.kind, notes: notes.length, passages: notes.reduce((n, id) => n + this.manifest[id].chunks, 0) }; }
  close() { this.backend?.close(); }
}
