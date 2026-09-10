import test from 'node:test';
import assert from 'node:assert/strict';
import { silenceGuard, fetchWithRetries, CALL_TIMEOUT_MS } from '../models.mjs';
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

test('error responses and bodiless responses are handed back as they are', async () => {
  const failing = silenceGuard(async () => new Response('{"error":"nope"}', { status: 500 }), 60);
  const res = await failing('https://provider.example/v1/chat/completions', {});
  assert.equal(res.status, 500); assert.equal(await res.text(), '{"error":"nope"}');
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
