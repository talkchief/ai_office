// The Office Engine: the Program Manager delegates to department leads, leads delegate to specialists.
// Every state is enforced here, never inferred from what a model says.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Command } from '@langchain/langgraph';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { HumanMessage, ToolMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { createMiddleware, todoListMiddleware } from 'langchain';
import { createDeepAgent, registerHarnessProfile } from 'deepagents';
import { z } from 'zod';
import { officeBackend, FILE_PERMISSIONS, PM_FILE_PERMISSIONS, SKILL_SOURCES } from './backend.mjs';
import { ROOT } from '../config.mjs';
import { programManagerPrompt, leadPrompt, specialistPrompt, leadName } from './prompts.mjs';
import { exportPdfTool, exportPptxTool, assembleFilesTool, listWorkspaceFiles, workspaceFile } from './documents.mjs';
import { fetchWithRetries } from '../models.mjs';
import { DatabasePool, validateQuery, markdownTable, schemaText } from '../connectors/database.mjs';
import { SshRunner, validateCommand } from '../connectors/ssh.mjs';

// Deep Agents gives every agent that has subagents a built-in "general-purpose" worker with the parent's own tools. In this
// office every worker is a named person on a team, reviewed by a lead, so that worker is switched off for every provider
// the office can run on (profiles are keyed by the model class: ChatAnthropic, ChatOpenAI, ChatGoogleGenerativeAI).
export const PROVIDERS_WITHOUT_GENERAL_WORKER = ['anthropic', 'openai', 'google'];
for (const provider of PROVIDERS_WITHOUT_GENERAL_WORKER) registerHarnessProfile(provider, { generalPurposeSubagent: { enabled: false } });
import { checkOutput, coveredCriteria } from './checks.mjs';
import { RunTracker, toolOutputText, parseTaskInput } from './stream.mjs';
import { Notifications } from '../notifications.mjs';
import { Threads } from '../threads.mjs';

export const STATES = ['backlog', 'queued', 'planning', 'working', 'awaiting_lead_review', 'reviewing', 'awaiting_ceo', 'executing', 'saving', 'done', 'blocked', 'escalated', 'cancelled'];
export const ACTIVE = new Set(['queued', 'planning', 'working', 'awaiting_lead_review', 'reviewing', 'executing', 'saving']);
export const TERMINAL = new Set(['done', 'cancelled']);
const LIVE_EVENTS = new Set(['run_started', 'run_finished', 'review_recorded', 'decision_requested', 'decision', 'question', 'escalated', 'completed', 'blocked']);
// When the Program Manager chooses the teams, only the leads it actually involved must approve.
export const involved = job => [...new Set((job.runs || []).filter(r => r.role === 'lead' && r.dept).map(r => r.dept))];
// Calls that change something outside the office through the Vault pause for the CEO, like every outbound action: a request to an
// outside service, an upload, a data change on a database, a command on a server. Reads (api_get, db_query, db_schema) are free.
export const VAULT_APPROVALS = { api_request: { allowedDecisions: ['approve', 'edit', 'reject'] }, api_upload: { allowedDecisions: ['approve', 'reject'] }, db_write: { allowedDecisions: ['approve', 'edit', 'reject'] }, ssh_run: { allowedDecisions: ['approve', 'edit', 'reject'] } };
export const DEFAULT_SETTINGS = { maxConcurrentJobs: 2, runTimeoutMinutes: 20, escalateAfterHours: 1, outboundTools: [], readOnlyTools: [] };
const clean = value => String(value ?? '').trim();
const httpError = (message, status = 400) => Object.assign(new Error(message), { status });
const bounded = (value, fallback, min, max) => { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback; };
export const parallelRuns = team => bounded(team?.maxParallelRuns ?? team?.concurrency, 2, 1, 4);
export const reworkRounds = team => bounded(team?.maxReworkRounds ?? team?.maxRevisions, 3, 0, 5);
const typeMatches = (value, type) => (Array.isArray(type) ? type : [type]).some(t => t === 'array' ? Array.isArray(value) : t === 'integer' ? Number.isInteger(value) : t === 'null' ? value === null : typeof value === (t === 'object' ? 'object' : t));

class Gate {
  constructor(size) { this.size = size; this.active = 0; this.queue = []; }
  acquire(signal) {
    if (this.active < this.size) { this.active++; return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject }; this.queue.push(entry);
      signal?.addEventListener('abort', () => { const i = this.queue.indexOf(entry); if (i >= 0) { this.queue.splice(i, 1); reject(signal.reason || new Error('Stopped.')); } }, { once: true });
    });
  }
  release() { const next = this.queue.shift(); if (next) next.resolve(); else this.active = Math.max(0, this.active - 1); }
}

// Failures that come from the model provider (bad key, no credit, rate limit, outage, unknown model), not from the work.
const PROVIDER_STATUS = new Set([401, 402, 403, 408, 429, 500, 502, 503, 504, 529]);
// Worth one automatic retry: the provider or the network failed, not the key, the credit or the model name.
export function isTransientProviderError(error) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status ?? error?.error?.status);
  const message = String(error?.message || '');
  if (/api.?key|unauthori[sz]ed|authenticat|permission denied|insufficient|credit|quota|not found|does not exist|no such model/i.test(message)) return false;
  return (status >= 500 && status < 600) || status === 429 || /\b5\d\d\b|internal server error|bad gateway|service unavailable|gateway time.?out|overloaded|rate.?limit|too many requests|timed? ?out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network|connection (error|reset|refused|closed)|ECONNREFUSED/i.test(message);
}
export function isProviderError(error) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status ?? error?.error?.status);
  if (PROVIDER_STATUS.has(status)) return true;
  return /api.?key|unauthori[sz]ed|authenticat|permission denied|insufficient|quota|credit|rate.?limit|too many requests|overloaded|model.{0,40}(not found|does not exist)|no such model|provider/i.test(String(error?.message || ''));
}

