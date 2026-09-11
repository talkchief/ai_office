import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOfficeInstance } from '../office-instance.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-instance-'));
const call = async (instance, method, pathname) => { const m = instance.router.match(method, pathname); assert.ok(m?.handler, `${method} ${pathname} has a route`); return m.handler({ req: {}, res: {}, url: new URL('http://x' + pathname), params: m.params, secure: false, local: true, origin: 'http://x', session: 't' }); };

test('an office instance builds on a fresh folder pair, answers the API and closes cleanly', async () => {
  const root = temp(), data = path.join(root, 'data'), brain = path.join(root, 'brain');
  fs.mkdirSync(data); fs.mkdirSync(brain);
  const lines = [];
  const instance = await createOfficeInstance({ dataDir: data, brainDir: brain, cfg: { name: 'Check Co' }, version: 'test', discovery: false, log: l => lines.push(l) });
  try {
    await instance.boot();
    const health = await call(instance, 'GET', '/api/health');
    assert.equal(health.ok, true); assert.equal(health.version, 'test'); assert.equal(health.name, 'Check Co');
    assert.equal(health.teams.length, 6); assert.equal(health.agents.length, 35);
    assert.ok(lines.some(l => /Brain search/.test(l)), 'boot reports the Brain index');
    const routines = await call(instance, 'GET', '/api/routines');
    assert.deepEqual(routines.depts, health.depts);
    // The stores live on this instance's folders, not the office's real data.
    assert.ok(fs.existsSync(path.join(data, 'office.json'))); assert.ok(fs.existsSync(path.join(data, 'workflows.sqlite')));
    assert.equal(instance.dataDir, data); assert.equal(instance.brainDir, brain);
    // Discovery off means no Claude Code candidates and no local commands looked up.
    assert.deepEqual(await instance.toolStore.discover(), []);
    const idea = instance.engine.create({ dept: health.teams[0].id, text: 'Check idea: a one-page plan.', backlog: true });
    assert.equal(idea.state, 'backlog');
    assert.ok((await call(instance, 'GET', '/api/tasks')).some(j => j.id === idea.id));
  } finally {
    await instance.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
  assert.equal(fs.existsSync(root), false, 'the folders can be removed once the instance is closed');
});

test('two instances on different folders do not share state', async () => {
  const a = temp(), b = temp();
  const make = root => { fs.mkdirSync(path.join(root, 'data')); fs.mkdirSync(path.join(root, 'brain')); return createOfficeInstance({ dataDir: path.join(root, 'data'), brainDir: path.join(root, 'brain'), cfg: { name: 'One' }, discovery: false, log: () => {} }); };
  const one = await make(a), two = await make(b);
  try {
    one.settings.update({ officeName: 'Alpha' });
    assert.equal(one.name, 'Alpha'); assert.equal(two.name, 'One');
    const job = one.engine.create({ dept: 'sales', text: 'Only in one.', backlog: true });
    assert.ok(one.engine.get(job.id)); assert.equal(two.engine.get(job.id), null);
  } finally {
    await one.close(); await two.close();
    fs.rmSync(a, { recursive: true, force: true, maxRetries: 5 }); fs.rmSync(b, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('a hosted-style instance refuses local-command connectors', async () => {
  const root = temp(); fs.mkdirSync(path.join(root, 'data')); fs.mkdirSync(path.join(root, 'brain'));
  const instance = await createOfficeInstance({ dataDir: path.join(root, 'data'), brainDir: path.join(root, 'brain'), cfg: { name: 'Hosted' }, discovery: false, allowStdio: false, log: () => {} });
  try {
    assert.throws(() => instance.toolStore.save({ name: 'local', type: 'stdio', command: 'npx', args: [] }), /by URL/);
    instance.toolStore.save({ name: 'remote', type: 'http', url: 'https://example.com/mcp' });
    assert.ok(instance.toolStore.list().some(t => t.id === 'remote'));
  } finally { await instance.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }); }
});
