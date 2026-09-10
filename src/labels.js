// One vocabulary for task and step states. Every view imports these labels.
export const STATE_LABELS = {
  backlog: 'Idea', queued: 'Queued', planning: 'Planning', working: 'In progress', reviewing: 'Lead reviewing',
  waiting: 'Needs you', saving: 'Saving', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled',
  awaiting_lead_review: 'Waiting for lead review', awaiting_ceo: 'Needs you', executing: 'Doing the approved action', escalated: 'Needs you',
};
// A finished step has been handed to the lead; it is not the task's completion.
export const STEP_LABELS = {
  pending: 'Not started', working: 'In progress', done: 'Handed to lead', failed: 'Failed', interrupted: 'Interrupted', cancelled: 'Cancelled', paused: 'Waiting for you',
};
export const stateLabel = state => STATE_LABELS[state] || String(state || '');
export const stepLabel = state => STEP_LABELS[state] || String(state || '');
