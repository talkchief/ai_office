// The office's minute clock: overdue notices, reminders for things waiting on the CEO, and the daily digest.
// In a hosted office every member also gets a digest of the tasks they can see, as an inbox item of their own.
import { visibleJobs, ADMIN_ROLES } from './server/visibility.mjs';
const TERMINAL = new Set(['done', 'cancelled']);
const WAITING = { blocked: ['blocked', 'blocked'], escalated: ['escalated', 'escalated'], awaiting_ceo: ['ceo_decision', 'decision'] };
const day = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const hours = ms => { const h = ms / 3600000; return h < 1 ? `${Math.round(h * 60)} minutes` : h < 48 ? `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'}` : `${Math.round(h / 24)} days`; };

// A plain summary of the office, built from records only (no model call, no cost).
export function digest({ jobs, office, since, now = Date.now(), routines = [] }) {
  const tasks = jobs.filter(j => j.kind !== 'evaluation');
  const lines = [], counts = { done: 0, active: 0, needsYou: 0, overdue: 0 };
  for (const team of office.teams) {
    const mine = tasks.filter(j => (j.depts || [j.dept]).includes(team.id));
    const done = mine.filter(j => j.state === 'done' && (j.doneAt || 0) >= since), active = mine.filter(j => !TERMINAL.has(j.state) && !['backlog', 'blocked', 'escalated', 'awaiting_ceo'].includes(j.state));
    const needs = mine.filter(j => ['blocked', 'escalated', 'awaiting_ceo'].includes(j.state)), overdue = mine.filter(j => j.dueAt && j.dueAt < now && !TERMINAL.has(j.state));
    counts.done += done.length; counts.active += active.length; counts.needsYou += needs.length; counts.overdue += overdue.length;
    if (!done.length && !active.length && !needs.length && !overdue.length) continue;
    lines.push(`## ${team.name}`, ...done.map(j => `- Done: ${j.title}`), ...active.map(j => `- In progress: ${j.title}${j.progressLine ? ' — ' + j.progressLine : ''}`), ...needs.map(j => `- Needs you: ${j.title}${j.error ? ' — ' + String(j.error).slice(0, 160) : ''}`), ...overdue.map(j => `- Overdue since ${day(j.dueAt)}: ${j.title}`), '');
  }
  // Routines: what ran since yesterday and how it went, and anything missed that is still unresolved.
  const ran = routines.filter(r => !r.paused && ((r.lastAt || 0) >= since || r.lastOutcome === 'missed'));
  counts.routinesMissed = ran.filter(r => r.lastOutcome === 'missed').length;
  if (ran.length) lines.push('## Routines', ...ran.map(r => r.lastOutcome === 'missed' ? `- ✕ ${r.title}: did not complete${r.failures >= 2 ? ` (${r.failures} in a row)` : ''}` : r.lastOutcome === 'waiting' ? `- ○ ${r.title}: waits for your OK` : r.lastOutcome === 'done' ? `- ✓ ${r.title}: ran ${r.lastLate ? 'late' : 'on time'}` : `- · ${r.title}: ${r.lastOutcome === 'cancelled' ? 'cancelled' : 'still running'}`));
  const headline = `${counts.done} done since yesterday · ${counts.active} in progress · ${counts.needsYou} need you${counts.overdue ? ` · ${counts.overdue} overdue` : ''}${counts.routinesMissed ? ` · ${counts.routinesMissed} routine${counts.routinesMissed === 1 ? '' : 's'} missed` : ''}`;
  return { date: day(now), headline, counts, markdown: `# Daily digest — ${day(now)}\n\n${headline}\n\n${lines.join('\n') || 'Nothing happened in the office.'}\n` };
}

