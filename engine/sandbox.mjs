// The office's side of the sandbox: a client for the broker (sandbox/broker.mjs) on its Unix socket, a fake broker for tests,
// TaskSandboxes (one sandbox per task: files copied in and out, commands run, removal when the task closes) and the two tools.
//
// The sandbox never sees the task's workspace directory. Before each command the office sends the plain files that changed since
// the last copy; after it, it asks what changed in the sandbox and writes those files back into /work/ itself, refusing anything
// that is not a plain file on a plain path. A link, a FIFO or a device made inside a sandbox can never reach the office's disk.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { LIMITS, DEFAULT_SOCKET, SKIP_DIRS, SANDBOX_TOOL, SANDBOX_LABEL, safeRelative, inSkippedDir, validCommand, validPackages, commandSeconds } from '../sandbox/rules.mjs';

export { SANDBOX_TOOL, SANDBOX_LABEL };
// The tool that reaches the internet waits for the CEO while "Ask before outside actions" is on; running code does not.
export const SANDBOX_APPROVALS = { sandbox_install: { allowedDecisions: ['approve', 'reject'] } };

const sizeText = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const KIND = { link: 'a link', fifo: 'a pipe', socket: 'a socket', device: 'a device file', folder: 'a folder', name: 'a name that is not UTF-8', other: 'not a plain file' };

/* ---------- the broker client ---------- */
export class BrokerClient {
  constructor({ socketPath = process.env.AO_SANDBOX_SOCKET || DEFAULT_SOCKET } = {}) { this.socketPath = socketPath; }
  installed() { try { return fs.statSync(this.socketPath).isSocket(); } catch { return false; } }
  // One request. `json` is sent as the body; `lines` (an async iterable of strings) is streamed; `onLine` receives NDJSON answers.
  request(method, pathname, { json, lines, onLine, timeoutMs = 30000 } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ socketPath: this.socketPath, path: pathname, method, headers: json !== undefined ? { 'content-type': 'application/json' } : lines ? { 'content-type': 'application/x-ndjson' } : {} }, res => {
        if (onLine && res.statusCode < 400) {
          let buffer = ''; res.setEncoding('utf8');
          res.on('data', chunk => { buffer += chunk; let i; while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); if (line.trim()) { try { onLine(JSON.parse(line)); } catch (error) { req.destroy(error); return; } } } });
          res.on('end', () => { if (buffer.trim()) { try { onLine(JSON.parse(buffer)); } catch {} } resolve({}); }); res.on('error', reject); return;
        }
        let raw = ''; res.setEncoding('utf8'); res.on('data', d => { raw += d; });
        res.on('end', () => { let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { body = { error: raw.slice(0, 300) }; } if (res.statusCode >= 400) reject(Object.assign(new Error(body.error || `The sandbox broker answered ${res.statusCode}.`), { status: res.statusCode })); else resolve(body); });
        res.on('error', reject);
      });
      req.setTimeout(timeoutMs, () => req.destroy(new Error('The sandbox broker did not answer in time.')));
      req.on('error', error => reject(error.code === 'ENOENT' || error.code === 'ECONNREFUSED' ? Object.assign(new Error('The sandbox service is not running on this server.'), { status: 503 }) : error));
      if (json !== undefined) req.end(JSON.stringify(json));
      else if (lines) (async () => { try { for await (const line of lines) { if (!req.write(line)) await new Promise(r => req.once('drain', r)); } req.end(); } catch (error) { req.destroy(error); } })();
      else req.end();
    });
  }
  base(office, task) { return `/v1/sandboxes/${encodeURIComponent(office)}/${encodeURIComponent(task)}`; }
  health() { return this.request('GET', '/v1/health', { timeoutMs: 20000 }); }
  sandboxes() { return this.request('GET', '/v1/sandboxes', { timeoutMs: 30000 }).then(r => r.sandboxes || []); }
  ensure(office, task) { return this.request('PUT', this.base(office, task), { timeoutMs: 180000 }); }
  push(office, task, lines) { return this.request('POST', this.base(office, task) + '/push', { lines, timeoutMs: 360000 }); }
  exec(office, task, body) { return this.request('POST', this.base(office, task) + '/exec', { json: body, timeoutMs: (Number(body.timeoutSeconds) || 300) * 1000 + 120000 }); }
  files(office, task) { return this.request('GET', this.base(office, task) + '/files', { timeoutMs: 180000 }); }
  pull(office, task, paths, onLine) { return this.request('POST', this.base(office, task) + '/pull', { json: { paths }, onLine, timeoutMs: 360000 }); }
  install(office, task, body) { return this.request('POST', this.base(office, task) + '/install', { json: body, timeoutMs: (LIMITS.installSeconds + 120) * 1000 }); }
  destroy(office, task) { return this.request('DELETE', this.base(office, task), { timeoutMs: 120000 }); }
}

