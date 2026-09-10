import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OfficeStore } from '../office-store.mjs';
import { KnowledgeStore } from '../knowledge.mjs';
import { loadRoster } from '../roster.mjs';
import { extractDocument } from '../documents.mjs';
import { OfficeEngine } from '../engine/deep-agents.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-office-'));

test('teams support real roster edits and protect the lead/worker separation', () => {
  const dir = temp(), store = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents });
  try {
    const config = store.get();
    config.agents.push({ id: 'new-writer', name: 'Writer', role: 'Copywriter', department: 'fin', does: 'Writes the finance team’s client-facing copy.', brief: 'Plain words, numbers from the ledger, nothing sent without the CEO.' });
    config.teams.find(t => t.id === 'fin').lead = 'new-writer';
    const updated = store.update(config);
    assert.equal(updated.agents.find(a => a.id === 'new-writer').lead, true); assert.equal(updated.agents.find(a => a.id === 'alead').lead, false);
    assert.throws(() => store.update(config), /another tab/);
    const invalid = store.get(); invalid.agents = invalid.agents.filter(a => a.id !== 'new-writer');
    assert.throws(() => store.update(invalid), /Assign a lead/);
    const busy = store.get(); busy.agents = busy.agents.filter(a => a.id !== 'riley');
    assert.throws(() => store.update(busy, new Set(['riley'])), /unfinished work/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('older team settings map to the new pace, model and approval fields; budgets are dropped', () => {
  const dir = temp(), store = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents });
  try {
    const cfg = store.get(), team = cfg.teams[0]; delete cfg.schema; delete team.maxParallelRuns; delete team.maxReworkRounds; delete team.models; delete team.completionApproval;
    Object.assign(team, { concurrency: 3, maxRevisions: 1, maxCalls: 5, maxTokens: 9000, maxSubtasks: 2, planningModel: 'opus', reviewModel: 'sonnet', requireHumanApproval: true });
    cfg.agents[0].model = 'sonnet'; cfg.agents[1].model = 'opus';
    const saved = store.update(cfg), t = saved.teams[0];
    assert.equal(t.maxParallelRuns, 3); assert.equal(t.maxReworkRounds, 1); assert.equal(t.completionApproval, true);
    assert.deepEqual(t.models, { lead: 'opus', specialist: '', review: '' });
    for (const key of ['maxCalls', 'maxTokens', 'maxSubtasks', 'concurrency', 'maxRevisions', 'requireHumanApproval']) assert.equal(t[key], undefined);
    assert.equal(saved.agents[0].model, ''); assert.equal(saved.agents[1].model, 'opus'); assert.equal(saved.schema, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the Brain is editable, protected from traversal and symlinks, and archived notes leave retrieval', async () => {
  const dir = temp(), store = new KnowledgeStore(dir);
  try {
    const note = await store.save({ title: 'Purpose', content: '# Purpose\nHelp our customers with harbour cruises.' });
    await store.save({ id: 'Finance/snow.md', content: '# Snow research\nSnowflake revenue grew; cite task 42.' });
    assert.equal(store.list().length, 2); assert.match(store.read(note.id).content, /customers/);
    assert.deepEqual(store.retrieve('snowflake revenue').notes, ['Finance/snow.md']);
    assert.throws(() => store.read('../outside.md'), /Invalid/);
    // Creating a symlink needs a privilege Windows does not grant by default; the traversal check above runs everywhere.
    let linked = true; try { fs.symlinkSync(process.platform === 'win32' ? os.tmpdir() : '/etc', path.join(dir, 'linked'), 'dir'); } catch (error) { if (process.platform !== 'win32') throw error; linked = false; }
    if (linked) assert.throws(() => store.read('linked/test.md'), /Linked/);
    await store.archive('Finance/snow.md');
    assert.equal(store.list().length, 1); assert.deepEqual(store.retrieve('snowflake revenue').notes, []);
    assert.equal(fs.readdirSync(path.join(dir, '.archive')).length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('documents are parsed as text and unsupported uploads fail clearly', async () => {
  const doc = await extractDocument({ name: 'requirements.md', data: Buffer.from('# Project\nLaunch requirements').toString('base64') });
  assert.match(doc.content, /Launch requirements/);
  await assert.rejects(extractDocument({ name: 'program.exe', data: Buffer.from('MZ').toString('base64') }));
});

test('a task keeps the skill versions it started with', async () => {
  const dir = temp(), office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents });
  const engine = new OfficeEngine({ dataDir: dir, office, models: {}, knowledgeDir: path.join(dir, 'knowledge') });
  try {
    let config = office.get(); config.skills = [{ id: 'fact-check', name: 'Fact check', instructions: 'Use supplied facts.' }]; config.teams.find(t => t.id === 'marketing').skills = ['fact-check']; office.update(config);
    const job = engine.create({ dept: 'marketing', text: 'Check facts.', autoStart: false }); assert.equal(job.skills[0].revision, 1);
    config = office.get(); config.skills[0].instructions = 'Require named sources.'; office.update(config);
    assert.equal(office.get().skills[0].revision, 2); assert.equal(engine.get(job.id).skills[0].instructions, 'Use supplied facts.');
    config = office.get(); config.skills = []; assert.throws(() => office.update(config), /Unassign/);
  } finally { await engine.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('documents upload into Brain folders; the same path replaces the note and archives the previous copy', async () => {
  const dir = temp(), store = new KnowledgeStore(dir), seen = [];
  store.on('write', id => seen.push(['write', id])).on('remove', id => seen.push(['remove', id]));
  try {
    const first = await store.upload({ folder: 'Projects', name: 'Launch plan.pdf', content: 'October launch.' });
    assert.equal(first.id, 'Projects/Launch plan.md'); assert.equal(first.replaced, null); assert.match(store.read(first.id).content, /Source file: Launch plan\.pdf/);
    const second = await store.upload({ folder: 'Projects', name: 'Launch plan.pdf', content: 'November launch.' });
    assert.match(second.replaced, /^\.archive\/\d+-Launch plan\.md$/); assert.match(store.read(first.id).content, /November/);
    assert.match(fs.readFileSync(path.join(dir, second.replaced), 'utf8'), /October/);
    await assert.rejects(store.upload({ folder: '../etc', name: 'x.md', content: 'x' }), /folder/);
    assert.ok(store.folders().includes('Projects') && store.folders().includes('Company'));
    await store.writeNote('Status/big.md', '# Big\n' + 'x'.repeat(100000));
    await store.archive('Status/big.md');
    assert.deepEqual(seen, [['write', 'Projects/Launch plan.md'], ['write', 'Projects/Launch plan.md'], ['write', 'Status/big.md'], ['remove', 'Status/big.md']]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('every team has a charter and every person a brief; empty ones are refused, older files are filled once', async () => {
  const { OfficeStore } = await import('../office-store.mjs');
  const { loadRoster } = await import('../roster.mjs');
  const { TEAM_CHARTERS, fillOrganisation } = await import('../office-charters.mjs');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-charters-'));
  const store = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents });
  const office = store.get();
  for (const t of office.teams) { assert.ok(t.purpose.length > 40, `${t.id} has a purpose`); assert.ok(t.instructions.includes('\n'), `${t.id} has working instructions`); }
  for (const a of office.agents) assert.ok(a.brief.length > 40, `${a.id} has a brief`);
  assert.equal(office.teams.find(t => t.id === 'fin').purpose, TEAM_CHARTERS.fin.purpose);

  const noPurpose = store.get(); noPurpose.teams[0].purpose = '  ';
  assert.throws(() => store.update(noPurpose), /EMAILS needs a purpose/);
  const noInstructions = store.get(); noInstructions.teams[1].instructions = '';
  assert.throws(() => store.update(noInstructions), /SALES needs working instructions/);
  const noBrief = store.get(); noBrief.agents.find(a => a.id === 'riley').brief = '';
  assert.throws(() => store.update(noBrief), /RESEARCH needs standing instructions/);
  const noDoes = store.get(); noDoes.agents.find(a => a.id === 'riley').does = '';
  assert.throws(() => store.update(noDoes), /RESEARCH needs a job description/);

  // An office file written before charters existed loads, gets filled where empty, and is written back once.
  const old = store.get();
  for (const t of old.teams) { t.purpose = ''; t.instructions = ''; }
  for (const a of old.agents) a.brief = '';
  old.teams.push({ id: 'people', name: 'PEOPLE', lead: 'hr1', purpose: '', instructions: '', criteria: ['ok'], checks: [], tools: [], skills: [], tests: [], rules: [], models: {} });
  old.agents.push({ id: 'hr1', department: 'people', name: 'HR LEAD', role: 'People lead', does: '', brief: '', tools: [], skills: [], rules: [] }, { id: 'hr2', department: 'people', name: 'RECRUITER', role: 'Recruiter', does: 'Finds candidates.', brief: '', tools: [], skills: [], rules: [] });
  fs.writeFileSync(path.join(dir, 'office.json'), JSON.stringify(old));
  const reopened = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents }).get();
  assert.equal(reopened.teams.find(t => t.id === 'marketing').instructions, TEAM_CHARTERS.marketing.instructions, 'a shipped charter fills a default team');
  assert.match(reopened.teams.find(t => t.id === 'people').purpose, /Own the PEOPLE work/, 'a custom team gets a generic charter');
  assert.match(reopened.agents.find(a => a.id === 'hr1').does, /People lead in the PEOPLE team/, 'a custom person gets a job line');
  assert.match(reopened.agents.find(a => a.id === 'hr2').brief, /Your job: Finds candidates\./, 'a custom person gets a brief from what they do');
  assert.equal(reopened.agents.find(a => a.id === 'riley').brief, loadRoster().agents.find(a => a.id === 'riley').brief, 'a default seat gets the shipped brief');
  const again = JSON.parse(fs.readFileSync(path.join(dir, 'office.json'), 'utf8'));
  assert.equal(fillOrganisation(again, loadRoster().agents).changed, false, 'the fill is idempotent');
});
