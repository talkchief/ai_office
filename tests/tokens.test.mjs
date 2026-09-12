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
