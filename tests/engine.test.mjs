import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';
import { OfficeEngine } from '../engine/deep-agents.mjs';
import { ScriptedModel, call } from './helpers/fake-model.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-engine-'));
const typeOf = m => m._getType?.() || m.type;
const lastAi = messages => { for (let i = messages.length - 1; i >= 0; i--) if (typeOf(messages[i]) === 'ai') return i; return -1; };
const toolTexts = messages => messages.slice(lastAi(messages) + 1).filter(m => typeOf(m) === 'tool').map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
const criteria = system => [...new Set([...system.matchAll(/criterion-\d+/g)].map(m => m[0]))];
const COMPLETE = /^(Task completed|Refused|Saving the result failed|The task was cancelled)/, REVIEW = /^Review recorded/;

export const plan = () => call('write_todos', { todos: [{ content: 'Deliver through the lead', status: 'in_progress' }] });
export const defaultPm = ({ last }) => {
  if (last.type === 'human') return { calls: [plan(), call('task', { subagent_type: 'lead-marketing', description: 'Deliver: ' + last.text.slice(0, 160) })] };
  if (last.type === 'tool' && COMPLETE.test(last.text)) return { text: last.text.startsWith('Task completed') ? 'Done.' : 'Waiting for the review.' };
  if (last.type === 'tool') return { calls: [call('complete_task', { summary: 'Delivered the report.' })] };
  return { text: 'Done.' };
};
const defaultLead = (worker, { approve = true } = {}) => ({ last, system, messages }) => {
  if (last.type === 'human') return { calls: [call('task', { subagent_type: worker, description: 'Write the report' })] };
  if (last.type === 'tool' && REVIEW.test(last.text)) return { text: /APPROVED/.test(last.text) ? 'Review approved: the report is ready.' : 'Review not approved: ' + last.text };
  if (last.type === 'tool') return { calls: [call('record_review', { approved: approve, summary: 'Checked every criterion.', criteria: criteria(system).map(id => ({ id, passed: true, evidence: 'Present in the draft.' })), deliverable: 'Final: ' + toolTexts(messages).join('\n') })] };
  return { text: 'ok' };
};
function sendHub(sent) {
  const sendEmail = tool(async ({ to, body }) => { sent.push({ to, body }); return `sent to ${to}`; }, { name: 'send_email', description: 'Send an email', schema: z.object({ to: z.string(), body: z.string() }) });
  return { tools: [sendEmail], calls: [], async ensure() {}, toolsFor(args) { this.calls.push(args); return args.evaluation || args.readOnly ? { tools: [], interruptOn: {} } : { tools: [sendEmail], interruptOn: { send_email: { allowedDecisions: ['approve', 'edit', 'reject'] } } }; } };
}
function fixture({ dir = temp(), pm, lead, specialist, settings = {}, hub = null, configure, keep = false, knowledgeIndex = null, brain = null, engineOptions = {} } = {}) {
  const office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents });
  if (configure) { const config = office.get(); configure(config); office.update(config); }
  const team = office.team('marketing'), workers = office.agents().filter(a => a.department === 'marketing' && a.id !== team.lead).map(a => a.id);
  const scripts = { pm: pm || defaultPm, lead: lead ? lead(workers) : defaultLead(workers[0]), specialist: specialist || (() => ({ text: 'Verified result and evidence.' })) };
  const meter = { active: 0, peak: 0, start() { this.active++; this.peak = Math.max(this.peak, this.active); }, end() { this.active--; } };
  const models = { resolve: ({ role }) => ({ model: role === 'specialist' ? 'specialist' : role === 'pm' ? 'pm' : 'lead', effort: '' }), instance: async ({ model }) => new ScriptedModel(model, scripts[model], { meter }) };
  const completed = [];
  const engine = new OfficeEngine({ dataDir: dir, office, models, toolHub: hub, knowledgeDir: path.join(dir, 'knowledge'), knowledgeIndex, brain, settings: () => settings, onComplete: async job => { completed.push(job.id); }, ...engineOptions });
  return { dir, office, engine, workers, worker: workers[0], meter, completed, close: async () => { await engine.close(); if (!keep) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } };
}
async function until(engine, id, states, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const job = engine.get(id); if (states.includes(job.state) && !engine.running.has(id) && !engine.waiting.includes(id)) return engine.detail(id); await new Promise(r => setTimeout(r, 10)); }
  throw new Error(`Timed out waiting for ${states.join('/')}; the task is ${engine.get(id).state}. Events: ${engine.events(id).map(e => e.type).join(',')}`);
}
const start = (f, input = {}) => { const job = f.engine.create({ dept: 'marketing', text: 'Write a launch report.', autoStart: false, ...input }); f.engine.run(job.id); return job.id; };

test('the PM delegates to the lead, the lead to a specialist, and a recorded review lets the task complete', async () => {
  const f = fixture();
  try {
    const id = start(f); const done = await until(f.engine, id, ['done']);
    assert.deepEqual(done.runs.map(r => [r.role, r.state]), [['lead', 'done'], ['specialist', 'done']]);
    assert.equal(done.runs[1].agent, f.worker); assert.match(done.runs[1].output, /Verified result/);
    assert.equal(done.review.approved, true); assert.match(done.result, /^Final: Verified result/);
    assert.equal(done.resultVersions.length, 1); assert.deepEqual(f.completed, [id]);
    const states = done.events.filter(e => e.type === 'state_changed').map(e => e.to);
    for (const s of ['planning', 'working', 'awaiting_lead_review', 'reviewing', 'saving', 'done']) assert.ok(states.includes(s), `${s} missing from ${states.join(',')}`);
    assert.equal(f.engine.notifications.list().filter(n => n.kind === 'done').length, 1);
    assert.equal(done.messages[0].text, 'Write a launch report.');
  } finally { await f.close(); }
});

test('a rate-limited provider blocks the task quietly, the office retries it by itself, and the count starts again after a review', async () => {
  let failures = 0;
  const f = fixture({ specialist: () => { if (failures < 1) { failures++; throw Object.assign(new Error('google/x is temporarily rate-limited upstream. Please retry shortly'), { status: 429 }); } return { text: 'Verified result and evidence.' }; }, engineOptions: { providerRetryDelays: [20, 20, 20, 20] } });
  try {
    const id = start(f); const done = await until(f.engine, id, ['done']);
    const retries = done.events.filter(e => e.type === 'provider_retry');
    assert.equal(retries.length, 1); assert.match(retries[0].message, /attempt 1 of 4/);
    assert.equal(done.review.approved, true);
    assert.equal(f.engine.get(id).autoRetries, 0, 'a recorded review starts the count again');
    assert.equal(f.engine.providerHealth().lastHour, 1); assert.equal(f.engine.providerHealth().waits.lastHour, 0);
    f.engine.noteProviderWait({ status: 429, attempt: 1, delay: 2000, url: 'https://openrouter.ai/api/v1/chat/completions' });
    assert.deepEqual([f.engine.providerHealth().waits.lastHour, f.engine.providerHealth().waits.last.host], [1, 'openrouter.ai']);
  } finally { await f.close(); }
});

