import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createClaudeAuth, createOfficeAccess, sameOrigin } from '../auth.mjs';

const req = headers => ({ headers });
test('office access requires a valid, signed session and rejects modified cookies', () => {
  const access = createOfficeAccess('test-office-secret');
  assert.equal(access.allowed(req({})), false);
  assert.equal(access.matches('wrong'), false);
  assert.equal(access.matches('test-office-secret'), true);
  const cookie = access.cookie(true);
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  assert.match(cookie, /; Secure$/);
  assert.equal(access.allowed(req({ cookie })), true);
  assert.equal(access.allowed(req({ cookie: cookie.replace('ao_session=', 'ao_session=0') })), false);
  assert.equal(access.allowed(req({ cookie: 'ao_session=9999999999999.forged' })), false);
  assert.equal(createOfficeAccess('different').allowed(req({ cookie })), false);
});
test('same-origin checks reject cross-site mutations and malformed origins', () => {
  assert.equal(sameOrigin(req({ host: 'office.test:8443', origin: 'https://office.test:8443' })), true);
  assert.equal(sameOrigin(req({ host: 'office.test:8443', origin: 'https://other.test' })), false);
  assert.equal(sameOrigin(req({ host: 'office.test', origin: 'null' })), false);
  assert.equal(sameOrigin(req({ 'sec-fetch-site': 'cross-site' })), false);
});
function fixture(options = {}) {
  let child, authenticated = false, changed = 0;
  const commands = [];
  const auth = createClaudeAuth({ cwd: '/tmp', env: {}, ...options,
    spawnProcess(command, args) {
      commands.push([command, args]);
      child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
      child.kill = () => { child.emit('close', null); return true; };
      return child;
    },
    async execCommand(command, args) {
      commands.push([command, args]);
      if (args.includes('logout')) authenticated = false;
      return { stdout: JSON.stringify({ loggedIn: authenticated, authMethod: authenticated ? 'claude.ai' : 'none', secret: 'NEVER-EXPOSE-THIS' }) };
    },
    onChange: async () => { changed++; },
  });
  return { auth, commands, get child() { return child; }, get changed() { return changed; }, complete() { authenticated = true; child.emit('close', 0); } };
}
const url = 'https://claude.com/cai/oauth/authorize?state=fixture&code_challenge=challenge';
const flush = () => new Promise(resolve => setImmediate(resolve));
test('Claude login uses the official CLI, accepts fragmented URLs, and never exposes CLI output', async () => {
  const f = fixture();
  const login = f.auth.start();
  assert.equal(login.state, 'starting');
  assert.deepEqual(f.commands[0], ['claude', ['auth', 'login', '--claudeai']]);
  f.child.stdout.write('NEVER-EXPOSE-THIS\nOpen https://claude.com/cai/oauth/');
  f.child.stdout.write('authorize?state=fixture&code_challenge=challenge\nPaste code here > ');
  assert.equal(f.auth.snapshot().url, url);
  assert.equal(f.auth.snapshot().state, 'waiting');
  assert.equal(JSON.stringify(f.auth.snapshot()).includes('NEVER-EXPOSE-THIS'), false);
  let sent = ''; f.child.stdin.on('data', value => { sent += value; });
  assert.throws(() => f.auth.submit('wrong-id', 'code'), /no longer active/);
  assert.throws(() => f.auth.submit(login.id, 'code\nextra'), /single sign-in code/);
  assert.throws(() => f.auth.submit(login.id, 'a'.repeat(4097)), /single sign-in code/);
  f.auth.submit(login.id, 'approved#state');
  assert.equal(sent, 'approved#state\n');
  assert.equal(f.auth.snapshot().state, 'verifying');
  f.complete(); await flush();
  assert.equal(f.auth.snapshot().state, 'connected');
  assert.equal((await f.auth.status()).authenticated, true);
  assert.equal(JSON.stringify(await f.auth.status()).includes('NEVER-EXPOSE-THIS'), false);
  assert.equal(f.changed, 1);
  await f.auth.logout();
  assert.equal((await f.auth.status()).authenticated, false);
});
test('untrusted URLs are ignored, cancellation kills login and invalidates codes', () => {
  const f = fixture(); const login = f.auth.start();
  f.child.stdout.write('https://evil.test/oauth/authorize?state=x\n');
  assert.equal(f.auth.snapshot().url, null);
  f.child.stdout.write(url + '\n');
  f.auth.stop();
  assert.equal(f.auth.snapshot().state, 'cancelled');
  assert.equal(f.auth.snapshot().url, null);
  assert.throws(() => f.auth.submit(login.id, 'code'), /no longer active/);
});
test('failed login does not claim authentication or expose sensitive error output', () => {
  const f = fixture(); f.auth.start();
  f.child.stderr.write('secret=NEVER-EXPOSE-THIS'); f.child.emit('close', 1);
  assert.equal(f.auth.snapshot().state, 'error');
  assert.equal(JSON.stringify(f.auth.snapshot()).includes('NEVER-EXPOSE-THIS'), false);
});
test('login expires instead of leaving a background process running', async () => {
  const f = fixture({ timeout: 15 }); f.auth.start();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(f.auth.snapshot().state, 'expired');
});
