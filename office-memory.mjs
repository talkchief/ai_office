// Long-term memory: a LangGraph store on the office's own SQLite file, mounted under /memories/ for every agent.
// Task threads are the short-term memory (the checkpointer). This is what survives across tasks: the company pages the
// office keeps current, and the notes agents choose to keep. Who sees what follows the org chart: the Program Manager's
// file system carries the company pages, a team's file system carries that team's page only, and everyone shares notes.
import { BaseStore } from '@langchain/langgraph';
import { StoreBackend } from 'deepagents';

const ROOT = ['office', 'memories'];
export const MEMORY_NAMESPACES = { company: [...ROOT, 'company'], team: id => [...ROOT, 'teams', id], notes: [...ROOT, 'notes'] };
export const MEMORY_PATHS = { orgChart: '/memories/company/org-chart.md', connectors: '/memories/company/connectors.md', team: '/memories/team/team.md', notes: '/memories/notes/' };
const joined = ns => ns.join(':');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The five store operations LangGraph batches: get, search, put (a null value deletes), list namespaces.
export class SqliteMemoryStore extends BaseStore {
  constructor(db) {
    super();
    this.db = db;
    db.exec('CREATE TABLE IF NOT EXISTS office_memory (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (namespace, key))');
    this.q = {
      get: db.prepare('SELECT * FROM office_memory WHERE namespace = ? AND key = ?'),
      put: db.prepare('INSERT INTO office_memory (namespace, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'),
      del: db.prepare('DELETE FROM office_memory WHERE namespace = ? AND key = ?'),
      all: db.prepare('SELECT * FROM office_memory ORDER BY namespace, key'),
      namespaces: db.prepare('SELECT DISTINCT namespace FROM office_memory ORDER BY namespace'),
    };
  }
  item(row) { return { namespace: row.namespace.split(':'), key: row.key, value: JSON.parse(row.value), createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at) }; }
  async batch(operations) {
    return operations.map(op => {
      if ('key' in op && 'namespace' in op && !('value' in op)) { const row = this.q.get.get(joined(op.namespace), op.key); return row ? this.item(row) : null; }
      if ('namespacePrefix' in op) {
        const prefix = joined(op.namespacePrefix);
        let items = this.q.all.all().filter(r => r.namespace.startsWith(prefix)).map(r => this.item(r));
        if (op.filter) items = items.filter(it => Object.entries(op.filter).every(([k, v]) => same(it.value?.[k], v)));
        const offset = op.offset ?? 0;
        return items.slice(offset, offset + (op.limit ?? 10)).map(it => ({ ...it, score: undefined }));
      }
      if ('value' in op) {
        const ns = joined(op.namespace);
        if (op.value === null) this.q.del.run(ns, op.key);
        else { const now = new Date().toISOString(); this.q.put.run(ns, op.key, JSON.stringify(op.value), now, now); }
        return null;
      }
      if ('matchConditions' in op) {
        let names = this.q.namespaces.all().map(r => r.namespace.split(':'));
        for (const c of op.matchConditions || []) names = names.filter(ns => c.matchType === 'suffix'
          ? c.path.length <= ns.length && c.path.every((p, i) => p === '*' || ns[ns.length - c.path.length + i] === p)
          : c.path.length <= ns.length && c.path.every((p, i) => p === '*' || ns[i] === p));
        if (op.maxDepth !== undefined) names = [...new Set(names.map(ns => ns.slice(0, op.maxDepth).join(':')))].map(s => s.split(':'));
        const offset = op.offset ?? 0;
        return names.slice(offset, offset + (op.limit ?? names.length));
      }
      return null;
    });
  }
}

