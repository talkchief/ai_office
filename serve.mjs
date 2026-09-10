// Cloud AI Office — the server. The office runs on any chat model you configure in Settings → Models & keys:
// the Program Manager delegates to department leads, leads delegate to specialists, and anything that
// would leave the office waits for the CEO. State lives in data/ (SQLite + JSON); the Brain is a folder of notes.
//
//   npm start            → http://localhost:4520
//   PORT=4600 npm start  → another port
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { loadConfig, ROOT } from './config.mjs';
import { layoutGraph } from './graph-build.mjs';
import * as mcp from './mcp.mjs';
import { loadRoster } from './roster.mjs';
import * as routines from './routines.mjs';
import { parseWhen, valid as validWhen, untilText } from './src/when.js';
import { normModel, normEffort } from './src/models.js';
import { createOfficeAccess, sameOrigin } from './auth.mjs';
import { OfficeStore } from './office-store.mjs';
import { ToolStore } from './tool-store.mjs';
import { KnowledgeStore } from './knowledge.mjs';
import { ModelRegistry } from './models.mjs';
import { SettingsStore } from './settings.mjs';
import { EventBus } from './sse.mjs';
import { ToolHub } from './engine/tools.mjs';
import { OfficeEngine } from './engine/deep-agents.mjs';
import { chatPrompt, pmChatPrompt } from './engine/prompts.mjs';
import { runMigrations } from './migrations.mjs';
import { OfficeMemory } from './office-memory.mjs';
import { ProjectStore } from './projects.mjs';
import { KnowledgeIndex } from './knowledge-index.mjs';
import { Agency } from './agency.mjs';
import { AuditLog } from './audit.mjs';
import { Scheduler } from './scheduler.mjs';
import { listShape } from './server/shape.mjs';
import { Router, json, httpError } from './server/routes.mjs';
import { registerApi } from './server/api.mjs';
import { VaultStore } from './vault.mjs';
import { readJsonBody as body } from './http-body.mjs';

const cfg = loadConfig();
const HTML = process.env.AO_HTML || path.join(ROOT, 'dist', 'command-centre-v2.html');
const DATA = process.env.AO_DATA || path.join(ROOT, 'data');
const BRAIN = cfg.brainPath, NOTES_DIR = path.join(BRAIN, 'Agents Office');
const version = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '?'; } })();
const flat = content => typeof content === 'string' ? content : Array.isArray(content) ? content.map(p => typeof p === 'string' ? p : p?.text || '').join('') : '';

const office = new OfficeStore({ dataDir: DATA, initialAgents: loadRoster(BRAIN).agents });
const settings = new SettingsStore({ dataDir: DATA });
const models = new ModelRegistry({ dataDir: DATA });
const bus = new EventBus();
let graph = { notes: 0, nodes: [], links: [], floor: [] };
async function rebuildGraph() { try { graph = await layoutGraph(BRAIN); bus.publish('brain.updated', { notes: graph.notes }); } catch (e) { console.warn('brain graph failed:', e.message); } return graph; }
const knowledge = new KnowledgeStore(BRAIN, rebuildGraph);
const projects = new ProjectStore({ dataDir: DATA, office });
const index = await new KnowledgeIndex({ dir: path.join(DATA, 'knowledge-index'), store: knowledge }).open();
index.attach();
let hub;
const toolStore = new ToolStore({ dataDir: DATA, office, statusFor: id => hub?.status[id] || 'unchecked' });
hub = new ToolHub({ items: () => toolStore.items, settings: () => settings.get(), authProviderFor: item => toolStore.authProviderFor(item), busy: () => { try { return engine.running.size > 0; } catch { return false; } } });
toolStore.onChange = () => { hub.load().then(() => bus.publish('office.updated', { area: 'tools' })).catch(e => console.warn('connectors:', e.message)); };
const officeAccess = createOfficeAccess(process.env.AO_ACCESS_KEY);
const unlockAttempts = new Map();

