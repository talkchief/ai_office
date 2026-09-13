// "Right now" (design 1a) and the hand-off chain (design 1a/1h): who is working with whom on
// what, read from the scene runtime (rig.R, the Program Manager) and, when served, the jobs.
// Shared by the Task Status panel (demo and live), the agent rail and the task dialog.
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ini = name => String(name || '?').trim()[0].toUpperCase();
// Hover text for the badges: a letter is the person, ★ the team lead, ◆ the Program Manager, You the CEO.
const who = r => `${r.a.name}${r.a.role ? ', ' + r.a.role : ''}`;
const leadTitle = r => `Team lead (★): ${r.a.name}${r.a.role ? ', ' + r.a.role : ''}`;
const PM_TITLE = 'The Program Manager (◆): plans the task and brings in the team leads';
const ST = {
  blocked: ['blocked', '#b14236'], stuck: ['needs you', '#b14236'], planning: ['planning', '#B4830B'], verifying: ['verifying', '#684C91'],
  together: ['together', '#A08A1E'], working: ['working', '#2A6DB5'], submitted: ['submitted', '#A8408A'], coordinating: ['coordinating', '#B4830B'],
  done: ['done', '#248267'], idle: ['free', '#8A8A82'],
};
const PRIO = ['stuck', 'blocked', 'coordinating', 'planning', 'verifying', 'together', 'working', 'submitted'];
const PM_COL = '#B9A775';

// rows: [{ a1, c1, a2, c2, link, line, team, teamInk, meta, st, stColor, agent, job }] — job: the task the row is about, when there is one
export function rightNowRows({ R, pm, DEPTS, jobs = null, live = false, rnd = null, max = 5 }) {
  const rows = [];
  const leadOf = dept => Object.values(R).find(r => r.a.dept === dept && r.a.lead);
  const chip = r => DEPTS[r.a.dept]?.chip || '#B0ADA3', ink = r => DEPTS[r.a.dept]?.ink || '#5A5A5A', team = r => DEPTS[r.a.dept]?.short || r.a.dept;
  const stepOf = r => { // "step 2 of 3" from the live job, if we have it
    if (!jobs || !r.liveJobId) return '';
    const j = jobs.find(x => x.id === r.liveJobId); if (!j || !j.subtasks?.length) return '';
    const i = j.subtasks.findIndex(s => s.agent === r.a.id && s.state === 'working');
    return i >= 0 ? `step ${i + 1} of ${j.subtasks.length}` : '';
  };
  if (pm && (pm.state === 'walking' || pm.state === 'atDesk') && pm.target && DEPTS[pm.target]) {
    const lead = leadOf(pm.target);
    rows.push({ a1: '◆', c1: PM_COL, a2: '★', c2: DEPTS[pm.target].chip, link: PM_COL, team: DEPTS[pm.target].short, teamInk: DEPTS[pm.target].ink, t1: PM_TITLE, t2: lead ? leadTitle(lead) : `Team lead (★) of ${DEPTS[pm.target].short}`,
      line: pm.state === 'walking' ? `Program Manager is walking to ${lead ? lead.a.name : DEPTS[pm.target].short}` : `Program Manager is with ${lead ? lead.a.name : DEPTS[pm.target].short}`,
      meta: pm.title || 'coordinating', st: 'coordinating', agent: 'program-manager' });
  }
  for (const r of Object.values(R)) {
    const ph = r.state === 'stuck' ? 'stuck' : r.livePhase || 'idle';
    if (r.assistTarget && R[r.assistTarget] && (r.state === 'assisting' || r.state === 'walking')) {
      const w = R[r.assistTarget];
      rows.push({ a1: '★', c1: chip(r), a2: ini(w.a.name), c2: chip(w), link: ink(r), team: team(r), teamInk: ink(r), t1: leadTitle(r), t2: who(w),
        line: r.state === 'walking' ? `${r.a.name} is walking over to ${w.a.name}` : `${r.a.name} is sitting with ${w.a.name}${w.liveTitle ? ' on ' + w.liveTitle : ''}`,
        meta: w.liveTitle ? (stepOf(w) || 'draft, unreviewed') : 'helping', st: 'together', agent: r.a.id, job: w.liveJobId || r.liveJobId || null });
      continue;
    }
    if (ph === 'idle' || ph === 'done' || ph === 'helping') continue;
    const lead = r.a.lead ? r : leadOf(r.a.dept);
    let line, meta = r.liveTitle || '', a1 = r.a.lead ? '★' : ini(r.a.name), a2 = null, c2 = null, link = ink(r), t1 = r.a.lead ? leadTitle(r) : who(r), t2 = '';
    if (ph === 'stuck' || ph === 'blocked') { line = `${r.a.name} needs you${r.ask ? ': ' + r.ask : ''}`; meta = r.liveTitle || 'waiting for your OK'; a2 = 'You'; c2 = '#151414'; t2 = 'You, the CEO: this is waiting for your decision'; }
    else if (ph === 'planning') { line = `${r.a.name} is planning${r.liveTitle ? ' ' + r.liveTitle : ''}`; meta = 'reading the Brain'; }
    else if (ph === 'verifying' || ph === 'reviewing') { const w = Object.values(R).find(x => x.a.dept === r.a.dept && !x.a.lead && x.livePhase === 'submitted'); line = `${r.a.name} is checking ${w ? w.a.name + '’s step' : 'the team’s work'}`; if (w) { a2 = ini(w.a.name); c2 = chip(w); t2 = who(w); } }
    else if (ph === 'submitted') { line = `${r.a.name} handed in ${r.liveTitle || 'their step'}`; meta = 'waiting for lead review'; if (lead && lead !== r) { a2 = '★'; c2 = chip(lead); t2 = `${leadTitle(lead)}, who reviews the step`; } }
    else if (ph === 'working') {
      if (live) { line = `${r.a.name} is on ${r.liveTitle || 'a task'}`; meta = stepOf(r) || (r.liveTitle ? 'in progress' : ''); }
      else { if (!r.demoLine && rnd) r.demoLine = rnd(r.v1?.tasks || ['the queue']).replace(/\{co\}/g, 'a client').replace(/\{person\}/g, 'a lead').replace(/\{count\}/g, '6').replace(/\{n\}/g, '12').replace(/\{segment\}/g, 'roofing'); line = `${r.a.name} is ${r.workMode === 'read' ? 'reading through' : r.workMode === 'phone' ? 'on a call about' : 'typing up'} ${r.demoLine || 'the queue'}`; meta = 'demo'; }
      if (lead && lead !== r && Math.random() < 2) { a2 = null; }
    } else continue;
    rows.push({ a1, c1: chip(r), a2, c2, link, team: team(r), teamInk: ink(r), line, meta, st: ph === 'reviewing' ? 'verifying' : ph, agent: r.a.id, job: r.liveJobId || null, t1, t2 });
  }
  rows.sort((a, b) => PRIO.indexOf(a.st) - PRIO.indexOf(b.st));
  return rows.slice(0, max);
}

