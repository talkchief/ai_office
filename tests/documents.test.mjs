import test from 'node:test';
import { assembleFiles, browserStats, closeBrowser } from '../engine/documents.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderPdf, renderPptx, markdownToHtml, markdownToSlides, exportPdfTool, exportPptxTool, workspaceFile, listWorkspaceFiles, mimeOf, pdfEngineAvailable } from '../engine/documents.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-docs-'));
const SAMPLE = `# TalkChief research brief

Direct answer first: **TalkChief** is a *cloud phone system* for sales teams. See [the site](https://talkchief.io).

## What we found
- Founded in 2022, ~40 staff
- Pricing from $25 per seat
  - Annual billing only
1. Read the digest
2. Check the numbers

## Numbers

| Metric | Value |
|---|---|
| Seats | 1,200 |
| Churn | 3% |

> A note from the lead.

\`\`\`
plain code block
\`\`\`
`;

test('Markdown becomes a print-ready HTML document with the title block once, not twice', () => {
  const html = markdownToHtml(SAMPLE, { title: 'TalkChief research brief' });
  assert.ok(html.includes('<h1 class="doc-title">TalkChief research brief</h1>'));
  assert.equal((html.match(/TalkChief research brief/g) || []).length, 2, 'title tag and title block; the first heading is not repeated');
  assert.ok(html.includes('<h2>What we found</h2>') && html.includes('<table>') && html.includes('<blockquote>') && html.includes('<pre>'));
  assert.ok(html.includes('@page { size: A4'));
});

test('the built-in renderer produces a real PDF without runaway pages', async () => {
  const dir = temp(), out = path.join(dir, 'brief.pdf');
  const r = await renderPdf({ markdown: SAMPLE, title: 'TalkChief research brief', out, engine: 'pdfkit' });
  assert.equal(r.engine, 'pdfkit'); assert.equal(fs.readFileSync(out).subarray(0, 5).toString(), '%PDF-');
  assert.ok(r.pages >= 1 && r.pages <= 2, `a short brief is one or two pages, got ${r.pages}`);
  const long = await renderPdf({ markdown: Array.from({ length: 60 }, (_, i) => `## Section ${i}\n\nParagraph ${i} with enough words to take some room on the page, and a second sentence to wrap.\n\n- one\n- two`).join('\n\n'), out: path.join(dir, 'long.pdf'), engine: 'pdfkit' });
  assert.ok(long.pages >= 6 && long.pages <= 16, `long documents paginate sensibly, got ${long.pages}`);
});

test('with a browser on the machine the PDF is printed by it (skipped when there is none)', { skip: !(await pdfEngineAvailable()) && 'no Chrome or Edge here' }, async () => {
  const dir = temp(), out = path.join(dir, 'browser.pdf');
  const r = await renderPdf({ markdown: SAMPLE, title: 'TalkChief research brief', out });
  assert.equal(r.engine, 'browser'); assert.ok(r.bytes > 5000); assert.ok(r.pages >= 1 && r.pages <= 2, `got ${r.pages} pages`);
});

test('a Markdown deck maps to slides: title, one slide per heading, bullets, tables, continuation', () => {
  const deck = markdownToSlides(`# Quarterly review\n\nWhere we are and what comes next.\n\n## Wins\n- Revenue up\n- Churn down\n\n## Numbers\n\n| KPI | Q3 |\n|---|---|\n| MRR | 42k |\n\n## Long list\n${Array.from({ length: 11 }, (_, i) => `- point ${i + 1}`).join('\n')}\n`);
  assert.equal(deck.title, 'Quarterly review'); assert.equal(deck.subtitle, 'Where we are and what comes next.');
  assert.deepEqual(deck.slides.map(s => s.title), ['Wins', 'Numbers', 'Long list', 'Long list (continued)']);
  assert.deepEqual(deck.slides[0].bullets.map(b => b.text), ['Revenue up', 'Churn down']);
  assert.deepEqual(deck.slides[1].table, { head: ['KPI', 'Q3'], rows: [['MRR', '42k']] });
  assert.equal(deck.slides[2].bullets.length, 8); assert.equal(deck.slides[3].bullets.length, 3);
});

test('a deck file is written as a real PowerPoint package', async () => {
  const dir = temp(), out = path.join(dir, 'deck.pptx');
  const r = await renderPptx({ markdown: SAMPLE, title: 'TalkChief', out });
  assert.equal(r.slides, 3, 'cover plus two sections'); assert.ok(r.bytes > 10000);
  assert.equal(fs.readFileSync(out).subarray(0, 2).toString(), 'PK', 'a .pptx is a zip package');
});

