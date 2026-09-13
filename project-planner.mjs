// A project from a brief. The CEO says what to build or achieve and attaches documents; the Program Manager names the
// project, writes the purpose and the charter, picks the owning teams, sets milestones with dates and writes the first
// tasks, one model call, no dialogue. The office creates the project, files the documents in its Brain folder, creates the
// tasks (the first milestone's queued now, later ones in the backlog) and, as each milestone is achieved, starts the next.
import fs from 'node:fs';
import path from 'node:path';
import { usageOfMessage } from './engine/stream.mjs';

const text = (value, max = 4000) => String(value ?? '').replace(/\s+$/g, '').trim().slice(0, max);
const oneLine = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const day = ms => new Date(ms).toISOString().slice(0, 10);
const DAY = 86400000;
export const LIMITS = { milestones: 12, tasksPerMilestone: 6, tasks: 24, documentChars: 20000, documentsChars: 60000, skillChars: 12000, skillsChars: 40000 };
// The Program Manager's methods for planning a project, built in: read on every planning call, in this order.
export const PLANNING_SKILLS = ['planning-a-project', 'project-shepherd', 'senior-project-manager', 'studio-producer'];
const PLANNING_WORDS = /project|plan|charter|milestone|roadmap|programme|program management|scope/i;

// The skills the planner reads: from the shipped folder the built-in set, from the CEO's own folder any skill about planning.
export function loadPlanningSkills({ dirs = [], names = PLANNING_SKILLS, words = PLANNING_WORDS } = {}) {
  const out = []; let budget = LIMITS.skillsChars;
  dirs.forEach((dir, index) => {
    let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return; }
    const wanted = index === 0 ? names.filter(n => entries.includes(n)) : entries.sort();
    for (const name of wanted) {
      let raw = ''; try { raw = fs.readFileSync(path.join(dir, name, 'SKILL.md'), 'utf8'); } catch { continue; }
      const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw), meta = {};
      if (fm) for (const line of fm[1].split(/\r?\n/)) { const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(line); if (m) meta[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); }
      const description = oneLine(meta.description, 300), body = text(fm ? fm[2] : raw, Math.min(LIMITS.skillChars, budget));
      if (index > 0 && !words.test(name + ' ' + description)) continue;
      if (!body || out.some(s => s.name === name)) continue;
      budget -= body.length; out.push({ name: meta.name || name, description, text: body });
      if (budget <= 0) break;
    }
  });
  return out;
}

export const PLANNER_PROMPT = `You are the Program Manager of a company office. The CEO gives you a brief for a project, sometimes with documents. You plan the whole project yourself and answer with one JSON object and nothing else:
{"name":"<short project name>","description":"<one or two sentences: what it is for and what done looks like>","charter":"<scope and what is out of scope; objectives and how success is measured; constraints; standards to follow>","teams":["<team id>", ...],"startAt":"YYYY-MM-DD","dueAt":"YYYY-MM-DD","milestones":[{"title":"<milestone>","dueAt":"YYYY-MM-DD","after":[<0-based positions of the milestones this one waits for; [] when it can start at once>],"tasks":[{"title":"<short name of the deliverable, under 70 characters>","team":"<team id>","text":"<the assignment for that team: the deliverable, what it must contain, what to read, the criteria>"}]}]}
Rules: teams are chosen from the list given, by purpose and people; a task names one team (or "auto" when the Program Manager should choose at the time). Two to six milestones in order, each with a date inside the project's window; the first milestone's tasks must be startable now with what the Brain and the documents hold. Milestones that do not depend on each other run in parallel: give each milestone "after", the positions of the milestones it truly waits for ([] for one that can start at once); left out, it waits for the one before it. Break every milestone into its separate pieces of work: one task per deliverable and per team, never several disciplines folded into one task. Where something is written, designed or built, its checking is work of its own — quality assurance, testing, fact-checking, review or sign-off is a separate task (usually for another team than the one that made it), and so are launch, publishing, measurement and handover when the project has them. A milestone usually holds two to six tasks; the whole project up to twenty-four. Each task has a short title naming the deliverable and a complete brief for one team with the deliverable named (a file, a page, a decision) and the acceptance criteria, in a few tight sentences. Use the CEO's deadline when there is one, otherwise propose a realistic target. Dates are ISO. Keep the CEO's own words for what must and must not happen. Never invent numbers; say where they come from. The charter is plain prose, not a list of headings.`;