export class OfficeEngine {
  constructor({ dataDir, office, models, toolHub = null, knowledgeDir, knowledgeIndex = null, bus = null, settings = () => ({}), onComplete = async () => {}, onChange = () => {}, name = 'the office', agentFactory = createDeepAgent, pmSkillsDir = null, toolLabels = () => ({}), memoryFactory = null, projectFor = () => null, brain = null, vault = null, connectors = {} }) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.workspaces = path.join(dataDir, 'workspaces'); this.knowledgeDir = knowledgeDir || path.join(dataDir, 'knowledge');
    this.saver = SqliteSaver.fromConnString(path.join(dataDir, 'workflows.sqlite')); this.db = this.saver.db;
    this.db.pragma('journal_mode = WAL'); this.db.pragma('busy_timeout = 5000');
    this.db.exec('CREATE TABLE IF NOT EXISTS office_jobs (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS office_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS office_events_job ON office_events(job_id, seq);');
    Object.assign(this, { office, models, toolHub, knowledgeIndex, bus, settingsFn: settings, onComplete, onChange, name, agentFactory, pmSkillsDir, toolLabels, projectFor });
    // Long-term memory shares the task database; null when the office runs without it (tests, older set-ups).
    this.memory = memoryFactory ? memoryFactory(this.db) : null;
    this.notifications = new Notifications({ db: this.db, bus }); this.threads = new Threads({ db: this.db, bus });
    this.running = new Map(); this.waiting = []; this.faults = []; this.brain = brain; this.vault = vault; this.followUps = new Map(); this.gates = new Map(); this.closed = false; this.providerTrouble = [];
    // The database and SSH connectors behind the Vault's entries; tests inject fakes, the office uses the real ones.
    this.connectors = { pool: connectors.pool || new DatabasePool(), ssh: connectors.ssh || new SshRunner() };
  }
  settings() { return { ...DEFAULT_SETTINGS, ...(this.settingsFn() || {}) }; }
  /* ---------- records ---------- */
  get(id) { const row = this.db.prepare('SELECT body FROM office_jobs WHERE id = ?').get(id); return row ? JSON.parse(row.body) : null; }
  update(id, mutate, { touch = true } = {}) {
    const job = this.db.transaction(() => {
      const job = this.get(id); if (!job) throw httpError('No such task.', 404);
      mutate(job); if (touch) job.updatedAt = Date.now();
      this.db.prepare('UPDATE office_jobs SET body = ? WHERE id = ?').run(JSON.stringify(job), id);
      return job;
    })();
    try { this.onChange(job); } catch {}
    return job;
  }
  event(id, type, agent, message, details = {}) {
    this.db.prepare('INSERT INTO office_events(job_id, body) VALUES (?, ?)').run(id, JSON.stringify({ at: Date.now(), type, agent, message, ...details }));
    // Hand-overs and decisions go live so the office can animate them.
    if (LIVE_EVENTS.has(type)) this.bus?.publish('task.event', { id, type, agent, message: String(message || '').slice(0, 200), role: details.role, approved: details.approved });
  }
  events(id) { return this.db.prepare('SELECT seq, body FROM office_events WHERE job_id = ? ORDER BY seq').all(id).map(r => ({ seq: r.seq, ...JSON.parse(r.body) })); }
  list() { return this.db.prepare('SELECT body FROM office_jobs ORDER BY rowid DESC').all().map(r => JSON.parse(r.body)); }
  detail(id) { const job = this.get(id); return job && { ...job, events: this.events(id), messages: this.threads.list(id) }; }
  setState(id, to, extra = {}) {
    let from;
    const job = this.update(id, j => { from = j.state; if (from !== to) { j.state = to; j.stateSince = Date.now(); } Object.assign(j, extra); });
    if (from !== to) { this.event(id, 'state_changed', null, `${from} → ${to}`, { from, to }); this.bus?.publish('task.state', { id, from, to }); }
    return job;
  }
  // What the board shows when the model provider is failing: failures in the last hour and day, and the last reason.
  providerHealth(now = Date.now()) {
    const hour = this.providerTrouble.filter(t => now - t.at < 3600000), day = this.providerTrouble.filter(t => now - t.at < 86400000);
    return { lastHour: hour.length, lastDay: day.length, last: day.at(-1) || null };
  }
  activeAgents() {
    const office = this.office.get();
    return new Set(this.list().filter(j => !TERMINAL.has(j.state) && j.state !== 'backlog').flatMap(j => [...(j.runs || []).filter(r => ['working', 'paused'].includes(r.state)).map(r => r.agent), ...(j.autoRoute ? involved(j) : j.depts || [j.dept]).map(d => office.teams.find(t => t.id === d)?.lead)]).filter(Boolean));
  }
  /* ---------- creating and scheduling ---------- */
  create({ dept, depts, text, title, model, effort, kind = 'task', testId, suiteId, routine = null, backlog = false, priority = 1, assignee = null, dueAt = null, autoStart = true, completionApproval, requireHumanApproval, projectId = null }) {
    const office = this.office.get();
    const autoRoute = depts === 'auto' || dept === 'auto';
    const all = autoRoute ? office.teams.map(t => t.id) : [...new Set([dept, ...(Array.isArray(depts) ? depts : [])].filter(Boolean))];
    const teams = all.map(id => office.teams.find(t => t.id === id));
    if (!all.length || teams.some(t => !t) || !clean(text)) throw httpError('Choose a team and describe the task.');
    if (clean(text).length > 12000) throw httpError('Task descriptions must be under 12000 characters.');
    if (assignee && !office.agents.some(a => a.id === assignee && all.includes(a.department))) throw httpError('The assignee must belong to one of the task’s teams.');
    const due = dueAt ? Number(new Date(dueAt)) : null; if (dueAt && !Number.isFinite(due)) throw httpError('Enter a valid due date.');
    const project = projectId ? this.projectFor(String(projectId)) : null;
    if (projectId && !project) throw httpError('There is no such project.'); if (project?.status === 'archived') throw httpError('That project is archived. Reopen it under Settings → Projects first.');
    const team = teams[0], testcase = kind === 'evaluation' ? team.tests.find(t => t.id === testId) : null;
    if (kind === 'evaluation' && !testcase) throw httpError('Choose a saved team test.');
    const skillIds = new Set(teams.flatMap(t => [...(t.skills || []), ...office.agents.filter(a => a.department === t.id).flatMap(a => a.skills || [])]));
    const now = Date.now();
    const job = { schemaVersion: 2, id: randomUUID(), kind, dept: team.id, depts: all, autoRoute, title: clean(title || text).slice(0, 100), text: clean(text), assignee: assignee || null, dueAt: due, projectId: project ? project.id : null, projectName: project ? project.name : null,
      priority: [0, 1, 2].includes(priority) ? priority : 1, routine, suiteId: suiteId || null, testId: testcase?.id || null, testName: testcase?.name || null, agent: autoRoute ? 'pm' : team.lead,
      model: clean(model) || null, effort: clean(effort) || null, state: backlog ? 'backlog' : 'queued', stateSince: now, createdAt: now, updatedAt: now,
      officeRevision: office.revision, skills: office.skills.filter(s => skillIds.has(s.id)),
      completionApproval: kind !== 'evaluation' && (teams.some(t => t.completionApproval) || !!completionApproval || !!requireHumanApproval),
      checks: [...teams.flatMap(t => (t.checks || []).map(c => ({ ...c, team: t.id }))), ...(testcase?.requiredText || []).map((value, i) => ({ id: `test-${i + 1}`, label: `Test requires: ${value}`, type: 'contains', value }))],
      runs: [], todos: [], reviews: [], reviewsByDept: {}, deliverables: {}, review: null, result: '', resultVersions: [], pendingActions: [], decisions: [], questions: [],
      calls: 0, tokens: 0, tokensByModel: {}, liveCalls: {}, reworkRounds: {}, reprompts: 0, next: null, error: null, progressLine: '' };
    this.db.prepare('INSERT INTO office_jobs(id, body) VALUES (?, ?)').run(job.id, JSON.stringify(job));
    this.threads.ensure('task', job.id); this.threads.append(job.id, { role: 'ceo', text: job.text, jobId: job.id });
    this.event(job.id, 'received', job.agent, autoRoute ? 'The Program Manager received the task and will choose the teams.' : `${teams.map(t => t.name).join(' + ')} received the ${kind === 'evaluation' ? 'test' : 'task'}.`);
    try { this.onChange(job); } catch {}
    if (autoStart && !backlog) queueMicrotask(() => this.pump());
    return job;
  }
  createTestSuite(dept) {
    const team = this.office.team(dept); if (!team?.tests?.length) throw httpError('Save at least one team test first.');
    const suiteId = randomUUID();
    const jobs = team.tests.map(test => this.create({ dept, text: test.prompt, kind: 'evaluation', testId: test.id, suiteId, autoStart: false }));
    queueMicrotask(() => this.pump()); return { id: suiteId, jobs };
  }
  editQueue(id, input) {
    const job = this.get(id);
    if (!job || this.running.has(id) || job.startedAt || !['backlog', 'queued'].includes(job.state)) throw httpError('Only tasks that have not started can be edited in the queue.', 409);
    if (input.state !== undefined && !['backlog', 'queued'].includes(input.state)) throw httpError('Choose backlog or queued.');
    if (input.priority !== undefined && ![0, 1, 2].includes(input.priority)) throw httpError('Choose a valid priority.');
    if (input.text !== undefined && (!clean(input.text) || clean(input.text).length > 12000)) throw httpError('Add a task brief under 12000 characters.');
    const updated = this.update(id, j => {
      if (input.text !== undefined) { j.text = clean(input.text); j.title = j.text.slice(0, 100); }
      if (input.priority !== undefined) j.priority = input.priority;
      if (input.dueAt !== undefined) j.dueAt = input.dueAt ? Number(new Date(input.dueAt)) || null : null;
      if (input.state === 'queued' && j.state === 'backlog') { const office = this.office.get(); j.officeRevision = office.revision; j.completionApproval = j.completionApproval || j.depts.some(d => office.teams.find(t => t.id === d)?.completionApproval); }
    });
    if (input.state && input.state !== updated.state) this.setState(id, input.state);
    this.event(id, 'queue_updated', null, input.state === 'backlog' ? 'Task saved as an idea.' : 'Task queued with priority ' + ['low', 'normal', 'high'][this.get(id).priority ?? 1] + '.');
    queueMicrotask(() => this.pump()); return this.get(id);
  }
  brief(job) {
    const office = this.office.get(), assignee = job.assignee ? office.agents.find(a => a.id === job.assignee) : null;
    const later = this.threads.list(job.id).filter(m => m.role === 'ceo').slice(1).map(m => '- ' + m.text);
    const project = job.projectId ? this.projectFor(job.projectId) : null;
    return [project ? this.projectBrief(project) + '\n' : '', job.autoRoute ? 'CEO task (choose which department leads to involve; delegate only to the teams that fit):' : `CEO task for ${job.depts.map(d => office.teams.find(t => t.id === d)?.name || d).join(' + ')}:`, job.text,
      assignee ? `The CEO wants ${assignee.name} (${assignee.role}) to do this.` : '', job.dueAt ? `Due: ${new Date(job.dueAt).toISOString().slice(0, 16).replace('T', ' ')} UTC.` : '',
      later.length ? 'Later notes from the CEO:\n' + later.join('\n') : '', this.seedNotes(job.text)].filter(Boolean).join('\n');
  }
  // The project block a task carries: purpose, charter, timeline and where the whole page is. projectFor may hand back a plain record.
  projectBrief(project) { return typeof project.brief === 'string' ? project.brief : `PROJECT: ${project.name} (${project.status || 'active'})\n${project.description || ''}\nThe project page and its files are under /knowledge/Projects/${project.id}/ (read project.md there before planning).`; }
  // The Program Manager starts with the Brain passages that best match the brief.
  seedNotes(text) {
    const n = Number(this.settings().knowledgeSeedNotes ?? 6); if (!this.knowledgeIndex || !n) return '';
    let hits = []; try { hits = this.knowledgeIndex.search(text, { k: n }); } catch { return ''; }
    return hits.length ? 'Brain notes that match this brief. Pass the paths to the leads; their teams read them. Read one yourself only to decide who does the work:\n' + hits.map(h => `- ${h.path}${h.heading ? ' › ' + h.heading : ''}: ${h.snippet}`).join('\n') : '';
  }
  inputFrom(next, job) {
    if (!next) return { messages: [new HumanMessage(this.brief(job))] };
    if (next.kind === 'decisions') return new Command({ resume: { decisions: next.decisions } });
    return { messages: [new HumanMessage(next.text)] };
  }
  limit() { return Math.max(1, Number(this.settings().maxConcurrentJobs) || 2); }
  pump() {
    if (this.closed) return;
    while (this.running.size < this.limit() && this.waiting.length) { const id = this.waiting.shift(); const job = this.get(id); if (job && !TERMINAL.has(job.state) && !this.running.has(id)) this.run(id); }
    for (const job of this.list().filter(j => j.state === 'queued' && !this.running.has(j.id) && !this.waiting.includes(j.id)).sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1) || a.createdAt - b.createdAt)) {
      if (this.running.size >= this.limit()) break; this.run(job.id);
    }
  }
  // Continue an existing task: a decision, a message or a follow-up. Waits for a free slot when the office is busy.
  schedule(id, next) {
    this.update(id, j => { j.next = next; }, { touch: false });
    if (this.running.has(id)) { this.followUps.set(id, next); return; }
    if (this.running.size < this.limit()) return this.run(id);
    if (!this.waiting.includes(id)) this.waiting.push(id);
  }
  /* ---------- running ---------- */
  run(id) {
    if (this.running.has(id)) return this.running.get(id).promise;
    const controller = new AbortController(), entry = { controller, promise: null };
    this.running.set(id, entry);
    entry.promise = (async () => {
      const minutes = Number(this.settings().runTimeoutMinutes) || 20;
      // The limit is on progress, not on length: a run that goes this long without a single event (a hung provider, a stuck tool) is
      // stopped; a long project that keeps working is not. There is no cap on tokens: a big task is allowed to be big.
      const stall = new AbortController(); let stallTimer = null;
      const alive = () => { clearTimeout(stallTimer); stallTimer = setTimeout(() => stall.abort(new Error('No progress.')), Math.max(50, minutes * 60000)); stallTimer.unref?.(); };
      alive();
      const signal = AbortSignal.any([controller.signal, stall.signal]);
      let tracker = null;
      try {
        const job = this.get(id);
        const input = this.inputFrom(job.next, job);
        this.update(id, j => { j.next = null; j.startedAt ||= Date.now(); j.harness = true; j.prunedAt = null; }, { touch: false });
        if (['queued', 'blocked', 'escalated'].includes(job.state)) this.setState(id, job.runs.length ? 'working' : 'planning', { error: null });
        const built = await this.build(this.get(id), signal);
        tracker = new RunTracker(this, id, built.models);
        const config = { configurable: { thread_id: id }, recursionLimit: 250, signal, version: 'v2' };
        for await (const event of built.pm.streamEvents(input, config)) { if (signal.aborted) break; alive(); tracker.handle(event); }
        clearTimeout(stallTimer);
        if (signal.aborted) throw signal.reason || new Error('Stopped.');
        tracker.flush();
        await this.settle(id, built.pm);
      } catch (error) {
        tracker?.flush(); clearTimeout(stallTimer);
        const stalled = stall.signal.aborted, job = this.get(id);
        if (this.closed || !job || TERMINAL.has(job.state)) return this.detail(id);
        const reason = stalled ? `The task made no progress for ${minutes} minutes and was stopped. Retry to continue from where it stopped, or raise the no-progress limit in Settings.` : clean(error?.message) || 'The task stopped unexpectedly.';
        if (!stalled && (isTransientProviderError(error) || isProviderError(error))) { this.providerTrouble.push({ at: Date.now(), reason: reason.slice(0, 160), task: job.title }); if (this.providerTrouble.length > 200) this.providerTrouble.splice(0, 100); }
        if (!stalled && isTransientProviderError(error) && (job.autoRetries || 0) < 2) {
          // Twice, quietly, with a longer pause the second time: the CEO hears about it only if the third attempt fails too.
          const attempt = (job.autoRetries || 0) + 1, delay = attempt === 1 ? 30000 : 90000;
          this.update(id, j => { j.autoRetries = attempt; }, { touch: false });
          this.block(id, reason, { provider: true, quiet: true });
          this.event(id, 'provider_retry', null, `The model provider failed (${reason.slice(0, 120)}). Retrying automatically in ${delay / 1000} seconds (attempt ${attempt} of 2).`);
          setTimeout(() => { try { if (this.get(id)?.state === 'blocked') this.retry(id, undefined, { automatic: true }); } catch {} }, delay).unref?.();
        } else this.block(id, reason, { provider: !stalled && isProviderError(error) });
      } finally {
        this.running.delete(id);
        for (const key of [...this.gates.keys()]) if (key.startsWith(id + ':')) this.gates.delete(key);
        const follow = this.followUps.get(id); this.followUps.delete(id);
        const job = this.get(id);
        if (follow && !this.closed && job && job.state !== 'cancelled') this.schedule(id, follow);
        if (!this.closed) queueMicrotask(() => this.pump());
      }
      return this.detail(id);
    })();
    return entry.promise;
  }
  // After the Program Manager's turn ends: park for the CEO, deliver notes, re-prompt once, or escalate.
  async settle(id, pm) {
    let job = this.get(id); if (!job || job.state === 'cancelled') return;
    const state = await pm.getState({ configurable: { thread_id: id } });
    const interrupts = (state.tasks || []).flatMap(t => t.interrupts || []);
    if (interrupts.length && job.state !== 'done') return this.park(id, interrupts);
    const pending = this.threads.pending(id);
    if (pending.length && !interrupts.length) {
      this.threads.markDelivered(pending.map(m => m.seq));
      // Notes that arrived while the task was busy. Delivered after completion, they do not undo the approved reviews: the Program
      // Manager answers them, routes a real change to the one lead it concerns, and completes again.
      const late = job.state === 'done';
      const text = (late ? `Office: this task is already complete and its result is filed (${this.stateSummary(job)}). The notes below arrived after completion. If they change nothing, call complete_task again with the same summary. If one asks for a change, route only that change to the lead who owns it and complete again after that lead's review; the other approved reviews stand.\n\n` : '') + pending.map(m => `CEO ${m.kind === 'note' ? 'note' : 'message'}: ${m.text}${this.referenceText(m.meta?.refs, id)}`).join('\n\n');
      this.update(id, j => { j.reprompts = 0; j.correction = { seq: pending.at(-1).seq, text: pending.map(m => m.text).join('\n'), at: Date.now() }; });
      this.event(id, 'notes_delivered', null, `${pending.length} note${pending.length === 1 ? '' : 's'} passed to the Program Manager${late ? ' after completion; approved reviews stand' : ''}.`);
      this.setState(id, 'working'); this.followUps.set(id, { kind: 'message', text }); return;
    }
    if (TERMINAL.has(job.state) || ['escalated', 'awaiting_ceo'].includes(job.state)) return;
    const office = this.office.get();
    const over = job.depts.filter(d => (job.reworkRounds?.[d] || 0) > reworkRounds(office.teams.find(t => t.id === d)));
    if (over.length) return this.escalate(id, `${over.map(d => office.teams.find(t => t.id === d)?.name || d).join(' and ')}: the lead’s review still fails after the allowed rework rounds. Read the review and give the team direction.`);
    const stale = this.staleDepts(job);
    if ((job.reprompts || 0) < 1) {
      const text = stale[0] === '(none yet)' ? 'No department lead has worked on this yet. Delegate it to the right lead, then complete it after their approved review.' : stale.length ? `Before completing, ${stale.map(leadName).join(', ')} must review the latest work and record an approved review. Delegate that now, then call complete_task.` : 'The lead’s review is approved. Call complete_task now with a short summary, or ask the CEO if something only they know is missing.';
      this.update(id, j => { j.reprompts = (j.reprompts || 0) + 1; }, { touch: false });
      this.event(id, 'reprompted', 'pm', text);
      this.setState(id, stale.length ? 'awaiting_lead_review' : 'working');
      this.followUps.set(id, { kind: 'message', text: 'Office: ' + text }); return;
    }
    const last = state.values?.messages?.at(-1), said = clean(typeof last?.content === 'string' ? last.content : Array.isArray(last?.content) ? last.content.map(p => p?.text || '').join('') : '').slice(0, 600);
    this.escalate(id, `The Program Manager stopped before the task was complete${stale.length ? ' and the lead has not approved the latest work' : ''}.${said ? ' Last update: ' + said : ''}`);
  }
  staleDepts(job) {
    const depts = job.autoRoute ? involved(job) : job.depts || [job.dept];
    if (job.autoRoute && !depts.length) return ['(none yet)'];
    return depts.filter(d => {
      const review = job.reviewsByDept?.[d]; if (!review?.approved) return true;
      const last = Math.max(0, ...job.runs.filter(r => r.dept === d && r.role === 'specialist' && r.finishedAt).map(r => r.finishedAt));
      return review.at < last;
    });
  }
  park(id, interrupts) {
    const actions = interrupts.flatMap(i => (i.value?.actionRequests || []).map((a, k) => ({ name: a.name, args: a.args || {}, description: String(a.description || '').slice(0, 2000), allowed: i.value?.reviewConfigs?.[k]?.allowedDecisions || ['approve', 'reject'] })));
    const job = this.update(id, j => {
      const specialist = j.runs.filter(r => ['working', 'paused'].includes(r.state) && r.role === 'specialist').at(-1)?.agent || null;
      j.pendingActions = actions.map((a, i) => ({ id: `${Date.now().toString(36)}-${i}`, ...a, agent: a.name === 'complete_task' ? 'pm' : specialist, requestedAt: Date.now() }));
      for (const r of j.runs) if (r.state === 'working') r.state = 'paused';
    });
    this.setState(id, 'awaiting_ceo');
    const completion = actions.every(a => a.name === 'complete_task');
    this.event(id, 'decision_requested', job.pendingActions[0]?.agent, completion ? 'Completion waits for the CEO’s approval.' : `Waiting for the CEO before: ${actions.map(a => a.name).join(', ')}.`);
    this.notifications.notify({ kind: completion ? 'ceo_approval' : 'ceo_decision', title: completion ? `Approve completion: ${job.title}` : `Decision needed: ${job.title}`,
      body: actions.map(a => `${a.name} ${JSON.stringify(a.args).slice(0, 600)}`).join('\n'), jobId: id, dept: job.dept, agent: job.pendingActions[0]?.agent, dedupe: `decision:${id}`, action: { type: 'decide' } });
  }
  block(id, reason, { provider = false, quiet = false } = {}) {
    this.update(id, j => { for (const r of j.runs) if (['working', 'paused'].includes(r.state)) r.state = 'failed'; for (const c of Object.values(j.liveCalls || {})) if (c.state === 'running') c.state = 'failed'; });
    const job = this.setState(id, 'blocked', { error: reason });
    this.event(id, 'blocked', null, reason, provider ? { provider: true } : {});
    if (quiet) return;
    // One inbox item per blocked task; a provider failure says where to fix it.
    this.notifications.notify(provider
      ? { kind: 'provider_error', title: `Model provider problem: ${job.title}`, body: `${reason}\n\nCheck the key, credit and model under Settings → Models & keys, then retry.`, jobId: id, dept: job.dept, dedupe: `blocked:${id}`, action: { type: 'retry' } }
      : { kind: 'blocked', title: `Blocked: ${job.title}`, body: reason, jobId: id, dept: job.dept, dedupe: `blocked:${id}`, action: { type: 'retry' } });
  }
  // Retention: a finished task keeps its record, result, reviews and thread. Its scratch workspace and resumable
  // checkpoints go after `days`; a later correction starts a fresh thread from the brief and the latest result.
  prune({ now = Date.now(), days = 30 } = {}) {
    const cutoff = now - days * 86400000, pruned = [];
    for (const job of this.list()) {
      if (!TERMINAL.has(job.state) || job.prunedAt || (job.doneAt || job.stateSince || job.updatedAt || now) > cutoff) continue;
      fs.rmSync(path.join(this.workspaces, job.id), { recursive: true, force: true });
      for (const table of ['checkpoints', 'writes']) { try { this.db.prepare(`DELETE FROM ${table} WHERE thread_id = ?`).run(job.id); } catch {} }
      this.update(job.id, j => { j.prunedAt = now; }, { touch: false });
      pruned.push(job.id);
    }
    return pruned;
  }
  escalate(id, reason, kind = 'escalated') {
    const job = this.setState(id, 'escalated', { error: reason, escalation: kind });
    this.event(id, 'escalated', null, reason);
    this.notifications.notify({ kind: 'escalated', title: `Needs you: ${job.title}`, body: reason, jobId: id, dept: job.dept, dedupe: `escalated:${id}`, action: { type: 'answer' } });
  }
  /* ---------- the org chart for one task ---------- */
  gate(key, size) { let g = this.gates.get(key); if (!g) { g = new Gate(size); this.gates.set(key, g); } g.size = size; return g; }
  // A team works on at most `maxParallelRuns` things at once per task; a person does one thing at a time across tasks.
  pace(jobId, team, agentId, signal) {
    const teamGate = this.gate(`${jobId}:${team.id}`, parallelRuns(team)), personGate = this.gate(`agent:${agentId}`, 1);
    return createMiddleware({ name: `pace_${agentId.replace(/[^a-zA-Z0-9_]/g, '_')}`, wrapModelCall: async (request, handler) => {
      await teamGate.acquire(signal);
      try { await personGate.acquire(signal); try { return await handler(request); } finally { personGate.release(); } } finally { teamGate.release(); }
    } });
  }
  async build(job, signal) {
    const office = this.office.get();
    const assigned = (job.depts?.length ? job.depts : [job.dept]).map(id => office.teams.find(t => t.id === id)).filter(Boolean);
    if (!assigned.length) throw new Error('This task’s team no longer exists. Create a new task for a current team.');
    // The Program Manager can reach every lead, so a hand-off to another team needs no rebuild; a team test stays inside its team.
    const teams = job.kind === 'evaluation' ? assigned : office.teams;
    await this.toolHub?.ensure?.();
    const models = {};
    const make = async (role, agent, team) => {
      const spec = this.models.resolve({ task: job, routine: job.routine, agent, team, role });
      if (!spec.model) throw httpError('No model is configured for this role. Choose one in Settings → Models.', 409);
      models[agent?.id || 'pm'] = spec.model;
      const providerId = this.models.model?.(spec.model)?.provider;
      return { model: await this.models.instance({ model: spec.model, effort: spec.effort }), provider: providerId ? this.models.provider?.(providerId)?.type : undefined };
    };
    // The Program Manager's skills: the shipped programme/project-management methods, and the owner's own under the Brain.
    const pmSkills = { agency: this.pmSkillsDir || path.join(ROOT, 'agency', 'pm-skills'), office: path.join(this.knowledgeDir, 'Agents Office', 'pm-skills') };
    // Same workspace and Brain for everyone; the memory mounts differ by role (the company for the Program Manager, one page per team).
    const backendFor = who => officeBackend({ workspaceDir: path.join(this.workspaces, job.id), knowledgeDir: this.knowledgeDir, skillDirs: pmSkills, memoryRoutes: this.memory?.routesFor(who) || {} });
    const evaluation = job.kind === 'evaluation', leads = [], toolLabels = this.toolLabels();
    for (const team of teams) {
      const lead = office.agents.find(a => a.id === team.lead), specialists = office.agents.filter(a => a.department === team.id && a.id !== team.lead);
      const subagents = [];
      for (const agent of specialists) {
        const { model, provider } = await make('specialist', agent, team);
        const set = this.toolHub ? this.toolHub.toolsFor({ agent, team, provider, evaluation }) : { tools: [], interruptOn: {} };
        subagents.push({ name: agent.id, description: `${agent.name}, ${agent.role}. ${agent.does || ''}`.slice(0, 600), systemPrompt: specialistPrompt({ office, team, agent, leadAgent: lead, toolLabels }),
          model, tools: [...set.tools, this.progressTool(job.id, agent.id), this.searchTool(job.id, agent.id), ...this.exportTools(job.id, agent.id), ...this.vaultTools(job.id, team, agent.id), ...this.connectorTools(job.id, team, agent.id)], interruptOn: { ...set.interruptOn, ...VAULT_APPROVALS }, middleware: [this.pace(job.id, team, agent.id, signal), this.loopGuard(job.id, agent.id), this.specialistReadGuard(job.id, agent.id)] });
      }
      const { model, provider } = await make('lead', lead, team);
      const spotChecks = this.toolHub ? this.toolHub.toolsFor({ agent: lead, team, provider, evaluation, readOnly: true }).tools : [];
      const graph = this.agentFactory({ name: leadName(team.id), model, systemPrompt: leadPrompt({ office, team, lead, specialists, reworkRounds: reworkRounds(team), toolLabels }),
        tools: [this.reviewTool(job.id, team), this.handoffTool(job.id, team, office), this.progressTool(job.id, lead.id), this.searchTool(job.id, lead.id), ...this.exportTools(job.id, lead.id), this.brainTool(job.id, lead.id), ...this.vaultTools(job.id, team, lead.id), ...this.connectorTools(job.id, team, lead.id), ...spotChecks], interruptOn: { update_brain_note: { allowedDecisions: ['approve', 'edit', 'reject'] }, ...VAULT_APPROVALS }, subagents, backend: backendFor({ role: 'lead', teamId: team.id }), store: this.memory?.store, permissions: FILE_PERMISSIONS, checkpointer: true, middleware: [todoListMiddleware(), this.subagentGuard(job.id, lead.id, specialists.map(a => a.id), 'specialist'), this.loopGuard(job.id, lead.id), this.emptyReplyGuard(job.id, lead.id), this.readGuard(job.id, team, lead.id)] });
      leads.push({ name: leadName(team.id), description: `${team.name} team, led by ${lead.name}.${team.purpose ? ' ' + team.purpose : ''}`.slice(0, 600), runnable: graph });
    }
    const { model } = await make('pm', null, null);
    const pm = this.agentFactory({ name: 'program-manager', model, systemPrompt: programManagerPrompt({ office, name: this.name, teams, toolLabels }),
      tools: [this.completeTool(job.id), this.askTool(job.id), this.progressTool(job.id, 'pm'), this.searchTool(job.id, 'pm'), this.brainTool(job.id, 'pm')], subagents: leads, backend: backendFor({ role: 'pm' }), store: this.memory?.store, permissions: PM_FILE_PERMISSIONS, skills: SKILL_SOURCES(pmSkills), middleware: [todoListMiddleware(), this.planFirst(job.id), this.subagentGuard(job.id, 'pm', leads.map(l => l.name), 'lead'), this.resumeGuard(job.id), this.loopGuard(job.id, 'pm'), this.emptyReplyGuard(job.id, 'pm'), this.pmReadGuard(job.id)],
      checkpointer: this.saver, interruptOn: { update_brain_note: { allowedDecisions: ['approve', 'edit', 'reject'] }, ...(job.completionApproval ? { complete_task: { allowedDecisions: ['approve', 'reject'] } } : {}) } });
    return { pm, models };
  }
  // The same call with the same arguments, over and over, is waiting, not working: an agent listing an empty workspace until
  // another team's file appears, or re-reading a note it already has. From the fifth repeat the call is refused with what to do instead.
  // Something threw where nothing catches it (a rejection nobody awaited, an exception outside a request). The office never dies
  // of it with tasks running: the fault is logged, kept for /api/health, and work carries on.
  fault(kind, reason) {
    const text = String(reason?.stack || reason?.message || reason || '').slice(0, 400);
    this.faults.push({ at: Date.now(), kind, reason: text }); if (this.faults.length > 50) this.faults.splice(0, 25);
    console.error(`${kind}:`, text);
  }
  loopGuard(jobId, agentId) {
    const recent = [], LIMIT = 4;
    return createMiddleware({ name: `loop_guard_${agentId.replace(/[^a-zA-Z0-9_]/g, '_')}`, wrapToolCall: async (request, handler) => {
      const call = request.toolCall, key = `${call.name}:${JSON.stringify(call.args || {})}`;
      recent.push(key); if (recent.length > 40) recent.shift();
      const repeats = recent.filter(k => k === key).length;
      if (repeats <= LIMIT) return handler(request);
      this.event(jobId, 'loop_stopped', agentId, `${call.name} was called with the same arguments ${repeats} times; the call was refused.`);
      return new ToolMessage({ tool_call_id: call.id, name: call.name, content: `Refused: this is the same call for the ${repeats}th time. Whatever you are waiting for will not appear in this run: nobody else writes into your workspace while you wait. Do the work with what you have, or reply now to whoever assigned this with exactly what is missing.` });
    } });
  }
  // A change to the Brain (a confirmed number, a decision, a fact the whole company must know) is proposed, not made: the CEO
  // approves it before the note is written, and the earlier copy is archived. Drafts and deliverables never go this way.
  brainTool(jobId, agentId) {
    return tool(async ({ path: where, mode = 'append', content, why }) => {
      if (!this.brain) return 'Refused: this office has no Brain writer configured; put the change in your report for the CEO.';
      const id = String(where || '').trim().replace(/^\/?knowledge\//, '').replace(/^\/+/, '');
      if (!id || !/\.md$/i.test(id) || id.includes('..')) return 'Refused: name a Markdown note under /knowledge/, for example /knowledge/00-Meta/numbers-ledger.md.';
      const text = clean(content); if (!text) return 'Refused: say what to write.';
      let existing = '', how = mode === 'replace' ? 'replace' : 'append';
      try { existing = this.brain.read(id).content || ''; } catch { how = 'replace'; }
      const next = how === 'replace' ? text : existing.replace(/\s*$/, '') + '\n\n' + text + '\n';
      await this.brain.save({ id, content: next });
      this.event(jobId, 'brain_updated', agentId, `${how === 'replace' ? 'Rewrote' : 'Appended to'} /knowledge/${id} with the CEO’s approval${clean(why) ? ': ' + clean(why).slice(0, 160) : ''}.`);
      return `Written to /knowledge/${id}; the earlier copy is archived and the Brain index refreshes on its own. Cite it as /knowledge/${id}.`;
    }, { name: 'update_brain_note', description: 'Propose a change to a note in the company Brain: a confirmed number for the numbers ledger, a decision, a fact the whole company must know from now on. The CEO approves it before anything is written, and the earlier copy is archived. Never for drafts or deliverables; those live under /work/.',
      schema: z.object({ path: z.string().describe('The note, e.g. /knowledge/00-Meta/numbers-ledger.md; a new path under /knowledge/ creates a note'), mode: z.enum(['append', 'replace']).optional().describe('append adds the content at the end (default); replace rewrites the whole note'), content: z.string().describe('The Markdown to add (for append, e.g. new table rows) or the whole new note (for replace)'), why: z.string().optional().describe('One sentence the CEO reads before approving') }) });
  }
  // The Vault's tools: vault_list says which outside services the team may reach; api_get reads; api_request and api_upload change
  // things outside the office and pause for the CEO. The office injects the key; the agent never sees it, and every answer is masked.
  vaultTools(jobId, team, agentId) {
    if (!this.vault) return [];
    const services = () => this.vault.forTeam(team.id, 'api');
    const missing = service => `Refused: "${service}" is not an outside service in the Vault for your team. Call vault_list; if it is missing, say in your report that the CEO must add it under Settings → Vault, and stop.`;
    const send = async ({ service, method, path: rel, body, headers }) => {
      const s = services().find(x => x.id === service); if (!s) return missing(service);
      if (!s.secret) return `Refused: the Vault has "${service}" but no key yet. Report that the CEO must add the key under Settings → Vault, and stop.`;
      rel = String(rel || '').trim(); if (!rel.startsWith('/')) return 'Refused: give a path that starts with /, relative to the service’s base address.';
      const h = Object.fromEntries(Object.entries(headers && typeof headers === 'object' ? headers : {}).filter(([k]) => !/^(authorization|cookie|host|x-api-key)$/i.test(k)).slice(0, 10).map(([k, v]) => [String(k).slice(0, 60), String(v).slice(0, 500)]));
      h[s.authHeader] = `${s.authPrefix || ''}${s.secret}`;
      let payload; if (body !== undefined && body !== null && !['GET', 'HEAD'].includes(method)) { payload = typeof body === 'string' ? body : JSON.stringify(body); if (!Object.keys(h).some(k => k.toLowerCase() === 'content-type')) h['content-type'] = 'application/json'; }
      try {
        const res = await fetchWithRetries(globalThis.fetch, s.baseURL + rel, { method, headers: h, body: payload, signal: AbortSignal.timeout(60000) });
        const text = this.vault.mask((await res.text()).slice(0, 20000));
        this.event(jobId, 'api_called', agentId, `${method} ${service}${rel.slice(0, 80)} → ${res.status}`);
        return `${res.status} ${res.statusText}\n${text}`;
      } catch (error) { return `The request to ${service} failed: ${this.vault.mask(String(error?.cause?.message || error?.message || error)).slice(0, 200)}`; }
    };
    const list = tool(async () => {
      const all = services();
      return all.length ? 'Outside services your team may use through the Vault (the office adds the key; you never see it):\n' + all.map(s => `- ${s.id} (${s.name}) at ${s.baseURL}${s.secret ? '' : ' — no key stored yet'}${s.notes ? ': ' + s.notes : ''}`).join('\n') : 'The Vault holds no outside service for your team. If the work needs one (for example here.now to publish a site), say so in your report: the CEO adds it under Settings → Vault.';
    }, { name: 'vault_list', description: 'List the outside services (APIs) your team may call through the office Vault, with their base addresses. Keys stay in the Vault; you never see or type one.', schema: z.object({}) });
    const get = tool(async ({ service, path: rel, headers }) => send({ service, method: 'GET', path: rel, headers }),
      { name: 'api_get', description: 'Read from an outside service in the Vault: GET <base address><path>. The office adds the key. Returns the status and the body.', schema: z.object({ service: z.string().describe('The service id from vault_list'), path: z.string().describe('Path relative to the base address, starting with /'), headers: z.record(z.string()).optional() }) });
    const request = tool(async ({ service, method, path: rel, body, headers }) => send({ service, method: String(method || 'POST').toUpperCase(), path: rel, body, headers }),
      { name: 'api_request', description: 'Call an outside service in the Vault with POST, PUT, PATCH or DELETE. This changes data outside the office, so it pauses for the CEO’s approval first. The office adds the key. Returns the status and the body.', schema: z.object({ service: z.string(), method: z.enum(['POST', 'PUT', 'PATCH', 'DELETE']), path: z.string().describe('Path relative to the base address, starting with /'), body: z.any().optional().describe('The JSON body'), headers: z.record(z.string()).optional() }) });
    const upload = tool(async ({ url, file, contentType }) => {
      let target; try { target = new URL(String(url || '')); } catch { return 'Refused: give the full https address you were handed for the upload.'; }
      if (target.protocol !== 'https:') return 'Refused: uploads go to https addresses only.';
      let f; try { f = workspaceFile(this.workspaceDir(jobId), file); } catch (error) { return 'Refused: ' + error.message; }
      if (!fs.existsSync(f.abs)) return `Refused: there is no file at /work/${f.rel}.`;
      try {
        const res = await fetchWithRetries(globalThis.fetch, target.href, { method: 'PUT', headers: { 'content-type': contentType || 'application/octet-stream' }, body: fs.readFileSync(f.abs), signal: AbortSignal.timeout(120000) });
        this.event(jobId, 'api_called', agentId, `PUT /work/${f.rel} → ${target.hostname} → ${res.status}`);
        return `${res.status} ${res.statusText}: uploaded /work/${f.rel} (${fs.statSync(f.abs).size} bytes) to ${target.hostname}.`;
      } catch (error) { return `The upload of /work/${f.rel} failed: ${String(error?.cause?.message || error?.message || error).slice(0, 200)}`; }
    }, { name: 'api_upload', description: 'Upload one workspace file’s bytes with PUT to an https address you were handed by an outside service (a presigned upload address). This sends data outside the office, so it pauses for the CEO’s approval first.', schema: z.object({ url: z.string().describe('The full https address to PUT to'), file: z.string().describe('The file under /work/ to send'), contentType: z.string().optional() }) });
    return [list, get, request, upload];
  }
  // The database and SSH connectors behind the Vault: db_list, db_schema and db_query read (free); db_write changes data on a
  // connection the CEO marked writable and pauses for the CEO; ssh_run runs one command on a target and always pauses for the CEO.
  // The office holds the password or key, the agent never sees it, every answer is masked, and every call is on the task's timeline.
  connectorTools(jobId, team, agentId) {
    if (!this.vault) return [];
    const { pool, ssh } = this.connectors;
    const entryOf = (kind, id) => this.vault.forTeam(team.id, kind).find(e => e.id === clean(id));
    const mask = text => this.vault.mask(String(text ?? ''));
    const note = line => this.event(jobId, 'connector_called', agentId, mask(line).slice(0, 300));
    const missing = (kind, id, listTool) => `Refused: "${id}" is not ${kind === 'ssh' ? 'an SSH target' : 'a database connection'} in the Vault for your team. Call ${listTool}; if it is missing, say in your report that the CEO must add it under Settings → Vault, and stop.`;
    const noSecret = e => `Refused: the Vault has "${e.id}" but no ${e.kind === 'ssh' ? 'key or password' : 'password'} yet. Report that the CEO must add it under Settings → Vault, and stop.`;
    const failure = (what, error) => `${what} failed: ${mask(error?.message || error).slice(0, 300)}`;
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const dbLine = e => `- ${e.id} (${e.name}): ${e.engine} database "${e.database}" at ${e.host}:${e.port}${e.username ? ' as ' + e.username : ''}, ${e.readOnly === false ? 'writable (db_write pauses for the CEO)' : 'read-only'}${e.secret ? '' : ' — no password stored yet'}${e.notes ? ': ' + e.notes : ''}`;
    const dbList = tool(async () => {
      const all = this.vault.forTeam(team.id, 'database'); note(`db_list → ${plural(all.length, 'connection')}`);
      return all.length ? 'Database connections your team may use (the office holds the password; you never see it):\n' + all.map(dbLine).join('\n') : 'The Vault holds no database connection for your team. If the work needs one, say so in your report: the CEO adds it under Settings → Vault.';
    }, { name: 'db_list', description: 'List the database connections your team may query through the office Vault: id, engine, host, database, and whether it is read-only or writable. Passwords stay in the Vault; you never see or type one.', schema: z.object({}) });
    const dbSchema = tool(async ({ database }) => {
      const e = entryOf('database', database); if (!e) return missing('database', database, 'db_list'); if (!e.secret) return noSecret(e);
      try {
        const tables = await pool.schema(e); note(`db_schema ${e.id} → ${plural(tables.length, 'table')}`);
        const text = schemaText(tables); return mask(text.length > 60000 ? text.slice(0, 60000) + '\n… (cut at 60 KB; ask db_query about information_schema.columns for the rest)' : text);
      } catch (error) { note(`db_schema ${e.id} failed: ${error?.message || error}`); return failure(`Reading the tables of ${e.id}`, error); }
    }, { name: 'db_schema', description: 'List the tables and columns (with types) of a database from db_list. Call it before writing SQL.', schema: z.object({ database: z.string().describe('The connection id from db_list') }) });
    const dbQuery = tool(async ({ database, sql }) => {
      const e = entryOf('database', database); if (!e) return missing('database', database, 'db_list');
      const v = validateQuery(sql, { readOnly: e.readOnly !== false }); if (!v.ok) return v.reason;
      if (v.kind === 'write') return 'Refused: that statement changes data. Call db_write with it; db_write pauses for the CEO’s approval first.';
      if (!e.secret) return noSecret(e);
      try { const r = await pool.query(e, v.sql, { timeoutMs: 15000 }); note(`db_query ${e.id}: ${v.sql.slice(0, 120)} → ${plural(r.rowCount, 'row')} in ${r.ms} ms`); return mask(markdownTable(r)); }
      catch (error) { note(`db_query ${e.id} failed: ${error?.message || error}`); return failure(`The query on ${e.id}`, error); }
    }, { name: 'db_query', description: 'Run one read statement (SELECT, WITH … SELECT, SHOW or EXPLAIN) on a database from db_list; the office adds the password. One statement, no comments; at most 200 rows and 100 KB come back, and a SELECT without LIMIT gets LIMIT 200. Returns a Markdown table.', schema: z.object({ database: z.string().describe('The connection id from db_list'), sql: z.string().describe('One SQL statement') }) });
    const dbWrite = tool(async ({ database, sql, why }) => {
      const e = entryOf('database', database); if (!e) return missing('database', database, 'db_list');
      if (e.readOnly !== false) return `Refused: "${e.id}" is read-only. If the change is needed, say so in your report; the CEO can allow writes on it under Settings → Vault.`;
      const v = validateQuery(sql, { readOnly: false }); if (!v.ok) return v.reason;
      if (v.kind !== 'write') return 'Refused: db_write is for one INSERT, UPDATE or DELETE; use db_query to read.';
      if (!e.secret) return noSecret(e);
      try {
        const r = await pool.query(e, v.sql, { timeoutMs: 30000 }), n = r.affected ?? r.rowCount;
        note(`db_write ${e.id}: ${v.sql.slice(0, 120)} → ${plural(n, 'row')} in ${r.ms} ms${clean(why) ? ' (' + clean(why).slice(0, 100) + ')' : ''}`);
        return mask(r.rows.length ? markdownTable(r) : `Done: ${plural(n, 'row')} affected in ${r.ms} ms.`);
      } catch (error) { note(`db_write ${e.id} failed: ${error?.message || error}`); return failure(`The change on ${e.id}`, error); }
    }, { name: 'db_write', description: 'Run one INSERT, UPDATE or DELETE on a database the CEO marked writable in the Vault. This changes data outside the office, so it pauses for the CEO’s approval first; say in why what the change is for. DROP, ALTER, TRUNCATE, GRANT and the like are never run, and a read-only connection refuses every write.', schema: z.object({ database: z.string().describe('The connection id from db_list'), sql: z.string().describe('One INSERT, UPDATE or DELETE statement'), why: z.string().optional().describe('One sentence the CEO reads before approving') }) });
    const sshLine = e => `- ${e.id} (${e.name}): ${e.username ? e.username + '@' : ''}${e.host}:${e.port}, ${e.secret ? (/^-----BEGIN /.test(String(e.secret).trim()) ? 'key stored' : 'password stored') : 'no key or password yet'}, ${e.allow?.length ? 'commands allowed: ' + e.allow.join(', ') : 'any command, each approved by the CEO'}${e.notes ? ': ' + e.notes : ''}`;
    const sshList = tool(async () => {
      const all = this.vault.forTeam(team.id, 'ssh'); note(`ssh_list → ${plural(all.length, 'target')}`);
      return all.length ? 'SSH targets your team may use (the office holds the key or password; you never see it):\n' + all.map(sshLine).join('\n') : 'The Vault holds no SSH target for your team. If the work needs one, say so in your report: the CEO adds it under Settings → Vault.';
    }, { name: 'ssh_list', description: 'List the SSH targets your team may run commands on through the office Vault: id, user and host, and the command prefixes each allows.', schema: z.object({}) });
    const sshRun = tool(async ({ target, command }) => {
      const e = entryOf('ssh', target); if (!e) return missing('ssh', target, 'ssh_list');
      const v = validateCommand(command, e); if (!v.ok) return v.reason;
      if (!e.secret) return noSecret(e);
      try {
        const r = await ssh.run(e, v.command, { timeoutMs: 60000 }); note(`ssh_run ${e.id}: ${v.command.slice(0, 120)} → exit ${r.code ?? 'none'} in ${r.ms} ms${r.timedOut ? ' (stopped)' : ''}`);
        return mask(`${r.timedOut ? 'Stopped: the command did not finish in time' : `Exit code ${r.code ?? 'unknown'}`} (${r.ms} ms).${r.stdout.trim() ? '\nOutput:\n' + r.stdout.trim() : '\nNo output.'}${r.stderr.trim() ? '\nErrors:\n' + r.stderr.trim() : ''}${r.truncated ? '\n(output cut at 50 KB)' : ''}`);
      } catch (error) { note(`ssh_run ${e.id} failed: ${error?.message || error}`); return failure(`The command on ${e.id}`, error); }
    }, { name: 'ssh_run', description: 'Run one shell command on an SSH target from ssh_list, as the user stored in the Vault. This acts on a machine outside the office, so it always pauses for the CEO’s approval first. One command per call, on one line; wait for the output before the next. A target may allow only some command prefixes; rm -rf /, mkfs, dd if=, shutdown and reboot are never run.', schema: z.object({ target: z.string().describe('The target id from ssh_list'), command: z.string().describe('One shell command') }) });
    return [dbList, dbSchema, dbQuery, dbWrite, sshList, sshRun];
  }
  // A subagent whose model replies with nothing (no text, no tool call: a provider hiccup) is sent the assignment once more; if it
  // happens twice the caller is told plainly. Deep Agents would otherwise report "Task completed" and the caller would believe it.
  emptyReplyGuard(jobId, who) {
    const said = result => { const text = toolOutputText(result).trim(); return text && text !== 'Task completed' ? text : ''; };
    return createMiddleware({ name: `empty_reply_${who.replace(/[^a-zA-Z0-9_]/g, '_')}`, wrapToolCall: async (request, handler) => {
      if (request.toolCall.name !== 'task') return handler(request);
      let result = await handler(request); if (said(result)) return result;
      const target = parseTaskInput(request.toolCall.args).subagent || 'the agent';
      this.event(jobId, 'empty_reply', who, `${target} returned an empty reply; the assignment was sent once more.`);
      result = await handler(request); if (said(result)) return result;
      this.event(jobId, 'empty_reply', who, `${target} returned an empty reply twice.`);
      return new ToolMessage({ tool_call_id: request.toolCall.id, name: 'task', content: `${target} returned nothing twice (an empty reply: no work, no report). This is not done. Delegate the assignment again later in this task, or report it to the Program Manager or the CEO.` });
    } });
  }
  // A lead reads to brief and to review, not to research: before its first delegation in a run it may open three files or
  // searches; the next one is refused and it is told to delegate, since the specialist reads the same notes for the work itself.
  // Once a specialist has been delegated to, the lead reads freely (that is the review).
  readGuard(jobId, team, leadId) {
    const READS = new Set(['read_file', 'search_knowledge', 'grep', 'glob', 'ls']), LIMIT = 3, counts = new Map();
    return createMiddleware({ name: `read_guard_${leadId.replace(/[^a-zA-Z0-9_]/g, '_')}`, wrapToolCall: async (request, handler) => {
      const call = request.toolCall; if (!READS.has(call.name)) return handler(request);
      const job = this.get(jobId), mine = job.runs.filter(r => r.agent === leadId), since = mine.length ? Math.max(...mine.map(r => r.startedAt || 0)) : 0;
      if (job.runs.some(r => r.dept === team.id && r.role === 'specialist' && (r.startedAt || 0) >= since)) return handler(request);
      const n = (counts.get(since) || 0) + 1; counts.set(since, n);
      if (n <= LIMIT) return handler(request);
      this.event(jobId, 'reads_capped', leadId, `${call.name} refused: the lead had already opened ${LIMIT} things before delegating.`);
      return new ToolMessage({ tool_call_id: call.id, name: call.name, content: `Refused: you have already opened ${LIMIT} files or searches before delegating. Delegate now with the task tool and name the notes the specialist should read; the specialist does the reading. You can read again when their work comes back for review.` });
    } });
  }
  // After an interruption (a restart, a provider failure, a stall) the Program Manager's graph replays the delegations that were in
  // flight, with the same briefs. A package the team had already delivered and got approved is not run again: the PM hears what was
  // delivered. A package that was mid-flight runs again, told what its team had already written so it does not start from nothing.
  resumeCheck(jobId, toolCall) {
    const job = this.get(jobId); if (!job || toolCall.name !== 'task') return null;
    const { subagent, description } = parseTaskInput(toolCall.args), { isLead, dept } = this.target(subagent); if (!isLead || !dept) return null;
    // The PM re-words a brief when it continues, so a package is recognised by what it says, not by the exact text.
    const words = t => new Set(String(t || '').toLowerCase().slice(0, 300).split(/[^a-z0-9]+/).filter(w => w.length > 3));
    const similar = (a, b) => { const A = words(a), B = words(b); if (A.size < 4 || !B.size) return 0; let both = 0; for (const w of A) if (B.has(w)) both++; return both / A.size; };
    const prior = job.runs.filter(r => r.role === 'lead' && r.dept === dept && r.state !== 'working' && similar(r.title, description) >= 0.7);
    if (!prior.length) return null;
    const first = Math.min(...prior.map(r => r.startedAt || 0)), review = job.reviewsByDept?.[dept];
    const files = (() => { try { return listWorkspaceFiles(this.workspaceDir(jobId)).map(f => '/work/' + f.name); } catch { return []; } })();
    // A correction from the CEO after the approval means the package may legitimately run again.
    if (review?.approved && review.at >= first && !(job.correction?.at > review.at)) {
      this.event(jobId, 'resume_skipped', 'pm', `${dept} had already delivered this package before the interruption; it was not run again.`);
      return { skip: `Already done before the interruption: the ${dept} lead delivered this package and recorded an APPROVED review at ${new Date(review.at).toISOString().slice(11, 16)} UTC (${review.summary.slice(0, 300)}). Files in the workspace: ${files.join(', ') || 'none'}. Do not delegate it again; mark it done in the plan and carry on.` };
    }
    return { description: `Office note: this assignment was interrupted (a restart or a provider failure) and is being resumed. Your team may already have written files for it under /work/ (${files.join(', ') || 'none yet'}): read those first, reuse what is good, and do not repeat finished work.\n\n${description}` };
  }
  // What the office knows for certain about a task, for the Program Manager when it continues after a stop.
  stateSummary(job) {
    const office = this.office.get(), name = d => office.teams.find(t => t.id === d)?.name || d;
    const approved = Object.entries(job.reviewsByDept || {}).filter(([, r]) => r?.approved).map(([d, r]) => `${name(d)} (approved ${new Date(r.at).toISOString().slice(11, 16)} UTC${r.file ? ', /work/' + r.file : ''})`);
    const notYet = [...new Set(job.runs.filter(r => r.role === 'lead' && r.dept).map(r => r.dept))].filter(d => !job.reviewsByDept?.[d]?.approved).map(name);
    const open = this.openHandoffs(job).map(h => `${name(h.from)} → ${name(h.team)}: ${h.request.slice(0, 80)}`);
    return [`Approved and final so far: ${approved.join('; ') || 'nothing yet'}.`, notYet.length ? `Still without an approved review: ${notYet.join(', ')}.` : '', open.length ? `Hand-offs not yet delegated: ${open.join(' | ')}.` : '', 'Do not delegate an approved package again; the office refuses it.'].filter(Boolean).join(' ');
  }
  target(subagent) { const isLead = subagent.startsWith('lead-'); return { isLead, dept: isLead ? subagent.slice(5) : this.office.agents().find(a => a.id === subagent)?.department || null }; }
  resumeGuard(jobId) {
    return createMiddleware({ name: 'resume_guard', wrapToolCall: async (request, handler) => {
      const check = this.resumeCheck(jobId, request.toolCall); if (!check) return handler(request);
      if (check.skip) return new ToolMessage({ tool_call_id: request.toolCall.id, name: 'task', content: check.skip });
      return handler({ ...request, toolCall: { ...request.toolCall, args: { ...request.toolCall.args, description: check.description } } });
    } });
  }
  // A delegation to a name that is not on the caller's team (an Operations lead calling Accounting's lead, a PM naming a person
  // instead of a lead) is refused with the right names; Deep Agents would otherwise throw and the whole task would block.
  subagentGuard(jobId, who, names, kind) {
    const known = new Set(names);
    return createMiddleware({ name: `subagent_guard_${who.replace(/[^a-zA-Z0-9_]/g, '_')}`, wrapToolCall: async (request, handler) => {
      if (request.toolCall.name !== 'task') return handler(request);
      const { subagent } = parseTaskInput(request.toolCall.args); if (known.has(subagent)) return handler(request);
      this.event(jobId, 'subagent_refused', who, `Tried to delegate to "${subagent}", who is not ${kind === 'lead' ? 'a team lead' : 'on the team'}.`);
      const content = kind === 'lead'
        ? `Refused: "${subagent}" is not a team lead. Delegate to one of: ${names.join(', ')}.`
        : `Refused: "${subagent}" is not one of your specialists. Your team: ${names.join(', ') || 'nobody but you'}. Delegate to one of them; if the work belongs to another team, call hand_to_program_manager and carry on with your own part.`;
      return new ToolMessage({ tool_call_id: request.toolCall.id, name: 'task', content });
    } });
  }
  // The Program Manager's prompt already holds the company and the notes that match the brief; before its first delegation it may
  // open four things (the project page and what it names), then it delegates and the teams read. On Gemini the PM opened 34 things
  // for a one-team task and spent 645k tokens doing it.
  pmReadGuard(jobId) {
    const READS = new Set(['read_file', 'search_knowledge', 'grep', 'glob', 'ls']), LIMIT = 4; let reads = 0;
    return createMiddleware({ name: 'pm_read_guard', wrapToolCall: async (request, handler) => {
      const call = request.toolCall; if (!READS.has(call.name)) return handler(request);
      if (this.get(jobId)?.runs.some(r => r.role === 'lead')) return handler(request);
      if (++reads <= LIMIT) return handler(request);
      this.event(jobId, 'reads_capped', 'pm', `${call.name} refused: the Program Manager had already opened ${LIMIT} things before delegating.`);
      return new ToolMessage({ tool_call_id: call.id, name: call.name, content: `Refused: you have opened ${LIMIT} things before delegating. Your prompt already holds the whole company and the Brain notes that match this brief; the teams do the reading. Write the plan and delegate now with task, naming the notes each lead should read.` });
    } });
  }
  // A specialist reads what its step needs, once: a dozen files or searches in one run is the ceiling, then it writes with what it has.
  specialistReadGuard(jobId, agentId, limit = 12) {
    const READS = new Set(['read_file', 'search_knowledge', 'grep', 'glob', 'ls']), counts = new Map();
    return createMiddleware({ name: `specialist_read_guard_${agentId.replace(/[^a-zA-Z0-9_]/g, '_')}`, wrapToolCall: async (request, handler) => {
      const call = request.toolCall; if (!READS.has(call.name)) return handler(request);
      const job = this.get(jobId), run = job?.runs.filter(r => r.agent === agentId).at(-1), key = run?.id || 'none';
      const n = (counts.get(key) || 0) + 1; counts.set(key, n);
      if (n <= limit) return handler(request);
      this.event(jobId, 'reads_capped', agentId, `${call.name} refused: ${limit} files or searches already opened in this run.`);
      return new ToolMessage({ tool_call_id: call.id, name: call.name, content: `Refused: you have already opened ${limit} files or searches in this run; that is the ceiling. Write the deliverable with what you have read, state what you could not check, and hand it over.` });
    } });
  }
  // The Program Manager delegates only after it has written a plan: a task call before write_todos is refused, not run.
  planFirst(jobId) {
    return createMiddleware({ name: 'plan_first', wrapToolCall: async (request, handler) => {
      const call = request.toolCall; if (call?.name !== 'task' || (this.get(jobId)?.todos || []).length) return handler(request);
      this.event(jobId, 'delegation_refused', 'pm', 'Delegation before a plan: write_todos first.');
      return new ToolMessage({ tool_call_id: call.id, name: 'task', content: 'Refused: plan first. Call write_todos with one item per work package (team, deliverable, what you need back), then delegate with task.' });
    } });
  }
  /* ---------- office tools ---------- */
  // A lead whose assignment needs another team's expertise hands that part to the Program Manager and keeps working on its own part.
  // The PM must delegate it before the task can close; the other lead's review is then required like any involved team's.
  handoffTool(id, team, office) {
    const others = office.teams.filter(t => t.id !== team.id);
    return tool(async ({ team: target, request }) => {
      const job = this.get(id), other = others.find(t => t.id === target); if (!job || job.state === 'cancelled') return 'The task is closed.';
      if (!other) return `Unknown team. Choose one of: ${others.map(t => t.id).join(', ')}.`;
      const text = clean(request).slice(0, 2000); if (!text) return 'Say what the other team should deliver.';
      // After a resume, a lead can mistake the other team's package in its brief for its own: the other team already has it.
      const busy = job.runs.find(r => r.role === 'lead' && r.dept === other.id && r.state === 'working');
      if (busy) { this.event(id, 'handoff_declined', team.lead, `${team.name} tried to hand work to ${other.name}, which already has its own package.`); return `Not recorded: ${other.name} already has its package from the Program Manager (working since ${new Date(busy.startedAt).toISOString().slice(11, 16)} UTC). Nothing of theirs is yours to hand off. Carry on with your own part only, and do not put a HAND-OFF line in your report.`; }
      const handoff = { id: randomUUID(), from: team.id, team: other.id, request: text, at: Date.now() };
      this.update(id, j => { j.handoffs = [...(j.handoffs || []), handoff]; if (!j.autoRoute && !(j.depts || []).includes(other.id)) j.depts = [...(j.depts || [j.dept]), other.id]; });
      this.event(id, 'handoff_requested', team.lead, `${team.name} asked ${other.name} for: ${text.slice(0, 200)}`, { team: other.id, role: 'lead' });
      return `Recorded. The Program Manager will delegate this to ${other.name} (${leadName(other.id)}). Continue with your own part now, and put this line in your report to the Program Manager: "HAND-OFF to ${other.name}: ${text.slice(0, 200)}".`;
    }, { name: 'hand_to_program_manager', description: 'Ask the Program Manager to delegate part of this assignment to another team that has the expertise or the tool it needs (for example web access for research). Call once per hand-off, then carry on with your own team’s part. Never do the other team’s work yourself.',
      schema: z.object({ team: z.enum(others.length ? others.map(t => t.id) : ['none']).describe('The team that should take it'), request: z.string().describe('What that team should deliver, with the context they need') }) });
  }
  // A hand-off is open until a lead run for that team starts after it was asked for.
  openHandoffs(job) { return (job.handoffs || []).filter(h => !job.runs.some(r => r.role === 'lead' && r.dept === h.team && (r.startedAt || 0) >= h.at)); }
  // The files a task's workspace holds, for the task page; and the tool that turns a Markdown deliverable into a PDF there.
  workspaceDir(id) { return path.join(this.workspaces, id); }
  files(id) { return listWorkspaceFiles(this.workspaceDir(id)); }
  exportTools(id, agentId) {
    const workspaceDir = this.workspaceDir(id), saved = what => ({ file, pages, slides }) => this.event(id, 'file_saved', agentId, `Saved /work/${file} (${what === 'pdf' ? `${pages} page${pages === 1 ? '' : 's'}` : `${slides} slides`}).`, { file });
    return [assembleFilesTool({ workspaceDir, onSaved: r => this.event(id, 'file_saved', agentId, `Combined ${r.parts} files into /work/${r.file}.`) }), exportPdfTool({ workspaceDir, onSaved: saved('pdf') }), exportPptxTool({ workspaceDir, onSaved: saved('pptx') })];
  }
  progressTool(id, agentId) {
    return tool(async ({ text }) => { const line = clean(text).slice(0, 240); if (line) { this.update(id, j => { j.progressLine = line; }); this.event(id, 'progress', agentId, line); } return 'Noted.'; },
      { name: 'report_progress', description: 'Post a one-sentence progress update the CEO sees on the task card.', schema: z.object({ text: z.string() }) });
  }
  // Brain search for every role; the notes a run relied on are recorded as its sources.
  searchTool(id, agentId) {
    return tool(async ({ query, folder = '', k = 6 }) => {
      if (!this.knowledgeIndex) return 'The Brain search is not available in this office.';
      let hits = []; try { hits = this.knowledgeIndex.search(query, { folder, k }); } catch (error) { return `The Brain search could not run that query (${String(error.message).slice(0, 120)}). Try plain words.`; }
      if (hits.length) this.update(id, j => {
        j.sources = [...new Set([...(j.sources || []), ...hits.map(h => h.path)])].slice(0, 60);
        const run = j.runs.filter(r => r.agent === agentId && r.state === 'working').at(-1); if (run) run.sources = [...new Set([...(run.sources || []), ...hits.map(h => h.path)])].slice(0, 20);
      }, { touch: false });
      return hits.length ? hits.map((h, i) => `${i + 1}. ${h.path}${h.heading ? ' › ' + h.heading : ''}\n${h.snippet}`).join('\n\n') : 'No notes in the Brain match that search. Try different words.';
    }, { name: 'search_knowledge', description: 'Search the company Brain (uploaded documents, notes, digests and past results) by keywords. Returns note paths and matching passages; read a note under /knowledge/<path> and cite its path.',
      schema: z.object({ query: z.string().describe('Keywords to look for'), folder: z.string().optional().describe('Only this folder, e.g. Company or Projects'), k: z.number().int().min(1).max(12).optional() }) });
  }
  reviewTool(id, team) {
    return tool(async ({ approved, summary, criteria = [], deliverable = '', deliverablePath = '' }) => {
      const job = this.get(id), current = this.office.team(team.id) || team;
      // The lead reviews; a specialist does the work. No review until someone on the team has handed work over this round.
      const specialists = new Set(this.office.agents().filter(a => a.department === team.id && a.id !== current.lead).map(a => a.id));
      const leadRuns = job.runs.filter(r => r.agent === current.lead), since = leadRuns.length ? Math.max(...leadRuns.map(r => r.startedAt || 0)) : 0;
      if (specialists.size && !job.runs.some(r => specialists.has(r.agent) && (r.startedAt || 0) >= since && ['done', 'working'].includes(r.state) || specialists.has(r.agent) && (r.finishedAt || 0) >= since && r.state === 'done')) {
        this.event(id, 'review_refused', current.lead, 'No specialist has handed work over in this round.');
        return `Refused: nobody on your team has handed work over in this round. Delegate the work to a specialist with the task tool (subagent_type is the specialist id: ${[...specialists].join(', ')}), then review what they return.`;
      }
      // The deliverable is the handed-over file under /work/ (the office reads it, the lead does not copy it) or, for a few lines, the text itself.
      let text = clean(deliverable), file = '', fileProblem = '';
      if (!text && clean(deliverablePath)) {
        try {
          const { abs, rel } = workspaceFile(this.workspaceDir(id), deliverablePath);
          if (/\.(pdf|pptx|docx|xlsx|png|jpe?g|gif|zip)$/i.test(rel)) fileProblem = `/work/${rel} is not a text file; give the Markdown source the export was made from`;
          else if (!fs.existsSync(abs)) fileProblem = `there is no file at /work/${rel}; use the path exactly as the specialist handed it over`;
          else { text = clean(fs.readFileSync(abs, 'utf8')); file = rel; }
        } catch (e) { fileProblem = e.message; }
      }
      const list = [...current.criteria, ...(current.guardrails || [])];
      const checks = checkOutput(text, job.checks.filter(c => !c.team || c.team === team.id));
      const covered = coveredCriteria(list.length, criteria);
      // A pack of "(content from …)" lines or a TODO is not a deliverable, whatever the lead says.
      const placeholders = [...new Set((text.match(/\(content from \/work\/[^)]*\)|\[insert [^\]]*\]|\bTODO\b|\bTBD\b|lorem ipsum/gi) || []).map(p => p.slice(0, 60)))];
      const ok = approved === true && covered.ok && text.length > 0 && checks.every(c => c.passed) && !placeholders.length;
      const rounds = (job.reworkRounds?.[team.id] || 0) + (ok ? 0 : 1);
      const review = { at: Date.now(), agent: current.lead, dept: team.id, approved: ok, summary: clean(summary).slice(0, 5000), criteria, checks, missing: covered.missing, file };
      this.update(id, j => { j.reviews.push(review); j.review = review; (j.reviewsByDept ||= {})[team.id] = review; (j.reworkRounds ||= {})[team.id] = rounds; if (ok) (j.deliverables ||= {})[team.id] = text.slice(0, 120000); if (text) j.result = text.slice(0, 120000); });
      this.event(id, 'review_recorded', current.lead, review.summary || (ok ? 'Approved.' : 'Changes required.'), { approved: ok, checks });
      if (this.get(id).state !== 'cancelled') this.setState(id, 'working');
      if (ok) return 'Review recorded as APPROVED. Report back to the Program Manager with a short summary.';
      const reasons = [approved !== true ? 'you did not approve it' : '', covered.missing.length ? `criteria without passing evidence: ${covered.missing.join(', ')}` : '', !text ? (fileProblem ? 'deliverable file problem: ' + fileProblem : 'no final deliverable was included: give deliverablePath (the handed-over file under /work/), or the text when it is a few lines') : '', ...checks.filter(c => !c.passed).map(c => `automated check failed: ${c.label}`), placeholders.length ? `the deliverable still holds placeholders (${placeholders.slice(0, 3).join(', ')}): a combined document must carry every part in full; use assemble_files` : ''].filter(Boolean);
      if (rounds > reworkRounds(current)) return `Review recorded as NOT approved (${reasons.join('; ')}). The rework limit is reached: report to the Program Manager that this needs the CEO’s direction.`;
      return `Review recorded as NOT approved (${reasons.join('; ')}). Send specific corrections to the specialist, then review again.`;
    }, { name: 'record_review', description: 'Record your review of the team’s actual work. Call once per review round, with evidence for every criterion and the final deliverable: deliverablePath, the handed-over file under /work/ (the office reads it), or deliverable, the text itself when it is a few lines.',
      schema: z.object({ approved: z.boolean(), summary: z.string(), criteria: z.array(z.object({ id: z.string(), passed: z.boolean(), evidence: z.string() })), deliverablePath: z.string().optional().describe('Path under /work/ of the file that is the final deliverable, exactly as the specialist handed it over, e.g. /work/pros/proposal.md. Do not copy its content.'), deliverable: z.string().optional().describe('The final deliverable text, only when it is a few lines (an email, a short answer): the finished content only, with no word counts, file paths, drafting notes or status labels'),
        changes: z.array(z.object({ specialist: z.string(), feedback: z.string() })).optional() }) });
  }
  completeTool(id) {
    return tool(async ({ summary }) => {
      const job = this.get(id); if (job.state === 'cancelled') return 'The task was cancelled.';
      const open = this.openHandoffs(job);
      if (open.length) { const office = this.office.get(), name = d => office.teams.find(t => t.id === d)?.name || d; this.event(id, 'completion_refused', 'pm', `Hand-off not delegated: ${open.map(h => name(h.team)).join(', ')}.`); return `Refused: a lead asked for a hand-off that you have not delegated yet: ${open.map(h => `${name(h.from)} needs ${name(h.team)} to ${h.request.slice(0, 200)} (delegate with the task tool to ${leadName(h.team)})`).join('; ')}. Delegate it, wait for that lead's approved review, then complete.`; }
      const stale = this.staleDepts(job);
      if (stale[0] === '(none yet)') { this.event(id, 'completion_refused', 'pm', 'No team has worked on it yet.'); return 'Refused: no department lead has worked on this yet. Delegate it to the right lead first.'; }
      if (stale.length) { this.event(id, 'completion_refused', 'pm', `No approved review from ${stale.map(leadName).join(', ')}.`); return `Refused: ${stale.map(leadName).join(', ')} has no approved review of the latest work. Ask the lead to review, then call complete_task again.`; }
      const office = this.office.get(), used = job.autoRoute ? involved(job) : job.depts, parts = used.map(d => job.deliverables?.[d]).filter(Boolean);
      const result = parts.length === 1 ? parts[0] : used.map(d => `## ${office.teams.find(t => t.id === d)?.name || d}\n\n${job.deliverables?.[d] || ''}`).join('\n\n');
      this.setState(id, 'saving');
      const version = { n: (job.resultVersions?.length || 0) + 1, at: Date.now(), summary: clean(summary).slice(0, 2000), correction: job.correction || null, result };
      this.update(id, j => { j.result = result; j.resultSummary = version.summary; j.resultVersions = [...(j.resultVersions || []), version]; j.correction = null; });
      try { await this.onComplete(this.get(id)); }
      catch (error) { this.setState(id, 'working'); return `Saving the result failed (${clean(error.message).slice(0, 300)}). Call complete_task again.`; }
      this.setState(id, 'done', { doneAt: Date.now(), pendingActions: [], error: null });
      this.event(id, 'completed', 'pm', `Result version ${version.n} saved.`);
      if (job.kind !== 'evaluation') this.notifications.notify({ kind: 'done', title: `Done: ${job.title}`, body: version.summary, jobId: id, dept: job.dept, action: { type: 'open' } });
      return `Task completed and filed as version ${version.n}. End your turn with a one-line confirmation.`;
    }, { name: 'complete_task', description: 'Complete the task once every involved lead has recorded an approved review of the latest work. Files the result for the CEO.', schema: z.object({ summary: z.string().describe('One paragraph: what was delivered') }) });
  }
  askTool(id) {
    return tool(async ({ question }) => {
      const q = clean(question).slice(0, 2000), job = this.get(id);
      this.update(id, j => { j.questions.push({ at: Date.now(), text: q }); });
      this.threads.append(id, { role: 'agent', agent: 'pm', kind: 'question', text: q, jobId: id });
      this.escalate(id, q, 'question');
      this.notifications.notify({ kind: 'question', title: `Question: ${job.title}`, body: q, jobId: id, dept: job.dept, dedupe: `question:${id}`, action: { type: 'answer' } });
      return 'Your question was sent to the CEO. End your turn now; you will be resumed with the answer.';
    }, { name: 'ask_ceo', description: 'Ask the CEO for information only they have, when no reasonable assumption is possible. Ends your turn.', schema: z.object({ question: z.string() }) });
  }
  /* ---------- the CEO's actions ---------- */
  validateArgs(name, args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw httpError('Edited arguments must be a JSON object.');
    const schema = this.toolHub?.tools?.find(t => t.name === name)?.schema; if (!schema) return;
    if (typeof schema.safeParse === 'function') { const r = schema.safeParse(args); if (!r.success) throw httpError('The edited arguments do not match the tool: ' + r.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')); return; }
    const missing = (schema.required || []).filter(k => args[k] === undefined || args[k] === '');
    if (missing.length) throw httpError(`The edited arguments are missing: ${missing.join(', ')}.`);
    for (const [key, spec] of Object.entries(schema.properties || {})) if (args[key] !== undefined && spec?.type && !typeMatches(args[key], spec.type)) throw httpError(`${key} must be ${spec.type}.`);
  }
  decide(id, input) {
    const job = this.get(id); if (!job) throw httpError('No such task.', 404);
    if (job.state !== 'awaiting_ceo' || !job.pendingActions?.length || this.running.has(id)) return { ok: false, message: 'This decision has already been made.', job };
    const list = Array.isArray(input) ? input : [input];
    if (list.length !== job.pendingActions.length) throw httpError(`Decide each of the ${job.pendingActions.length} pending actions.`);
    const decisions = list.map((d, i) => {
      const action = job.pendingActions[i], type = d?.type;
      if (!(action.allowed || []).includes(type)) throw httpError(`“${type}” is not allowed for ${action.name}.`);
      if (type === 'approve') return { type };
      if (type === 'reject') return { type, message: clean(d.message) || 'The CEO rejected this action. Do not repeat it.' };
      const args = d.args ?? d.editedAction?.args; this.validateArgs(action.name, args);
      return { type: 'edit', editedAction: { name: action.name, args } };
    });
    this.update(id, j => { j.decisions.push(...decisions.map((d, i) => ({ at: Date.now(), action: j.pendingActions[i].name, type: d.type, message: d.message || '', args: d.editedAction?.args ?? null }))); j.pendingActions = []; });
    decisions.forEach((d, i) => this.event(id, 'decision', null, `CEO ${d.type === 'edit' ? 'edited and approved' : d.type === 'approve' ? 'approved' : 'rejected'} ${job.pendingActions[i].name}.`, { decision: d.type }));
    this.notifications.ackForJob(id, ['ceo_decision', 'ceo_approval']);
    this.setState(id, decisions.some(d => d.type !== 'reject') ? 'executing' : 'working');
    this.schedule(id, { kind: 'decisions', decisions });
    return { ok: true, job: this.get(id) };
  }
  // Tasks the CEO points at (with @ in chat) come along as reference, trimmed.
  referenceText(ids = [], exclude = null) {
    const refs = [...new Set(ids)].filter(r => r && r !== exclude).slice(0, 5).map(r => this.get(r)).filter(Boolean);
    return refs.length ? '\n\nReference tasks the CEO pointed to:\n' + refs.map(r => `- “${r.title}” (${r.state}). Brief: ${r.text.slice(0, 500)}${r.result ? `\n  Latest result (excerpt): ${r.result.slice(0, 1500)}` : ''}${r.review?.summary ? `\n  Lead review: ${r.review.summary.slice(0, 300)}` : ''}`).join('\n') : '';
  }
  // "Remember this": the CEO's exact words become a standing rule for one person or the whole team.
  remember({ scope, text, agentId, dept, taskId }) {
    const config = this.office.get(), rule = { text: clean(text).slice(0, 300), at: Date.now(), task: taskId || '' };
    if (!rule.text) throw httpError('Write the rule first.');
    let who;
    if (scope === 'agent') { const agent = config.agents.find(a => a.id === agentId); if (!agent) throw httpError('Choose who should remember this.'); agent.rules = [...(agent.rules || []), rule].slice(-50); who = agent.name; }
    else if (scope === 'team') { const team = config.teams.find(t => t.id === dept); if (!team) throw httpError('Choose the team that should remember this.'); team.rules = [...(team.rules || []), rule].slice(-50); who = team.name; }
    else throw httpError('Remember this for a person or a team.');
    this.office.update(config, this.activeAgents());
    if (taskId) this.event(taskId, 'rule_saved', agentId, `Standing rule for ${who}: ${rule.text}`);
    return rule;
  }
  message(id, { text, kind = 'message', agent = null, refs = [], remember = null } = {}) {
    const job = this.get(id); if (!job) throw httpError('No such task.', 404);
    // A question can be asked about any task, including a cancelled one; nothing else reaches a cancelled task.
    if (job.state === 'cancelled' && kind !== 'question') throw httpError('This task was cancelled. Create a new task instead.', 409);
    const body = clean(text); if (!body) throw httpError('Write a message first.');
    const office = this.office.get(), target = agent ? office.agents.find(a => a.id === agent) : null;
    if (agent && !target) throw httpError('Unknown agent.');
    const refIds = (Array.isArray(refs) ? refs : []).filter(r => r !== id && this.get(r));
    // A question is answered in the thread; it never reopens or redirects the work.
    if (kind === 'question') {
      const message = this.threads.append(id, { role: 'ceo', agent, kind: 'question', text: body, jobId: id, meta: { refs: refIds } });
      this.event(id, 'message', agent, body.slice(0, 300), { kind: 'question' });
      return { question: true, queued: false, message, job };
    }
    if (remember) this.remember({ scope: remember, text: body, agentId: agent, dept: target?.department || job.dept, taskId: id });
    const busy = this.running.has(id) || job.state === 'awaiting_ceo' || this.waiting.includes(id);
    const notStarted = ['backlog', 'queued'].includes(job.state) && !job.startedAt;
    const message = this.threads.append(id, { role: 'ceo', agent, kind: busy ? 'note' : kind, text: body, jobId: id, delivered: !busy, meta: { refs: refIds } });
    this.event(id, 'message', agent, body.slice(0, 300), { kind: message.kind });
    if (busy) return { queued: true, message, job: this.get(id) };
    if (notStarted) return { queued: false, message, job };
    const reopening = job.state === 'done';
    this.update(id, j => { j.reprompts = 0; j.reworkRounds = {}; if (reopening) { j.reviewsByDept = {}; j.review = null; j.correction = { seq: message.seq, text: body, at: Date.now() }; } });
    this.notifications.ackForJob(id, ['question', 'escalated', 'blocked', 'provider_error']);
    this.setState(id, 'working', { error: null, escalation: null });
    const label = kind === 'answer' ? 'CEO answer' : reopening || kind === 'correction' ? 'CEO correction' : 'CEO message';
    // Tasks from before the upgrade, or whose checkpoints were cleared by retention, have no conversation to resume: start one with the brief and the current result.
    const context = job.harness === false || job.prunedAt ? `${this.brief(job)}${job.result ? '\n\nThe current result:\n' + job.result.slice(0, 20000) : ''}\n\n` : '';
    this.schedule(id, { kind: 'message', text: `${context}${label}${target ? ` for ${target.name} (${target.role})` : ''}: ${body}${this.referenceText(refIds, id)}` });
    return { queued: false, message, job: this.get(id) };
  }
  answer(id, text) { return this.message(id, { text, kind: 'answer' }); }
  retry(id, feedback, { automatic = false } = {}) {
    const job = this.get(id);
    if (!job || this.running.has(id) || !['blocked', 'escalated'].includes(job.state)) throw httpError('Only blocked or escalated tasks can be retried.', 409);
    const text = clean(feedback), started = job.calls > 0 && job.harness !== false && !job.prunedAt;
    if (text) this.threads.append(id, { role: 'ceo', kind: 'correction', text, jobId: id });
    this.update(id, j => { j.error = null; j.reprompts = 0; j.reworkRounds = {}; if (!automatic) j.autoRetries = 0; for (const r of j.runs) if (['failed', 'paused'].includes(r.state)) r.state = 'interrupted'; }, { touch: false });
    this.notifications.ackForJob(id, ['blocked', 'provider_error', 'escalated', 'question']);
    this.event(id, 'retry_requested', null, text || (automatic ? 'Retrying after the provider failure.' : 'CEO asked the team to continue.'));
    this.setState(id, 'queued', { escalation: null });
    this.update(id, j => { j.next = !started ? null : { kind: 'message', text: text ? `CEO: ${text}` : `Office: the task stopped before it was finished. Continue from where the work stopped; do not repeat finished work. ${this.stateSummary(j)}` }; }, { touch: false });
    this.pump(); return this.get(id);
  }
  cancel(id) {
    const job = this.get(id); if (!job || TERMINAL.has(job.state)) throw httpError('This task is already closed.', 409);
    if (job.state === 'saving') throw httpError('The approved result is being saved. Wait for it to finish.', 409);
    this.update(id, j => { for (const r of j.runs) if (['working', 'paused'].includes(r.state)) r.state = 'cancelled'; for (const c of Object.values(j.liveCalls || {})) if (c.state === 'running') c.state = 'cancelled'; j.pendingActions = []; j.next = null; });
    this.setState(id, 'cancelled');
    this.waiting = this.waiting.filter(w => w !== id); this.followUps.delete(id);
    this.running.get(id)?.controller.abort(new Error('Cancelled by the CEO.'));
    this.event(id, 'cancelled', null, 'CEO cancelled this task.');
    this.notifications.ackForJob(id);
    return this.get(id);
  }
  markSeen(id) {
    if (!this.get(id)) throw httpError('No such task.', 404);
    this.notifications.readForJob(id);
    return this.update(id, j => { j.seenAt = Date.now(); }, { touch: false });
  }
  // After a restart: continuations resume; anything that was mid-run waits for the CEO to retry.
  recover() {
    for (const job of this.list()) {
      if (TERMINAL.has(job.state)) continue;
      if (job.next && !['backlog'].includes(job.state)) { if (!this.waiting.includes(job.id)) this.waiting.push(job.id); continue; }
      if (ACTIVE.has(job.state) && job.state !== 'queued') {
        this.update(job.id, j => { for (const r of j.runs) if (r.state === 'working') r.state = 'interrupted'; for (const c of Object.values(j.liveCalls || {})) if (c.state === 'running') c.state = 'interrupted'; });
        this.block(job.id, 'The server restarted while this task was running. Retry to continue from where it stopped; finished work is kept.');
      }
    }
    this.pump();
  }
  async close() { this.closed = true; for (const entry of this.running.values()) entry.controller.abort(new Error('The server is stopping.')); await Promise.allSettled([...this.running.values()].map(e => e.promise)); try { await this.connectors?.pool?.close?.(); } catch {} this.db.close(); }
}