test('a plain question the Brain answers is answered by the Program Manager alone and filed without a team; the shortcut is refused for a piece of work', async () => {
  const pm = ({ last }) => last.type === 'human' ? { calls: [call('complete_task', { summary: 'Answered from the Brain.', answer: 'The last task was the November price change pack (see /knowledge/Agents Office/task-0c3b.md).' })] } : { text: 'Done.' };
  const f = fixture({ pm });
  try {
    const id = start(f, { text: 'What was the last task you worked on?' }); const done = await until(f.engine, id, ['done']);
    assert.equal(done.runs.length, 0, 'no team was engaged'); assert.equal(done.review.direct, true); assert.deepEqual(done.review.sources, ['/knowledge/Agents Office/task-0c3b.md']);
    assert.match(done.result, /^The last task was the November price change pack/); assert.equal(done.events.filter(e => e.type === 'answered_from_brain').length, 1);
  } finally { await f.close(); }
  let tried = false;
  const g = fixture({ pm: context => { console.error('PMCTX', context.last.type, JSON.stringify(String(context.last.text).slice(0, 70))); if (!tried && context.last.type === 'human') { tried = true; return { calls: [call('complete_task', { summary: 'Done.', answer: 'Here is the report (see /knowledge/x.md).' })] }; } return context.last.type === 'tool' && /^Refused: no department lead/.test(context.last.text) ? defaultPm({ last: { type: 'human', text: 'Write a launch report.' } }) : defaultPm(context); } });
  try {
    const id = start(g); const done = await until(g.engine, id, ['done']);
    assert.ok(done.events.some(e => e.type === 'completion_refused' && /No team has worked on it yet/.test(e.message)), 'a piece of work still goes through a team');
    assert.equal(done.review.direct, undefined); assert.ok(done.runs.length >= 2);
  } finally { await g.close(); }
});

test('an identical read repeated in one run is refused until something is written; a later read of a changed workspace goes through', async () => {
  let n = 0;
  const f = fixture({ specialist: () => { n++; if (n === 1 || n === 2) return { calls: [call('ls', { path: '/work' })] }; if (n === 3) return { calls: [call('write_file', { file_path: '/work/note.md', content: 'Verified result and evidence.' })] }; if (n === 4) return { calls: [call('ls', { path: '/work' })] }; return { text: 'Verified result and evidence; see /work/note.md.' }; } });
  try {
    const id = start(f); const done = await until(f.engine, id, ['done']);
    assert.equal(done.events.filter(e => e.type === 'repeat_refused' && e.agent === f.worker).length, 1, 'the second identical listing was refused, the one after the write went through');
    assert.equal(done.review.approved, true);
  } finally { await f.close(); }
});

test('completing without an approved review is refused, re-prompted once, then escalated to the CEO', async () => {
  const f = fixture({ pm: ({ last }) => last.type === 'human' ? { calls: [call('complete_task', { summary: 'Done already.' })] } : { text: 'I think it is done.' } });
  try {
    const id = start(f); const job = await until(f.engine, id, ['escalated']);
    assert.equal(job.events.filter(e => e.type === 'completion_refused').length, 2);
    assert.equal(job.events.filter(e => e.type === 'reprompted').length, 1);
    assert.equal(f.completed.length, 0); assert.match(job.error, /stopped before the task was complete/);
    assert.equal(f.engine.notifications.list().filter(n => n.kind === 'escalated').length, 1);
  } finally { await f.close(); }
});

test('a PM that stops early is re-prompted and then finishes the work', async () => {
  const f = fixture({ pm: context => context.last.type === 'human' && !/^Office:/.test(context.last.text) ? { text: 'On it.' } : defaultPm(context) });
  try {
    const id = start(f); const done = await until(f.engine, id, ['done']);
    assert.equal(done.events.filter(e => e.type === 'reprompted').length, 1); assert.equal(done.review.approved, true);
  } finally { await f.close(); }
});

test('an outbound tool pauses for the CEO, survives a restart, and runs once after approval', async () => {
  const sent = [], dir = temp();
  const specialist = ({ last }) => last.type === 'human' ? { calls: [call('send_email', { to: 'client@example.com', body: 'Hello' })] } : { text: 'Email handled: ' + last.text };
  const first = fixture({ dir, hub: sendHub(sent), specialist, keep: true });
  let second;
  try {
    const id = start(first); const parked = await until(first.engine, id, ['awaiting_ceo']);
    assert.equal(sent.length, 0); assert.equal(parked.pendingActions.length, 1);
    assert.deepEqual([parked.pendingActions[0].name, parked.pendingActions[0].args.to, parked.pendingActions[0].agent], ['send_email', 'client@example.com', first.worker]);
    assert.equal(first.engine.notifications.list()[0].kind, 'ceo_decision');
    await first.engine.close();
    second = fixture({ dir, hub: sendHub(sent), specialist });
    second.engine.recover(); assert.equal(second.engine.get(id).state, 'awaiting_ceo');
    assert.equal(second.engine.decide(id, [{ type: 'approve' }]).ok, true);
    const done = await until(second.engine, id, ['done']);
    assert.deepEqual(sent, [{ to: 'client@example.com', body: 'Hello' }]);
    assert.equal(done.decisions[0].type, 'approve'); assert.equal(done.runs.filter(r => r.role === 'specialist').length, 1);
    assert.equal(second.engine.notifications.counts().needsYou, 0);
  } finally { if (second) await second.close(); else { await first.engine.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } }
});

test('after a restart the lead reviews the file its specialist handed over before the interruption, without sending the specialist again', async () => {
  const dir = temp(); let release; const hold = new Promise(r => { release = r; });
  const specialist = ({ last }) => last.type === 'human' ? { calls: [call('write_file', { file_path: '/work/report.md', content: 'Verified result and evidence for every criterion.' })] } : { text: 'Handed over /work/report.md with the verified result.' };
  // In the first office the lead delegates, then hangs after the hand-over: the restart interrupts it there.
  const leadFirst = workers => ({ last }) => last.type === 'human' ? { calls: [call('task', { subagent_type: workers[0], description: 'Write the report to /work/report.md' })] } : { text: 'Reviewing.', wait: hold };
  // In the second office the resumed lead reviews the file straight away.
  const leadSecond = () => ({ last, system }) => last.type === 'human' ? { calls: [call('record_review', { approved: true, summary: 'Checked every criterion.', criteria: criteria(system).map(id => ({ id, passed: true, evidence: 'Present in the file.' })), deliverablePath: '/work/report.md' })] } : { text: /APPROVED/.test(last.text) ? 'Review approved: the report is ready.' : 'Review not approved: ' + last.text };
  const first = fixture({ dir, lead: leadFirst, specialist, keep: true }); let second;
  try {
    const id = start(first);
    const end = Date.now() + 20000; while (Date.now() < end && !first.engine.get(id).runs.some(r => r.role === 'specialist' && r.state === 'done')) await new Promise(r => setTimeout(r, 10));
    assert.ok(first.engine.get(id).runs.some(r => r.role === 'specialist' && r.state === 'done'), 'the specialist handed over before the restart');
    await first.engine.close(); release();
    second = fixture({ dir, lead: leadSecond, specialist });
    second.engine.recover(); assert.equal(second.engine.get(id).state, 'blocked'); assert.match(second.engine.get(id).error || '', /restarted/);
    second.engine.retry(id);
    const done = await until(second.engine, id, ['done']);
    assert.equal(done.runs.filter(r => r.role === 'specialist').length, 1, 'the specialist was not sent again');
    assert.equal(done.events.filter(e => e.type === 'review_refused').length, 0); assert.equal(done.events.filter(e => e.type === 'review_resumed').length, 1);
    assert.equal(done.review.approved, true); assert.equal(done.review.file, 'report.md');
  } finally { if (second) await second.close(); else { await first.engine.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } }
});