// The words a brief is about: five letters or more, common and bureaucratic words left out, most frequent first, in order of appearance.
const STOP = new Set(['about', 'active', 'after', 'again', 'aimed', 'announce', 'announces', 'approve', 'approves', 'before', 'being', 'between', 'build', 'check', 'checks', 'client', 'clients', 'confirm', 'confirms', 'could', 'december', 'every', 'first', 'from', 'goes', 'have', 'into', 'january', 'february', 'march', 'april', 'august', 'september', 'october', 'november', 'made', 'make', 'month', 'months', 'must', 'needs', 'never', 'nothing', 'office', 'other', 'owns', 'please', 'project', 'projects', 'qualifies', 'qualify', 'request', 'requests', 'shared', 'should', 'since', 'status', 'teams', 'their', 'there', 'these', 'they', 'this', 'those', 'three', 'through', 'wants', 'weeks', 'what', 'when', 'where', 'which', 'while', 'without', 'would', 'years']);
export const briefWords = (brief, max = 24) => { const counts = new Map(), order = []; for (const w of String(brief || '').toLowerCase().match(/[a-z][a-z-]{4,}/g) || []) { if (STOP.has(w)) continue; if (!counts.has(w)) order.push(w); counts.set(w, (counts.get(w) || 0) + 1); } return order.sort((a, b) => counts.get(b) - counts.get(a) || order.indexOf(a) - order.indexOf(b)).slice(0, max); };
// Methods from the Agency catalogue that fit the brief: personas matching at least two of its telling words, the rarer the
// word the more it weighs, three methods at most. A word that matches a large slice of the catalogue says nothing about
// this brief and does not count.
export function loadCatalogueMethods({ agency, brief, max = 3, chars = 8000, maxHits = 60 } = {}) {
  if (!agency?.list || !agency?.get) return [];
  const words = briefWords(brief); if (!words.length) return [];
  const score = new Map(), matched = new Map();
  for (const w of words) {
    let hits = []; try { hits = agency.list({ q: w }); } catch { hits = []; }
    if (!hits.length || hits.length > maxHits) continue;
    for (const p of hits) { score.set(p.id, (score.get(p.id) || 0) + 1 / hits.length); matched.set(p.id, (matched.get(p.id) || 0) + 1); }
  }
  const picked = [...score.entries()].filter(([id]) => matched.get(id) >= 2).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, max);
  const out = [];
  for (const [id] of picked) { try { const persona = agency.get(id); const body = text(persona.body, chars); if (body) out.push({ name: persona.name, description: oneLine(persona.description, 300), text: body }); } catch {} }
  return out;
}

// The ask: the brief, the company, and the documents' text.
export function plannerAsk({ brief, office, documents = [], skills = [], catalogue = [], today = Date.now() }) {
  const teams = (office?.teams || []).map(t => {
    const people = (office.agents || []).filter(a => a.department === t.id && a.id !== t.lead).map(a => `${a.name} (${a.role})`).join(', ');
    const lead = (office.agents || []).find(a => a.id === t.lead);
    return `- ${t.id}: ${t.name}${t.purpose ? ' — ' + oneLine(t.purpose, 200) : ''}. Lead: ${lead?.name || t.lead}${people ? '. People: ' + people : ''}`;
  }).join('\n');
  let budget = LIMITS.documentsChars;
  const docs = documents.map(d => { const body = text(d.content, Math.min(LIMITS.documentChars, budget)); budget -= body.length; return `### ${d.name}\n${body || '(empty)'}`; }).join('\n\n');
  const methods = skills.length ? `Your methods, built in (follow them):\n\n${skills.map(s => `### ${s.name}${s.description ? ' — ' + s.description : ''}\n${s.text}`).join('\n\n')}` : '';
  const fitting = catalogue.length ? `Methods from the Agency catalogue that fit this brief (use what applies):\n\n${catalogue.map(s => `### ${s.name}${s.description ? ' — ' + s.description : ''}\n${s.text}`).join('\n\n')}` : '';
  return [`Today: ${day(today)}.`, `Brief from the CEO:\n${text(brief, 12000)}`, `Teams:\n${teams || '(none)'}`, docs ? `Documents the CEO attached:\n\n${docs}` : 'No documents attached.', methods, fitting].filter(Boolean).join('\n\n');
}

const parseJson = raw => { const m = /\{[\s\S]*\}/.exec(String(raw || '')); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };
const dateOf = (value, fallback) => { const ms = Number(new Date(String(value || ''))); return Number.isFinite(ms) && /^\d{4}-\d{2}-\d{2}/.test(String(value)) ? ms : fallback; };

