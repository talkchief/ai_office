import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEPTS, DEPT_KEYS } from './src/data.js';

const text = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
export const DEFAULT_CRITERIA = [
  'The deliverable addresses every part of the requested task.',
  'Factual claims are supported by the supplied material or cited sources; uncertainty is stated.',
  'The result is usable, internally consistent, and follows the team instructions.',
];
export class OfficeStore {
  constructor({ dataDir, initialAgents }) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'office.json');
    if (fs.existsSync(this.file)) this.value = this.validate(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    else {
      this.value = { version: 1, revision: 1, agents: initialAgents.map(a => ({ ...a, skills: [], model: a.model || 'sonnet' })),
        teams: DEPT_KEYS.map(id => ({ id, name: DEPTS[id].name, lead: initialAgents.find(a => a.department === id && a.lead)?.id,
          instructions: '', criteria: [...DEFAULT_CRITERIA], checks: [], tools: [], concurrency: 2, maxSubtasks: 4, maxRevisions: 2, maxCalls: 16, maxTokens: 60000,
          planningModel: 'sonnet', reviewModel: 'sonnet', requireHumanApproval: false, tests: [] })) };
      this.value = this.validate(this.value); this.persist();
    }
  }
  get() { return structuredClone(this.value); }
  agents() { return this.get().agents; }
  team(id) { return this.get().teams.find(t => t.id === id); }
  validate(input) {
    if (!input || !Array.isArray(input.agents) || !Array.isArray(input.teams)) fail('An office needs teams and agents.');
    const teamIds = new Set(input.teams.map(t => t.id));
    if (input.teams.length < 1 || input.teams.length > 12) fail('An office supports 1–12 teams.');
    if (teamIds.size !== input.teams.length || [...teamIds].some(id => !/^[a-z][a-z0-9_-]{0,47}$/.test(id || '') || id === 'brain')) fail('Teams need unique IDs.');
    const skillIds = new Set();
    const skills = (Array.isArray(input.skills) ? input.skills : []).map(skill => {
      if (!/^[a-z][a-z0-9_-]{0,47}$/.test(skill.id || '') || skillIds.has(skill.id)) fail('Each skill needs a unique ID.');
      skillIds.add(skill.id);
      if (!text(skill.name, 100) || !text(skill.instructions, 10000)) fail('Each skill needs a name and instructions.');
      return { id: skill.id, name: text(skill.name,100), description: text(skill.description,500), instructions: text(skill.instructions,10000), revision: Math.max(1, Number(skill.revision)||1) };
    });
    if (skills.length > 50) fail('An office supports up to 50 reusable skills.');
    const skillRefs = refs => {
      const values = [...new Set(Array.isArray(refs) ? refs : [])];
      if (values.some(id => !skillIds.has(id))) fail('Unassign a deleted skill from teams and agents before saving.');
      return values;
    };
    const ids = new Set();
    const agents = input.agents.map(a => {
      if (!/^[a-z][a-z0-9_-]{0,47}$/.test(a.id || '') || ids.has(a.id)) fail('Each agent needs a unique ID.');
      ids.add(a.id);
      if (!teamIds.has(a.department)) fail('Choose an existing functional area.');
      if (!text(a.name, 48) || !text(a.role, 120)) fail('Each agent needs a name and role.');
      return { id: a.id, department: a.department, name: text(a.name, 48), role: text(a.role, 120), does: text(a.does, 1200), brief: text(a.brief, 6000),
        model: ['sonnet', 'opus', 'fable'].includes(a.model) ? a.model : 'sonnet', effort: ['', 'low', 'medium', 'high', 'xhigh', 'max'].includes(a.effort || '') ? a.effort || '' : '',
        skills: skillRefs(a.skills), tools: Array.isArray(a.tools) ? a.tools.map(t => text(t, 80)).filter(Boolean).slice(0, 20) : [], inheritTools: a.inheritTools !== false, lead: false };
    });
    const seen = new Set();
    const teams = input.teams.map(t => {
      if (!teamIds.has(t.id) || seen.has(t.id)) fail('Each functional area must appear exactly once.');
      seen.add(t.id);
      const members = agents.filter(a => a.department === t.id);
      if (members.length < 2 || members.length > 12) fail(`${t.name || t.id} needs a lead and at least one worker, with a maximum of 12 agents.`);
      const lead = members.find(a => a.id === t.lead);
      if (!lead) fail(`Assign a lead who belongs to ${t.name || t.id}.`);
      lead.lead = true;
      const criteria = (Array.isArray(t.criteria) ? t.criteria : DEFAULT_CRITERIA).map(c => text(c, 1000)).filter(Boolean).slice(0, 12);
      if (!criteria.length) fail('Add at least one review criterion.');
      const checks = (Array.isArray(t.checks) ? t.checks : []).slice(0, 20).map((c, i) => {
        if (!['contains', 'not_contains', 'min_length', 'max_length'].includes(c.type)) fail('Unknown acceptance-check type.');
        const value = c.type.includes('length') ? Number(c.value) : text(c.value, 1000);
        if (c.type.includes('length') && (!Number.isInteger(value) || value < 1 || value > 100000)) fail('Length checks need a number from 1 to 100000.');
        if (!c.type.includes('length') && !value) fail('Text checks need a value.');
        return { id: `check-${i + 1}`, label: text(c.label, 160) || `${c.type}: ${value}`, type: c.type, value };
      });
      const testIds = new Set();
      for (const test of t.tests || []) { if (testIds.has(test.id)) fail('Each test in a team needs a unique ID.'); testIds.add(test.id); }
      const range = (value, fallback, min, max) => Math.max(min, Math.min(max, Number.isInteger(+value) ? +value : fallback));
      return { id: t.id, name: text(t.name, 48) || DEPTS[t.id]?.name || t.id, lead: t.lead, purpose: text(t.purpose,3000), guardrails: (Array.isArray(t.guardrails) ? t.guardrails : []).map(rule => text(rule,1000)).filter(Boolean).slice(0,12), skills: skillRefs(t.skills), instructions: text(t.instructions, 12000), criteria, checks,
        tools: (Array.isArray(t.tools) ? t.tools : []).map(v => text(v, 80)).filter(Boolean).slice(0, 20),
        concurrency: range(t.concurrency, 2, 1, 4), maxSubtasks: range(t.maxSubtasks, 4, 1, 8), maxRevisions: range(t.maxRevisions, 2, 0, 3),
        maxCalls: range(t.maxCalls, 16, 3, 40), maxTokens: range(t.maxTokens, 60000, 5000, 200000),
        planningModel: ['sonnet', 'opus', 'fable'].includes(t.planningModel) ? t.planningModel : 'sonnet',
        reviewModel: ['sonnet', 'opus', 'fable'].includes(t.reviewModel) ? t.reviewModel : 'sonnet', requireHumanApproval: !!t.requireHumanApproval,
        tests: (Array.isArray(t.tests) ? t.tests : []).slice(0, 12).map(test => ({ id: /^[a-zA-Z0-9_-]+$/.test(test.id || '') ? test.id : randomUUID(), name: text(test.name, 100) || 'Team test', prompt: text(test.prompt, 6000), requiredText: (Array.isArray(test.requiredText) ? test.requiredText : []).map(s => text(s, 300)).filter(Boolean).slice(0, 12) })).filter(t => t.prompt) };
    });

    return { version: 1, revision: Number(input.revision) || 1, agents, teams, skills };
  }
  update(input, busyAgentIds = new Set()) {
    if (input.revision !== this.value.revision) throw Object.assign(new Error('The office changed in another tab. Reload before saving.'), { status: 409 });
    const next = this.validate(input);
    for (const id of busyAgentIds) {
      const before = this.value.agents.find(a => a.id === id), after = next.agents.find(a => a.id === id);
      if (!after || after.department !== before?.department) fail('An agent with unfinished work cannot be removed or moved. Finish or cancel its work first.');
    }
    for (const skill of next.skills) { const before = this.value.skills.find(s => s.id === skill.id); skill.revision = before ? before.revision + Number(skill.name !== before.name || skill.description !== before.description || skill.instructions !== before.instructions) : 1; }
    next.revision = this.value.revision + 1;
    this.value = next; this.persist(); return this.get();
  }
  persist() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.value, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  bootstrap() {
    return { revision: this.value.revision, teams: this.value.teams.map(t => ({ id: t.id, name: t.name })),
      agents: this.value.agents.map(({ id, department, name, role, does, lead }) => ({ id, department, name, role, does, lead })) };
  }
}

export function workingInstructions(team, agent, skills = []) {
  const ids = new Set([...(team.skills || []), ...(agent.skills || [])]);
  const assigned = skills.filter(skill => ids.has(skill.id));
  return `Team purpose: ${team.purpose || 'Follow the owner’s task.'}\nTeam instructions:\n${team.instructions}\nTeam guardrails:\n${(team.guardrails || []).join('\n') || 'Follow the task requirements and report uncertainty.'}\nRole instructions:\n${agent.brief}\nAssigned skills:\n${assigned.map(s => `--- ${s.name} (revision ${s.revision}) ---\n${s.instructions}`).join('\n\n') || 'None assigned.'}`;
}
