// The SSH connector: an agent runs one command on a target the CEO put in the Vault, through the office, with the office's key
// or password, and always after the CEO's approval. Ported from the Bayanatkom DB Intelligence module's model: a deny list nobody
// gets past, an optional allow list of command prefixes per target, one command per call, capped output, a hard time limit.
// ssh2 is an optional dependency loaded on first use.
import { createHash } from 'node:crypto';

export const MAX_COMMAND_CHARS = 2000, MAX_OUTPUT_CHARS = 50 * 1024, DEFAULT_COMMAND_TIMEOUT_MS = 60000;
const plain = message => Object.assign(new Error(String(message?.message || message || 'Unknown error').slice(0, 400)), { plain: true });
const missingPackage = error => ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error?.code) || /cannot find (package|module)/i.test(String(error?.message || ''));

// Refused whatever the target allows and whatever the CEO answers.
export const DENY = [
  [/\brm\s+(?:-{1,2}[\w-]+\s+)*\/+\*?(?:\s|$)/i, 'rm on the root directory'],
  [/\bmkfs(?:\.\w+)?\b/i, 'mkfs'],
  [/\bdd\s+(?:\S+\s+)*if=/i, 'dd if='],
  [/\b(?:shutdown|reboot|halt|poweroff)\b/i, 'shutdown, reboot, halt or poweroff'],
  [/\binit\s+[06]\b/, 'init 0 or init 6'],
  [/:\(\)\s*\{/, 'a fork bomb'],
  [/>\s*\/dev\/(?:sd|nvme|hd|vd|xvd|mmcblk)/i, 'writing to a disk device'],
  [/\bchmod\b[^\n]*\b777\b[^\n]*\s\/+\*?(?:\s|$)/i, 'chmod 777 on the root directory'],
  [/\bwipefs\b/i, 'wipefs'],
];
const CHAIN = /[;&|`$<>]/;

// One command, on one line, not on the deny list; when the entry carries `allow` (command prefixes such as "git pull" or
// "systemctl status"), only a command that starts with one of them passes, and it may not chain or redirect.
export function validateCommand(command, entry = {}) {
  const text = String(command ?? '').trim();
  if (!text) return { ok: false, command: '', reason: 'Refused: the command is empty.' };
  if (text.length > MAX_COMMAND_CHARS) return { ok: false, command: '', reason: `Refused: the command is longer than ${MAX_COMMAND_CHARS} characters.` };
  if (/[\r\n]/.test(text)) return { ok: false, command: '', reason: 'Refused: one command per call, on one line; run a script that is already on the machine instead.' };
  for (const [pattern, what] of DENY) if (pattern.test(text)) return { ok: false, command: '', reason: `Refused: ${what} is never run by an agent. If it is needed, say so in your report; the CEO does it.` };
  const allow = (Array.isArray(entry?.allow) ? entry.allow : []).map(a => String(a ?? '').trim()).filter(Boolean);
  if (allow.length) {
    if (CHAIN.test(text)) return { ok: false, command: '', reason: `Refused: this target only runs the commands the CEO listed (${allow.join(', ')}), one at a time, without ; & | \` $ < or >.` };
    if (!allow.some(p => text === p || text.startsWith(p.endsWith(' ') ? p : p + ' '))) return { ok: false, command: '', reason: `Refused: this target only runs commands that start with: ${allow.join(' · ')}. Anything else must be asked of the CEO in your report.` };
  }
  return { ok: true, command: text, reason: '' };
}

export const fingerprintOf = key => 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');

// Runs one command over ssh2 and returns { code, stdout, stderr, ms, timedOut, truncated }; stdout and stderr are cut at 50 KB.
// A private key (a secret that starts with -----BEGIN) or a password from the Vault entry; an entry may pin the host key's
// fingerprint (SHA256:…) and then a host whose key differs is refused. `loader` imports ssh2 (tests inject a fake).
export class SshRunner {
  constructor({ loader = () => import('ssh2'), connectTimeoutMs = 15000 } = {}) { this.loader = loader; this.connectTimeoutMs = connectTimeoutMs; }
  async client() {
    let mod; try { mod = await this.loader(); } catch (error) { throw missingPackage(error) ? plain('install ssh2 to use SSH targets') : plain(error); }
    const Client = mod?.Client || mod?.default?.Client; if (typeof Client !== 'function') throw plain('install ssh2 to use SSH targets');
    return Client;
  }
  async run(entry, command, { timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS } = {}) {
    if (!entry?.host) throw plain('The SSH entry has no host.');
    if (!entry.secret) throw plain(`The Vault entry "${entry.id}" has no key or password yet.`);
    const Client = await this.client(), secret = String(entry.secret), byKey = /^-----BEGIN /.test(secret.trim());
    const limit = Math.max(50, Number(timeoutMs) || DEFAULT_COMMAND_TIMEOUT_MS);
    return new Promise((resolve, reject) => {
      const conn = new Client(), started = Date.now(); let out = '', err = '', cut = false, settled = false;
      // Each stream keeps its first 50 KB; the rest is dropped and the answer says so.
      const add = (which, chunk) => {
        const text = String(chunk), room = MAX_OUTPUT_CHARS - (which === 'out' ? out : err).length;
        if (text.length > room) cut = true;
        if (room <= 0) return;
        if (which === 'out') out += text.slice(0, room); else err += text.slice(0, room);
      };
      const end = fn => { if (settled) return; settled = true; clearTimeout(timer); try { conn.end(); } catch {} fn(); };
      const result = extra => ({ code: null, stdout: out, stderr: err, ms: Date.now() - started, timedOut: false, truncated: cut, ...extra });
      // The stop timer stays referenced: a command that hangs must be cut off even when nothing else keeps the process busy.
      const timer = setTimeout(() => end(() => resolve(result({ stderr: (err + `\nThe command was stopped after ${Math.round(limit / 1000)} s.`).trim(), timedOut: true }))), limit);
      conn.on('ready', () => conn.exec(command, (error, stream) => {
        if (error) return end(() => reject(plain(error)));
        stream.on('data', d => add('out', d)); stream.stderr?.on('data', d => add('err', d));
        stream.on('close', (code, signal) => end(() => resolve(result({ code: typeof code === 'number' ? code : null, signal: signal || null }))));
        stream.on('error', e => end(() => reject(plain(e))));
      }));
      conn.on('error', e => end(() => reject(plain(e))));
      if (!byKey) conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => finish(prompts.map(() => secret)));
      try {
        conn.connect({ host: entry.host, port: Number(entry.port) || 22, username: entry.username || 'root', readyTimeout: this.connectTimeoutMs, ...(byKey ? { privateKey: secret } : { password: secret, tryKeyboard: true }),
          ...(entry.fingerprint ? { hostVerifier: key => fingerprintOf(key) === String(entry.fingerprint).trim() } : {}) });
      } catch (error) { end(() => reject(plain(error))); }
    });
  }
}
