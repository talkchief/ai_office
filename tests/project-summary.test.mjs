import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';
import { ProjectStore } from '../projects.mjs';
import { collectLinks, summaryAsk, parseSummary, summariseProject, loadSummarySkills, SUMMARY_PROMPT, SUMMARY_SKILLS, SUMMARY_LIMITS } from '../project-summary.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-summary-'));
const TODAY = Date.UTC(2026, 8, 12);
const store = () => { const dir = temp(); return { dir, store: new ProjectStore({ dataDir: dir, office: new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents }) }) }; };
const PROJECT = { id: 'cowork-page', name: 'Cowork landing page', status: 'done', description: 'A one-page marketing site for TalkChief Cowork that collects demo requests.', charter: 'Scope: one page, a lead form, tracking. Out of scope: the blog.', dueAt: Date.UTC(2026, 8, 20), milestones: [{ id: 'm-1', title: 'Copy approved', done: true, dueAt: Date.UTC(2026, 8, 14) }, { id: 'm-2', title: 'Page live', done: true, dueAt: Date.UTC(2026, 8, 20) }] };
const TASKS = [
  { id: 't1', state: 'done', doneAt: TODAY, title: 'Write the landing page copy', teamName: 'MARKETING', result: 'Ten sections of copy, approved. Draft at https://here.now/p/cowork-draft.', resultSummary: 'Copy for ten sections.' },
  { id: 't2', state: 'done', doneAt: TODAY, title: 'Build and publish the page', teamName: 'DELIVERY', result: 'Published to https://here.now/talkchief-cowork-staging, tracking live. Local preview was http://localhost:8080 (ignore).' },
  { id: 't3', state: 'working', title: 'Measure the first week', teamName: 'SALES', result: 'not finished https://example.com/never' },
  { id: 't4', state: 'cancelled', title: 'Old idea' },
];
const ARTIFACTS = [{ taskId: 't1', taskTitle: 'Write the landing page copy', name: 'copy-package.pdf', bytes: 210000, modifiedAt: TODAY }, { taskId: 't2', taskTitle: 'Build and publish the page', name: 'index.html', bytes: 95760, modifiedAt: TODAY }];
const REPLY = { headline: 'The Cowork page is live and collecting demo requests', summary: '## What was asked\nA one-page site for TalkChief Cowork.\n\n## What was delivered\nThe page is live at the staging address with the ten-section copy package.', delivered: [{ what: 'Live landing page', where: 'https://here.now/talkchief-cowork-staging', note: 'What visitors see.' }, { what: 'Copy package', where: 'copy-package.pdf', note: 'Ten sections, approved.' }], links: [{ label: 'The live page', url: 'https://here.now/talkchief-cowork-staging' }], open: ['The first-week measurement is still running.'], next: ['Point the domain at the page, Delivery, this week.'] };

test('the addresses the work produced: finished tasks only, deduplicated, trailing punctuation and the office’s own host left out', () => {
  const links = collectLinks(TASKS);
  assert.deepEqual(links.map(l => l.url), ['https://here.now/p/cowork-draft', 'https://here.now/talkchief-cowork-staging'], 'an unfinished task and localhost contribute nothing');
  assert.equal(links[0].taskTitle, 'Write the landing page copy');
  assert.deepEqual(collectLinks([{ state: 'done', id: 'p', title: 'T', result: 'Book at https://a.test/book?utm_term={{segment}} or `https://a.test/real`.' }]).map(l => l.url), ['https://a.test/real'], 'a template pattern is not a page, and a code fence is not part of the address');
  assert.deepEqual(collectLinks([{ state: 'done', id: 'x', title: 'T', result: 'See (https://a.test/page), and https://a.test/page again.' }]).map(l => l.url), ['https://a.test/page'], 'the same address once, without the bracket');
  assert.equal(collectLinks(TASKS, { max: 1 }).length, 1);
});

