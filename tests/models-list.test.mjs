import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ModelRegistry } from '../models.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-models-'));
const setup = fetchImpl => {
  const reg = new ModelRegistry({ dataDir: temp(), env: {}, fetchImpl });
  reg.update({ providers: [{ id: 'openrouter', type: 'openai-compatible', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-test' }], models: [] });
  return reg;
};
const ok = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const tlsFailure = () => { const e = new TypeError('fetch failed'); e.cause = new Error('self-signed certificate in certificate chain'); return e; };

test('a model list blocked at the exact /models address is fetched once more with a query string', async () => {
  const urls = [];
  const reg = setup(async url => { urls.push(url); if (url.endsWith('/models')) throw tlsFailure(); return ok({ data: [{ id: 'google/gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite' }] }); });
  const list = await reg.listModels('openrouter');
  assert.deepEqual(list.map(m => m.id), ['google/gemini-3.1-flash-lite']);
  assert.equal(urls.length, 2, 'the second, fresh connection succeeded'); assert.match(urls[1], /\/models\?office=\d+$/);
});

test('when the list cannot be fetched at all, four fresh connections are tried, then the reason is given and typing a model id is suggested', async () => {
  let tries = 0;
  const reg = setup(async () => { tries++; throw tlsFailure(); });
  await assert.rejects(() => reg.listModels('openrouter'), error => { assert.match(error.message, /Could not fetch OpenRouter’s model list \(self-signed certificate in certificate chain\)\. Type the model id instead/); assert.equal(error.status, 502); assert.equal(tries, 4); return true; });
});

test('Google Gemini is built in: it joins an older providers file, takes GEMINI_API_KEY, and its list keeps the chat models without the models/ prefix', async () => {
  const dir = temp();
  fs.writeFileSync(path.join(dir, 'providers.json'), JSON.stringify({ version: 1, providers: [{ id: 'anthropic', type: 'anthropic', label: 'Anthropic', enabled: true }], models: [] }));
  const urls = [];
  const reg = new ModelRegistry({ dataDir: dir, env: { GEMINI_API_KEY: 'g-test' }, fetchImpl: async (url, init) => { urls.push({ url, auth: init.headers.authorization }); return ok({ data: [{ id: 'models/gemini-2.5-flash', object: 'model' }, { id: 'models/gemini-3.8-pro' }, { id: 'models/embedding-001' }, { id: 'models/imagen-4.0-generate' }, { id: 'models/gemini-2.5-flash-preview-tts' }, { id: 'models/gemma-3-27b-it' }] }); } });
  const google = reg.provider('google');
  assert.equal(google.type, 'openai-compatible'); assert.equal(google.baseURL, 'https://generativelanguage.googleapis.com/v1beta/openai'); assert.equal(google.label, 'Google Gemini');
  assert.deepEqual(reg.provider('anthropic').label, 'Anthropic', 'the older file keeps what it had');
  assert.deepEqual(reg.keyFor(google), { key: 'g-test', source: 'env' }); assert.equal(reg.usable(google), true);
  assert.match(fs.readFileSync(path.join(dir, 'providers.json'), 'utf8'), /"google"/, 'the provider is written into the older file');
  const list = await reg.listModels('google');
  assert.equal(urls[0].url, 'https://generativelanguage.googleapis.com/v1beta/openai/models'); assert.equal(urls[0].auth, 'Bearer g-test');
  assert.deepEqual(list.map(m => [m.id, m.label, m.supports.reasoning]), [['gemini-2.5-flash', 'gemini-2.5-flash', true], ['gemini-3.8-pro', 'gemini-3.8-pro', true], ['gemma-3-27b-it', 'gemma-3-27b-it', false]]);
  reg.update({ ...reg.value, models: [{ id: 'gemini-3.8-pro', provider: 'google', supports: { reasoning: true, tools: true } }] });
  const { type, options } = reg.options({ model: 'gemini-3.8-pro', effort: 'high' });
  assert.equal(type, 'openai'); assert.equal(options.model, 'gemini-3.8-pro'); assert.equal(options.configuration.baseURL, google.baseURL); assert.deepEqual(options.reasoning, { effort: 'high' }); assert.equal(options.apiKey, 'g-test');
  const alt = new ModelRegistry({ dataDir: temp(), env: { GOOGLE_API_KEY: 'g-2' } });
  assert.equal(alt.keyFor(alt.provider('google')).key, 'g-2', 'GOOGLE_API_KEY is accepted as well');
  assert.equal(new ModelRegistry({ dataDir: temp(), env: {} }).usable(google), false, 'no key, not usable');
});
