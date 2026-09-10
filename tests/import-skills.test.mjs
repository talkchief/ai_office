import test from 'node:test';
import assert from 'node:assert/strict';
import { personaFromSkill, titleOf, readFrontMatter } from '../scripts/import-skills.mjs';
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

test('a skill becomes an IT Professional persona the office can hire', () => {
  const p = personaFromSkill(SKILL, { id: 'systematic-debugging', prefix: 'IT Professional ', source: 'agentic-awesome-skills (MIT)' });
  assert.equal(p.name, 'IT Professional Systematic Debugging'); assert.equal(p.id, 'it-pro-systematic-debugging'); assert.equal(p.risk, 'critical');
  const parsed = parsePersona(p.text, { division: 'it-professional', file: p.id + '.md' });
  assert.equal(parsed.name, 'IT Professional Systematic Debugging');
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
  assert.equal(titleOf('00-andruia-consultant'), 'Andruia Consultant'); assert.equal(titleOf('api-fuzzing-bug-bounty'), 'Api Fuzzing Bug Bounty'); assert.equal(titleOf('sql-sentinel'), 'Sql Sentinel');
  assert.deepEqual(readFrontMatter('---\nname: x\nrisk: safe\n---\nBody').meta, { name: 'x', risk: 'safe' });
  assert.equal(personaFromSkill('# No front matter\n\nJust text.', { id: 'plain-skill' }).name, 'IT Professional Plain Skill');
});
