#!/usr/bin/env node
// The sandbox broker: the one process on the server that runs containers for the office. It runs as its own unprivileged user
// (rootless Podman), listens on a Unix socket the office service may reach, and turns a short list of requests, keyed by office
// and task, into podman commands with one locked-down profile (sandbox/rules.mjs). A caller cannot choose an image, a mount, a
// user, a network or a privilege: none of those are parameters of this API.
//
//   GET    /v1/health                                  podman version, image present, sandboxes and busy slots
//   GET    /v1/sandboxes                               every sandbox this broker runs, for the office's clean-up
//   PUT    /v1/sandboxes/:office/:task                 start the task's sandbox (or find the running one)
//   POST   /v1/sandboxes/:office/:task/push            copy files in: NDJSON lines {op:"put",path,data} | {op:"del",path}
//   POST   /v1/sandboxes/:office/:task/exec            run one command {command, timeoutSeconds}
//   GET    /v1/sandboxes/:office/:task/files           list /work: regular files with size and mtime, and what was skipped
//   POST   /v1/sandboxes/:office/:task/pull            copy files out {paths} → NDJSON lines {path,size,mtime,data} | {path,skipped}
//   POST   /v1/sandboxes/:office/:task/install         packages from PyPI or npm into the task's /deps {manager, packages}
//   DELETE /v1/sandboxes/:office/:task                 remove the container and its volumes
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { LIMITS, DEFAULT_SOCKET, DEFAULT_IMAGE, validOffice, validTask, validCommand, validPackages, containerName, volumeName, runArgs, execArgs, scriptArgs, installArgs, LIST_SCRIPT, PULL_SCRIPT, PUSH_SCRIPT } from './rules.mjs';

const int = (value, fallback, min, max) => { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback; };
export function brokerConfig(env = process.env) {
  return {
    socket: env.AO_SANDBOX_SOCKET || DEFAULT_SOCKET, image: env.AO_SANDBOX_IMAGE || DEFAULT_IMAGE, podman: env.AO_PODMAN || 'podman',
    memory: /^\d+[mg]$/i.test(env.AO_SANDBOX_MEMORY || '') ? env.AO_SANDBOX_MEMORY : '1g', cpus: /^\d+(\.\d+)?$/.test(env.AO_SANDBOX_CPUS || '') ? env.AO_SANDBOX_CPUS : '1',
    pids: int(env.AO_SANDBOX_PIDS, 256, 64, 4096), maxSandboxes: int(env.AO_SANDBOX_MAX, 8, 1, 64), maxBusy: int(env.AO_SANDBOX_BUSY, 3, 1, 32),
    idleMinutes: int(env.AO_SANDBOX_IDLE_MINUTES, 60, 5, 1440), minFreeBytes: int(env.AO_SANDBOX_MIN_FREE_GB, 10, 1, 1000) * 1024 ** 3,
    storage: env.AO_SANDBOX_STORAGE || path.join(os.homedir(), '.local', 'share', 'containers'), init: env.AO_SANDBOX_INIT !== '0',
  };
}
const brokerError = (status, message) => Object.assign(new Error(message), { status });
const tail = (text, n = 600) => String(text || '').trim().split('\n').slice(-6).join(' ').slice(-n);
const size = bytes => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;

// podman with an argument list (never a shell). Keeps the last `keep` characters of each stream; `input` is text or a stream for
// stdin; `stdoutTo` streams stdout straight into a writable (a response) instead of keeping it.
export function podmanRunner(bin = 'podman', { env = process.env } = {}) {
  return (args, { input, timeoutMs = 120000, stdoutTo = null, keep = 4 * 1024 * 1024 } = {}) => new Promise(resolve => {
    const child = spawn(bin, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', stdoutCut = false, stderrCut = false, killed = false;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', d => { stderr += d; if (stderr.length > keep) { stderr = stderr.slice(-keep); stderrCut = true; } });
    if (stdoutTo) child.stdout.on('data', d => { if (!stdoutTo.write(d)) { child.stdout.pause(); stdoutTo.once('drain', () => child.stdout.resume()); } });
    else { child.stdout.setEncoding('utf8'); child.stdout.on('data', d => { stdout += d; if (stdout.length > keep) { stdout = stdout.slice(-keep); stdoutCut = true; } }); }
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, timeoutMs); timer.unref?.();
    child.on('error', error => { clearTimeout(timer); resolve({ code: 127, stdout, stderr: String(error.message), stdoutCut, stderrCut, killed }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code: code ?? 137, stdout, stderr, stdoutCut, stderrCut, killed }); });
    child.stdin.on('error', () => {});
    if (input === undefined) child.stdin.end();
    else if (typeof input === 'string' || Buffer.isBuffer(input)) child.stdin.end(input);
    else { input.on('error', () => child.kill('SIGKILL')); input.pipe(child.stdin); }
  });
}

