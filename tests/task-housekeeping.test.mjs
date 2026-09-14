import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOfficeInstance } from '../office-instance.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-tidy-'));
// A route called the way the server calls it; `user` is the viewer (null: the single office's owner).
const call = async (instance, method, pathname, user = null) => {
  const m = instance.router.match(method, pathname.split('?')[0]); assert.ok(m?.handler, `${method} ${pathname} has a route`);
  return m.handler({ req: {}, res: {}, url: new URL('http://x' + pathname), params: m.params, secure: false, local: true, origin: 'http://x', session: 't', user });
};
const refused = async (promise, status, pattern) => { await assert.rejects(promise, error => error.status === status && pattern.test(error.message)); };

async function office() {
  const root = temp(), data = path.join(root, 'data'), brain = path.join(root, 'brain');
  fs.mkdirSync(data); fs.mkdirSync(brain);
  const instance = await createOfficeInstance({ dataDir: data, brainDir: brain, cfg: { name: 'Tidy Co' }, version: 'test', discovery: false, log: () => {} });
  await instance.boot();
  const events = []; instance.bus.on(event => events.push(event));
  return { instance, root, brain, events, close: async () => { await instance.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }); } };
}
// A finished task the way the office finishes one: the result is filed in the Brain through the office's own completion.
async function finished(instance, text, extra = {}) {
  const team = instance.office.get().teams[0].id;
  const job = instance.engine.create({ dept: team, text, backlog: true, ...extra });
  const out = await instance.engine.finish(job.id, { summary: 'The plan is written.', result: `# ${text}\n\nThe zephyrquill plan: three steps.` });
  assert.equal(out.ok, true); return instance.engine.get(job.id);
}

test('archiving takes a closed task off the board and keeps everything; restoring, or new work on it, brings it back', async () => {
  const { instance, brain, close } = await office();
  try {
    const job = await finished(instance, 'Draft the launch plan');
    const note = path.join(brain, 'Agents Office', `task-${job.id}.md`);
    assert.ok(fs.existsSync(note), 'the result is filed in the Brain');
    const open = instance.engine.create({ dept: job.dept, text: 'An idea still open', backlog: true });
    await refused(call(instance, 'POST', `/api/tasks/${open.id}/archive`), 409, /finished or cancelled/);

    const archived = await call(instance, 'POST', `/api/tasks/${job.id}/archive`);
    assert.ok(archived.archivedAt); assert.equal(archived.state, 'done');
    assert.equal((await call(instance, 'GET', '/api/tasks')).some(t => t.id === job.id), false, 'off the board');
    assert.deepEqual((await call(instance, 'GET', '/api/tasks?archived=1')).map(t => t.id), [job.id], 'in the archive');
    assert.equal((await call(instance, 'GET', '/api/tasks?archived=all')).length, 2);
    assert.equal((await call(instance, 'GET', `/api/teams/${job.dept}/tasks`)).some(t => t.id === job.id), false, 'not offered in the @ picker');
    // Everything is kept: the record opens, the Brain note and the conversation are there, its inbox items are acknowledged.
    const detail = await call(instance, 'GET', `/api/tasks/${job.id}`);
    assert.equal(detail.result.includes('zephyrquill'), true); assert.ok(detail.messages.length);
    assert.ok(fs.existsSync(note), 'archiving keeps the Brain note');
    assert.ok(instance.engine.notifications.list({}).filter(n => n.jobId === job.id).every(n => n.ackedAt));
    assert.ok(instance.audit.list({}).some(a => /Archived “Draft the launch plan”/.test(a.summary)));

    const restored = await call(instance, 'POST', `/api/tasks/${job.id}/restore`);
    assert.equal(restored.archivedAt, null); assert.ok((await call(instance, 'GET', '/api/tasks')).some(t => t.id === job.id));

    // Work that starts again on an archived task (a correction, an answer by email) puts it back on the board by itself.
    instance.engine.archive(job.id);
    instance.engine.setState(job.id, 'working');
    assert.equal(instance.engine.get(job.id).archivedAt, null);
    assert.ok(instance.engine.events(job.id).some(e => e.type === 'restored'));
    instance.engine.setState(job.id, 'done');

    // A project's tasks stay with the project.
    const project = instance.projects.create({ name: 'Spring launch', description: 'Launch the spring range in every store.' }, { ownerId: null });
    const inProject = await finished(instance, 'Project deliverable', { projectId: project.id });
    await refused(call(instance, 'POST', `/api/tasks/${inProject.id}/archive`), 409, /stay with the project/);
  } finally { await close(); }
});

