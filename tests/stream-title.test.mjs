import test from 'node:test';
import assert from 'node:assert/strict';
import { runTitle } from '../engine/stream.mjs';

test('a run is named after the work: not the heading above it, not the sentence saying who the worker is', () => {
  assert.equal(runTitle('## Role & Mission\n\nYou are the copy and content specialist for Marketing.\n\nWrite the landing page copy and the SEO plan.'), 'Write the landing page copy and the SEO plan');
  assert.equal(runTitle('You are the Quality Assurance Checker (qa) on the Delivery team. Verify the deployed page.'), 'Verify the deployed page');
  assert.equal(runTitle('**Context:**\nWrite the three nurture emails.'), 'Write the three nurture emails');
  assert.equal(runTitle('Deliverable:\n- Assemble the final campaign brief'), 'Assemble the final campaign brief');
  assert.equal(runTitle('1. Publish the page to here.now'), 'Publish the page to here.now');
  assert.equal(runTitle('Your task is to publish the page to here.now.'), 'Publish the page to here.now');
  assert.equal(runTitle('# Role & Mission'), 'Role & Mission', 'a heading is still better than nothing');
  assert.equal(runTitle(''), 'Assignment');
  assert.ok(runTitle('x'.repeat(200)).endsWith('…'));
});
