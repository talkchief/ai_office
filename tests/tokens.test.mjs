import test from 'node:test';
import assert from 'node:assert/strict';
import { RunTracker } from '../engine/stream.mjs';

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
});

test('there is no token cap: a task may use as much as the work needs', () => {
  const engine = fakeEngine(); engine.job.tokens = 50000000;
  const tracker = new RunTracker(engine, 'job-1', { pm: 'test-model' });
  tracker.handle({ event: 'on_chat_model_end', run_id: 'r-3', metadata: { lc_agent_name: 'program-manager' }, data: { output: { usage_metadata: { input_tokens: 1000000, output_tokens: 0 }, tool_calls: [] } } });
  assert.equal(engine.job.tokens, 51000000); assert.equal(engine.job.state, 'working');
});
