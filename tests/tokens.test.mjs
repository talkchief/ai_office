import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RunTracker } from '../engine/stream.mjs';
import { OfficeEngine } from '../engine/deep-agents.mjs';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';

// A stand-in for the engine with only what the tracker touches.
function fakeEngine() {
  const job = { id: 'job-1', state: 'working', runs: [], tokens: 0, tokensByModel: {}, liveCalls: {}, calls: 0 };
  return { job, office: { get: () => ({ teams: [], agents: [] }) }, settings: () => ({}), get: () => job, update: (id, fn) => fn(job), event: () => {}, setState: () => {}, running: new Map() };
}

test('tokens and calls are attributed to the run that spent them, and to the model', () => {
  const engine = fakeEngine();
  engine.job.runs.push({ id: 'r1', agent: 'lexi', role: 'lead', dept: 'sales', state: 'working' });
  const tracker = new RunTracker(engine, 'job-1', { lexi: 'test-model' });
  tracker.handle({ event: 'on_chat_model_start', run_id: 'r-1', metadata: { lc_agent_name: 'lexi' }, data: {} });
  tracker.handle({ event: 'on_chat_model_end', run_id: 'r-2', metadata: { lc_agent_name: 'lexi' }, data: { output: { usage_metadata: { input_tokens: 1200, output_tokens: 300 }, tool_calls: [] } } });
  assert.equal(engine.job.runs[0].tokens, 1500); assert.equal(engine.job.runs[0].calls, 1);
  assert.equal(engine.job.tokens, 1500); assert.equal(engine.job.tokensByModel['test-model'], 1500);
  // Input and output are priced apart, so they are counted apart, on the job, the model and the run that spent them.
  assert.deepEqual(engine.job.usage, { input: 1200, output: 300, cached: 0, total: 1500 });
  assert.deepEqual(engine.job.usageByModel['test-model'], { input: 1200, output: 300, cached: 0, total: 1500 });
  assert.deepEqual(engine.job.runs[0].usage, { input: 1200, output: 300, cached: 0, total: 1500 });
});

test('a cached input token is counted apart, and is part of the input rather than extra to it', () => {
  const engine = fakeEngine();
  engine.job.runs.push({ id: 'r1', agent: 'lexi', role: 'lead', dept: 'sales', state: 'working' });
  const tracker = new RunTracker(engine, 'job-1', { lexi: 'test-model' });
  tracker.handle({ event: 'on_chat_model_end', run_id: 'r-9', metadata: { lc_agent_name: 'lexi' }, data: { output: { usage_metadata: { input_tokens: 10000, output_tokens: 500, input_token_details: { cache_read: 8000 } }, tool_calls: [] } } });
  assert.deepEqual(engine.job.usage, { input: 10000, output: 500, cached: 8000, total: 10500 }, 'the total is input + output; cached is the part of input that was served from cache');
  // A second call reporting the same detail under the name another provider uses accumulates alongside it.
  tracker.handle({ event: 'on_chat_model_end', run_id: 'r-10', metadata: { lc_agent_name: 'lexi' }, data: { output: { usage_metadata: { input_tokens: 200, output_tokens: 100, input_token_details: { cached_tokens: 150 } }, tool_calls: [] } } });
  assert.deepEqual(engine.job.usage, { input: 10200, output: 600, cached: 8150, total: 10800 });
  assert.equal(engine.job.tokens, 10800, 'the old single total still adds up for everything that reads it');
});

test('there is no token cap: a task may use as much as the work needs', () => {
  const engine = fakeEngine(); engine.job.tokens = 50000000;
  const tracker = new RunTracker(engine, 'job-1', { pm: 'test-model' });
  tracker.handle({ event: 'on_chat_model_end', run_id: 'r-3', metadata: { lc_agent_name: 'program-manager' }, data: { output: { usage_metadata: { input_tokens: 1000000, output_tokens: 0 }, tool_calls: [] } } });
  assert.equal(engine.job.tokens, 51000000); assert.equal(engine.job.state, 'working');
});

test('the ledger holds every model call the office makes, including those that belong to no task', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-usage-'));
  const office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents });
  const engine = new OfficeEngine({ dataDir: dir, office, models: {}, knowledgeDir: path.join(dir, 'k') });
  try {
    engine.recordUsage({ tag: 'task', model: 'm1', jobId: 'j1', input: 100, output: 20, cached: 60 });
    engine.recordUsage({ tag: 'triage', model: 'm1', jobId: 'j1', input: 10, output: 2 });
    engine.recordUsage({ tag: 'chat', model: 'm2', input: 5, output: 1 });
    engine.recordUsage({ tag: 'chat', model: 'm2', input: 0, output: 0 });
    const all = engine.usageSince(0);
    assert.equal(all.calls, 3, 'a call that spent nothing is not a row');
    assert.deepEqual([all.input, all.output, all.cached, all.total], [115, 23, 60, 138]);
    // Every task pays for its own sizing, and a chat belongs to no task at all: a rollup over tasks would miss both.
    assert.equal(all.byTag.triage.total, 12);
    assert.equal(all.byTag.chat.total, 6);
    assert.equal(all.byModel.m1.total, 132); assert.equal(all.byModel.m2.total, 6);
    assert.equal(engine.usageSince(Date.now() + 60000).total, 0, 'a window that has not started yet is empty');
  } finally { engine.db.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});

test('what is billed is billed: the rate is frozen on the call and a later price change cannot move it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-price-'));
  const office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents });
  let price = { in: 3, out: 15, cached: 0.3 };            // whole currency per million tokens
  const engine = new OfficeEngine({ dataDir: dir, office, models: { priceOf: () => price }, knowledgeDir: path.join(dir, 'k') });
  try {
    // 600k fresh input at 3, 400k cached at 0.3, 100k output at 15 → 1.80 + 0.12 + 1.50
    engine.recordUsage({ tag: 'task', model: 'm1', jobId: 'j1', input: 1000000, output: 100000, cached: 400000 });
    assert.equal(engine.usageSince(0).cost.toFixed(6), '3.420000', 'cached input is billed at its own rate, and is not billed twice');

    price = { in: 30, out: 150, cached: 3 };               // the provider puts its price up tenfold
    engine.recordUsage({ tag: 'task', model: 'm1', jobId: 'j2', input: 1000000, output: 100000, cached: 400000 });
    const both = engine.usageSince(0);
    assert.equal(both.cost.toFixed(6), '37.620000', 'the new call costs the new price; the call already billed does not move');
    assert.equal(both.byTag.task.cost.toFixed(6), '37.620000');
  } finally { engine.db.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});

test('a model with no price is still measured, and simply costs nothing yet', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-noprice-'));
  const office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents });
  const engine = new OfficeEngine({ dataDir: dir, office, models: { priceOf: () => null }, knowledgeDir: path.join(dir, 'k') });
  try {
    engine.recordUsage({ tag: 'task', model: 'unpriced', jobId: 'j1', input: 900, output: 100 });
    const all = engine.usageSince(0);
    assert.equal(all.total, 1000); assert.equal(all.cost, 0, 'tokens are counted whether or not a price has been set');
  } finally { engine.db.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});
