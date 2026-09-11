import test from 'node:test';
import assert from 'node:assert/strict';
import { dependsOn, readyMilestones, waitsFor, layers, tasksOf, milestoneState } from '../milestones.mjs';
import { flowSVG, flowLayout } from '../src/milestone-flow.js';

const ms = [{ id: 'a', title: 'Scope', done: true, doneAt: 10 }, { id: 'b', title: 'Design', after: ['a'] }, { id: 'c', title: 'Copy', after: ['a'] }, { id: 'd', title: 'Launch', after: ['b', 'c'] }, { id: 'e', title: 'Review' }];

test('a milestone waits for its own list, or for the one before it; the ready ones have nothing open before them', () => {
  assert.deepEqual(dependsOn(ms, ms[1]), ['a']); assert.deepEqual(dependsOn(ms, ms[4]), ['d'], 'unset: the one before it'); assert.deepEqual(dependsOn(ms, ms[0]), []);
  assert.deepEqual(dependsOn(ms, { id: 'x', after: ['x', 'nope', 'a'] }), ['a'], 'itself and unknown ids are left out');
  assert.deepEqual(readyMilestones(ms).map(m => m.id), ['b', 'c'], 'Design and Copy run in parallel once Scope is achieved');
  assert.ok(waitsFor(ms, 'e', 'a')); assert.ok(!waitsFor(ms, 'a', 'e'));
  assert.deepEqual([...layers(ms).entries()], [['a', 0], ['b', 1], ['c', 1], ['d', 2], ['e', 3]]);
});

test('a milestone’s state comes from its tasks; a task without a milestone counts for the first ready one', () => {
  const tasks = [{ id: 't1', milestoneId: 'b', state: 'working' }, { id: 't2', milestoneId: 'b', state: 'done' }, { id: 't3', state: 'done', doneAt: 20 }, { id: 'old', state: 'done', doneAt: 5 }, { id: 'x', milestoneId: 'c', state: 'cancelled' }];
  assert.deepEqual(tasksOf(ms, ms[1], tasks).map(t => t.id), ['t1', 't2', 't3'], 'the milestone-less task finished after Scope counts for Design, the first ready');
  assert.deepEqual(tasksOf(ms, ms[2], tasks), [], 'cancelled never counts');
  assert.equal(milestoneState(ms[1], tasksOf(ms, ms[1], tasks), true), 'active'); assert.equal(milestoneState(ms[2], [], true), 'unplanned'); assert.equal(milestoneState(ms[3], [], false), 'later');
  assert.equal(milestoneState(ms[0], [], false), 'done'); assert.equal(milestoneState({ id: 'z' }, [{ state: 'awaiting_ceo' }], true), 'waiting'); assert.equal(milestoneState({ id: 'z' }, [{ state: 'escalated' }], true), 'blocked');
});

test('the flow chart puts milestones in columns by what they wait for, draws the arrows and colours each box by state', () => {
  const { columns, width, height } = flowLayout(ms);
  assert.deepEqual(columns.map(c => c.map(m => m.id)), [['a'], ['b', 'c'], ['d'], ['e']]); assert.ok(width > 4 * 176 && height > 2 * 46);
  const svg = flowSVG(ms, [{ id: 't1', milestoneId: 'b', state: 'working' }]);
  assert.match(svg, /<svg class="mf"/); assert.equal((svg.match(/class="mf-edge"/g) || []).length, 5, 'one arrow per dependency');
  assert.match(svg, /class="mf-node done"[^>]*><title>Scope/); assert.match(svg, /class="mf-node active"[^>]*><title>Design — in progress · 0\/1 tasks/); assert.match(svg, /class="mf-node unplanned"[^>]*><title>Copy — to plan/); assert.match(svg, /class="mf-node later"[^>]*><title>Launch/);
  assert.equal(flowSVG([]), '');
});
