import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { readDocument, extractDocument } from '../documents.mjs';
import { exportXlsxTool, sheetCell, sheetsFromMarkdown } from '../engine/documents.mjs';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';
import { OfficeEngine } from '../engine/deep-agents.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-sheets-'));
const framework = () => {
  const wb = XLSX.utils.book_new();
  const krs = XLSX.utils.aoa_to_sheet([['Key result', 'Weight', 'Score'], ['Time to first value', 0.4, 3], ['Expansion revenue', 0.6, 2]]);
  krs.D2 = { t: 'n', f: 'B2*C2', v: 1.2 }; krs.D3 = { t: 'n', f: 'B3*C3', v: 1.2 }; krs['!ref'] = 'A1:D3';
  krs.A2.c = [{ a: 'CEO', t: 'Measured from contract signature' }];
  XLSX.utils.book_append_sheet(wb, krs, 'Team KRs');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Rating', 'Meaning'], [4, 'Exceeds']]), 'Rubric');
  return wb;
};

test('a spreadsheet reads as one table per sheet with column letters and row numbers, then its formulas and comments; XLS too', async () => {
  const text = await readDocument({ name: 'framework.xlsx', bytes: XLSX.write(framework(), { type: 'buffer', bookType: 'xlsx' }) });
  assert.match(text, /A spreadsheet with 2 sheets: Team KRs: 3 rows × 4 columns; Rubric: 2 rows × 2 columns/);
  assert.match(text, /## Sheet: Team KRs[\s\S]*\| Row \| A \| B \| C \| D \|[\s\S]*\| 2 \| Time to first value \| 0\.4 \| 3 \| 1\.2 \|/);
  assert.match(text, /### Formulas in Team KRs\n\n- D2: =B2\*C2 → 1\.2\n- D3: =B3\*C3 → 1\.2/);
  assert.match(text, /### Comments in Team KRs\n\n- A2: Measured from contract signature \(CEO\)/);
  const xls = await readDocument({ name: 'old.xls', bytes: XLSX.write(framework(), { type: 'buffer', bookType: 'biff8' }) });
  assert.match(xls, /## Sheet: Rubric[\s\S]*\| 2 \| 4 \| Exceeds \|/, 'the old Excel format reads the same way');
  const doc = await extractDocument({ name: 'framework.xlsx', data: XLSX.write(framework(), { type: 'base64', bookType: 'xlsx' }) });
  assert.match(doc.content, /Team KRs/, 'the Brain and projects take spreadsheets too');
  await assert.rejects(readDocument({ name: 'broken.xlsx', bytes: Buffer.from('PK not really a workbook') }), /Could not read this spreadsheet: the file is damaged or is not what its name says\. Upload an unprotected copy, or a PDF or CSV of it\./);
});

test('a slide deck reads slide by slide with its speaker notes', async () => {
  const { zipSync, strToU8 } = await import('fflate');
  const slide = texts => `<p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree>${texts.map(t => `<p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`).join('')}</p:spTree></p:cSld></p:sld>`;
  const bytes = Buffer.from(zipSync({ 'ppt/slides/slide1.xml': strToU8(slide(['FDE operating model', 'Pods of three'])), 'ppt/slides/slide2.xml': strToU8(slide(['Metrics &amp; cadence'])), 'ppt/notesSlides/notesSlide2.xml': strToU8(slide(['Say why weekly', '2'])) }));
  const text = await readDocument({ name: 'deck.pptx', bytes });
  assert.match(text, /A presentation with 2 slides\.\n\n## Slide 1\n\nFDE operating model\nPods of three\n\n## Slide 2\n\nMetrics & cadence\n\nSpeaker notes:\nSay why weekly/);
});

test('export_xlsx turns Markdown tables into a workbook: a sheet per heading, real formulas, percentages, money, dates', async () => {
  assert.deepEqual(sheetCell('=SUM(B2:B9)'), { t: 'n', f: 'SUM(B2:B9)' });
  assert.deepEqual(sheetCell('40%'), { t: 'n', v: 0.4, z: '0%' });
  assert.deepEqual(sheetCell('$1,250,000'), { t: 'n', v: 1250000, z: '$#,##0' });
  assert.deepEqual(sheetCell('85,000.50'), { t: 'n', v: 85000.5, z: '#,##0.00' });
  assert.equal(sheetCell('2026-09-30').t, 'd'); assert.equal(sheetCell('**Total**').v, 'Total'); assert.equal(sheetCell(''), null);
  assert.equal(sheetCell('Q3 2026').t, 's', 'text stays text');
  const md = '# Scorecard\n\n## Team KRs\n| Key result | Weight | Score | Weighted |\n|---|---|---|---|\n| Time to value | 40% | 3 | =B2*C2 |\n| Revenue \\| expansion | 60% | 2 | =B3*C3 |\n| Total | =SUM(B2:B3) |  | =SUM(D2:D3) |\n\n## README\nWeights add to 100%.\n';
  assert.deepEqual(sheetsFromMarkdown(md).map(s => [s.name, s.rows.length]), [['Team KRs', 4], ['README', 1]]);
  const dir = temp();
  try {
    fs.writeFileSync(path.join(dir, 'scorecard.md'), md);
    const saved = [];
    const out = await exportXlsxTool({ workspaceDir: dir, onSaved: r => saved.push(r) }).invoke({ source: '/work/scorecard.md' });
    assert.match(out, /^Saved \/work\/scorecard\.xlsx: 2 sheets — Team KRs \(4 rows × 4 columns\); README \(1 rows × 1 columns\), 4 formulas Excel calculates when it opens/);
    const book = XLSX.read(fs.readFileSync(path.join(dir, 'scorecard.xlsx')), { type: 'buffer', cellFormula: true, cellNF: true });
    assert.deepEqual(book.SheetNames, ['Team KRs', 'README']);
    const ws = book.Sheets['Team KRs'];
    assert.equal(ws.D2.f, 'B2*C2'); assert.equal(ws.B4.f, 'SUM(B2:B3)'); assert.equal(ws.B2.v, 0.4); assert.equal(ws.B2.z, '0%');
    assert.equal(ws.A3.v, 'Revenue | expansion', 'an escaped pipe is part of the cell');
    assert.ok(ws['!autofilter'], 'the header row gets a filter'); assert.equal(saved[0].formulas, 4);
    assert.match(await exportXlsxTool({ workspaceDir: dir }).invoke({ source: '/work/missing.md' }), /There is no file at \/work\/missing\.md/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an attached spreadsheet gets a full text copy before the run; a file that cannot be read stops the Program Manager until the CEO answers', async () => {
  const dir = temp(), office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents });
  const engine = new OfficeEngine({ dataDir: dir, office, models: {}, knowledgeDir: path.join(dir, 'k') });
  try {
    const job = engine.create({ dept: 'ops', text: 'Review the attached framework.', autoStart: false });
    const out = engine.attach(job.id, [{ name: 'Framework (draft).xlsx', bytes: XLSX.write(framework(), { type: 'buffer', bookType: 'xlsx' }) }]);
    const [result] = await out.ready;
    const copy = path.join(engine.workspaceDir(job.id), 'inbox', 'Framework _draft_.xlsx.md');
    assert.equal(result.readable, true); assert.ok(fs.existsSync(copy), 'the text copy sits beside the upload');
    assert.match(fs.readFileSync(copy, 'utf8'), /### Formulas in Team KRs/);
    assert.match(engine.brief(engine.get(job.id)), /- Framework _draft_\.xlsx: read \/work\/inbox\/Framework _draft_\.xlsx\.md \(its full text, made by the office; every sheet or slide is there\)/);
    assert.deepEqual(engine.unreadableInputs(job.id), []);
    assert.equal(engine.get(job.id).attachments[0].text, '/work/inbox/Framework _draft_.xlsx.md');

    // A read of the upload itself is pointed at the copy.
    const guard = engine.binaryReadGuard(job.id, 'olead');
    const reply = await guard.wrapToolCall({ toolCall: { id: 'c1', name: 'read_file', args: { file_path: '/work/inbox/Framework _draft_.xlsx' } } }, () => { throw new Error('the upload must not be read raw'); });
    assert.match(String(reply.content), /Its full text is at \/work\/inbox\/Framework _draft_\.xlsx\.md/);

    // A broken workbook: marked unreadable, and the Program Manager may neither delegate nor close until the CEO answers.
    const other = engine.create({ dept: 'ops', text: 'Review this one too.', autoStart: false });
    await engine.attach(other.id, [{ name: 'broken.xlsx', bytes: Buffer.from('PK corrupted') }]).ready;
    assert.deepEqual(engine.unreadableInputs(other.id).map(a => a.name), ['broken.xlsx']);
    assert.match(engine.brief(engine.get(other.id)), /- broken\.xlsx: COULD NOT BE READ \(Could not read this spreadsheet/);
    const first = engine.planFirst(other.id);
    const refused = await first.wrapToolCall({ toolCall: { id: 't1', name: 'task', args: { subagent_type: 'lead-ops', description: 'Benchmark OKR frameworks' } } }, () => { throw new Error('must not delegate'); });
    assert.match(String(refused.content), /^Refused: broken\.xlsx could not be read[\s\S]*Call ask_ceo now/);
    const closing = await first.wrapToolCall({ toolCall: { id: 't2', name: 'complete_task', args: { summary: 'x' } } }, () => { throw new Error('must not close'); });
    assert.match(String(closing.content), /^Refused: broken\.xlsx could not be read/);
    // A read of the broken upload says to stop, not to improvise.
    const broken = await engine.binaryReadGuard(other.id, 'olead').wrapToolCall({ toolCall: { id: 'c2', name: 'read_file', args: { file_path: '/work/inbox/broken.xlsx' } } }, () => { throw new Error('must not read raw'); });
    assert.match(String(broken.content), /could not be read[\s\S]*Do not replace it with general knowledge or generic work: stop/);
    // The CEO answers: go ahead without it. From then on the work may proceed.
    engine.threads.append(other.id, { role: 'ceo', kind: 'answer', text: 'Go ahead with the brief alone.', jobId: other.id });
    assert.deepEqual(engine.unreadableInputs(other.id), []);
    let delegated = false;
    engine.update(other.id, j => { j.todos = [{ content: 'Review', status: 'in_progress' }]; });
    await first.wrapToolCall({ toolCall: { id: 't3', name: 'task', args: { subagent_type: 'lead-ops', description: 'Review' } } }, () => { delegated = true; return 'ok'; });
    assert.equal(delegated, true, 'after the CEO answered, delegation goes through');
  } finally { engine.db.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});

test('a file added to a finished task with a correction reaches the Program Manager with that correction', async () => {
  const dir = temp(), office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents });
  const engine = new OfficeEngine({ dataDir: dir, office, models: {}, knowledgeDir: path.join(dir, 'k') });
  try {
    const job = engine.create({ dept: 'ops', text: 'Review the framework.', autoStart: false });
    engine.update(job.id, j => { j.startedAt = Date.now() - 60000; j.state = 'done'; j.calls = 3; j.harness = true; j.result = 'v1'; });
    await engine.attach(job.id, [{ name: 'Framework v2.xlsx', bytes: XLSX.write(framework(), { type: 'buffer', bookType: 'xlsx' }) }]).ready;
    assert.equal(engine.threads.pending(job.id).filter(m => m.meta?.attachments).length, 1, 'on a task under way the note waits for the next word to the team');
    engine.run = () => Promise.resolve(); // the scheduled text is what matters here, not a run
    engine.message(job.id, { text: 'Use the new version attached.', kind: 'correction' });
    const next = engine.get(job.id).next;
    assert.match(next.text, /CEO correction: Use the new version attached\.[\s\S]*- Framework v2\.xlsx: read \/work\/inbox\/Framework v2\.xlsx\.md/);
    assert.equal(engine.threads.pending(job.id).filter(m => m.meta?.attachments).length, 0, 'and it is passed on once');
  } finally { engine.db.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});