const vault = new VaultStore({ dataDir: DATA });
const engine = new OfficeEngine({ dataDir: DATA, office, models, toolHub: hub, vault, toolLabels: () => Object.fromEntries(toolStore.list().map(t => [t.id, t.name])), memoryFactory: db => new OfficeMemory({ db, office, tools: () => toolStore.list(), projects: () => projects.summary({ tasks: () => engine.list() }), name: cfg.name }), projectFor: id => { const p = projects.get(id); return p ? { ...p, brief: projects.brief(p) } : null; }, brain: { save: input => knowledge.save(input), read: id => knowledge.read(id) }, knowledgeDir: BRAIN, knowledgeIndex: index, bus, name: cfg.name, settings: () => settings.get(),
  onChange: job => bus.publish('task.updated', listShape(job, office.get())),
  onComplete: async job => {
    if (job.kind === 'evaluation') return;
    const o = office.get(), lead = o.agents.find(a => a.id === o.teams.find(t => t.id === job.dept)?.lead)?.name || 'the team lead';
    const version = job.resultVersions?.at(-1);
    // Filed through the store so the Brain graph and the search index both see the result.
    await knowledge.writeNote(`Agents Office/task-${job.id}.md`, `# ${job.title}\n\nTask: ${job.id} · Teams: ${job.depts.map(d => o.teams.find(t => t.id === d)?.name || d).join(', ')} · Version ${version?.n || 1} · Filed: ${new Date().toISOString()}\n\nCEO request: ${job.text}\n\n${job.result}\n\n---\nApproved by ${lead}. ${job.review?.summary || ''}\n`);
  } });

const audit = new AuditLog({ db: engine.db, bus });
// The minute clock: overdue notices, reminders for anything waiting on the CEO, and the daily digest (built from records, no model cost).
const scheduler = new Scheduler({ engine, office, settings: () => settings.get(), onDigest: async report => {
  const id = `Digests/${report.date}.md`;
  await knowledge.save({ id, content: report.markdown });
  engine.notifications.notify({ kind: 'digest', title: `Daily digest · ${report.date}`, body: report.headline, action: { type: 'note', id } });
} });