/* ---------- a broker in memory, for tests ---------- */
// `run({ command, box, timeoutSeconds })` plays the command: `box.write(path, text)`, `box.read(path)`, `box.remove(path)`,
// `box.special(path, kind)` (a link or pipe the copy must refuse); it returns { exitCode, stdout, stderr, timedOut? }.
export class FakeBroker {
  constructor({ run = () => ({ exitCode: 0, stdout: '', stderr: '' }), healthy = true, reason = '', install = null } = {}) {
    Object.assign(this, { runner: run, healthy, reason, installer: install }); this.boxes = new Map(); this.calls = []; this.clock = 1000;
  }
  installed() { return true; }
  key(office, task) { return `${office}/${task}`; }
  box(office, task) { const b = this.boxes.get(this.key(office, task)); if (!b) throw Object.assign(new Error('The sandbox is not running; start it first.'), { status: 409 }); return b; }
  async health() { this.calls.push(['health']); return { ok: this.healthy, reason: this.reason, image: 'fake', imagePresent: this.healthy, sandboxes: this.boxes.size }; }
  async sandboxes() { return [...this.boxes.values()].map(b => ({ office: b.office, task: b.task, name: `ao-${b.office}-${b.task}`, lastUsedAt: b.lastUsed })); }
  async ensure(office, task) {
    this.calls.push(['ensure', task]); const key = this.key(office, task);
    if (this.boxes.has(key)) return { created: false };
    const files = new Map(), specials = new Map(), fake = this;
    this.boxes.set(key, { office, task, files, specials, deps: [], lastUsed: Date.now(),
      write(p, content) { files.set(p, { data: Buffer.from(content), mtime: ++fake.clock }); specials.delete(p); },
      read(p) { return files.get(p)?.data.toString(); }, remove(p) { files.delete(p); specials.delete(p); },
      special(p, kind = 'link') { files.delete(p); specials.set(p, kind); } });
    return { created: true };
  }
  async push(office, task, lines) {
    const b = this.box(office, task), written = [], deleted = [], skipped = [];
    let text = ''; for await (const line of lines) text += line;
    for (const line of text.split('\n').filter(Boolean)) {
      const e = JSON.parse(line), p = safeRelative(e.path); if (!p) { skipped.push({ p: e.path, why: 'not a plain path inside /work' }); continue; }
      if (e.op === 'del') { if (b.files.delete(p)) deleted.push(p); continue; }
      b.write(p, Buffer.from(e.data, 'base64')); const f = b.files.get(p); written.push({ p, s: f.data.length, m: f.mtime });
    }
    this.calls.push(['push', task, written.map(w => w.p), deleted]); return { written, deleted, skipped };
  }
  async exec(office, task, { command, timeoutSeconds }) {
    const b = this.box(office, task); this.calls.push(['exec', task, command, timeoutSeconds]);
    const r = await this.runner({ command, box: b, timeoutSeconds }) || {};
    return { exitCode: r.exitCode ?? 0, timedOut: !!r.timedOut, stopped: r.stopped || '', durationMs: r.durationMs ?? 1200, seconds: timeoutSeconds, stdout: r.stdout || '', stderr: r.stderr || '' };
  }
  async files(office, task) {
    const b = this.box(office, task);
    return { files: [...b.files].filter(([p]) => !inSkippedDir(p)).map(([p, f]) => ({ p, s: f.data.length, m: f.mtime })), skipped: [...b.specials].map(([p, t]) => ({ p, t })), truncated: false };
  }
  async pull(office, task, paths, onLine) {
    const b = this.box(office, task); this.calls.push(['pull', task, paths]);
    for (const p of paths) { const f = b.files.get(p); if (!f) onLine({ path: p, skipped: 'gone' }); else if (f.data.length > LIMITS.fileBytes) onLine({ path: p, skipped: 'over the size a file may have', size: f.data.length }); else onLine({ path: p, size: f.data.length, mtime: f.mtime, data: f.data.toString('base64') }); }
    return {};
  }
  async install(office, task, { manager, packages }) {
    const b = this.box(office, task), checked = validPackages(manager, packages); if (checked.error) throw Object.assign(new Error(checked.error), { status: 400 });
    this.calls.push(['install', task, manager, checked.packages]); b.deps.push(...checked.packages);
    return this.installer ? this.installer({ manager, packages: checked.packages }) : { exitCode: 0, durationMs: 900, packages: checked.packages, output: `Successfully installed ${checked.packages.join(' ')}` };
  }
  async destroy(office, task) { this.calls.push(['destroy', task]); return { removed: this.boxes.delete(this.key(office, task)) }; }
}

