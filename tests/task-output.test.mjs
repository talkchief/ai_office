import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDocument, outputExcerpt, renderTaskWorkspace, resultState } from '../src/task-output.js';

test('task documents render structured prose, comparisons, source links and code', () => {
  const result = renderDocument('# Launch brief\n\nA **useful** answer.\n\n## Next steps\n\n1. Validate demand.\n2. Write the brief.\n\n| Option | Owner |\n| --- | --- |\n| Pilot | Founder |\n\n> Verify before launch.\n\n[Source](https://example.com/facts)\n\n```js\nconst safe = "<tag>";\n```');
  assert.match(result.html, /<strong>useful<\/strong>/);
  assert.match(result.html, /<ol>/);
  assert.match(result.html, /<table>/);
  assert.match(result.html, /<blockquote>/);
  assert.match(result.html, /rel="noopener noreferrer"/);
  assert.match(result.html, /&lt;tag&gt;/);
  assert.deepEqual(result.sections.map(s => s.title), ['Launch brief','Next steps']);
  assert.ok(result.sections.every(s => result.html.includes(`id="${s.id}"`)));
});

test('untrusted result markup cannot execute HTML or load remote images', () => {
  const {html} = renderDocument('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert%281%29)\n\n[encoded](jav&#x61;script:alert%281%29)\n\n[data](data:text/html,test)\n\n[local](/api/auth/logout)\n\n![Tracking pixel](https://example.com/pixel?secret=private)');
  assert.doesNotMatch(html, /<script|<img|onerror="|href="(?:javascript|data|\/api)/i);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<[^>]+src=/);
  assert.doesNotMatch(html, /secret=private/);
  assert.match(html, /Tracking pixel/);
});

test('result cards extract actual prose without exposing Markdown syntax or review metadata', () => {
  assert.equal(outputExcerpt('# Repeated title\n\nA **specific** result with [evidence](https://example.com).'), 'A specific result with evidence.');
  assert.equal(outputExcerpt('A'.repeat(200)).length,160);
  assert.equal(outputExcerpt(''), '');
});

test('checklists show read-only checked states without changing ordinary bracketed prose', () => {
  const { html } = renderDocument('- [ ] Review the recommendation.\n- [x] Read the brief.\n\nThis [ ] is ordinary text.');
  assert.match(html, /aria-label="Unchecked"/);
  assert.match(html, /aria-label="Checked"/);
  assert.match(html, /This \[ \] is ordinary text/);
  assert.doesNotMatch(html, /<input/);
});

test('a passing lead review does not label a blocked, waiting or cancelled task approved', () => {
  for (const state of ['blocked','waiting','cancelled']) assert.notEqual(resultState({state,review:{approved:true}}).tone,'approved');
  assert.equal(resultState({state:'done'}).tone,'approved');
});

test('the task page puts actions first, then the chosen result version, then how it was done', () => {
  const job = { id: 'task', state: 'done', title: 'Brief', team: { name: 'Marketing', lead: 'lead', criteria: ['Cite supplied facts.'], guardrails: [] }, agents: [{ id: 'lead', name: 'Lead' }, { id: 'w', name: 'Writer' }],
    runs: [{ id: 'r1', agent: 'w', role: 'specialist', title: 'Draft the brief', state: 'done', output: 'Draft text', startedAt: 1, finishedAt: 2, sources: ['Company/prices.md'], tools: [] }],
    reviews: [{ agent: 'lead', approved: true, at: 3, summary: 'Checked.', criteria: [{ id: 'criterion-1', passed: true, evidence: 'Uses supplied facts.' }], checks: [] }],
    messages: [{ role: 'ceo', kind: 'message', text: 'Write the brief.', at: 0 }, { role: 'ceo', kind: 'correction', text: 'Shorten it.', at: 4 }],
    decisions: [{ at: 4.5, action: 'mcp__gmail__send', type: 'reject', message: 'Not yet.' }],
    resultVersions: [{ n: 1, at: 3, result: '## Recommended action\n\nRun the pilot.', summary: 'First.' }, { n: 2, at: 5, result: '## Revised\n\nShorter.', summary: 'Second.', correction: { text: 'Shorten it.' } }],
    result: '## Revised\n\nShorter.', sources: ['Company/prices.md'], calls: 3, tokens: 2000, tokensByModel: { 'z-ai/glm-4.6': 2000 } };
  const page = renderTaskWorkspace(job, { actions: '<button data-action="message">Send correction</button>' });
  assert.ok(page.indexOf('task-actions') < page.indexOf('space-deliverable')); assert.ok(page.indexOf('space-deliverable') < page.indexOf('How it was done'));
  assert.match(page, /Shorter\./); assert.doesNotMatch(page, /Run the pilot/); assert.match(page, /data-version="1"/); assert.match(page, /answers your correction: “Shorten it\.”/);
  assert.match(page, /Cite supplied facts\./); assert.match(page, /Uses supplied facts\./); assert.match(page, /Draft text/); assert.match(page, /Write the brief\./);
  assert.match(page, /Rejected mcp__gmail__send: “Not yet\.”/); assert.match(page, /data-note="Company\/prices\.md"/); assert.match(page, /3 model calls · 2,000 tokens \(z-ai\/glm-4\.6 2,000\)/);
  assert.match(renderTaskWorkspace(job, { version: 1 }), /Run the pilot/);
  assert.ok(page.indexOf('Write the brief.') < page.indexOf('Draft the brief'), 'the story reads in order');
});
