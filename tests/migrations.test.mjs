import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';
import { OfficeEngine } from '../engine/deep-agents.mjs';
import { KnowledgeStore } from '../knowledge.mjs';
import { runMigrations } from '../migrations.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-migrate-'));
const v1 = (id, state, extra = {}) => ({ id, dept: 'marketing', title: 'Old ' + state, text: 'Old task ' + state, kind: 'task', agent: 'mlead', team: { name: 'Marketing', lead: 'mlead', maxCalls: 16 }, agents: [{ id: 'mlead' }],
  state, priority: 1, createdAt: 1000, updatedAt: 2000, subtasks: [{ id: 'step-1', title: 'Draft', agent: 'riley', state: state === 'done' ? 'done' : 'working', output: 'Draft text', eligible: ['riley'] }],
  reviews: [], review: state === 'done' ? { approved: true, summary: 'Good', at: 1500, agent: 'mlead' } : null, result: state === 'done' ? 'Final text' : '', calls: 3, tokens: 100, requireHumanApproval: state === 'waiting', ...extra });

test('old task records upgrade once: results and history kept, rosters and old checkpoints dropped', async () => {
  const dir = temp();
  try {
    const legacyOffice = { version: 1, revision: 4, agents: loadRoster().agents.map(a => ({ ...a, model: 'sonnet' })), teams: [] };
    const seed = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents });
    const raw = seed.get(); delete raw.schema; for (const a of raw.agents) a.model = 'sonnet'; fs.writeFileSync(seed.file, JSON.stringify(raw));
    const office = new OfficeStore({ dataDir: dir, initialAgents: legacyOffice.agents });
    const engine = new OfficeEngine({ dataDir: dir, office, models: {}, knowledgeDir: path.join(dir, 'knowledge') });
    const knowledge = new KnowledgeStore(path.join(dir, 'knowledge'));
    await knowledge.save({ title: 'Conversation RILEY', content: '# RILEY — conversation\n\nRecorded: now · Unreviewed answer; not verified task evidence.' });
    await knowledge.save({ title: 'Pricing', content: '# Pricing\n\nOur prices.' });
    for (const job of [v1('a-done', 'done', { doneAt: 1600 }), v1('b-waiting', 'waiting'), v1('c-queued', 'queued', { calls: 0 }), v1('d-cancelled', 'cancelled')])
      engine.db.prepare('INSERT INTO office_jobs(id, body) VALUES (?, ?)').run(job.id, JSON.stringify(job));
    const first = await runMigrations({ engine, office, knowledge, brainPath: path.join(dir, 'brain') });
    assert.deepEqual(first, { office: true, jobs: 4, skills: 0, conversations: 1 });
    const done = engine.get('a-done'), waiting = engine.get('b-waiting'), queued = engine.get('c-queued');
    assert.equal(done.state, 'done'); assert.equal(done.resultVersions[0].result, 'Final text'); assert.equal(done.reviewsByDept.marketing.approved, true);
    assert.equal(done.team, undefined); assert.equal(done.agents, undefined); assert.equal(done.runs[0].agent, 'riley'); assert.equal(done.teamName, 'Marketing');
    assert.equal(waiting.state, 'blocked'); assert.match(waiting.error, /before the office upgrade/); assert.equal(waiting.runs[0].state, 'interrupted');
    assert.equal(queued.state, 'queued'); assert.equal(queued.startedAt, null);
    assert.equal(engine.threads.list('a-done')[0].text, 'Old task done');
    assert.equal(JSON.parse(fs.readFileSync(office.file, 'utf8')).schema, 2); assert.ok(office.agents().every(a => a.model === ''));
    assert.deepEqual(knowledge.list().map(n => n.title), ['Pricing']);
    const again = await runMigrations({ engine, office, knowledge, brainPath: path.join(dir, 'brain') });
    assert.deepEqual(again, { office: false, jobs: 0, skills: 0, conversations: 0 });
    await engine.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
