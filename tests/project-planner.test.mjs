import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';
import { ProjectStore } from '../projects.mjs';
import { OfficeEngine } from '../engine/deep-agents.mjs';
import { plannerAsk, parsePlan, planProject, applyPlan, startNextMilestone, loadPlanningSkills, loadCatalogueMethods, briefWords, LIMITS, PLANNER_PROMPT, PLANNING_SKILLS } from '../project-planner.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-planner-'));
const TODAY = Date.UTC(2026, 8, 12);
const PLAN = { name: 'Client portal', description: 'Ship the self-service client portal to every active client by the end of November.', charter: 'Scope: project status, invoices, files. Out of scope: the blog.', teams: ['delivery', 'marketing', 'nowhere'], startAt: '2026-09-12', dueAt: '2026-11-30',
  milestones: [{ title: 'Scope signed off', dueAt: '2026-09-30', tasks: [{ team: 'delivery', text: 'Write the scope document for the portal: pages, roles, what is out of scope, with acceptance criteria.' }, { team: 'nowhere', text: 'Draft the announcement to clients about the portal beta.' }] }, { title: 'Beta with three clients', tasks: [{ team: 'delivery', text: 'Run the beta with three clients and write the findings.' }] }, { title: 'All clients live', dueAt: '2026-11-30', tasks: [{ team: 'marketing', text: 'Write the launch announcement for every client.' }, { team: 'marketing', text: 'x' }] }] };

test('the ask carries the brief, the company and the documents within their caps', () => {
  const office = new OfficeStore({ dataDir: temp(), initialAgents: loadRoster().agents }).get();
  const ask = plannerAsk({ brief: 'Build a client portal.', office, documents: [{ name: 'spec.pdf', content: 'x'.repeat(50000) }, { name: 'notes.md', content: 'y'.repeat(50000) }], today: TODAY });
  assert.match(ask, /^Today: 2026-09-12\./); assert.match(ask, /Brief from the CEO:\nBuild a client portal\./); assert.match(ask, /- marketing: MARKETING/i); assert.match(ask, /### spec\.pdf/);
  assert.ok(ask.length < LIMITS.documentsChars + 6000, 'documents are cut to the budget'); assert.match(PLANNER_PROMPT, /Two to six milestones/);
});

test('a plan is checked against the office: unknown teams drop or become auto, dates fall in order inside the window, thin tasks go', () => {
  const office = new OfficeStore({ dataDir: temp(), initialAgents: loadRoster().agents }).get();
  const { plan, problems } = parsePlan(JSON.stringify(PLAN), { office, today: TODAY });
  assert.deepEqual(problems, []); assert.deepEqual(plan.teams, ['delivery', 'marketing']);
  assert.equal(plan.milestones.length, 3); assert.equal(plan.milestones[0].tasks[1].team, 'auto', 'a task for an unknown team is left to the Program Manager');
  assert.equal(plan.milestones[2].tasks.length, 1, 'a task without a real brief is dropped');
  assert.ok(plan.milestones[1].dueAt > plan.milestones[0].dueAt && plan.milestones[1].dueAt < plan.milestones[2].dueAt, 'the missing date is spread between its neighbours');
  assert.equal(new Date(plan.dueAt).toISOString().slice(0, 10), '2026-11-30');
  assert.deepEqual(parsePlan('I would rather not.', { office }).problems, ['the answer was not a JSON plan']);
  assert.ok(parsePlan(JSON.stringify({ name: 'X', description: 'Too short', milestones: [] }), { office }).problems.includes('no milestones'));
});

test('the Program Manager is asked once more when its plan cannot be used, and the second plan is taken', async () => {
  const office = new OfficeStore({ dataDir: temp(), initialAgents: loadRoster().agents }).get();
  const asked = []; let n = 0;
  const instance = { invoke: async messages => { n++; asked.push(messages.map(m => String(m.content).slice(0, 160))); return { content: n === 1 ? 'Here is my thinking but no plan.' : '```json\n' + JSON.stringify(PLAN) + '\n```' }; } };
  const plan = await planProject({ brief: 'Build a client portal for all active clients by the end of November.', office, models: { resolve: () => ({ model: 'pm', effort: '' }), instance: async () => instance }, today: TODAY, instance });
  assert.equal(plan.name, 'Client portal'); assert.equal(n, 2); assert.match(asked[1].at(-1), /could not be used \(the answer was not a JSON plan\)/);
  const stubborn = { invoke: async () => ({ content: 'no' }) };
  await assert.rejects(() => planProject({ brief: 'Build it.', office, models: { resolve: () => ({ model: 'pm' }), instance: async () => stubborn }, instance: stubborn }), /could not plan this project/);
  await assert.rejects(() => planProject({ brief: 'Build it.', office, models: { resolve: () => ({ model: '' }), instance: async () => stubborn } }), /No model is configured for the Program Manager/);
});

test('the plan becomes a project and its tasks: the first milestone queued, the rest in the backlog until their milestone is next', async () => {
  const dir = temp(), office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents }), projects = new ProjectStore({ dataDir: dir, office });
  const engine = new OfficeEngine({ dataDir: dir, office, models: { resolve: () => ({ model: 'x', effort: '' }), instance: async () => null }, knowledgeDir: path.join(dir, 'knowledge'), settings: () => ({}), projectFor: id => { const p = projects.get(id); return p ? { ...p, brief: projects.brief(p), next: projects.nextMilestone(p) } : null; } });
  engine.pump = () => {};
  try {
    const { plan } = parsePlan(JSON.stringify(PLAN), { office: office.get(), today: TODAY });
    const { project, tasks } = applyPlan({ plan, projects, engine, ownerId: 'u1' });
    assert.equal(project.milestones.length, 3); assert.equal(project.plannedBy, undefined, 'the store keeps its own fields'); assert.equal(tasks.length, 4);
    const [m1, m2, m3] = project.milestones.map(m => m.id);
    assert.deepEqual(tasks.map(t => [t.state, t.milestoneId, t.autoRoute ? 'auto' : t.dept]), [['queued', m1, 'delivery'], ['queued', m1, 'auto'], ['backlog', m2, 'delivery'], ['backlog', m3, 'marketing']]);
    assert.ok(tasks[1].autoRoute); assert.match(tasks[0].text, /Project milestone: Scope signed off \(due 2026-09-30\)\./); assert.equal(tasks[0].origin.channel, 'project');
    assert.deepEqual(startNextMilestone({ project: projects.get(project.id), projects, engine }), [], 'nothing starts while the first milestone is open');
    projects.recordCompletion({ id: tasks[0].id, projectId: project.id, state: 'done', doneAt: TODAY, milestoneId: m1 });
    assert.deepEqual(startNextMilestone({ project: projects.get(project.id), projects, engine }), [tasks[2].id], 'the second milestone starts when the first is achieved');
    assert.equal(engine.get(tasks[2].id).state, 'queued'); assert.equal(engine.get(tasks[3].id).state, 'backlog');
  } finally { await engine.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
});

