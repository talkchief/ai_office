import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StateGraph, Annotation, START, END, interrupt, Command } from '@langchain/langgraph';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';

const ACTIVE = new Set(['queued', 'planning', 'working', 'reviewing', 'saving']);
const TERMINAL = new Set(['done', 'cancelled']);
const clean = value => String(value ?? '').trim();
const OUTPUT_GUIDANCE = 'Presentation: the owner’s requested format and acceptance criteria take priority. For a report or decision, the first substantive paragraph MUST be the direct answer or recommendation, in one or two sentences; a short title may precede it. Do not open with an inventory of supplied facts, a greeting, a team introduction, or a status disclaimer. Follow with only the supporting sections needed to use the answer: descriptive Markdown headings, bullets for actions, tables for meaningful comparisons. Include sources beside supported claims; clearly distinguish assumptions from evidence without repeating the same caveat. Collect remaining material assumptions and missing inputs in ONE concise final section. The interface already shows draft/approval status and reviewer identity: do not duplicate that metadata, narrate handoffs, or append a lead-verification note. Do not repeat that nothing was sent or executed after each section; mention an authorization dependency once where it affects an action. Preserve all decision-relevant uncertainty. Use the shortest length that fully answers the request. A short answer, email, template or code deliverable should keep its requested form, not become a report.';
export function parseObject(text) {
  const value = clean(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(value);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Expected a JSON object from Claude.');
  return parsed;
}
export function checkOutput(output, checks) {
  return checks.map(check => ({ ...check, passed: check.type === 'contains' ? output.toLowerCase().includes(String(check.value).toLowerCase())
    : check.type === 'not_contains' ? !output.toLowerCase().includes(String(check.value).toLowerCase())
    : check.type === 'min_length' ? output.length >= check.value : output.length <= check.value,
    evidence: check.type.includes('length') ? `${output.length} characters` : `Checked final deliverable for “${check.value}”.` }));
}
export function validatePlan(plan, team, agents) {
  const workers = agents.filter(a => a.id !== team.lead);
  if (!Array.isArray(plan.subtasks) || !plan.subtasks.length || plan.subtasks.length > team.maxSubtasks) throw new Error(`The lead must produce 1–${team.maxSubtasks} subtasks.`);
  const seen = new Set();
  return plan.subtasks.map((step, i) => {
    const id = `step-${i + 1}`;
    const eligible = [...new Set([step.agent, ...(Array.isArray(step.alternatives) ? step.alternatives : [])])];
    if (!eligible.length || eligible.some(id => !workers.some(a => a.id === id))) throw new Error('The plan assigned work to an unknown agent or to the reviewing lead.');
    const dependencies = Array.isArray(step.dependencies) ? step.dependencies : [];
    if (dependencies.some(id => !seen.has(id))) throw new Error('Subtask dependencies must refer to earlier steps.');
    if (!clean(step.title) || !clean(step.instructions) || !Array.isArray(step.acceptance) || !step.acceptance.some(c => clean(c))) throw new Error('Every subtask needs a title, instructions and acceptance criteria.');
    const assigned = workers.find(a => a.id === step.agent);
    const model = step.model || assigned.model || 'sonnet';
    const effort = assigned.effort || step.effort || 'medium';
    if (!['sonnet','opus','fable'].includes(model) || !['low','medium','high','xhigh','max'].includes(effort)) throw new Error('The lead selected an unsupported model or effort.');
    const requiredTools = Array.isArray(step.requiredTools) ? [...new Set(step.requiredTools)] : [];
    if (requiredTools.some(tool => !team.tools.includes(tool) || eligible.some(id => {const a=workers.find(a=>a.id===id);return a.inheritTools === false && !a.tools.includes(tool);}))) throw new Error('The plan requested a tool that is not assigned to every eligible worker. Enable it in team settings or revise the plan.');
    seen.add(id);
    return { id, title: clean(step.title).slice(0, 200), instructions: clean(step.instructions).slice(0, 5000), eligible, agent: null, dependencies, model, effort, requiredTools, complexity: clean(step.complexity || 'standard').slice(0,80), routingReason: clean(step.reason || 'Uses the specialist’s configured model.').slice(0,1000),
      acceptance: step.acceptance.map(clean).filter(Boolean).slice(0, 8), state: 'pending', attempts: 0, output: '', feedback: '', tools: [] };
  });
}
export class WorkflowEngine {
  constructor({ dataDir, office, invoke, context = () => '', toolCatalog = () => [], onComplete = async () => {}, maxConcurrentJobs = 2, maxConcurrentCalls = 4 }) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.saver = SqliteSaver.fromConnString(path.join(dataDir, 'workflows.sqlite'));
    this.db = this.saver.db;
    this.db.pragma('journal_mode = WAL'); this.db.pragma('busy_timeout = 5000');
    this.db.exec('CREATE TABLE IF NOT EXISTS office_jobs (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS office_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS office_events_job ON office_events(job_id, seq);');
    this.toolCatalog = toolCatalog; this.office = office; this.invoke = invoke; this.context = context; this.onComplete = onComplete;
    this.running = new Map(); this.busy = new Set(); this.maxJobs = maxConcurrentJobs; this.maxCalls = maxConcurrentCalls; this.closed = false;
    const state = Annotation.Root({ id: Annotation() });
    this.graph = new StateGraph(state)
      .addNode('plan', async ({ id }) => { await this.plan(id); return {}; })
      .addNode('execute', async ({ id }) => { await this.execute(id); return {}; })
      .addNode('review', async ({ id }) => { await this.review(id); return {}; })
      .addNode('approval', ({ id }) => {
        const job = this.get(id);
        if (job.state === 'cancelled') return {};
        if (job.requireHumanApproval && !job.humanApproved) {
          if (job.state !== 'waiting') this.update(id, j => { j.state = 'waiting'; });
          const answer = interrupt({ task: id, title: job.title, review: job.review, message: 'The lead has approved the deliverable. Authorize completion or request changes.' });
          if (!answer?.approve) throw new Error('Approval was not granted.');
          this.update(id, j => { j.humanApproved = true; });
          this.event(id, 'human_approved', null, 'Owner approved the reviewed deliverable.');
        }
        return {};
      })
      .addNode('finish', async ({ id }) => {
        const job = this.get(id);
        if (job.state === 'cancelled') return {};
        if (!job.review?.approved || (job.requireHumanApproval && !job.humanApproved)) throw new Error('Completion requires a passing lead review and all required approvals.');
        // Completion has a short commit phase. Cancellation must not report success
        // after the approved artifact has started being written.
        this.update(id, j => { j.state = 'saving'; });
        await this.onComplete(job);
        this.update(id, j => { j.state = 'done'; j.doneAt = Date.now(); });
        this.event(id, 'completed', job.team.lead, 'Lead-approved deliverable saved.');
        return {};
      })
      .addEdge(START, 'plan')
      .addConditionalEdges('plan', ({ id }) => this.get(id).state === 'working' ? 'execute' : END)
      .addConditionalEdges('execute', ({ id }) => { const j = this.get(id); return j.state !== 'working' ? END : j.subtasks.every(s => s.state === 'done') ? 'review' : 'execute'; })
      .addConditionalEdges('review', ({ id }) => { const j = this.get(id); return j.state === 'working' ? 'execute' : j.review?.approved ? 'approval' : END; })
      .addEdge('approval', 'finish').addEdge('finish', END).compile({ checkpointer: this.saver });
  }
  get(id) { const row = this.db.prepare('SELECT body FROM office_jobs WHERE id = ?').get(id); return row ? JSON.parse(row.body) : null; }
  update(id, mutate) {
    return this.db.transaction(() => {
      const job = this.get(id); if (!job) throw new Error('No such task.');
      mutate(job); job.updatedAt = Date.now();
      this.db.prepare('UPDATE office_jobs SET body = ? WHERE id = ?').run(JSON.stringify(job), id);
      return job;
    })();
  }
  event(id, type, agent, message, details = {}) {
    this.db.prepare('INSERT INTO office_events(job_id, body) VALUES (?, ?)').run(id, JSON.stringify({ at: Date.now(), type, agent, message, ...details }));
  }
  events(id) { return this.db.prepare('SELECT seq, body FROM office_events WHERE job_id = ? ORDER BY seq').all(id).map(r => ({ seq: r.seq, ...JSON.parse(r.body) })); }
  list() { return this.db.prepare('SELECT body FROM office_jobs ORDER BY rowid DESC').all().map(r => JSON.parse(r.body)); }
  detail(id) { const j = this.get(id); return j && { ...j, events: this.events(id) }; }
  activeAgents() { return new Set(this.list().filter(j => !TERMINAL.has(j.state) && j.state !== 'backlog').flatMap(j => j.agents.map(a => a.id))); }
  create({ dept, text, model, kind = 'task', testId, requireHumanApproval = false, autoStart = true, routine, suiteId, backlog = false, priority = 1 }) {
    const team = this.office.team(dept);
    if (!team || !clean(text)) throw Object.assign(new Error('Choose a team and describe the task.'), { status: 400 });
    if (clean(text).length > 12000) throw Object.assign(new Error('Task descriptions must be under 12000 characters.'), { status: 400 });
    const agents = this.office.agents().filter(a => a.department === dept);
    const testcase = kind === 'evaluation' ? team.tests.find(t => t.id === testId) : null;
    if (kind === 'evaluation' && !testcase) throw new Error('Choose a saved team test.');
    const job = { id: randomUUID(), dept, title: clean(text).slice(0, 100), text: clean(text), kind, routine, suiteId, testId: testcase?.id, testName: testcase?.name, agent: team.lead,
      team, agents, skills: this.office.get().skills.filter(s => team.skills.includes(s.id) || agents.some(a => a.skills.includes(s.id))), officeRevision: this.office.get().revision, model: ['sonnet', 'opus', 'fable'].includes(model) ? model : null,
      state: backlog ? 'backlog' : 'queued', priority: [0,1,2].includes(priority) ? priority : 1, createdAt: Date.now(), updatedAt: Date.now(), subtasks: [], reviews: [], review: null, result: '', revisions: 0,
      calls: 0, tokens: 0, requireHumanApproval: kind !== 'evaluation' && (team.requireHumanApproval || requireHumanApproval), humanApproved: false,
      checks: [...team.checks, ...(testcase?.requiredText || []).map((value, i) => ({ id: `test-${i + 1}`, label: `Test requires: ${value}`, type: 'contains', value }))] };
    this.db.prepare('INSERT INTO office_jobs(id, body) VALUES (?, ?)').run(job.id, JSON.stringify(job));
    this.event(job.id, 'received', team.lead, `${team.name} received the ${kind === 'evaluation' ? 'test' : 'task'}.`);
    if (autoStart && !backlog) queueMicrotask(() => this.pump());
    return job;
  }
  createTestSuite(dept) {
    const team = this.office.team(dept);
    if (!team?.tests.length) throw new Error('Save at least one team test first.');
    const suiteId = randomUUID();
    const jobs = this.db.transaction(() => team.tests.map(test => this.create({ dept, text: test.prompt, kind: 'evaluation', testId: test.id, suiteId, autoStart: false })))();
    queueMicrotask(() => this.pump());
    return { id: suiteId, jobs };
  }
  editQueue(id, input) {
    const job=this.get(id);
    if (!job || this.running.has(id) || job.calls > 0 || !['backlog','queued'].includes(job.state)) throw Object.assign(new Error('Only tasks that have not started can be edited in the queue.'),{status:409});
    if (input.state !== undefined && !['backlog','queued'].includes(input.state)) throw new Error('Choose backlog or queued.');
    if (input.priority !== undefined && ![0,1,2].includes(input.priority)) throw new Error('Choose a valid priority.');
    if (input.text !== undefined && (!clean(input.text) || clean(input.text).length>12000)) throw new Error('Add a task brief under 12000 characters.');
    const updated=this.update(id,j=>{
      if(input.text!==undefined){j.text=clean(input.text);j.title=j.text.slice(0,100);}
      if(input.priority!==undefined)j.priority=input.priority;
      if(input.state==='queued'&&j.state==='backlog'){
        const config=this.office.get();j.team=this.office.team(j.dept);j.agents=config.agents.filter(a=>a.department===j.dept);j.agent=j.team.lead;j.officeRevision=config.revision;
        j.skills=config.skills.filter(s=>j.team.skills.includes(s.id)||j.agents.some(a=>a.skills.includes(s.id)));j.checks=j.team.checks;j.requireHumanApproval=j.requireHumanApproval||j.team.requireHumanApproval;
      }
      if(input.state)j.state=input.state;
    });
    this.event(id,'queue_updated',null,updated.state==='backlog'?'Task saved to the backlog.':'Task queued with priority '+['low','normal','high'][updated.priority ?? 1]+'.');
    queueMicrotask(()=>this.pump());return updated;
  }
  async acquire(id, eligible, signal) {
    while (true) {
      if (signal?.aborted || this.closed || ['cancelled','blocked'].includes(this.get(id).state)) throw new Error('Task cancelled.');
      const agent = eligible.find(a => !this.busy.has(a));
      if (agent && this.busy.size < this.maxCalls) { this.busy.add(agent); return agent; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  async call(id, phase, agentId, prompt, tools = [], signal, execution = {}) {
    let job = this.get(id);
    if (signal?.aborted || !ACTIVE.has(job.state)) throw new Error('Task is no longer running.');
    if (job.calls >= job.team.maxCalls || job.tokens >= job.team.maxTokens) throw new Error('This task reached the team’s call or token budget. Adjust the limits or simplify the task before retrying.');
    const agent = job.agents.find(a => a.id === agentId);
    const model = job.model || execution.model || (phase === 'plan' ? job.team.planningModel : phase === 'review' ? job.team.reviewModel : agent.model);
    const effort = agent.effort || execution.effort || (phase === 'work' ? 'medium' : 'high');
    this.update(id, j => { j.calls++; });
    let preview='', lastWrite=0, latestTool=null;
    const startedAt=Date.now();
    const publish=(state='running',force=false)=>{
      if(this.closed || signal?.aborted || this.get(id).state==='cancelled')return;
      if(!force&&Date.now()-lastWrite<750)return;lastWrite=Date.now();
      this.update(id,j=>{j.liveCalls ||= {};j.liveCalls[agentId]={phase,state,model,effort,assignedTools:tools,startedAt,lastEventAt:Date.now(),preview:phase==='work'?preview:'',tool:latestTool};});
    };
    publish('running',true);
    const onProgress=event=>{const first=preview.length===0;if(event.kind==='text')preview=(preview+event.text).slice(0,16000);else if(event.kind==='tool'){latestTool=clean(event.name).slice(0,120);this.event(id,'tool_started',agentId,'Using '+latestTool+'.');}publish('running',first || event.kind==='tool');};
    let answer;
    try {
      answer = await this.invoke({ phase, job, agent, prompt, tools: job.kind === 'evaluation' ? [] : tools, signal, onProgress,
        model, effort });
      publish('returned',true);
    } catch(error) {publish('failed',true);throw error;}
    const usage = answer.usage || {};
    this.update(id, j => { j.tokens += (usage.input_tokens || 0) + (usage.output_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0); });
    if (!clean(answer.text)) throw new Error('Claude returned no deliverable.');
    return answer;
  }
  async plan(id) {
    let job = this.get(id); if (job.state === 'cancelled') return;
    if (job.subtasks.length) { this.update(id, j => { j.state = 'working'; }); return; }
    const signal = this.running.get(id)?.controller.signal;
    this.update(id, j => { j.state = 'planning'; });
    const lead = await this.acquire(id, [job.team.lead], signal);
    this.event(id, 'planning', lead, 'Lead is defining subtasks, dependencies and acceptance criteria.');
    try {
      const workers = job.agents.filter(a => a.id !== lead).map(a => ({ id: a.id, name:a.name, role: a.role, does: a.does, instructions:a.brief, model:a.model, effort:a.effort || 'automatic', tools:job.team.tools.filter(t => a.inheritTools !== false || a.tools.includes(t)), skills:a.skills }));
      const memory = this.context(job,job.agents.find(a=>a.id===lead));
      this.update(id,j=>{j.planningNotes=memory.notes || [];});
      const prompt = `Choose execution settings for every subtask: model sonnet for balanced work, opus for complex reasoning or research, fable for simple work; effort low/medium/high/xhigh/max proportional to difficulty. Respect explicit worker effort overrides and task model overrides. Explain why. Select requiredTools ONLY from that worker’s assigned tool IDs; public research requires web or an assigned research MCP. If a necessary capability is unavailable, return {"blocker":"specific missing capability and setting to change"}; never invent tool access or silently substitute company books for public research. Read the actual current specialists below, including newly added roles; do not refuse based on the lead’s historical persona. Tool catalog: ${JSON.stringify(this.toolCatalog())}. Task model override: ${job.model || 'automatic'}. Shared historical memory: ${typeof memory === 'string' ? memory : memory.text}.\nPlan the owner’s task for your team. Use at most ${job.team.maxSubtasks} concrete subtasks. Assign workers whose roles fit; alternatives must also be qualified. The lead reviews and must not be assigned worker subtasks. Dependencies refer only to earlier IDs step-1, step-2, etc. Keep the plan as small as the task allows.\nTask: ${job.text}\nWorkers: ${JSON.stringify(workers)}\nTeam review criteria: ${JSON.stringify([...job.team.criteria, ...(job.team.guardrails || [])])}\nReturn ONLY JSON: {"title":"short task title","summary":"concise execution plan","subtasks":[{"title":"...","instructions":"...","agent":"worker id","alternatives":[],"model":"opus","effort":"high","complexity":"complex","reason":"why this specialist and execution setup","requiredTools":[],"dependencies":[],"acceptance":["observable requirement"]}]}`;
      const answer = await this.call(id, 'plan', lead, prompt, [], signal);
      const parsed = parseObject(answer.text);
      if (clean(parsed.blocker)) throw new Error(clean(parsed.blocker).slice(0,2000));
      const subtasks = validatePlan(parsed, job.team, job.agents);
      this.update(id, j => { if (j.state !== 'cancelled') { j.title = clean(parsed.title).slice(0, 160) || j.title; j.plan = clean(parsed.summary).slice(0, 3000); j.subtasks = subtasks; j.state = 'working'; } });
      this.event(id, 'planned', lead, `${subtasks.length} subtasks planned.`, { steps: subtasks.map(s => ({ id: s.id, title: s.title, eligible: s.eligible, dependencies: s.dependencies })) });
    } finally { this.busy.delete(lead); }
  }
  async execute(id) {
    const job = this.get(id); if (job.state !== 'working') return;
    const ready = job.subtasks.filter(s => s.state === 'pending' && s.dependencies.every(dep => job.subtasks.find(x => x.id === dep)?.state === 'done')).slice(0, job.team.concurrency);
    if (!ready.length && !job.subtasks.every(s => s.state === 'done')) throw new Error('No runnable subtasks. Review failed or interrupted steps before retrying.');
    const signal = this.running.get(id)?.controller.signal;
    await Promise.all(ready.map(async subtask => {
      let agentId;
      try {
      agentId = await this.acquire(id, subtask.eligible, signal);
      if (this.get(id).state !== 'working') return;
      this.update(id, j => { const s = j.subtasks.find(s => s.id === subtask.id); s.agent = agentId; s.state = 'working'; s.startedAt = Date.now(); s.attempts++; });
      this.event(id, 'subtask_started', agentId, subtask.title, { subtask: subtask.id });
        const current = this.get(id), agent = current.agents.find(a => a.id === agentId);
        const dependencies = current.subtasks.filter(s => subtask.dependencies.includes(s.id)).map(s => ({ title: s.title, output: s.output }));
        const allowedTools = subtask.requiredTools || current.team.tools.filter(tool => agent.inheritTools !== false || agent.tools.includes(tool));
        const context = this.context(current, agent);
        const knowledge = typeof context === 'string' ? { text: context, notes: [] } : context;
        this.update(id, j => { j.subtasks.find(s => s.id === subtask.id).notes = knowledge.notes || []; });
        const prompt = `Owner’s objective: ${job.text}\nYour subtask: ${subtask.title}\nInstructions: ${subtask.instructions}\nAcceptance criteria: ${JSON.stringify(subtask.acceptance)}\nDependencies: ${JSON.stringify(dependencies).slice(0, 40000)}\nReview feedback to address: ${subtask.feedback || 'none'}\nRelevant notes:\n${knowledge.text.slice(0, 16000)}\nProduce the actual deliverable with sources or evidence where relevant. ${OUTPUT_GUIDANCE} State blockers honestly. Do not claim to have sent, published or changed anything you did not do. Your work is submitted for independent lead review; you cannot mark the overall task complete.`;
        const answer = await this.call(id, 'work', agentId, prompt, allowedTools, signal, subtask);
        this.update(id, j => { const s = j.subtasks.find(s => s.id === subtask.id); if (j.state !== 'cancelled') { s.state = 'done'; s.output = answer.text.slice(0, 60000); s.tools = answer.tools || []; s.modelUsed = job.model || subtask.model || agent.model; s.modelId = answer.modelId || null; s.effortUsed = agent.effort || subtask.effort || 'medium'; s.finishedAt = Date.now(); } });
        if (this.get(id).state !== 'cancelled') this.event(id, 'subtask_submitted', agentId, 'Deliverable submitted for lead review.', { subtask: subtask.id, tools: answer.tools || [] });
      } catch (error) {
        if (this.get(id).state === 'cancelled') return;
        this.update(id, j => { const s = j.subtasks.find(s => s.id === subtask.id); s.state = 'failed'; s.error = error.message; if (j.state !== 'cancelled') { j.state = 'blocked'; j.error = error.message; } });
        this.event(id, 'subtask_failed', agentId, error.message, { subtask: subtask.id });
      } finally { this.busy.delete(agentId); }
    }));
  }
  async review(id) {
    const job = this.get(id); if (job.state === 'cancelled') return;
    if (!job.subtasks.every(s => s.state === 'done')) throw new Error('Every subtask must have a deliverable before review.');
    this.update(id, j => { j.state = 'reviewing'; });
    const signal = this.running.get(id)?.controller.signal;
    const lead = await this.acquire(id, [job.team.lead], signal);
    this.event(id, 'review_started', lead, 'Lead is checking the actual deliverables against the acceptance criteria.');
    try {
      const criteria = [...job.team.criteria, ...(job.team.guardrails || [])].map((text, i) => ({ id: `criterion-${i + 1}`, text }));
      const memory = this.context(job,job.agents.find(a=>a.id===lead));
      this.update(id,j=>{j.reviewNotes=memory.notes || [];});
      const prompt = `Shared historical memory (verify dates and sources before relying on it): ${typeof memory === 'string' ? memory : memory.text}.\nIndependently review this team’s work. Do not rely on workers saying they finished. Check their actual outputs against every subtask acceptance criterion and every team criterion. A unsupported or missing result must fail. Assemble one coherent final deliverable from verified work; remove duplicated sections and worker handoff language. ${OUTPUT_GUIDANCE} Keep your review rationale in summary/criteria, not in the deliverable. Before returning, EDIT the final deliverable: move the answer/recommendation to the first substantive paragraph, remove repeated facts and boilerplate, combine overlapping worker sections, and ensure each requested output is easy to locate. Preserve evidence and substantive limitations.\nOwner’s task: ${job.text}\nTeam criteria: ${JSON.stringify(criteria)}\nAutomated checks on final deliverable: ${JSON.stringify(job.checks)}\nSubtasks: ${JSON.stringify(job.subtasks.map(s => ({ id: s.id, title: s.title, acceptance: s.acceptance, output: s.output, tools: s.tools }))).slice(0, 120000)}\nReturn ONLY JSON: {"approved":true,"summary":"review conclusion","criteria":[{"id":"criterion-1","passed":true,"evidence":"specific evidence from the deliverable"}],"changes":[{"subtask":"step-1","feedback":"specific required correction"}],"deliverable":"complete final deliverable"}. Include every team criterion exactly once. Approve only if every requirement passes. If rejecting, identify the subtasks to rework.`;
      const reviewer=job.agents.find(a=>a.id===lead);
      const reviewTools=[...new Set(job.subtasks.flatMap(s=>s.requiredTools || []))].filter(tool=>job.team.tools.includes(tool)&&(reviewer.inheritTools!==false||reviewer.tools.includes(tool)));
      const answer = await this.call(id, 'review', lead, prompt + '\nUse assigned research tools to independently spot-check material current claims and cited sources where needed. Never claim source verification without evidence.', reviewTools, signal);
      const parsed = parseObject(answer.text);
      const checks = checkOutput(clean(parsed.deliverable), job.checks);
      const reviewCriteria = Array.isArray(parsed.criteria) ? parsed.criteria : [];
      const covered = reviewCriteria.length === criteria.length && criteria.every(c => reviewCriteria.filter(x => x.id === c.id && x.passed === true && clean(x.evidence)).length === 1);
      const approved = parsed.approved === true && covered && clean(parsed.deliverable).length > 0 && checks.every(c => c.passed);
      const review = { at: Date.now(), agent: lead, approved, summary: clean(parsed.summary).slice(0, 5000), criteria: reviewCriteria, checks };
      this.update(id, j => {
        if (j.state === 'cancelled') return;
        j.review = review; j.reviews.push(review); j.result = clean(parsed.deliverable).slice(0, 120000);
        if (approved) j.state = 'reviewing';
        else if (j.revisions >= j.team.maxRevisions) { j.state = 'blocked'; j.error = 'Lead review did not pass within the revision limit.'; }
        else {
          j.revisions++; j.state = 'working';
          const changes = Array.isArray(parsed.changes) ? parsed.changes : [];
          const targeted = changes.filter(c => j.subtasks.some(s => s.id === c.subtask));
          const redo = new Set(targeted.length ? targeted.map(c => c.subtask) : j.subtasks.map(s => s.id));
          for (const s of j.subtasks) if (s.dependencies.some(dep => redo.has(dep))) redo.add(s.id);
          for (const s of j.subtasks) if (redo.has(s.id)) { s.state = 'pending'; s.feedback = (clean(targeted.find(c => c.subtask === s.id)?.feedback) || review.summary || 'Review all acceptance criteria and correct the deliverable.') + '\nFailed automated checks: ' + checks.filter(c => !c.passed).map(c => c.label).join('; '); }
        }
      });
      this.event(id, approved ? 'review_passed' : 'review_rejected', lead, review.summary || (approved ? 'All acceptance checks passed.' : 'Work requires corrections.'), { checks });
    } finally { this.busy.delete(lead); }
  }
  async run(id, command) {
    if (this.running.has(id)) return this.running.get(id).promise;
    const controller = new AbortController();
    const entry = { controller, promise: null }; this.running.set(id, entry);
    entry.promise = (async () => {
      try {
        const config = { configurable: { thread_id: id }, recursionLimit: 100 };
        const saved = await this.graph.getState(config);
        const input = command || (this.get(id).restartPass ? {id} : saved?.next?.length ? null : {id});
        this.update(id,j=>{delete j.restartPass;});
        await this.graph.invoke(input, config);
      } catch (error) {
        if (this.get(id)?.state !== 'cancelled') {
          this.update(id, j => { j.state = 'blocked'; j.error = error.message; });
          this.event(id, 'blocked', null, error.message);
        }
      } finally { this.running.delete(id); if (!this.closed) queueMicrotask(() => this.pump()); }
      return this.detail(id);
    })();
    return entry.promise;
  }
  pump() {
    if (this.closed) return;
    for (const job of this.list().filter(j=>j.state==='queued').sort((a,b)=>(b.priority ?? 1)-(a.priority ?? 1)||a.createdAt-b.createdAt)) {
      if (this.running.size >= this.maxJobs) break;
      if (job.state === 'queued' && !this.running.has(job.id)) this.run(job.id);
    }
  }
  recover() {
    for (const job of this.list()) if (ACTIVE.has(job.state) && job.state !== 'queued') {
      this.update(job.id, j => { j.state = 'blocked'; j.error = 'The server restarted during this task. Review the recorded steps and retry to resume unfinished work.'; for (const s of j.subtasks) if (s.state === 'working') { s.state = 'interrupted'; } for(const call of Object.values(j.liveCalls || {}))if(call.state==='running')call.state='interrupted'; });
      this.event(job.id, 'interrupted', null, 'Execution interrupted by a server restart. Completed deliverables are preserved.');
    }
    this.pump();
  }
  retry(id, feedback = '') {
    const job = this.get(id);
    if (!job || this.running.has(id) || !['blocked', 'waiting'].includes(job.state)) throw Object.assign(new Error('Only blocked or waiting tasks can be retried.'), { status: 409 });
    this.update(id, j => { j.state = 'queued'; j.error = null; j.humanApproved = false; j.review = null;
      for (const s of j.subtasks) if (feedback || ['failed', 'interrupted'].includes(s.state)) { s.state = 'pending'; s.feedback = clean(feedback).slice(0, 5000); }
      // Retry is explicit. Budget increases come from the current team settings.
      const current = this.office.team(j.dept); j.team.maxCalls = current.maxCalls; j.team.maxTokens = current.maxTokens;
    });
    this.event(id, 'retry_requested', null, clean(feedback) || 'Owner requested resumption of unfinished work.');
    // A new graph pass consults persisted subtasks and does not repeat completed work.
    this.update(id,j=>{j.restartPass=true;});this.pump();
    return this.get(id);
  }
  approve(id) {
    const job = this.get(id);
    if (!job || job.state !== 'waiting' || !job.review?.approved || this.running.has(id)) throw Object.assign(new Error('Only a lead-approved task awaiting your approval can be authorized.'), { status: 409 });
    this.run(id, new Command({ resume: { approve: true } }));
    return this.get(id);
  }
  cancel(id) {
    const job = this.get(id); if (!job || TERMINAL.has(job.state)) throw Object.assign(new Error('This task is already closed.'), { status: 409 });
    if (job.state === 'saving') throw Object.assign(new Error('The approved deliverable is being saved. Wait for completion.'), { status: 409 });
    this.update(id, j => { j.state = 'cancelled'; for (const s of j.subtasks) if (['working','pending'].includes(s.state)) s.state='cancelled'; for (const c of Object.values(j.liveCalls || {})) if(c.state==='running')c.state='cancelled'; });
    this.running.get(id)?.controller.abort(); this.event(id, 'cancelled', null, 'Owner cancelled this task.');
    return this.get(id);
  }
  async close() { this.closed = true; for (const entry of this.running.values()) entry.controller.abort(); await Promise.all([...this.running.values()].map(e => e.promise)); this.db.close(); }
}
