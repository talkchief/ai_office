import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SettingsStore } from '../settings.mjs';
import { RunTracker } from '../engine/stream.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-budget-'));

test('the office has a token budget per task, with a floor, and refuses nonsense in a sentence', () => {
  const store = new SettingsStore({ dataDir: temp() });
  assert.equal(store.get().tokenBudgetPerTask, 2000000, 'two million tokens by default');
  assert.equal(store.update({ tokenBudgetPerTask: 300000 }).tokenBudgetPerTask, 300000);
  assert.throws(() => store.update({ tokenBudgetPerTask: 10 }), /Token budget per task/);
  assert.throws(() => store.update({ tokenBudgetPerTask: 'lots' }), /Token budget per task/);
});

// A stand-in for the engine with only what the tracker touches: settings, the job record, the running entry with its abort controller.
function fakeEngine({ budget, tokens = 0 }) {
  const job = { id: 'job-1', state: 'working', runs: [], tokens, tokensByModel: {}, liveCalls: {}, calls: 0 };
  const controller = new AbortController();
  return { job, controller, office: { get: () => ({ teams: [], agents: [] }) }, settings: () => ({ tokenBudgetPerTask: budget }), get: () => job, update: (id, fn) => fn(job), event: () => {}, setState: () => {}, running: new Map([['job-1', { controller }]]) };
}
const modelEnd = tokens => ({ event: 'on_chat_model_end', run_id: 'r-' + Math.random(), metadata: { lc_agent_name: 'program-manager' }, data: { output: { usage_metadata: { input_tokens: tokens, output_tokens: 0 }, tool_calls: [] } } });

test('a task that passes its budget is stopped where it is, with a reason the CEO can act on', () => {
  const engine = fakeEngine({ budget: 100000, tokens: 90000 });
  const tracker = new RunTracker(engine, 'job-1', { pm: 'test-model' });
  tracker.handle(modelEnd(5000));
  assert.equal(engine.job.tokens, 95000); assert.equal(engine.controller.signal.aborted, false, 'under budget, nothing happens');
  tracker.handle(modelEnd(6000));
  assert.equal(engine.job.tokens, 101000);
  assert.equal(engine.controller.signal.aborted, true, 'over budget, the run is stopped');
  assert.match(engine.controller.signal.reason.message, /used more than 100,000 tokens and was stopped to protect your spend\. Retry to continue/);
  assert.equal(engine.controller.signal.reason.budget, true);
});

test('after the CEO continues a stopped task, the budget counts from that point', () => {
  const engine = fakeEngine({ budget: 100000, tokens: 150000 });
  engine.job.budgetBase = 150000;
  const tracker = new RunTracker(engine, 'job-1', { pm: 'test-model' });
  tracker.handle(modelEnd(60000));
  assert.equal(engine.controller.signal.aborted, false, 'only what was spent since the retry counts');
  tracker.handle(modelEnd(50000));
  assert.equal(engine.controller.signal.aborted, true);
});

test('tokens and calls are attributed to the run that spent them', () => {
  const engine = fakeEngine({ budget: 0 });
  engine.job.runs.push({ id: 'r1', agent: 'lexi', role: 'lead', dept: 'sales', state: 'working' });
  const tracker = new RunTracker(engine, 'job-1', { lexi: 'test-model' });
  const ev = { event: 'on_chat_model_start', run_id: 'r-1', metadata: { lc_agent_name: 'lexi' }, data: {} };
  tracker.handle(ev);
  tracker.handle({ event: 'on_chat_model_end', run_id: 'r-2', metadata: { lc_agent_name: 'lexi' }, data: { output: { usage_metadata: { input_tokens: 1200, output_tokens: 300 }, tool_calls: [] } } });
  assert.equal(engine.job.runs[0].tokens, 1500); assert.equal(engine.job.runs[0].calls, 1); assert.equal(engine.job.tokens, 1500);
});

test('no budget means no stop', () => {
  const engine = fakeEngine({ budget: 0, tokens: 5000000 });
  new RunTracker(engine, 'job-1', { pm: 'test-model' }).handle(modelEnd(1000000));
  assert.equal(engine.controller.signal.aborted, false);
});
