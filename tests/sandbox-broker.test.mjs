import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createBroker } from '../sandbox/broker.mjs';
import { BrokerClient } from '../engine/sandbox.mjs';
import { LIST_SCRIPT, PULL_SCRIPT, PUSH_SCRIPT } from '../sandbox/rules.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-broker-'));
const socketIn = dir => process.platform === 'win32' ? `\\\\?\\pipe\\ao-broker-test-${process.pid}-${Math.random().toString(36).slice(2)}` : path.join(dir, 'broker.sock');

// Podman, played: containers and volumes in memory, each call recorded with its arguments.
function fakePodman({ execs = [] } = {}) {
  const containers = new Map(), volumes = new Set(), calls = [];
  const run = async (args, { input, stdoutTo } = {}) => {
    calls.push(args);
    const [cmd, sub] = args;
    if (cmd === 'version') return { code: 0, stdout: '5.8.2\n', stderr: '' };
    if (cmd === 'image' && sub === 'exists') return { code: 0, stdout: '', stderr: '' };
    if (cmd === 'ps') return { code: 0, stdout: JSON.stringify([...containers.values()].map(c => ({ Names: [c.name], State: 'running', Labels: { 'ao.sandbox': '1', 'ao.office': c.office, 'ao.task': c.task, 'ao.created': String(c.created) } }))), stderr: '' };
    if (cmd === 'inspect') return { code: 0, stdout: `/user.slice/libpod-${args.at(-1)}.scope\n`, stderr: '' };
    if (cmd === 'container' && sub === 'inspect') { const c = containers.get(args.at(-1)); return c ? { code: 0, stdout: 'running\n', stderr: '' } : { code: 125, stdout: '', stderr: 'no such container' }; }
    if (cmd === 'volume' && sub === 'create') { volumes.add(args.at(-1)); return { code: 0, stdout: args.at(-1), stderr: '' }; }
    if (cmd === 'volume' && sub === 'rm') { for (const v of args.slice(3)) volumes.delete(v); return { code: 0, stdout: '', stderr: '' }; }
    if (cmd === 'run' && args.includes('-d')) { const name = args[args.indexOf('--name') + 1], label = k => args[args.indexOf(`ao.${k}=${args.find(a => a.startsWith(`ao.${k}=`))?.split('=')[1]}`)]?.split('=')[1]; containers.set(name, { name, office: label('office'), task: label('task'), created: Number(label('created')), files: new Map() }); return { code: 0, stdout: 'id\n', stderr: '' }; }
    if (cmd === 'run' && args.includes('--rm')) return { code: 0, stdout: 'Successfully installed', stderr: '' };
    if (cmd === 'rm') { const name = args.at(-1), had = containers.delete(name); return { code: 0, stdout: had ? name + '\n' : '', stderr: '' }; }
    if (cmd === 'restart') return { code: 0, stdout: '', stderr: '' };
    if (cmd === 'exec') {
      const name = args.find(a => a.startsWith('ao-')), box = containers.get(name);
      if (args.includes(LIST_SCRIPT)) return { code: 0, stdout: JSON.stringify({ files: [...box.files].map(([p, d]) => ({ p, s: d.length, m: 7 })), skipped: [{ p: 'evil', t: 'link' }], truncated: false }), stderr: '' };
      if (args.includes(PUSH_SCRIPT)) { let text = ''; for await (const chunk of input) text += chunk; const written = []; for (const line of text.split('\n').filter(Boolean)) { const e = JSON.parse(line); box.files.set(e.path, Buffer.from(e.data, 'base64')); written.push({ p: e.path, s: box.files.get(e.path).length, m: 7 }); } return { code: 0, stdout: JSON.stringify({ written, deleted: [], skipped: [] }), stderr: '' }; }
      if (args.includes(PULL_SCRIPT)) { const { paths } = JSON.parse(input); for (const p of paths) stdoutTo.write(JSON.stringify(box.files.has(p) ? { path: p, size: box.files.get(p).length, mtime: 7, data: box.files.get(p).toString('base64') } : { path: p, skipped: 'gone' }) + '\n'); return { code: 0, stdout: '', stderr: '' }; }
      if (args.includes('du')) return { code: 0, stdout: '4096\t/work\n', stderr: '' };
      const command = args.at(-1), hook = execs.shift();
      if (hook) return hook({ command, box });
      return { code: 0, stdout: `ran: ${command}`, stderr: '' };
    }
    return { code: 1, stdout: '', stderr: `unexpected podman ${args.join(' ')}` };
  };
  return { run, calls, containers, volumes };
}

