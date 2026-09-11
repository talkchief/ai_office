import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';
import { ProjectStore, PROJECT_STATUSES } from '../projects.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-projects-'));
const setup = () => { const dir = temp(); const office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents }); const changes = []; return { dir, office, changes, store: new ProjectStore({ dataDir: dir, office, onChange: p => changes.push(p.id) }) }; };

test('a project needs a name and a purpose; owners must be real teams; dates and milestones are checked in plain sentences', () => {
  const { store } = setup();
  assert.throws(() => store.create({ name: 'X', description: 'Rebuild the site.' }), /Give the project a name/);
  assert.throws(() => store.create({ name: 'Website relaunch', description: 'short' }), /Describe the project/);
  assert.throws(() => store.create({ name: 'Website relaunch', description: 'Relaunch the marketing site with new positioning.', teams: ['design'] }), /no team “design”/);
  assert.throws(() => store.create({ name: 'Website relaunch', description: 'Relaunch the marketing site with new positioning.', startAt: '2026-10-01', dueAt: '2026-09-01' }), /before the start/);
  assert.throws(() => store.create({ name: 'Website relaunch', description: 'Relaunch the marketing site with new positioning.', milestones: [{ title: '' }] }), /Milestone 1 needs a title/);
  assert.throws(() => store.create({ name: 'Website relaunch', description: 'Relaunch the marketing site with new positioning.', status: 'later' }), /Status must be/);
  assert.deepEqual(PROJECT_STATUSES, ['active', 'paused', 'done', 'archived']);
});

