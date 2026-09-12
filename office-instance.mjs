// One office: every store, the engine, the routines, the chat and the API router for a single data folder and Brain.
// serve.mjs builds one of these for the single office it serves; hosted mode (later) builds one per tenant.
// `boot()` upgrades, indexes and recovers; `start()` starts the clocks; `close()` stops everything and closes the files.
import path from 'node:path';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { layoutGraph } from './graph-build.mjs';
import * as mcp from './mcp.mjs';
import { loadRoster } from './roster.mjs';
import * as routines from './routines.mjs';
import { parseWhen, valid as validWhen, untilText } from './src/when.js';
import { normModel, normEffort } from './src/models.js';
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
import { startNextMilestone, loadPlanningSkills } from './project-planner.mjs';
import { summariseProject, loadSummarySkills, SUMMARY_SKILLS } from './project-summary.mjs';
import { ROOT } from './config.mjs';
import { KnowledgeIndex } from './knowledge-index.mjs';
import { Agency } from './agency.mjs';
import { AuditLog } from './audit.mjs';
import { Scheduler } from './scheduler.mjs';
import { listShape } from './server/shape.mjs';
import { Router, httpError } from './server/routes.mjs';
import { isAdmin } from './server/visibility.mjs';
import { registerApi } from './server/api.mjs';
import { VaultStore } from './vault.mjs';

const flat = content => typeof content === 'string' ? content : Array.isArray(content) ? content.map(p => typeof p === 'string' ? p : p?.text || '').join('') : '';
const PM = { id: 'pm', name: 'Program Manager', role: 'Program Manager', does: 'Plans work across the teams, delegates to the department leads and closes tasks once the leads approve.', department: null, lead: true };

/**
 * Builds an office on `dataDir` (SQLite + JSON) and `brainDir` (the notes).
 * `models`: an existing ModelRegistry to share (hosted mode), else one is built on dataDir/providers.json.
 * `discovery`: whether this machine's Claude Code connectors are looked up (`claude mcp list`); off in tests and hosted mode.
 * `agency`: a shared Agency catalogue; `log`: where start-up lines go.
 * `tenant` (hosted): { id, slug, name, ownerId, viewers(), audience(sharedWith) } — the company this office belongs to; null for a single office.
 */
