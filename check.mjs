// Agents Office — the check loop.
//   node check.mjs               build, configuration checks, the full test suite, and a server smoke test
//   CHECK_LIVE=1 node check.mjs  … plus one real task through the configured model provider (costs a little)
// Every step prints ✓ or ✗ with the reason; the process exits 1 if anything failed.
// The server smoke test runs on its own temporary data and Brain folders, never on the office's real data.
// Browser checks for the interface live with the interface itself, which is being rebuilt separately.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, ROOT } from './config.mjs';

const results = [];
const ok = (name, detail = '') => { results.push([true, name, detail]); console.log(`✓ ${name}${detail ? '  — ' + detail : ''}`); };
const bad = (name, detail = '') => { results.push([false, name, detail]); console.log(`✗ ${name}${detail ? '  — ' + detail : ''}`); };
const step = async (name, fn) => { try { const d = await fn(); ok(name, d || ''); return true; } catch (e) { bad(name, e.message); return false; } };
const sh = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { cwd: ROOT, ...opts }); let out = '', err = '';
  p.stdout?.on('data', d => { out += d; }); p.stderr?.on('data', d => { err += d; });
  p.on('close', c => c === 0 ? resolve(out) : reject(Object.assign(new Error((err || out).trim().split('\n').slice(-3).join(' | ')), { out })));
  p.on('error', reject);
});
const NODE = process.execPath;
const cfg = loadConfig();
const LIVE = process.env.CHECK_LIVE === '1';

/* ---------- 1. build ---------- */
await step('build: braingraph + bundle', async () => {
  const out = await sh(NODE, ['build.mjs']);
  const file = path.join(ROOT, 'dist', 'command-centre-v2.html');
  if (!fs.existsSync(file)) throw new Error('no bundle at ' + path.relative(ROOT, file));
  const size = fs.statSync(file).size; if (size < 50000) throw new Error('bundle looks too small: ' + size);
  return `${(size / 1024 / 1024).toFixed(1)} MB · ${out.trim().split('\n').pop()}`;
});
await step('build: graph has linked notes', async () => {
  const { BRAIN } = await import('./src/braingraph.js?' + Date.now());
  if (!BRAIN.nodes.length || !BRAIN.links.length) throw new Error('empty graph');
  return `${BRAIN.notes} notes · ${BRAIN.nodes.length} linked · ${BRAIN.links.length} links`;
});