/* ---------- the workspace side of the copy ---------- */
// The plain files of a workspace: path → { size, mtimeMs, key }. Links, pipes and anything else are left out, as are the folders
// that never travel (dependencies, caches, version control).
export function scanWorkspace(dir, { limit = 20000 } = {}) {
  const root = path.resolve(dir), out = new Map();
  if (!fs.existsSync(root)) return out;
  const walk = (abs, rel) => {
    let entries = []; try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (out.size >= limit) return;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name, childAbs = path.join(abs, entry.name);
      let st; try { st = fs.lstatSync(childAbs); } catch { continue; }
      if (st.isDirectory()) { if (!SKIP_DIRS.includes(entry.name)) walk(childAbs, childRel); }
      else if (st.isFile() && safeRelative(childRel) && !/\.sandbox\.tmp$/.test(entry.name)) out.set(childRel, { size: st.size, mtimeMs: st.mtimeMs, key: `${st.size}:${st.mtimeMs}` });
    }
  };
  walk(root, '');
  return out;
}
// The key of a plain file at a plain path, or null.
function plainFile(root, rel) {
  const parts = rel.split('/'); let cur = root;
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    let st; try { st = fs.lstatSync(cur); } catch { return null; }
    if (i === parts.length - 1) return st.isFile() ? { abs: cur, key: `${st.size}:${st.mtimeMs}`, size: st.size } : null;
    if (!st.isDirectory()) return null;
  }
  return null;
}
// Write one file coming back from a sandbox: plain folders only on the way (made as needed), never through a link, never over a
// folder or a special file, atomically (a hidden temporary file renamed into place).
export function writeBack(dir, rel, data) {
  const p = safeRelative(rel); if (!p || inSkippedDir(p)) return { error: 'not a plain path inside /work' };
  const root = path.resolve(dir); fs.mkdirSync(root, { recursive: true });
  const parts = p.split('/'); let cur = root;
  for (const part of parts.slice(0, -1)) {
    cur = path.join(cur, part); let st = null; try { st = fs.lstatSync(cur); } catch {}
    if (!st) { fs.mkdirSync(cur); continue; }
    if (!st.isDirectory()) return { error: 'a folder on its path is not a plain folder' };
  }
  const dest = path.join(root, ...parts);
  let existing = null; try { existing = fs.lstatSync(dest); } catch {}
  if (existing && existing.isDirectory()) return { error: 'a folder in /work/ has that name' };
  if (existing && !existing.isFile()) return { error: 'the name in /work/ is taken by a link or a special file' };
  const temp = path.join(path.dirname(dest), `.${path.basename(dest).slice(0, 180)}.${process.pid}.${Date.now()}.sandbox.tmp`);
  fs.writeFileSync(temp, data, { flag: 'wx', mode: 0o640 });
  try { fs.renameSync(temp, dest); } catch (error) { fs.rmSync(temp, { force: true }); return { error: error.message }; }
  const st = fs.lstatSync(dest); return { key: `${st.size}:${st.mtimeMs}`, size: st.size };
}

