import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { ModelRegistry, DEFAULT_REGISTRY } from '../models.mjs';
import { Notifications } from '../notifications.mjs';
import { Threads } from '../threads.mjs';
import { EventBus } from '../sse.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-harness-'));
const memoryDb = () => SqliteSaver.fromConnString(':memory:').db;

test('model precedence runs task > routine > agent > team > role > office, with legacy names mapped', () => {
  const dir = temp();
  try {
    const reg = new ModelRegistry({ dataDir: dir, env: {} });
    const base = { role: 'specialist' };
    assert.equal(reg.resolve(base).model, 'claude-sonnet-5'); assert.equal(reg.resolve(base).from, 'role');
    assert.equal(reg.resolve({ ...base, team: { models: { specialist: 'claude-haiku-4-5' } } }).from, 'team');
    assert.equal(reg.resolve({ ...base, agent: { model: 'opus' }, team: { models: { specialist: 'claude-haiku-4-5' } } }).model, 'claude-opus-5');
    assert.equal(reg.resolve({ ...base, routine: { model: 'claude-haiku-4-5' }, agent: { model: 'opus' } }).from, 'routine');
    assert.equal(reg.resolve({ ...base, task: { model: 'fable' }, routine: { model: 'claude-haiku-4-5' } }).model, 'claude-fable-5-1');
    assert.equal(reg.resolve({ role: 'lead', team: { models: { lead: 'opus' } } }).model, 'claude-opus-5');
    assert.equal(reg.resolve({ role: 'lead', team: { planningModel: 'opus', models: { lead: '' } } }).from, 'role');
    assert.equal(reg.resolve({ role: 'pm' }).model, 'claude-opus-5');
    assert.equal(reg.resolve({ ...base, agent: { model: 'unknown-model' } }).from, 'role');
    assert.equal(reg.resolve({ role: 'pm' }).effort, 'high'); assert.equal(reg.resolve({ role: 'chat', agent: { effort: 'max' } }).effort, 'max');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an override whose provider has no key falls back to the next level that can run', () => {
  const dir = temp();
  try {
    const reg = new ModelRegistry({ dataDir: dir, env: { OPENROUTER_API_KEY: 'r' } });
    const input = structuredClone(reg.value); input.models.push({ id: 'z-ai/glm-4.6', provider: 'openrouter' }); input.roleDefaults.specialist = 'z-ai/glm-4.6'; reg.update(input);
    const pick = reg.resolve({ role: 'specialist', agent: { model: 'claude-opus-5' } });
    assert.deepEqual([pick.model, pick.from], ['z-ai/glm-4.6', 'role']);
    assert.equal(reg.resolve({ role: 'pm' }).model, 'claude-opus-5', 'with nothing runnable in the chain, the configured model is still named');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('provider keys never reach the browser, blank keeps a key, clearKey removes it, env is a fallback', () => {
  const dir = temp();
  try {
    const reg = new ModelRegistry({ dataDir: dir, env: { OPENROUTER_API_KEY: 'sk-or-env-secret' } });
    assert.equal(reg.ready(), false);
    const input = structuredClone(DEFAULT_REGISTRY); input.providers[0].apiKey = 'sk-ant-file-secret';
    input.models.push({ id: 'z-ai/glm-4.6', provider: 'openrouter', label: 'GLM 4.6' });
    input.roleDefaults.specialist = 'z-ai/glm-4.6';
    const summary = reg.update(input);
    assert.doesNotMatch(JSON.stringify(summary), /sk-ant-file-secret|sk-or-env-secret/);
    assert.equal(summary.providers.find(p => p.id === 'anthropic').keySource, 'file');
    assert.equal(summary.providers.find(p => p.id === 'openrouter').keySource, 'env');
    assert.equal(summary.ready, true); assert.equal(reg.resolve({ role: 'specialist' }).model, 'z-ai/glm-4.6');
    assert.equal(fs.statSync(path.join(dir, 'providers.json')).mode & 0o777, 0o600);
    const kept = reg.update({ ...input, providers: input.providers.map(p => ({ ...p, apiKey: '' })) });
    assert.equal(kept.providers.find(p => p.id === 'anthropic').hasKey, true);
    const cleared = reg.update({ ...input, providers: input.providers.map(p => p.id === 'anthropic' ? { ...p, apiKey: '', clearKey: true } : { ...p, apiKey: '' }) });
    assert.equal(cleared.providers.find(p => p.id === 'anthropic').hasKey, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('effort maps to each provider’s own control and is ignored where unsupported', () => {
  const dir = temp();
  try {
    const reg = new ModelRegistry({ dataDir: dir, env: { ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', OPENROUTER_API_KEY: 'r' } });
    const input = structuredClone(reg.value);
    input.models.push({ id: 'gpt-5', provider: 'openai', supports: { reasoning: true } }, { id: 'moonshotai/kimi-k2', provider: 'openrouter' });
    reg.update(input);
    const a = reg.options({ model: 'claude-sonnet-5', effort: 'xhigh' });
    assert.equal(a.type, 'anthropic'); assert.deepEqual(a.options.outputConfig, { effort: 'xhigh' }); assert.deepEqual(a.options.thinking, { type: 'adaptive' }); assert.equal(a.options.betas, undefined);
    assert.deepEqual(reg.options({ model: 'claude-opus-5' }).options.invocationKwargs, { fallbacks: 'default' });
    assert.equal(reg.options({ model: 'claude-haiku-4-5', effort: 'high' }).options.outputConfig, undefined);
    assert.deepEqual(reg.options({ model: 'gpt-5', effort: 'max' }).options.reasoning, { effort: 'high' });
    const k = reg.options({ model: 'moonshotai/kimi-k2', effort: 'high' });
    assert.equal(k.options.reasoning, undefined); assert.equal(k.options.configuration.baseURL, 'https://openrouter.ai/api/v1');
    assert.throws(() => reg.options({ model: 'nope' }), /not configured/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('inbox items dedupe per subject, count what needs the CEO, and clear when acted on', () => {
  const events = [], bus = { publish: (type, data) => events.push({ type, data }) };
  const inbox = new Notifications({ db: memoryDb(), bus });
  inbox.notify({ kind: 'overdue', title: 'Report is overdue', jobId: 'j1', dedupe: 'overdue:j1' });
  inbox.notify({ kind: 'overdue', title: 'Report is still overdue', jobId: 'j1', dedupe: 'overdue:j1' });
  inbox.notify({ kind: 'done', title: 'Pricing sheet is done', jobId: 'j2' });
  assert.equal(inbox.list().length, 2); assert.equal(inbox.list().find(n => n.kind === 'overdue').title, 'Report is still overdue');
  assert.deepEqual(inbox.counts(), { unread: 2, needsYou: 1 });
  inbox.readForJob('j2'); assert.equal(inbox.counts().unread, 1);
  inbox.ackForJob('j1'); assert.deepEqual(inbox.counts(), { unread: 0, needsYou: 0 });
  assert.ok(events.some(e => e.type === 'notification.new') && events.some(e => e.type === 'notification.read'));
  assert.throws(() => inbox.notify({ kind: 'nonsense', title: 'x' }), /Unknown/);
});

test('threads keep messages durably and hold notes until they are delivered', () => {
  const db = memoryDb(), threads = new Threads({ db });
  const id = threads.ensure('task', 'job-1'); assert.equal(id, 'job-1'); assert.equal(threads.ensure('agent', 'mlead'), 'agent:mlead');
  threads.append(id, { role: 'ceo', text: 'Write the launch brief.', jobId: 'job-1' });
  const note = threads.append(id, { role: 'ceo', kind: 'note', text: 'Use the October date.', jobId: 'job-1', delivered: false });
  assert.equal(threads.list(id).length, 2); assert.deepEqual(threads.pending(id).map(m => m.seq), [note.seq]);
  threads.markDelivered([note.seq]); assert.equal(threads.pending(id).length, 0);
  assert.throws(() => threads.append(id, { role: 'ceo', text: '  ' }), /Write a message/);
});

test('live events replay after a reconnect, cap connections per session and throttle drafts', async () => {
  const bus = new EventBus({ heartbeatMs: 60000, maxPerSession: 2, liveThrottleMs: 30 });
  const client = () => { const req = new EventEmitter(); req.headers = {}; const res = { chunks: [], ended: false, writeHead() {}, write(c) { this.chunks.push(c); }, end() { this.ended = true; } }; return { req, res }; };
  bus.publish('task.updated', { id: 'a' }); bus.publish('task.updated', { id: 'b' });
  const first = client(); bus.handle(first.req, first.res, { session: 's', lastEventId: 1 });
  assert.ok(first.res.chunks.join('').includes('"id":"b"')); assert.ok(!first.res.chunks.join('').includes('"id":"a"'));
  const second = client(), third = client();
  bus.handle(second.req, second.res, { session: 's' }); bus.handle(third.req, third.res, { session: 's' });
  assert.equal(first.res.ended, true); assert.equal(bus.clients.size, 2);
  for (let i = 0; i < 5; i++) bus.publishLive('job-1', 'task.live', { preview: 'x'.repeat(i + 1) });
  const live = () => bus.buffer.filter(e => e.type === 'task.live');
  assert.equal(live().length, 1); await new Promise(r => setTimeout(r, 60));
  assert.equal(live().length, 2); assert.equal(live()[1].data.preview, 'xxxxx');
  bus.close();
});
