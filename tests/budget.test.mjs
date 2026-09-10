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

test('no budget means no stop', () => {
  const engine = fakeEngine({ budget: 0, tokens: 5000000 });
  new RunTracker(engine, 'job-1', { pm: 'test-model' }).handle(modelEnd(1000000));
  assert.equal(engine.controller.signal.aborted, false);
});
