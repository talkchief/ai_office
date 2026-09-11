import test from 'node:test';
import assert from 'node:assert/strict';
import { silenceGuard, fetchWithRetries, retryAfterMs, CALL_TIMEOUT_MS, RESEND_TOTAL_MS } from '../models.mjs';
import { ChatOpenAI } from '@langchain/openai';
import { isTransientProviderError } from '../engine/deep-agents.mjs';

const enc = new TextEncoder();
// A fake provider: sends the given chunks, waiting `gap` ms before each; `hang` keeps the stream open for ever after the last one.
const fakeFetch = ({ chunks = [], gap = 0, hang = false, status = 200 } = {}) => async () => {
  const body = new ReadableStream({
    async start(controller) {
      for (const c of chunks) { if (gap) await new Promise(r => setTimeout(r, gap)); controller.enqueue(enc.encode(c)); }
      if (!hang) controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
};
const readAll = async res => { const chunks = []; for await (const c of res.body) chunks.push(new TextDecoder().decode(c)); return chunks.join(''); };

test('the guard is five minutes by default and passes a healthy stream through untouched', async () => {
  assert.equal(CALL_TIMEOUT_MS, 5 * 60 * 1000);
  const fetch = silenceGuard(fakeFetch({ chunks: ['data: a\n\n', 'data: b\n\n'], gap: 5 }), 200);
  const res = await fetch('https://provider.example/v1/chat/completions', {});
  assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), 'text/event-stream');
  assert.equal(await readAll(res), 'data: a\n\ndata: b\n\n');
});

test('a stream that goes silent fails the call with a transient, retryable error', async () => {
  const fetch = silenceGuard(fakeFetch({ chunks: ['data: a\n\n'], hang: true }), 60);
  const res = await fetch('https://provider.example/v1/chat/completions', {});
  let error = null, got = '';
  try { got = await readAll(res); } catch (e) { error = e; }
  assert.equal(got, '');
  assert.match(error?.message || '', /The model stream timed out: no data for 1 minutes\./);
  assert.equal(isTransientProviderError(error), true, 'the retry rule treats it as a provider hiccup');
});

test('final error responses and bodiless responses are handed back as they are', async () => {
  const failing = silenceGuard(async () => new Response('{"error":"nope"}', { status: 400 }), 60);
  const res = await failing('https://provider.example/v1/chat/completions', {});
  assert.equal(res.status, 400); assert.equal(await res.text(), '{"error":"nope"}');
  const empty = silenceGuard(async () => new Response(null, { status: 204 }), 60);
  assert.equal((await empty('https://provider.example/x', {})).status, 204);
});

test('a request that fails before any answer is retried on a fresh connection, and a body that cannot be resent is not', async () => {
  let calls = 0;
  const flaky = async () => { calls++; if (calls < 3) { const e = new TypeError('fetch failed'); e.cause = new Error('self-signed certificate in certificate chain'); throw e; } return new Response('{"ok":true}', { status: 200 }); };
  const res = await fetchWithRetries(flaky, 'https://provider.example/v1/chat/completions', { method: 'POST', body: '{"model":"x"}' }, { pause: 1 });
  assert.equal(res.status, 200); assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(() => fetchWithRetries(flaky, 'https://provider.example/v1/x', { method: 'POST', body: new ReadableStream() }, { pause: 1 }), /fetch failed/);
  assert.equal(calls, 1, 'a stream body is sent once');
  calls = 0;
  const notNetwork = async () => { calls++; throw new Error('Invalid API key'); };
  await assert.rejects(() => fetchWithRetries(notNetwork, 'https://provider.example/v1/x', {}, { pause: 1 }), /Invalid API key/);
  assert.equal(calls, 1, 'only network failures are retried');
  const guarded = silenceGuard(flaky, 60); calls = 0;
  assert.equal((await guarded('https://provider.example/v1/chat/completions', { method: 'POST', body: '{}' })).status, 200, 'the guard retries too');
});

test('a 429 or a 5xx is asked again after a pause, Retry-After honoured, within a budget of about three minutes', async () => {
  assert.equal(RESEND_TOTAL_MS, 200000);
  assert.equal(retryAfterMs(new Response('', { headers: { 'retry-after': '3' } })), 3000);
  assert.equal(retryAfterMs(new Response('', { headers: { 'retry-after': new Date(Date.now() + 5000).toUTCString() } })) > 3000, true);
  assert.equal(retryAfterMs(new Response('')), null);
  let calls = 0; const waits = [];
  const limited = async () => { calls++; if (calls < 3) return new Response('{"error":{"message":"google/x is temporarily rate-limited upstream"}}', { status: 429, headers: { 'retry-after': '0' } }); return new Response('{"ok":true}', { status: 200 }); };
  const res = await fetchWithRetries(limited, 'https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: '{"model":"x"}' }, { onWait: w => waits.push(w) });
  assert.equal(res.status, 200); assert.equal(calls, 3);
  assert.deepEqual(waits.map(w => [w.status, w.attempt, w.delay, w.url]), [[429, 1, 0, 'https://openrouter.ai/api/v1/chat/completions'], [429, 2, 0, 'https://openrouter.ai/api/v1/chat/completions']]);
  calls = 0;
  const overloaded = async () => { calls++; return new Response('overloaded', { status: 503 }); };
  const still = await fetchWithRetries(overloaded, 'https://provider.example/v1/x', { method: 'POST', body: '{}' }, { total: 30, pauses: [10] });
  assert.equal(still.status, 503); assert.equal(calls, 4, 'three pauses of 10 ms fit the 30 ms budget, then the last answer is handed back');
  calls = 0;
  const hinted = await fetchWithRetries(async () => { calls++; return new Response('later', { status: 429, headers: { 'retry-after': '120' } }); }, 'https://provider.example/v1/x', { method: 'POST', body: '{}' }, { total: 30 });
  assert.equal(hinted.status, 429); assert.equal(calls, 1, 'a Retry-After beyond the budget is not waited for');
  calls = 0;
  const stream = await fetchWithRetries(overloaded, 'https://provider.example/v1/x', { method: 'POST', body: new ReadableStream() }, { total: 30, pauses: [1] });
  assert.equal(stream.status, 503); assert.equal(calls, 1, 'a body that cannot be resent is sent once');
  calls = 0;
  const bad = await fetchWithRetries(async () => { calls++; return new Response('nope', { status: 400 }); }, 'https://provider.example/v1/x', { method: 'POST', body: '{}' }, { pauses: [1] });
  assert.equal(bad.status, 400); assert.equal(calls, 1, 'a 400 is final');
  calls = 0;
  const off = await fetchWithRetries(overloaded, 'https://provider.example/v1/x', { method: 'POST', body: '{}' }, { resend: false });
  assert.equal(off.status, 503); assert.equal(calls, 1, 'the model list asks once');
  calls = 0;
  const stop = new AbortController(); setTimeout(() => stop.abort(new Error('Stopped.')), 15);
  await assert.rejects(() => fetchWithRetries(overloaded, 'https://provider.example/v1/x', { method: 'POST', body: '{}', signal: stop.signal }, { pauses: [1000] }), /Stopped\./);
  assert.equal(calls, 1, 'a stopped call does not wait out the pause');
});

test('through the real client a headerless 429 fails at once without the guard and succeeds with it', async () => {
  const completion = JSON.stringify({ id: 'c1', object: 'chat.completion', created: 1, model: 'x', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  const provider = () => { let calls = 0; return async () => { calls++; return calls === 1 ? new Response('{"error":{"message":"google/x is temporarily rate-limited upstream. Please retry shortly","code":429}}', { status: 429, headers: { 'content-type': 'application/json' } }) : new Response(completion, { status: 200, headers: { 'content-type': 'application/json' } }); }; };
  const bare = new ChatOpenAI({ model: 'x', apiKey: 'k', configuration: { baseURL: 'https://provider.example/v1', fetch: provider() } });
  await assert.rejects(() => bare.invoke('hi'), /rate-limited/, 'LangChain treats a headerless 429 as final');
  const waits = [];
  const guarded = new ChatOpenAI({ model: 'x', apiKey: 'k', configuration: { baseURL: 'https://provider.example/v1', fetch: silenceGuard(provider(), 60000, { onWait: w => waits.push(w) }) } });
  const reply = await guarded.invoke('hi');
  assert.equal(reply.content, 'ok'); assert.equal(waits.length, 1); assert.equal(waits[0].status, 429);
});