/* ---------- routines: the office's own clock ---------- */
const RSTATE = routines.loadState(DATA);
let rlist = { routines: [], problems: [], path: routines.file(BRAIN) };
function loadRoutines() {
  const r = routines.load(BRAIN, office.agents());
  if (r.problems.join() !== rlist.problems.join()) for (const w of r.problems) console.warn('routines:', w);
  rlist = r; const { list, changed } = routines.withState(r.routines, RSTATE); if (changed) routines.saveState(DATA, RSTATE); return list;
}
function fire(r, { due = Date.now(), late = false, by = 'routine' } = {}) {
  const job = engine.create({ dept: r.dept, text: r.text, title: r.title, requireHumanApproval: r.needsOk, routine: { id: r.id, due, late, by, model: r.model, effort: r.effort } });
  routines.advance(RSTATE, r, Date.now(), job.id, late); routines.saveState(DATA, RSTATE); return job;
}
function tickRoutines() {
  if (!models.ready()) return;
  let list; try { list = loadRoutines(); } catch (e) { console.warn('routines:', e.message); return; }
  for (const { routine, due, late } of routines.due(list, RSTATE)) fire(routine, { due, late });
}
const edit = (id, patch) => { const r = rlist.routines.find(x => x.id === id); if (!r) throw httpError('No such routine.', 404); Object.assign(r, patch); routines.save(BRAIN, rlist.routines); return loadRoutines().find(x => x.id === id); };
async function makeRoutine({ dept, text, when, agent, needsOk, model, effort }) {
  let taskText = String(text || '').trim(), w = when, parsed = null;
  if (!office.team(dept)) return { error: 'Choose a team.' };
  if (!w) {
    parsed = parseWhen(taskText);
    if (!parsed) return { error: 'No schedule in that sentence. Say when: "every weekday at 8am, …", "Mondays 9am, …".', noSchedule: true };
    if (parsed.needsDay) return { error: 'Which day? Say "every Monday …" or "Mon and Thu …".', needsDay: true };
    if (parsed.needsTime) return { error: 'What time? Say "… at 8am" or "… at 17:30".', needsTime: true };
    w = parsed.when; taskText = parsed.text;
  }
  if (!validWhen(w) || !taskText) return { error: 'That routine needs a complete schedule and a task.' };
  loadRoutines();
  const lead = office.team(dept).lead, owner = agent && office.agents().some(a => a.id === agent && a.department === dept) ? agent : lead;
  let id = taskText.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'routine'; for (let n = 2; rlist.routines.some(r => r.id === id); n++) id = id.replace(/-\d+$/, '') + '-' + n;
  const v = routines.validate({ id, dept, agent: owner, title: taskText.slice(0, 90), text: taskText, when: w, needsOk: typeof needsOk === 'boolean' ? needsOk : routines.guessNeedsOk(taskText), model: normModel(model) || undefined, effort: normEffort(effort) || undefined }, office.agents(), rlist.routines);
  if (v.problems.length) return { error: v.problems.join('; ') };
  rlist.routines.push(v.routine); routines.save(BRAIN, rlist.routines);
  return { ok: true, routine: loadRoutines().find(x => x.id === v.routine.id), guessed: parsed?.guessed ? parsed.guessWord : null };
}
const routineApi = {
  out: () => ({ routines: loadRoutines(), depts: office.get().teams.map(t => t.id), path: rlist.path, problems: rlist.problems }),
  make: async input => { const r = await makeRoutine(input); if (r.ok) audit.record({ area: 'routines', summary: `Added routine “${r.routine.title}”` }); return r; },
  remove: id => { const gone = rlist.routines.find(x => x.id === id); rlist.routines = rlist.routines.filter(x => x.id !== id); routines.save(BRAIN, rlist.routines); if (gone) audit.record({ area: 'routines', summary: `Removed routine “${gone.title}”` }); return { ok: true, routines: loadRoutines() }; },
  patch: (id, b) => { const patch = {}; if (typeof b.needsOk === 'boolean') patch.needsOk = b.needsOk; if (typeof b.paused === 'boolean') patch.paused = b.paused; if (typeof b.text === 'string' && b.text.trim()) patch.text = b.text.trim(); if (typeof b.title === 'string' && b.title.trim()) patch.title = b.title.trim().slice(0, 90); if (b.when && validWhen(b.when)) patch.when = b.when; if (b.model !== undefined) patch.model = normModel(b.model) || ''; if (b.effort !== undefined) patch.effort = normEffort(b.effort) || ''; const before = structuredClone(rlist.routines.find(x => x.id === id)); edit(id, patch); audit.record({ area: 'routines', summary: `Edited routine “${before?.title || id}”`, before, after: rlist.routines.find(x => x.id === id) }); return { ok: true, routines: loadRoutines() }; },
  run: id => { const r = loadRoutines().find(x => x.id === id); if (!r) throw httpError('No such routine.', 404); return { ok: true, task: fire(r, { by: 'you' }), routines: loadRoutines() }; },
  pause: (id, paused) => { const r = edit(id, { paused }); audit.record({ area: 'routines', summary: `${paused ? 'Paused' : 'Resumed'} routine “${r?.title || id}”` }); return { ok: true, routines: loadRoutines() }; },
};
async function routinesChat(a, text) {
  const t = String(text).trim(), dept = a.department, teamName = office.team(dept)?.name || dept;
  if (/^\s*(routines?|schedule|timetable)\s*\??\s*$/i.test(t)) return { reply: routines.listText(loadRoutines(), dept, office.agents(), teamName) };
  const p = parseWhen(t); if (!p) return null;
  if (p.needsDay || p.needsTime || !p.text) return { reply: p.needsDay ? 'Which day? Say it again with the day.' : p.needsTime ? 'What time? Say it again with the time.' : 'I have the time but not the task.' };
  const made = await makeRoutine({ dept, text: p.text, when: p.when, agent: a.lead ? undefined : a.id });
  if (made.error) return { reply: made.error };
  return { reply: `Done: “${made.routine.title}” runs ${made.routine.desc}. Next run ${untilText(made.routine.nextAt)}.${made.routine.needsOk ? ' The result waits for your approval before it is filed.' : ''}`, routine: made.routine };
}

