// Reports are deterministic projections of persisted jobs; no invented business metrics.
const sum = (jobs, key) => jobs.reduce((total, job) => total + (Number(job[key]) || 0), 0);
const summarize = jobs => {
  const approved = jobs.filter(j => j.state === 'done');
  const durations = approved.filter(j => Number.isFinite(j.doneAt) && Number.isFinite(j.createdAt)).map(j => Math.max(0,j.doneAt-j.createdAt)).sort((a,b)=>a-b);
  const middle = Math.floor(durations.length / 2);
  return { total:jobs.length, backlog:jobs.filter(j=>j.state==='backlog').length, approved:approved.length, active:jobs.filter(j=>['queued','planning','working','awaiting_lead_review','reviewing','executing','saving'].includes(j.state)).length,
    waiting:jobs.filter(j=>['waiting','awaiting_ceo','escalated'].includes(j.state)).length, blocked:jobs.filter(j=>j.state==='blocked').length, cancelled:jobs.filter(j=>j.state==='cancelled').length,
    calls:sum(jobs,'calls'),tokens:sum(jobs,'tokens'),rework:jobs.filter(j=>j.revisions>0 || (j.reviews || []).length>1 || (j.subtasks || []).some(s=>s.attempts>1)).length,
    medianCycleMs:durations.length ? durations.length%2 ? durations[middle] : (durations[middle-1]+durations[middle])/2 : null };
};
export function officeReport({ jobs, office, days = 7, now = Date.now() }) {
  if (![7,30,90,0].includes(days)) throw new Error('Choose 7, 30, 90 days or all time.');
  const since = days ? now-days*86400000 : 0;
  const period = jobs.filter(j=>j.createdAt>=since && j.createdAt<=now);
  const tasks = period.filter(j=>j.kind!=='evaluation'),tests = period.filter(j=>j.kind==='evaluation');
  const teams = office.teams.map(team=>({id:team.id,name:team.name,lead:office.agents.find(a=>a.id===team.lead)?.name || team.lead,
    ...summarize(tasks.filter(j=>j.dept===team.id)),tests:summarize(tests.filter(j=>j.dept===team.id)),
    limits:{parallelRuns:team.maxParallelRuns ?? team.concurrency ?? 2,reworkRounds:team.maxReworkRounds ?? team.maxRevisions ?? 3},
    agents:office.agents.filter(a=>a.department===team.id).map(agent=>({id:agent.id,name:agent.name,lead:agent.id===team.lead,
      submitted:tasks.flatMap(j=>j.subtasks || []).filter(s=>s.agent===agent.id&&s.state==='done').length,
      active:tasks.filter(j=>['working','planning','reviewing'].includes(j.state)).flatMap(j=>j.subtasks || []).filter(s=>s.agent===agent.id&&s.state==='working').length,
      reviews:tasks.flatMap(j=>j.reviews || []).filter(r=>r.agent===agent.id).length}))}));
  const suites = new Map();
  for(const job of tests){const id=job.suiteId || job.id;if(!suites.has(id))suites.set(id,{id,dept:job.dept,officeRevision:job.officeRevision,createdAt:job.createdAt,jobs:[]});suites.get(id).jobs.push({id:job.id,name:job.testName||job.title,state:job.state,error:job.error,checks:job.review?.checks || []});}
  return {generatedAt:now,since,days,summary:summarize(tasks),tests:summarize(tests),teams,suites:[...suites.values()],
    attention:tasks.filter(j=>['blocked','waiting','awaiting_ceo','escalated'].includes(j.state)).map(j=>({id:j.id,title:j.title,dept:j.dept,state:j.state,reason:j.error || 'Waiting for your decision.'})),
    completed:tasks.filter(j=>j.state==='done').map(j=>({id:j.id,title:j.title,dept:j.dept,doneAt:j.doneAt}))};
}

