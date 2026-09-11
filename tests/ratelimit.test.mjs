import test from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../server/ratelimit.mjs';

test('a key gets its attempts per window, the window expires on the clock, and a success resets it', () => {
  let clock = 0; const limiter = new RateLimiter({ max: 3, windowMs: 1000, now: () => clock });
  assert.equal(limiter.hit('a'), true); assert.equal(limiter.hit('a'), true); assert.equal(limiter.hit('a'), true);
  assert.equal(limiter.hit('a'), false, 'the fourth attempt is refused');
  assert.equal(limiter.hit('b'), true, 'another key is unaffected');
  clock = 1001; assert.equal(limiter.hit('a'), true, 'a new window');
  limiter.hit('a'); limiter.hit('a'); assert.equal(limiter.hit('a'), false); limiter.reset('a'); assert.equal(limiter.hit('a'), true);
});

test('the table is capped so a flood of addresses cannot grow memory without bound', () => {
  const limiter = new RateLimiter({ max: 1, windowMs: 60000, maxKeys: 2 });
  assert.equal(limiter.hit('x'), true); assert.equal(limiter.hit('y'), true);
  assert.equal(limiter.hit('z'), false, 'a new key is refused while the table is full');
  assert.equal(limiter.hit('x'), false, 'known keys still count');
});
