import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficeAccess, sameOrigin } from '../auth.mjs';

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