// The office's side of memory: keeps the pages current and hands each role the mounts it may see.
export class OfficeMemory {
  constructor({ db, office, tools = () => [], projects = () => [], name = 'the office' }) {
    this.store = new SqliteMemoryStore(db); this.office = office; this.tools = tools; this.projects = projects; this.name = name;
  }
  // Mounts for one agent's file system. The store itself comes from the running graph (createDeepAgent's `store`).
  routesFor({ role, teamId = null } = {}) {
    const routes = { [MEMORY_PATHS.notes]: new StoreBackend({ namespace: MEMORY_NAMESPACES.notes }) };
    if (role === 'pm') routes['/memories/company/'] = new StoreBackend({ namespace: MEMORY_NAMESPACES.company });
    else if (teamId) routes['/memories/team/'] = new StoreBackend({ namespace: MEMORY_NAMESPACES.team(teamId) });
    return routes;
  }
  async read(namespace, key) { return (await this.store.get(namespace, key))?.value?.content ?? null; }
  readCompany(name) { return this.read(MEMORY_NAMESPACES.company, `/${name}`); }
  readTeam(id) { return this.read(MEMORY_NAMESPACES.team(id), '/team.md'); }
  // StoreBackend's file format: content plus ISO timestamps. A rewrite keeps the creation time.
  async write(namespace, key, content) {
    const before = await this.store.get(namespace, key), now = new Date().toISOString();
    if (before?.value?.content === content) return false;
    await this.store.put(namespace, key, { content, mimeType: 'text/markdown', created_at: before?.value?.created_at || now, modified_at: now });
    return true;
  }
  // What the Program Manager reads before delegating, and what a team reads about itself. Rewritten on every change.
  async refresh() {
    const office = this.office.get(), tools = this.tools(), when = new Date().toISOString();
    const label = id => tools.find(t => t.id === id)?.name || (id === 'web' ? 'Web search & fetch' : id === 'sandbox' ? 'Sandbox (run code)' : id);
    const toolLine = ids => (ids || []).length ? ids.map(label).join(', ') : 'none besides the Brain and the task workspace';
    const known = new Set(['web', 'sandbox', ...tools.map(t => t.id)]), extras = (t, a) => (a.tools || []).filter(id => known.has(id) && !(t.tools || []).includes(id));
    const teamBlock = t => {
      const lead = office.agents.find(a => a.id === t.lead), people = office.agents.filter(a => a.department === t.id && a.id !== t.lead);
      const skills = (t.skills || []).map(id => office.skills?.find(s => s.id === id)?.name || id);
      return [`## ${t.name} (${t.id})`, `Purpose: ${t.purpose || 'not set'}`, `Lead: ${lead ? `${lead.name}, ${lead.role}` : t.lead}`,
        `People: ${people.map(a => `${a.name}, ${a.role}${a.does ? ': ' + a.does : ''}`).join('; ') || 'the lead only'}`,
        `Tools: ${toolLine(t.tools)}${people.filter(a => extras(t, a).length).map(a => `; ${a.name} also has ${extras(t, a).map(label).join(', ')}`).join('')}`, skills.length ? `Skills: ${skills.join(', ')}` : null, ''].filter(v => v !== null).join('\n');
    };
    const orgChart = [`# ${this.name}: who does what`, `Kept current by the office. Updated ${when}.`, 'Only the Program Manager sees every team; a team sees its own page. A team can only call the tools listed under it.', '',
      ...office.teams.map(teamBlock)].join('\n');
    const connectors = ['# Connectors', `Updated ${when}.`, '', ...tools.map(t => `- ${t.name} (${t.id}): ${t.status || 'unknown'}${t.assignedTeams?.length ? '. Teams: ' + t.assignedTeams.map(a => a.name).join(', ') : '. No team can use it yet'}`), ''].join('\n');
    const projects = this.projects();
    const projectsPage = ['# Projects', `Updated ${when}. One page per project lives in the Brain under /knowledge/Projects/<id>/project.md.`, '', ...(projects.length ? projects.map(p => `- ${p.name} (${p.id}): ${p.status}${p.teams?.length ? ', owned by ' + p.teams.join(', ') : ''}${p.next ? '. Next milestone: ' + p.next : ''}${p.dueAt ? '. Target ' + new Date(p.dueAt).toISOString().slice(0, 10) : ''}. Tasks: ${p.open} open, ${p.done} done. Page: /knowledge/${p.page}`) : ['No projects yet.']), ''].join('\n');
    const writes = [
      this.write(MEMORY_NAMESPACES.company, '/org-chart.md', orgChart),
      this.write(MEMORY_NAMESPACES.company, '/connectors.md', connectors),
      this.write(MEMORY_NAMESPACES.company, '/projects.md', projectsPage),
      ...office.teams.map(t => this.write(MEMORY_NAMESPACES.team(t.id), '/team.md', `# ${t.name}\nKept current by the office. Updated ${when}. Other teams and their tools are the Program Manager's to know; ask through a hand-off.\n\n${teamBlock(t)}`)),
    ];
    const changed = (await Promise.all(writes)).filter(Boolean).length;
    return { teams: office.teams.length, tools: tools.length, projects: projects.length, changed };
  }
}