// Company KPIs for the Reports page. `events(id)` returns a task's recorded events (state changes carry from/to).
const percentile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] : null;
const average = list => list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null;
export function timeInStates(events, until) {
  const spent = {}, changes = events.filter(e => e.type === 'state_changed').sort((a, b) => a.at - b.at);
  changes.forEach((e, i) => { const end = changes[i + 1]?.at ?? until; spent[e.to] = (spent[e.to] || 0) + Math.max(0, end - e.at); });
  return spent;
}
export function kpis({ jobs, events, office, days = 7, now = Date.now() }) {
  if (![7, 30, 90, 0].includes(days)) throw new Error('Choose 7, 30, 90 days or all time.');
  const since = days ? now - days * 86400000 : 0;
  const tasks = jobs.filter(j => j.kind !== 'evaluation'), period = tasks.filter(j => j.createdAt >= since || (j.doneAt || 0) >= since || !['done', 'cancelled'].includes(j.state));
  const done = tasks.filter(j => j.state === 'done' && (j.doneAt || 0) >= since);
  const cycle = done.map(j => j.doneAt - j.createdAt).filter(ms => ms >= 0).sort((a, b) => a - b);
  const spent = period.map(j => ({ job: j, time: timeInStates(events(j.id), j.state === 'done' ? j.doneAt || now : now) }));
  const leadWait = spent.map(s => (s.time.awaiting_lead_review || 0) + (s.time.reviewing || 0)).filter(ms => ms > 0);
  const ceoWait = spent.map(s => (s.time.awaiting_ceo || 0) + (s.time.escalated || 0)).filter(ms => ms > 0);
  const reviewed = period.filter(j => (j.reviews || []).length), reworked = reviewed.filter(j => j.reviews.some(r => !r.approved));
  const waiting = tasks.filter(j => ['blocked', 'escalated'].includes(j.state));
  const bucket = [...Array(days || 30)].map((_, i) => { const start = now - (i + 1) * 86400000; return { day: new Date(start + 86400000).toISOString().slice(0, 10), done: done.filter(j => j.doneAt > start && j.doneAt <= start + 86400000).length }; }).reverse();
  const tokensByModel = {};
  for (const j of period) for (const [model, n] of Object.entries(j.tokensByModel || {})) tokensByModel[model] = (tokensByModel[model] || 0) + n;
  const agents = office.agents.map(a => {
    const runs = period.flatMap(j => (j.runs || []).filter(r => r.agent === a.id)), finished = runs.filter(r => r.finishedAt && r.startedAt);
    return { id: a.id, name: a.name, team: a.department, active: runs.filter(r => r.state === 'working').length, runs: runs.filter(r => (r.startedAt || 0) >= since).length, avgRunMs: average(finished.map(r => r.finishedAt - r.startedAt)) };
  }).filter(a => a.runs || a.active);
  return { days, since, generatedAt: now,
    throughput: { done: done.length, perDay: +(done.length / (days || Math.max(1, Math.ceil((now - Math.min(now, ...tasks.map(j => j.createdAt))) / 86400000)))).toFixed(2), series: bucket },
    cycle: { p50: percentile(cycle, 0.5), p90: percentile(cycle, 0.9) }, leadReviewMs: average(leadWait), ceoLatencyMs: average(ceoWait),
    reworkRate: reviewed.length ? +(reworked.length / reviewed.length).toFixed(2) : null,
    blockedAgeMs: waiting.length ? Math.max(...waiting.map(j => now - (j.stateSince || j.updatedAt || now))) : 0,
    overdue: tasks.filter(j => j.dueAt && j.dueAt < now && !['done', 'cancelled'].includes(j.state)).length,
    needsYou: tasks.filter(j => ['awaiting_ceo', 'escalated', 'blocked'].includes(j.state)).length,
    agents, tokensByModel, teams: office.teams.map(t => ({ id: t.id, name: t.name, done: done.filter(j => (j.depts || [j.dept]).includes(t.id)).length, active: tasks.filter(j => (j.depts || [j.dept]).includes(t.id) && !['done', 'cancelled', 'backlog'].includes(j.state)).length })) };
}
