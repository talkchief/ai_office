// Pure projections from the task list to what the office shows. No DOM, so tests can import it.
export const ACTIVE_STATES = ['queued', 'planning', 'working', 'awaiting_lead_review', 'reviewing', 'executing', 'saving'];
export const NEEDS_CEO = ['waiting', 'awaiting_ceo', 'blocked', 'escalated'];

// A result is "new" until the owner opens it after it was completed.
export const unseenResult = job => job?.state === 'done' && !(job.seenAt && job.seenAt >= (job.doneAt || 0));

// What each agent is doing right now. `jobs` is newest first, as the API returns it.
export function agentActivity(jobs) {
  const activity = new Map();
  for (const job of [...jobs].reverse()) {
    if (unseenResult(job)) {
      for (const id of [job.agent, ...job.subtasks.map(s => s.agent)].filter(Boolean)) activity.set(id, { phase: 'done', title: job.title, jobId: job.id });
    } else if (ACTIVE_STATES.includes(job.state)) {
      // Handed-over work only shows while the task is still moving; a blocked or closed task never leaves it hanging.
      for (const step of job.subtasks) if (step.state === 'done' && step.agent) activity.set(step.agent, { phase: 'submitted', title: step.title, jobId: job.id });
    }
  }
  for (const job of jobs) {
    if (['planning', 'reviewing', 'awaiting_lead_review'].includes(job.state)) activity.set(job.agent, { phase: job.state === 'planning' ? 'planning' : 'reviewing', title: job.title, jobId: job.id });
    if (ACTIVE_STATES.includes(job.state)) for (const step of job.subtasks) if (step.state === 'working' && step.agent) activity.set(step.agent, { phase: 'working', title: step.title, jobId: job.id });
  }
  // Whoever is waiting on the CEO shows it: the person who asked for an action, or the lead of a stuck task.
  for (const job of jobs) {
    if (job.state === 'awaiting_ceo') for (const action of job.pendingActions || []) if (action.agent) activity.set(action.agent, { phase: 'needs', title: job.title, jobId: job.id });
    if (['escalated', 'blocked'].includes(job.state) && job.agent) activity.set(job.agent, { phase: 'needs', title: job.title, jobId: job.id });
  }
  // The Program Manager: needs you, then working, then a new result.
  const pm = jobs.find(j => ['awaiting_ceo', 'escalated'].includes(j.state)) || null, busy = jobs.find(j => ACTIVE_STATES.includes(j.state) && j.state !== 'queued'), fresh = jobs.find(unseenResult);
  if (pm) activity.set('pm', { phase: 'needs', title: pm.title, jobId: pm.id });
  else if (busy) activity.set('pm', { phase: 'working', title: busy.title, jobId: busy.id });
  else if (fresh) activity.set('pm', { phase: 'done', title: fresh.title, jobId: fresh.id });
  return activity;
}
