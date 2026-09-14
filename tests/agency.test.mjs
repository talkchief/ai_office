import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Agency, DIVISIONS, parsePersona } from '../agency.mjs';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';
import { searchAgency } from '../src/agency-search.js';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-agency-'));

test('search ranks by job: the name and main role first, a passing mention in a description last', () => {
  const personas = [
    { id: 'w', name: 'Technical Writer', role: 'writer · docs', tags: ['writer', 'docs'], description: 'Writes guides for developers.', label: 'Writing & Documents' },
    { id: 'a', name: 'Developer Advocate', role: 'developer relations', tags: ['marketer', 'community'], description: 'Grows a community around the platform.', label: 'Marketing' },
    { id: 'r', name: 'React Developer', role: 'frontend developer · React', tags: ['developer', 'react', 'frontend'], description: 'Builds React apps.', label: 'Software Engineering' },
    { id: 'b', name: 'Backend Architect', role: 'backend architect', tags: ['architect', 'developer', 'api'], description: 'Designs services and their APIs.', label: 'Software Engineering' },
  ];
  const ids = q => searchAgency(personas, { q }).map(p => p.id);
  assert.deepEqual(ids('developer'), ['r', 'a', 'b', 'w']);
  assert.deepEqual(ids('Developers'), ids('developer'), 'case and plural do not matter');
  assert.deepEqual(ids('react dev'), ['r'], 'every word has to match, and a dev is a developer');
  assert.deepEqual(ids('api'), ['b']); assert.deepEqual(ids('nothing like this'), []);
  assert.deepEqual(ids(''), ['w', 'a', 'r', 'b'], 'no query keeps the catalogue order');
});

test('the curated catalogue reads like a staffing list and "developer" finds developers', () => {
  const agency = new Agency(), all = agency.list();
  assert.deepEqual(Object.keys(agency.divisions()).filter(d => !DIVISIONS[d]), [], 'every division is a known one');
  for (const p of all) { assert.ok(p.tags.length, p.id + ' has tags'); assert.ok(p.name.length <= 48, p.id); assert.doesNotMatch(p.name, /^IT Professional|\b(Qa|Ai|Api|Sql|Seo)\b/, p.id); }
  assert.equal(new Set(all.map(p => p.name.toLowerCase())).size, all.length, 'every name is unique');
  const devs = agency.list({ q: 'developer' }).slice(0, 40);
  assert.deepEqual(devs.filter(p => !p.tags.includes('developer') && !/\bdeveloper\b/i.test(p.name)).map(p => p.name), []);
});

