// One-shot, idempotent upgrades. Run at boot, after the stores open and before the engine recovers.
import fs from 'node:fs';
import { loadSkills } from './skills.mjs';

const meta = db => {
  db.exec('CREATE TABLE IF NOT EXISTS office_meta (key TEXT PRIMARY KEY, value TEXT)');
  return { get: key => db.prepare('SELECT value FROM office_meta WHERE key = ?').get(key)?.value, set: (key, value) => db.prepare('INSERT OR REPLACE INTO office_meta(key, value) VALUES (?, ?)').run(key, String(value)) };
};
const hasTable = (db, name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

// Task records from the previous engine: keep history and results, drop copied team rosters and old-graph checkpoints.
export function migrateJobs(engine) {
  const db = engine.db; let migrated = 0;
  for (const row of db.prepare('SELECT id, body FROM office_jobs').all()) {
    const j = JSON.parse(row.body); if (j.schemaVersion === 2) continue;
    const terminal = ['done', 'cancelled'].includes(j.state), untouched = ['backlog', 'queued'].includes(j.state) && !(j.calls > 0);
    const runs = (j.subtasks || []).map(s => ({ id: s.id, agent: s.agent || s.eligible?.[0] || null, role: 'specialist', dept: j.dept, title: s.title, state: s.state === 'done' ? 'done' : terminal ? 'cancelled' : 'interrupted', startedAt: s.startedAt || null, finishedAt: s.finishedAt || null, output: s.output || '', tools: s.tools || [] }));
    const done = j.state === 'done' && j.result;
    const next = { schemaVersion: 2, legacy: true, harness: false, id: j.id, kind: j.kind || 'task', dept: j.dept, depts: [j.dept], title: j.title, text: j.text, assignee: null, dueAt: null,
      priority: j.priority ?? 1, routine: j.routine || null, suiteId: j.suiteId || null, testId: j.testId || null, testName: j.testName || null, agent: j.team?.lead || j.agent, teamName: j.team?.name || j.teamName || j.dept,
      model: null, effort: null, state: terminal || untouched ? j.state : 'blocked', stateSince: j.updatedAt || j.createdAt, createdAt: j.createdAt, updatedAt: j.updatedAt || j.createdAt,
      startedAt: untouched ? null : j.startedAt || j.createdAt, doneAt: j.doneAt || null, seenAt: j.seenAt || null, officeRevision: j.officeRevision, skills: j.skills || [],
      completionApproval: !!j.requireHumanApproval, checks: j.checks || [], plan: j.plan || '', runs, todos: [], reviews: j.reviews || [],
      reviewsByDept: j.review ? { [j.dept]: { ...j.review, dept: j.dept } } : {}, deliverables: done ? { [j.dept]: j.result } : {}, review: j.review || null, result: j.result || '',
      resultVersions: done ? [{ n: 1, at: j.doneAt || j.updatedAt, summary: j.review?.summary || '', correction: null, result: j.result }] : [],
      pendingActions: [], decisions: [], questions: [], calls: j.calls || 0, tokens: j.tokens || 0, tokensByModel: {}, liveCalls: {}, reworkRounds: {}, reprompts: 0, next: null, progressLine: '',
      error: terminal ? j.error || null : untouched ? null : 'This task started before the office upgrade. Retry to run it again with the new team harness.' };
    db.prepare('UPDATE office_jobs SET body = ? WHERE id = ?').run(JSON.stringify(next), j.id);
    // The old graph's checkpoints cannot be resumed by the new one; a retry or correction starts a clean thread.
    for (const table of ['checkpoints', 'writes']) if (hasTable(db, table)) db.prepare(`DELETE FROM ${table} WHERE thread_id = ?`).run(j.id);
    engine.threads.ensure('task', j.id);
    if (!engine.threads.list(j.id).length && j.text) engine.threads.append(j.id, { role: 'ceo', text: j.text, jobId: j.id });
    if (!terminal && !untouched) engine.event(j.id, 'imported', null, 'Upgraded to the new team harness. Retry to run it again.');
    migrated++;
  }
  return migrated;
}

// Owner-written skills in the Brain join the office skill library once. Shipped examples stay out.
export function importBrainSkills(office, brainPath, db) {
  const m = meta(db); if (m.get('skillsImported')) return 0;
  const loaded = loadSkills(brainPath, office.agents()), config = office.get(); let added = 0;
  for (const skill of (loaded.skills || []).filter(s => s.source === 'brain')) {
    const id = ('file-' + skill.name).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 48);
    if (config.skills.some(s => s.id === id) || config.skills.length >= 50 || !String(skill.text || '').trim()) continue;
    const files = (skill.files || []).filter(f => f.content).map(f => `\n\n--- ${f.name} ---\n${f.content}`).join('');
    config.skills.push({ id, name: skill.name, description: skill.description || '', instructions: (skill.text + files).slice(0, 10000) });
    for (const team of config.teams) if (skill.everyone || (skill.departments || []).includes(team.id)) team.skills = [...new Set([...team.skills, id])];
    for (const agent of config.agents) if ((skill.agents || []).includes(agent.id)) agent.skills = [...new Set([...agent.skills, id])];
    added++;
  }
  if (added) office.update(config);
  m.set('skillsImported', Date.now()); return added;
}

