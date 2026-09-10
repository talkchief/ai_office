import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agency, parsePersona } from '../agency.mjs';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-agency-'));

test('the vendored Agency catalogue loads, every persona parses to a person, and the Program Manager has its skills', () => {
  const agency = new Agency(); const all = agency.list();
  assert.ok(all.length > 200, 'catalogue is vendored'); assert.ok(Object.keys(agency.divisions()).length >= 15);
  for (const entry of all) { const p = agency.get(entry.id); assert.ok(p.name && p.role && p.does && p.body.length > 200, entry.id); assert.ok(p.brief.length <= 2000 && p.role.length <= 120); }
  assert.ok(agency.list({ division: 'project-management' }).length >= 5); assert.ok(agency.list({ q: 'shepherd' }).some(p => p.id === 'project-management-project-shepherd'));
  const pm = fs.readdirSync(path.join(process.cwd(), 'agency', 'pm-skills')).filter(d => fs.existsSync(path.join('agency', 'pm-skills', d, 'SKILL.md')));
  for (const name of ['running-a-task', 'cross-team-handoff', 'project-shepherd']) assert.ok(pm.includes(name), name);
  for (const d of pm) assert.match(fs.readFileSync(path.join('agency', 'pm-skills', d, 'SKILL.md'), 'utf8'), /^---\nname: [a-z0-9-]+\ndescription: .+\n---\n/, d + ' front matter');
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
