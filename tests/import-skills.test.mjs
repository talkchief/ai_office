import test from 'node:test';
import assert from 'node:assert/strict';
import { personaFromSkill, titleOf, readFrontMatter, renderSkillPersona } from '../scripts/import-skills.mjs';
import { skillParts, withFrontMatter, problemsOf } from '../scripts/agency-curate.mjs';
import { parsePersona } from '../agency.mjs';

const SKILL = `---
id: systematic-debugging
name: systematic-debugging
description: "Find the root cause before changing anything: reproduce, read the error, trace the data, then fix once."
category: development
risk: critical
---
# Systematic debugging

Use this whenever something fails.

## 1. Reproduce
- Trigger it reliably before touching code.

## 2. Read the error
- The message names the file and the line; read all of it.

## 3. Fix once
- One change, then the test that proves it.
`;

test('a skill becomes a persona the office can hire', () => {
  const p = personaFromSkill(SKILL, { id: 'systematic-debugging', division: 'engineering', source: 'agentic-awesome-skills (MIT)' });
  assert.equal(p.name, 'Systematic Debugging'); assert.equal(p.id, 'engineering-systematic-debugging'); assert.equal(p.risk, 'critical');
  const parsed = parsePersona(p.text, { division: 'engineering', file: p.id + '.md' });
  assert.equal(parsed.name, 'Systematic Debugging');
  assert.equal(parsed.role, 'Systematic Debugging specialist (development)');
  assert.match(parsed.description, /^Find the root cause before changing anything/);
  assert.match(parsed.brief, /Follow the skill's own rules/); assert.match(parsed.brief, /Apply the Systematic Debugging skill to the assignment/);
  assert.match(parsed.body, /## 1\. Reproduce[\s\S]*## 3\. Fix once/, 'the skill text is the method');
  assert.match(p.text, /source: agentic-awesome-skills \(MIT\) · systematic-debugging/);
});

test('a long skill is cut at a heading, titles read well, and front matter without quotes is fine', () => {
  const long = SKILL + '\n## 4. More\n\n' + 'x'.repeat(9000) + '\n\n## 5. Even more\n\ntext';
  const p = personaFromSkill(long, { id: 'systematic-debugging', max: 2000 });
  assert.ok(p.text.includes('(Shortened: the skill continues in its source.)'));
  assert.ok(!p.text.includes('## 5. Even more'), 'cut before the heading past the limit');
  assert.equal(titleOf('00-andruia-consultant'), 'Andruia Consultant'); assert.equal(titleOf('api-fuzzing-bug-bounty'), 'API Fuzzing Bug Bounty'); assert.equal(titleOf('sql-sentinel'), 'SQL Sentinel');
  assert.equal(titleOf('nextjs-e2e-testing'), 'Next.js E2E Testing'); assert.equal(titleOf('ai-agents-architect'), 'AI Agents Architect');
  assert.deepEqual(readFrontMatter('---\nname: x\nrisk: safe\n---\nBody').meta, { name: 'x', risk: 'safe' });
  assert.equal(personaFromSkill('# No front matter\n\nJust text.', { id: 'plain-skill' }).name, 'Plain Skill');
});

test('curation gives an imported persona a job title, a role line and tags, and keeps its method', () => {
  const raw = personaFromSkill(SKILL, { id: 'systematic-debugging', prefix: 'IT Professional ', source: 'agentic-awesome-skills (MIT)' }).text;
  const parts = skillParts(raw.replace(/\n/g, '\r\n')); // a CRLF checkout reads the same
  assert.equal(parts.title, 'Systematic Debugging'); assert.equal(parts.category, 'development'); assert.match(parts.source, /· systematic-debugging$/);
  assert.match(parts.method, /^Use this whenever something fails\.[\s\S]*## 3\. Fix once/); assert.doesNotMatch(parts.method, /Critical Rules/);
  const text = renderSkillPersona({ ...parts, name: 'Debugging Specialist', description: 'Finds the root cause of a failure before changing any code.', role: 'debugger · root cause first', tags: ['engineer', 'developer', 'debugging'], emoji: '🐞' });
  const p = parsePersona(text, { division: 'engineering', file: 'engineering-debugging-specialist.md' });
  assert.equal(p.name, 'Debugging Specialist'); assert.equal(p.role, 'debugger · root cause first'); assert.deepEqual(p.tags, ['engineer', 'developer', 'debugging']); assert.equal(p.emoji, '🐞');
  assert.match(p.body, /## 3\. Fix once/); assert.doesNotMatch(text, /IT Professional/);
  assert.equal(skillParts(text).method, parts.method, 'curating again keeps the method whole');
});

test('curation rewrites a hand-written persona’s front matter, folded lines included, and keeps its body', () => {
  const original = '---\nname: SRE (Site Reliability Engineer)\ndescription: >\n  Folded text\n  over lines\ncolor: blue\nemoji: 🛡️\nvibe: Calm.\n---\n\n# SRE (Site Reliability Engineer) Agent\n\nYou are **SRE (Site Reliability Engineer)**, calm.\n\n## Identity\n- **Role**: reliability\n';
  const text = withFrontMatter(original, { name: 'Site Reliability Engineer', description: 'Keeps production up with SLOs and error budgets.', role: 'site reliability engineer · SLOs', tags: ['engineer', 'sre'], emoji: '🛡️' });
  const { meta } = readFrontMatter(text);
  assert.equal(meta.name, 'Site Reliability Engineer'); assert.equal(meta.description, 'Keeps production up with SLOs and error budgets.'); assert.equal(meta.color, 'blue'); assert.equal(meta.vibe, 'Calm.');
  assert.doesNotMatch(text, /Folded text|over lines/);
  assert.match(text, /\n# Site Reliability Engineer Agent\n/); assert.match(text, /You are \*\*Site Reliability Engineer\*\*, calm\./);
  const p = parsePersona(text, { division: 'devops', file: 'engineering-sre.md' }); assert.equal(p.role, 'site reliability engineer · SLOs'); assert.deepEqual(p.tags, ['engineer', 'sre']);
});

test('a curation file with a name clash, an unknown division, a leftover prefix or an unknown id is refused', () => {
  const index = { personas: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }, { id: 'c', name: 'Gamma' }] };
  const good = { keep: true, description: 'Does one clear and useful thing for the team.', tags: ['developer'], division: 'engineering' };
  assert.deepEqual(problemsOf([{ id: 'a', ...good, name: 'Alpha Developer' }, { id: 'b', keep: false, dropReason: 'duplicate of a' }], index), []);
  const problems = problemsOf([{ id: 'a', ...good, name: 'Gamma' }, { id: 'b', ...good, name: 'IT Professional Beta', division: 'nowhere' }, { id: 'x', ...good, name: 'X' }], index);
  for (const expected of [/^x: no such persona/, /^b: unknown division/, /^b: the name still says "IT Professional"/, /^"gamma" is used by a, c$/]) assert.ok(problems.some(p => expected.test(p)), `${expected} in ${problems.join(' | ')}`);
});
