import test from 'node:test';
import assert from 'node:assert/strict';
import { kindOf, collectArtifacts, filterArtifacts, ARTIFACT_KINDS } from '../server/artifacts.mjs';

const office = { teams: [{ id: 'sales', name: 'SALES' }, { id: 'fin', name: 'FINANCE' }] };
const day = d => +new Date(d);
const jobs = [
  { id: 'j1', title: 'Growth plan price change', state: 'done', dept: 'fin', depts: ['fin'], projectId: null, runs: [{ role: 'lead', dept: 'fin' }, { role: 'lead', dept: 'sales' }] },
  { id: 'j2', title: 'Client portal sign-off package', state: 'working', dept: 'auto', autoRoute: true, depts: ['emails', 'sales', 'fin'], projectId: 'client-portal-launch', runs: [{ role: 'lead', dept: 'fin' }] },
];
const files = {
  j1: [{ name: 'growth-price-change/01-accounting-price-table.md', bytes: 4000, modifiedAt: day('2026-09-11T01:26:00Z'), type: 'text/markdown' }, { name: 'pack.pdf', bytes: 90000, modifiedAt: day('2026-09-11T01:40:00Z'), type: 'application/pdf' }],
  j2: [{ name: 'qa/audit.pptx', bytes: 30000, modifiedAt: day('2026-09-10T22:00:00Z'), type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }, { name: 'notes.csv', bytes: 100, modifiedAt: day('2026-09-09T09:00:00Z'), type: 'text/csv' }],
};

test('every file is sorted into a kind the filter understands', () => {
  assert.equal(kindOf('brief.pdf'), 'pdf'); assert.equal(kindOf('deck.pptx'), 'deck'); assert.equal(kindOf('a/b/notes.md'), 'markdown');
  assert.equal(kindOf('data.csv'), 'data'); assert.equal(kindOf('brief.docx'), 'doc'); assert.equal(kindOf('sheet.xlsx'), 'data'); assert.equal(kindOf('x.json'), 'json'); assert.equal(kindOf('page.html'), 'html'); assert.equal(kindOf('shot.png'), 'image'); assert.equal(kindOf('log.txt'), 'text'); assert.equal(kindOf('archive.zip'), 'other');
  assert.deepEqual(ARTIFACT_KINDS.map(k => k.id), ['pdf', 'deck', 'doc', 'data', 'json', 'markdown', 'html', 'image', 'text', 'other']);
});

test('artifacts are collected across tasks, newest first, with the task, the teams that worked and a download address', () => {
  const rows = collectArtifacts({ jobs, filesFor: id => files[id], office });
  assert.deepEqual(rows.map(r => r.name), ['pack.pdf', 'growth-price-change/01-accounting-price-table.md', 'qa/audit.pptx', 'notes.csv']);
  const pdf = rows[0];
  assert.equal(pdf.taskTitle, 'Growth plan price change'); assert.deepEqual(pdf.teams, ['FINANCE', 'SALES']); assert.equal(pdf.kind, 'pdf');
  assert.equal(pdf.url, '/api/tasks/j1/file?path=pack.pdf');
  assert.equal(rows[1].url, '/api/tasks/j1/file?path=growth-price-change%2F01-accounting-price-table.md');
  assert.equal(rows[2].projectId, 'client-portal-launch'); assert.deepEqual(rows[2].teams, ['FINANCE'], 'a task left to the PM lists only the teams that worked');
  const broken = collectArtifacts({ jobs, filesFor: id => { if (id === 'j2') throw new Error('gone'); return files[id]; }, office });
  assert.equal(broken.length, 2, 'a task whose workspace cannot be read is skipped, not fatal');
});

test('the list filters by kind, by an inclusive date range and by words in the file or task name', () => {
  const rows = collectArtifacts({ jobs, filesFor: id => files[id], office });
  assert.deepEqual(filterArtifacts(rows, { kind: 'deck' }).map(r => r.name), ['qa/audit.pptx']);
  assert.deepEqual(filterArtifacts(rows, { from: '2026-09-11' }).map(r => r.name), ['pack.pdf', 'growth-price-change/01-accounting-price-table.md']);
  assert.deepEqual(filterArtifacts(rows, { to: '2026-09-10' }).map(r => r.name), ['qa/audit.pptx', 'notes.csv'], 'to is inclusive of the whole day');
  assert.deepEqual(filterArtifacts(rows, { from: '2026-09-10', to: '2026-09-10' }).map(r => r.name), ['qa/audit.pptx']);
  assert.deepEqual(filterArtifacts(rows, { q: 'portal' }).map(r => r.name), ['qa/audit.pptx', 'notes.csv']);
  assert.deepEqual(filterArtifacts(rows, { q: 'price table finance' }).map(r => r.name), ['growth-price-change/01-accounting-price-table.md']);
  assert.equal(filterArtifacts(rows, {}).length, 4);
  assert.deepEqual(filterArtifacts(rows, { kind: 'documents' }).map(r => r.name), ['pack.pdf', 'qa/audit.pptx', 'notes.csv'], 'documents are the usable files: no Markdown drafts');
});
