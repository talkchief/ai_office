// A soak run against a live office: fires a set of tasks, waits for every one to finish, and reports how each went.
//
//   node scripts/soak.mjs                       → the built-in set (one task per team plus one Program Manager task)
//   node scripts/soak.mjs --file tasks.json     → your own set: [{ "dept": "fin", "text": "…", "projectId": "…" }, …]
//   node scripts/soak.mjs --parallel            → do not wait for each task before starting the next (the office still queues by its own limit)
//   node scripts/soak.mjs --minutes 40          → give up waiting after this long (default 30)
//   AO_URL=http://host:4520 node scripts/soak.mjs
//
// Prints one line per task (state, minutes, tokens, calls, teams that worked, hand-offs, reviews, files, error) and a
// summary, and exits non-zero when any task did not reach done. Real tasks on a real provider: it costs what tasks cost.
const BASE = (process.env.AO_URL || 'http://localhost:4520').replace(/\/$/, '');
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const MINUTES = Number(flag('--minutes')) || 30, PARALLEL = args.includes('--parallel');

const DEFAULT_SET = [
  { dept: 'emails', text: 'Triage this week’s customer emails in the Brain: list each one, who should answer, and draft the two replies that matter most. Draft only, send nothing.' },
  { dept: 'sales', text: 'Prepare a one-page proposal for a prospect that wants our Growth plan for 12 seats, from the offer ladder and pricing in the Brain. State every assumption.' },
  { dept: 'marketing', text: 'Draft next month’s newsletter from the Brain’s notes: five items, one pull quote, two subject line options under 40 characters.' },
  { dept: 'ops', text: 'Review the vendor agreement in the Brain clause by clause: rank the risks, suggest a rewrite for each, and say what needs a lawyer.' },
  { dept: 'fin', text: 'From the finance notes in the Brain, list the invoices that look overdue and draft a polite reminder for each. Send nothing.' },
  { dept: 'delivery', text: 'Write the handover checklist for the client portal project in the Brain: every item with an owner and what “done” looks like. Export it as a PDF.' },
  { dept: 'auto', text: 'What should we tell a client who asks whether we can start their project two weeks early? Check delivery capacity and the contract terms in the Brain and draft the answer. Send nothing.' },
];

const api = async (path, method = 'GET', body) => {
  const res = await fetch(BASE + '/api' + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data.error || text.slice(0, 200)}`);
  return data;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TERMINAL = new Set(['done', 'cancelled', 'blocked', 'escalated', 'awaiting_ceo', 'waiting']);
const mins = ms => (ms / 60000).toFixed(1);

// Polls until the task reaches a terminal state or the deadline passes; a server that is restarting mid-run is waited for, not fatal.
async function waitFor(id, deadline) {
  let last = null;
  for (;;) {
    try { last = await api(`/tasks/${id}`); if (TERMINAL.has(last.state)) return last; }
    catch (error) { if (!/fetch failed|ECONNREFUSED|ECONNRESET|socket/i.test(String(error.message))) throw error; console.log(`  (office unreachable, waiting: ${error.message.slice(0, 60)})`); }
    if (Date.now() > deadline) return last || { id, state: 'unknown', title: id, runs: [], events: [] };
    await sleep(10000);
  }
}
function summarise(job) {
  const ev = job.events || [];
  const worked = [...new Set((job.runs || []).filter(r => r.role === 'lead' && r.dept).map(r => r.dept))];
  const handoffs = ev.filter(e => e.type === 'handoff_requested').length, retries = ev.filter(e => e.type === 'provider_retry').length;
  const reviews = (job.reviews || []).length, files = (job.files || []).map(f => f.name);
  const started = job.startedAt || job.createdAt, ended = job.doneAt || (TERMINAL.has(job.state) ? job.stateSince : Date.now());
  const spent = (job.runs || []).reduce((a, r) => a + (r.tokens || 0), 0), by = [`pm ${Math.round(((job.tokens || 0) - spent) / 1000)}k`, ...(job.runs || []).filter(r => r.tokens).map(r => `${r.agent} ${Math.round(r.tokens / 1000)}k`)];
  return { id: job.id, title: job.title, state: job.state, minutes: mins(ended - started), tokens: job.tokens || 0, calls: job.calls || 0, worked, handoffs, retries, reviews, files, by, error: job.error || '' };
}

const set = flag('--file') ? JSON.parse(await (await import('node:fs')).promises.readFile(flag('--file'), 'utf8')) : DEFAULT_SET;
const health = await api('/health'); if (!health.ready) { console.error('The office has no model key; add one under Settings → Models & keys.'); process.exit(2); }
console.log(`Soak against ${BASE}: ${set.length} tasks, ${PARALLEL ? 'started together' : 'one after another'}, up to ${MINUTES} minutes each.`);
const startedAt = Date.now(), results = [];
const run = async spec => {
  const created = await api('/tasks', 'POST', { dept: spec.dept || 'auto', depts: spec.dept === 'auto' || !spec.dept ? 'auto' : undefined, text: spec.text, projectId: spec.projectId, priority: spec.priority ?? 1 });
  const job = await waitFor(created.id, Date.now() + MINUTES * 60000);
  const r = summarise(job); results.push(r);
  console.log(`${r.state.padEnd(9)} ${r.minutes.padStart(5)} min ${String(r.tokens).padStart(9)} tok ${String(r.calls).padStart(4)} calls  ${r.worked.join('→') || '-'}  handoffs ${r.handoffs}  reviews ${r.reviews}  retries ${r.retries}  files ${r.files.length}  | ${r.title.slice(0, 60)}${r.error ? '  !! ' + r.error.slice(0, 80) : ''}`);
  console.log(`          who spent what: ${r.by.join(' · ')}`);
  return r;
};
if (PARALLEL) await Promise.all(set.map(run)); else for (const spec of set) await run(spec);
const done = results.filter(r => r.state === 'done').length, tokens = results.reduce((a, r) => a + r.tokens, 0);
console.log(`\n${done}/${results.length} done in ${mins(Date.now() - startedAt)} min, ${tokens.toLocaleString('en-GB')} tokens in total, ${Math.round(tokens / Math.max(1, results.length)).toLocaleString('en-GB')} per task.`);
for (const r of results.filter(r => r.state !== 'done')) console.log(`  not done: ${r.title.slice(0, 60)} → ${r.state}${r.error ? ': ' + r.error.slice(0, 120) : ''}`);
process.exit(done === results.length ? 0 : 1);