/* ---------- one sandbox per task ---------- */
export class TaskSandboxes {
  constructor({ client, office, workspaceDir, settings = () => ({}), allowed = () => true, event = () => {}, record = () => {}, exists = () => true, now = () => Date.now(), log = line => console.warn(line) }) {
    Object.assign(this, { client, office, workspaceDir, settings, allowed, event, record, exists, now, log });
    this.tasks = new Map(); this.locks = new Map(); this.health = null; this.healthAt = 0;
  }
  // Whether agents are offered the tools, and if not, the sentence that says why.
  async status({ fresh = false } = {}) {
    const s = this.settings() || {};
    if (!this.client?.installed?.()) return { available: false, reason: 'The sandbox service is not installed on this server.' };
    if (!this.allowed()) return { available: false, reason: 'The platform administrator has not allowed sandboxes on this platform.' };
    if (s.sandbox === false) return { available: false, reason: 'Sandboxes are switched off in Settings → Office.' };
    if (fresh || !this.health || this.now() - this.healthAt > 60000) {
      try { this.health = await this.client.health(); } catch (error) { this.health = { ok: false, reason: error.message }; }
      this.healthAt = this.now();
    }
    return { available: !!this.health.ok, reason: this.health.ok ? '' : this.health.reason || 'The sandbox service does not answer.', ...this.health };
  }
  async ready() { return (await this.status()).available; }
  running() { return [...this.tasks].map(([task, st]) => ({ task, startedAt: st.startedAt, lastUsedAt: st.lastUsed })); }
  stateOf(task) { let st = this.tasks.get(task); if (!st) { st = { synced: new Map(), startedAt: 0, lastUsed: this.now() }; this.tasks.set(task, st); } return st; }
  // One thing at a time per task: a copy, a command and the copy back belong together.
  lock(task, fn) { const run = (this.locks.get(task) || Promise.resolve()).catch(() => {}).then(fn); const settled = run.catch(() => {}); this.locks.set(task, settled); settled.then(() => { if (this.locks.get(task) === settled) this.locks.delete(task); }); return run; }
  refusal(error, what) { return `${what}: ${String(error?.message || error).slice(0, 400)}${error?.status === 429 ? '' : error?.status === 503 ? ' Carry on without the sandbox and say in your report that the command could not run.' : ''}`; }
  async start(task, agent) {
    const { created } = await this.client.ensure(this.office, task), st = this.stateOf(task);
    if (created || !st.startedAt) {
      if (created) st.synced.clear();
      st.startedAt = this.now();
      if (created) { this.event(task, 'sandbox_started', agent, 'Sandbox started: a Linux container for this task with no internet, 1 GB of memory and 1 CPU. /work/ is copied in before each command and results come back after it.'); this.record(task, j => { j.sandbox = { ...(j.sandbox || {}), startedAt: this.now() }; }); }
    }
    return st;
  }
  // Send the workspace's plain files that changed since the last copy, and delete in the sandbox what was deleted here.
  async copyIn(task, st) {
    const dir = this.workspaceDir(task), ws = scanWorkspace(dir), dels = [], sending = [], notSent = [];
    let bytes = 0;
    for (const [p, f] of ws) {
      if (st.synced.get(p)?.ws === f.key) continue;
      if (f.size > LIMITS.fileBytes || bytes + f.size > LIMITS.copyBytes) { notSent.push(`${p} (${sizeText(f.size)})`); continue; }
      bytes += f.size; sending.push(p);
    }
    for (const p of st.synced.keys()) if (!ws.has(p)) dels.push(p);
    if (!sending.length && !dels.length) return { notSent };
    const root = path.resolve(dir);
    async function* lines() {
      for (const p of dels) yield JSON.stringify({ op: 'del', path: p }) + '\n';
      for (const p of sending) { const f = plainFile(root, p); if (!f) continue; let data; try { data = fs.readFileSync(f.abs); } catch { continue; } yield JSON.stringify({ op: 'put', path: p, data: data.toString('base64') }) + '\n'; }
    }
    const pushed = await this.client.push(this.office, task, lines());
    for (const w of pushed.written || []) st.synced.set(w.p, { ws: ws.get(w.p)?.key, sb: `${w.s}:${w.m}` });
    for (const p of dels) st.synced.delete(p);
    return { notSent, sent: (pushed.written || []).length };
  }
  // Bring back what the command made or changed, and remove here what it deleted (when the file here is still the copy it had).
  async copyOut(task, st) {
    const dir = this.workspaceDir(task), listing = await this.client.files(this.office, task);
    const now = new Map((listing.files || []).map(f => [f.p, `${f.s}:${f.m}`]));
    const changed = [...now].filter(([p, key]) => st.synced.get(p)?.sb !== key && safeRelative(p) && !inSkippedDir(p)).map(([p]) => p);
    const back = [], skipped = (listing.skipped || []).filter(s => !inSkippedDir(s.p)).map(s => `${s.p} (${KIND[s.t] || KIND.other})`), removed = [];
    const wanted = changed.slice(0, LIMITS.copyFiles);
    if (changed.length > wanted.length) skipped.push(`${plural(changed.length - wanted.length, 'more file')} (only ${LIMITS.copyFiles.toLocaleString('en')} come back per command)`);
    let pullError = '';
    if (wanted.length) await this.client.pull(this.office, task, wanted, entry => {
      if (entry.error) { pullError = entry.error; return; }
      if (entry.skipped) { skipped.push(`${entry.path} (${entry.skipped}${entry.size ? ', ' + sizeText(entry.size) : ''})`); return; }
      let data; try { data = Buffer.from(String(entry.data || ''), 'base64'); } catch { skipped.push(`${entry.path} (unreadable)`); return; }
      if (data.length !== entry.size) { skipped.push(`${entry.path} (arrived incomplete)`); return; }
      const w = writeBack(dir, entry.path, data);
      if (w.error) { skipped.push(`${entry.path} (${w.error})`); return; }
      back.push({ path: entry.path, size: w.size }); st.synced.set(entry.path, { ws: w.key, sb: `${entry.size}:${entry.mtime}` });
    });
    const root = path.resolve(dir);
    for (const [p, s] of [...st.synced]) {
      if (now.has(p)) continue;
      const here = plainFile(root, p);
      if (here && here.key === s.ws) { try { fs.unlinkSync(here.abs); removed.push(p); } catch {} }
      st.synced.delete(p);
    }
    return { back, skipped, removed, pullError, truncated: !!listing.truncated };
  }
  async run(task, { command, minutes, agent = null } = {}) {
    const bad = validCommand(command); if (bad) return `Refused: ${bad}`;
    return this.lock(task, async () => {
      let st;
      try { st = await this.start(task, agent); } catch (error) { return this.refusal(error, 'The sandbox could not start'); }
      let copied;
      try { copied = await this.copyIn(task, st); } catch (error) { return this.refusal(error, 'Copying /work/ into the sandbox failed'); }
      const seconds = commandSeconds(minutes ?? this.settings()?.sandboxCommandMinutes);
      let r;
      try { r = await this.client.exec(this.office, task, { command, timeoutSeconds: seconds }); } catch (error) { st.lastUsed = this.now(); return this.refusal(error, 'The command did not run'); }
      let out;
      try { out = await this.copyOut(task, st); } catch (error) { out = { back: [], skipped: [], removed: [], pullError: error.message }; }
      st.lastUsed = this.now();
      const secs = Math.round((r.durationMs || 0) / 100) / 10;
      this.record(task, j => { const s = j.sandbox = { ...(j.sandbox || {}) }; s.runs = (s.runs || 0) + 1; s.seconds = Math.round(((s.seconds || 0) + secs) * 10) / 10; s.lastUsedAt = this.now(); s.startedAt ||= st.startedAt; });
      this.event(task, 'sandbox_command', agent, `Sandbox: ${r.timedOut ? `stopped at ${Math.round(seconds / 60)} min` : r.stopped ? 'stopped' : `exit ${r.exitCode}`} in ${secs} s · ${command.replace(/\s+/g, ' ').slice(0, 140)}${out.back.length ? ` · ${plural(out.back.length, 'file')} back to /work/` : ''}`);
      const lines = [`$ ${command.length > 300 ? command.slice(0, 300) + '…' : command}`];
      lines.push(r.timedOut ? `Stopped after ${Math.round(seconds / 60)} minute${seconds === 60 ? '' : 's'}: the command ran past its time limit (ask for up to ${LIMITS.commandMinutesMax} with timeout_minutes, or make it faster).` : r.stopped ? `Stopped: ${r.stopped}.` : `Exit code ${r.exitCode} in ${secs} s.`);
      if (r.leftover) lines.push(`It left ${plural(r.leftover, 'process')} running in the background; ${r.leftover === 1 ? 'it was' : 'they were'} stopped when the command ended (background processes never outlive their command: start a server and run its tests in the same command).`);
      if (out.back.length) lines.push(`Copied back to /work/: ${out.back.slice(0, 30).map(f => `${f.path} (${sizeText(f.size)})`).join(', ')}${out.back.length > 30 ? ` and ${out.back.length - 30} more` : ''}.`);
      if (out.removed.length) lines.push(`Removed from /work/ because the command deleted them: ${out.removed.slice(0, 20).join(', ')}.`);
      if (out.skipped.length) lines.push(`Not copied back: ${out.skipped.slice(0, 20).join(', ')}${out.skipped.length > 20 ? ` and ${out.skipped.length - 20} more` : ''}. Only plain files come back.`);
      if (copied.notSent?.length) lines.push(`Not copied into the sandbox (over ${sizeText(LIMITS.fileBytes)}, or past ${sizeText(LIMITS.copyBytes)} in all): ${copied.notSent.slice(0, 10).join(', ')}.`);
      if (out.pullError) lines.push(`Copying files back failed: ${out.pullError}`);
      const stdout = String(r.stdout || '').trim(), stderr = String(r.stderr || '').trim();
      lines.push(stdout ? `Output${r.stdoutCut ? ` (the last ${LIMITS.outputChars.toLocaleString('en')} characters)` : ''}:\n${stdout}` : 'No output.');
      if (stderr) lines.push(`Errors${r.stderrCut ? ` (the last ${LIMITS.outputChars.toLocaleString('en')} characters)` : ''}:\n${stderr}`);
      if (/Temporary failure in name resolution|Network is unreachable|getaddrinfo|ENOTFOUND|EAI_AGAIN|Could not resolve host|No matching distribution found|ECONNREFUSED/i.test(stdout + stderr)) lines.push('The sandbox has no internet. For a package it lacks, call sandbox_install; for data from the web, fetch it with your web tools and save it under /work/ first.');
      return lines.join('\n');
    });
  }
  async install(task, { manager, packages, agent = null } = {}) {
    const checked = validPackages(manager, packages); if (checked.error) return `Refused: ${checked.error}`;
    return this.lock(task, async () => {
      let st;
      try { st = await this.start(task, agent); } catch (error) { return this.refusal(error, 'The sandbox could not start'); }
      let r;
      try { r = await this.client.install(this.office, task, { manager, packages: checked.packages }); } catch (error) { return this.refusal(error, 'The install did not run'); }
      st.lastUsed = this.now();
      const ok = r.exitCode === 0;
      this.record(task, j => { const s = j.sandbox = { ...(j.sandbox || {}) }; s.installs = (s.installs || 0) + 1; s.lastUsedAt = this.now(); });
      this.event(task, 'sandbox_install', agent, `Sandbox install with ${manager}: ${checked.packages.join(', ').slice(0, 200)} → ${ok ? 'installed' : `failed (exit ${r.exitCode})`}`);
      if (ok) return `Installed with ${manager} into this task's sandbox: ${checked.packages.join(', ')}. The next sandbox_run can use ${manager === 'pip' ? 'them (they are on PYTHONPATH)' : 'them (they are on NODE_PATH; binaries on PATH)'}.\n${String(r.output || '').trim().split('\n').slice(-5).join('\n')}`;
      return `The install failed (exit code ${r.exitCode}${r.exitCode === 124 ? ': it ran past its time limit' : ''}). ${manager === 'pip' ? 'pip installs ready-built wheels only; if a package needs building from source, pick a version that has a wheel for Python 3.12 on Linux.' : 'npm runs no install scripts; a package that needs one cannot be installed here.'}\n${String(r.output || '').trim().slice(-3000)}`;
    });
  }
  async destroy(task, reason, { quiet = false } = {}) {
    return this.lock(task, async () => {
      const known = this.tasks.delete(task);
      let removed = false;
      try { removed = !!(await this.client.destroy(this.office, task)).removed; } catch (error) { if (known) this.log(`sandbox: removing the sandbox of ${task} failed: ${error.message}`); return false; }
      if ((removed || known) && !quiet && this.exists(task)) this.event(task, 'sandbox_removed', null, `Sandbox removed: ${reason}.`);
      return removed || known;
    });
  }
  // The minute clock: a sandbox idle past the office's limit is removed (its files are already in /work/), and so is one whose task closed.
  async sweep(isOpen) {
    const idleMs = Math.max(5, Number(this.settings()?.sandboxIdleMinutes) || 20) * 60000, done = [];
    for (const [task, st] of [...this.tasks]) {
      if (this.locks.has(task)) continue;
      if (!isOpen(task)) { await this.destroy(task, 'the task is closed'); done.push(task); }
      else if (this.now() - st.lastUsed > idleMs) { await this.destroy(task, `idle for ${Math.round(idleMs / 60000)} minutes; the next command starts a fresh one from /work/`); done.push(task); }
    }
    return done;
  }
  // At start: every sandbox of this office whose task is not open any more is removed.
  async reap(isOpen) {
    if (!this.client?.installed?.()) return [];
    let all = []; try { all = await this.client.sandboxes(); } catch { return []; }
    const gone = all.filter(s => s.office === this.office && !isOpen(s.task));
    for (const s of gone) await this.destroy(s.task, 'the task was closed while the office was down', { quiet: !this.exists(s.task) });
    return gone.map(s => s.task);
  }
}

