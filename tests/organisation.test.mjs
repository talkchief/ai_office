import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';
import { Agency } from '../agency.mjs';
import { webFetchTool } from '../engine/tools.mjs';
import { PROVIDERS_WITHOUT_GENERAL_WORKER, isTransientProviderError } from '../engine/deep-agents.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-org-'));

test('hiring from the Agency always gives the new person standing instructions, even when the persona file has no rules', () => {
  const office = new OfficeStore({ dataDir: temp(), initialAgents: loadRoster().agents });
  const agency = new Agency();
  const { person, skill, team } = agency.hire(office, 'finance-financial-analyst', { dept: 'fin', busy: new Set() });
  assert.equal(team.id, 'fin');
  assert.ok(person.brief.length > 80, 'a brief was derived from the persona');
  assert.match(person.brief, /^Your job: Expert financial analyst/);
  assert.match(person.brief, /Follow the Financial Analyst method in your skills/);
  assert.ok(person.does.length > 40);
  assert.ok(skill, 'the persona method came along as a skill');
  const stored = office.get().agents.find(a => a.id === person.id);
  assert.equal(stored.brief, person.brief, 'the office accepted the hire');
  // A persona that does carry rules keeps them as its brief.
  const withRules = agency.hire(office, 'marketing-seo-specialist', { dept: 'ops', busy: new Set() });
  assert.ok(withRules.person.brief.length > 40);
});

test('no provider gives a lead the built-in general-purpose worker; every worker is a named person', async () => {
  const { getHarnessProfile } = await import('deepagents');
  assert.deepEqual(PROVIDERS_WITHOUT_GENERAL_WORKER, ['anthropic', 'openai', 'google']);
  for (const provider of PROVIDERS_WITHOUT_GENERAL_WORKER) {
    assert.equal(getHarnessProfile(provider)?.generalPurposeSubagent?.enabled, false, `${provider} profile`);
    assert.equal(getHarnessProfile(`${provider}:any-model`)?.generalPurposeSubagent?.enabled, false, `${provider} model-specific profile inherits it`);
  }
});

test('a page that cannot be fetched comes back as an explanation the agent can act on, never as a thrown error', async () => {
  const lookup = async () => [{ address: '93.184.216.34' }];
  const failing = webFetchTool({ fetchImpl: async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }, lookup });
  assert.equal(await failing.invoke({ url: 'https://nowhere.example/page' }), 'Could not fetch https://nowhere.example/page: ENOTFOUND. Try another address or another source.');
  const slow = webFetchTool({ fetchImpl: async () => { throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }); }, lookup });
  assert.match(await slow.invoke({ url: 'https://slow.example/' }), /no reply within 20 seconds/);
  assert.match(await failing.invoke({ url: 'http://127.0.0.1/secret' }), /^Could not fetch http:\/\/127\.0\.0\.1\/secret: Private and local/);
  const redirecting = webFetchTool({ fetchImpl: async () => ({ status: 302, headers: new Headers({ location: '/en' }) }), lookup });
  assert.equal(await redirecting.invoke({ url: 'https://talkchief.example/' }), 'Redirected to https://talkchief.example/en. Fetch that URL if it is relevant.');
  const page = webFetchTool({ fetchImpl: async () => ({ status: 200, ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => '<h1>Hello</h1><script>x()</script><p>World</p>' }), lookup });
  assert.match(await page.invoke({ url: 'https://talkchief.example/en' }), /^Hello\n ?World$/);
});

test('a roster save is refused only for people with work in progress; ids that are not people never block it', () => {
  const office = new OfficeStore({ dataDir: temp(), initialAgents: loadRoster().agents });
  const next = office.get(); next.agents.find(a => a.id === 'riley').role = 'Research Lead';
  office.update(next, new Set(['pm', 'general-purpose', 'riley']));
  assert.equal(office.get().agents.find(a => a.id === 'riley').role, 'Research Lead', 'a busy person can still be edited in place');
  const moved = office.get(); moved.agents.find(a => a.id === 'riley').department = 'ops';
  assert.throws(() => office.update(moved, new Set(['riley'])), /unfinished work cannot be removed or moved/);
  const gone = office.get(); gone.agents = gone.agents.filter(a => a.id !== 'riley');
  assert.throws(() => office.update(gone, new Set(['riley'])), /unfinished work cannot be removed or moved/);
  const hire = office.get(); hire.agents.push({ id: 'agency-x', department: 'fin', name: 'ANALYST', role: 'Analyst', does: 'Models the numbers.', brief: 'Numbers from the ledger.', tools: [], skills: [], rules: [] });
  office.update(hire, new Set(['pm', 'general-purpose', 'gfx']));
  assert.ok(office.get().agents.some(a => a.id === 'agency-x'), 'a hire goes through while other people are busy');
});

test('a provider hiccup is retried automatically; a wrong key, no credit or a bad model name is not', () => {
  for (const e of [{ status: 500, message: '500 Internal Server Error' }, { message: 'Bad Gateway' }, { status: 429, message: 'Too Many Requests' }, { message: 'fetch failed', cause: { code: 'ECONNRESET' } }, { message: 'The model is overloaded' }, { message: 'Request timed out' }, { message: 'Connection error.' }, { message: 'connect ECONNREFUSED 1.2.3.4:443' }]) assert.ok(isTransientProviderError(e), e.message);
  for (const e of [{ status: 401, message: 'Invalid API key' }, { status: 402, message: 'Insufficient credit' }, { status: 404, message: 'model does not exist' }, { message: 'quota exceeded' }, { message: 'Task cancelled' }]) assert.ok(!isTransientProviderError(e), e.message);
});