/* ---------- chat ---------- */
const PM = { id: 'pm', name: 'Program Manager', role: 'Program Manager', does: 'Plans work across the teams, delegates to the department leads and closes tasks once the leads approve.', department: null, lead: true };
async function chatModel(agent, team) { const spec = models.resolve({ agent, team, role: 'chat' }); return models.instance({ model: spec.model, effort: spec.effort, streaming: false, maxTokens: 2000 }); }
// A question about a task is answered from its record and filed in the task's thread; the work is not reopened.
async function answerAbout(a, team, job, question) {
  const context = [`Task: ${job.title} (${job.state}).`, `Brief: ${job.text.slice(0, 2000)}`, job.progressLine ? `Latest progress: ${job.progressLine}` : '', job.review?.summary ? `Lead review: ${job.review.summary.slice(0, 800)}` : '',
    (job.runs || []).length ? `Assignments: ${job.runs.map(r => `${r.title} — ${r.state}`).join('; ').slice(0, 1500)}` : '', job.result ? `Latest result (excerpt):\n${job.result.slice(0, 6000)}` : ''].filter(Boolean).join('\n');
  const model = await chatModel(a, team);
  const answer = await model.invoke([new SystemMessage(`You are ${a.name}, ${a.role}. The CEO is asking about one task. Answer briefly and concretely from this record; say what you do not know. Do not start new work.\n\n${context}`), new HumanMessage(question)], { signal: AbortSignal.timeout(120000) });
  return flat(answer.content).trim() || 'I do not have an answer to that yet.';
}
// A message about a task is kept in the task's thread and also in the person's chat, so the chat shows it when reopened.
function keepInChat(agentId, message, reply, jobId) {
  const thread = engine.threads.ensure('agent', agentId);
  engine.threads.append(thread, { role: 'ceo', agent: agentId, text: message, jobId });
  engine.threads.append(thread, { role: 'agent', agent: agentId, text: reply, jobId });
}
async function chat({ agent: agentId, text, taskId, kind, refs = [], remember = null }) {
  const message = String(text || '').trim(); if (!message) throw httpError('Write a message first.');
  const o = office.get(), isPm = agentId === 'pm', a = isPm ? PM : o.agents.find(x => x.id === agentId); if (!a) throw httpError('Unknown agent.');
  const team = isPm ? null : o.teams.find(t => t.id === a.department), isLead = !isPm && team?.lead === a.id;
  if (!models.ready()) throw httpError('Add a model key in Settings → Models & keys before chatting with the team.', 409);
  if (taskId) {
    const job = engine.get(taskId); if (!job) throw httpError('No such task.', 404);
    if (kind === 'question') {
      engine.message(taskId, { text: message, kind: 'question', agent: a.id, refs });
      const reply = await answerAbout(a, team, job, message);
      engine.threads.append(taskId, { role: 'agent', agent: a.id, kind: 'answer', text: reply, jobId: taskId });
      keepInChat(a.id, message, reply, taskId);
      return { reply, taskId };
    }
    if (!isLead && !isPm) throw httpError('Corrections go through the team lead. Open the lead’s chat to send this.', 409);
    const result = engine.message(taskId, { text: message, kind: kind === 'note' ? 'note' : 'correction', agent: a.id, refs, remember: ['agent', 'team'].includes(remember) ? remember : null });
    const reply = result.queued ? 'Noted. The team gets this at its next step.' : isPm ? 'On it. I have sent this back to the team and will close it again after the lead approves.' : `On it. I have sent this back to the ${team.name} team and will review the new version before it comes back to you.`;
    keepInChat(a.id, message, reply, taskId);
    return { reply, taskId, delegated: true };
  }
  if (!isPm) { const rc = await routinesChat({ ...a, lead: isLead }, message); if (rc) return { reply: rc.reply, routine: rc.routine || null, routines: true }; }
  const question = /\?\s*$/.test(message) || /^(hi|hello|hey|thanks|thank you|what|who|why|how|when|where|which|can you|could you|do you|does|is|are|should)\b/i.test(message);
  if (isPm && !question) { const job = engine.create({ depts: 'auto', text: message, dept: 'auto' }); return { reply: 'I have taken this on. I will bring in the right team leads and close it once they approve the work.', taskId: job.id, delegated: true }; }
  if (isLead && !question) { const job = engine.create({ dept: a.department, text: message }); return { reply: `I have taken this on for the ${team.name} team. I will plan it, delegate it and review the result before it comes back to you.`, taskId: job.id, delegated: true }; }
  const thread = engine.threads.ensure('agent', a.id);
  engine.threads.append(thread, { role: 'ceo', agent: a.id, text: message });
  const model = await chatModel(a, team);
  const hits = index.search(message, { k: settings.get().knowledgeSeedNotes || 6 }), memory = { notes: hits.map(h => h.path), text: hits.map(h => `--- ${h.path}${h.heading ? ' › ' + h.heading : ''} ---\n${h.snippet}`).join('\n\n') };
  const recent = engine.list().filter(j => isPm ? !['cancelled'].includes(j.state) : (j.runs || []).some(r => r.agent === a.id) || j.agent === a.id).slice(0, isPm ? 10 : 6).map(j => `- [${j.state}] ${j.title}`).join('\n');
  const system = (isPm ? pmChatPrompt({ office: o, name: cfg.name, recentTasks: recent }) : chatPrompt({ office: o, team, agent: { ...a, lead: isLead }, name: cfg.name, recentTasks: recent })) + `\n\nBrain notes that may help (cite their paths):\n${memory.text || '—'}`;
  const history = engine.threads.list(thread).slice(-12).map(m => m.role === 'ceo' ? new HumanMessage(m.text) : new AIMessage(m.text));
  const answer = await model.invoke([new SystemMessage(system), ...history], { signal: AbortSignal.timeout(120000) });
  const reply = flat(answer.content).trim() || 'I do not have an answer to that yet.';
  engine.threads.append(thread, { role: 'agent', agent: a.id, text: reply });
  return { reply, read: memory.notes, threadId: thread, suggestedTask: question || isLead || isPm ? null : { dept: a.department, text: message, assignee: a.id } };
}