async function brokerOn({ config = {}, podman = fakePodman(), now, processes = () => 2 } = {}) {
  const dir = temp(), socketPath = socketIn(dir), logs = [];
  const broker = createBroker({ config: { image: 'localhost/ao-sandbox:test', memory: '1g', cpus: '1', pids: 256, maxSandboxes: 8, maxBusy: 3, idleMinutes: 60, minFreeBytes: 1, storage: dir, init: true, ...config }, podman: podman.run, log: l => logs.push(l), statfs: () => ({ bavail: 1e9, bsize: 4096 }), processes, ...(now ? { now } : {}) });
  const server = http.createServer((req, res) => broker.handle(req, res));
  await new Promise(r => server.listen(socketPath, r));
  return { broker, podman, client: new BrokerClient({ socketPath }), logs, close: () => new Promise(r => server.close(() => { fs.rmSync(dir, { recursive: true, force: true }); r(); })) };
}

test('the broker runs one fixed profile per task, and answers the office over its socket', async () => {
  const b = await brokerOn();
  try {
    assert.deepEqual(await b.client.health(), { ok: true, podman: '5.8.2', image: 'localhost/ao-sandbox:test', imagePresent: true, sandboxes: 0, maxSandboxes: 8, busy: 0, maxBusy: 3, freeBytes: 4096e9, reason: '' });
    assert.deepEqual(await b.client.ensure('t_abc', 'task-1'), { created: true });
    assert.deepEqual(await b.client.ensure('t_abc', 'task-1'), { created: false }, 'the running sandbox is found, not started twice');
    const run = b.podman.calls.find(a => a[0] === 'run'), line = run.join(' ');
    for (const part of ['--network none', '--cap-drop ALL', '--security-opt no-new-privileges', '--read-only', '--user 1000:1000', '--memory 1g', '--pids-limit 256', '--cpus 1', 'type=volume,src=ao-t_abc-task-1-work,dst=/work,U=true', 'localhost/ao-sandbox:test sleep infinity']) assert.ok(line.includes(part), part);
    assert.deepEqual([...b.podman.volumes].sort(), ['ao-t_abc-task-1-deps', 'ao-t_abc-task-1-work']);

    // Files in as NDJSON, a command, the listing, files out as NDJSON.
    async function* lines() { yield JSON.stringify({ op: 'put', path: 'build.py', data: Buffer.from('print(1)').toString('base64') }) + '\n'; }
    assert.deepEqual(await b.client.push('t_abc', 'task-1', lines()), { written: [{ p: 'build.py', s: 8, m: 7 }], deleted: [], skipped: [] });
    const out = await b.client.exec('t_abc', 'task-1', { command: 'python3 build.py', timeoutSeconds: 120 });
    assert.equal(out.exitCode, 0); assert.equal(out.stdout, 'ran: python3 build.py'); assert.equal(out.seconds, 120); assert.equal(out.timedOut, false);
    const exec = b.podman.calls.find(a => a[0] === 'exec' && a.at(-1) === 'python3 build.py');
    assert.deepEqual(exec, ['exec', '--user', '1000:1000', '--workdir', '/work', 'ao-t_abc-task-1', 'timeout', '-k', '5', '120', 'bash', '-c', 'python3 build.py']);
    assert.equal(out.leftover, 0); assert.equal(b.podman.calls.some(a => a[0] === 'restart'), false, 'nothing left over, no restart');
    assert.deepEqual(await b.client.files('t_abc', 'task-1'), { files: [{ p: 'build.py', s: 8, m: 7 }], skipped: [{ p: 'evil', t: 'link' }], truncated: false });
    const got = []; await b.client.pull('t_abc', 'task-1', ['build.py', 'missing.txt'], line => got.push(line));
    assert.deepEqual(got, [{ path: 'build.py', size: 8, mtime: 7, data: Buffer.from('print(1)').toString('base64') }, { path: 'missing.txt', skipped: 'gone' }]);

    // Installs: plain names only, in a helper container without the task's files.
    await assert.rejects(b.client.install('t_abc', 'task-1', { manager: 'pip', packages: ['https://evil.example/x.whl'] }), e => e.status === 400 && /Not a plain package name/.test(e.message));
    const installed = await b.client.install('t_abc', 'task-1', { manager: 'npm', packages: ['left-pad@1.3.0'] });
    assert.equal(installed.exitCode, 0); assert.deepEqual(installed.packages, ['left-pad@1.3.0']);
    const helper = b.podman.calls.find(a => a[0] === 'run' && a.includes('--rm')).join(' ');
    assert.match(helper, /--ignore-scripts/); assert.doesNotMatch(helper, /-work,dst=\/work/); assert.match(helper, /src=ao-t_abc-task-1-deps,dst=\/deps,U=true/);

    // Refusals are sentences with a status.
    await assert.rejects(b.client.exec('t_abc', 'task-1', { command: '' }), e => e.status === 400 && /Give the command to run/.test(e.message));
    await assert.rejects(b.client.request('PUT', '/v1/sandboxes/BAD..ID/task-1'), e => e.status === 400 && /Invalid office or task id/.test(e.message));
    await assert.rejects(b.client.exec('t_abc', 'not-started', { command: 'ls' }), e => e.status === 409 && /not running/.test(e.message));
    await assert.rejects(b.client.request('POST', '/v1/sandboxes/t_abc/task-1/shell'), e => e.status === 404);

    assert.equal((await b.client.sandboxes()).length, 1);
    assert.deepEqual(await b.client.destroy('t_abc', 'task-1'), { removed: true });
    assert.deepEqual(await b.client.destroy('t_abc', 'task-1'), { removed: false }, 'removing twice is fine');
    assert.equal(b.podman.containers.size, 0); assert.equal(b.podman.volumes.size, 0, 'the volumes go with it');
  } finally { await b.close(); }
});