test('the ask carries the brief, the finished work with its files, the addresses and the method; unfinished work is named as open', () => {
  const skills = [{ name: 'writing-an-executive-summary', description: 'How the PM closes a project.', text: 'Name the link.' }];
  const ask = summaryAsk({ project: PROJECT, tasks: TASKS, artifacts: ARTIFACTS, links: collectLinks(TASKS), skills, today: TODAY });
  assert.match(ask, /What the CEO asked for:\nA one-page marketing site/); assert.match(ask, /Charter:\nScope: one page/);
  assert.match(ask, /Milestones:\n- \[x\] Copy approved \(due 2026-09-14\)/);
  assert.match(ask, /Still open: Measure the first week \(working\)\./, 'work in progress is named, never counted as delivered');
  assert.match(ask, /### Build and publish the page\nTeam: DELIVERY\. Finished 2026-09-12\.\nFiles: index\.html \(94 KB\)/);
  assert.match(ask, /Files produced \(download names\):\n- copy-package\.pdf — 205 KB, from “Write the landing page copy”/);
  assert.match(ask, /Addresses found in the results[^\n]*\n- https:\/\/here\.now\/p\/cowork-draft/);
  assert.match(ask, /Your methods, built in \(follow them\):\n\n### writing-an-executive-summary — How the PM closes a project\./);
  assert.ok(!ask.includes('Old idea'), 'a cancelled task is not the record of anything');
  assert.match(SUMMARY_PROMPT, /MUST appear in "links"/);
});

test('the reply becomes the stored summary: fenced JSON, capped lists, and an address the PM did not name is kept', () => {
  const found = collectLinks(TASKS);
  const { summary } = parseSummary('Here you are:\n```json\n' + JSON.stringify(REPLY) + '\n```', { links: found });
  assert.equal(summary.headline, 'The Cowork page is live and collecting demo requests');
  assert.match(summary.text, /^## What was asked/); assert.deepEqual(summary.delivered.map(d => d.what), ['Live landing page', 'Copy package']);
  assert.deepEqual(summary.links.map(l => [l.label, l.url]), [['The live page', 'https://here.now/talkchief-cowork-staging']], 'the Program Manager chooses which addresses matter');
  assert.deepEqual(parseSummary(JSON.stringify({ ...REPLY, links: [] }), { links: found }).summary.links.map(l => l.url), found.map(l => l.url).slice(0, 3), 'it named none, so the office falls back to the first few the work produced');
  assert.deepEqual(summary.open, ['The first-week measurement is still running.']); assert.deepEqual(summary.next, ['Point the domain at the page, Delivery, this week.']);
  assert.deepEqual(parseSummary(JSON.stringify({ ...REPLY, links: [{ label: 'bad', url: 'javascript:alert(1)' }] }), {}).summary.links, [], 'only http addresses');
  assert.equal(parseSummary('no json here').summary, null); assert.deepEqual(parseSummary('{"summary":"too short"}').problems, ['no summary text']);
  assert.equal(parseSummary(JSON.stringify({ summary: 'x'.repeat(20000), next: Array(40).fill('again') })).summary.text.length, SUMMARY_LIMITS.summaryChars);
  assert.equal(parseSummary(JSON.stringify({ summary: 'x'.repeat(200), next: Array(40).fill('again') })).summary.next.length, SUMMARY_LIMITS.items);
});

test('the Program Manager writes it in one call, tries again once, and the office refuses without a model', async () => {
  let n = 0; const asked = [];
  const instance = { invoke: async messages => { n++; asked.push(messages.map(m => String(m.content))); return { content: n === 1 ? 'thinking out loud' : JSON.stringify(REPLY) }; } };
  const models = { resolve: () => ({ model: 'pm', effort: '' }), instance: async () => instance };
  const summary = await summariseProject({ project: PROJECT, tasks: TASKS, artifacts: ARTIFACTS, skills: [], models, instance, today: TODAY });
  assert.equal(n, 2); assert.match(asked[1][2], /could not be used \(the reply was not JSON\)/);
  assert.equal(summary.headline, REPLY.headline); assert.equal(summary.by, 'pm'); assert.equal(summary.tasks, 2, 'two finished tasks'); assert.equal(summary.artifacts, 2); assert.ok(summary.at > 0);
  assert.ok(summary.links.some(l => l.url === 'https://here.now/talkchief-cowork-staging'));
  const stubborn = { invoke: async () => ({ content: 'no' }) };
  await assert.rejects(() => summariseProject({ project: PROJECT, tasks: TASKS, models, instance: stubborn }), /could not write the summary/);
  await assert.rejects(() => summariseProject({ project: PROJECT, tasks: TASKS, models: { resolve: () => ({ model: '' }), instance: async () => stubborn } }), /No model is configured for the Program Manager/);
});

test('the executive-summary method is built in for the Program Manager, and the CEO’s own closing method is read too', () => {
  const skills = loadSummarySkills({ dirs: ['agency/pm-skills'] });
  assert.deepEqual(skills.map(s => s.name), SUMMARY_SKILLS, 'both shipped methods, in order');
  assert.match(skills[0].text, /Name the link/);
  const own = temp(); fs.mkdirSync(path.join(own, 'closing-a-launch'), { recursive: true }); fs.mkdirSync(path.join(own, 'expense-policy'), { recursive: true });
  fs.writeFileSync(path.join(own, 'closing-a-launch', 'SKILL.md'), '---\nname: closing-a-launch\ndescription: How we write the executive summary of a launch.\n---\n\nAlways give the address first.\n');
  fs.writeFileSync(path.join(own, 'expense-policy', 'SKILL.md'), '---\nname: expense-policy\ndescription: How expenses are approved.\n---\n\nReceipts within 30 days.\n');
  const both = loadSummarySkills({ dirs: ['agency/pm-skills', own] });
  assert.ok(both.some(s => s.name === 'closing-a-launch')); assert.ok(!both.some(s => s.name === 'expense-policy'), 'an unrelated method stays out');
  fs.rmSync(own, { recursive: true, force: true });
});

test('the summary is kept with the project and written into its page in the Brain', () => {
  const { dir, store: projects } = store();
  const p = projects.create({ name: 'Cowork landing page', description: 'A one-page marketing site that collects demo requests.' });
  assert.throws(() => projects.recordSummary(p.id, { headline: 'x' }), /needs its text/);
  assert.throws(() => projects.recordSummary('nope', { text: 'x' }), /no such project/);
  const { summary } = parseSummary(JSON.stringify(REPLY), {});
  const kept = projects.recordSummary(p.id, { ...summary, at: TODAY, by: 'pm' });
  assert.equal(kept.headline, REPLY.headline);
  assert.equal(projects.get(p.id).summary.text, summary.text, 'it survives being read back');
  assert.equal(projects.update(p.id, { ...projects.get(p.id), name: 'Renamed' }).summary.headline, REPLY.headline, 'and an edit of the project');
  const page = projects.page(projects.get(p.id), { tasks: [], files: [], teams: [] });
  assert.match(page, /## What the CEO got\nThe Cowork page is live/); assert.match(page, /Addresses: The live page — https:\/\/here\.now\/talkchief-cowork-staging/);
  assert.match(page, /Still open: The first-week measurement is still running\./);
  fs.rmSync(dir, { recursive: true, force: true });
});