test('a rejected action never runs; an edited one must match the tool and runs as edited; a second decision is a no-op', async () => {
  const specialist = ({ last }) => last.type === 'human' ? { calls: [call('send_email', { to: 'client@example.com', body: 'Hello' })] } : { text: 'Email handled: ' + last.text };
  const sentA = [], a = fixture({ hub: sendHub(sentA), specialist });
  try {
    const id = start(a); await until(a.engine, id, ['awaiting_ceo']);
    a.engine.decide(id, [{ type: 'reject', message: 'Do not email the client yet.' }]);
    const done = await until(a.engine, id, ['done']);
    assert.equal(sentA.length, 0); assert.match(done.runs.find(r => r.role === 'specialist').output, /Do not email the client yet/);
  } finally { await a.close(); }
  const sentB = [], b = fixture({ hub: sendHub(sentB), specialist });
  try {
    const id = start(b); await until(b.engine, id, ['awaiting_ceo']);
    assert.throws(() => b.engine.decide(id, [{ type: 'edit', args: { to: 'ceo@example.com' } }]), /body/);
    assert.equal(b.engine.get(id).state, 'awaiting_ceo');
    assert.equal(b.engine.decide(id, [{ type: 'edit', args: { to: 'ceo@example.com', body: 'Edited body' } }]).ok, true);
    assert.equal(b.engine.decide(id, [{ type: 'approve' }]).ok, false);
    await until(b.engine, id, ['done']);
    assert.deepEqual(sentB, [{ to: 'ceo@example.com', body: 'Edited body' }]);
  } finally { await b.close(); }
});

test('a team that requires approval to close waits for the CEO before the result is filed', async () => {
  const f = fixture({ configure: c => { c.teams.find(t => t.id === 'marketing').completionApproval = true; } });
  try {
    const id = start(f); const parked = await until(f.engine, id, ['awaiting_ceo']);
    assert.equal(parked.pendingActions[0].name, 'complete_task'); assert.equal(f.completed.length, 0);
    assert.equal(f.engine.notifications.list()[0].kind, 'ceo_approval');
    f.engine.decide(id, [{ type: 'approve' }]);
    await until(f.engine, id, ['done']); assert.deepEqual(f.completed, [id]);
  } finally { await f.close(); }
});

test('a review that keeps failing escalates to the CEO instead of blocking', async () => {
  const f = fixture({ lead: workers => defaultLead(workers[0], { approve: false }), configure: c => { c.teams.find(t => t.id === 'marketing').maxReworkRounds = 0; } });
  try {
    const id = start(f); const job = await until(f.engine, id, ['escalated']);
    assert.match(job.error, /rework rounds/); assert.equal(job.review.approved, false); assert.equal(f.completed.length, 0);
  } finally { await f.close(); }
});

test('a correction on a finished task reopens it, needs a fresh review, and files version 2', async () => {
  const f = fixture();
  try {
    const id = start(f); await until(f.engine, id, ['done']);
    const reply = f.engine.message(id, { text: 'Shorten the introduction.' });
    assert.equal(reply.queued, false); assert.equal(f.engine.get(id).state, 'working');
    const done = await until(f.engine, id, ['done']);
    assert.equal(done.resultVersions.length, 2); assert.equal(done.reviews.length, 2);
    assert.equal(done.resultVersions[1].correction.text, 'Shorten the introduction.');
    assert.match(done.runs.filter(r => r.role === 'lead')[1].title, /CEO correction/);
  } finally { await f.close(); }
});

