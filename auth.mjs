// Delegate account authentication and credential storage to the official Claude CLI.
import { spawn, execFile } from 'node:child_process';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const same = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
};

export function createOfficeAccess(key = '') {
  const signature = value => createHmac('sha256', key).update(value).digest('hex');
  return {
    required: !!key,
    matches: candidate => !!key && same(candidate, key),
    cookie(secure = false) {
      const expires = String(Date.now() + 7 * 86400000);
      return `ao_session=${expires}.${signature(expires)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure ? '; Secure' : ''}`;
    },
    allowed(req) {
      if (!key) return true;
      const value = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('ao_session='))?.slice(11) || '';
      const [expires, sig] = value.split('.');
      return /^\d+$/.test(expires || '') && +expires > Date.now() && same(signature(expires), sig);
    },
  };
}

export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return req.headers['sec-fetch-site'] !== 'cross-site';
  try { return new URL(origin).host === req.headers.host && ['http:', 'https:'].includes(new URL(origin).protocol); }
  catch { return false; }
}

export function createClaudeAuth({ cwd, env = process.env, onChange = async () => {}, spawnProcess = spawn, execCommand = exec, timeout = 600000,
  loginArgs = ['auth', 'login', '--claudeai'], logoutArgs = ['auth', 'logout'], statusReader, authorizeURL } = {}) {
  const cliEnv = { ...env };
  delete cliEnv.CLAUDECODE;
  let cached = null, cachedAt = 0, checking = null, session = null;
  const options = { cwd, env: cliEnv, timeout: 15000, maxBuffer: 65536, encoding: 'utf8' };
  async function status(force = false) {
    if (statusReader) return statusReader(force);
    if (env.ANTHROPIC_API_KEY) return { authenticated: true, method: 'api-key', cliInstalled: true };
    if (!force && cached && Date.now() - cachedAt < 10000) return cached;
    if (checking) return checking;
    checking = (async () => {
      let stdout = '', installed = true;
      try { ({ stdout } = await execCommand('claude', ['auth', 'status', '--json'], options)); }
      catch (e) { stdout = e.stdout || ''; installed = e.code !== 'ENOENT'; }
      let value = {}; try { value = JSON.parse(stdout); } catch {}
      cached = { authenticated: value.loggedIn === true, method: value.authMethod || null, cliInstalled: installed };
      cachedAt = Date.now();
      return cached;
    })().finally(() => { checking = null; });
    return checking;
  }
  function snapshot() {
    return session ? { id: session.id, state: session.state, url: session.url, message: session.message } : { state: 'idle' };
  }
  function stop(state = 'cancelled', message = 'Sign-in cancelled.') {
    if (!session) return;
    clearTimeout(session.timer);
    session.state = state; session.message = message; session.url = null;
    session.child?.kill('SIGTERM');
    session.child = null;
  }
  function start() {
    stop();
    const current = session = { id: randomUUID(), state: 'starting', url: null, message: 'Preparing Claude sign-in.', child: null };
    const child = current.child = spawnProcess('claude', loginArgs, { cwd, env: cliEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const consume = data => {
      if (session !== current || !['starting', 'waiting', 'verifying'].includes(current.state)) return;
      output = (output + data.toString()).slice(-32768).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
      for (const raw of output.match(/https:\/\/[^\s<>"\x1b]+/g) || []) {
        try {
          const url = new URL(raw);
          if (authorizeURL ? !authorizeURL(url) : (!['claude.com', 'claude.ai', 'platform.claude.com', 'console.anthropic.com'].includes(url.hostname) || !url.pathname.includes('oauth') || !url.searchParams.has('state'))) continue;
          current.url = url.href;
          if (current.state === 'starting') { current.state = 'waiting'; current.message = 'Open Claude, approve sign-in, then paste the code here.'; }
        } catch {}
      }
    };
    child.stdout.on('data', consume); child.stderr.on('data', consume);
    child.stdin.on('error', () => {});
    child.on('error', () => {
      if (session !== current) return;
      stop('error', 'Claude sign-in could not start. Check that Claude Code is installed on the server.');
    });
    child.on('close', async code => {
      output = '';
      if (session !== current || !['starting', 'waiting', 'verifying'].includes(current.state)) return;
      clearTimeout(current.timer); current.child = null; current.url = null;
      const auth = code === 0 ? await status(true) : null;
      if (session !== current) return;
      if (auth?.authenticated) {
        current.state = 'connected'; current.message = 'Claude is connected. Your office is ready.';
        try { await onChange(); } catch {}
      } else { current.state = 'error'; current.message = 'Sign-in was not completed. Start again and use the latest code from Claude.'; }
    });
    current.timer = setTimeout(() => {
      if (session === current) stop('expired', 'The sign-in request expired. Start again.');
    }, timeout);
    current.timer.unref?.();
    return snapshot();
  }
  function submit(id, code) {
    if (!session || session.id !== id || session.state !== 'waiting') throw new Error('This sign-in request is no longer active. Start again.');
    if (typeof code !== 'string' || !code.trim() || code.length > 4096 || /[\r\n\x00-\x1f]/.test(code)) throw new Error('Paste the single sign-in code shown by Claude.');
    session.state = 'verifying'; session.message = 'Verifying with Claude…';
    session.child.stdin.write(code.trim() + '\n');
    return snapshot();
  }
  async function logout() {
    if (env.ANTHROPIC_API_KEY) throw new Error('This API key is managed in the server environment. Remove it there to disconnect.');
    stop();
    await execCommand('claude', logoutArgs, options);
    cached = null;
    await onChange();
    return status(true);
  }
  return { status, snapshot, start, submit, stop, logout };
}
