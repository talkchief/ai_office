import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';
import { OfficeEngine } from '../engine/deep-agents.mjs';
import { Scheduler, digest } from '../scheduler.mjs';

test('overdue work is flagged once, waiting items are re-raised after the window, and the digest runs once a day', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-sched-'));
  const office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents });
  const engine = new OfficeEngine({ dataDir: dir, office, models: {}, knowledgeDir: path.join(dir, 'k') });
  let clock = new Date(2026, 8, 10, 7, 0).getTime(); const digests = [];
  const scheduler = new Scheduler({ engine, office, settings: () => ({ escalateAfterHours: 1, digestTime: '08:00' }), now: () => clock, onDigest: async r => { digests.push(r); } });
  try {
    const late = engine.create({ dept: 'marketing', text: 'Launch post', dueAt: clock - 60000, autoStart: false });
    const stuck = engine.create({ dept: 'sales', text: 'Pricing sheet', autoStart: false });
    engine.setState(stuck.id, 'blocked', { error: 'Provider overloaded.' }); engine.update(stuck.id, j => { j.stateSince = clock; }, { touch: false });
    await scheduler.tick(); await scheduler.tick();
    assert.equal(engine.notifications.list().filter(n => n.kind === 'overdue').length, 1);
    assert.equal(engine.get(late.id).overdueNotifiedAt, clock);
    assert.equal(engine.events(stuck.id).filter(e => e.type === 'reminded').length, 0);
    clock += 61 * 60000; await scheduler.tick();
    assert.equal(engine.events(stuck.id).filter(e => e.type === 'reminded').length, 1);
    assert.match(engine.notifications.list().find(n => n.jobId === stuck.id).title, /Still waiting/);
    assert.equal(engine.notifications.list().filter(n => n.jobId === stuck.id).length, 1, 'the reminder refreshes the open item instead of stacking a copy');
    clock += 10 * 60000; await scheduler.tick(); assert.equal(engine.events(stuck.id).filter(e => e.type === 'reminded').length, 1);
    assert.equal(digests.length, 1); assert.match(digests[0].headline, /1 need you · 1 overdue/); assert.match(digests[0].markdown, /## SALES\n- Needs you: Pricing sheet — Provider overloaded/i);
    clock += 3 * 3600000; await scheduler.tick(); assert.equal(digests.length, 1);
  } finally { await engine.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an empty office still gets a readable digest', () => {
  const report = digest({ jobs: [], office: { teams: [{ id: 'sales', name: 'Sales' }] }, since: 0, now: Date.UTC(2026, 8, 10, 9) });
  assert.match(report.markdown, /Nothing happened/); assert.equal(report.counts.done, 0);
});

test('retention runs once a day and clears only work finished more than 30 days ago', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-sched-'));
  const office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents });
  const engine = new OfficeEngine({ dataDir: dir, office, models: {}, knowledgeDir: path.join(dir, 'k') });
  const clock = Date.now(), scheduler = new Scheduler({ engine, office, settings: () => ({ escalateAfterHours: 1, digestTime: '23:59' }), now: () => clock });
  const finished = (text, age) => { const job = engine.create({ dept: 'marketing', text, autoStart: false }); engine.setState(job.id, 'done'); engine.update(job.id, j => { j.doneAt = clock - age; }, { touch: false }); fs.mkdirSync(path.join(dir, 'workspaces', job.id), { recursive: true }); return job.id; };
  try {
    const old = finished('Old report', 40 * 86400000), recent = finished('Recent report', 86400000);
    let calls = 0; const prune = engine.prune.bind(engine); engine.prune = options => { calls++; return prune(options); };
    await scheduler.tick(); await scheduler.tick();
    assert.equal(calls, 1);
    assert.ok(!fs.existsSync(path.join(dir, 'workspaces', old))); assert.ok(fs.existsSync(path.join(dir, 'workspaces', recent)));
    assert.ok(engine.get(old).prunedAt); assert.equal(engine.get(recent).prunedAt, undefined);
  } finally { await engine.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the routines steward: done clears the count, a blocked or overdue task is a miss (once per task), cancellations are neither, and the digest says so', async () => {
  const { steward, MISS_FLOOR } = await import('../routines.mjs');
  const r = { id: 'reminders', title: 'Overdue reminders', dept: 'fin', paused: false, when: { kind: 'daily', at: '09:00' } };
  const at = Date.UTC(2026, 8, 11, 9), st = { reminders: { lastAt: at, nextAt: at + 86400000, lastTaskId: 't1', runs: 1 } };
  let out = steward([r], st, [{ id: 't1', state: 'working' }], at + 60000);
  assert.deepEqual([out.changed, out.notices.length, st.reminders.lastOutcome], [true, 0, 'running']);
  out = steward([r], st, [{ id: 't1', state: 'blocked', error: 'The provider stopped answering.' }], at + 120000);
  assert.equal(out.notices.length, 1); assert.match(out.notices[0].reason, /the task stopped: The provider stopped answering/); assert.deepEqual([st.reminders.lastOutcome, st.reminders.failures, st.reminders.missedTaskId], ['missed', 1, 't1']);
  out = steward([r], st, [{ id: 't1', state: 'blocked' }], at + 180000);
  assert.equal(out.notices.length, 0, 'a miss is counted once per task');
  st.reminders.lastTaskId = 't2'; st.reminders.lastAt = at + 86400000; st.reminders.nextAt = at + 2 * 86400000;
  out = steward([r], st, [{ id: 't2', state: 'working' }], at + 86400000 + MISS_FLOOR - 1000);
  assert.equal(out.notices.length, 0, 'not overdue before the floor');
  out = steward([r], st, [{ id: 't2', state: 'working' }], at + 86400000 + 2 * 3600000 + 1000);
  assert.equal(out.notices.length, 1); assert.equal(st.reminders.failures, 2); assert.match(out.notices[0].reason, /still working after 120 minutes/);
  st.reminders.lastTaskId = 't3';
  out = steward([r], st, [{ id: 't3', state: 'cancelled' }], at + 3 * 86400000);
  assert.deepEqual([out.notices.length, st.reminders.lastOutcome, st.reminders.failures], [0, 'cancelled', 2]);
  st.reminders.lastTaskId = 't4';
  out = steward([r], st, [{ id: 't4', state: 'done' }], at + 4 * 86400000);
  assert.deepEqual([st.reminders.lastOutcome, st.reminders.failures], ['done', 0]);
  const report = digest({ jobs: [], office: { teams: [] }, since: 0, now: at, routines: [{ title: 'Overdue reminders', lastAt: at, lastOutcome: 'missed', failures: 2 }, { title: 'Inbox triage', lastAt: at, lastOutcome: 'done', lastLate: true }, { title: 'Weekly numbers', lastAt: at, lastOutcome: 'waiting' }, { title: 'Paused one', paused: true, lastOutcome: 'missed' }] });
  assert.match(report.markdown, /## Routines\n- ✕ Overdue reminders: did not complete \(2 in a row\)\n- ✓ Inbox triage: ran late\n- ○ Weekly numbers: waits for your OK/); assert.ok(!/Paused one/.test(report.markdown)); assert.match(report.headline, /1 routine missed/);
});
