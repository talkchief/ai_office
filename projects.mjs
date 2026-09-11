// Projects: the big pieces of work the Program Manager runs. A project has a charter, owners, a timeline with milestones,
// a folder of files in the Brain, and the tasks that belong to it. The office keeps one page per project in the Brain
// (Projects/<id>/project.md) so every agent working a task of that project reads the same description, timeline and history.
import fs from 'node:fs';
import path from 'node:path';

const text = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const PROJECT_STATUSES = ['active', 'paused', 'done', 'archived'];
const ids = list => [...new Set((Array.isArray(list) ? list : []).map(v => text(v, 40)).filter(Boolean))].slice(0, 50);
const slugOf = name => text(name, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';
const dateOf = (value, label) => { if (value === null || value === undefined || value === '') return null; const ms = Number(new Date(value)); if (!Number.isFinite(ms)) fail(`${label} needs a valid date.`); return ms; };
const day = ms => ms ? new Date(ms).toISOString().slice(0, 10) : '';

export class ProjectStore {
  constructor({ dataDir, office, onChange = () => {} }) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'projects.json'); this.office = office; this.onChange = onChange;
    this.items = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')).projects || [] : [];
  }
  persist() { fs.writeFileSync(this.file + '.tmp', JSON.stringify({ projects: this.items }, null, 2)); fs.renameSync(this.file + '.tmp', this.file); }
  changed(project) { this.persist(); try { this.onChange(project); } catch {} }
  list() { return this.items.map(p => structuredClone(p)); }
  get(id) { const p = this.items.find(p => p.id === id); return p ? structuredClone(p) : null; }
  // Everything the CEO may set, checked in plain sentences. Fixed fields (id, dates of record) stay as they are.
  validate(input, previous = null) {
    const name = text(input.name, 80); if (name.length < 2) fail('Give the project a name.');
    const description = text(input.description, 2000); if (description.length < 10) fail('Describe the project in a sentence or two: what it is for and what done looks like.');
    const charter = text(input.charter, 12000);
    const teamIds = new Set(this.office.get().teams.map(t => t.id));
    const teams = [...new Set((Array.isArray(input.teams) ? input.teams : []).map(t => text(t, 48)).filter(Boolean))];
    for (const t of teams) if (!teamIds.has(t)) fail(`There is no team “${t}”.`);
    const status = input.status ? text(input.status, 20) : previous?.status || 'active';
    if (!PROJECT_STATUSES.includes(status)) fail('Status must be active, paused, done or archived.');
    const startAt = dateOf(input.startAt, 'The start'), dueAt = dateOf(input.dueAt, 'The target date');
    if (startAt && dueAt && dueAt < startAt) fail('The target date is before the start.');
    const milestonesIn = Array.isArray(input.milestones) ? input.milestones : [];
    if (milestonesIn.length > 40) fail('Keep it to 40 milestones; put the rest in the charter.');
    const milestones = milestonesIn.map((m, i) => {
      const title = text(m?.title, 160); if (!title) fail(`Milestone ${i + 1} needs a title.`);
      const before = previous?.milestones?.find(x => x.id === m.id);
      const done = !!m?.done;
      return { id: /^[a-z0-9-]{1,40}$/.test(m?.id || '') ? m.id : `m-${Date.now().toString(36)}-${i}`, title, dueAt: dateOf(m?.dueAt, `Milestone “${title}”`), done, doneAt: done ? before?.doneAt || (before?.done ? before.doneAt : Date.now()) : null };
    });
    // Who sees it (hosted offices): the owner, everyone when public, or the people and groups it is shared with. Tasks of the project inherit this.
    const visibility = input.visibility === undefined ? previous?.visibility || 'private' : input.visibility;
    if (!['private', 'public'].includes(visibility)) fail('Visibility must be private or public.');
    const sw = input.sharedWith === undefined ? previous?.sharedWith : input.sharedWith;
    const sharedWith = { users: ids(sw?.users), groups: ids(sw?.groups) };
    return { name, description, charter, teams, status, startAt, dueAt, milestones, visibility, sharedWith };
  }
  create(input, { ownerId = null } = {}) {
    const fields = this.validate(input);
    let id = slugOf(fields.name); for (let n = 2; this.items.some(p => p.id === id); n++) id = slugOf(fields.name) + '-' + n;
    const now = Date.now(), project = { id, ...fields, ownerId: ownerId || text(input.ownerId, 40) || null, createdAt: now, updatedAt: now };
    this.items.push(project); this.changed(project); return structuredClone(project);
  }
  update(id, input) {
    const project = this.items.find(p => p.id === id); if (!project) fail('There is no such project.', 404);
    Object.assign(project, this.validate({ ...project, ...input }, project), { updatedAt: Date.now() });
    this.changed(project); return structuredClone(project);
  }
  setStatus(id, status) { return this.update(id, { status }); }
  remove(id) { const project = this.items.find(p => p.id === id); if (!project) fail('There is no such project.', 404); this.items = this.items.filter(p => p.id !== id); this.changed(project); return true; }
  // The Brain folder that holds the project's files.
  folder(project) { return `Projects/${project.id}`; }
  pageId(project) { return `${this.folder(project)}/project.md`; }
  nextMilestone(project, now = Date.now()) { return [...(project.milestones || [])].filter(m => !m.done).sort((a, b) => (a.dueAt || Infinity) - (b.dueAt || Infinity))[0] || null; }
  // The page every agent reads: charter, timeline, files, and what the project's tasks delivered so far.
  page(project, { tasks = [], files = [], teams = [] } = {}) {
    const teamName = id => teams.find(t => t.id === id)?.name || id;
    const next = this.nextMilestone(project);
    const lines = [`# ${project.name}`, '', `Project page kept by the office. Updated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Status: ${project.status}.`, '',
      '## Purpose', project.description, '',
      project.charter ? '## Charter\n' + project.charter + '\n' : '',
      '## Owners', project.teams.length ? project.teams.map(teamName).join(', ') : 'The Program Manager brings in the teams it needs.', '',
      '## Timeline', `Start: ${day(project.startAt) || 'not set'} · Target: ${day(project.dueAt) || 'not set'}${next ? ` · Next milestone: ${next.title}${next.dueAt ? ' by ' + day(next.dueAt) : ''}` : ''}`,
      ...(project.milestones.length ? ['', ...project.milestones.map(m => `- [${m.done ? 'x' : ' '}] ${m.title}${m.dueAt ? ' — due ' + day(m.dueAt) : ''}${m.done && m.doneAt ? ' — done ' + day(m.doneAt) : ''}`)] : ['', 'No milestones yet.']), '',
      '## Files', files.length ? files.map(f => `- /knowledge/${f.id}${f.title ? ' — ' + f.title : ''}`).join('\n') : 'No files yet.', '',
      '## Tasks', tasks.length ? tasks.map(t => `- ${t.state === 'done' ? '✓' : '·'} ${t.title} (${t.state}${t.doneAt ? ', done ' + day(t.doneAt) : ''})${t.resultPreview ? '\n  ' + String(t.resultPreview).replace(/\s+/g, ' ').slice(0, 240) : ''}`).join('\n') : 'No tasks yet.', ''];
    return lines.filter(l => l !== undefined && l !== null).join('\n').replace(/\n{3,}/g, '\n\n');
  }
  // The block a task carries when it belongs to a project: enough to plan from, plus where the whole page is.
  brief(project) {
    const next = this.nextMilestone(project);
    return [`PROJECT: ${project.name} (${project.status})`, project.description, project.charter ? `Charter: ${project.charter.slice(0, 1500)}${project.charter.length > 1500 ? '…' : ''}` : '',
      `Timeline: start ${day(project.startAt) || 'not set'}, target ${day(project.dueAt) || 'not set'}${next ? `, next milestone “${next.title}”${next.dueAt ? ' by ' + day(next.dueAt) : ''}` : ''}.`,
      project.milestones?.length ? `Milestones (name the ids this task achieves in complete_task): ${project.milestones.map(m => `${m.id} “${m.title}”${m.dueAt ? ' due ' + day(m.dueAt) : ''}${m.done ? ' (done)' : ''}`).join('; ')}.` : '',
      `The project page, its files and what earlier tasks delivered are under /knowledge/${this.folder(project)}/ (read /knowledge/${this.pageId(project)} before planning).`].filter(Boolean).join('\n');
  }
  // A finished task marks its milestones achieved: the one it was created for (the next one at the time) and any the Program
  // Manager named in complete_task. Returns the milestones marked now, so the caller can say so.
  // A milestone is achieved when every task of it is done: the task created for it finishing, or the Program Manager naming it,
  // counts only once no other task of that milestone is still open (`tasks`: the project's tasks as the engine lists them).
  recordCompletion(job, { tasks = [] } = {}) {
    const project = this.items.find(p => p.id === job?.projectId); if (!project || job.state !== 'done') return [];
    const busy = new Set(tasks.filter(t => t.id !== job.id && t.projectId === project.id && t.milestoneId && !['done', 'cancelled'].includes(t.state)).map(t => t.milestoneId));
    const wanted = new Set([...(Array.isArray(job.milestonesDone) ? job.milestonesDone : []), job.milestoneId].filter(id => id && !busy.has(id)));
    const marked = [];
    for (const m of project.milestones || []) if (wanted.has(m.id) && !m.done) { m.done = true; m.doneAt = job.doneAt || Date.now(); m.taskId = job.id; marked.push(m); }
    if (marked.length) { project.updatedAt = Date.now(); this.changed(project); }
    return marked.map(m => structuredClone(m));
  }
  // What the Program Manager keeps in long-term memory: every project at a glance.
  summary({ tasks = () => [] } = {}) {
    return this.items.filter(p => p.status !== 'archived').map(p => {
      const mine = tasks().filter(t => t.projectId === p.id), next = this.nextMilestone(p);
      return { id: p.id, name: p.name, status: p.status, teams: p.teams, dueAt: p.dueAt, next: next ? `${next.title}${next.dueAt ? ' by ' + day(next.dueAt) : ''}` : '', open: mine.filter(t => !['done', 'cancelled'].includes(t.state)).length, done: mine.filter(t => t.state === 'done').length, page: this.pageId(p) };
    });
  }
}