/* ---------- 2. the shipped roster, skills, connectors and routines ---------- */
await step('roster: office.agents.json validates', async () => {
  const { loadRoster } = await import('./roster.mjs');
  const r = loadRoster();
  if (r.agents.length !== 35) throw new Error('agents: ' + r.agents.length);
  if (r.problems.length) throw new Error(r.problems.join(' | '));
  if (r.agents.some(a => !a.role || !a.does)) throw new Error('a seat has no default role or job description');
  return `${r.agents.length} seats · ${r.customised} customised${r.files.length ? ' · ' + r.files.join(' + ') : ''}`;
});
await step('roster: bad edits are refused, not applied', async () => {
  const { validate } = await import('./roster.mjs');
  const r = validate({ agents: [{ id: 'newt', name: 'PODCAST NOTES', department: 'sales', lead: true, colour: 'red' }, { id: 'ghost', name: 'X' }] });
  const n = r.agents.find(a => a.id === 'newt');
  if (n.name !== 'PODCAST NOTES' || n.department !== 'marketing' || n.lead) throw new Error('validation let a fixed field through');
  if (r.problems.length < 4) throw new Error('expected four problems, got ' + r.problems.length);
});
await step('skills: shipped skills load and bind', async () => {
  const { loadSkills } = await import('./skills.mjs'); const { loadRoster } = await import('./roster.mjs');
  const r = loadRoster(); const sk = loadSkills(cfg.brainPath, r.agents);
  if (sk.problems.length) throw new Error(sk.problems.join(' | '));
  const sum = sk.summary();
  return `${sum.count} skills (${sum.shipped} shipped, ${sum.brain} in the brain)`;
});
await step('connectors: Claude Code connector list parses (for import)', async () => {
  const m = await import('./mcp.mjs');
  const l = m.parseList('Checking MCP server health…\n\nclaude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected\nplaywright: npx -y @playwright/mcp@latest - ✔ Connected');
  if (l.length !== 2 || l[0].id !== 'claude_ai_Gmail' || l[0].status !== 'connected') throw new Error('parsed: ' + JSON.stringify(l[0]));
});
await step('routines: plain words become a schedule', async () => {
  const w = await import('./src/when.js');
  const cases = [
    ['every weekday at 8am, triage the inbox and tell me what needs me', 'every weekday · 08:00', 'triage the inbox and tell me what needs me'],
    ['Every Monday 9am, list the overdue invoices and draft the reminders', 'Mondays · 09:00', 'list the overdue invoices and draft the reminders'],
    ["match today's bank lines to invoices, daily at 5:30pm", 'every day · 17:30', "match today's bank lines to invoices"],
    ['chase quiet deals every tuesday and thursday at 10', 'Tue, Thu · 10:00', 'chase quiet deals'],
  ];
  for (const [text, desc, task] of cases) {
    const r = w.parseWhen(text); if (!r) throw new Error('no schedule found in: ' + text);
    if (w.describe(r.when) !== desc) throw new Error(`"${text}" → ${w.describe(r.when)}, expected ${desc}`);
    if (r.text !== task) throw new Error(`"${text}" → task "${r.text}", expected "${task}"`);
  }
  if (w.parseWhen('reply to a client asking when their September report will arrive within 24 hours')) throw new Error('a plain task was read as a routine');
  if (!w.parseWhen('every weekday, triage the inbox')?.needsTime) throw new Error('missing time not asked back');
  return `${cases.length} phrasings · asks back for a missing time`;
});
await step('routines: any team can have one; bad ones are named', async () => {
  const rt = await import('./routines.mjs'); const { loadRoster } = await import('./roster.mjs'); const agents = loadRoster().agents;
  const marketing = rt.validate({ id: 'reel', dept: 'marketing', agent: 'iggy', text: 'post the reel', when: { kind: 'daily', at: '09:00' } }, agents);
  if (marketing.problems.length) throw new Error('a marketing routine was refused: ' + marketing.problems);
  const wrong = rt.validate({ dept: 'fin', agent: 'ghost', text: 'x', when: { kind: 'weekly', days: [] } }, agents);
  if (!wrong.problems.some(p => /no agent/.test(p)) || !wrong.problems.some(p => /not complete/.test(p))) throw new Error('unknown agent / incomplete schedule not named: ' + wrong.problems);
  const cross = rt.validate({ dept: 'fin', agent: 'lexi', text: 'x', when: { kind: 'daily', at: '09:00' } }, agents);
  if (!cross.problems.some(p => /is in Sales, not Accounting/.test(p))) throw new Error('cross-team owner not named: ' + cross.problems);
  return 'every team accepted · unknown owner, wrong team, incomplete schedule all named';
});

/* ---------- 3. the test suite ---------- */
await step('tests: the full suite passes', async () => {
  const files = fs.readdirSync(path.join(ROOT, 'tests')).filter(f => f.endsWith('.test.mjs')).map(f => path.join('tests', f));
  let out;
  // One file at a time: the engine tests run fake models against real timers and flake when several files share the CPU.
  try { out = await sh(NODE, ['--test', '--test-concurrency=1', '--test-reporter=tap', ...files]); }
  catch (e) { const fails = [...String(e.out || '').matchAll(/^not ok \d+ - (.+)$/gm)].map(m => m[1]).slice(0, 5); throw new Error(fails.length ? 'failing: ' + fails.join(' · ') : e.message); }
  const n = key => Number(out.match(new RegExp(`^# ${key} (\\d+)`, 'm'))?.[1] || 0);
  if (n('fail')) throw new Error(`${n('fail')} failing`);
  return `${n('pass')} tests in ${files.length} files`;
});

