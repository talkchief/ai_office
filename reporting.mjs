// Reports are deterministic projections of persisted jobs; no invented business metrics.
const sum = (jobs, key) => jobs.reduce((total, job) => total + (Number(job[key]) || 0), 0);
const summarize = jobs => {
  const approved = jobs.filter(j => j.state === 'done');
  const durations = approved.filter(j => Number.isFinite(j.doneAt) && Number.isFinite(j.createdAt)).map(j => Math.max(0,j.doneAt-j.createdAt)).sort((a,b)=>a-b);
  const middle = Math.floor(durations.length / 2);
  return { total:jobs.length, backlog:jobs.filter(j=>j.state==='backlog').length, approved:approved.length, active:jobs.filter(j=>['queued','planning','working','reviewing','saving'].includes(j.state)).length,
    waiting:jobs.filter(j=>j.state==='waiting').length, blocked:jobs.filter(j=>j.state==='blocked').length, cancelled:jobs.filter(j=>j.state==='cancelled').length,
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
    limits:{callsPerTask:team.maxCalls,tokensPerTask:team.maxTokens,concurrentWorkers:team.concurrency},
    agents:office.agents.filter(a=>a.department===team.id).map(agent=>({id:agent.id,name:agent.name,lead:agent.id===team.lead,
      submitted:tasks.flatMap(j=>j.subtasks || []).filter(s=>s.agent===agent.id&&s.state==='done').length,
      active:tasks.filter(j=>['working','planning','reviewing'].includes(j.state)).flatMap(j=>j.subtasks || []).filter(s=>s.agent===agent.id&&s.state==='working').length,
      reviews:tasks.flatMap(j=>j.reviews || []).filter(r=>r.agent===agent.id).length}))}));
  const suites = new Map();
  for(const job of tests){const id=job.suiteId || job.id;if(!suites.has(id))suites.set(id,{id,dept:job.dept,officeRevision:job.officeRevision,createdAt:job.createdAt,jobs:[]});suites.get(id).jobs.push({id:job.id,name:job.testName||job.title,state:job.state,error:job.error,checks:job.review?.checks || []});}
  return {generatedAt:now,since,days,summary:summarize(tasks),tests:summarize(tests),teams,suites:[...suites.values()],
    attention:tasks.filter(j=>['blocked','waiting'].includes(j.state)).map(j=>({id:j.id,title:j.title,dept:j.dept,state:j.state,reason:j.error || 'Lead approved; owner review is pending.'})),
    completed:tasks.filter(j=>j.state==='done').map(j=>({id:j.id,title:j.title,dept:j.dept,doneAt:j.doneAt}))};
}