// The plan the model wrote, checked against the office: unknown teams drop, dates fall inside the window (missing milestone
// dates are spread evenly), counts are capped, every task is a real brief. Returns { plan, problems } or { plan: null, problems }.
export function parsePlan(raw, { office, brief = '', today = Date.now() } = {}) {
  const problems = [];
  const v = typeof raw === 'object' && raw ? raw : parseJson(raw);
  if (!v) return { plan: null, problems: ['the answer was not a JSON plan'] };
  const teamIds = new Set((office?.teams || []).map(t => t.id));
  const name = oneLine(v.name, 80); if (name.length < 2) problems.push('no project name');
  const description = text(v.description, 2000) || oneLine(brief, 200);
  if (description.length < 10) problems.push('no purpose');
  const charter = text(v.charter, 20000);
  const teams = [...new Set((Array.isArray(v.teams) ? v.teams : []).map(t => String(t)).filter(t => teamIds.has(t)))].slice(0, 20);
  const startAt = dateOf(v.startAt, today);
  let dueAt = dateOf(v.dueAt, null);
  const milestonesIn = (Array.isArray(v.milestones) ? v.milestones : []).slice(0, LIMITS.milestones);
  if (!milestonesIn.length) problems.push('no milestones');
  if (!dueAt) { const last = milestonesIn.map(m => dateOf(m?.dueAt, null)).filter(Boolean).sort((a, b) => b - a)[0]; dueAt = last || startAt + 60 * DAY; }
  if (dueAt <= startAt) dueAt = startAt + 30 * DAY;
  let total = 0;
  const milestones = milestonesIn.map((m, i) => {
    const title = oneLine(m?.title, 120) || `Milestone ${i + 1}`;
    const due = dateOf(m?.dueAt, null);
    const tasks = (Array.isArray(m?.tasks) ? m.tasks : []).slice(0, LIMITS.tasksPerMilestone).map(t => ({ title: oneLine(t?.title, 100), team: teamIds.has(String(t?.team)) ? String(t.team) : 'auto', text: text(t?.text, 6000) })).filter(t => t.text.length >= 10);
    total += tasks.length;
    const after = Array.isArray(m?.after) ? [...new Set(m.after.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < i))] : undefined;
    return { title, dueAt: due, tasks, ...(after ? { after } : {}) };
  });
  // Dates: inside the window, in order; missing ones spread evenly between start and target.
  const span = dueAt - startAt, n = milestones.length;
  milestones.forEach((m, i) => { if (!m.dueAt || m.dueAt < startAt || m.dueAt > dueAt) m.dueAt = startAt + Math.round(span * (i + 1) / n); });
  for (let i = 1; i < n; i++) if (milestones[i].dueAt < milestones[i - 1].dueAt) milestones[i].dueAt = milestones[i - 1].dueAt;
  if (total > LIMITS.tasks) { let left = LIMITS.tasks; for (const m of milestones) { m.tasks = m.tasks.slice(0, Math.max(0, left)); left -= m.tasks.length; } }
  if (!milestones.some(m => m.tasks.length)) problems.push('no tasks');
  if (problems.length) return { plan: null, problems };
  return { plan: { name, description, charter, teams, startAt, dueAt, milestones }, problems: [] };
}

// One Program Manager call at high effort; a plan that does not parse is asked for once more with the problems named.
export async function planProject({ brief, documents = [], skills = [], catalogue = [], office, models, today = Date.now(), instance = null, onUsage = () => {} }) {
  const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
  const spec = models.resolve({ role: 'pm' });
  if (!spec.model) throw Object.assign(new Error('No model is configured for the Program Manager. Choose one in Settings → Models & keys.'), { status: 409 });
  const model = instance || await models.instance({ model: spec.model, effort: 'high', streaming: false, maxTokens: 16000 });
  const ask = plannerAsk({ brief, office, documents, skills, catalogue, today });
  const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => typeof p === 'string' ? p : p?.text || '').join('') : '';
  let last = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const messages = [new SystemMessage(PLANNER_PROMPT), new HumanMessage(ask)];
    if (last?.problems?.length) messages.push(new HumanMessage(`Office: the plan you sent could not be used (${last.problems.join('; ')}). Send the whole JSON plan again, complete.`));
    const reply = await model.invoke(messages);
    // Inside the loop: a plan that had to be sent again cost twice, and a bill should say so.
    try { onUsage({ message: reply, model: spec.model }); } catch {}
    last = parsePlan(textOf(reply?.content), { office, brief, today });
    if (last.plan) return last.plan;
  }
  throw Object.assign(new Error(`The Program Manager could not plan this project (${last.problems.join('; ')}). Add a sentence about what done looks like and try again.`), { status: 422 });
}

