// Turns Deep Agents stream events into what the CEO sees: runs, states, tools, live drafts and token use.
const flat = content => typeof content === 'string' ? content : Array.isArray(content) ? content.map(p => typeof p === 'string' ? p : p?.type === 'text' ? p.text || '' : '').join('') : '';
export function parseTaskInput(input) {
  let value = input;
  if (value && typeof value.input === 'string') { try { value = JSON.parse(value.input); } catch { value = {}; } }
  else if (value?.input && typeof value.input === 'object') value = value.input;
  return { subagent: String(value?.subagent_type || ''), description: String(value?.description || '').trim() };
}
export function toolOutputText(output) {
  if (output == null) return '';
  if (typeof output === 'string') return output;
  if (output instanceof Error) return output.message;
  if (output.content !== undefined) return flat(output.content);
  const messages = output.update?.messages || output.lg_update?.messages || output.kwargs?.update?.messages;
  if (messages?.length) { const last = messages.at(-1); return flat(last.content ?? last.kwargs?.content); }
  if (output.kwargs?.content !== undefined) return flat(output.kwargs.content);
  try { return JSON.stringify(output).slice(0, 4000); } catch { return String(output); }
}
const argsOf = input => { if (input && typeof input.input === 'string') { try { return JSON.parse(input.input); } catch { return {}; } } return input?.input && typeof input.input === 'object' ? input.input : input || {}; };

