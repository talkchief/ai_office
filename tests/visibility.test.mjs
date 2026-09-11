import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canSeeJob, canSeeProject, visibleJobs, requireRole, canShare, notificationVisible, sseFilter } from '../server/visibility.mjs';
import { EventBus } from '../sse.mjs';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';
import { OfficeEngine } from '../engine/deep-agents.mjs';

const owner = { id: 'u_owner', role: 'owner', groups: [] }, admin = { id: 'u_admin', role: 'admin', groups: [] };
const dana = { id: 'u_dana', role: 'member', groups: ['g_sales'] }, sam = { id: 'u_sam', role: 'member', groups: [] };
const job = (over = {}) => ({ id: 'j', ownerId: 'u_dana', visibility: 'private', sharedWith: { users: [], groups: [] }, projectId: null, ...over });

test('the seven visibility rules, in order', () => {
  assert.equal(canSeeJob(null, job()), true, '1. no viewer (single office) sees everything');
  assert.equal(canSeeJob(owner, job()), true); assert.equal(canSeeJob(admin, job()), true, '2. owner and admin see everything');
  assert.equal(canSeeJob(dana, job()), true, '3. the record owner');
  assert.equal(canSeeJob(sam, job()), false, '7. a private task of someone else is invisible');
  assert.equal(canSeeJob(sam, job({ visibility: 'public' })), true, '4. public');
  assert.equal(canSeeJob(sam, job({ sharedWith: { users: ['u_sam'], groups: [] } })), true, '5. shared with the person');
  assert.equal(canSeeJob(dana, job({ ownerId: 'u_sam', sharedWith: { users: [], groups: ['g_sales'] } })), true, '5. shared with a group the person is in');
  assert.equal(canSeeJob(sam, job({ ownerId: 'u_dana', sharedWith: { users: [], groups: ['g_sales'] } })), false, 'not in the group');
  const project = { id: 'p', ownerId: 'u_dana', visibility: 'private', sharedWith: { users: ['u_sam'], groups: [] } };
  assert.equal(canSeeJob(sam, job({ projectId: 'p' }), { project }), true, '6. a task inherits its project audience');
  assert.equal(canSeeProject(sam, project), true); assert.equal(canSeeProject(sam, { ...project, sharedWith: { users: [], groups: [] } }), false);
  const jobs = [job({ id: 'a' }), job({ id: 'b', visibility: 'public' }), job({ id: 'c', projectId: 'p' }), job({ id: 'd', ownerId: 'u_sam' })];
  assert.deepEqual(visibleJobs(sam, jobs, { projectFor: () => project }).map(j => j.id), ['b', 'c', 'd']);
  assert.equal(visibleJobs(owner, jobs).length, 4); assert.equal(visibleJobs(null, jobs).length, 4);
  assert.throws(() => requireRole(sam, ['owner', 'admin']), /owner or an admin/); requireRole(admin, ['owner', 'admin']); requireRole(null, ['owner']);
  assert.equal(canShare(dana, job()), true); assert.equal(canShare(sam, job()), false); assert.equal(canShare(admin, job()), true);
  assert.equal(notificationVisible(sam, { userId: 'u_sam' }), true); assert.equal(notificationVisible(sam, { userId: null }), false); assert.equal(notificationVisible(owner, { userId: null }), true);
});

