// Milestones and what they wait for. A milestone's `after` lists the ids of the milestones it depends on; unset, it waits for the
// one before it in the plan. Milestones that do not wait for each other are worked in parallel. Shared by the project store, the
// planner, the board and the project page (no imports, so the bundle can carry it too).
export const OPEN_STATES = ['queued', 'planning', 'working', 'reviewing', 'saving', 'executing', 'awaiting_lead_review'];
export const WAITING_STATES = ['waiting', 'awaiting_ceo'];
export const BLOCKED_STATES = ['blocked', 'escalated'];
export const STATE_WORD = { done: 'achieved', blocked: 'blocked', waiting: 'waiting for you', active: 'in progress', idle: 'queued', unplanned: 'to plan', later: 'to come' };
const byDue = (a, b) => (a.dueAt || Infinity) - (b.dueAt || Infinity);

// The milestones this one waits for: its own list (unknown ids and itself left out), or the one before it when it has none set.
export function dependsOn(milestones = [], m) {
  if (!m) return [];
  const ids = new Set(milestones.map(x => x.id));
  if (Array.isArray(m.after)) return m.after.filter(id => id !== m.id && ids.has(id));
  const i = milestones.findIndex(x => x.id === m.id);
  return i > 0 ? [milestones[i - 1].id] : [];
}
// The milestones that can be worked now: not achieved, everything they wait for achieved; earliest due first.
export function readyMilestones(milestones = []) {
  const done = new Set(milestones.filter(m => m.done).map(m => m.id));
  return milestones.filter(m => !m.done && dependsOn(milestones, m).every(id => done.has(id))).sort(byDue);
}
// True when `from` waits, directly or through others, for `target`.
export function waitsFor(milestones = [], from, target, seen = new Set()) {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  const m = milestones.find(x => x.id === from);
  return !!m && dependsOn(milestones, m).some(id => waitsFor(milestones, id, target, seen));
}
// The column of each milestone in the flow: the longest chain of milestones before it.
export function layers(milestones = []) {
  const depth = new Map(milestones.map(m => [m.id, 0]));
  let changed = true, rounds = 0;
  while (changed && rounds++ <= milestones.length) {
    changed = false;
    for (const m of milestones) { const d = Math.max(0, ...dependsOn(milestones, m).map(id => (depth.get(id) ?? -1) + 1)); if (d > depth.get(m.id)) { depth.set(m.id, d); changed = true; } }
  }
  return depth;
}
// The tasks that count for a milestone: created for it, or, for the first ready milestone, carrying no milestone at all and
// finished after the last milestone achieved (older tasks, or tasks added while the project had no milestones). Cancelled never.
export function tasksOf(milestones = [], m, tasks = [], { first = readyMilestones(milestones)[0] || null } = {}) {
  const since = Math.max(0, ...milestones.filter(x => x.done).map(x => x.doneAt || 0));
  return tasks.filter(t => t.state !== 'cancelled' && (t.milestoneId === m.id || (!t.milestoneId && first?.id === m.id && (t.doneAt || Infinity) > since)));
}
// A milestone's own state, from its tasks: achieved, blocked, waiting for the CEO, in progress, queued, to plan (ready, no tasks), to come.
export function milestoneState(m, own = [], ready = false) {
  const has = states => own.some(t => states.includes(t.state));
  if (m.done || (own.length && own.every(t => t.state === 'done'))) return 'done';
  if (has(BLOCKED_STATES)) return 'blocked';
  if (has(WAITING_STATES)) return 'waiting';
  if (has(OPEN_STATES)) return 'active';
  return own.length ? 'idle' : ready ? 'unplanned' : 'later';
}