/* ---------- the tools ---------- */
export function sandboxTools({ sandboxes, jobId, agentId, commandMinutes = LIMITS.commandMinutesDefault, install = true }) {
  const run = tool(async ({ command, timeout_minutes }) => sandboxes.run(jobId, { command, minutes: timeout_minutes, agent: agentId }), {
    name: 'sandbox_run',
    description: `Run one shell command (bash, in /work) in this task's own sandbox: a throwaway Linux container with Python 3.12 (pandas, numpy, scipy, matplotlib, simpy, python-pptx, python-docx, openpyxl, reportlab, pytest), Node 22 with npm, git and build tools, and no internet. The office copies /work/ in before the command and copies new and changed files back to /work/ after it (plain files only; node_modules, __pycache__ and .git stay in the sandbox). Write a script to a file under /work/ first, then run it, for example: python3 analysis/build_deck.py. Returns the exit code, the files copied back and the last ${LIMITS.outputChars.toLocaleString('en')} characters of output and errors. A command stops after ${commandMinutes} minutes unless you ask for more (at most ${LIMITS.commandMinutesMax}), and background processes stop when their command ends. The sandbox is deleted when the task is delivered: what matters must be in /work/.`,
    schema: z.object({ command: z.string().describe('One shell command, run with bash in /work, e.g. "python3 build_deck.py" or "cd app && npm test"'), timeout_minutes: z.number().min(1).max(LIMITS.commandMinutesMax).optional().describe(`Minutes before the command is stopped (default ${commandMinutes}, at most ${LIMITS.commandMinutesMax})`) }),
  });
  if (!install) return [run];
  const add = tool(async ({ manager, packages }) => sandboxes.install(jobId, { manager, packages, agent: agentId }), {
    name: 'sandbox_install',
    description: `Install packages the sandbox lacks into this task's sandbox, from PyPI (pip) or npm; the next sandbox_run can use them. Plain names with optional versions only (python-dateutil==2.8.2, @scope/name@1.0.0), at most ${LIMITS.packages}. pip takes ready-built wheels only and npm runs no install scripts. This reaches the internet, so it pauses for the CEO's approval first; install once, with everything you need, before running your code. Check first whether the image already has it (see sandbox_run).`,
    schema: z.object({ manager: z.enum(['pip', 'npm']).describe('pip for Python packages, npm for Node packages'), packages: z.array(z.string()).min(1).max(LIMITS.packages).describe('Package names with optional versions'), why: z.string().optional().describe('One sentence the CEO reads before approving: what the packages are for') }),
  });
  return [run, add];
}