export function rightNowHTML(rows, { updated = 'just now' } = {}) {
  if (!rows.length) return `<div class="rn-quiet">Quiet. Everyone is at their desk.</div>`;
  return rows.map(n => {
    const [word, col] = ST[n.st] || ST.working;
    // A row about a task opens that task; the faces at its start open the person.
    return `<div class="rn-row" data-agent="${esc(n.agent)}"${n.job ? ` data-task="${esc(n.job)}" title="Open the task"` : ''}>
      <span class="rn-av"><span class="rn-a" style="border-color:${n.c1}" title="${esc(n.t1 || '')}">${esc(n.a1)}</span>${n.a2 ? `<span class="rn-link" style="background:${n.link}"></span><span class="rn-a" style="border-color:${n.c2}" title="${esc(n.t2 || '')}">${esc(n.a2)}</span>` : ''}</span>
      <span class="rn-body"><span class="rn-line">${esc(n.line)}</span><span class="rn-meta"><b style="color:${n.teamInk}">${esc(n.team)}</b>${n.meta ? ' · ' + esc(n.meta) : ''}</span></span>
      <span class="rn-st" style="color:${col};border-color:${col}">${word}</span></div>`;
  }).join('');
}

/* ---------- the hand-off chain: plan → workers → review → you ---------- */
// nodes: [{ label, state: done | current | pending | failed | blocked }]
export function chainHTML(nodes) {
  return `<span class="chain">${nodes.map(n => `<span class="ch ch-${n.state}"><i></i>${esc(n.label)}</span>`).join('<span class="ch-l"></span>')}</span>`;
}
export function jobChain(job, nameOf) {
  const nodes = [];
  const after = ['working', 'reviewing', 'saving', 'waiting', 'done', 'blocked'].includes(job.state) || (job.subtasks && job.subtasks.length);
  nodes.push({ label: 'plan', state: job.state === 'planning' ? 'current' : job.state === 'queued' || job.state === 'backlog' ? 'pending' : after ? 'done' : 'pending' });
  for (const s of job.subtasks || []) nodes.push({ label: (nameOf(s.agent || (s.eligible && s.eligible[0])) || 'worker').toLowerCase(), state: s.state === 'done' ? 'done' : s.state === 'working' ? 'current' : ['failed', 'interrupted'].includes(s.state) ? 'failed' : 'pending' });
  if (!(job.subtasks || []).length && job.state !== 'planning') nodes.push({ label: 'workers', state: 'pending' });
  nodes.push({ label: job.review?.approved ? 'review ✓' : 'review', state: job.state === 'reviewing' ? 'current' : job.review?.approved || job.state === 'done' ? 'done' : 'pending' });
  nodes.push({ label: job.state === 'done' ? 'you ✓' : 'you', state: job.state === 'waiting' ? 'current' : job.state === 'done' ? 'done' : job.state === 'blocked' ? 'blocked' : 'pending' });
  if (job.state === 'blocked') { const i = nodes.findIndex(n => n.state === 'current'); if (i >= 0) nodes[i].state = 'blocked'; }
  return chainHTML(nodes);
}