test('projects are created with a stable id, updated in place, and their page and brief say what agents need', () => {
  const { dir, office, store, changes } = setup();
  const p = store.create({ name: 'Website relaunch', description: 'Relaunch the marketing site with new positioning before the Q4 campaign.', charter: 'Scope: home, pricing, product pages. Out of scope: the blog.', teams: ['marketing', 'delivery'], startAt: '2026-09-15', dueAt: '2026-11-30',
    milestones: [{ title: 'Positioning approved', dueAt: '2026-09-30' }, { title: 'Design signed off', dueAt: '2026-10-20' }, { title: 'Site live', dueAt: '2026-11-25' }] });
  assert.equal(p.id, 'website-relaunch'); assert.equal(p.status, 'active'); assert.equal(p.milestones.length, 3); assert.ok(p.milestones.every(m => /^m-/.test(m.id) && !m.done));
  assert.equal(store.create({ name: 'Website relaunch', description: 'A second one with the same name gets its own id.' }).id, 'website-relaunch-2');
  assert.deepEqual(changes, ['website-relaunch', 'website-relaunch-2']);
  const reopened = new ProjectStore({ dataDir: dir, office });
  assert.equal(reopened.get('website-relaunch').charter, p.charter, 'projects are on disk');

  const done = store.update(p.id, { milestones: p.milestones.map((m, i) => ({ ...m, done: i === 0 })) });
  assert.ok(done.milestones[0].done && done.milestones[0].doneAt, 'a ticked milestone remembers when');
  assert.equal(store.nextMilestone(done).title, 'Design signed off');
  assert.throws(() => store.update('nope', { name: 'x' }), /no such project/);
  assert.equal(store.setStatus(p.id, 'paused').status, 'paused');

  const teams = office.get().teams;
  const page = store.page(store.get(p.id), { teams, files: [{ id: 'Projects/website-relaunch/brand-brief.md', title: 'Brand brief' }], tasks: [{ title: 'Write the positioning', state: 'done', doneAt: Date.now(), resultPreview: 'Three options, one recommended.' }, { title: 'Design the home page', state: 'working' }] });
  assert.match(page, /^# Website relaunch/); assert.match(page, /## Charter\nScope: home, pricing/); assert.match(page, /MARKETING, DELIVERY/);
  assert.match(page, /- \[x\] Positioning approved — due 2026-09-30 — done \d{4}-\d{2}-\d{2}/); assert.match(page, /- \[ \] Site live — due 2026-11-25/);
  assert.match(page, /- \/knowledge\/Projects\/website-relaunch\/brand-brief\.md — Brand brief/); assert.match(page, /✓ Write the positioning \(done, done \d{4}/); assert.match(page, /Three options, one recommended/);
  const brief = store.brief(store.get(p.id));
  assert.match(brief, /^PROJECT: Website relaunch \(paused\)/); assert.match(brief, /next milestone “Design signed off” by 2026-10-20/); assert.match(brief, /read \/knowledge\/Projects\/website-relaunch\/project\.md before planning/);
  assert.equal(store.folder(p), 'Projects/website-relaunch'); assert.equal(store.pageId(p), 'Projects/website-relaunch/project.md');
  const summary = store.summary({ tasks: () => [{ projectId: p.id, state: 'working' }, { projectId: p.id, state: 'done' }, { projectId: 'other', state: 'done' }] });
  assert.deepEqual(summary.map(s => [s.id, s.open, s.done, s.next]), [['website-relaunch', 1, 1, 'Design signed off by 2026-10-20'], ['website-relaunch-2', 0, 0, '']]);
  store.setStatus(p.id, 'archived');
  assert.deepEqual(store.summary().map(s => s.id), ['website-relaunch-2'], 'archived projects leave the Program Manager’s list');

  assert.throws(() => store.remove('nope'), /no such project/);
  assert.equal(store.remove('website-relaunch-2'), true);
  assert.deepEqual(new ProjectStore({ dataDir: dir, office }).list().map(x => x.id), ['website-relaunch'], 'a removed project is gone from disk');
});

test('a finished task marks its milestones: the one it was created for and any the Program Manager named; nothing twice', () => {
  const { store } = setup();
  const p = store.create({ name: 'Portal launch', description: 'Ship the self-service client portal to all active clients.', milestones: [{ title: 'Scope signed off', dueAt: '2026-09-30' }, { title: 'Beta with three clients', dueAt: '2026-10-31' }, { title: 'All clients live', dueAt: '2026-11-30' }] });
  const [scope, beta, live] = p.milestones.map(m => m.id);
  assert.match(store.brief(p), /Milestones \(name the ids this task achieves in complete_task\): m-[a-z0-9-]+ “Scope signed off” due 2026-09-30 \(can start at once\); /);
  assert.deepEqual(store.recordCompletion({ projectId: p.id, state: 'working', milestoneId: scope }), [], 'only a finished task counts');
  const marked = store.recordCompletion({ id: 't1', projectId: p.id, state: 'done', doneAt: 1000, milestoneId: scope, milestonesDone: [beta, 'm-unknown'] });
  assert.deepEqual(marked.map(m => [m.title, m.done, m.doneAt, m.taskId]), [['Scope signed off', true, 1000, 't1'], ['Beta with three clients', true, 1000, 't1']]);
  assert.equal(store.nextMilestone(store.get(p.id)).id, live);
  assert.deepEqual(store.recordCompletion({ id: 't2', projectId: p.id, state: 'done', milestoneId: scope }), [], 'a milestone is achieved once');
  assert.equal(store.summary({ tasks: () => [{ projectId: p.id, state: 'done' }, { projectId: p.id, state: 'working' }] })[0].done, 1);
});

test('a milestone is achieved when all its tasks are done: one finishing while a sibling is still open does not reach it', () => {
  const { store } = setup();
  const p = store.create({ name: 'Portal launch', description: 'Ship the portal.', milestones: [{ title: 'Scope', dueAt: '2026-09-30' }, { title: 'Beta', dueAt: '2026-10-31' }] });
  const [scope, beta] = p.milestones.map(m => m.id);
  const tasks = [{ id: 'a', projectId: p.id, milestoneId: scope, state: 'done' }, { id: 'b', projectId: p.id, milestoneId: scope, state: 'working' }, { id: 'c', projectId: p.id, milestoneId: beta, state: 'backlog' }];
  assert.deepEqual(store.recordCompletion({ id: 'a', projectId: p.id, state: 'done', milestoneId: scope, milestonesDone: [beta] }, { tasks }), [], 'a sibling still working, and Beta’s task not started: nothing is achieved yet');
  tasks[1].state = 'done';
  assert.deepEqual(store.recordCompletion({ id: 'b', projectId: p.id, state: 'done', doneAt: 5, milestoneId: scope }, { tasks }).map(m => [m.title, m.taskId]), [['Scope', 'b']], 'the last task of the milestone reaches it');
  tasks[2].state = 'cancelled';
  assert.deepEqual(store.recordCompletion({ id: 'b', projectId: p.id, state: 'done', milestonesDone: [beta] }, { tasks }).map(m => m.title), ['Beta'], 'a cancelled task does not hold a milestone back');
  assert.equal(store.nextMilestone(store.get(p.id)), null);
});

test('a task without a milestone counts for the milestone current when it finished; reconcile marks such milestones once, at start', () => {
  const { store } = setup();
  const p = store.create({ name: 'Q4 campaign', description: 'Fill the pipeline.', milestones: [{ title: 'ICP agreed', dueAt: '2026-09-30' }, { title: 'Landing page live', dueAt: '2026-10-31' }, { title: 'Nurture running', dueAt: '2026-11-30' }] });
  const [icp, landing] = p.milestones.map(m => m.id);
  const kickoff = { id: 'k', projectId: p.id, state: 'done', doneAt: 1000 };
  assert.deepEqual(store.reconcile({ tasks: [{ ...kickoff, state: 'working' }] }), [], 'an open task reaches nothing');
  assert.deepEqual(store.reconcile({ tasks: [kickoff] }).map(r => [r.project, r.milestone.title, r.milestone.taskId]), [['Q4 campaign', 'ICP agreed', 'k']], 'the finished kickoff reaches the first milestone');
  assert.deepEqual(store.reconcile({ tasks: [kickoff] }), [], 'and never a second one: the later milestones have no tasks');
  assert.equal(store.nextMilestone(store.get(p.id)).id, landing);
  const later = { id: 'l', projectId: p.id, state: 'done', doneAt: 2000 };
  assert.deepEqual(store.recordCompletion(later, { tasks: [kickoff, later] }).map(m => m.title), ['Landing page live'], 'a later task without a milestone counts for the milestone current then');
  assert.deepEqual(store.recordCompletion({ id: 'x', projectId: p.id, state: 'done', doneAt: 3000 }, { tasks: [kickoff, later, { id: 'y', projectId: p.id, state: 'working' }] }), [], 'not while another task of the current milestone is open');
  assert.equal(store.get(p.id).milestones.filter(m => m.done).length, 2);
});

test('a project completes itself when every milestone is achieved and no task is open, and remembers when', () => {
  const { store } = setup();
  const p = store.create({ name: 'Portal launch', description: 'Ship the portal.', milestones: [{ title: 'Scope', dueAt: '2026-09-30' }, { title: 'Beta', dueAt: '2026-10-31' }] });
  const [scope, beta] = p.milestones.map(m => m.id);
  assert.equal(store.settle(p.id, { tasks: [] }), null, 'nothing achieved yet');
  store.recordCompletion({ id: 'a', projectId: p.id, state: 'done', doneAt: 1, milestoneId: scope, milestonesDone: [beta] }, { tasks: [{ id: 'b', projectId: p.id, milestoneId: beta, state: 'working' }] });
  assert.equal(store.get(p.id).milestones.filter(m => m.done).length, 1, 'Beta waits for its task');
  assert.equal(store.settle(p.id, { tasks: [{ id: 'b', projectId: p.id, milestoneId: beta, state: 'working' }] }), null, 'a task is still open');
  store.recordCompletion({ id: 'b', projectId: p.id, state: 'done', doneAt: 2, milestoneId: beta }, { tasks: [] });
  const done = store.settle(p.id, { tasks: [{ id: 'a', projectId: p.id, state: 'done' }, { id: 'b', projectId: p.id, state: 'done' }] });
  assert.equal(done.status, 'done'); assert.ok(done.doneAt > 0, 'the store remembers when');
  assert.equal(store.settle(p.id, { tasks: [] }), null, 'settled once');
  assert.equal(store.setStatus(p.id, 'active').doneAt, null, 'reopening forgets the date');
});

test('milestones wait for each other only when they say so: positions become ids, circles are broken, and ready ones run in parallel', () => {
  const { store } = setup();
  const p = store.create({ name: 'Launch', description: 'Ship the new product to every client before the quarter ends.', milestones: [{ title: 'Scope' }, { title: 'Design', after: [0] }, { title: 'Copy', after: ['0'] }, { title: 'Build', after: [1, 2] }, { title: 'Review' }] });
  const [scope, design, copy, build, review] = p.milestones.map(m => m.id);
  assert.deepEqual(p.milestones.map(m => m.after), [undefined, [scope], [scope], [design, copy], undefined]);
  assert.deepEqual(store.readyMilestones(p).map(m => m.id), [scope]); assert.equal(store.nextMilestone(p).id, scope);
  store.recordCompletion({ id: 't', projectId: p.id, state: 'done', doneAt: 1, milestoneId: scope }, { tasks: [] });
  assert.deepEqual(store.readyMilestones(store.get(p.id)).map(m => m.id), [design, copy], 'Design and Copy are worked in parallel');
  assert.match(store.brief(store.get(p.id)), /ready now: /); assert.match(store.page(store.get(p.id)), /- \[ \] Design — after Scope/);
  const q = store.update(p.id, { ...store.get(p.id), milestones: store.get(p.id).milestones.map(m => m.id === scope ? { ...m, after: [review] } : m) });
  assert.deepEqual(q.milestones[0].after, [], 'a dependency that would close a circle is dropped');
  assert.deepEqual(store.update(p.id, { ...q, milestones: q.milestones.map(m => ({ ...m, after: 'x' })) }).milestones.map(m => m.after), [undefined, undefined, undefined, undefined, undefined], 'a list that is not one means unset: the one before it');
});