test('the broker keeps to its slots, serialises a task, and reaps what sits idle', async () => {
  let clock = 1_000_000;
  let release; const gate = new Promise(r => { release = r; });
  const podman = fakePodman({ execs: [async () => { await gate; return { code: 0, stdout: 'first', stderr: '' }; }] });
  const b = await brokerOn({ config: { maxSandboxes: 2, maxBusy: 1, idleMinutes: 30 }, podman, now: () => clock });
  try {
    await b.client.ensure('office', 'one'); await b.client.ensure('office', 'two');
    await assert.rejects(b.client.ensure('office', 'three'), e => e.status === 429 && /Every sandbox slot on this server is in use \(2 of 2\)/.test(e.message));
    // One busy slot: the second command waits for the first to finish.
    const order = [];
    const first = b.client.exec('office', 'one', { command: 'slow' }).then(r => order.push(r.stdout));
    await new Promise(r => setTimeout(r, 50));
    const second = b.client.exec('office', 'two', { command: 'quick' }).then(r => order.push(r.stdout));
    await new Promise(r => setTimeout(r, 50)); assert.deepEqual(order, [], 'the second waits while the only slot is busy');
    release(); await Promise.all([first, second]);
    assert.deepEqual(order, ['first', 'ran: quick']);
    // Idle past the limit: reaped, with its volumes.
    clock += 31 * 60000;
    await b.client.files('office', 'two');
    assert.deepEqual(await b.broker.reap(), ['ao-office-one']);
    assert.deepEqual([...b.podman.containers.keys()], ['ao-office-two']);
  } finally { await b.close(); }
});

test('processes a command leaves behind are stopped when it ends, a fork bomb included', async () => {
  let count = 2;
  const podman = fakePodman({ execs: [async () => { count = 258; return { code: 0, stdout: 'survived', stderr: '' }; }] });
  const b = await brokerOn({ podman, processes: cgroup => { assert.match(cgroup, /^\/user\.slice\/libpod-ao-office-bomb\.scope$/); return count; } });
  try {
    await b.client.ensure('office', 'bomb');
    const out = await b.client.exec('office', 'bomb', { command: 'bash -c ":(){ :|:& };:"' });
    assert.equal(out.leftover, 256); assert.deepEqual(b.podman.calls.filter(a => a[0] === 'restart'), [['restart', '--time', '0', 'ao-office-bomb']], 'the container restarts once, keeping its volumes');
    assert.ok(b.logs.some(l => /256 left-over processes stopped/.test(l)));
  } finally { await b.close(); }
});
