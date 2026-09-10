import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readJsonBody } from '../http-body.mjs';

test('large configuration payloads use explicit limits and preserve split UTF-8', async () => {
  const value = { instructions: 'مرحبا 👋'.repeat(12000) };
  const bytes = Buffer.from(JSON.stringify(value));
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 97) chunks.push(bytes.subarray(i, i + 97));
  assert.deepEqual(await readJsonBody(Readable.from(chunks), 16 * 1024 * 1024), value);
  await assert.rejects(readJsonBody(Readable.from(chunks)), { status: 413 });
});

test('invalid and oversized JSON requests reject without accepting partial data', async () => {
  await assert.rejects(readJsonBody(Readable.from([Buffer.from('{invalid}')])), { status: 400 });
  await assert.rejects(readJsonBody(Readable.from([Buffer.from('{}'), Buffer.alloc(20)]), 10), { status: 413 });
  assert.deepEqual(await readJsonBody(Readable.from([])), {});
});