test('deleting a closed task removes it for good: record, conversation, inbox, checkpoints, workspace and its note in the Brain', async () => {
  const { instance, brain, events, close } = await office();
  try {
    const job = await finished(instance, 'Price the zephyrquill bundle');
    const { engine } = instance, note = path.join(brain, 'Agents Office', `task-${job.id}.md`);
    // What a task leaves behind: files in its workspace, a question and its answer in a person's chat, checkpoints of its runs.
    fs.mkdirSync(path.join(engine.workspaceDir(job.id), 'out'), { recursive: true }); fs.writeFileSync(path.join(engine.workspaceDir(job.id), 'out', 'plan.md'), '# Plan');
    const chat = engine.threads.ensure('agent', 'someone'); engine.threads.append(chat, { role: 'ceo', agent: 'someone', text: 'How is the bundle priced?', jobId: job.id }); engine.threads.append(chat, { role: 'ceo', agent: 'someone', text: 'Unrelated chat line.' });
    engine.saver.setup();
    for (const thread of [job.id, `${job.id}:quick:1`, 'another-task']) engine.db.prepare("INSERT INTO checkpoints(thread_id, checkpoint_ns, checkpoint_id, type) VALUES (?, '', 'c1', 'json')").run(thread);
    engine.db.prepare("INSERT INTO writes(thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel) VALUES (?, '', 'c1', 't', 0, 'messages')").run(job.id);
    const notices = engine.notifications.list({}).filter(n => n.jobId === job.id).map(n => n.id);
    assert.ok(notices.length, 'the finished task put an item in the inbox');
    assert.ok(instance.index.search('zephyrquill').some(h => h.path.includes(job.id)), 'the Brain search finds the filed result');

    const open = engine.create({ dept: job.dept, text: 'Still an idea', backlog: true });
    await refused(call(instance, 'DELETE', `/api/tasks/${open.id}`), 409, /Cancel it first/);

    const out = await call(instance, 'DELETE', `/api/tasks/${job.id}`);
    assert.deepEqual(out, { ok: true, id: job.id, brainNote: `Agents Office/task-${job.id}.md` });
    assert.equal(engine.get(job.id), null); assert.deepEqual(engine.events(job.id), []);
    await refused(call(instance, 'GET', `/api/tasks/${job.id}`), 404, /No such task/);
    assert.deepEqual(engine.threads.list(job.id), [], 'its conversation is gone');
    assert.deepEqual(engine.threads.list(chat).map(m => m.text), ['Unrelated chat line.'], 'the chat keeps what was not about the task');
    assert.deepEqual(engine.notifications.list({}).filter(n => n.jobId === job.id), [], 'its inbox items are gone');
    assert.deepEqual(engine.db.prepare('SELECT thread_id FROM checkpoints ORDER BY thread_id').all().map(r => r.thread_id), ['another-task'], 'its checkpoints are gone, another task’s stay');
    assert.equal(engine.db.prepare('SELECT COUNT(*) n FROM writes WHERE thread_id = ?').get(job.id).n, 0);
    assert.equal(fs.existsSync(engine.workspaceDir(job.id)), false, 'its workspace is gone');
    assert.equal(fs.existsSync(note), false, 'its note is gone from the Brain');
    assert.equal(fs.existsSync(path.join(brain, '.archive')) && fs.readdirSync(path.join(brain, '.archive')).some(f => f.includes(job.id)), false, 'deleted, not archived');
    assert.equal(instance.index.search('zephyrquill').some(h => h.path.includes(job.id)), false, 'the Brain search no longer finds it');
    assert.ok(events.some(e => e.type === 'task.removed' && e.data.id === job.id), 'every board drops it');
    assert.ok(events.some(e => e.type === 'notification.removed' && notices.every(id => e.data.ids.includes(id))), 'every inbox drops its items');
    assert.ok(instance.audit.list({}).some(a => /Deleted “Price the zephyrquill bundle” and its note in the Brain/.test(a.summary)));
    await refused(call(instance, 'DELETE', `/api/tasks/${job.id}`), 404, /No such task/);

    // A cancelled task has no note to remove; deleting it still works.
    engine.cancel(open.id);
    assert.deepEqual(await call(instance, 'DELETE', `/api/tasks/${open.id}`), { ok: true, id: open.id, brainNote: null });
  } finally { await close(); }
});

test('in a shared office only the task’s owner or an office admin puts it away', async () => {
  const { instance, close } = await office();
  try {
    const job = await finished(instance, 'Public plan', { ownerId: 'u_owner', visibility: 'public' });
    const member = { id: 'u_member', role: 'member', groups: [], tenantId: 't' }, owner = { id: 'u_owner', role: 'member', groups: [], tenantId: 't' }, admin = { id: 'u_admin', role: 'admin', groups: [], tenantId: 't' };
    assert.ok((await call(instance, 'GET', `/api/tasks/${job.id}`, member)).id, 'the member can see the public task');
    await refused(call(instance, 'POST', `/api/tasks/${job.id}/archive`, member), 403, /owner or an office admin/);
    await refused(call(instance, 'DELETE', `/api/tasks/${job.id}`, member), 403, /owner or an office admin/);
    assert.ok((await call(instance, 'POST', `/api/tasks/${job.id}/archive`, owner)).archivedAt, 'the owner archives it');
    await refused(call(instance, 'POST', `/api/tasks/${job.id}/restore`, member), 403, /owner or an office admin/);
    assert.equal((await call(instance, 'POST', `/api/tasks/${job.id}/restore`, admin)).archivedAt, null, 'an admin restores it');
    const secret = await finished(instance, 'Private plan', { ownerId: 'u_owner' });
    await refused(call(instance, 'DELETE', `/api/tasks/${secret.id}`, member), 403, /someone else|belongs/i);
    assert.equal((await call(instance, 'DELETE', `/api/tasks/${secret.id}`, admin)).ok, true);
  } finally { await close(); }
});