// The plan becomes a project and its tasks: the first milestone's tasks start now, later ones wait in the backlog.
export function applyPlan({ plan, projects, engine, ownerId = null, audience = {} }) {
  const project = projects.create({ name: plan.name, description: plan.description, charter: plan.charter, teams: plan.teams, startAt: plan.startAt, dueAt: plan.dueAt, milestones: plan.milestones.map(m => ({ title: m.title, dueAt: m.dueAt, ...(m.after ? { after: m.after } : {}) })), plannedBy: 'pm', ...audience }, { ownerId });
  const tasks = [], ready = new Set(projects.readyMilestones(project).map(m => m.id));
  project.milestones.forEach((m, i) => {
    for (const t of plan.milestones[i]?.tasks || []) {
      const job = engine.create({ dept: t.team === 'auto' ? 'auto' : t.team, depts: t.team === 'auto' ? 'auto' : undefined, text: `${t.text}\n\nProject milestone: ${m.title}${m.dueAt ? ' (due ' + day(m.dueAt) + ')' : ''}.`, title: t.title || oneLine(t.text, 100), projectId: project.id, milestoneId: m.id, backlog: !ready.has(m.id), ownerId, origin: { channel: 'project', projectId: project.id, milestoneId: m.id } });
      tasks.push(job);
    }
  });
  return { project, tasks };
}

// Every milestone that can be worked now (nothing it waits for is open) is under way: its backlog tasks are queued, and one with
// no tasks at all is handed to the Program Manager as one task to plan and deliver (once: that task carries the milestone).
// Milestones that do not wait for each other run in parallel. Returns the tasks started.
/**
 * One brief becomes a project: the planning methods, the model call, the project with its first milestone's tasks,
 * and the documents filed in the project's Brain folder. The Projects form and the mail intake both come through
 * here, so a project planned from an email is planned exactly like one planned in the office.
 * `root` is the repository root, used only when the engine carries no pm-skills folder of its own.
 */
export async function planProjectFrom({ brief, documents = [], office, models, projects, engine, knowledge, agency = null, ownerId = null, audience = {}, root = '', log = () => {} }) {
  const dirs = [engine?.pmSkillsDir || (root ? path.join(root, 'agency', 'pm-skills') : ''), engine?.knowledgeDir ? path.join(engine.knowledgeDir, 'Agents Office', 'pm-skills') : ''].filter(Boolean);
  const skills = loadPlanningSkills({ dirs });
  const catalogue = loadCatalogueMethods({ agency, brief });
  const plan = await planProject({ brief, documents: documents.map(d => ({ name: d.name, content: d.content })), skills, catalogue, office: office.get(), models,
    onUsage: ({ message, model }) => engine?.recordUsage?.({ tag: 'plan', model, ...usageOfMessage(message) }) });
  const { project, tasks } = applyPlan({ plan, projects, engine, ownerId, audience });
  // A document that will not file is worth a line in the log, never the loss of the project that was just planned.
  for (const doc of documents) { try { await knowledge.upload({ folder: projects.folder(project), name: doc.name, content: doc.content }); } catch (error) { log(`project document: ${error.message}`); } }
  return { project, tasks, methods: { builtIn: skills.map(s => s.name), catalogue: catalogue.map(s => s.name) } };
}

export function startNextMilestone({ project, projects, engine }) {
  if (!project || project.status !== 'active') return [];
  const started = [];
  for (const next of projects.readyMilestones(project)) {
    const mine = engine.list().filter(j => j.projectId === project.id && j.milestoneId === next.id && j.state !== 'cancelled');
    for (const job of mine.filter(j => j.state === 'backlog')) { try { engine.editQueue(job.id, { state: 'queued' }); started.push(job.id); } catch {} }
    if (mine.length) continue;
    const due = next.dueAt ? ` (due ${day(next.dueAt)})` : '';
    try {
      const job = engine.create({ dept: 'auto', depts: 'auto', title: oneLine(`Plan and deliver: ${next.title}`, 100), projectId: project.id, milestoneId: next.id, ownerId: project.ownerId || null, origin: { channel: 'project', projectId: project.id, milestoneId: next.id, planned: true },
        text: `Plan and deliver the milestone “${next.title}” of the project “${project.name}”${due}: read the project page and what the earlier tasks delivered, decide the work this milestone needs, delegate it to the teams, and close the task when the milestone is true.\n\nProject milestone: ${next.title}${due}.` });
      started.push(job.id);
    } catch {}
  }
  return started;
}