export class RunTracker {
  constructor(engine, jobId, models = {}) {
    this.engine = engine; this.id = jobId; this.models = models; this.office = engine.office.get();
    this.previews = new Map(); this.lastWrite = 0; this.executing = new Set(); this.seq = 0;
  }
  // Deep Agents names every event after the agent that produced it: program-manager, lead-<team>, or a specialist id.
  agentOf(event) {
    const name = String(event.metadata?.lc_agent_name || '');
    if (!name || name === 'program-manager') return 'pm';
    if (name.startsWith('lead-')) return this.office.teams.find(t => t.id === name.slice(5))?.lead || name;
    return name;
  }
  target(subagent) {
    const isLead = subagent.startsWith('lead-'), dept = isLead ? subagent.slice(5) : this.office.agents.find(a => a.id === subagent)?.department || null;
    return { isLead, dept, agent: isLead ? this.office.teams.find(t => t.id === dept)?.lead || subagent : subagent };
  }
  activeRun(job, agent) { return job.runs.find(r => r.agent === agent && r.state === 'working') || null; }
  handle(event) {
    const { event: type, name } = event;
    // The same tool call and the same model call can surface twice from the stream (once from the middleware that wraps the
    // tool, once from the tool node); a run id is seen once.
    if (['on_tool_start', 'on_tool_end', 'on_tool_error', 'on_chat_model_start', 'on_chat_model_end'].includes(type) && event.run_id) { this.seen ||= new Set(); const key = type + ':' + event.run_id; if (this.seen.has(key)) return; this.seen.add(key); if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2500)); }
    if (name === 'task' && type === 'on_tool_start') return this.startRun(event);
    if (name === 'task' && (type === 'on_tool_end' || type === 'on_tool_error')) return this.endRun(event, type === 'on_tool_error');
    if (type === 'on_tool_start') return this.toolStart(event);
    if (type === 'on_tool_end' || type === 'on_tool_error') return this.toolEnd(event);
    if (type === 'on_chat_model_start') return this.modelStart(event);
    if (type === 'on_chat_model_stream') return this.modelStream(event);
    if (type === 'on_chat_model_end') return this.modelEnd(event);
  }
  startRun(event) {
    const engine = this.engine, { subagent, description } = parseTaskInput(event.data?.input), { isLead, dept, agent } = this.target(subagent);
    const title = description.slice(0, 300) || 'Assignment', job = engine.get(this.id);
    // Resuming after an approval re-enters the same delegation; keep one run for it.
    const paused = job.runs.find(r => r.state === 'paused' && r.agent === agent && r.title === title);
    if (paused) { engine.update(this.id, j => { j.runs.find(r => r.id === paused.id).state = 'working'; }); return; }
    const run = { id: `${Date.now().toString(36)}-${++this.seq}`, agent, role: isLead ? 'lead' : 'specialist', dept, by: this.agentOf(event), title, state: 'working', startedAt: Date.now(), tools: [], model: this.models[agent] || null };
    engine.update(this.id, j => { j.runs.push(run); });
    engine.event(this.id, 'run_started', agent, title, { run: run.id, role: run.role });
    if (job.state === 'planning' || (run.role === 'specialist' && ['awaiting_lead_review', 'reviewing'].includes(job.state))) engine.setState(this.id, 'working');
  }
  endRun(event, failed) {
    const engine = this.engine, { subagent, description } = parseTaskInput(event.data?.input), { agent } = this.target(subagent);
    // A pause for the CEO bubbles up through each delegation as an error. The work is waiting, not failed.
    const error = event.data?.error;
    if (failed && (error?.name === 'GraphInterrupt' || /GraphInterrupt|actionRequests/.test(String(error?.message || error || '')))) {
      engine.update(this.id, j => { const r = j.runs.find(r => r.agent === agent && r.state === 'working'); if (r) r.state = 'paused'; });
      return;
    }
    const output = toolOutputText(failed ? event.data?.error : event.data?.output), title = description.slice(0, 300) || 'Assignment';
    let finished = null;
    engine.update(this.id, j => {
      const r = j.runs.find(r => r.agent === agent && r.state === 'working' && r.title === title) || j.runs.find(r => r.agent === agent && r.state === 'working'); if (!r) return;
      r.state = failed ? 'failed' : 'done'; r.finishedAt = Date.now(); r.output = output.slice(0, 60000); if (failed) r.error = output.slice(0, 2000);
      if (j.liveCalls?.[r.agent]?.state === 'running') j.liveCalls[r.agent].state = 'returned';
      finished = { ...r };
    });
    if (!finished) return;
    engine.event(this.id, failed ? 'run_failed' : 'run_finished', finished.agent, finished.title, { run: finished.id, role: finished.role });
    const job = engine.get(this.id); if (['cancelled', 'done', 'saving'].includes(job.state)) return;
    if (finished.role === 'specialist' && !failed && !job.runs.some(r => r.dept === finished.dept && r.role === 'specialist' && r.state === 'working')) engine.setState(this.id, 'awaiting_lead_review');
    if (finished.role === 'lead' && ['awaiting_lead_review', 'reviewing'].includes(job.state)) engine.setState(this.id, 'working');
  }
  toolStart(event) {
    const engine = this.engine, agent = this.agentOf(event);
    if (event.name === 'write_todos' && agent === 'pm') { const todos = argsOf(event.data?.input).todos; if (Array.isArray(todos)) engine.update(this.id, j => { j.todos = todos.slice(0, 30).map(t => ({ content: String(t.content || '').slice(0, 300), status: String(t.status || 'pending') })); }); }
    if (['report_progress', 'write_todos', 'record_review', 'complete_task', 'ask_ceo'].includes(event.name)) return;
    engine.update(this.id, j => {
      const r = this.activeRun(j, agent); if (r && !r.tools.includes(event.name)) r.tools.push(event.name);
      if (j.liveCalls?.[agent]) j.liveCalls[agent].tool = event.name;
    });
    // The CEO sees what the tool was pointed at: a path, a query, an address, a source file; never a whole payload.
    const args = argsOf(event.data?.input), target = String(args.file_path ?? args.path ?? args.query ?? args.url ?? args.source ?? args.pattern ?? args.command ?? (typeof args === 'string' ? args : '') ?? '').replace(/\s+/g, ' ').trim().slice(0, 90);
    engine.event(this.id, 'tool_started', agent, target ? `Using ${event.name}: ${target}` : `Using ${event.name}.`, { tool: event.name, target });
    if (engine.get(this.id).state === 'executing') this.executing.add(`${agent}:${event.name}`);
  }
  toolEnd(event) { if (this.executing.delete(`${this.agentOf(event)}:${event.name}`) && this.engine.get(this.id).state === 'executing') this.engine.setState(this.id, 'working'); }
  modelStart(event) {
    const engine = this.engine, agent = this.agentOf(event), job = engine.get(this.id), run = this.activeRun(job, agent);
    this.previews.set(agent, '');
    engine.update(this.id, j => { j.calls = (j.calls || 0) + 1; const own = j.runs.find(r => r.agent === agent && r.state === 'working'); if (own) own.calls = (own.calls || 0) + 1; (j.liveCalls ||= {})[agent] = { phase: run?.role || 'pm', state: 'running', model: this.models[agent] || null, startedAt: Date.now(), lastEventAt: Date.now(), preview: '', tool: null }; });
    // The lead picks the work back up after its specialists hand over: that is the review.
    if (run?.role === 'lead' && job.state === 'awaiting_lead_review' && !job.runs.some(r => r.dept === run.dept && r.role === 'specialist' && r.state === 'working')) engine.setState(this.id, 'reviewing');
  }
  modelStream(event) {
    const agent = this.agentOf(event), chunk = flat(event.data?.chunk?.content ?? event.data?.chunk?.kwargs?.content); if (!chunk) return;
    const preview = ((this.previews.get(agent) || '') + chunk).slice(-16000); this.previews.set(agent, preview);
    this.engine.bus?.publishLive(`live:${this.id}:${agent}`, 'task.live', { id: this.id, agent, preview });
    if (Date.now() - this.lastWrite > 750) this.flush();
  }
  modelEnd(event) {
    const output = event.data?.output, usage = output?.usage_metadata || output?.kwargs?.usage_metadata || output?.generations?.[0]?.[0]?.message?.usage_metadata;
    const agent = this.agentOf(event), model = this.models[agent] || 'unknown', used = (usage?.input_tokens || 0) + (usage?.output_tokens || 0);
    // The planning tool runs inside the agent's middleware and emits no tool events, so the plan is read from the model's own reply.
    const calls = output?.tool_calls || output?.kwargs?.tool_calls || [];
    for (const c of calls) if (c?.name === 'write_todos' && agent === 'pm' && Array.isArray(c.args?.todos)) { const todos = c.args.todos.slice(0, 30).map(t => ({ content: String(t.content || '').slice(0, 300), status: String(t.status || 'pending') })); this.engine.update(this.id, j => { j.todos = todos; }); this.engine.event(this.id, 'todos_updated', 'pm', `${todos.filter(t => t.status === 'completed').length}/${todos.length} planned steps done.`); }
    this.engine.update(this.id, j => { if (used) { j.tokens = (j.tokens || 0) + used; (j.tokensByModel ||= {})[model] = (j.tokensByModel[model] || 0) + used; const own = j.runs.find(r => r.agent === agent && r.state === 'working'); if (own) own.tokens = (own.tokens || 0) + used; } if (j.liveCalls?.[agent]) { j.liveCalls[agent].state = 'returned'; j.liveCalls[agent].lastEventAt = Date.now(); j.liveCalls[agent].preview = this.previews.get(agent) || j.liveCalls[agent].preview; } });
    // Past the budget, the run is stopped where it is; the task blocks with the reason and a Retry continues it. The budget counts
    // from the last time the CEO continued the task, so that Retry gets a fresh budget instead of stopping again at once.
    const budget = Number(this.engine.settings?.()?.tokenBudgetPerTask) || 0, after = this.engine.get(this.id), total = (after?.tokens || 0) - (after?.budgetBase || 0);
    if (budget && total > budget && !this.budgetHit) { this.budgetHit = true; this.engine.running.get(this.id)?.controller.abort(Object.assign(new Error(`This task used more than ${budget.toLocaleString('en-GB')} tokens and was stopped to protect your spend. Retry to continue from where it stopped, or raise the budget under Settings → Office.`), { budget: true })); }
  }
  flush() {
    this.lastWrite = Date.now(); if (!this.previews.size) return;
    this.engine.update(this.id, j => { for (const [agent, preview] of this.previews) if (j.liveCalls?.[agent]) { j.liveCalls[agent].preview = preview; j.liveCalls[agent].lastEventAt = Date.now(); } });
  }
}
