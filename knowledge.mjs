import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const FOLDERS = ['Company', 'Projects', 'Status', 'Departments', 'Digests'];
const FOLDER = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,40}(\/[A-Za-z0-9][A-Za-z0-9 _-]{0,40}){0,2}$/;
export class KnowledgeStore {
  constructor(root, onChange = async () => {}) { this.root = path.resolve(root); this.onChange = onChange; this.listeners = { write: [], remove: [] }; fs.mkdirSync(this.root, { recursive: true }); }
  // The search index follows every write and removal.
  on(event, listener) { this.listeners[event].push(listener); return this; }
  emit(event, ...args) { for (const listener of this.listeners[event]) { try { listener(...args); } catch (error) { console.warn('knowledge index:', error.message); } } }
  folders() { return [...new Set([...FOLDERS, ...this.list().map(n => n.id.split('/').slice(0, -1).join('/')).filter(Boolean)])].sort(); }
  // Atomic write through the store, so the graph and the index stay consistent. Larger than notes typed by hand.
  async writeNote(id, content, { max = 2_000_000 } = {}) {
    if (typeof content !== 'string' || content.length > max) throw Object.assign(new Error(`Notes must be text under ${max.toLocaleString()} characters.`), { status: 400 });
    const file = this.resolve(id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', content, { mode: 0o600 }); fs.renameSync(file + '.tmp', file);
    this.emit('write', id, content); await this.onChange(); return this.read(id);
  }
  // A document's path is its identity: uploading to the same path replaces it and archives the previous copy.
  async upload({ folder = 'Company', name, content }) {
    const where = String(folder || 'Company').trim().replace(/^\/+|\/+$/g, '');
    if (!FOLDER.test(where)) throw Object.assign(new Error('Choose a folder name of letters, numbers, spaces and dashes.'), { status: 400 });
    const base = String(name || 'document').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[^A-Za-z0-9 _-]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'document';
    const id = `${where}/${base}.md`, file = this.resolve(id);
    let replaced = null;
    if (fs.existsSync(file)) { const trash = path.join(this.root, '.archive'); fs.mkdirSync(trash, { recursive: true }); replaced = `.archive/${Date.now()}-${path.basename(file)}`; fs.copyFileSync(file, path.join(this.root, replaced)); }
    const note = await this.writeNote(id, `# ${base}\n\nSource file: ${String(name).slice(0, 200)} · Added ${new Date().toISOString()}\n\n${String(content || '').trim()}\n`);
    return { ...note, replaced };
  }
  resolve(id) {
    if (typeof id !== 'string' || !id.endsWith('.md') || id.includes('\0')) throw new Error('Choose a Markdown note.');
    const file = path.resolve(this.root, id);
    if (!file.startsWith(this.root + path.sep) || path.relative(this.root, file).split(path.sep).some(part => part.startsWith('.'))) throw new Error('Invalid note path.');
    let parent = file;
    while (parent !== this.root) { if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw new Error('Linked files cannot be edited.'); parent = path.dirname(parent); }
    return file;
  }
  list() {
    const notes = [];
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.name.endsWith('.md')) {
          const stat = fs.statSync(file), content = fs.readFileSync(file, 'utf8');
          notes.push({ id: path.relative(this.root, file).split(path.sep).join('/'), title: content.match(/^#\s+(.+)$/m)?.[1] || entry.name.replace(/\.md$/, ''),
            kind: content.includes('Unreviewed answer;') ? 'conversation' : file.includes(path.sep + 'Agents Office' + path.sep) || file.includes(path.sep+'Projects'+path.sep) ? 'deliverable' : 'knowledge', updatedAt: stat.mtimeMs, bytes: stat.size, preview: content.replace(/^#.*\n/, '').trim().slice(0, 200) });
        }
      }
    }; walk(this.root);
    return notes.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  retrieve(query, limit = 6) {
    const stop = new Set(['this','that','with','from','have','please','should','would','could','about','your','task','request']);
    const words = [...new Set(String(query).toLowerCase().match(/[a-z0-9]{3,}/g) || [])].filter(w => !stop.has(w));
    const ranked = this.list().map(note => {
      const content = this.read(note.id).content;
      const lower = content.toLowerCase();
      const score = words.reduce((sum,word) => sum + (lower.includes(word) ? 1 : 0) + (note.title.toLowerCase().includes(word) ? 3 : 0),0);
      const hit = Math.max(0, Math.min(...words.map(w => lower.indexOf(w)).filter(i => i >= 0)));
      return {...note,score,content:content.slice(0,700) + (content.length > 700 ? '\n…\n' + content.slice(Math.max(700,hit-300),Math.max(700,hit-300)+4000) : '')};
    }).filter(note => note.score > 0 || note.id.endsWith('office-purpose.md')).sort((a,b)=>b.score-a.score || b.updatedAt-a.updatedAt).slice(0,limit);
    return { notes: ranked.map(n=>n.id), text: ranked.map(n=>`--- Shared memory: ${n.id}; updated ${new Date(n.updatedAt).toISOString()} ---\n${n.content}`).join('\n\n') };
  }
  read(id) { const file = this.resolve(id); if (!fs.existsSync(file)) throw Object.assign(new Error(`No note at ${id}.`), { status: 404 }); return { id, content: fs.readFileSync(file, 'utf8'), updatedAt: fs.statSync(file).mtimeMs }; }
  async save({ id, title, content, updatedAt }) {
    if (typeof content !== 'string' || content.length > 60000) throw new Error('Notes must be text under 60000 characters.');
    id ||= `Knowledge/${String(title || 'note').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60) || 'note'}-${randomUUID().slice(0, 8)}.md`;
    const file = this.resolve(id);
    if (fs.existsSync(file) && updatedAt !== undefined && fs.statSync(file).mtimeMs !== updatedAt) throw Object.assign(new Error('This note changed. Reload it before saving.'), { status: 409 });
    return this.writeNote(id, content, { max: 60000 });
  }
  async archive(id) {
    const file = this.resolve(id), trash = path.join(this.root, '.archive');
    fs.mkdirSync(trash, { recursive: true });
    fs.renameSync(file, path.join(trash, `${Date.now()}-${path.basename(file)}`));
    this.emit('remove', id); await this.onChange(); return { ok: true };
  }
}