test('the vendored Agency catalogue loads, every persona parses to a person, and the Program Manager has its skills', () => {
  const agency = new Agency(); const all = agency.list();
  assert.ok(all.length > 200, 'catalogue is vendored'); assert.ok(Object.keys(agency.divisions()).length >= 15);
  for (const entry of all) { const p = agency.get(entry.id); assert.ok(p.name && p.role && p.does && p.body.length > 200, entry.id); assert.ok(p.brief.length <= 2000 && p.role.length <= 120); }
  assert.ok(agency.list({ division: 'project-management' }).length >= 5); assert.ok(agency.list({ q: 'shepherd' }).some(p => p.id === 'project-management-project-shepherd'));
  const pm = fs.readdirSync(path.join(process.cwd(), 'agency', 'pm-skills')).filter(d => fs.existsSync(path.join('agency', 'pm-skills', d, 'SKILL.md')));
  for (const name of ['running-a-task', 'cross-team-handoff', 'project-shepherd']) assert.ok(pm.includes(name), name);
  // Files checked out with CRLF (git autocrlf on Windows) are the same skills; the parser accepts both line endings.
  for (const d of pm) assert.match(fs.readFileSync(path.join('agency', 'pm-skills', d, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n'), /^---\nname: [a-z0-9-]+\ndescription: .+\n---\n/, d + ' front matter');
  assert.equal(parsePersona('no front matter'), null);
});

test('the FDE, applied AI, architecture, delivery and strategy set arrives whole: full methods, whole briefs, leaders named as leadership', () => {
  const agency = new Agency();
  const leaders = ['business-forward-deployed-engineering-leadership', 'ai-applied-ai-engineering-leadership', 'engineering-solution-architecture-leadership', 'project-management-technical-delivery-leadership', 'business-corporate-strategy-leadership'];
  const specialists = ['business-deployment-strategist', 'engineering-forward-deployed-engineer', 'business-okr-performance-framework-architect', 'business-services-led-growth-strategist'];
  for (const id of [...leaders, ...specialists]) {
    const p = agency.get(id), skill = agency.skillOf(p);
    assert.doesNotMatch(skill.instructions, /\(Shortened/, `${id}: the method is not cut`);
    assert.ok(p.body.length > 10000, `${id}: a real method, not a stub`);
    assert.ok(p.brief.length < 2000 && /[.)!?`"'\w]$/.test(p.brief.trim()), `${id}: the standing instructions end on a whole line`);
    assert.match(p.body, /## 📚 Sources[\s\S]*https:\/\//, `${id}: names its sources`);
    assert.match(p.body, /export_xlsx/, `${id}: knows the office can build a workbook`);
    assert.equal(p.name.endsWith(' Leadership'), leaders.includes(id), `${id}: a managerial persona, and only one, ends in Leadership`);
  }
  assert.equal(agency.list({ q: 'fde' })[0].id, 'business-forward-deployed-engineering-leadership');
  assert.equal(agency.list({ q: 'mbo' })[0].id, 'business-okr-performance-framework-architect');
});

test('hiring a persona adds a person and its method as a skill; full teams and the lead swap are handled', () => {
  const dir = temp(), office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents }), agency = new Agency();
  try {
    const team = office.get().teams.find(t => office.get().agents.filter(a => a.department === t.id).length < 7);
    const hired = agency.hire(office, 'marketing-seo-specialist', { dept: team.id });
    assert.equal(hired.person.department, team.id); assert.equal(hired.person.lead, false); assert.ok(hired.person.brief.length > 50);
    assert.deepEqual(hired.person.skills, [hired.skill.id]); assert.ok(hired.skill.instructions.length <= 24000 && /SEO/i.test(hired.skill.instructions));
    // A persona is hired once per office: the second hire, on any team, is refused with where the first one works.
    assert.equal(hired.person.persona, 'marketing-seo-specialist', 'the person remembers the persona they came from');
    assert.deepEqual(agency.hired(office.get())['marketing-seo-specialist'], { dept: team.id, team: team.name, agent: hired.person.id, name: hired.person.name, lead: false });
    const other = office.get().teams.find(t => t.id !== team.id);
    assert.throws(() => agency.hire(office, 'marketing-seo-specialist', { dept: team.id, name: 'SEO TWO' }), e => e.status === 409 && new RegExp(`already hired: ${hired.person.name} works on ${team.name}`).test(e.message));
    assert.throws(() => agency.hire(office, 'marketing-seo-specialist', { dept: other.id, lead: true }), /already hired/, 'not as another team’s lead either');
    assert.equal(office.get().agents.filter(a => a.persona === 'marketing-seo-specialist').length, 1);
    const swapped = agency.hire(office, 'project-management-project-shepherd', { dept: team.id, lead: true });
    assert.equal(swapped.person.id, team.lead); assert.equal(swapped.person.lead, true); assert.match(swapped.person.role, /project/i);
    assert.equal(agency.hired(office.get())['project-management-project-shepherd'].lead, true, 'a lead who took the persona’s job counts as hired');
    // The persona survives a round trip through the office file, and leaving the team frees it.
    office.update(office.get(), new Set()); assert.equal(office.get().agents.find(a => a.id === hired.person.id).persona, 'marketing-seo-specialist');
    const fired = office.get(); fired.agents = fired.agents.filter(a => a.id !== hired.person.id); office.update(fired, new Set());
    assert.equal(agency.hired(office.get())['marketing-seo-specialist'], undefined, 'removed, the persona can be hired again');
    assert.equal(agency.hire(office, 'marketing-seo-specialist', { dept: team.id }).person.persona, 'marketing-seo-specialist');
    // People hired before personas were recorded are recognised by the id a hire gave them, or a lead by method and role together.
    const legacy = office.get(), spare = legacy.teams.find(t => legacy.agents.filter(a => a.department === t.id).length < 7 && t.id !== team.id);
    if (spare) {
      const writer = agency.get('engineering-technical-writer'); legacy.skills.push(agency.skillOf(writer));
      legacy.agents.push({ id: 'agency-engineering-technical-writer', department: spare.id, name: 'OLD WRITER', role: writer.role, does: writer.does, brief: writer.brief, skills: [agency.skillOf(writer).id] });
      office.update(legacy, new Set());
      assert.equal(agency.hired(office.get())['engineering-technical-writer']?.name, 'OLD WRITER');
    }
    const full = office.get().teams.find(t => office.get().agents.filter(a => a.department === t.id).length >= 7);
    if (full) assert.throws(() => agency.hire(office, 'marketing-content-strategist', { dept: full.id }), /full/);
    const skillOnly = agency.addSkill(office, 'sales-outbound-strategist', { teams: [team.id] });
    assert.deepEqual(skillOnly.teams, [team.id]); assert.ok(office.get().teams.find(t => t.id === team.id).skills.includes(skillOnly.skill.id));
    assert.equal(agency.hired(office.get())['sales-outbound-strategist'], undefined, 'a method added on its own is not a hire');
    assert.throws(() => agency.get('nobody'), /No such persona/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('every persona the index lists has its file in the repository, and no ignore rule keeps one out of it', () => {
  // A bare "data/" in .gitignore once kept the whole Data & Analytics division out of every commit: listed, never hireable.
  const index = JSON.parse(fs.readFileSync(path.join('agency', 'index.json'), 'utf8'));
  const missing = index.personas.filter(p => !fs.existsSync(path.join('agency', 'personas', p.division, p.id + '.md'))).map(p => p.id);
  assert.deepEqual(missing, [], `${missing.length} listed personas have no file`);
  for (const division of new Set(index.personas.map(p => p.division))) {
    let ignored = '';
    try { ignored = execFileSync('git', ['check-ignore', path.join('agency', 'personas', division, 'probe.md')], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {} // exit 1: not ignored (or no git)
    assert.equal(ignored, '', `.gitignore keeps agency/personas/${division}/ out of the repository`);
  }
});

test('a persona the index lists without a file is left out of the list, and asking for it is a sentence, not a crash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-agency-'));
  try {
    fs.mkdirSync(path.join(dir, 'personas', 'data'), { recursive: true });
    const real = fs.readFileSync(path.join('agency', 'personas', 'data', 'data-snowflake-data-engineer.md'), 'utf8');
    fs.writeFileSync(path.join(dir, 'personas', 'data', 'data-snowflake-data-engineer.md'), real);
    const listed = id => ({ id, division: 'data', label: 'Data & Analytics', name: id === 'data-gone' ? 'Gone Engineer' : 'Snowflake Data Engineer', description: 'x'.repeat(40), emoji: '❄️', role: 'engineer', tags: ['engineer'] });
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ divisions: { data: 'Data & Analytics' }, personas: [listed('data-snowflake-data-engineer'), listed('data-gone')] }));
    const agency = new Agency({ dir });
    assert.deepEqual(agency.list().map(p => p.id), ['data-snowflake-data-engineer'], 'only a persona that can be hired is offered');
    assert.equal(agency.get('data-snowflake-data-engineer').name, 'Snowflake Data Engineer');
    assert.throws(() => agency.get('data-gone'), e => e.status === 404, 'not a raw ENOENT');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
