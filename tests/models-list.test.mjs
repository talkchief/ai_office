import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ModelRegistry, thoughtSignatures, SIGNATURE_BYPASS } from '../models.mjs';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, ToolMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

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

const sseOf = (...payloads) => new Response(payloads.map(p => 'data: ' + (typeof p === 'string' ? p : JSON.stringify(p)) + '\n\n').join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const toolCallDelta = (index, extra) => ({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'gemini-3', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index, ...extra }] }, finish_reason: null }] });

test('Gemini thought signatures: remembered from a streamed or a plain answer, put back on the tool call in the next request, bypassed when unknown', async () => {
  const requests = [];
  const provider = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body), contentLength: new Headers(init.headers).get('content-length') });
    if (requests.length === 1) return sseOf(toolCallDelta(0, { id: 'call_1', type: 'function', function: { name: 'ls', arguments: '' }, extra_content: { google: { thought_signature: 'SIG-ONE' } } }), toolCallDelta(0, { function: { arguments: '{"path":"/work"}' } }), '[DONE]');
    if (requests.length === 2) return new Response(JSON.stringify({ id: 'c2', object: 'chat.completion', created: 1, model: 'gemini-3', choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'read_file', arguments: '{}' }, extra_content: { google: { thought_signature: 'SIG-TWO' } } }] }, finish_reason: 'tool_calls' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const store = new Map(), fetch = thoughtSignatures(provider, store);
  const first = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '2' }, body: '{}' });
  let text = ''; for await (const c of first.body) text += new TextDecoder().decode(c);
  assert.match(text, /SIG-ONE/, 'the stream passes through whole'); assert.equal(store.get('call_1'), 'SIG-ONE', 'the signature was remembered from the stream');
  await (await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', { method: 'POST', body: '{"messages":[]}' })).text();
  assert.equal(store.get('call_2'), 'SIG-TWO', 'and from a plain JSON answer');
  const history = { messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'ls', arguments: '{"path":"/work"}' } }, { id: 'call_9', type: 'function', function: { name: 'grep', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'call_1', content: 'a.md' }] };
  await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(JSON.stringify(history).length) }, body: JSON.stringify(history) });
  const sent = requests[2].body.messages[1].tool_calls;
  assert.equal(sent[0].extra_content.google.thought_signature, 'SIG-ONE', 'the remembered signature travels with its call');
  assert.equal(sent[1].extra_content.google.thought_signature, SIGNATURE_BYPASS, 'a call whose signature is unknown gets the bypass value');
  assert.equal(requests[2].contentLength, null, 'a stale content-length is dropped when the body changes');
  assert.equal(SIGNATURE_BYPASS, 'skip_thought_signature_validator');
});

test('through the real client a Gemini tool call round trip carries its thought signature back', async () => {
  const requests = [];
  const provider = async (url, init) => {
    requests.push(JSON.parse(init.body));
    if (requests.length === 1) return new Response(JSON.stringify({ id: 'c1', object: 'chat.completion', created: 1, model: 'gemini-3', choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_ls', type: 'function', function: { name: 'ls', arguments: '{"path":"/work"}' }, extra_content: { google: { thought_signature: 'SIG-LS' } } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ id: 'c2', object: 'chat.completion', created: 1, model: 'gemini-3', choices: [{ index: 0, message: { role: 'assistant', content: 'Two files.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const ls = tool(async () => 'a.md, b.md', { name: 'ls', description: 'List files', schema: z.object({ path: z.string() }) });
  const model = new ChatOpenAI({ model: 'gemini-3', apiKey: 'k', configuration: { baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', fetch: thoughtSignatures(provider) } }).bindTools([ls]);
  const ai = await model.invoke([new HumanMessage('List /work')]);
  assert.equal(ai.tool_calls[0].id, 'call_ls');
  const reply = await model.invoke([new HumanMessage('List /work'), ai, new ToolMessage({ tool_call_id: 'call_ls', content: 'a.md, b.md' })]);
  assert.equal(reply.content, 'Two files.');
  const assistant = requests[1].messages.find(m => m.role === 'assistant');
  assert.equal(assistant.tool_calls[0].extra_content.google.thought_signature, 'SIG-LS', 'the client dropped it; the office put it back');
});