export async function createOfficeInstance({ dataDir, brainDir, cfg, name = cfg?.name || 'My Office', version = '?', models = null, agency = new Agency(), discovery = true, allowStdio = true, limits = undefined, tenant = null, log = console.log }) {
  const DATA = dataDir, BRAIN = brainDir, managedModels = !!models;
  const office = new OfficeStore({ dataDir: DATA, initialAgents: loadRoster(BRAIN).agents, limits });
  const settings = new SettingsStore({ dataDir: DATA });
  models ||= new ModelRegistry({ dataDir: DATA });
  const bus = new EventBus();
  let graph = { notes: 0, nodes: [], links: [], floor: [] };
  async function rebuildGraph() { try { graph = await layoutGraph(BRAIN); bus.publish('brain.updated', { notes: graph.notes }); } catch (e) { console.warn('brain graph failed:', e.message); } return graph; }
  const knowledge = new KnowledgeStore(BRAIN, rebuildGraph);
  const projects = new ProjectStore({ dataDir: DATA, office });
  const index = await new KnowledgeIndex({ dir: path.join(DATA, 'knowledge-index'), store: knowledge }).open();
  index.attach();
  const discover = discovery ? () => mcp.discover({ timeout: 15000 }) : () => Promise.resolve([]);
  let hub;
  const toolStore = new ToolStore({ dataDir: DATA, office, statusFor: id => hub?.status[id] || 'unchecked', allowStdio, ...(discovery ? {} : { discover, summary: () => ({ servers: [] }) }) });
  hub = new ToolHub({ items: () => toolStore.items, settings: () => settings.get(), authProviderFor: item => toolStore.authProviderFor(item), busy: () => { try { return engine.running.size > 0; } catch { return false; } } });
  toolStore.onChange = () => { hub.load().then(() => bus.publish('office.updated', { area: 'tools' })).catch(e => console.warn('connectors:', e.message)); };

  const vault = new VaultStore({ dataDir: DATA });
  const engine = new OfficeEngine({ dataDir: DATA, office, models, toolHub: hub, vault, toolLabels: () => Object.fromEntries(toolStore.list().map(t => [t.id, t.name])), memoryFactory: db => new OfficeMemory({ db, office, tools: () => toolStore.list(), projects: () => projects.summary({ tasks: () => engine.list() }), name }), projectFor: id => { const p = projects.get(id); return p ? { ...p, brief: projects.brief(p), next: projects.nextMilestone(p) } : null; }, brain: { save: input => knowledge.save(input), read: id => knowledge.read(id) }, knowledgeDir: BRAIN, knowledgeIndex: index, bus, name, settings: () => settings.get(),
    onChange: job => bus.publish('task.updated', listShape(job, office.get())),
    onComplete: async job => {
      if (job.kind === 'evaluation') return;
      const o = office.get(), lead = o.agents.find(a => a.id === o.teams.find(t => t.id === job.dept)?.lead)?.name || 'the team lead';
      const version = job.resultVersions?.at(-1);
      // Filed through the store so the Brain graph and the search index both see the result.
      await knowledge.writeNote(`Agents Office/task-${job.id}.md`, `# ${job.title}\n\nTask: ${job.id} · Teams: ${job.depts.map(d => o.teams.find(t => t.id === d)?.name || d).join(', ')} · Version ${version?.n || 1} · Filed: ${new Date().toISOString()}\n\nCEO request: ${job.text}\n\n${job.result}\n\n---\nApproved by ${lead}. ${job.review?.summary || ''}\n`);
      // A project task marks its milestones achieved and the project page is rewritten.
      if (job.projectId) { try { const marked = projects.recordCompletion({ ...job, state: 'done', doneAt: job.doneAt || Date.now() }, { tasks: engine.list().filter(j => j.projectId === job.projectId) }); if (marked.length) { engine.event(job.id, 'milestones_achieved', null, `Milestone${marked.length === 1 ? '' : 's'} achieved: ${marked.map(m => m.title).join(', ')}.`); audit.record({ area: 'projects', summary: `${job.projectName || job.projectId}: milestone${marked.length === 1 ? '' : 's'} achieved by “${job.title}”: ${marked.map(m => m.title).join(', ')}` }); const started = startNextMilestone({ project: projects.get(job.projectId), projects, engine }); if (started.length) engine.event(job.id, 'milestone_started', null, `The next milestone is under way: ${started.length} task${started.length === 1 ? '' : 's'}${started.some(id => engine.get(id)?.origin?.planned) ? ', the Program Manager plans it' : ''}.`); }
        const finished = projects.settle(job.projectId, { tasks: engine.list().map(j => j.id === job.id ? { ...j, state: 'done' } : j) });
        if (finished) {
          engine.event(job.id, 'project_done', null, `Project “${finished.name}” is complete: every milestone achieved.`); audit.record({ area: 'projects', summary: `Project “${finished.name}” is complete: every milestone achieved` });
          // The Program Manager closes it for the CEO: one summary with what was delivered and where to open it.
          let headline = '';
          try { headline = (await writeProjectSummary(finished.id, { reason: 'the project completed' })).headline; } catch (error) { console.warn('project summary:', error.message); }
          engine.notifications.notify({ kind: 'done', title: `Project complete: ${finished.name}`, body: headline || 'Every milestone is achieved and no task is open.', jobId: job.id, dept: job.dept, dedupe: `project-done:${finished.id}`, action: { type: 'open' }, userId: job.ownerId || null });
          bus.publish('office.updated', { area: 'projects' });
        }
        syncProject(job.projectId); } catch (error) { console.warn('project milestones:', error.message); } }
    } });

  const audit = new AuditLog({ db: engine.db, bus });
  // The minute clock: overdue notices, reminders for anything waiting on the CEO, and the daily digest (built from records, no model cost).
  const scheduler = new Scheduler({ engine, office, settings: () => settings.get(), viewers: tenant?.viewers || null, projectFor: id => projects.get(id), routines: () => { try { return loadRoutines(); } catch { return []; } }, onDigest: async report => {
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
    const job = engine.create({ dept: r.dept, text: r.text, title: r.title, requireHumanApproval: r.needsOk, routine: { id: r.id, due, late, by, model: r.model, effort: r.effort }, ownerId: r.ownerId || tenant?.ownerId || null, origin: { channel: 'routine', routineId: r.id } });
    routines.advance(RSTATE, r, Date.now(), job.id, late); routines.saveState(DATA, RSTATE); return job;
  }
  function tickRoutines() {
    if (!models.ready()) return;
    let list; try { list = loadRoutines(); } catch (e) { console.warn('routines:', e.message); return; }
    for (const { routine, due, late } of routines.due(list, RSTATE)) fire(routine, { due, late });
    // The steward: what became of the last firing of each routine.
    const { changed, notices } = routines.steward(list, RSTATE, engine.list(), Date.now());
    if (changed) routines.saveState(DATA, RSTATE);
    for (const n of notices) {
      engine.event(n.job.id, 'routine_missed', null, `Routine “${n.routine.title}” did not complete: ${n.reason}.`);
      engine.notifications.notify({ kind: 'routine_failed', title: `${n.failures >= 2 ? 'Routine missed twice' : 'Routine did not complete'}: ${n.routine.title}`, body: `${n.reason}. Open the task and fix what stopped it, or run the routine now under Settings → Routines.`, jobId: n.job.id, dept: n.routine.dept, dedupe: `routine-missed:${n.routine.id}:${n.job.id}`, action: { type: 'open' }, userId: n.routine.ownerId || tenant?.ownerId || null });
      if (n.routine.followUp && n.failures >= 2) { try { engine.create({ dept: n.routine.dept, text: `Routine "${n.routine.title}" did not complete twice in a row (last time: ${n.reason}). Find out why, get the work done, and say what should change so it runs on schedule.`, title: `Follow up: ${n.routine.title}`.slice(0, 100), priority: 2, ownerId: n.routine.ownerId || tenant?.ownerId || null, origin: { channel: 'routine', routineId: n.routine.id, followUp: 'true' } }); } catch (error) { console.warn('routine follow-up:', error.message); } }
    }
  }
  const edit = (id, patch) => { const r = rlist.routines.find(x => x.id === id); if (!r) throw httpError('No such routine.', 404); Object.assign(r, patch); routines.save(BRAIN, rlist.routines); return loadRoutines().find(x => x.id === id); };
  // A routine is changed by whoever made it or an office admin; a single office has one owner.
  const routineEditor = (id, user) => { const r = rlist.routines.find(x => x.id === id); if (!r) throw httpError('No such routine.', 404); if (user && !isAdmin(user) && r.ownerId && r.ownerId !== user.id) throw httpError('This routine belongs to someone else. Ask them or an office admin.', 403); return r; };
  async function makeRoutine({ dept, text, when, agent, needsOk, model, effort, ownerId = null }) {
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
    const v = routines.validate({ id, dept, agent: owner, title: taskText.slice(0, 90), text: taskText, when: w, needsOk: typeof needsOk === 'boolean' ? needsOk : routines.guessNeedsOk(taskText), model: normModel(model) || undefined, effort: normEffort(effort) || undefined, ownerId: ownerId || undefined }, office.agents(), rlist.routines);
    if (v.problems.length) return { error: v.problems.join('; ') };
    rlist.routines.push(v.routine); routines.save(BRAIN, rlist.routines);
    return { ok: true, routine: loadRoutines().find(x => x.id === v.routine.id), guessed: parsed?.guessed ? parsed.guessWord : null };
  }
  const routineApi = {
    out: () => ({ routines: loadRoutines(), depts: office.get().teams.map(t => t.id), path: rlist.path, problems: rlist.problems }),
    make: async (input, user = null) => { const r = await makeRoutine({ ...input, ownerId: user?.id || null }); if (r.ok) audit.record({ area: 'routines', summary: `Added routine “${r.routine.title}”` }); return r; },
    remove: (id, user = null) => { loadRoutines(); const gone = rlist.routines.find(x => x.id === id); if (gone) routineEditor(id, user); rlist.routines = rlist.routines.filter(x => x.id !== id); routines.save(BRAIN, rlist.routines); if (gone) audit.record({ area: 'routines', summary: `Removed routine “${gone.title}”` }); return { ok: true, routines: loadRoutines() }; },
    patch: (id, b, user = null) => { loadRoutines(); routineEditor(id, user); const patch = {}; if (typeof b.needsOk === 'boolean') patch.needsOk = b.needsOk; if (typeof b.paused === 'boolean') patch.paused = b.paused; if (typeof b.text === 'string' && b.text.trim()) patch.text = b.text.trim(); if (typeof b.title === 'string' && b.title.trim()) patch.title = b.title.trim().slice(0, 90); if (b.when && validWhen(b.when)) patch.when = b.when; if (b.model !== undefined) patch.model = normModel(b.model) || ''; if (b.effort !== undefined) patch.effort = normEffort(b.effort) || ''; const before = structuredClone(rlist.routines.find(x => x.id === id)); edit(id, patch); audit.record({ area: 'routines', summary: `Edited routine “${before?.title || id}”`, before, after: rlist.routines.find(x => x.id === id) }); return { ok: true, routines: loadRoutines() }; },
    run: (id, user = null) => { const r = loadRoutines().find(x => x.id === id); if (!r) throw httpError('No such routine.', 404); routineEditor(id, user); return { ok: true, task: fire(r, { by: 'you' }), routines: loadRoutines() }; },
    pause: (id, paused, user = null) => { loadRoutines(); routineEditor(id, user); const r = edit(id, { paused }); audit.record({ area: 'routines', summary: `${paused ? 'Paused' : 'Resumed'} routine “${r?.title || id}”` }); return { ok: true, routines: loadRoutines() }; },
  };
  async function routinesChat(a, text, user = null) {
    const t = String(text).trim(), dept = a.department, teamName = office.team(dept)?.name || dept;
    if (/^\s*(routines?|schedule|timetable)\s*\??\s*$/i.test(t)) return { reply: routines.listText(loadRoutines(), dept, office.agents(), teamName) };
    const p = parseWhen(t); if (!p) return null;
    if (p.needsDay || p.needsTime || !p.text) return { reply: p.needsDay ? 'Which day? Say it again with the day.' : p.needsTime ? 'What time? Say it again with the time.' : 'I have the time but not the task.' };
    const made = await makeRoutine({ dept, text: p.text, when: p.when, agent: a.lead ? undefined : a.id, ownerId: user?.id || null });
    if (made.error) return { reply: made.error };
    return { reply: `Done: “${made.routine.title}” runs ${made.routine.desc}. Next run ${untilText(made.routine.nextAt)}.${made.routine.needsOk ? ' The result waits for your approval before it is filed.' : ''}`, routine: made.routine };
  }

  // The company's name: what the owner typed under Manage → Profile, else the config file.
  const officeName = () => settings.get().officeName || name;

  /* ---------- chat ---------- */
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
  function keepInChat(agentId, message, reply, jobId, user = null) {
    const thread = engine.threads.ensure('agent', agentId, { userId: user?.id || null });
    engine.threads.append(thread, { role: 'ceo', agent: agentId, text: message, jobId });
    engine.threads.append(thread, { role: 'agent', agent: agentId, text: reply, jobId });
  }
  // `user` is who is chatting; the single office has one owner and passes nothing.
  async function chat({ agent: agentId, text, taskId, kind, refs = [], remember = null }, user = null) {
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
        keepInChat(a.id, message, reply, taskId, user);
        return { reply, taskId };
      }
      if (!isLead && !isPm) throw httpError('Corrections go through the team lead. Open the lead’s chat to send this.', 409);
      const result = engine.message(taskId, { text: message, kind: kind === 'note' ? 'note' : 'correction', agent: a.id, refs, remember: ['agent', 'team'].includes(remember) ? remember : null });
      const reply = result.queued ? 'Noted. The team gets this at its next step.' : isPm ? 'On it. I have sent this back to the team and will close it again after the lead approves.' : `On it. I have sent this back to the ${team.name} team and will review the new version before it comes back to you.`;
      keepInChat(a.id, message, reply, taskId, user);
      return { reply, taskId, delegated: true };
    }
    if (!isPm) { const rc = await routinesChat({ ...a, lead: isLead }, message, user); if (rc) return { reply: rc.reply, routine: rc.routine || null, routines: true }; }
    const question = /\?\s*$/.test(message) || /^(hi|hello|hey|thanks|thank you|what|who|why|how|when|where|which|can you|could you|do you|does|is|are|should)\b/i.test(message);
    const owned = { ownerId: user?.id || null, origin: { channel: 'chat', agent: a.id } };
    if (isPm && !question) { const job = engine.create({ depts: 'auto', text: message, dept: 'auto', ...owned }); return { reply: 'I have taken this on. I will bring in the right team leads and close it once they approve the work.', taskId: job.id, delegated: true }; }
    if (isLead && !question) { const job = engine.create({ dept: a.department, text: message, ...owned }); return { reply: `I have taken this on for the ${team.name} team. I will plan it, delegate it and review the result before it comes back to you.`, taskId: job.id, delegated: true }; }
    const thread = engine.threads.ensure('agent', a.id, { userId: user?.id || null });
    engine.threads.append(thread, { role: 'ceo', agent: a.id, text: message });
    const model = await chatModel(a, team);
    const hits = index.search(message, { k: settings.get().knowledgeSeedNotes || 6 }), memory = { notes: hits.map(h => h.path), text: hits.map(h => `--- ${h.path}${h.heading ? ' › ' + h.heading : ''} ---\n${h.snippet}`).join('\n\n') };
    const recent = engine.list().filter(j => isPm ? !['cancelled'].includes(j.state) : (j.runs || []).some(r => r.agent === a.id) || j.agent === a.id).slice(0, isPm ? 10 : 6).map(j => `- [${j.state}] ${j.title}`).join('\n');
    const system = (isPm ? pmChatPrompt({ office: o, name: officeName(), recentTasks: recent }) : chatPrompt({ office: o, team, agent: { ...a, lead: isLead }, name: officeName(), recentTasks: recent })) + `\n\nBrain notes that may help (cite their paths):\n${memory.text || '—'}`;
    const history = engine.threads.list(thread).slice(-12).map(m => m.role === 'ceo' ? new HumanMessage(m.text) : new AIMessage(m.text));
    const answer = await model.invoke([new SystemMessage(system), ...history], { signal: AbortSignal.timeout(120000) });
    const reply = flat(answer.content).trim() || 'I do not have an answer to that yet.';
    engine.threads.append(thread, { role: 'agent', agent: a.id, text: reply });
    return { reply, read: memory.notes, threadId: thread, suggestedTask: question || isLead || isPm ? null : { dept: a.department, text: message, assignee: a.id } };
  }

  /* ---------- writing help: a charter for a new team, a job and standing instructions for a person ---------- */
  async function assist({ kind, name: who = '', hint = '', role = '', teamName = '', teamPurpose = '' }) {
    if (!models.ready()) throw httpError('Add a model key in Settings → Models & keys first.', 409);
    const o = office.get(), s = v => String(v || '').trim().slice(0, 2000);
    let officePurpose = ''; try { officePurpose = knowledge.read('Knowledge/office-purpose.md').content.slice(0, 3000); } catch {}
    const teams = o.teams.map(t => `- ${t.name}: ${t.purpose}`).join('\n');
    const ask = kind === 'person'
      ? `Draft, for a person named "${s(who)}" with the role "${s(role)}" on the team "${s(teamName)}" (team purpose: ${s(teamPurpose) || 'not written yet'}): a job description of 2 or 3 sentences in the present tense saying what this person does and does not do, and standing instructions of 4 to 7 short lines (sources to use, tone, boundaries, when to stop and ask the lead). Reply as JSON only: {"does": "...", "brief": "..."}.`
      : `Draft the charter for a new team named "${s(who)}"${hint ? ` (the owner says: ${s(hint)})` : ''}: a purpose of 1 or 2 sentences saying what the team owns and what success looks like, and working instructions of 5 to 8 short lines (process, sources, tone, boundaries, and that anything outside its field is handed to the Program Manager). Do not repeat what the other teams own. Reply as JSON only: {"purpose": "...", "instructions": "..."}.`;
    const model = await chatModel(PM, null);
    const answer = await model.invoke([new SystemMessage(`You help the owner of ${officeName()} set up teams of AI agents. Write plainly and specifically for this company, addressing the team or the person as "you". No markdown, no headings, no bullets: plain lines separated by newlines inside the JSON strings.\n\nThe company:\n${officePurpose || '(no office purpose written yet)'}\n\nExisting teams:\n${teams || '—'}`), new HumanMessage(ask)], { signal: AbortSignal.timeout(90000) });
    const raw = flat(answer.content).trim(), m = raw.match(/\{[\s\S]*\}/);
    let out; try { out = JSON.parse(m ? m[0] : raw); } catch { throw httpError('The model did not return a usable draft. Try again.', 502); }
    return kind === 'person' ? { does: s(out.does), brief: String(out.brief || '').trim().slice(0, 6000) } : { purpose: s(out.purpose), instructions: String(out.instructions || '').trim().slice(0, 12000) };
  }

  /* ---------- the API router and the bus hooks ---------- */
  const router = new Router();
  // Every change to teams, people, skills, connectors or models rewrites the company pages agents read from /memories/.
  bus.on(event => { if (event.type === 'office.updated') engine.memory?.refresh().catch(e => console.warn('memory:', e.message)); });
  // The page every agent reads about a project, rewritten when the project or its tasks change (debounced per project).
  // After the engine has recovered: milestones reached by tasks that finished before the office recorded milestones (older projects)
  // are marked, and every active project has its next milestone under way.
  function settleProjects() {
    // Milestones reached by tasks that finished before the office recorded milestones (older projects) are marked now.
    try {
      const reached = projects.reconcile({ tasks: engine.list() });
      if (reached.length) { audit.record({ area: 'projects', summary: `Milestones achieved by finished tasks: ${reached.map(r => `${r.project} — ${r.milestone.title}`).join('; ')}` }); for (const id of new Set(reached.map(r => r.projectId))) { const finished = projects.settle(id, { tasks: engine.list() }); if (finished) audit.record({ area: 'projects', summary: `Project “${finished.name}” is complete: every milestone achieved` }); syncProject(id); } }
      // Every active project has its next milestone under way: its backlog tasks queued, or the Program Manager asked to plan it.
      for (const p of projects.list().filter(p => p.status === 'active')) { const started = startNextMilestone({ project: p, projects, engine }); if (started.length) { audit.record({ area: 'projects', summary: `${p.name}: the next milestone's ${started.length} task${started.length === 1 ? '' : 's'} under way` }); syncProject(p.id); } }
      // A project that finished while the office was down still gets its summary.
      for (const p of projects.list().filter(p => p.status === 'done' && !p.summary?.text)) writeProjectSummary(p.id, { reason: 'the project was already complete' }).catch(error => console.warn('project summary:', error.message));
    } catch (error) { console.warn('project milestones:', error.message); }
  }
  // The Program Manager's closing summary: what the CEO asked for, what exists now, where to open it. Written when a project
  // completes, and again whenever the CEO asks for it. One model call, with the office's executive-summary method.
  const summarising = new Set();
  async function writeProjectSummary(id, { reason = 'the project completed' } = {}) {
    const project = projects.get(id); if (!project) throw httpError('There is no such project.', 404);
    if (summarising.has(id)) throw httpError('The Program Manager is already writing this summary.', 409);
    summarising.add(id);
    try {
      const tasks = engine.list().filter(j => j.projectId === id);
      const artifacts = [];
      for (const t of tasks) { let own = []; try { own = engine.files(t.id) || []; } catch { own = []; } for (const f of own) artifacts.push({ taskId: t.id, taskTitle: t.title, name: f.name, bytes: f.bytes, modifiedAt: f.modifiedAt }); }
      const skills = loadSummarySkills({ dirs: [engine.pmSkillsDir || path.join(ROOT, 'agency', 'pm-skills'), path.join(engine.knowledgeDir, 'Agents Office', 'pm-skills')], names: SUMMARY_SKILLS });
      const summary = await summariseProject({ project, tasks, artifacts, skills, models });
      projects.recordSummary(id, summary);
      audit.record({ area: 'projects', summary: `The Program Manager summarised “${project.name}” (${reason}): ${summary.headline}` });
      syncProject(id); bus.publish('office.updated', { area: 'projects' });
      return summary;
    } finally { summarising.delete(id); }
  }
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
  registerApi(router, { projects, syncProject, writeProjectSummary, office, engine, models, settings, toolStore, hub, knowledge, index, bus, audit, vault, routines: routineApi, chat, assist, version, get name() { return officeName(); }, graph: () => graph, discover, agency, tenant, managedModels });
  // The raw routine records, for the one-time owner assignment when a self-hosted office moves into a tenant.
  const routineRecords = { list: () => { loadRoutines(); return rlist.routines; }, save: list => { rlist.routines = list; routines.save(BRAIN, list); loadRoutines(); } };

  /* ---------- lifecycle ---------- */
  let routineTimer = null, connecting = Promise.resolve();
  // Upgrades old records, indexes the Brain, recovers interrupted work and connects the connectors.
  async function boot() {
    const migrated = await runMigrations({ engine, office, knowledge, brainPath: BRAIN });
    if (migrated.jobs || migrated.office || migrated.skills || migrated.conversations) log(`  upgraded: ${migrated.jobs} tasks, office file ${migrated.office ? 'rewritten' : 'current'}, ${migrated.skills} Brain skills imported, ${migrated.conversations} chat notes archived`);
    await rebuildGraph();
    const indexed = index.sync(); log(`  Brain search: ${indexed.backend}, ${indexed.notes} notes (${indexed.indexed} refreshed, ${indexed.removed} removed)`);
    engine.recover();
    settleProjects();
    connecting = hub.load().then(() => engine.memory?.refresh()).then(() => log(`  connectors: ${Object.values(hub.status).filter(s => s === 'connected').length} of ${Object.keys(hub.status).length} connected`)).catch(e => console.warn('connectors:', e.message));
    discover().catch(() => {});
    return { migrated, indexed };
  }
  // The clocks: routines every 20 seconds, the scheduler every minute.
  function start() {
    if (routineTimer) return;
    routineTimer = setInterval(tickRoutines, 20000); routineTimer.unref?.(); tickRoutines(); scheduler.start(60000);
  }
  async function close() {
    if (routineTimer) clearInterval(routineTimer); routineTimer = null;
    for (const t of projectSyncTimers.values()) clearTimeout(t); projectSyncTimers.clear();
    scheduler.stop(); bus.close(); index.close(); await connecting.catch(() => {}); await engine.close(); await hub.close();
  }

  return { dataDir: DATA, brainDir: BRAIN, tenant, managedModels, router, office, settings, models, knowledge, index, projects, toolStore, hub, vault, engine, audit, scheduler, bus, chat, assist, routines: routineApi, routineRecords, loadRoutines, tickRoutines, syncProject, writeProjectSummary, graph: () => graph, get name() { return officeName(); }, boot, start, close };
}