test('a note posted while the team works is kept, delivered at the next turn and survives in the thread', async () => {
  let release; const gate = new Promise(r => { release = r; }); let first = true;
  const f = fixture({ specialist: () => { if (first) { first = false; return { text: 'Draft one.', wait: gate }; } return { text: 'Draft two with October.' }; } });
  try {
    const id = start(f);
    const deadline = Date.now() + 3000; while (!f.engine.get(id).runs.some(r => r.role === 'specialist') && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
    const reply = f.engine.message(id, { text: 'Use the October launch date.' });
    assert.equal(reply.queued, true); assert.equal(f.engine.threads.pending(id).length, 1);
    release();
    const done = await until(f.engine, id, ['done']);
    assert.equal(f.engine.threads.pending(id).length, 0);
    assert.ok(done.messages.some(m => m.kind === 'note' && m.deliveredAt));
    assert.ok(done.runs.some(r => r.role === 'lead' && /Office: this task is already complete/.test(r.title)), 'the note reaches the PM behind the office’s note that the task was already complete');
    assert.match(done.events.find(e => e.type === 'notes_delivered')?.message || '', /after completion; approved reviews stand/);
  } finally { release(); await f.close(); }
});

test('a team works on no more than its parallel limit at once, and every assignment still finishes', async () => {
  const lead = workers => ({ last, system, messages }) => {
    if (last.type === 'human') return { calls: workers.slice(0, 4).map((w, i) => call('task', { subagent_type: w, description: 'Part ' + (i + 1) })) };
    if (last.type === 'tool' && REVIEW.test(last.text)) return { text: 'Review approved.' };
    if (last.type === 'tool') return { calls: [call('record_review', { approved: true, summary: 'All parts checked.', criteria: criteria(system).map(id => ({ id, passed: true, evidence: 'Checked.' })), deliverable: 'Final: ' + toolTexts(messages).join(' | ') })] };
    return { text: 'ok' };
  };
  const f = fixture({ lead, specialist: () => ({ text: 'Part done.', wait: 40 }), configure: c => { c.teams.find(t => t.id === 'marketing').maxParallelRuns = 2; } });
  try {
    const id = start(f); const done = await until(f.engine, id, ['done']);
    assert.equal(done.runs.filter(r => r.role === 'specialist' && r.state === 'done').length, 4);
    assert.equal(f.meter.peak, 2);
  } finally { await f.close(); }
});

test('cancelling stops the work and nothing is filed', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const f = fixture({ specialist: () => ({ text: 'Too late.', wait: gate }) });
  try {
    const id = start(f);
    const deadline = Date.now() + 3000; while (!f.engine.get(id).runs.some(r => r.role === 'specialist') && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
    f.engine.cancel(id); const job = await until(f.engine, id, ['cancelled']);
    assert.equal(f.completed.length, 0); assert.ok(job.runs.every(r => r.state !== 'working'));
    assert.throws(() => f.engine.message(id, { text: 'Actually continue.' }), /cancelled/);
  } finally { release(); await f.close(); }
});

test('an agent that repeats the same call is refused from the fifth time and finishes with what it has', async () => {
  let n = 0;
  const f = fixture({ specialist: () => n++ < 7 ? { calls: [call('ls', { path: '/work' })] } : { text: 'Verified result and evidence.' } });
  try {
    const id = start(f); const done = await until(f.engine, id, ['done']);
    const stopped = done.events.filter(e => e.type === 'loop_stopped');
    assert.equal(stopped.length, 3, 'the fifth, sixth and seventh identical calls are refused');
    assert.match(stopped[0].message, /ls was called with the same arguments 5 times/);
    assert.equal(done.review.approved, true);
  } finally { await f.close(); }
});

test('a lead records the review with the handed-over file path and the office reads the deliverable from it', async () => {
  const lead = workers => { const worker = workers[0]; return ({ last, system }) => {
    if (last.type === 'human') return { calls: [call('task', { subagent_type: worker, description: 'Write the report to /work/report.md' })] };
    if (last.type === 'tool' && REVIEW.test(last.text)) return { text: /APPROVED/.test(last.text) ? 'Review approved.' : 'Review not approved: ' + last.text };
    if (last.type === 'tool') return { calls: [call('record_review', { approved: true, summary: 'Read the file, every criterion holds.', criteria: criteria(system).map(id => ({ id, passed: true, evidence: 'In the file.' })), deliverablePath: '/work/report.md' })] };
    return { text: 'ok' };
  }; };
  const specialist = ({ last }) => last.type === 'human' ? { calls: [call('write_file', { file_path: '/work/report.md', content: '# Report\n\nVerified result and evidence, from the file.' })] } : { text: 'Handed over: /work/report.md holds the report.' };
  const f = fixture({ lead, specialist });
  try {
    const id = start(f); const done = await until(f.engine, id, ['done']);
    assert.equal(done.review.approved, true); assert.equal(done.review.file, 'report.md');
    assert.match(done.result, /^# Report[\s\S]*from the file\.$/, 'the result is the file content, not a copy typed by the lead');
  } finally { await f.close(); }
});

test('a review that names a file that does not exist is not approved, and says which path is missing', async () => {
  const lead = workers => { const worker = workers[0]; return ({ last, system }) => {
    if (last.type === 'human') return { calls: [call('task', { subagent_type: worker, description: 'Write the report' })] };
    if (last.type === 'tool' && REVIEW.test(last.text)) return { text: 'Review not approved: ' + last.text };
    if (last.type === 'tool') return { calls: [call('record_review', { approved: true, summary: 'Looks fine.', criteria: criteria(system).map(id => ({ id, passed: true, evidence: 'Yes.' })), deliverablePath: '/work/missing.md' })] };
    return { text: 'ok' };
  }; };
  const f = fixture({ lead });
  try {
    const id = start(f); const job = await until(f.engine, id, ['done', 'blocked', 'escalated', 'awaiting_ceo']);
    assert.equal(job.reviews[0].approved, false);
    const said = job.events.find(e => e.type === 'run_finished' && /missing\.md/.test(e.message || ''))?.message || job.runs.find(r => r.role === 'lead')?.output || '';
    assert.match(said + job.error, /no file at \/work\/missing\.md/);
  } finally { await f.close(); }
});

test('a specialist that replies with nothing is asked once more, and the second answer counts', async () => {
  let n = 0;
  const f = fixture({ specialist: () => n++ === 0 ? { text: '' } : { text: 'Verified result and evidence.' } });
  try {
    const id = start(f); const done = await until(f.engine, id, ['done']);
    assert.equal(done.events.filter(e => e.type === 'empty_reply').length, 1);
    assert.equal(done.review.approved, true); assert.match(done.result, /Verified result/);
  } finally { await f.close(); }
});

test('a lead may open three things before it delegates; the next reads are refused and it delegates', async () => {
  let n = 0;
  const lead = workers => { const worker = workers[0]; return ({ last, system, messages }) => {
    if (n < 5) { n++; return { calls: [call('read_file', { file_path: `/knowledge/note-${n}.md` })] }; }
    if (n === 5) { n++; return { calls: [call('task', { subagent_type: worker, description: 'Write the report; read note-1 and note-2 first' })] }; }
    if (last.type === 'tool' && REVIEW.test(last.text)) return { text: /APPROVED/.test(last.text) ? 'Review approved.' : 'Not approved: ' + last.text };
    if (last.type === 'tool') return { calls: [call('record_review', { approved: true, summary: 'Checked.', criteria: criteria(system).map(id => ({ id, passed: true, evidence: 'Present.' })), deliverable: 'Final: ' + toolTexts(messages).join('\n') })] };
    return { text: 'ok' };
  }; };
  const f = fixture({ lead });
  try {
    const id = start(f); const done = await until(f.engine, id, ['done']);
    assert.equal(done.events.filter(e => e.type === 'reads_capped').length, 2, 'the fourth and fifth reads before delegating are refused');
    assert.equal(done.review.approved, true);
  } finally { await f.close(); }
});

test('a hand-off to a team that is already working on the task is declined and not recorded', async () => {
  const f = fixture();
  try {
    const job = f.engine.create({ dept: 'sales', text: 'Validate the ICP.', autoStart: false });
    f.engine.update(job.id, j => { j.runs.push({ id: 'r-m', agent: f.office.team('marketing').lead, role: 'lead', dept: 'marketing', state: 'working', startedAt: Date.now() }); });
    const reply = await f.engine.handoffTool(job.id, f.office.team('sales'), f.office.get()).invoke({ team: 'marketing', request: 'Research the competitors.' });
    assert.match(reply, /MARKETING already has its package/);
    assert.equal((f.engine.get(job.id).handoffs || []).length, 0);
    assert.ok(f.engine.events(job.id).some(e => e.type === 'handoff_declined'));
    const recorded = await f.engine.handoffTool(job.id, f.office.team('sales'), f.office.get()).invoke({ team: 'emails', request: 'Research the competitors on the web.' });
    assert.match(recorded, /Recorded/); assert.equal(f.engine.get(job.id).handoffs.length, 1, 'a hand-off to a team that is not working on the task is recorded');
  } finally { await f.close(); }
});

test('the Program Manager cannot write into the workspace; it delegates instead', async () => {
  let step = 0;
  const pm = ({ last }) => {
    if (step++ === 0) return { calls: [plan(), call('write_file', { file_path: '/work/pm-draft.md', content: 'The PM wrote this itself.' })] };
    if (last.type === 'tool' && /permission denied/i.test(last.text)) return { calls: [call('task', { subagent_type: 'lead-marketing', description: 'Deliver the report' })] };
    return defaultPm({ last });
  };
  const f = fixture({ pm });
  try {
    const id = start(f); const done = await until(f.engine, id, ['done']);
    assert.equal(fs.existsSync(path.join(f.engine.workspaceDir(id), 'pm-draft.md')), false, 'nothing was written by the PM');
    assert.equal(done.review.approved, true);
  } finally { await f.close(); }
});

test('a resumed task does not run an approved package again, and tells a mid-flight package what its team already wrote', async () => {
  const f = fixture();
  try {
    const job = f.engine.create({ dept: 'marketing', text: 'Write the launch report.', autoStart: false });
    const mlead = f.office.team('marketing').lead, title = 'MARKETING: write the launch announcement';
    fs.mkdirSync(f.engine.workspaceDir(job.id), { recursive: true }); fs.writeFileSync(path.join(f.engine.workspaceDir(job.id), 'announcement.md'), '# Announcement');
    f.engine.update(job.id, j => { j.runs.push({ id: 'r-1', agent: mlead, role: 'lead', dept: 'marketing', title, state: 'interrupted', startedAt: Date.now() - 60000 }); });
    const mid = f.engine.resumeCheck(job.id, { name: 'task', args: { subagent_type: 'lead-marketing', description: title } });
    assert.match(mid.description, /^Office note: this assignment was interrupted[\s\S]*\/work\/announcement\.md[\s\S]*MARKETING: write the launch announcement$/);
    f.engine.update(job.id, j => { j.reviewsByDept = { marketing: { approved: true, at: Date.now(), summary: 'Approved: the announcement is ready.' } }; });
    const done = f.engine.resumeCheck(job.id, { name: 'task', args: { subagent_type: 'lead-marketing', description: title + '. CONTEXT FROM THE OTHER PARTS: the pricing table is approved; align the announcement with it.' } });
    assert.match(done.skip, /Already done before the interruption[\s\S]*APPROVED review[\s\S]*\/work\/announcement\.md/, 'a re-worded brief for the same package is still recognised');
    assert.equal(f.engine.resumeCheck(job.id, { name: 'task', args: { subagent_type: 'lead-marketing', description: 'MARKETING: write the objection-handling sheet for the new prices' } }), null, 'a different package for the same team runs');
    f.engine.update(job.id, j => { j.correction = { seq: 9, text: 'Change the headline.', at: Date.now() + 1000 }; });
    const again = f.engine.resumeCheck(job.id, { name: 'task', args: { subagent_type: 'lead-marketing', description: title } });
    assert.equal(again.skip, undefined, 'after a CEO correction the same package is not skipped'); assert.match(again.description, /reuse what is good/);
    assert.ok(f.engine.events(job.id).some(e => e.type === 'resume_skipped'));
    assert.equal(f.engine.resumeCheck(job.id, { name: 'task', args: { subagent_type: 'lead-marketing', description: 'A brand-new package' } }), null, 'a new brief is not a resume');
  } finally { await f.close(); }
});

test('when a task continues after a stop, the Program Manager is told what is already approved and what is not', async () => {
  const f = fixture();
  try {
    const job = f.engine.create({ dept: 'marketing', text: 'Write it.', autoStart: false });
    f.engine.update(job.id, j => { j.runs.push({ id: 'r1', agent: 'x', role: 'lead', dept: 'marketing', state: 'done', startedAt: 1 }, { id: 'r2', agent: 'y', role: 'lead', dept: 'sales', state: 'interrupted', startedAt: 2 }); j.reviewsByDept = { marketing: { approved: true, at: Date.now(), file: 'plan.md', summary: 'ok' } }; });
    const text = f.engine.stateSummary(f.engine.get(job.id));
    assert.match(text, /Approved and final so far: MARKETING \(approved \d\d:\d\d UTC, \/work\/plan\.md\)\. Still without an approved review: SALES\. Do not delegate an approved package again/);
  } finally { await f.close(); }
});

test('a lead that delegates to someone outside its team is refused with the right names and carries on', async () => {
  let tried = false;
  const lead = workers => { const worker = workers[0]; return ({ last, system, messages }) => {
    if (last.type === 'human') { tried = true; return { calls: [call('task', { subagent_type: 'alead', description: 'Check the numbers' })] }; }
    if (last.type === 'tool' && /not one of your specialists/.test(last.text)) return { calls: [call('task', { subagent_type: worker, description: 'Write the report' })] };
    if (last.type === 'tool' && REVIEW.test(last.text)) return { text: /APPROVED/.test(last.text) ? 'Review approved.' : 'Not approved: ' + last.text };
    if (last.type === 'tool') return { calls: [call('record_review', { approved: true, summary: 'Checked.', criteria: criteria(system).map(id => ({ id, passed: true, evidence: 'Present.' })), deliverable: 'Final: ' + toolTexts(messages).join('\n') })] };
    return { text: 'ok' };
  }; };
  const f = fixture({ lead });
  try {
    const id = start(f); const done = await until(f.engine, id, ['done']);
    assert.ok(tried);
    const refused = done.events.filter(e => e.type === 'subagent_refused'); assert.equal(refused.length, 1);
    assert.match(refused[0].message, /"alead", who is not on the team/);
    assert.equal(done.review.approved, true); assert.equal(done.runs.filter(r => r.role === 'specialist').length, 1, 'only the real specialist ran');
  } finally { await f.close(); }
});

test('a lead proposes a Brain change; nothing is written until the CEO approves, then the note is appended and archived', async () => {
  const notes = { '00-Meta/numbers-ledger.md': '# Numbers ledger\n\n| Metric | Value |\n|---|---|\n| Active clients | 14 |' }, written = [];
  const brain = { read: id => { if (!(id in notes)) throw new Error('no such note'); return { id, content: notes[id] }; }, save: async ({ id, content }) => { notes[id] = content; written.push(id); return { id }; } };
  const lead = workers => { const worker = workers[0]; return ({ last, system, messages }) => {
    if (last.type === 'human') return { calls: [call('update_brain_note', { path: '/knowledge/00-Meta/numbers-ledger.md', mode: 'append', content: '| Growth plan price (from 1 Oct 2026) | $2,700 per month |', why: 'The CEO confirmed the price in this task.' })] };
    if (last.type === 'tool' && /^Written to/.test(last.text)) return { calls: [call('task', { subagent_type: worker, description: 'Write the report' })] };
    if (last.type === 'tool' && REVIEW.test(last.text)) return { text: /APPROVED/.test(last.text) ? 'Review approved.' : 'Not approved: ' + last.text };
    if (last.type === 'tool') return { calls: [call('record_review', { approved: true, summary: 'Checked.', criteria: criteria(system).map(id => ({ id, passed: true, evidence: 'Present.' })), deliverable: 'Final: ' + toolTexts(messages).join('\n') })] };
    return { text: 'ok' };
  }; };
  const f = fixture({ lead, brain });
  try {
    const id = start(f); const parked = await until(f.engine, id, ['awaiting_ceo']);
    assert.equal(parked.pendingActions[0].name, 'update_brain_note'); assert.equal(written.length, 0, 'nothing is written before the CEO decides');
    assert.equal(f.engine.decide(id, [{ type: 'approve' }]).ok, true);
    const done = await until(f.engine, id, ['done']);
    assert.deepEqual(written, ['00-Meta/numbers-ledger.md']);
    assert.match(notes['00-Meta/numbers-ledger.md'], /Active clients \| 14 \|\n\n\| Growth plan price \(from 1 Oct 2026\) \| \$2,700 per month \|\n$/);
    assert.ok(done.events.some(e => e.type === 'brain_updated' && /Appended to \/knowledge\/00-Meta\/numbers-ledger\.md/.test(e.message)));
    assert.equal(done.review.approved, true);
  } finally { await f.close(); }
});

test('a review whose deliverable is a set of placeholders is not approved, and the lead is told to assemble the files', async () => {
  const lead = workers => { const worker = workers[0]; return ({ last, system }) => {
    if (last.type === 'human') return { calls: [call('task', { subagent_type: worker, description: 'Write the report' })] };
    if (last.type === 'tool' && REVIEW.test(last.text)) return { text: 'Review not approved: ' + last.text };
    if (last.type === 'tool') return { calls: [call('record_review', { approved: true, summary: 'Looks complete.', criteria: criteria(system).map(id => ({ id, passed: true, evidence: 'Yes.' })), deliverable: '# Launch pack\n\n## Marketing\n\n(Content from /work/launch-pack/01-marketing.md)\n\n## Sales\n\n(Content from /work/launch-pack/02-sales.md)' })] };
    return { text: 'ok' };
  }; };
  const f = fixture({ lead });
  try {
    const id = start(f); const job = await until(f.engine, id, ['done', 'blocked', 'escalated', 'awaiting_ceo']);
    assert.equal(job.reviews[0].approved, false);
    const said = job.runs.find(r => r.role === 'lead')?.output || '';
    assert.match(said, /still holds placeholders \(\(Content from \/work\/launch-pack\/01-marketing\.md\)/); assert.match(said, /use assemble_files/);
  } finally { await f.close(); }
});

test('the Program Manager may open four things before delegating; the fifth is refused and it delegates', async () => {
  let n = 0;
  const pm = ({ last }) => {
    if (n < 6) { n++; return { calls: n === 1 ? [plan(), call('read_file', { file_path: '/knowledge/note-1.md' })] : [call('read_file', { file_path: `/knowledge/note-${n}.md` })] }; }
    if (n === 6) { n++; return { calls: [call('task', { subagent_type: 'lead-marketing', description: 'Deliver the report; read note-1 first' })] }; }
    return defaultPm({ last });
  };
  const f = fixture({ pm });
  try {
    const id = start(f); const done = await until(f.engine, id, ['done']);
    assert.equal(done.events.filter(e => e.type === 'reads_capped' && e.agent === 'pm').length, 2, 'the fifth and sixth reads before delegating are refused');
    assert.equal(done.review.approved, true);
  } finally { await f.close(); }
});

test('a specialist may open twelve things in one run; the thirteenth is refused and it writes with what it has', async () => {
  let n = 0;
  const f = fixture({ specialist: () => n++ < 14 ? { calls: [call('read_file', { file_path: `/knowledge/n${n}.md` })] } : { text: 'Verified result and evidence.' } });
  try {
    const id = start(f); const done = await until(f.engine, id, ['done']);
    assert.equal(done.events.filter(e => e.type === 'reads_capped' && e.agent === f.worker).length, 2);
    assert.equal(done.review.approved, true);
  } finally { await f.close(); }
});

test('a note sent while the task was busy and delivered after completion does not undo the approved reviews', async () => {
  const gate = 300;
  const f = fixture({ specialist: () => ({ text: 'Verified result and evidence.', wait: gate }) });
  try {
    const id = start(f);
    await new Promise(r => setTimeout(r, 60)); assert.ok(f.engine.running.has(id), 'the task is running');
    const sent = f.engine.message(id, { text: 'Also mention October in the title.' }); assert.equal(sent.queued, true);
    const done = await until(f.engine, id, ['done']);
    const delivered = done.events.find(e => e.type === 'notes_delivered');
    assert.ok(delivered, 'the note reached the Program Manager'); assert.match(delivered.message, /after completion; approved reviews stand/);
    assert.equal(done.reviews.filter(r => r.approved).length >= 1, true);
  } finally { await f.close(); }
});

test('a specialist that thrashes hits the step budget: reads are refused, writing and handing over still work', async () => {
  let n = 0;
  const f = fixture({ specialist: () => { n++; if (n <= 43) return { calls: [call('read_file', { file_path: `/knowledge/note-${n}.md` })] }; if (n === 44) return { calls: [call('write_file', { file_path: '/work/report.md', content: 'Verified result and evidence.' })] }; return { text: 'Verified result and evidence; handed over /work/report.md.' }; } });
  try {
    const id = start(f); const done = await until(f.engine, id, ['done']);
    assert.equal(done.events.filter(e => e.type === 'steps_capped' && e.agent === f.worker).length, 1);
    assert.equal(done.events.filter(e => e.type === 'reads_capped' && e.agent === f.worker).length, 40 - 12, 'the read cap refused reads 13 to 40; from 41 the step budget refused first');
    assert.ok(fs.existsSync(path.join(f.engine.workspaceDir(id), 'report.md')), 'the write past the step budget went through');
    assert.equal(done.review.approved, true);
  } finally { await f.close(); }
});

test('a task that runs past the time limit is blocked with a plain reason', async () => {
  const f = fixture({ settings: { runTimeoutMinutes: 0.002 }, specialist: () => ({ text: 'Slow.', wait: 1500 }) });
  try { const id = start(f); const job = await until(f.engine, id, ['blocked']); assert.match(job.error, /no progress/); assert.equal(f.engine.notifications.list()[0].kind, 'blocked'); }
  finally { await f.close(); }
});

test('a provider error blocks the task with the real reason, and retry continues it', async () => {
  let failures = 1;
  const f = fixture({ pm: context => { if (failures-- > 0) throw new Error('Provider overloaded.'); return defaultPm(context); } });
  try {
    const id = start(f); const blocked = await until(f.engine, id, ['blocked']);
    assert.equal(blocked.error, 'Provider overloaded.');
    f.engine.retry(id); const done = await until(f.engine, id, ['done']);
    assert.equal(done.review.approved, true); assert.equal(f.engine.notifications.counts().needsYou, 0);
  } finally { await f.close(); }
});

test('team tests run without outbound tools and do not notify the CEO', async () => {
  const sent = [], hub = sendHub(sent);
  const f = fixture({ hub, configure: c => { c.teams.find(t => t.id === 'marketing').tests = [{ id: 'evidence', name: 'Evidence check', prompt: 'Prepare report.', requiredText: ['Verified'] }]; } });
  try {
    const job = f.engine.create({ dept: 'marketing', kind: 'evaluation', testId: 'evidence', text: 'Prepare report.', autoStart: false });
    f.engine.run(job.id); const done = await until(f.engine, job.id, ['done']);
    assert.ok(hub.calls.length > 0 && hub.calls.every(c => c.evaluation === true)); assert.equal(done.completionApproval, false);
    assert.equal(f.engine.notifications.list().length, 0);
  } finally { await f.close(); }
});

test('a correction can point at other tasks and be kept as a standing rule in the CEO’s own words', async () => {
  const heard = [];
  const f = fixture({ pm: context => { if (context.last.type === 'human') heard.push(context.last.text); return defaultPm(context); } });
  try {
    const a = start(f, { text: 'Write the Q2 pricing sheet.' }); await until(f.engine, a, ['done']);
    const b = start(f, { text: 'Write the Q3 pricing sheet.' }); await until(f.engine, b, ['done']);
    const lead = f.office.team('marketing').lead;
    f.engine.message(b, { text: 'Match the layout of the Q2 sheet.', kind: 'correction', agent: lead, refs: [a, 'missing-task'], remember: 'agent' });
    await until(f.engine, b, ['done']);
    const correction = heard.find(t => t.startsWith('CEO correction'));
    assert.match(correction, /Reference tasks the CEO pointed to:\n- “Write the Q2 pricing sheet\.” \(done\)/); assert.doesNotMatch(correction, /missing-task/);
    assert.deepEqual(f.office.agents().find(x => x.id === lead).rules.map(r => [r.text, r.task]), [['Match the layout of the Q2 sheet.', b]]);
    const { leadPrompt } = await import('../engine/prompts.mjs');
    const office = f.office.get(), team = office.teams.find(t => t.id === 'marketing');
    assert.match(leadPrompt({ office, team, lead: office.agents.find(x => x.id === lead), specialists: [], reworkRounds: 3 }), /Standing rules from the CEO \(always follow\):\n- Match the layout of the Q2 sheet\./);
    assert.ok(f.engine.events(b).some(e => e.type === 'rule_saved'));
  } finally { await f.close(); }
});

test('a question about a task is kept in its thread without reopening the work', async () => {
  const f = fixture();
  try {
    const id = start(f); await until(f.engine, id, ['done']);
    const reply = f.engine.message(id, { text: 'Why did you choose this headline?', kind: 'question' });
    assert.equal(reply.question, true); assert.equal(f.engine.get(id).state, 'done'); assert.equal(f.engine.running.has(id), false);
    assert.equal(f.engine.threads.list(id).at(-1).kind, 'question');
  } finally { await f.close(); }
});

test('agents search the Brain, the brief is seeded with matching notes, and the notes used are recorded as sources', async () => {
  const searches = [], heard = [];
  const knowledgeIndex = { search: (query, options) => { searches.push([query, options.k]); return [{ path: 'Company/prices.md', heading: 'Ticket prices', snippet: 'Adult tickets cost 45 euros.', score: 1 }]; } };
  const specialist = ({ last }) => last.type === 'human' ? { calls: [call('search_knowledge', { query: 'ticket prices' })] } : { text: 'Prices: 45 euros (Company/prices.md).' };
  const f = fixture({ knowledgeIndex, specialist, settings: { knowledgeSeedNotes: 3 }, pm: context => { if (context.last.type === 'human') heard.push(context.last.text); return defaultPm(context); } });
  try {
    const id = start(f, { text: 'Write the price list.' }); const done = await until(f.engine, id, ['done']);
    assert.match(heard[0], /Brain notes that match this brief[\s\S]*Company\/prices\.md › Ticket prices: Adult tickets cost 45 euros\./);
    assert.deepEqual(searches[0], ['Write the price list.', 3]); assert.ok(searches.some(([q]) => q === 'ticket prices'));
    assert.deepEqual(done.sources, ['Company/prices.md']); assert.deepEqual(done.runs.find(r => r.role === 'specialist').sources, ['Company/prices.md']);
  } finally { await f.close(); }
});

test('the Program Manager can choose the team itself; only the lead it involved must approve', async () => {
  const pm = context => context.last.type === 'human' ? { calls: [plan(), call('task', { subagent_type: 'lead-sales', description: 'Deliver: ' + context.last.text })] } : defaultPm(context);
  const lead = () => context => {
    const specialist = /Specialists on your team:\n- ([a-z0-9_-]+):/i.exec(context.system)?.[1];
    return context.last.type === 'human' ? { calls: [call('task', { subagent_type: specialist, description: 'Write it' })] } : defaultLead(specialist)(context);
  };
  const f = fixture({ pm, lead });
  try {
    const job = f.engine.create({ depts: 'auto', text: 'Draft a quote for a private charter.', autoStart: false });
    assert.equal(job.autoRoute, true); assert.equal(job.agent, 'pm'); assert.equal(job.depts.length, f.office.get().teams.length);
    f.engine.run(job.id); const done = await until(f.engine, job.id, ['done']);
    assert.deepEqual([...new Set(done.runs.map(r => r.dept))], ['sales']); assert.deepEqual(Object.keys(done.reviewsByDept), ['sales']);
    assert.equal(done.runs.find(r => r.role === 'specialist').dept, 'sales');
    const { listShape } = await import('../server/shape.mjs');
    assert.equal(listShape(done, f.office.get()).teamName, 'Program Manager');
  } finally { await f.close(); }
});

test('with no team involved yet, completion is refused and the Program Manager is told to delegate', async () => {
  const f = fixture({ pm: ({ last }) => last.type === 'human' ? { calls: [call('complete_task', { summary: 'Done.' })] } : { text: 'Finished.' } });
  try {
    const job = f.engine.create({ depts: 'auto', text: 'Anything.', autoStart: false }); f.engine.run(job.id);
    const out = await until(f.engine, job.id, ['escalated']);
    assert.ok(out.events.some(e => e.type === 'reprompted' && /No department lead has worked on this yet/.test(e.message)));
  } finally { await f.close(); }
});

test('a provider failure raises one "model provider problem" item that says where to fix it, and retry clears it', async () => {
  let failures = 1;
  const f = fixture({ pm: context => { if (failures-- > 0) throw Object.assign(new Error('401 Incorrect API key provided.'), { status: 401 }); return defaultPm(context); } });
  try {
    const id = start(f); await until(f.engine, id, ['blocked']);
    const items = f.engine.notifications.list().filter(n => n.jobId === id);
    assert.equal(items.length, 1); assert.equal(items[0].kind, 'provider_error');
    assert.match(items[0].title, /Model provider problem/); assert.match(items[0].body, /Settings → Models & keys/);
    assert.equal(f.engine.notifications.counts().needsYou, 1);
    f.engine.retry(id); await until(f.engine, id, ['done']);
    assert.equal(f.engine.notifications.counts().needsYou, 0);
  } finally { await f.close(); }
});

test('retention clears the workspace and checkpoints of old finished work only, and a later correction restarts with the brief and result', async () => {
  const humans = [];
  const f = fixture({ pm: context => { if (context.last.type === 'human') humans.push(context.last.text); return defaultPm(context); } });
  try {
    const id = start(f); await until(f.engine, id, ['done']);
    const idea = f.engine.create({ dept: 'marketing', text: 'An idea for later.', backlog: true, autoStart: false });
    const workspace = path.join(f.dir, 'workspaces', id), rows = () => f.engine.db.prepare('SELECT COUNT(*) AS n FROM checkpoints WHERE thread_id = ?').get(id).n;
    assert.ok(fs.existsSync(workspace)); assert.ok(rows() > 0);
    assert.deepEqual(f.engine.prune({ now: Date.now() + 5 * 86400000 }), [], 'recent work is kept');
    assert.deepEqual(f.engine.prune({ now: Date.now() + 31 * 86400000 }), [id]);
    assert.ok(!fs.existsSync(workspace)); assert.equal(rows(), 0); assert.ok(f.engine.get(id).prunedAt); assert.equal(f.engine.get(idea.id).prunedAt, undefined);
    assert.ok(f.engine.detail(id).result, 'the record and result stay');
    assert.doesNotMatch(humans[0], /The current result:/);
    f.engine.message(id, { text: 'Shorten it.' }); const done = await until(f.engine, id, ['done']);
    assert.match(humans.at(-1), /Write a launch report\./); assert.match(humans.at(-1), /The current result:/); assert.match(humans.at(-1), /Shorten it\./);
    assert.equal(done.resultVersions.length, 2); assert.equal(f.engine.get(id).prunedAt, null);
  } finally { await f.close(); }
});

test('a lead cannot review its own work: the review is refused until a specialist hands work over', async () => {
  let tried = false;
  const f = fixture({ lead: workers => ({ last, system, messages }) => {
    if (last.type === 'human' && !tried) { tried = true; return { calls: [call('record_review', { approved: true, summary: 'I wrote it myself.', criteria: criteria(system).map(id => ({ id, passed: true, evidence: 'Mine.' })), deliverable: 'Lead-written text.' })] }; }
    if (last.type === 'tool' && /^Refused: nobody on your team/.test(last.text)) return { calls: [call('task', { subagent_type: workers[0], description: 'Write the report' })] };
    return defaultLead(workers[0])({ last, system, messages });
  } });
  try {
    const id = start(f); const done = await until(f.engine, id, ['done']);
    assert.ok(f.engine.events(id).some(e => e.type === 'review_refused'));
    assert.equal(done.reviews.length, 1); assert.ok(done.runs.some(r => r.agent === f.worker));
    assert.doesNotMatch(done.result, /Lead-written/);
  } finally { await f.close(); }
});

test('a cancelled task still answers questions but refuses corrections', async () => {
  const f = fixture();
  try {
    const job = f.engine.create({ dept: 'marketing', text: 'An idea.', backlog: true, autoStart: false }); f.engine.cancel(job.id);
    const asked = f.engine.message(job.id, { text: 'Why was this stopped?', kind: 'question' });
    assert.equal(asked.message.kind, 'question'); assert.equal(f.engine.get(job.id).state, 'cancelled');
    assert.throws(() => f.engine.message(job.id, { text: 'Redo it.', kind: 'correction' }), /cancelled/);
  } finally { await f.close(); }
});

test('a lead hands part of the work to another team through the Program Manager and keeps working on its own part', async () => {
  const pm = context => {
    if (context.last.type === 'tool' && /^Refused: a lead asked for a hand-off/.test(context.last.text)) return { calls: [call('task', { subagent_type: 'lead-sales', description: 'Confirm the price list for the launch report.' })] };
    return defaultPm(context);
  };
  const lead = () => context => {
    const specialist = /Specialists on your team:\n- ([a-z0-9_-]+):/i.exec(context.system)?.[1], marketing = /lead of the MARKETING team/i.test(context.system);
    if (context.last.type === 'human') return { calls: [...(marketing ? [call('hand_to_program_manager', { team: 'sales', request: 'Confirm the current price list.' })] : []), call('task', { subagent_type: specialist, description: 'Write it' })] };
    return defaultLead(specialist)(context);
  };
  const f = fixture({ pm, lead });
  try {
    const id = start(f); const done = await until(f.engine, id, ['done'], 15000);
    assert.equal(done.handoffs.length, 1); assert.deepEqual([done.handoffs[0].from, done.handoffs[0].team], ['marketing', 'sales']);
    assert.ok(done.depts.includes('sales'), 'the other team is now involved');
    assert.ok(f.engine.events(id).some(e => e.type === 'handoff_requested'));
    assert.ok(f.engine.events(id).some(e => e.type === 'completion_refused' && /Hand-off/.test(e.message)), 'the PM could not close before delegating');
    assert.deepEqual(Object.keys(done.reviewsByDept).sort(), ['marketing', 'sales']);
    assert.ok(done.runs.some(r => r.role === 'specialist' && r.dept === 'marketing') && done.runs.some(r => r.role === 'specialist' && r.dept === 'sales'));
  } finally { await f.close(); }
});

test('a connector enabled for one team is usable there and absent for another team and for a person opted out of it', async () => {
  const { ToolHub } = await import('../engine/tools.mjs');
  const lookup = tool(async () => 'price list: 42', { name: 'mcp__crm__lookup', description: 'Look up a price', schema: z.object({}) });
  const hub = new ToolHub({ clientFactory: async () => ({ getTools: async () => [lookup], close: async () => {} }), items: () => [{ name: 'crm', config: { type: 'http', url: 'https://crm.example/mcp' } }] });
  const replies = {};
  const specialist = ({ last, system }) => {
    const who = /You are ([A-Z][A-Z ]+),/.exec(system)?.[1] || 'someone';
    if (last.type === 'human') return { calls: [call('mcp__crm__lookup', {})] };
    (replies[who] ||= []).push(last.text); return { text: 'Done: ' + last.text.slice(0, 60) };
  };
  const lead = () => context => { const sp = /Specialists on your team:\n- ([a-z0-9_-]+):/i.exec(context.system)?.[1]; return context.last.type === 'human' ? { calls: [call('task', { subagent_type: sp, description: 'Look it up' })] } : defaultLead(sp)(context); };
  const pm = context => context.last.type === 'human' ? { calls: [plan(), call('task', { subagent_type: /for (SALES|Sales)/.test(context.last.text) ? 'lead-sales' : 'lead-marketing', description: 'Deliver: ' + context.last.text.slice(0, 120) })] } : defaultPm(context);
  const f = fixture({ pm, lead, specialist, hub, configure: config => { config.teams.find(t => t.id === 'marketing').tools = ['crm']; config.teams.find(t => t.id === 'sales').tools = []; } });
  try {
    const m = start(f); const marketing = await until(f.engine, m, ['done'], 15000);
    const s = start(f, { dept: 'sales' }); const sales = await until(f.engine, s, ['done'], 15000);
    const used = job => job.runs.filter(r => r.role === 'specialist').flatMap(r => r.tools);
    assert.deepEqual(used(marketing), ['mcp__crm__lookup'], 'the enabled team used the connector'); assert.deepEqual(used(sales), [], 'the other team never got it');
    assert.ok(Object.values(replies).flat().some(t => /price list: 42/.test(t)), 'the marketing specialist got the real result');
    assert.ok(Object.values(replies).flat().some(t => /not a valid tool|unknown tool|not available/i.test(t)), 'the sales specialist was told the tool does not exist');
    // A person can opt out of the team's connectors.
    const cfg = f.office.get(); const worker = cfg.agents.find(a => a.department === 'marketing' && a.id === f.worker); worker.inheritTools = false; worker.tools = []; f.office.update(cfg);
    const m2 = start(f); const again = await until(f.engine, m2, ['done'], 15000);
    assert.deepEqual(used(again), [], 'the opted-out person no longer has it');
  } finally { await hub.close(); await f.close(); }
});

test('the Program Manager plans with write_todos, sees its project-management skills, and the plan shows on the task', async () => {
  let system = '';
  let refused = false;
  const pm = context => {
    system = context.system;
    if (context.last.type === 'human') return { calls: [call('task', { subagent_type: 'lead-marketing', description: 'Deliver the launch report' })] };
    if (context.last.type === 'tool' && /^Refused: plan first/.test(context.last.text)) { refused = true; return { calls: [call('write_todos', { todos: [{ content: 'Marketing: write the launch report', status: 'in_progress' }, { content: 'Close after the lead approves', status: 'pending' }] })] }; }
    if (context.last.type === 'tool' && /todo/i.test(context.last.text) && !/Task completed|Review/.test(context.last.text)) return { calls: [call('task', { subagent_type: 'lead-marketing', description: 'Deliver the launch report' })] };
    return defaultPm(context);
  };
  const f = fixture({ pm });
  try {
    const id = start(f); const done = await until(f.engine, id, ['done']);
    assert.match(system, /write_todos/, 'the planning tool is part of the PM harness');
    assert.match(system, /running-a-task/); assert.match(system, /cross-team-handoff/); assert.match(system, /project-shepherd/);
    assert.match(system, /\/skills\/agency\//, 'skills are read from the mounted folder');
    assert.equal(done.todos.length, 2); assert.equal(done.todos[0].content, 'Marketing: write the launch report');
    assert.ok(refused, 'a delegation before the plan was refused'); assert.ok(f.engine.events(id).some(e => e.type === 'delegation_refused'));
    assert.equal(done.runs.filter(r => r.role === 'lead').length, 1, 'the refused delegation never ran');
  } finally { await f.close(); }
});
