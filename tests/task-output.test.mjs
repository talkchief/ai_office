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

test('result view leads with the deliverable and review view names the actual requirement', () => {
  const job={id:'task',state:'done',title:'Brief',team:{name:'Marketing',lead:'lead',criteria:['Cite supplied facts.'],guardrails:[],maxCalls:8,maxTokens:30000},agents:[{id:'lead',name:'Lead'}],subtasks:[],events:[],reviews:[{agent:'lead',approved:true,criteria:[{id:'criterion-1',passed:true,evidence:'Uses supplied facts.'}],checks:[]}],review:{approved:true},result:'## Recommended action\n\nRun the pilot.',calls:3,tokens:2000,officeRevision:1};
  const result=renderTaskWorkspace(job,'result');assert.match(result, /space-deliverable/);assert.match(result, /<h2[^>]*>Recommended action/);assert.doesNotMatch(result, /Activity timeline|criterion-1|model calls/);
  const review=renderTaskWorkspace(job,'review');assert.match(review,/Cite supplied facts/);assert.doesNotMatch(review,/Run the pilot/);assert.match(review,/3\/8 model calls/);
});

test('an archived task says so, and that everything is kept', () => {
  const base={id:'task',title:'Brief',team:{name:'Marketing',lead:'lead',criteria:[],guardrails:[]},agents:[{id:'lead',name:'Lead'}],subtasks:[],events:[],reviews:[],review:{approved:true},result:'## Plan\n\nRun the pilot.',archivedAt:Date.UTC(2026,8,14,9)};
  const done=renderTaskWorkspace({...base,state:'done'},'result','<button data-tidy="restore">Restore to the board</button>');
  assert.match(done,/<span class="tv-chip"[^>]*>Archived<\/span>/);assert.match(done,/<b>Archived on [^<]+\.<\/b><p>Off the board, everything kept: the result is still filed in the Brain/);assert.match(done,/data-tidy="restore"/);
  assert.doesNotMatch(done,/Approved and filed in the Brain on/,'the archive line replaces the approval line');
  const cancelled=renderTaskWorkspace({...base,state:'cancelled',result:''},'result');
  assert.match(cancelled,/Off the board\. Its conversation and files are kept\./);
  assert.doesNotMatch(renderTaskWorkspace({...base,state:'done',archivedAt:null},'result'),/Archived/,'a task on the board carries no archive mark');
});

test('paths in a result are links: a Brain note opens in the Brain and downloads, a workspace file downloads from the task', () => {
  const { html } = renderDocument('Prices hold (Source: `/knowledge/Agents Office/task-1.md`). The pack is at /work/pack/growth.pdf, see /knowledge/10-Business/offer-ladder.md.', 'r', { taskId: 't1' });
  assert.match(html, /<a class="space-ref" href="\/api\/knowledge\/file\?id=Agents%20Office%2Ftask-1\.md" data-ref-note="Agents Office\/task-1\.md" title="Open this note in the Brain">\/knowledge\/Agents Office\/task-1\.md<\/a><a class="space-ref-dl" href="\/api\/knowledge\/file\?id=Agents%20Office%2Ftask-1\.md" download/);
  assert.match(html, /<a class="space-ref" href="\/api\/tasks\/t1\/file\?path=pack%2Fgrowth\.pdf" download title="Download this file from the task">\/work\/pack\/growth\.pdf<\/a>,/);
  assert.match(html, /data-ref-note="10-Business\/offer-ladder\.md"[^>]*>\/knowledge\/10-Business\/offer-ladder\.md<\/a><a class="space-ref-dl"[^>]*>↓<\/a>\./, 'the closing full stop stays outside the link');
  assert.ok(!renderDocument('A file at /work/x.md', 'r', {}).html.includes('<a'), 'no task, no workspace link');
});