test('the event stream filter passes only what the viewer may see, and a resync always passes', () => {
  const jobs = { a: job({ id: 'a' }), b: job({ id: 'b', visibility: 'public' }) };
  const filter = sseFilter(sam, { jobFor: id => jobs[id] || null });
  assert.equal(filter({ type: 'task.updated', data: jobs.a }), false); assert.equal(filter({ type: 'task.updated', data: jobs.b }), true);
  assert.equal(filter({ type: 'task.state', data: { id: 'a' } }), false); assert.equal(filter({ type: 'task.live', data: { id: 'b' } }), true);
  assert.equal(filter({ type: 'thread.message', data: { threadId: 'a', jobId: 'a' } }), false);
  assert.equal(filter({ type: 'thread.message', data: { threadId: 'agent:lexi:u_sam' } }), true); assert.equal(filter({ type: 'thread.message', data: { threadId: 'agent:lexi:u_dana' } }), false);
  assert.equal(filter({ type: 'notification.new', data: { userId: 'u_dana' } }), false); assert.equal(filter({ type: 'notification.new', data: { userId: 'u_sam' } }), true);
  assert.equal(filter({ type: 'office.updated', data: {} }), true); assert.equal(filter({ type: 'task.removed', data: { id: 'a' } }), true);
  assert.equal(sseFilter(owner, { jobFor: () => null })({ type: 'task.updated', data: jobs.a }), true);
  // Wired into the bus: two clients, one filtered; only the allowed events reach it, replay included.
  const bus = new EventBus({ heartbeatMs: 100000 });
  const client = () => { const out = []; return { out, res: { writeHead() {}, write: s => out.push(s), end() {} }, req: { headers: {}, on() {} } }; };
  const c1 = client(), c2 = client();
  bus.handle(c1.req, c1.res, { session: 's1' }); bus.handle(c2.req, c2.res, { session: 's2', filter });
  bus.publish('task.updated', jobs.a); bus.publish('task.updated', jobs.b);
  assert.equal(c1.out.filter(s => s.includes('event: task.updated')).length, 2); assert.equal(c2.out.filter(s => s.includes('event: task.updated')).length, 1);
  bus.publish('task.updated', jobs.a);
  const c3 = client(); bus.handle(c3.req, c3.res, { session: 's3', lastEventId: '1', filter });
  assert.equal(c3.out.filter(s => s.includes('event: task.updated')).length, 1, 'replay is filtered too');
  bus.close();
});

test('the engine stamps owner, audience and origin on a task, and share() announces the change to everyone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-share-'));
  const office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents });
  const bus = new EventBus({ heartbeatMs: 100000 }), events = []; bus.on(e => events.push(e.type));
  const engine = new OfficeEngine({ dataDir: dir, office, models: {}, knowledgeDir: path.join(dir, 'k'), bus });
  try {
    const j = engine.create({ dept: 'sales', text: 'Private plan', autoStart: false, ownerId: 'u_dana', origin: { channel: 'email', from: 'dana@acme.test', secret: null } });
    assert.equal(j.ownerId, 'u_dana'); assert.equal(j.visibility, 'private'); assert.deepEqual(j.sharedWith, { users: [], groups: [] }); assert.deepEqual(j.origin, { channel: 'email', from: 'dana@acme.test' }); assert.deepEqual(j.attachments, []);
    assert.equal(engine.create({ dept: 'sales', text: 'Nobody owns me', autoStart: false }).ownerId, null, 'a single office has no owner');
    assert.throws(() => engine.create({ dept: 'sales', text: 'x', autoStart: false, visibility: 'secret' }), /private or public/);
    assert.throws(() => engine.create({ dept: 'sales', text: 'x', autoStart: false, sharedWith: { users: 'u_sam' } }), /up to 50/);
    events.length = 0;
    const shared = engine.share(j.id, { visibility: 'private', sharedWith: { users: ['u_sam'], groups: ['g_sales', 'g_sales'] } });
    assert.deepEqual(shared.sharedWith, { users: ['u_sam'], groups: ['g_sales'] });
    assert.deepEqual(events.slice(0, 1), ['task.removed'], 'everyone hears the record left before those who may see it get it back');
    assert.equal(canSeeJob(sam, engine.get(j.id)), true);
    engine.notifications.notify({ kind: 'done', title: 'Done: private plan', jobId: j.id, userId: 'u_dana' });
    engine.notifications.notify({ kind: 'provider_error', title: 'Provider', userId: null });
    assert.equal(engine.notifications.list({ userId: 'u_dana', admin: false }).length, 1); assert.equal(engine.notifications.list({ userId: 'u_sam', admin: false }).length, 0);
    assert.equal(engine.notifications.list({ userId: 'u_owner', admin: true }).length, 2); assert.equal(engine.notifications.counts({ userId: 'u_dana', admin: false }).unread, 1);
    assert.equal(engine.threads.ensure('agent', 'lexi', { userId: 'u_dana' }), 'agent:lexi:u_dana'); assert.equal(engine.threads.ensure('agent', 'lexi'), 'agent:lexi');
  } finally { bus.close(); engine.db.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});
