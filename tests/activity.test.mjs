import test from 'node:test';
import assert from 'node:assert/strict';
import { agentActivity, unseenResult } from '../src/activity.js';
import { stateLabel, stepLabel } from '../src/labels.js';

const job = (state, extra = {}) => ({ id: state, title: 'Task', state, agent: 'lead', subtasks: [{ agent: 'worker', state: 'done', title: 'Step' }], ...extra });

test('handed-over work shows only while the task is moving, and done clears once seen', () => {
  assert.equal(agentActivity([job('working')]).get('worker').phase, 'submitted');
  assert.equal(agentActivity([job('blocked')]).has('worker'), false);
  assert.equal(agentActivity([job('done', { doneAt: 10 })]).get('worker').phase, 'done');
  assert.equal(agentActivity([job('done', { doneAt: 10, seenAt: 11 })]).has('worker'), false);
  assert.equal(unseenResult(job('done', { doneAt: 10, seenAt: 5 })), true);
});

test('one vocabulary names task and step states', () => {
  assert.equal(stateLabel('waiting'), 'Needs you');
  assert.equal(stateLabel('done'), 'Done');
  assert.equal(stepLabel('done'), 'Handed to lead');
  assert.equal(stateLabel('unknown'), 'unknown');
});

test('the person who asked for an action and the Program Manager show that the CEO is needed', () => {
  const waiting = { ...job('awaiting_ceo'), pendingActions: [{ name: 'send_email', agent: 'worker' }] };
  const map = agentActivity([waiting]);
  assert.equal(map.get('worker').phase, 'needs'); assert.equal(map.get('pm').phase, 'needs');
  assert.equal(agentActivity([job('blocked')]).get('lead').phase, 'needs');
  assert.equal(agentActivity([{ ...job('working'), subtasks: [{ agent: 'worker', state: 'working', title: 'Step' }] }]).get('pm').phase, 'working');
  assert.equal(agentActivity([job('done', { doneAt: 10 })]).get('pm').phase, 'done');
  assert.equal(agentActivity([job('done', { doneAt: 10, seenAt: 20 })]).has('pm'), false);
});
