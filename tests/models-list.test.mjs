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