// `processes(cgroupPath)` counts the processes in a sandbox's cgroup from the host, which needs no process inside it: a sandbox
// whose process limit is used up cannot start one.
const cgroupProcesses = cgroup => { try { return Number(fs.readFileSync(path.join('/sys/fs/cgroup', cgroup, 'pids.current'), 'utf8')); } catch { return null; } };
export function createBroker({ config = brokerConfig(), podman = podmanRunner(config.podman), now = Date.now, log = line => console.log(line), statfs = p => fs.statfsSync(p), processes = cgroupProcesses } = {}) {
  const lastUsed = new Map(), queues = new Map(), waiters = [];
  let busy = 0;
  // One operation at a time per sandbox: the office already serialises a task's commands; this is the broker not trusting it.
  const serial = (key, fn) => { const run = (queues.get(key) || Promise.resolve()).catch(() => {}).then(fn); const settled = run.catch(() => {}); queues.set(key, settled); settled.then(() => { if (queues.get(key) === settled) queues.delete(key); }); return run; };
  // Heavy work (a command, an install) takes one of the server's busy slots; a caller waits up to two minutes for one.
  const acquire = (waitMs = 120000) => { if (busy < config.maxBusy) { busy++; return Promise.resolve(true); } return new Promise(resolve => { const entry = () => { clearTimeout(timer); busy++; resolve(true); }; const timer = setTimeout(() => { const i = waiters.indexOf(entry); if (i >= 0) waiters.splice(i, 1); resolve(false); }, waitMs); waiters.push(entry); }); };
  const release = () => { busy = Math.max(0, busy - 1); const next = waiters.shift(); if (next) next(); };

  async function list() {
    const r = await podman(['ps', '-a', '--filter', 'label=ao.sandbox=1', '--format', 'json'], { timeoutMs: 30000 });
    if (r.code !== 0) throw brokerError(502, `Podman did not list the sandboxes: ${tail(r.stderr)}`);
    let rows = []; try { rows = JSON.parse(r.stdout || '[]'); } catch { rows = []; }
    return rows.map(c => { const labels = c.Labels || {}, name = (Array.isArray(c.Names) ? c.Names[0] : c.Names) || ''; const created = Number(labels['ao.created']) || (c.Created ? Number(c.Created) * 1000 : 0);
      return { office: labels['ao.office'], task: labels['ao.task'], name, state: c.State, createdAt: created, lastUsedAt: lastUsed.get(name) || created }; }).filter(s => s.office && s.task);
  }
  function freeBytes() { try { const s = statfs(fs.existsSync(config.storage) ? config.storage : os.homedir()); return Number(s.bavail) * Number(s.bsize); } catch { return Infinity; } }
  async function health() {
    const [version, image, all] = await Promise.all([podman(['version', '--format', '{{.Client.Version}}'], { timeoutMs: 20000 }), podman(['image', 'exists', config.image], { timeoutMs: 20000 }), list().catch(() => [])]);
    return { ok: version.code === 0 && image.code === 0, podman: version.code === 0 ? version.stdout.trim() : null, image: config.image, imagePresent: image.code === 0, sandboxes: all.length, maxSandboxes: config.maxSandboxes, busy, maxBusy: config.maxBusy, freeBytes: freeBytes(),
      reason: version.code !== 0 ? `Podman does not answer: ${tail(version.stderr)}` : image.code !== 0 ? `The sandbox image ${config.image} is not built on this server yet.` : '' };
  }
  async function state(name) { const r = await podman(['container', 'inspect', '--format', '{{.State.Status}}', name], { timeoutMs: 20000 }); return r.code === 0 ? r.stdout.trim() : null; }
  async function ensure(office, task) {
    const name = containerName(office, task), current = await state(name);
    if (current === 'running') { lastUsed.set(name, now()); return { created: false }; }
    if (current) {
      const r = await podman(['start', name], { timeoutMs: 60000 });
      if (r.code === 0) { lastUsed.set(name, now()); return { created: false, restarted: true }; }
      await destroy(office, task);
    }
    const all = await list(); if (all.length >= config.maxSandboxes) throw brokerError(429, `Every sandbox slot on this server is in use (${all.length} of ${config.maxSandboxes}). Try again when another task is delivered.`);
    if (freeBytes() < config.minFreeBytes) throw brokerError(507, `The server is short of disk space (under ${size(config.minFreeBytes)} free); no new sandbox starts until space is freed.`);
    for (const which of ['work', 'deps']) {
      const v = await podman(['volume', 'create', '--label', 'ao.sandbox=1', '--label', `ao.office=${office}`, '--label', `ao.task=${task}`, volumeName(office, task, which)], { timeoutMs: 30000 });
      if (v.code !== 0 && !/already exists/i.test(v.stderr)) throw brokerError(502, `The sandbox's ${which} volume could not be made: ${tail(v.stderr)}`);
    }
    const r = await podman(runArgs({ office, task, image: config.image, memory: config.memory, cpus: config.cpus, pids: config.pids, init: config.init, now: now() }), { timeoutMs: 120000 });
    if (r.code !== 0) { await destroy(office, task).catch(() => {}); throw brokerError(502, `The sandbox could not start: ${tail(r.stderr)}`); }
    lastUsed.set(name, now()); log(`sandbox started ${name}`);
    return { created: true };
  }
  async function destroy(office, task) {
    const name = containerName(office, task);
    const rm = await podman(['rm', '--force', '--ignore', '--time', '0', name], { timeoutMs: 60000 });
    await podman(['rm', '--force', '--ignore', '--time', '0', `${name}-install`], { timeoutMs: 60000 });
    const volumes = await podman(['volume', 'rm', '--force', volumeName(office, task, 'work'), volumeName(office, task, 'deps')], { timeoutMs: 60000 });
    const existed = lastUsed.delete(name) || /ao-/.test(rm.stdout);
    if (rm.code !== 0) throw brokerError(502, `The sandbox could not be removed: ${tail(rm.stderr)}`);
    if (volumes.code !== 0 && !/no such volume|no volume with name/i.test(volumes.stderr)) log(`sandbox volumes of ${name} not removed: ${tail(volumes.stderr)}`);
    if (existed) log(`sandbox removed ${name}`);
    return { removed: existed };
  }
  async function leftovers(name) {
    const r = await podman(['inspect', '--format', '{{.State.CgroupPath}}', name], { timeoutMs: 20000 });
    const count = r.code === 0 && r.stdout.trim() ? processes(r.stdout.trim()) : null;
    return Number.isFinite(count) ? Math.max(0, count - 2) : 0;
  }
  async function running(office, task) { const name = containerName(office, task); if (await state(name) !== 'running') throw brokerError(409, 'The sandbox is not running; start it first.'); return name; }
  async function exec(office, task, { command, timeoutSeconds } = {}) {
    const bad = validCommand(command); if (bad) throw brokerError(400, bad);
    const name = await running(office, task), seconds = int(timeoutSeconds, LIMITS.commandMinutesDefault * 60, 10, LIMITS.commandMinutesMax * 60);
    if (!await acquire()) throw brokerError(429, 'The sandbox is busy: other commands are running on this server. Try again shortly.');
    const started = now(); let stopped = '';
    const stop = async reason => { if (stopped) return; stopped = reason; await podman(['restart', '--time', '0', name], { timeoutMs: 60000 }); };
    // A command that fills /work past its cap, or outlives its own `timeout`, is stopped by restarting the container; the files stay.
    const watch = setInterval(async () => { const du = await podman(['exec', '--user', '1000:1000', name, 'du', '-sb', '/work'], { timeoutMs: 20000 }); const bytes = Number(String(du.stdout).trim().split(/\s/)[0]); if (bytes > LIMITS.workBytes) stop(`/work grew past ${size(LIMITS.workBytes)}`); }, 10000);
    const hard = setTimeout(() => stop('the command did not stop at its time limit'), (seconds + 20) * 1000);
    try {
      const r = await podman(execArgs({ office, task, command, seconds }), { timeoutMs: (seconds + 60) * 1000, keep: LIMITS.outputChars });
      const durationMs = now() - started, timedOut = !stopped && [124, 137].includes(r.code) && durationMs >= seconds * 1000 - 2000;
      clearInterval(watch); clearTimeout(hard);
      // A command's background processes end with it. Anything beyond the sandbox's own two (init and its sleep) is left over,
      // a fork bomb included; restarting the container stops them all and keeps /work.
      const leftover = stopped ? 0 : await leftovers(name);
      if (leftover > 0) await podman(['restart', '--time', '0', name], { timeoutMs: 60000 });
      lastUsed.set(name, now()); log(`sandbox exec ${name} → exit ${r.code} in ${durationMs} ms${timedOut ? ' (time limit)' : ''}${stopped ? ' (stopped: ' + stopped + ')' : ''}${leftover > 0 ? ` (${leftover} left-over processes stopped)` : ''}`);
      return { exitCode: r.code, timedOut, stopped, durationMs, seconds, leftover: leftover > 0 ? leftover : 0, stdout: r.stdout, stderr: r.stderr, stdoutCut: r.stdoutCut, stderrCut: r.stderrCut };
    } finally { clearInterval(watch); clearTimeout(hard); release(); }
  }
  async function files(office, task) {
    const name = await running(office, task), r = await podman(scriptArgs({ office, task, script: LIST_SCRIPT }), { timeoutMs: 120000 });
    if (r.code !== 0) throw brokerError(502, `Listing the sandbox's files failed: ${tail(r.stderr)}`);
    lastUsed.set(name, now()); return JSON.parse(r.stdout);
  }
  async function push(office, task, req) {
    const name = await running(office, task); let bytes = 0;
    const cap = Math.ceil(LIMITS.copyBytes * 1.4) + 1024 * 1024;
    const counted = new Transform({ transform(chunk, _enc, done) { bytes += chunk.length; if (bytes > cap) done(brokerError(413, `A copy into the sandbox is limited to ${size(LIMITS.copyBytes)}.`)); else done(null, chunk); } });
    req.pipe(counted);
    const r = await podman(scriptArgs({ office, task, script: PUSH_SCRIPT, stdin: true }), { input: counted, timeoutMs: 300000 });
    if (bytes > cap) throw brokerError(413, `A copy into the sandbox is limited to ${size(LIMITS.copyBytes)}.`);
    if (r.code !== 0) throw brokerError(502, `Copying files into the sandbox failed: ${tail(r.stderr)}`);
    lastUsed.set(name, now()); return JSON.parse(r.stdout);
  }
  async function pull(office, task, { paths } = {}, res) {
    if (!Array.isArray(paths)) throw brokerError(400, 'Name the files to copy out.');
    const name = await running(office, task);
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    const r = await podman(scriptArgs({ office, task, script: PULL_SCRIPT, stdin: true }), { input: JSON.stringify({ paths: paths.slice(0, LIMITS.copyFiles).map(String), maxFile: LIMITS.fileBytes, maxTotal: LIMITS.copyBytes }), stdoutTo: res, timeoutMs: 300000 });
    if (r.code !== 0) res.write(JSON.stringify({ error: `Copying files out of the sandbox failed: ${tail(r.stderr)}` }) + '\n');
    lastUsed.set(name, now()); res.end();
  }
  async function install(office, task, { manager, packages } = {}) {
    const checked = validPackages(manager, packages); if (checked.error) throw brokerError(400, checked.error);
    const name = await running(office, task);
    if (!await acquire()) throw brokerError(429, 'The sandbox is busy: other commands are running on this server. Try again shortly.');
    const started = now();
    try {
      const r = await podman(installArgs({ office, task, manager, packages: checked.packages, image: config.image }), { timeoutMs: (LIMITS.installSeconds + 60) * 1000, keep: 8000 });
      if (r.killed) await podman(['rm', '--force', '--ignore', '--time', '0', `${name}-install`], { timeoutMs: 60000 });
      lastUsed.set(name, now()); log(`sandbox install ${name} (${manager}, ${checked.packages.length}) → exit ${r.code}`);
      return { exitCode: r.killed ? 124 : r.code, durationMs: now() - started, packages: checked.packages, output: `${r.stdout}\n${r.stderr}`.trim().slice(-8000) };
    } finally { release(); }
  }
  async function reap() {
    let all = []; try { all = await list(); } catch { return []; }
    const idle = all.filter(s => now() - (s.lastUsedAt || s.createdAt || 0) > config.idleMinutes * 60000);
    for (const s of idle) { try { await serial(s.name, () => destroy(s.office, s.task)); log(`sandbox reaped ${s.name}: idle over ${config.idleMinutes} minutes`); } catch (error) { log(`sandbox reap ${s.name} failed: ${error.message}`); } }
    return idle.map(s => s.name);
  }

  const send = (res, status, body) => { if (res.headersSent) { res.end(); return; } res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const readJson = req => new Promise((resolve, reject) => { let raw = ''; req.setEncoding('utf8'); req.on('data', d => { raw += d; if (raw.length > 64 * 1024) { reject(brokerError(413, 'The request is too large.')); req.destroy(); } }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(brokerError(400, 'The request is not JSON.')); } }); req.on('error', reject); });
  const handle = async (req, res) => {
    const parts = new URL(req.url, 'http://broker').pathname.split('/').filter(Boolean);
    try {
      if (parts[0] !== 'v1') throw brokerError(404, 'Unknown path.');
      if (req.method === 'GET' && parts[1] === 'health' && parts.length === 2) return send(res, 200, await health());
      if (req.method === 'GET' && parts[1] === 'sandboxes' && parts.length === 2) return send(res, 200, { sandboxes: await list() });
      const [, what, office, task, action = '', extra] = parts;
      if (what !== 'sandboxes' || !office || !task || extra !== undefined) throw brokerError(404, 'Unknown path.');
      if (!validOffice(office) || !validTask(task)) throw brokerError(400, 'Invalid office or task id.');
      const key = containerName(office, task), route = `${req.method} ${action}`;
      if (route === 'PUT ') return send(res, 200, await serial(key, () => ensure(office, task)));
      if (route === 'DELETE ') return send(res, 200, await serial(key, () => destroy(office, task)));
      if (route === 'GET files') return send(res, 200, await serial(key, () => files(office, task)));
      if (route === 'POST push') return send(res, 200, await serial(key, () => push(office, task, req)));
      if (route === 'POST exec') { const body = await readJson(req); return send(res, 200, await serial(key, () => exec(office, task, body))); }
      if (route === 'POST install') { const body = await readJson(req); return send(res, 200, await serial(key, () => install(office, task, body))); }
      if (route === 'POST pull') { const body = await readJson(req); return await serial(key, () => pull(office, task, body, res)); }
      throw brokerError(404, 'Unknown path.');
    } catch (error) { if (!error.status) log(`sandbox broker error: ${error.stack || error.message}`); send(res, error.status || 500, { error: error.status ? error.message : 'The sandbox broker failed; see its log.' }); }
  };
  return { handle, ensure, destroy, exec, files, push, pull, install, list, health, reap, get busy() { return busy; } };
}

// Run as a service: listen on the socket (group-readable, so the office service in the broker's group can connect), reap idle sandboxes.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = brokerConfig(), broker = createBroker({ config });
  try { fs.unlinkSync(config.socket); } catch {}
  fs.mkdirSync(path.dirname(config.socket), { recursive: true });
  const server = http.createServer((req, res) => { broker.handle(req, res); });
  server.requestTimeout = 0; server.headersTimeout = 60000;
  server.listen(config.socket, () => {
    try { fs.chmodSync(config.socket, 0o660); } catch {}
    console.log(`sandbox broker on ${config.socket} · image ${config.image} · ${config.maxSandboxes} sandboxes, ${config.maxBusy} busy at once, ${config.memory} and ${config.cpus} CPU each`);
    broker.reap().catch(() => {});
  });
  const timer = setInterval(() => broker.reap().catch(() => {}), 5 * 60000); timer.unref();
  const quit = () => { clearInterval(timer); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', quit); process.on('SIGINT', quit);
}