/* ---------- 4. server smoke, on throwaway data ---------- */
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-check-')), data = path.join(tmp, 'data'), brain = path.join(tmp, 'brain');
  fs.mkdirSync(data); fs.cpSync(path.join(ROOT, 'brain'), brain, { recursive: true });
  const port = 4600 + Math.floor(Math.random() * 300);
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', AO_DATA: data, AO_BRAIN: brain };
  const srv = spawn(NODE, ['serve.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  const call = async (p, method = 'GET', body) => { const r = await fetch(base + p, { method, headers: { origin: base, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); let json = null; try { json = await r.json(); } catch {} return { status: r.status, ok: r.ok, json }; };
  const up = await (async () => { for (let i = 0; i < 80; i++) { try { const r = await fetch(base + '/api/health'); if (r.ok) return await r.json(); } catch {} await new Promise(r => setTimeout(r, 250)); } return null; })();
  if (!up) bad('server: starts', log.trim().split('\n').slice(-3).join(' | ') || 'no health response');
  else {
    ok('server: starts', `${up.name} · ${up.teams.length} teams · ${up.agents.length} people · Brain ${up.notes} notes · models ${up.ready ? 'ready' : 'need a key'}`);
    const team = up.teams[0].id, other = (up.teams[1] || up.teams[0]).id;
    await step('server: serves the page', async () => { const r = await fetch(base + '/'); const t = await r.text(); if (r.status !== 200 || !/<html|<!doctype/i.test(t)) throw new Error('status ' + r.status); });
    await step('server: provider keys never leave the server', async () => {
      const r = await call('/api/providers'); if (!r.ok) throw new Error('status ' + r.status);
      const text = JSON.stringify(r.json); if (/"apiKey"\s*:\s*"[^"]+"/.test(text) || /sk-[A-Za-z0-9_-]{12,}/.test(text)) throw new Error('key material in the response');
      return `${r.json.providers.length} providers · ${r.json.providers.filter(p => p.hasKey).length} with a key`;
    });
    let idea = null;
    await step('server: tasks — empty refused, an idea saved, found by the team picker, then cancelled', async () => {
      const empty = await call('/api/tasks', 'POST', { dept: team, text: '' }); if (empty.status !== 400) throw new Error('empty task: status ' + empty.status);
      const made = await call('/api/tasks', 'POST', { dept: team, text: 'Check idea: draft a one-page plan for the spring launch.', backlog: true }); if (!made.ok || made.json.state !== 'backlog') throw new Error('idea: ' + JSON.stringify(made.json).slice(0, 160));
      idea = made.json;
      const picker = await call(`/api/teams/${team}/tasks?q=spring`); if (!picker.json.some(t => t.id === idea.id)) throw new Error('the @ picker did not list it');
      const list = await call('/api/tasks'); if (!list.json.some(t => t.id === idea.id)) throw new Error('not in the task list');
      const gone = await call(`/api/tasks/${idea.id}/cancel`, 'POST', {}); if (!gone.ok) throw new Error('cancel: ' + gone.status);
      return 'saved, listed, picked, cancelled';
    });
    if (!up.ready) await step('server: work waits for a model key, with a plain sentence', async () => {
      const r = await call('/api/tasks', 'POST', { dept: team, text: 'Draft a welcome email.' }); if (r.ok) throw new Error('a task started without a key');
      if (!/key/i.test(r.json?.error || '')) throw new Error('no sentence: ' + JSON.stringify(r.json)); return r.json.error;
    });
    await step('server: the Brain takes an upload and finds it', async () => {
      const content = '# Check note\n\nOur zanzibarquartz pricing tier is reviewed every quarter.';
      const r = await call('/api/knowledge/upload', 'POST', { folder: 'Company', name: 'check-note.md', data: Buffer.from(content).toString('base64') }); if (!r.ok) throw new Error('upload: ' + JSON.stringify(r.json));
      for (let i = 0; i < 20; i++) { const s = await call('/api/knowledge/search?q=zanzibarquartz'); if (JSON.stringify(s.json).includes('check-note')) return `${r.json.id} · found by search`; await new Promise(res => setTimeout(res, 250)); }
      throw new Error('search did not find the upload');
    });
    await step('server: routines — any team, missing parts asked back, change audited', async () => {
      const list = await call('/api/routines'); if (JSON.stringify(list.json.depts) !== JSON.stringify(up.depts)) throw new Error('teams: ' + JSON.stringify(list.json.depts));
      const noTime = await call('/api/routines', 'POST', { dept: other, text: 'every weekday, triage the inbox' }); if (noTime.status !== 400 || !noTime.json.needsTime) throw new Error('missing time: ' + JSON.stringify(noTime.json));
      const none = await call('/api/routines', 'POST', { dept: other, text: 'chase the quiet deals' }); if (none.status !== 400 || !none.json.noSchedule) throw new Error('no schedule: ' + JSON.stringify(none.json));
      const made = await call('/api/routines', 'POST', { dept: other, text: 'every Monday at 9am, list the open deals' }); if (!made.ok) throw new Error('valid routine: ' + JSON.stringify(made.json));
      await call(`/api/routines/${made.json.routine.id}`, 'DELETE');
      const audit = await call('/api/audit'); if (!audit.json.some(a => /routine/i.test(a.summary))) throw new Error('not in the audit log');
      return `${made.json.routine.desc} · removed · audited`;
    });
    await step('server: connector access is per team and per person, and the catalog lists what agents can call', async () => {
      const before = await call('/api/office'); const cfg = before.json, t1 = cfg.teams[0], t2 = cfg.teams[1] || cfg.teams[0];
      t1.tools = ['web']; if (t2 !== t1) t2.tools = []; const person = cfg.agents.find(a => a.department === t1.id && a.id !== t1.lead); person.inheritTools = false; person.tools = [];
      const saved = await call('/api/office', 'PUT', cfg); if (!saved.ok) throw new Error('save: ' + JSON.stringify(saved.json).slice(0, 160));
      const tools = await call('/api/tools'); const web = tools.json.find(x => x.id === 'web');
      if (!web || !web.assignedTeams.some(x => x.id === t1.id) || (t2 !== t1 && web.assignedTeams.some(x => x.id === t2.id))) throw new Error('assignedTeams: ' + JSON.stringify(web?.assignedTeams));
      const after = (await call('/api/office')).json; const p = after.agents.find(a => a.id === person.id); if (p.inheritTools !== false) throw new Error('person opt-out not kept');
      const catalog = await call('/api/tools/catalog'); if (!Array.isArray(catalog.json)) throw new Error('catalog shape');
      const bad = await call('/api/office', 'PUT', { ...after, teams: after.teams.map(x => ({ ...x, tools: 'nope' })) }); if (bad.ok && !(await call('/api/office')).json.teams.every(x => Array.isArray(x.tools))) throw new Error('a bad tools value was stored');
      return `${t1.name} has web, ${t2 !== t1 ? t2.name + ' does not, ' : ''}${person.name} opted out · catalog ${catalog.json.length} tools`;
    });
    await step('server: settings refuse a bad value', async () => { const r = await call('/api/settings', 'PUT', { digestTime: '25:00' }); if (r.status !== 400) throw new Error('status ' + r.status); return r.json.error; });
    await step('server: inbox, KPIs and live updates answer', async () => {
      const inbox = await call('/api/inbox'); if (!Array.isArray(inbox.json.items) || typeof inbox.json.counts?.needsYou !== 'number') throw new Error('inbox shape');
      const k = await call('/api/kpis'); if (typeof k.json.throughput?.done !== 'number') throw new Error('KPI shape');
      const controller = new AbortController(); const r = await fetch(base + '/api/events', { signal: controller.signal }); const type = r.headers.get('content-type'); controller.abort();
      if (!/text\/event-stream/.test(type || '')) throw new Error('events content-type: ' + type);
      return `${inbox.json.items.length} inbox items · ${k.json.throughput.done} done · event stream open`;
    });
    if (LIVE && up.ready) await step('live: the Program Manager takes a task through a lead to done', async () => {
      const made = await call('/api/tasks', 'POST', { dept: 'auto', depts: 'auto', text: 'In three bullet points, list what a new customer onboarding email should cover. No tools needed.' }); if (!made.ok) throw new Error(made.json?.error);
      const id = made.json.id, end = Date.now() + 8 * 60000; let job = null;
      while (Date.now() < end) { job = (await call('/api/tasks/' + id)).json; if (['done', 'blocked', 'escalated', 'awaiting_ceo'].includes(job.state)) break; await new Promise(r => setTimeout(r, 3000)); }
      if (job.state !== 'done') throw new Error(`stopped at ${job.state}${job.error ? ': ' + job.error : ''}`);
      return `${job.calls} model calls · ${job.tokens} tokens · reviewed by ${job.reviews?.at(-1)?.agent}`;
    });
    else if (LIVE) bad('live: skipped', 'CHECK_LIVE=1 needs a provider key (Settings → Models & keys, or ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY)');
    else ok('live: skipped', 'set CHECK_LIVE=1 to run one real task through the model provider');
  }
  srv.kill(); await new Promise(r => setTimeout(r, 300)); fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---------- summary ---------- */
const fails = results.filter(r => !r[0]);
console.log(`\n${fails.length ? '✗' : '✓'} ${results.length - fails.length}/${results.length} checks passed${fails.length ? ' — ' + fails.map(f => f[1]).join(', ') : ''}`);
process.exit(fails.length ? 1 : 0);
