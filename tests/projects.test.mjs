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
