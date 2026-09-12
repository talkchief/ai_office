import test from 'node:test';
import assert from 'node:assert/strict';
import { mailText, mailHtml, mailParts } from '../mail/format.mjs';

test('mail bodies: Markdown becomes plain prose, with the paragraphs kept apart', () => {
  const markdown = '# Report\n\n## Latest\n\nThe **Cowork** page shipped *early* on [11 Sep](https://talkchief.io/en/cowork).\n\n- one\n- two\n\n> a quote\n\n---\n\nplain 2*3 and a_b_c and `code`.';
  const text = mailText(markdown);
  assert.ok(!text.includes('**'), 'no bold markers survive');
  assert.ok(!/^\s*#/m.test(text), 'no heading markers survive');
  // The bug this guards: \s in a line-anchored pattern ate the blank lines and ran headings together.
  assert.ok(text.startsWith('Report\n\nLatest\n\n'), 'headings keep their own lines and the blank line after them');
  assert.match(text, /11 Sep \(https:\/\/talkchief\.io\/en\/cowork\)/, 'links flatten to label plus URL');
  assert.match(text, /^– one$/m); assert.match(text, /^– two$/m);
  assert.match(text, /^a quote$/m);
  assert.match(text, /plain 2\*3 and a_b_c and code\./, 'text that was never Markdown is left alone');
  assert.ok(text.split('\n\n').length >= 5, 'paragraphs stay separate');

  const html = mailHtml(markdown);
  assert.match(html, /<strong>Cowork<\/strong>/); assert.match(html, /<li>one<\/li>/);
});

test('mail bodies: both parts carry the office sign-off; plain text passes through', () => {
  const parts = mailParts('Done.', { signature: 'Yazan Office', footer: 'Reply to this email to add a note to the task.' });
  assert.equal(parts.text, 'Done.\n\n— Yazan Office\nReply to this email to add a note to the task.');

  // The requester is known, so the office opens with their name in both parts.
  const greeted = mailParts('Done.', { greeting: 'Hello Yazan,', signature: 'Yazan Office' });
  assert.equal(greeted.text, 'Hello Yazan,\n\nDone.\n\n— Yazan Office');
  assert.match(greeted.html, /<p style="margin:0 0 14px">Hello Yazan,<\/p>/);
  assert.match(parts.html, /^<div style=/); assert.match(parts.html, /— Yazan Office/); assert.match(parts.html, /Reply to this email/);

  assert.equal(mailText('Files added to “Draft”: brief.pdf.'), 'Files added to “Draft”: brief.pdf.');
  assert.equal(mailText(''), '');
  assert.equal(mailParts('', {}).text, '');
  assert.equal(mailParts('', { signature: 'X' }).text, '— X');
});