test('the export tools write next to the source, refuse paths outside /work/, and report what they saved', async () => {
  const dir = temp(); fs.writeFileSync(path.join(dir, 'report.md'), SAMPLE);
  const saved = [];
  const pdf = exportPdfTool({ workspaceDir: dir, onSaved: info => saved.push(info) }), pptx = exportPptxTool({ workspaceDir: dir, onSaved: info => saved.push(info) });
  assert.match(await pdf.invoke({ source: '/work/report.md' }), /^Saved \/work\/report\.pdf: \d+ pages?, \d+ KB\./);
  assert.match(await pptx.invoke({ source: '/work/report.md' }), /^Saved \/work\/report\.pptx: 3 slides, \d+ KB\./);
  assert.ok(fs.existsSync(path.join(dir, 'report.pdf')) && fs.existsSync(path.join(dir, 'report.pptx')));
  assert.deepEqual(saved.map(s => s.file), ['report.pdf', 'report.pptx']);
  assert.match(await pdf.invoke({ source: '/work/missing.md' }), /There is no file at \/work\/missing\.md/);
  assert.match(await pdf.invoke({ source: '/work/../../etc/passwd' }), /Only files inside \/work\//);
  assert.match(await pdf.invoke({ source: '/work/report.md', output: '/work/out.txt' }), /must end in \.pdf/);
  assert.match(await pptx.invoke({ source: '/work/report.md', output: '/work/out.pdf' }), /must end in \.pptx/);
  assert.throws(() => workspaceFile(dir, '../x.md'), /inside \/work\//);
  assert.equal(workspaceFile(dir, 'notes/a.md').rel, 'notes/a.md');
  const files = listWorkspaceFiles(dir);
  assert.deepEqual(files.map(f => f.name).sort(), ['report.md', 'report.pdf', 'report.pptx']);
  assert.equal(files.find(f => f.name === 'report.pptx').type, mimeOf('x.pptx'));
  assert.equal(mimeOf('x.csv'), 'text/csv; charset=utf-8'); assert.equal(mimeOf('x.bin'), 'application/octet-stream');
});

test('assemble_files combines the parts in order, in full, each under its own numbered heading with inner headings demoted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-assemble-'));
  fs.mkdirSync(path.join(dir, 'launch-pack'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'launch-pack', '01-marketing.md'), '# Launch announcement\n\nWe launch in October.\n\n## Channels\n\nLinkedIn.');
  fs.writeFileSync(path.join(dir, 'launch-pack', '02-sales.md'), 'One-pager text without a title.\n\n### Objections\n\nPrice.');
  const r = assembleFiles(dir, { output: '/work/Growth-Plan-Launch-Pack.md', title: 'Growth Plan Launch Pack', intro: 'Six parts, in the CEO’s order.', parts: [{ path: '/work/launch-pack/01-marketing.md' }, { path: '/work/launch-pack/02-sales.md', heading: 'Sales one-pager and objections' }] });
  assert.equal(r.file, 'Growth-Plan-Launch-Pack.md'); assert.equal(r.parts, 2);
  const text = fs.readFileSync(path.join(dir, 'Growth-Plan-Launch-Pack.md'), 'utf8');
  assert.equal(text, '# Growth Plan Launch Pack\n\nSix parts, in the CEO’s order.\n\n## 1. Launch announcement\n\nWe launch in October.\n\n### Channels\n\nLinkedIn.\n\n---\n\n## 2. Sales one-pager and objections\n\nOne-pager text without a title.\n\n#### Objections\n\nPrice.\n');
  assert.throws(() => assembleFiles(dir, { output: '/work/pack.md', title: 'x', parts: [{ path: '/work/missing.md' }] }), /no file at \/work\/missing\.md/);
  assert.throws(() => assembleFiles(dir, { output: '/work/pack.pdf', title: 'x', parts: [{ path: '/work/launch-pack/01-marketing.md' }] }), /must be Markdown/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the browser stays warm between exports: two PDFs, one launch; closeBrowser lets it go', async () => {
  if (!(await pdfEngineAvailable())) { await closeBrowser(); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-warm-'));
  const { renderPdf } = await import('../engine/documents.mjs');
  const before = browserStats().launches;
  await renderPdf({ markdown: '# One\n\nHello.', title: 'One', out: path.join(dir, 'one.pdf') });
  await renderPdf({ markdown: '# Two\n\nHello again.', title: 'Two', out: path.join(dir, 'two.pdf') });
  assert.equal(browserStats().launches - before, 0, 'the availability check launched the browser once and both exports reused it'); assert.equal(browserStats().open, true);
  await closeBrowser(); assert.equal(browserStats().open, false);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
