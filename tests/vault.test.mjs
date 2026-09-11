import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VaultStore, VAULT_KINDS } from '../vault.mjs';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';
import { OfficeEngine, VAULT_APPROVALS } from '../engine/deep-agents.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-vault-'));

test('the Vault stores entries by kind, never returns a secret, keeps it when the field is blank, and removes it on request', () => {
  const dir = temp(), vault = new VaultStore({ dataDir: dir });
  assert.deepEqual(VAULT_KINDS, ['api', 'database', 'ssh']);
  assert.throws(() => vault.upsert({ id: 'here.now', kind: 'api', baseURL: 'here.now/api' }), /Base URL must be a full address/);
  assert.throws(() => vault.upsert({ id: 'here.now', kind: 'api', baseURL: 'http://here.now/api/v1' }), /must use HTTPS/);
  const saved = vault.upsert({ id: 'Here.Now', kind: 'api', name: 'here.now', baseURL: 'https://here.now/api/v1/', secret: 'sk-test-1234567890', notes: 'Publishes static sites.' });
  assert.equal(saved.id, 'here.now'); assert.equal(saved.baseURL, 'https://here.now/api/v1'); assert.equal(saved.hasSecret, true); assert.equal('secret' in saved, false);
  assert.equal(saved.authHeader, 'Authorization'); assert.equal(saved.authPrefix, 'Bearer ');
  assert.equal(vault.get('here.now').secret, 'sk-test-1234567890');
  vault.upsert({ id: 'here.now', name: 'here.now hosting', secret: '' });
  assert.equal(vault.get('here.now').secret, 'sk-test-1234567890', 'a blank secret keeps the stored one'); assert.equal(vault.get('here.now').name, 'here.now hosting');
  const db = vault.upsert({ id: 'crm-db', kind: 'database', host: 'db.internal', port: 5432, username: 'reader', database: 'crm', secret: 'pw', teams: ['sales'] });
  assert.equal(db.kind, 'database'); assert.equal(db.engine, 'postgres'); assert.deepEqual(db.teams, ['sales']); assert.equal(db.hasSecret, true);
  const ssh = vault.upsert({ id: 'web-1', kind: 'ssh', host: '10.0.0.5', username: 'deploy', secret: '-----BEGIN KEY-----\nabc\n-----END KEY-----' });
  assert.equal(ssh.port, 22, 'ssh defaults to port 22');
  assert.throws(() => vault.upsert({ id: 'crm-db', kind: 'database', host: '' }), /host/);
  assert.deepEqual(vault.forTeam('sales').map(e => e.id), ['here.now'], 'api entries only, open to every team or naming this one');
  assert.deepEqual(vault.forTeam('sales', 'database').map(e => e.id), ['crm-db']); assert.deepEqual(vault.forTeam('marketing', 'database'), []);
  assert.equal(vault.mask('token sk-test-1234567890 leaked'), 'token [secret] leaked');
  assert.match(fs.readFileSync(path.join(dir, 'vault.json'), 'utf8'), /sk-test-1234567890/, 'stored on disk in the data folder');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'vault.json')).mode & 0o777, 0o600);
  vault.upsert({ id: 'here.now', clearSecret: true }); assert.equal(vault.list().find(e => e.id === 'here.now').hasSecret, false);
  vault.remove('web-1'); assert.equal(vault.get('web-1'), null); assert.throws(() => vault.remove('web-1'), /No such entry/);
  const again = new VaultStore({ dataDir: dir }); assert.deepEqual(again.list().map(e => e.id), ['crm-db', 'here.now'], 'reloaded from disk');
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('agents call an outside service through the office: the key is injected, never shown, and reads are free while writes wait for the CEO', async () => {
  const dir = temp(), vault = new VaultStore({ dataDir: dir });
  vault.upsert({ id: 'here.now', kind: 'api', baseURL: 'https://here.now/api/v1', secret: 'sk-live-abcdefghijklmnop', teams: [] });
  vault.upsert({ id: 'crm', kind: 'api', baseURL: 'https://crm.example/v2', secret: 'crm-key-123456', teams: ['sales'] });
  const office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents });
  const engine = new OfficeEngine({ dataDir: dir, office, models: { resolve: () => ({ model: 'x', effort: '' }), instance: async () => null }, knowledgeDir: path.join(dir, 'knowledge'), vault, settings: () => ({}) });
  const job = engine.create({ dept: 'marketing', text: 'Publish the page.', autoStart: false });
  const [list, get, request, upload] = engine.vaultTools(job.id, office.team('marketing'), 'mlead');
  assert.deepEqual([list.name, get.name, request.name, upload.name], ['vault_list', 'api_get', 'api_request', 'api_upload']);
  assert.deepEqual(Object.keys(VAULT_APPROVALS), ['api_request', 'api_upload', 'db_write', 'ssh_run'], 'the calls that change something outside the office pause for the CEO');
  const listed = await list.invoke({});
  assert.match(listed, /here\.now \(here\.now\) at https:\/\/here\.now\/api\/v1/); assert.ok(!listed.includes('crm'), 'a service limited to Sales is not offered to Marketing'); assert.ok(!listed.includes('sk-live'));
  const calls = []; const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ ok: true, echo: 'sk-live-abcdefghijklmnop' }), { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' } }); };
  try {
    const out = await get.invoke({ service: 'here.now', path: '/publish/my-site' });
    assert.equal(calls[0].url, 'https://here.now/api/v1/publish/my-site'); assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-live-abcdefghijklmnop', 'the office injected the key');
    assert.match(out, /^200 OK/); assert.ok(!out.includes('sk-live'), 'a key echoed back by the service is masked'); assert.ok(out.includes('[secret]'));
    const posted = await request.invoke({ service: 'here.now', method: 'POST', path: '/publish', body: { files: [{ path: 'index.html', size: 12 }] }, headers: { Authorization: 'Bearer forged', 'x-note': 'hi' } });
    assert.match(posted, /^200 OK/); assert.equal(calls[1].init.headers.Authorization, 'Bearer sk-live-abcdefghijklmnop', 'an agent cannot override the key'); assert.equal(calls[1].init.headers['x-note'], 'hi');
    assert.equal(calls[1].init.headers['content-type'], 'application/json'); assert.equal(calls[1].init.body, '{"files":[{"path":"index.html","size":12}]}');
    assert.match(await get.invoke({ service: 'crm', path: '/x' }), /not an outside service in the Vault for your team/);
    assert.match(await get.invoke({ service: 'here.now', path: 'publish' }), /starts with \//);
    vault.upsert({ id: 'here.now', clearSecret: true });
    assert.match(await get.invoke({ service: 'here.now', path: '/x' }), /no key yet/);
    fs.mkdirSync(engine.workspaceDir(job.id), { recursive: true }); fs.writeFileSync(path.join(engine.workspaceDir(job.id), 'index.html'), '<h1>Hi</h1>');
    const up = await upload.invoke({ url: 'https://uploads.example/signed?x=1', file: '/work/index.html', contentType: 'text/html' });
    assert.match(up, /^200 OK: uploaded \/work\/index\.html \(11 bytes\) to uploads\.example/); assert.equal(calls[2].init.method, 'PUT'); assert.equal(calls[2].init.headers['content-type'], 'text/html');
    assert.match(await upload.invoke({ url: 'http://uploads.example/x', file: '/work/index.html' }), /https addresses only/);
    assert.match(await upload.invoke({ url: 'https://uploads.example/x', file: '/work/missing.html' }), /no file at \/work\/missing\.html/);
    assert.equal(engine.events(job.id).filter(e => e.type === 'api_called').length, 3);
  } finally { globalThis.fetch = realFetch; await engine.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
});
