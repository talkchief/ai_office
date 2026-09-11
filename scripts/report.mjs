// A post-mortem of one task: the timeline, who worked for how long, tokens and calls per agent, reviews, hand-offs, loop stops, files.
//
//   node scripts/report.mjs <task id or a unique start of its title>
//   node scripts/report.mjs --latest 2        → the two newest tasks
//   AO_URL=http://host:4520 node scripts/report.mjs …
const BASE = (process.env.AO_URL || 'http://localhost:4520').replace(/\/$/, '');
const args = process.argv.slice(2);
const api = async path => { const res = await fetch(BASE + '/api' + path); if (!res.ok) throw new Error(`${path} → ${res.status}`); return res.json(); };
const t = ms => ms ? new Date(ms).toTimeString().slice(0, 8) : '…';
const mins = ms => (ms / 60000).toFixed(1) + ' min';
const k = n => Math.round((n || 0) / 1000) + 'k';

const all = await api('/tasks'); const list = Array.isArray(all) ? all : all.tasks || [];
let picked = [];
if (args[0] === '--latest') picked = [...list].sort((a, b) => b.createdAt - a.createdAt).slice(0, Number(args[1]) || 1);
else if (args[0]) picked = list.filter(j => j.id === args[0] || j.id.startsWith(args[0]) || j.title.toLowerCase().startsWith(args[0].toLowerCase()));
if (!picked.length) { console.error('No task matches. Give a task id, a unique start of its title, or --latest N.'); process.exit(2); }

for (const brief of picked) {
  const job = await api(`/tasks/${brief.id}`);
  const runs = job.runs || [], events = job.events || [];
  const started = job.startedAt || job.createdAt, ended = ['done', 'cancelled', 'blocked', 'escalated'].includes(job.state) ? job.stateSince : Date.now();
  const spent = runs.reduce((a, r) => a + (r.tokens || 0), 0);
  console.log(`\n${job.title}\n  ${job.id} · ${job.state} · ${t(started)} → ${t(ended)} (${mins(ended - started)}) · ${(job.tokens || 0).toLocaleString('en-GB')} tokens in ${job.calls || 0} calls${job.projectId ? ' · project ' + job.projectId : ''}${job.error ? '\n  stopped: ' + job.error : ''}`);
  console.log('  who spent what: ' + [`pm ${k((job.tokens || 0) - spent)}`, ...runs.filter(r => r.tokens).map(r => `${r.agent} ${k(r.tokens)} in ${r.calls || 0} calls${r.effort ? ' at ' + r.effort : ''}`)].join(' · '));
  if (job.todos?.length) console.log('  plan: ' + job.todos.map(x => `[${x.status === 'completed' ? 'x' : x.status === 'in_progress' ? '~' : ' '}] ${x.content.slice(0, 80)}`).join('\n        '));
  console.log('  runs:');
  for (const r of runs) console.log(`    ${t(r.startedAt)} → ${t(r.finishedAt || r.endedAt)} ${String(mins((r.finishedAt || r.endedAt || Date.now()) - r.startedAt)).padStart(9)}  ${(r.agent || '').padEnd(24)} ${(r.role || '').padEnd(10)} ${(r.dept || '-').padEnd(9)} ${(r.state || '').padEnd(8)} by ${r.by || '-'}  ${(r.title || '').replace(/\s+/g, ' ').slice(0, 70)}`);
  const notable = events.filter(e => ['state_changed', 'review_recorded', 'review_refused', 'handoff_requested', 'loop_stopped', 'provider_retry', 'blocked', 'escalated', 'todos_updated', 'progress'].includes(e.type));
  console.log('  timeline:');
  for (const e of notable) console.log(`    ${t(e.at)} ${e.type.padEnd(16)} ${(e.agent || '-').padEnd(24)} ${(e.message || '').replace(/\s+/g, ' ').slice(0, 110)}`);
  const tools = {}; for (const e of events.filter(e => e.type === 'tool_started')) { const key = `${e.agent || '-'} ${e.tool || (e.message || '').replace(/^Using /, '').split(':')[0]}`; tools[key] = (tools[key] || 0) + 1; }
  const top = Object.entries(tools).sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (top.length) console.log('  tool calls: ' + top.map(([key, n]) => `${key} ×${n}`).join(' · '));
  if (job.reviews?.length) console.log('  reviews: ' + job.reviews.map(r => `${r.dept} ${r.approved ? 'approved' : 'not approved'}${r.file ? ' (' + r.file + ')' : ''}`).join(' · '));
  if (job.files?.length) console.log('  files: ' + job.files.map(f => f.name).join(', '));
}
