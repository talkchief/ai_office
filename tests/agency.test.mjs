import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

test('hiring a persona adds a person and its method as a skill; full teams and the lead swap are handled', () => {
  const dir = temp(), office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents }), agency = new Agency();
  try {
    const team = office.get().teams.find(t => office.get().agents.filter(a => a.department === t.id).length < 7);
    const hired = agency.hire(office, 'marketing-seo-specialist', { dept: team.id });
    assert.equal(hired.person.department, team.id); assert.equal(hired.person.lead, false); assert.ok(hired.person.brief.length > 50);
    assert.deepEqual(hired.person.skills, [hired.skill.id]); assert.ok(hired.skill.instructions.length <= 10000 && /SEO/i.test(hired.skill.instructions));
    const again = agency.hire(office, 'marketing-seo-specialist', { dept: team.id, name: 'SEO TWO' });
    assert.notEqual(again.person.id, hired.person.id); assert.equal(office.get().skills.filter(s => s.id === hired.skill.id).length, 1, 'the skill is shared, not duplicated');
    const swapped = agency.hire(office, 'project-management-project-shepherd', { dept: team.id, lead: true });
    assert.equal(swapped.person.id, team.lead); assert.equal(swapped.person.lead, true); assert.match(swapped.person.role, /project/i);
    const full = office.get().teams.find(t => office.get().agents.filter(a => a.department === t.id).length >= 7);
    if (full) assert.throws(() => agency.hire(office, 'marketing-seo-specialist', { dept: full.id }), /full/);
    const skillOnly = agency.addSkill(office, 'sales-outbound-strategist', { teams: [team.id] });
    assert.deepEqual(skillOnly.teams, [team.id]); assert.ok(office.get().teams.find(t => t.id === team.id).skills.includes(skillOnly.skill.id));
    assert.throws(() => agency.get('nobody'), /No such persona/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