// Chat answers used to be saved as unreviewed notes and polluted retrieval. Archive them once.
export async function archiveConversations(knowledge, db) {
  const m = meta(db); if (m.get('conversationsArchived')) return 0;
  let archived = 0; for (const note of knowledge.list()) if (note.kind === 'conversation') { await knowledge.archive(note.id); archived++; }
  m.set('conversationsArchived', Date.now()); return archived;
}

// office.json from before this release: the validated copy in memory is already upgraded; write it back once.
export function persistOffice(office) {
  const raw = JSON.parse(fs.readFileSync(office.file, 'utf8'));
  if (raw.schema === 2) return false;
  office.persist(); return true;
}

// A self-hosted office moved into a hosted tenant: every task, project and routine without an owner belongs to the tenant's
// owner, and the owner's chats with the people become the owner's own threads. Runs once per tenant.
export function assignOwners({ engine, projects = null, routines = null, ownerId }) {
  const m = meta(engine.db); if (!ownerId || m.get('ownersAssigned')) return { jobs: 0, projects: 0, routines: 0, threads: 0 };
  let jobs = 0;
  for (const row of engine.db.prepare('SELECT id, body FROM office_jobs').all()) {
    const j = JSON.parse(row.body); if (j.ownerId) continue;
    j.ownerId = ownerId; j.visibility ||= 'private'; j.sharedWith ||= { users: [], groups: [] };
    engine.db.prepare('UPDATE office_jobs SET body = ? WHERE id = ?').run(JSON.stringify(j), j.id); jobs++;
  }
  let p = 0;
  if (projects) { for (const project of projects.items) if (!project.ownerId) { project.ownerId = ownerId; project.visibility ||= 'private'; project.sharedWith ||= { users: [], groups: [] }; p++; } if (p) projects.persist(); }
  let r = 0;
  if (routines) { const list = routines.list(); for (const x of list) if (!x.ownerId) { x.ownerId = ownerId; r++; } if (r) routines.save(list); }
  let t = 0;
  for (const th of engine.db.prepare("SELECT id FROM office_threads WHERE kind = 'agent' AND id NOT LIKE 'agent:%:%'").all()) {
    const next = `${th.id}:${ownerId}`;
    engine.db.prepare('UPDATE office_threads SET id = ? WHERE id = ?').run(next, th.id); engine.db.prepare('UPDATE office_messages SET thread_id = ? WHERE thread_id = ?').run(next, th.id); t++;
  }
  m.set('ownersAssigned', Date.now()); return { jobs, projects: p, routines: r, threads: t };
}

export async function runMigrations({ engine, office, knowledge, brainPath }) {
  return { office: persistOffice(office), jobs: migrateJobs(engine), skills: importBrainSkills(office, brainPath, engine.db), conversations: await archiveConversations(knowledge, engine.db) };
}