test('the planner reads the built-in planning skills, in order, and any planning skill the CEO added; other skills stay out', () => {
  const own = temp(); fs.mkdirSync(path.join(own, 'launch-playbook'), { recursive: true }); fs.mkdirSync(path.join(own, 'expense-policy'), { recursive: true });
  fs.writeFileSync(path.join(own, 'launch-playbook', 'SKILL.md'), '---\nname: launch-playbook\ndescription: How we plan a product launch project, milestone by milestone.\n---\n\n# Launch playbook\n\nAlways start with the beta.\n');
  fs.writeFileSync(path.join(own, 'expense-policy', 'SKILL.md'), '---\nname: expense-policy\ndescription: How expenses are approved.\n---\n\nReceipts within 30 days.\n');
  const skills = loadPlanningSkills({ dirs: ['agency/pm-skills', own] });
  assert.deepEqual(skills.slice(0, PLANNING_SKILLS.length).map(s => s.name), PLANNING_SKILLS);
  assert.ok(skills.some(s => s.name === 'launch-playbook'), 'the CEO\'s planning skill is read'); assert.ok(!skills.some(s => s.name === 'expense-policy'), 'an unrelated skill is not');
  assert.match(skills[0].text, /Two to six, in order/); assert.ok(skills.every(s => s.text.length <= LIMITS.skillChars));
  const office = new OfficeStore({ dataDir: temp(), initialAgents: loadRoster().agents }).get();
  const ask = plannerAsk({ brief: 'Build a client portal.', office, skills, today: TODAY });
  assert.match(ask, /Your methods, built in \(follow them\):\n\n### planning-a-project — How the Program Manager turns/); assert.match(ask, /### launch-playbook/);
  fs.rmSync(own, { recursive: true, force: true });
});

test('the planner picks the Agency methods that fit the brief: at least two of its words, three at most, and names them', () => {
  const brief = 'Build a self-service client portal for all active clients: invoices with payment state, shared files and onboarding for three beta clients; invoices must match the ledger.';
  assert.equal(briefWords(brief)[0], 'invoices', 'the most frequent distinctive word comes first'); assert.ok(!briefWords(brief).includes('clients'), 'common words stay out');
  const personas = [{ id: 'a', name: 'Portal Architect', description: 'Designs client portals: invoices, files, onboarding flows.' }, { id: 'b', name: 'Expense Clerk', description: 'Approves expenses.' }, { id: 'c', name: 'Ledger Keeper', description: 'Keeps the ledger; invoices reconciled monthly.' }, { id: 'd', name: 'Onboarding Coach', description: 'Onboarding for new hires and portal pilots.' }];
  const agency = { list: ({ q }) => personas.filter(p => (p.name + ' ' + p.description).toLowerCase().includes(q)), get: id => { const p = personas.find(x => x.id === id); return { ...p, body: '# ' + p.name + '\n\nStep one, step two.' }; } };
  const methods = loadCatalogueMethods({ agency, brief });
  assert.equal(methods[0].name, 'Portal Architect', 'the persona matching the most telling words comes first'); assert.deepEqual(methods.map(m => m.name).slice(1).sort(), ['Ledger Keeper', 'Onboarding Coach']);
  assert.ok(methods.every(m => /Step one/.test(m.text))); assert.ok(!methods.some(m => m.name === 'Expense Clerk'), 'one word is not a fit');
  const office = new OfficeStore({ dataDir: temp(), initialAgents: loadRoster().agents }).get();
  assert.match(plannerAsk({ brief, office, catalogue: methods, today: TODAY }), /Methods from the Agency catalogue that fit this brief \(use what applies\):\n\n### Portal Architect — Designs client portals/);
  assert.deepEqual(loadCatalogueMethods({ agency: null, brief }), []);
});

test('a next milestone with no tasks is handed to the Program Manager to plan and deliver, once; a paused project gets nothing', async () => {
  const dir = temp(), office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents }), projects = new ProjectStore({ dataDir: dir, office });
  const engine = new OfficeEngine({ dataDir: dir, office, models: { resolve: () => ({ model: 'x', effort: '' }), instance: async () => null }, knowledgeDir: path.join(dir, 'knowledge'), settings: () => ({}), projectFor: id => { const p = projects.get(id); return p ? { ...p, brief: projects.brief(p), next: projects.nextMilestone(p) } : null; } });
  engine.pump = () => {};
  try {
    const project = projects.create({ name: 'Q4 campaign', description: 'Fill the pipeline.', milestones: [{ title: 'ICP agreed', dueAt: '2026-09-30' }, { title: 'Landing page live', dueAt: '2026-10-31' }] }, { ownerId: 'u1' });
    const [icp, landing] = project.milestones.map(m => m.id);
    const [first] = startNextMilestone({ project, projects, engine });
    const job = engine.get(first);
    assert.equal(job.milestoneId, icp); assert.ok(job.autoRoute, 'the Program Manager owns it'); assert.ok(job.origin.planned, 'marked as planned by the office'); assert.equal(job.ownerId, 'u1'); assert.equal(job.title, 'Milestone: ICP agreed');
    assert.match(job.text, /Plan and deliver the milestone “ICP agreed” of the project “Q4 campaign” \(due 2026-09-30\): read the project page/);
    assert.deepEqual(startNextMilestone({ project: projects.get(project.id), projects, engine }), [], 'once');
    projects.recordCompletion({ id: first, projectId: project.id, state: 'done', doneAt: TODAY, milestoneId: icp }, { tasks: [] });
    const [second] = startNextMilestone({ project: projects.get(project.id), projects, engine }); assert.equal(engine.get(second).milestoneId, landing, 'the next one follows');
    projects.setStatus(project.id, 'paused');
    assert.deepEqual(startNextMilestone({ project: projects.get(project.id), projects, engine }), [], 'a paused project gets nothing');
  } finally { await engine.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
});

test('the planner says which milestones wait for which; two ready milestones start together and each gets its own planning task when empty', async () => {
  const dir = temp(), office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents }), projects = new ProjectStore({ dataDir: dir, office });
  const engine = new OfficeEngine({ dataDir: dir, office, models: { resolve: () => ({ model: 'x', effort: '' }), instance: async () => null }, knowledgeDir: path.join(dir, 'knowledge'), settings: () => ({}), projectFor: id => { const p = projects.get(id); return p ? { ...p, brief: projects.brief(p), next: projects.nextMilestone(p) } : null; } });
  engine.pump = () => {};
  try {
    const raw = { ...PLAN, milestones: [{ ...PLAN.milestones[0], after: [] }, { ...PLAN.milestones[1], after: [] }, { ...PLAN.milestones[2], after: [0, 1, 7, -1, 'x'] }] };
    const { plan } = parsePlan(JSON.stringify(raw), { office: office.get(), today: TODAY });
    assert.deepEqual(plan.milestones.map(m => m.after), [[], [], [0, 1]], 'positions before the milestone only');
    assert.match(PLANNER_PROMPT, /"after":\[/);
    const { project, tasks } = applyPlan({ plan, projects, engine, ownerId: 'u1' });
    const [m1, m2, m3] = project.milestones.map(m => m.id);
    assert.deepEqual(project.milestones.map(m => m.after), [[], [], [m1, m2]]);
    assert.deepEqual(tasks.map(t => [t.state, t.milestoneId]), [['queued', m1], ['queued', m1], ['queued', m2], ['backlog', m3]], 'the two ready milestones start together');
    const empty = projects.create({ name: 'Two at once', description: 'Two milestones with nothing planned yet, to be planned side by side.', milestones: [{ title: 'A', after: [] }, { title: 'B', after: [] }] });
    const started = startNextMilestone({ project: empty, projects, engine });
    assert.deepEqual(started.map(id => engine.get(id).milestoneId), empty.milestones.map(m => m.id), 'the Program Manager gets one planning task per ready milestone');
  } finally { await engine.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
});
