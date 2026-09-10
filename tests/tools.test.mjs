import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ToolStore } from '../tool-store.mjs';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';
import { layoutGraph } from '../graph-build.mjs';
import { isOutbound, assertPublicUrl, mcpServers, ToolHub, restoreSchema, agentToolIds, extraToolIds } from '../engine/tools.mjs';

const setup = (options = {}) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-tools-')); const office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents }); return { dir, office, store: new ToolStore({ dataDir: dir, office, summary: () => ({ servers: [] }), ...options }) }; };

test('connectors keep credentials private, retain tokens when edited and lose their assignments when removed', () => {
  const { dir, office, store } = setup();
  try {
    let list = store.save({ name: 'test-mcp', type: 'http', url: 'https://example.com/mcp', token: 'private-token' });
    assert.equal(list.find(t => t.id === 'test_mcp').hasToken, true); assert.ok(!JSON.stringify(list).includes('private-token'));
    store.save({ name: 'test-mcp', type: 'http', url: 'https://example.com/v2', token: '' }); assert.equal(store.items[0].config.headers.Authorization, 'Bearer private-token');
    if (process.platform !== 'win32') assert.equal(fs.statSync(store.file).mode & 0o777, 0o600, 'tokens are private to the server account');
    const cfg = office.get(); cfg.teams[0].tools = ['test_mcp']; cfg.agents[0].tools = ['test_mcp']; office.update(cfg);
    store.remove('test_mcp'); assert.deepEqual(office.get().teams[0].tools, []); assert.deepEqual(office.get().agents[0].tools, []); assert.equal(store.items.length, 0);
    assert.throws(() => store.save({ name: 'bad', type: 'http', url: 'https://user:password@example.com' }), /credentials/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a server found in Claude Code imports under the id teams already use', () => {
  const servers = [{ id: 'claude_ai_Gmail', name: 'Gmail', target: 'https://gmailmcp.googleapis.com/mcp/v1', status: 'connected' }];
  const { dir, office, store } = setup({ summary: () => ({ servers }) });
  try {
    const cfg = office.get(); cfg.teams.find(t => t.id === 'sales').tools = ['claude_ai_Gmail']; office.update(cfg);
    assert.equal(store.list().find(t => t.id === 'claude_ai_Gmail').type, 'candidate');
    const list = store.importCandidate('claude_ai_Gmail'), gmail = list.find(t => t.id === 'claude_ai_Gmail');
    assert.equal(gmail.type, 'http'); assert.equal(gmail.managed, true); assert.deepEqual(gmail.assignedTeams.map(t => t.id), ['sales']);
    assert.throws(() => store.importCandidate('claude_ai_Gmail'), /already/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('connector sign-in uses a single-use state and keeps tokens on the server', async () => {
  const authFn = async (provider, { authorizationCode }) => {
    if (!authorizationCode) { const state = await provider.state(); provider.saveCodeVerifier('verifier'); provider.redirectToAuthorization(new URL('https://auth.example/authorize?state=' + state)); return 'REDIRECT'; }
    assert.equal(provider.codeVerifier(), 'verifier'); provider.saveTokens({ access_token: 'secret-access-token', token_type: 'bearer' }); return 'AUTHORIZED';
  };
  const { dir, store } = setup({ authFn });
  try {
    store.save({ name: 'calendar', type: 'http', url: 'https://calendar.example/mcp' });
    await assert.rejects(store.oauthStart('calendar', 'http://evil.example'), /HTTPS/);
    const start = await store.oauthStart('calendar', 'https://office.example');
    assert.equal(start.state, 'redirect'); const state = new URL(start.url).searchParams.get('state');
    assert.equal(store.items[0].oauth.redirectUrl, 'https://office.example/api/tools/calendar/oauth/callback');
    await assert.rejects(store.oauthCallback('calendar', { code: 'c', state: 'guess' }), /invalid or has expired/);
    assert.equal((await store.oauthCallback('calendar', { code: 'c', state })).state, 'signed-in');
    await assert.rejects(store.oauthCallback('calendar', { code: 'c', state }), /invalid or has expired/);
    const list = store.list(); assert.equal(list.find(t => t.id === 'calendar').auth, 'signed-in'); assert.ok(!JSON.stringify(list).includes('secret-access-token'));
    assert.equal(store.authProviderFor(store.items[0]).tokens().access_token, 'secret-access-token'); assert.equal(store.items[0].oauth.verifier, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('outbound tools are recognised from hints, names and CEO overrides', () => {
  const t = (name, annotations) => ({ name, metadata: { annotations } });
  assert.equal(isOutbound(t('mcp__claude_ai_Gmail__search_threads', {})), false);
  assert.equal(isOutbound(t('mcp__claude_ai_Gmail__send_message', {})), true);
  assert.equal(isOutbound(t('mcp__x__list_events', { readOnlyHint: true })), false);
  assert.equal(isOutbound(t('mcp__x__query', { destructiveHint: true })), true);
  assert.equal(isOutbound(t('mcp__x__create_draft', { readOnlyHint: true })), false);
  assert.equal(isOutbound(t('mcp__x__search_threads', {}), { outboundTools: ['mcp__x__search_threads'] }), true);
  assert.equal(isOutbound(t('mcp__x__send_message', {}), { readOnlyTools: ['mcp__x__send_message'] }), false);
});

test('the web fetch tool refuses private and local addresses', async () => {
  const lookup = async host => [{ address: host === 'intranet.example' ? '10.0.0.5' : '93.184.216.34' }];
  for (const url of ['http://127.0.0.1:4520/api/tasks', 'http://[::1]/', 'http://169.254.169.254/latest', 'http://intranet.example/', 'file:///etc/passwd', 'https://user:pw@example.com']) await assert.rejects(assertPublicUrl(url, lookup), /Private|Only public|valid URL/);
  assert.equal((await assertPublicUrl('https://example.com/page', lookup)).hostname, 'example.com');
});

test('agents get only their team’s connectors, outbound ones pause, and tests never get them', async () => {
  const mk = name => tool(async () => 'ok', { name, description: name, schema: z.object({}) });
  const tools = [mk('mcp__claude_ai_Gmail__search_threads'), mk('mcp__claude_ai_Gmail__send_message'), mk('mcp__claude_ai_Sentry__search_issues')];
  const hub = new ToolHub({ clientFactory: async () => ({ getTools: async () => tools, close: async () => {} }), items: () => [{ name: 'claude_ai_Gmail', config: { type: 'http', url: 'https://g.example' } }, { name: 'claude_ai_Sentry', config: { type: 'http', url: 'https://s.example' } }] });
  await hub.load();
  const team = { tools: ['claude_ai_Gmail', 'web'] };
  const set = hub.toolsFor({ agent: { inheritTools: true }, team, provider: 'anthropic' });
  assert.deepEqual(set.tools.map(t => t.name), ['mcp__claude_ai_Gmail__search_threads', 'mcp__claude_ai_Gmail__send_message', 'web_fetch', 'web_search']);
  assert.deepEqual(Object.keys(set.interruptOn), ['mcp__claude_ai_Gmail__send_message']);
  assert.deepEqual(hub.toolsFor({ agent: { inheritTools: true }, team, provider: 'openai' }).tools.map(t => t.name).slice(-1), ['web_fetch']);
  assert.ok(!hub.toolsFor({ agent: { inheritTools: true }, team, evaluation: true }).tools.some(t => t.name.includes('send_message')));
  assert.deepEqual(hub.toolsFor({ agent: { inheritTools: false, tools: [] }, team }).tools, []);
  assert.deepEqual(hub.status, { claude_ai_Gmail: 'connected', claude_ai_Sentry: 'connected' });
  const servers = mcpServers([{ name: 'local', config: { type: 'stdio', command: 'npx', args: ['srv'] } }, { name: 'remote', config: { type: 'sse', url: 'https://r.example', headers: { Authorization: 'Bearer t' } } }]);
  assert.equal(servers.local.transport, 'stdio'); assert.equal(servers.remote.transport, 'sse'); assert.equal(servers.remote.headers.Authorization, 'Bearer t');
});

test('the Brain includes standalone notes and an empty vault has no sample graph', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-graph-'));
  try { let g = await layoutGraph(dir); assert.deepEqual(g.nodes, []); fs.writeFileSync(path.join(dir, 'purpose.md'), '# Purpose\nFacts without links.'); g = await layoutGraph(dir); assert.equal(g.notes, 1); assert.equal(g.nodes.length, 1); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('restoreSchema gives the model back the types the MCP server declared', () => {
  // Zapier's shapes: nested unions of constants, "boolean or null", arrays of constants, metadata keys, plain objects.
  const raw = { type: 'object', properties: {
    ordering: { description: 'Sort order', anyOf: [{ anyOf: [{ type: 'string', const: 'startTime', description: 'Start Time' }, { type: 'string', const: 'updated', description: 'Updated' }] }, { type: 'null' }] },
    expand_recurring: { _meta: { 'zapier/alters_dynamic_properties': true }, description: 'Expand', anyOf: [{ type: 'boolean' }, { type: 'null' }] },
    eventTypes: { anyOf: [{ type: 'array', items: { anyOf: [{ type: 'string', const: 'birthday' }, { type: 'string', const: 'default' }] } }, { type: 'null' }] },
    attendee_email: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    output_hint: { type: 'string', description: 'REQUIRED.' },
    dynamic_properties: { type: 'object', additionalProperties: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
    shape: { oneOf: [{ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }, { type: 'object', properties: { b: { type: 'number' } }, required: ['a', 'b'] }] },
  }, required: ['output_hint'], $schema: 'http://json-schema.org/draft-07/schema#' };
  const out = restoreSchema(raw);
  assert.deepEqual(out.properties.ordering, { description: 'Sort order', enum: ['startTime', 'updated'], type: 'string' });
  assert.deepEqual(out.properties.expand_recurring, { description: 'Expand', type: 'boolean' });
  assert.deepEqual(out.properties.eventTypes, { type: 'array', items: { enum: ['birthday', 'default'], type: 'string' } });
  assert.deepEqual(out.properties.attendee_email, { type: 'string' });
  assert.deepEqual(out.properties.output_hint, { type: 'string', description: 'REQUIRED.' });
  assert.deepEqual(out.properties.dynamic_properties.additionalProperties, { anyOf: [{ type: 'string' }, { type: 'number' }] });
  assert.deepEqual(out.properties.shape, { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } }, required: ['a'] });
  assert.deepEqual(out.required, ['output_hint']);
  assert.ok(!('$schema' in out) && !('_meta' in out.properties.expand_recurring));
  assert.equal(restoreSchema(null), null);
});

test('the hub restores schemas from the raw server listing and keeps the old session alive across a reload', async () => {
  const mk = name => tool(async () => 'ok', { name, description: 'x', schema: z.object({}) });
  const closed = [];
  let n = 0;
  const factory = async () => {
    const id = ++n, tools = [mk('mcp__cal__find_events')];
    tools[0].schema = { type: 'object', properties: { ordering: { description: 'flattened' } } };
    return { id, getTools: async () => tools, close: async () => { closed.push(id); },
      getClient: async () => ({ listTools: async () => ({ tools: [{ name: 'find_events', inputSchema: { type: 'object', properties: { ordering: { anyOf: [{ const: 'startTime' }, { const: 'updated' }] } } } }] }) }) };
  };
  let timeout = 45;
  const hub = new ToolHub({ clientFactory: factory, settings: () => ({ runTimeoutMinutes: timeout }), items: () => [{ name: 'cal', config: { type: 'http', url: 'https://c.example' } }] });
  await hub.load();
  assert.deepEqual(hub.tools[0].schema.properties.ordering, { enum: ['startTime', 'updated'], type: 'string' }, 'types restored from the raw listing');
  assert.equal(hub.status.cal, 'connected');
  const first = hub.client;
  await hub.load();
  assert.notEqual(hub.client, first, 'a reload makes a new session');
  assert.deepEqual(closed, [], 'the old session is not closed while a run could still hold it');
  assert.equal(hub.retired.length, 1);
  hub.sweep(Date.now() + 46 * 60000);
  assert.deepEqual(closed, [first.id], 'closed once the run time limit has passed');
  assert.equal(hub.retired.length, 0);
  await hub.load(); timeout = 1;
  hub.sweep(Date.now() + 2 * 60000);
  assert.equal(closed.length, 2, 'the grace period follows the office time limit');
  await hub.close();
  assert.equal(closed.length, 3, 'close() closes the live session too');
});

test('a tool given to one person counts, even when the team does not have it', () => {
  const team = { tools: ['Google_Calendar'] };
  assert.deepEqual(agentToolIds(team, { inheritTools: true, tools: [] }), ['Google_Calendar'], 'inheriting the team');
  assert.deepEqual(agentToolIds(team, { inheritTools: true, tools: ['web'] }), ['Google_Calendar', 'web'], 'a personal grant adds to the team');
  assert.deepEqual(agentToolIds(team, { inheritTools: false, tools: ['web'] }), ['web'], 'not inheriting: only the personal list');
  assert.deepEqual(agentToolIds(team, { inheritTools: false, tools: [] }), [], 'opted out of everything');
  assert.deepEqual(extraToolIds(team, { tools: ['web', 'Google_Calendar'] }), ['web']);
  const hub = new ToolHub({ clientFactory: async () => ({ getTools: async () => [], close: async () => {} }), items: () => [] });
  const { tools } = hub.toolsFor({ agent: { inheritTools: true, tools: ['web'] }, team, provider: 'openai' });
  assert.deepEqual(tools.map(t => t.name), ['web_fetch'], 'the person gets web fetch although the team has no web access');
});