/* ---------- http ---------- */
const router = new Router();
// Every change to teams, people, skills, connectors or models rewrites the company pages agents read from /memories/.
bus.on(event => { if (event.type === 'office.updated') engine.memory?.refresh().catch(e => console.warn('memory:', e.message)); });
// The page every agent reads about a project, rewritten when the project or its tasks change (debounced per project).
const projectSyncTimers = new Map();
function syncProject(id) {
  clearTimeout(projectSyncTimers.get(id));
  projectSyncTimers.set(id, setTimeout(async () => {
    projectSyncTimers.delete(id);
    const p = projects.get(id); if (!p) return;
    try { await knowledge.writeNote(projects.pageId(p), projects.page(p, { teams: office.get().teams, tasks: engine.list().filter(j => j.projectId === id).map(j => listShape(j, office.get())), files: knowledge.list().filter(n => n.id.startsWith(projects.folder(p) + '/') && n.id !== projects.pageId(p)) })); }
    catch (error) { console.warn('project page:', error.message); }
  }, 1500));
}
bus.on(event => { if (event.type === 'task.updated' && event.data?.projectId) syncProject(event.data.projectId); });
for (const p of projects.list()) syncProject(p.id);
registerApi(router, { projects, syncProject, office, engine, models, settings, toolStore, hub, knowledge, index, bus, audit, vault, routines: routineApi, chat, version, name: cfg.name, graph: () => graph, discover: () => mcp.discover({ timeout: 15000 }), agency: new Agency() });
const oauthPage = (title, text) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px system-ui;padding:40px;max-width:520px"><h1 style="font-size:20px">${title}</h1><p>${text}</p><p><a href="/">Back to the office</a></p><script>setTimeout(()=>{if(window.opener){window.opener.postMessage('connector-signed-in','*');window.close();}},1200)</script>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    const secure = !!req.socket.encrypted || (loopback && req.headers['x-forwarded-proto'] === 'https');
    const local = loopback && !req.headers['x-forwarded-for'] && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '');
    const origin = settings.get().publicOrigin || `${secure ? 'https' : 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
    const api = url.pathname.startsWith('/api/');
    if (api) res.setHeader('Cache-Control', 'no-store');
    if (api && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !sameOrigin(req)) return json(res, 403, { error: 'Requests must come from this office.' });
    // Liveness for containers and monitors, before the access code: says the office is up and whether a model is ready, nothing more.
    if (url.pathname === '/api/health' && req.method === 'GET' && !officeAccess.allowed(req)) return json(res, 200, { ok: true, version, ready: models.ready() });
    if (url.pathname === '/api/auth/status' && req.method === 'GET') return json(res, 200, { locked: !officeAccess.allowed(req), secure: secure || local, accessRequired: officeAccess.required, providersReady: models.ready() });
    if (url.pathname === '/api/auth/unlock' && req.method === 'POST') {
      if (!secure && !local) return json(res, 403, { error: 'Open this office over HTTPS before signing in.' });
      const peer = (loopback && req.headers['x-real-ip']) || req.socket.remoteAddress, now = Date.now();
      for (const [ip, attempt] of unlockAttempts) if (attempt.until < now) unlockAttempts.delete(ip);
      if (unlockAttempts.size > 2000 || unlockAttempts.get(peer)?.count >= 10) return json(res, 429, { error: 'Too many attempts. Try again in ten minutes.' });
      const input = await body(req);
      if (!officeAccess.matches(input.key)) { const attempt = unlockAttempts.get(peer) || { count: 0, until: now + 600000 }; attempt.count++; unlockAttempts.set(peer, attempt); return json(res, 401, { error: 'That office access code is not correct.' }); }
      unlockAttempts.delete(peer); res.setHeader('Set-Cookie', officeAccess.cookie(secure)); return json(res, 200, { ok: true });
    }
    // The connector's sign-in page redirects here without the office cookie (SameSite=Strict); the single-use state proves it.
    const callback = url.pathname.match(/^\/api\/tools\/([A-Za-z0-9_-]+)\/oauth\/callback$/);
    if (callback && req.method === 'GET') {
      try { const result = await toolStore.oauthCallback(callback[1], { code: url.searchParams.get('code'), state: url.searchParams.get('state') }); if (result.state === 'signed-in') audit.record({ area: 'tools', summary: `Signed in to connector ${callback[1]}` }); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(oauthPage(result.state === 'signed-in' ? 'Connector signed in' : 'Sign-in did not finish', result.state === 'signed-in' ? 'The office can now use this connector. You can close this tab.' : 'Start the sign-in again from Manage → Tools.')); }
      catch (error) { res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }); return res.end(oauthPage('Sign-in failed', String(error.message).replace(/[<>&]/g, ''))); }
    }
    if (api && !officeAccess.allowed(req)) return json(res, 401, { error: 'Unlock the office to continue.' });
    if (req.method === 'GET' && ['/', '/command-centre-v2.html', '/dark'].includes(url.pathname)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      let page = fs.readFileSync(HTML, 'utf8');
      if (officeAccess.allowed(req)) page = page.replace('<head>', '<head><script>window.__OFFICE_BOOT__=' + JSON.stringify(office.bootstrap()).replace(/</g, '\\u003c') + ';</script>');
      return res.end(url.pathname === '/dark' ? page.replace('<body>', '<body class="dark">') : page);
    }
    const match = api && router.match(req.method, url.pathname);
    if (match?.notAllowed) return json(res, 405, { error: 'Method not allowed.' });
    if (match) {
      const session = String(req.headers.cookie || '').match(/ao_session=([^;]+)/)?.[1]?.slice(-16) || req.socket.remoteAddress;
      const out = await match.handler({ req, res, url, params: match.params, secure, local, origin, session });
      if (out?.$handled) return;
      return out && out.$status ? json(res, out.$status, out.body) : json(res, 200, out ?? { ok: true });
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    if (res.headersSent) return;
    const status = e.status || 500; if (status >= 500) console.error(e);
    // A failure the code named on purpose (an upstream provider that would not answer, 502) keeps its message; an unexpected one stays generic.
    json(res, status, { error: status >= 500 && !e.status ? 'Something went wrong on the server. Try again; if it repeats, check the service log.' : e.message });
  }
});

const migrated = await runMigrations({ engine, office, knowledge, brainPath: BRAIN });
if (migrated.jobs || migrated.office || migrated.skills || migrated.conversations) console.log(`  upgraded: ${migrated.jobs} tasks, office file ${migrated.office ? 'rewritten' : 'current'}, ${migrated.skills} Brain skills imported, ${migrated.conversations} chat notes archived`);
await rebuildGraph();
const indexed = index.sync(); console.log(`  Brain search: ${indexed.backend}, ${indexed.notes} notes (${indexed.indexed} refreshed, ${indexed.removed} removed)`);
engine.recover();
hub.load().then(() => engine.memory?.refresh()).then(() => console.log(`  connectors: ${Object.values(hub.status).filter(s => s === 'connected').length} of ${Object.keys(hub.status).length} connected`)).catch(e => console.warn('connectors:', e.message));
mcp.discover({ timeout: 15000 }).catch(() => {});
server.listen(cfg.port, process.env.HOST || undefined, () => {
  console.log(`Cloud AI Office ${version} → http://localhost:${cfg.port}`);
  console.log(`  business: ${cfg.name}   brain: ${BRAIN} (${graph.notes} notes)   models: ${models.ready() ? 'ready' : 'no provider key yet — add one in Settings → Models & keys'}`);
  console.log(`  tasks: ${path.join(DATA, 'workflows.sqlite')}   routines: ${loadRoutines().length} loaded`);
  setInterval(tickRoutines, 20000).unref(); tickRoutines(); scheduler.start(60000);
});
process.on('unhandledRejection', reason => engine.fault('unhandled rejection', reason));
process.on('uncaughtException', error => engine.fault('uncaught exception', error));
process.on('SIGTERM', async () => { scheduler.stop(); bus.close(); index.close(); await engine.close(); await hub.close(); server.close(() => process.exit(0)); });