export class Scheduler {
  constructor({ engine, office, settings, now = () => Date.now(), onDigest = async () => {}, viewers = null, projectFor = () => null, routines = () => [] }) {
    Object.assign(this, { engine, office, settings, now, onDigest, viewers, projectFor, routines }); this.timer = null;
    engine.db.exec('CREATE TABLE IF NOT EXISTS office_meta (key TEXT PRIMARY KEY, value TEXT)');
  }
  meta(key, value) {
    if (value === undefined) return this.engine.db.prepare('SELECT value FROM office_meta WHERE key = ?').get(key)?.value;
    this.engine.db.prepare('INSERT OR REPLACE INTO office_meta(key, value) VALUES (?, ?)').run(key, String(value));
  }
  async tick() {
    const s = this.settings(), t = this.now(), engine = this.engine, windowMs = Math.max(0.25, Number(s.escalateAfterHours) || 1) * 3600000;
    for (const job of engine.list()) {
      if (job.kind === 'evaluation' || TERMINAL.has(job.state) || job.state === 'backlog') continue;
      if (job.dueAt && job.dueAt < t && !job.overdueNotifiedAt) {
        engine.update(job.id, j => { j.overdueNotifiedAt = t; }, { touch: false });
        engine.event(job.id, 'overdue', null, 'The task is past its due date.');
        engine.notifications.notify({ kind: 'overdue', title: `Overdue: ${job.title}`, body: `Due ${new Date(job.dueAt).toLocaleString()}.`, jobId: job.id, dept: job.dept, dedupe: `overdue:${job.id}`, action: { type: 'open' }, userId: job.ownerId || null });
      }
      const waiting = WAITING[job.state];
      if (waiting && t - Math.max(job.lastReminderAt || 0, job.stateSince || job.updatedAt || t) >= windowMs) {
        const waited = t - (job.stateSince || job.updatedAt || t);
        engine.update(job.id, j => { j.lastReminderAt = t; }, { touch: false });
        engine.event(job.id, 'reminded', null, `Still waiting for the CEO after ${hours(waited)}.`);
        engine.notifications.notify({ kind: waiting[0], title: `Still waiting on you: ${job.title}`, body: `Waiting ${hours(waited)}. ${job.error || ''}`.trim(), jobId: job.id, dept: job.dept, dedupe: `${waiting[1]}:${job.id}`, action: { type: job.state === 'awaiting_ceo' ? 'decide' : job.state === 'blocked' ? 'retry' : 'answer' }, userId: job.ownerId || null });
      }
    }
    const [hh, mm] = String(s.digestTime || '08:00').split(':').map(Number), now = new Date(t);
    if (this.meta('lastDigest') !== day(t) && (now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= mm))) {
      this.meta('lastDigest', day(t));
      const report = digest({ jobs: engine.list(), office: this.office.get(), since: t - 86400000, now: t, routines: this.routines() });
      await this.onDigest(report);
      // Members who are not office admins: a digest of what they can see, kept to their own inbox (the shared note would show other people's titles).
      for (const v of (this.viewers?.() || []).filter(v => !ADMIN_ROLES.has(v.role))) {
        const mine = digest({ jobs: visibleJobs(v, engine.list(), { projectFor: this.projectFor }), office: this.office.get(), since: t - 86400000, now: t });
        engine.notifications.notify({ kind: 'digest', title: `Your digest · ${mine.date}`, body: mine.markdown.slice(0, 4000), userId: v.id, dedupe: `digest:${v.id}:${mine.date}` });
      }
    }
    this.prune(t);
  }
  // Once a day: clear scratch workspaces and checkpoints of tasks finished more than 30 days ago.
  prune(t = this.now()) {
    if (this.meta('lastPrune') === day(t)) return [];
    this.meta('lastPrune', day(t));
    return this.engine.prune?.({ now: t, days: 30 }) || [];
  }
  start(intervalMs = 60000) { this.stop(); this.timer = setInterval(() => this.tick().catch(e => console.warn('scheduler:', e.message)), intervalMs); this.timer.unref?.(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
