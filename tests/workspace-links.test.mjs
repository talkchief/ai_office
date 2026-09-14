import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workspaceFile } from '../engine/documents.mjs';
import { officeBackend } from '../engine/backend.mjs';
import { createOfficeInstance } from '../office-instance.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-links-'));
const canLink = (() => { const d = temp(); try { fs.writeFileSync(path.join(d, 't'), 'x'); fs.symlinkSync(path.join(d, 't'), path.join(d, 'l')); return true; } catch { return false; } finally { fs.rmSync(d, { recursive: true, force: true }); } })();

// A link inside a task's workspace may point at the office's own secrets. No reader follows one.
test('no reader of a workspace follows a link: the export tools, the task file download, the agents’ file tools', { skip: !canLink && 'this system cannot make symbolic links' }, async () => {
  const root = temp(), secrets = temp(), data = path.join(root, 'data'), brain = path.join(root, 'brain');
  fs.mkdirSync(data); fs.mkdirSync(brain);
  fs.writeFileSync(path.join(secrets, 'providers.json'), '{"apiKey":"sk-live-secret"}');
  const instance = await createOfficeInstance({ dataDir: data, brainDir: brain, cfg: { name: 'Links' }, version: 'test', discovery: false, log: () => {}, sandboxClient: null });
  try {
    await instance.boot();
    const job = instance.engine.create({ dept: instance.office.get().teams[0].id, text: 'A task with a planted link.', backlog: true });
    const ws = instance.engine.workspaceDir(job.id); fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'real.md'), '# Real');
    fs.symlinkSync(path.join(secrets, 'providers.json'), path.join(ws, 'keys.md'));
    fs.symlinkSync(secrets, path.join(ws, 'folder'), 'dir');

    assert.throws(() => workspaceFile(ws, '/work/keys.md'), /Links are not allowed in \/work\//);
    assert.throws(() => workspaceFile(ws, 'folder/providers.json'), /Links are not allowed/);
    assert.equal(workspaceFile(ws, '/work/real.md').rel, 'real.md');

    const call = async pathname => { const url = new URL('http://x' + pathname), m = instance.router.match('GET', url.pathname); let status = 200, body = ''; const res = { writeHead: s => { status = s; }, write: c => { body += c; }, end: c => { if (c) body += c; }, on() {}, once() {}, emit() {}, removeListener() {} };
      const out = await m.handler({ req: {}, res, url, params: m.params, user: null }); return out?.$status ? { status: out.$status, body: JSON.stringify(out.body) } : { status, body }; };
    const leak = await call(`/api/tasks/${job.id}/file?path=keys.md`);
    assert.equal(leak.status, 400); assert.doesNotMatch(leak.body, /sk-live-secret/); assert.match(leak.body, /Links are not allowed/);
    const viaFolder = await call(`/api/tasks/${job.id}/file?path=${encodeURIComponent('folder/providers.json')}`);
    assert.notEqual(viaFolder.status, 200); assert.doesNotMatch(viaFolder.body, /sk-live-secret/);

    const backend = officeBackend({ workspaceDir: ws, knowledgeDir: brain, skillDirs: {}, memoryRoutes: {} });
    const read = await backend.read('/work/keys.md');
    assert.doesNotMatch(JSON.stringify(read), /sk-live-secret/, 'the agents’ read_file refuses the link');
    assert.ok(!instance.engine.files(job.id).some(f => /keys|providers/.test(f.name)), 'the Artifacts list shows no link');
  } finally { await instance.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }); fs.rmSync(secrets, { recursive: true, force: true }); }
});
