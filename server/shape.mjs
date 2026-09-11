// What the browser receives for tasks. The list is light; the detail is hydrated with the current team.
// `subtasks` mirrors the specialists' runs so the current task view keeps working until the new one ships.
import { runTitle } from '../engine/stream.mjs';
import { outputExcerpt } from '../src/task-output.js';

const excerpts = new Map();
function excerpt(job) {
  if (!job.result || job.state !== 'done') return '';
  const cached = excerpts.get(job.id); if (cached?.at === job.doneAt) return cached.text;
  const text = outputExcerpt(job.result); if (excerpts.size >= 1000) excerpts.delete(excerpts.keys().next().value);
  excerpts.set(job.id, { at: job.doneAt, text }); return text;
}
const specialistRuns = job => (job.runs || []).filter(r => r.role === 'specialist');
const stepState = state => state === 'paused' ? 'working' : state;

export function listShape(job, office) {
  const { result, runs = [], liveCalls, reviews, checks, skills, resultVersions, deliverables, reviewsByDept, pendingActions = [], decisions, questions, next, ...rest } = job;
  const steps = specialistRuns(job);
  return { ...rest, teamName: job.autoRoute ? 'Program Manager' : office.teams.find(t => t.id === job.dept)?.name || job.teamName || job.dept,
    resultPreview: excerpt(job), versions: (resultVersions || []).length, pendingActions: pendingActions.map(({ name, agent, requestedAt }) => ({ name, agent, requestedAt })),
    runs: runs.map(({ output, ...r }) => ({ ...r, title: runTitle(r.title) })), subtasks: steps.map(r => ({ id: r.id, title: runTitle(r.title), agent: r.agent, eligible: [r.agent], state: stepState(r.state) })),
    completedSteps: steps.filter(r => r.state === 'done').length };
}

export function detailShape(job, office) {
  const team = job.autoRoute ? { id: 'pm', name: 'Program Manager', lead: 'pm', criteria: [], guardrails: [] } : office.teams.find(t => t.id === job.dept) || { id: job.dept, name: job.teamName || job.dept, lead: job.agent, criteria: [], guardrails: [] };
  return { ...job, team, agents: [...office.agents, { id: 'pm', name: 'Program Manager', role: 'Program Manager', department: 'pm' }], requireHumanApproval: !!job.completionApproval, humanApproved: (job.decisions || []).some(d => d.action === 'complete_task' && d.type !== 'reject'),
    subtasks: specialistRuns(job).map(r => ({ id: r.id, title: runTitle(r.title), agent: r.agent, eligible: [r.agent], state: stepState(r.state), instructions: r.title, acceptance: [], dependencies: [],
      output: r.output || '', feedback: '', error: r.error || '', notes: [], tools: r.tools || [], requiredTools: [], modelUsed: r.model || '', effortUsed: r.effort || '', complexity: '', routingReason: '' })) };
}
