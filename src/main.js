// Cloud AI Office — the page. Chrome, rail, chat, approvals, hotkeys and the boot hooks live
// here; the 3D office is src/scene/ (React Three Fiber) and is reached through the handle
// mountScene() returns. Nothing in this file touches three.js directly.
import { DEPTS, DEPT_KEYS, AGENTS, LAYOUT, WORKLINES, APPROVAL_ASKS, APPROVAL_BY_AGENT } from './data.js';
import { V1, FILE_GEN, STATS, KPIS, P, rnd, ri, person } from './v1data.js';
import { loadConnectors } from './connectors.js';
import { initTasks } from './tasks.js';
import { initOfficeWork } from './office.js';
import { mountScene } from './scene/index.jsx';
import { rightNowRows, rightNowHTML, jobChain } from './rightnow.js';
const DEMO = location.protocol === 'file:';
let tasks = null; // task boards — initialised once the scene is ready

/* ---------- helpers ---------- */
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function sample(arr, n) { return [...arr].sort(() => Math.random() - 0.5).slice(0, n); }
function ago(ts) { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'now' : m < 60 ? m + 'm ago' : Math.round(m / 60) + 'h ago'; }

/* ---------- the scene ---------- */
const canvas = document.getElementById('scene');
const hud = document.getElementById('hud');
const forcedDarkAtLoad = document.body.classList.contains('dark'); // the /dark route; the clock's own night is not a pin
const page = {
  tasks: () => tasks,
  openAgent: (id) => openAgent(id, DEMO ? 'chat' : 'activity'),
  openInbox: () => tasks?.openInbox?.(),
  zoomToDept: (k) => zoomToDept(k),
  zoomToApproval: (k) => zoomToApproval(k),
  openPM: () => openPM(),
  zoomOut: () => zoomOut(),
  onZoom: (z) => { if (z < 1.6 && focused) { if (focused === 'brain') { focused = null; office.unfocus(); } else exitFocus(false); } syncOverviewBtn(); },
  afterFrame: () => syncOverviewBtn(),
  onReady: () => boot(),
};
const office = mountScene({ canvas, hud, DEMO, DEPTS, DEPT_KEYS, AGENTS, LAYOUT, WORKLINES, V1, rnd, sample, esc, page });
const R = office.R, deptRT = office.deptRT, view = office.view;
const OVERVIEW = office.rig.overview;
const FR = office.FR;
const spawnEmote = (r, icon) => office.spawnEmote(r, icon);
const flyTo = office.flyTo;
const overviewPos = office.overviewPos;
const toScreen = office.toScreen;
const mcp = office.mcp;
let brain = null; // set on boot (the scene builds it)

let focused = null; // dept key when zoomed into a dept
const vignette = document.getElementById('vignette');
const rail = document.getElementById('rail');
const mMsgs = document.getElementById('mMsgs');
let modalOpen = null, modalTab = 'chat'; // modalOpen = agent id open in the rail slide-over
const RAIL_SIDE = Object.fromEntries(DEPT_KEYS.map(k => [k, 'left']));
const SCREEN_RIGHT = { get x() { return office.screenRight().x; }, get z() { return office.screenRight().z; } };
const chatHist = {};
const BB_ROWS = {}; // the design's pod card carries no metric rows; the rail header follows
let brainNotes = 0;

/* ---------- camera moves ---------- */
function zoomStep(f) {
  office.zoomStep(f);
  if (view.zoom * f < 1.6 && focused) { if (focused === 'brain') { focused = null; office.unfocus(); } else exitFocus(false); }
  syncOverviewBtn();
}
function zoomToDept(k) { enterFocus(k); }
function zoomOut() {
  if (focused && focused !== 'brain') { exitFocus(true); return; }
  focused = null; office.unfocus(); office.select(null);
  flyTo(overviewPos(), OVERVIEW.zoom, 550); office.resetView();
  syncOverviewBtn();
}
function syncOverviewBtn() {
  document.getElementById('overviewBtn').classList.toggle('show',
    (view.zoom > 1.45 && !(office.isTweening() && office.tweenTo() <= OVERVIEW.zoom + 0.05)) || !!focused);
}
document.getElementById('zIn').addEventListener('click', () => zoomStep(1.5));
document.getElementById('zOut').addEventListener('click', () => zoomStep(1 / 1.5));
document.getElementById('zHome').addEventListener('click', zoomOut);
document.getElementById('zRotL')?.addEventListener('click', () => office.rotateBy(Math.PI / 4));
document.getElementById('zRotR')?.addEventListener('click', () => office.rotateBy(-Math.PI / 4));
document.getElementById('overviewBtn').addEventListener('click', zoomOut);

// the Program Manager at the centre: click → the projects view (live) and a look at the desk
function openPM() {
  office.select('program-manager');
  if (tasks && tasks.openProjects && !DEMO) tasks.openProjects();
  if (!focused) { focused = 'brain'; office.focus('brain'); if (tasks) tasks.onFocusChange('brain'); flyTo([LAYOUT.brain.pos[0], 0, LAYOUT.brain.pos[1] + 1.5], 2.6, 700); syncOverviewBtn(); }
}

/* ---------- focus rail: dept card + agent CHAT & ACTIVITY slide-over ---------- */
function ensureChat(id) {
  if (chatHist[id]) return;
  const v = R[id].v1;
  chatHist[id] = [
    { who: 'agent', text: DEMO ? v.greeting : (R[id].a.lead ? `I coordinate ${DEPTS[R[id].a.dept].name}. My team includes ${Object.values(R).filter(r => r.a.dept === R[id].a.dept && !r.a.lead).map(r => r.a.name).join(', ')}. Send a request and I’ll plan, delegate and verify the work.` : `I’m ${R[id].a.name}. ${R[id].a.does || R[id].a.role || ''}`) },
    { who: 'work', i: '⏺', text: DEMO ? 'Demo activity' : 'Only your real tasks and results appear here.' },
  ];
  if (FILE_GEN[id] && DEMO) chatHist[id].push({ who: 'file', ...FILE_GEN[id]() });
  // The conversation is kept on the server: earlier messages come back when the chat opens again.
  if (!DEMO) tasks?.loadHistory?.(id).then(ms => { if (ms?.length) { chatHist[id].splice(2, 0, ...ms); if (modalOpen === id) renderChat(id); } }).catch(() => {});
}
function chatPush(id, msg) {
  ensureChat(id);
  chatHist[id].push(msg);
  if (chatHist[id].length > 80) chatHist[id].splice(2, 1);
  if (modalOpen === id && modalTab === 'chat') renderChat(id);
}
function renderChat(id) {
  mMsgs.innerHTML = chatHist[id].map((m, i) => {
    if (m.who === 'agent') return `<div class="m-agent">${esc(m.text)}${m.taskId ? `<button class="space-chat-task" data-chat-task="${esc(m.taskId)}">Open plan, progress & result ↗</button>` : ''}</div>`;
    if (m.who === 'user') return `<div class="m-user">${m.about ? `<span class="chat-about">${esc(m.about)}</span>` : ''}${esc(m.text)}</div>`;
    if (m.who === 'work') return `<div class="m-work"><span class="wi">${m.i || '▸'}</span>${esc(m.text)}</div>`;
    if (m.who === 'file') return `
      <div class="m-file" data-i="${i}">
        <div class="f-head"><span>${m.icon}</span><div><div class="f-name">${esc(m.name)}</div><div class="f-meta">${esc(m.meta)}</div></div></div>
        <pre>${esc(m.content)}</pre>
      </div>`;
    if (m.who === 'appr') return `
      <div class="m-appr" data-i="${i}">
        <div class="a-who">needs your approval</div>
        <div class="a-ask">${esc(m.text)}</div>
        ${m.mock ? `<div class="a-mock">${m.mock}</div>` : ''}
        ${m.pending
          ? '<div class="a-btns"><button class="a-yes">APPROVE</button><button class="a-no">REJECT</button></div>'
          : `<div class="a-done">${m.approved ? '✓ Approved' : '✗ Rejected'} by you</div>`}
      </div>`;
    return '';
  }).join('');
  mMsgs.querySelectorAll('[data-chat-task]').forEach(el => el.onclick = () => tasks.openTask(el.dataset.chatTask));
  mMsgs.querySelectorAll('.m-file').forEach(el => el.addEventListener('click', () => el.classList.toggle('exp')));
  mMsgs.querySelectorAll('.m-appr .a-yes').forEach(el => el.addEventListener('click', () => resolveApproval(id, true)));
  mMsgs.querySelectorAll('.m-appr .a-no').forEach(el => el.addEventListener('click', () => resolveApproval(id, false)));
  mMsgs.scrollTop = mMsgs.scrollHeight;
}
function renderActivity(id) {
  if (!DEMO && tasks?.renderAgent) { tasks.renderAgent(id); return; }
  const r = R[id], v = r.v1;
  const task = DEMO ? rnd(v.tasks || ['Working through the queue']).replace('{co}', rnd(P.co)).replace('{person}', person()).replace('{count}', ri(3, 9))
    : (tasks?.tasks.find(t => t.agent === id && t.state === 'doing')?.title || 'Ready for your next task');
  document.getElementById('mNow').innerHTML = `NOW &nbsp;<b>${esc(task)}</b>`;
  document.getElementById('mStats').innerHTML = (DEMO ? v.stats || [] : []).map(([l, val]) => `
    <div class="st"><div class="st-l">${esc(l)}</div><div class="st-v">${esc(String(typeof val === 'function' ? val() : val))}</div></div>`).join('');
  const chip = DEPTS[r.a.dept].chip;
  document.getElementById('mChart').hidden = !DEMO;
  const mx = Math.max(...(v.chart || [1]));
  document.querySelector('#mChart .ch-lbl').textContent = v.chartLbl || '';
  document.querySelector('#mChart .ch-bars').innerHTML = (v.chart || []).map(n => `<i style="height:${Math.round(n / mx * 100)}%;background:${chip}"></i>`).join('');
  document.getElementById('mFeed').innerHTML = r.feed.map(f => `
    <div class="fe"><span class="fi">${f.i}</span><span>${esc(f.text)}</span><span class="ft">${ago(f.ts)}</span></div>`).join('');
}
/* camera target offset so the pod sits beside the rail, not behind it */
function focusTarget(k, atPos) {
  const base = atPos ? [atPos.x, 0, atPos.z] : [LAYOUT[k].pos[0], 0, LAYOUT[k].pos[1] + 1];
  const boardW = (tasks ? tasks.panelWidth() : 400) + 30;
  const zoom = atPos ? 3.3 : 2.5;
  const pxPerWorld = zoom * innerHeight / (2 * FR);
  const railW = Math.min(400, innerWidth * 0.92);
  const shift = ((railW - boardW) / 2 + (boardW ? 0 : 30)) / pxPerWorld;
  const dir = RAIL_SIDE[k] === 'left' ? -shift : shift;
  return { pos: [base[0] + SCREEN_RIGHT.x * dir, 0, base[2] + SCREEN_RIGHT.z * dir], zoom };
}
let pendingTab = 'chat';
function enterFocus(k, pendingAgentId) {
  if (k === 'brain') { openPM(); return; }
  if (focused === k && !pendingAgentId) return;
  if (focused && focused !== k) { rail.classList.remove('open', 'agentOpen'); modalOpen = null; }
  focused = k;
  if (tasks) tasks.onFocusChange(k);
  office.focus(k);
  vignette.classList.add('on');
  const t = focusTarget(k);
  flyTo(t.pos, t.zoom, 950, {
    arc: RAIL_SIDE[k] === 'left' ? 0.10 : -0.10,
    onDone: () => { if (pendingAgentId) openAgentRail(pendingAgentId, pendingTab, true); pendingTab = 'chat'; },
  });
  buildDeptRail(k);
  rail.className = RAIL_SIDE[k];
  rail.style.display = 'block';
  // land on whoever is working, so the team's live task is the first thing in the rail
  const atWork = Object.values(R).find(r => r.a.dept === k && ['working', 'planning', 'verifying', 'reviewing', 'helping'].includes(r.livePhase)) || Object.values(R).find(r => r.a.dept === k && r.state === 'stuck');
  const first = pendingAgentId || atWork?.a.id || (AGENTS.find(x => x.dept === k && x.lead) || AGENTS.find(x => x.dept === k)).id;
  openAgentRail(first, pendingAgentId ? pendingTab : (DEMO ? 'chat' : 'activity'), false);
  document.getElementById('overviewBtn').classList.toggle('right', RAIL_SIDE[k] === 'left');
  const reveal = () => { if (focused !== k || rail.classList.contains('open')) return; rail.classList.add('open'); flyBillboardIntoRail(k); };
  requestAnimationFrame(() => requestAnimationFrame(reveal));
  setTimeout(reveal, 80); // a slow frame must not hold the rail back
  syncOverviewBtn();
}
function exitFocus(flyOut = true) {
  if (!focused) return;
  const k = focused;
  focused = null; modalOpen = null;
  if (tasks) tasks.onFocusChange(null);
  office.unfocus(); office.select(null);
  vignette.classList.remove('on');
  rail.classList.remove('open', 'agentOpen');
  setTimeout(() => { if (!focused) rail.style.display = 'none'; }, 650);
  document.getElementById('overviewBtn').classList.remove('right');
  if (k !== 'brain' && deptRT[k] && deptRT[k].badge) deptRT[k].badge.style.display = '';
  if (flyOut) flyTo(overviewPos(), OVERVIEW.zoom, 700);
  syncOverviewBtn();
}
function buildDeptRail(k) {
  // the docked header is the team card itself, kept live by the overlay tick while the team is open
  const rh = document.getElementById('railHeader');
  rh.classList.remove('show');
  rh.innerHTML = deptRT[k] && deptRT[k].badge ? deptRT[k].badge.innerHTML : '';
  rh.dataset.dept = k; rh.dataset.sig = (deptRT[k] && deptRT[k].sig) || '';
}
document.getElementById('railHeader').addEventListener('click', (e) => {
  const k = e.currentTarget.dataset.dept; if (!k) return;
  if (e.target.closest('.b-appr')) { const s = stuckIn(k)[0]; if (s) openAgentRail(s.a.id); return; }
  const task = e.target.closest('[data-task]'); if (task) { window.dispatchEvent(new CustomEvent('office:open-task', { detail: task.dataset.task })); return; }
  const who = e.target.closest('[data-seat]'); if (who) { openAgentRail(who.dataset.seat); return; }
  if (e.target.closest('[data-act="manage"]')) { e.stopPropagation(); window.dispatchEvent(new CustomEvent('office:manage', { detail: { dept: k } })); return; }
  if (e.target.closest('[data-act="task"]')) { window.dispatchEvent(new CustomEvent('office:compose', { detail: k })); return; }
  if (e.target.closest('.b-tasks') && DEMO && tasks) tasks.toggle();
});
/* the floating card physically FLIES and docks as the rail header */
function flyBillboardIntoRail(k) {
  const badge = deptRT[k].badge;
  const from = badge.getBoundingClientRect();
  badge.style.display = 'none';
  const railW = rail.offsetWidth;
  const tLeft = RAIL_SIDE[k] === 'left' ? 18 : innerWidth - railW + 18;
  const clone = badge.cloneNode(true);
  clone.style.cssText = `position:fixed;box-sizing:border-box;left:${from.left}px;top:${from.top}px;width:${from.width}px;margin:0;transform:none;transition:all .72s var(--ease);z-index:40;pointer-events:none;opacity:1;`;
  document.body.appendChild(clone);
  requestAnimationFrame(() => requestAnimationFrame(() => { clone.style.left = tLeft + 'px'; clone.style.top = (52 + 18) + 'px'; clone.style.width = (railW - 36) + 'px'; }));
  setTimeout(() => { clone.remove(); document.getElementById('railHeader').classList.add('show'); }, 740);
}
function openAgentRail(id, tab = 'chat', fly = true) {
  const r = R[id];
  ensureChat(id);
  modalOpen = id;
  office.select(id); // the figure pushes back from the desk, stands and waves (design 1i)
  const dept = DEPTS[r.a.dept];
  document.querySelector('#railAgent .mh-dot').style.background = dept.chip;
  document.querySelector('#railAgent .mh-name').textContent = r.a.name;
  document.querySelector('#railAgent .mh-role').textContent = `${r.v1.role} · ${dept.name}`;
  document.querySelector('#railAgent .mh-tag').textContent = r.v1.tagline;
  const gear = document.getElementById('railAgentManage');
  if (gear) gear.onclick = event => { event.stopPropagation(); window.dispatchEvent(new CustomEvent('office:manage', { detail: { dept: r.a.dept, agent: r.a.id } })); };
  document.getElementById('mChips').innerHTML = (r.v1.chips || []).map(c => `<button>${esc(c)}</button>`).join('');
  document.getElementById('mChips').querySelectorAll('button').forEach(b => b.addEventListener('click', () => sendChat(b.textContent)));
  rail.classList.add('agentOpen');
  renderNowCard(id);
  setTab(tab);
  if (tasks && tasks.railFor) tasks.railFor(id);
  if (fly) { const t = focusTarget(r.a.dept, r.seat); flyTo(t.pos, t.zoom, 500); }
}
/* the rail's NOW card (design 1h): the step, who is sitting with them, the live draft, where this sits */
let nowCardAt = 0;
function renderNowCard(id) {
  const el = document.getElementById('mNowCard'); if (!el) return;
  const r = R[id]; if (!r) { el.hidden = true; return; }
  const work = !DEMO && tasks && tasks.agentActivity ? tasks.agentActivity(id) : null;
  const job = work && tasks.job ? tasks.job(work.jobId) : null;
  const helper = Object.values(R).find(x => x.assistTarget === id && (x.state === 'assisting' || x.state === 'walking'));
  const phase = r.state === 'stuck' ? 'needs you' : r.assistTarget && R[r.assistTarget] ? 'helping' : (r.livePhase || 'idle');
  let st = document.querySelector('#railAgent .mh-state'); if (!st) { st = document.createElement('span'); st.className = 'mh-state'; document.querySelector('#railAgent .mh').appendChild(st); }
  const since = r.phaseSince && phase !== 'idle' ? ' · ' + Math.max(1, Math.round((performance.now() - r.phaseSince) / 60000)) + 'm' : '';
  if (r.lastPhase !== phase) { r.lastPhase = phase; r.phaseSince = performance.now(); }
  st.textContent = (phase === 'idle' ? 'FREE' : phase.toUpperCase()) + since; st.classList.toggle('on', phase !== 'idle'); st.dataset.phase = phase;
  const busy = phase !== 'idle';
  if (!busy) { el.hidden = true; return; }
  let step = '', title = r.liveTitle || (r.ask ? r.ask : ''), meta = '', draft = '', chain = '';
  if (job) {
    const i = job.subtasks.findIndex(s => s.agent === id && s.state === 'working');
    if (i >= 0) { step = `STEP ${i + 1} OF ${job.subtasks.length}`; title = job.subtasks[i].title; const live = job.liveCalls?.[id]; meta = [live?.tool, live?.calls ? live.calls + ' calls' : '', job.subtasks[i].modelUsed || job.model, job.subtasks[i].effortUsed].filter(Boolean).join(' · '); if (live?.preview) draft = live.preview; }
    else if (job.state === 'planning' || job.state === 'reviewing') { step = job.state === 'planning' ? 'PLANNING' : 'VERIFYING'; title = job.title; meta = [job.liveCalls?.[id]?.model || job.model, job.liveCalls?.[id]?.effort].filter(Boolean).join(' · '); }
    chain = jobChain(job, x => (R[x] && R[x].a.name) || (job.agents || []).find(a => a.id === x)?.name || x);
  } else if (r.assistTarget && R[r.assistTarget]) { step = 'HELPING'; title = `Sitting with ${R[r.assistTarget].a.name}${R[r.assistTarget].liveTitle ? ' on ' + R[r.assistTarget].liveTitle : ''}`; }
  else if (DEMO) { step = phase === 'needs you' ? 'WAITING FOR YOU' : 'NOW'; title = title || (r.demoLine ? `${r.workMode === 'read' ? 'Reading through' : 'Working on'} ${r.demoLine}` : rnd(r.v1?.tasks || ['Working through the queue']).replace(/\{[a-z]+\}/g, 'a client')); meta = 'demo'; }
  el.hidden = false;
  el.innerHTML = `<div class="nc-eye"><span>${esc(step || 'NOW')}</span>${phase === 'needs you' ? '<b style="color:#B4830B">NEEDS YOU</b>' : busy ? '<b>' + esc(phase.toUpperCase()) + '</b>' : ''}</div>
    <div class="nc-title">${esc(title || 'On it')}</div>${meta ? `<div class="nc-meta">${esc(meta)}</div>` : ''}
    ${helper ? `<div class="nc-with"><span class="rn-a" style="border-color:#C8A438">★</span>${esc(helper.a.name)} is sitting with them</div>` : ''}
    ${draft ? `<div class="nc-draft-lab"><i></i>LIVE DRAFT · UNREVIEWED</div><div class="nc-draft">${esc(draft.slice(0, 420))}</div>` : ''}
    ${chain ? `<div class="nc-sits">WHERE THIS SITS</div>${chain}${job ? `<div class="nc-foot">Task: ${esc(job.title)}</div>` : ''}` : ''}`;
}
function reframe() {
  if (!focused || focused === 'brain' || modalOpen) return;
  const t = focusTarget(focused);
  flyTo(t.pos, t.zoom, 600);
}
function railBack() {
  if (!focused || focused === 'brain') return;
  const lead = AGENTS.find(x => x.dept === focused && x.lead) || AGENTS.find(x => x.dept === focused);
  openAgentRail(lead.id, 'chat', false);
  const t = focusTarget(focused);
  flyTo(t.pos, t.zoom, 500);
}
document.getElementById('railBack').addEventListener('click', railBack);
function openAgent(id, tab = DEMO ? 'chat' : 'activity') {
  const dept = R[id].a.dept;
  if (focused === dept) { openAgentRail(id, tab); return; }
  pendingTab = tab;
  enterFocus(dept, id);
}
function setTab(tab) {
  if (!DEMO && tab === 'chat') tab = 'activity'; // the live office talks inside the task, not with the team
  modalTab = tab;
  document.querySelectorAll('#rail .mtabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.getElementById('mChat').style.display = tab === 'chat' ? 'flex' : 'none';
  document.getElementById('mAct').style.display = tab === 'activity' ? 'flex' : 'none';
  if (tab === 'chat') renderChat(modalOpen); else renderActivity(modalOpen);
}
document.querySelectorAll('#rail .mtabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
function sendChat(text) {
  const id = modalOpen;
  if (!id || !text.trim()) return;
  const r = R[id];
  const context = (!DEMO && tasks?.chatContext?.(id)) || {};
  chatPush(id, { who: 'user', text, about: context.about });
  document.getElementById('mIn').value = '';
  const low = text.toLowerCase();
  setTimeout(async () => {
    if (tasks && tasks.pendingReject(id)) { tasks.rejectLive(id, text); return; }
    if (r.state === 'stuck' && /\b(approve|reject)\b/.test(low)) { resolveApproval(id, /approve/.test(low)); return; }
    const rv = !context.taskId && tasks && tasks.isLive() && text.match(/^\s*revise\s*[:\-–]\s*(.+)$/i);
    if (rv && tasks.revise(id, rv[1].trim())) { chatPush(id, { who: 'agent', text: 'On it — revising now. It will land here when it is ready.' }); return; }
    const picked = [...(document.getElementById('mFiles')?.files || [])];
    const tr = !context.taskId && tasks && await tasks.handleChat(id, text, picked);
    if (picked.length) { const el = document.getElementById('mFiles'); if (el) el.value = ''; }
    if (tr) { chatPush(id, { who: 'agent', text: tr }); return; }
    if (tasks && tasks.isLive()) {
      chatPush(id, { who: 'work', i: '…', text: `${r.a.name} is thinking` });
      fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent: id, text, taskId: context.taskId, refs: context.refs, kind: context.kind, remember: context.remember, history: chatHist[id].filter(m => m.who === 'user' || m.who === 'agent').slice(-8) }) })
        .then(async res => { if (!res.ok) throw new Error((await res.json()).error || res.statusText); return res.json(); })
        .then(j => {
          const h = chatHist[id]; const k = h.findIndex(m => m.who === 'work' && m.text === `${r.a.name} is thinking`); if (k >= 0) h.splice(k, 1);
          chatPush(id, { who: 'agent', text: j.reply, taskId: j.taskId }); tasks.chatSent?.(id);
          if (j.taskId) tasks.refresh();
          if (j.routines && tasks.refresh) tasks.refresh();
          if (j.read) for (const n of j.read.slice(0, 2)) brain.readNote(id, n);
          if (j.tools && j.tools.length) mcp.onToolsUsed(id, j.tools);
        })
        .catch(e => chatPush(id, { who: 'agent', text: `I could not answer that (${e.message}).` }));
      return;
    }
    const hit = (r.v1.chat || []).find(c => c.k.some(k => low.includes(k)));
    const reply = hit ? rnd(hit.r) : rnd(r.v1.fallback || ['On it.']);
    chatPush(id, { who: 'agent', text: reply });
  }, 450 + Math.random() * 500);
}
document.getElementById('mSend').addEventListener('click', () => sendChat(document.getElementById('mIn').value));
document.getElementById('mIn').addEventListener('keydown', (e) => { e.stopPropagation(); if (tasks?.chatPickerKey?.(e)) return; if (e.key === 'Enter') sendChat(e.target.value); });
document.getElementById('mIn').addEventListener('input', (e) => tasks?.chatInput?.(modalOpen, e.target));

/* ---------- approval mockups — show exactly what is being approved (demo) ---------- */
function mockupFor(id) {
  const chip = DEPTS[R[id].a.dept].chip;
  switch (id) {
    case 'apay': return `<div class="mk mk-doc"><div class="d-brand">INVOICE AUDIT — #218</div><div class="d-title">Design contractor</div><div class="d-line"><span>Invoiced</span><b>14 hrs × $110 = $1,540</b></div><div class="d-line"><span>Contract rate</span><b>$85/hr (signed 12 Mar)</b></div><div class="d-line"><span>Variance</span><b>+$350 ⚠</b></div><div class="d-line"><span>Scope</span><b>matches the brief ✓</b></div><div class="d-p">Hours and scope check out — only the rate is off, and there's no signed variation covering it. Recommend holding payment and querying the rate before it's paid.</div></div>`;
    case 'piper': return `<div class="mk mk-doc"><div class="d-brand">PROPOSAL</div><div class="d-title">Ridgeline Property Group</div><div class="d-line"><span>Seats</span><b>12</b></div><div class="d-line"><span>Plan</span><b>Growth</b></div><div class="d-line"><span>Price</span><b>$1,080/mo · 12-mo lock</b></div><div class="d-p">Proof point: Auckland roofing co — 0 → 40 tracked calls/week in 14 days. Sign-online link included.</div></div>`;
    case 'iggy': return `<div class="mk-phone"><div class="ph-handle"></div><div class="ph-hook">“calls before 10am are a trap”</div><div class="ph-sub">connect rates nearly double 10:00–11:30am — across 40,000 dials</div><div class="ph-ui"><span>♥ 2.4k</span><span>💬 118</span><span>↗ share</span></div></div>`;
    case 'ada': return `<div class="mk mk-ad"><div class="ad-head"><div class="ad-av"></div><div><div class="ad-who">sahni.ai</div><div class="ad-sp">Sponsored</div></div></div><div class="ad-text">Cold call anxiety? Your first 5 dials decide your whole day…</div><div class="ad-media" style="background:linear-gradient(135deg, ${chip}55, ${chip}22)">“the 10am rule — call when they answer”</div><div class="ad-foot"><span class="ad-hl">Start your free trial</span><span class="ad-cta">SIGN UP</span></div><div class="ad-stat">CPA $29 · best performer · scaling to $180/day</div></div>`;
    case 'newt': return `<div class="mk mk-mail"><div class="ml-lab">SUBJECT A</div><div class="ml-sub">calls before 10am are a trap</div><div class="ml-lab">SUBJECT B</div><div class="ml-sub">we looked at 40,000 calls — call at this time</div><div class="ml-body">  before 10am ...... 11% connect\n  10:00–11:30 ...... 21% connect\n  after 4pm ........ 9% connect\n\n→ 3,400 subscribers · CTA: reply "10AM"</div></div>`;
    case 'scout': return `<div class="mk mk-doc"><div class="d-brand">OPPORTUNITY MEMO</div><div class="d-title">CallForge +8% price rise</div><div class="d-line"><span>Window</span><b>2–3 weeks</b></div><div class="d-line"><span>Play</span><b>comparison page + retargeting</b></div><div class="d-line"><span>Briefed</span><b>META ADS · PROPOSALS</b></div><div class="d-p">Their G2 reviews already flag value-for-money. Talk-track: 12-month price lock.</div></div>`;
    case 'enzo': return `<div class="mk mk-doc"><div class="d-brand">PURCHASE ORDER</div><div class="d-title">FullEnrich — 500 credits</div><div class="d-line"><span>Cost</span><b>$250 ($0.50/credit)</b></div><div class="d-line"><span>Current balance</span><b>38 credits — out tomorrow</b></div><div class="d-line"><span>Burn rate</span><b>~90/week</b></div><div class="d-p">Same card as last month. Without credits, enrichment stops and the Sales Lead runs dry.</div></div>`;
    default: {
      if (!FILE_GEN[id]) return '';
      const f = FILE_GEN[id]();
      return `<div class="mk mk-doc"><div class="d-brand">${esc(f.name)}</div><div class="ml-body" style="border:0;margin:0;padding:6px 0 0">${esc(f.content.split('\n').slice(0, 9).join('\n'))}</div></div>`;
    }
  }
}

/* ---------- approvals: agent STUCK → amber card row → chat approval message ---------- */
function requestApproval(id, ask) {
  if (!DEMO) return;
  const r = R[id];
  if (!r || r.state !== 'working') return;
  r.state = 'stuck';
  r.ask = ask || APPROVAL_BY_AGENT[id] || sample(APPROVAL_ASKS[r.a.dept], 1)[0];
  r.warn.visible = true;
  const hadChat = !!chatHist[id];
  chatPush(id, { who: 'appr', text: r.ask, pending: true, mock: mockupFor(id) });
  if (FILE_GEN[id] && hadChat) chatPush(id, { who: 'file', ...FILE_GEN[id]() });
  if (tasks) tasks.onStuck(id, r.ask);
  syncApprovals();
}
function setStuckLive(id, ask, sid) {
  const r = R[id]; if (!r) return;
  r.state = 'stuck'; r.ask = ask; r.liveSid = sid; r.warn.visible = true;
  syncApprovals();
}
function resolveApproval(id, approved) {
  const r = R[id];
  if (!r || r.state !== 'stuck') return;
  r.state = 'working'; r.ask = null; r.warn.visible = false;
  const msg = chatHist[id] && [...chatHist[id]].reverse().find(m => m.who === 'appr' && m.pending);
  if (msg) { msg.pending = false; msg.approved = approved; }
  const now = performance.now();
  if (approved) r.cheerUntil = now + 2400; else r.slumpUntil = now + 2600;
  spawnEmote(r, approved ? '✅' : '❌');
  if (r.liveSid) { r.liveSid = null; if (tasks) tasks.resolveLive(id, approved); syncApprovals(); return; }
  if (tasks) tasks.onResolve(id, approved);
  chatPush(id, { who: 'agent', text: approved ? '✓ Approved — actioning it now. I\'ll log the result in my activity.' : '✗ Understood — parked. I\'ll adjust and come back with a better version.' });
  syncApprovals();
}
function stuckIn(dept) { return Object.values(R).filter(r => r.state === 'stuck' && r.a.dept === dept); }
function syncApprovals() {
  let total = 0;
  for (const k of DEPT_KEYS) {
    const n = stuckIn(k).length; total += n;
    if (!deptRT[k] || !deptRT[k].apprRow) continue;
    deptRT[k].apprRow.style.display = n ? 'flex' : 'none';
    deptRT[k].apprN.textContent = n;
  }
  const top = document.getElementById('topAppr');
  top.style.display = total ? 'inline-flex' : 'none';
  top.querySelector('span').textContent = total;
  if (focused && focused !== 'brain') {
    const n = stuckIn(focused).length;
    const ap = document.getElementById('railHeader').querySelector('.b-appr');
    if (ap) { ap.style.display = n ? 'flex' : 'none'; ap.querySelector('.ap-n').textContent = n; }
  }
}
function zoomToApproval(dept) {
  const s = stuckIn(dept)[0];
  if (!s) { enterFocus(dept); return; }
  if (focused === dept) openAgentRail(s.a.id); else enterFocus(dept, s.a.id);
}
document.getElementById('topAppr').addEventListener('click', () => { const s = Object.values(R).find(r => r.state === 'stuck'); if (s) zoomToApproval(s.a.dept); });

/* ---------- demo event engine: weighted v1 templates → feed + chat ---------- */
function weightedEv(evs) { const tot = evs.reduce((s, e) => s + (e.p || 1), 0); let x = Math.random() * tot; for (const e of evs) { x -= (e.p || 1); if (x <= 0) return e; } return evs[0]; }
function fireAgentEvent(seedTs) {
  if (!DEMO) return;
  const ids = Object.keys(R).filter(id => R[id].v1 && R[id].v1.ev && R[id].state !== 'stuck');
  if (!ids.length) return;
  const r = R[ids[Math.floor(Math.random() * ids.length)]];
  const ev = weightedEv(r.v1.ev);
  const text = ev.t();
  r.feed.unshift({ i: ev.i, text, ts: seedTs || Date.now() });
  if (r.feed.length > 30) r.feed.pop();
  if (!seedTs) {
    spawnEmote(r, ev.i);
    mcp.onAgentEvent(r.a.id, r.a.dept, r.seat, performance.now());
    if (chatHist[r.a.id]) chatPush(r.a.id, { who: 'work', i: ev.i, text });
    if (ev.kpi) { const k = KPIS.find(x => x.id === ev.kpi.id); if (k) k.val += ev.kpi.n; }
    if (ev.brain || Math.random() < 0.12) { brainNotes++; brain.read(r.a.id); office.setBrainCount(brainNotes); }
    if (modalOpen === r.a.id && modalTab === 'activity') renderActivity(r.a.id);
  }
}
let nextApprovalAt = performance.now() + 20000, nextMetricAt = performance.now() + 3000, nextEmoteAt = performance.now() + 2000;
let meeting = null;
function planMeeting(now) { // X: two agents from different teams walk to the centre and talk
  const ids = Object.keys(R).filter(id => R[id].state === 'working');
  if (ids.length < 2) return;
  const a = R[ids[Math.floor(Math.random() * ids.length)]];
  let b = a, guard = 0;
  while (b.a.dept === a.a.dept && guard++ < 50) b = R[ids[Math.floor(Math.random() * ids.length)]];
  if (b === a) return;
  for (const [i, r] of [a, b].entries()) {
    const d = deptRT[r.a.dept];
    const spot = d.brainGate.clone().setY(0.12).multiplyScalar(0.55).add({ x: i ? 1.8 : -1.8, y: 0, z: 2.4 });
    r.path = [r.seat.clone(), r.stand.clone(), ...office.route(r.stand, spot)];
    r.pathI = 0; r.state = 'walking'; r.walkKind = 'meet';
  }
  meeting = { a, b, endAt: now + 9000 + Math.random() * 6000 };
}
function tickDemo(now) {
  if (!DEMO) return;
  if (meeting && now > meeting.endAt && meeting.a.state === 'atBrain' && meeting.b.state === 'atBrain') {
    for (const r of [meeting.a, meeting.b]) { r.path = [r.person.position.clone(), ...office.route(r.person.position, r.stand), r.seat.clone()]; r.pathI = 0; r.state = 'returning'; }
    meeting = null;
  }
  if (now > nextEmoteAt) {
    const ids = Object.keys(R).filter(id => R[id].state === 'working');
    if (ids.length) spawnEmote(R[ids[Math.floor(Math.random() * ids.length)]], rnd(['💬', '✉️', '📈', '💡', '✓', '📞', '🔍', '📎']));
    nextEmoteAt = now + 1200 + Math.random() * 1800;
  }
  if (now > nextApprovalAt) {
    const pending = Object.values(R).filter(r => r.state === 'stuck').length;
    if (pending < 2) { const ids = Object.keys(R).filter(id => R[id].state === 'working' && !R[id].a.lead); if (ids.length) requestApproval(ids[Math.floor(Math.random() * ids.length)]); }
    nextApprovalAt = now + 50000 + Math.random() * 40000;
  }
  if (now > nextMetricAt) { fireAgentEvent(); nextMetricAt = now + 2600 + Math.random() * 3800; }
}
page.afterFrame = () => { syncOverviewBtn(); tickDemo(performance.now()); if (modalOpen && performance.now() - nowCardAt > 1500) { nowCardAt = performance.now(); renderNowCard(modalOpen); } };

/* ---------- hotkeys ---------- */
addEventListener('keydown', (e) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (e.key === 'Escape') { if (brain && brain.isOpen()) brain.close(); else if (tasks && tasks.isOpen()) tasks.close(); else zoomOut(); }
  else if (e.key === 'g' || e.key === 'G') brain && brain.toggle();
  else if (e.key === 'b' || e.key === 'B') { if (tasks) tasks.toggle(); }
  else if (e.key === '+' || e.key === '=') zoomStep(1.5);
  else if (e.key === '-' || e.key === '_') zoomStep(1 / 1.5);
  else if (e.key === '0') zoomOut();
  else if (e.key === 'x' || e.key === 'X') { if (DEMO && !meeting) planMeeting(performance.now()); }
  else if (e.key >= '1' && e.key <= '6') { const dept = ['marketing', 'emails', 'sales', 'ops', 'fin', 'delivery'][+e.key - 1]; if (DEPTS[dept] && focused !== dept) enterFocus(dept); }
  else if (e.key === 'c' || e.key === 'C') { if (focused && focused !== 'brain') { const a = AGENTS.find(x => x.dept === focused && x.lead) || AGENTS.find(x => x.dept === focused); if (a) openAgentRail(a.id, 'chat'); } }
  else if (e.key === 'v' || e.key === 'V') office.setCam(!document.body.classList.contains('cam'));
  else if (e.key === 'd' || e.key === 'D') office.setDark(!office.dark);
  else if (e.key === 'q' || e.key === 'Q') office.rotateBy(Math.PI / 4);
  else if (e.key === 'e' || e.key === 'E') office.rotateBy(-Math.PI / 4);
  else if (e.key === 'n' || e.key === 'N') cyclePhase();
  else if (DEMO && (e.key === 'w' || e.key === 'W')) requestApproval('apay');
});

// the theme: follows the clock; N or the top-bar button previews morning → day → evening → night → back to the clock
const PHASE_ICON = { morning: '🌅', day: '☀', evening: '🌇', night: '🌙' };
function cyclePhase() {
  const pinned = office.store.getState().manualPhase;
  const i = pinned ? office.phases.indexOf(pinned) : -1;
  const next = i + 1 < office.phases.length ? office.phases[i + 1] : null;
  if (next) office.setPhase(next); else office.setPhase(null);
  phaseToast(next ? `${next.toUpperCase()} · preview` : `AUTO · follows your clock (${office.phase})`);
  syncThemeBtn();
}
function syncThemeBtn() {
  const b = document.getElementById('themeBtn'); if (!b) return;
  const pinned = office.store.getState().manualPhase, phase = office.phase;
  b.querySelector('.tb-ico').textContent = PHASE_ICON[phase] || '☀';
  b.querySelector('.tb-lab').innerHTML = pinned ? `${phase.toUpperCase()} <span class="tb-auto">preview</span>` : `${phase.toUpperCase()} <span class="tb-auto">auto</span>`;
  b.classList.toggle('pinned', !!pinned);
}
document.getElementById('themeBtn')?.addEventListener('click', cyclePhase);
let toastTimer = null;
function phaseToast(text) {
  let el = document.getElementById('phaseToast');
  if (!el) { el = document.createElement('div'); el.id = 'phaseToast'; document.body.appendChild(el); }
  el.textContent = text; el.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 1800);
}
/* ---------- clock (REAL local time — locked rule) ---------- */
function tickClock() { document.getElementById('clock').textContent = new Date().toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); if (office.isReady && office.isReady()) syncThemeBtn(); }
setInterval(tickClock, 1000); tickClock();

/* ---------- task boards + boot (once the scene has built the office) ---------- */
function feedPush(r, i, text) {
  r.feed.unshift({ i, text, ts: Date.now() });
  if (r.feed.length > 30) r.feed.pop();
  if (modalOpen === r.a.id && modalTab === 'activity') renderActivity(r.a.id);
}
function applyRoster(agents) {
  if (!Array.isArray(agents)) return;
  for (const a of agents) {
    const r = R[a.id]; if (!r) continue;
    r.a.name = a.name;
    office.renamePill(a.id, a.name, r.a.lead);
    r.v1 = r.v1 || {};
    r.v1.role = a.role || r.v1.role || ''; r.v1.tagline = a.does || r.v1.tagline || '';
    r.v1.greeting = a.lead ? `I coordinate ${DEPTS[r.a.dept].name}. My current specialists: ${agents.filter(x => x.department === a.department && !x.lead).map(x => x.name).join(', ')}. Send a request and I’ll plan, delegate and verify it.` : `${a.does || 'I am ' + a.name + '.'} Add a task for the team lead to plan and verify, or ask me something here.`;
    r.v1.chips = ['What are you working on?', 'What can you do for me?', 'What tools can you use?'];
    if (chatHist[a.id] && chatHist[a.id][0] && chatHist[a.id][0].who === 'agent') chatHist[a.id][0].text = r.v1.greeting;
    if (modalOpen === a.id) openAgentRail(a.id, modalTab, false);
  }
  if (tasks && tasks.syncPills) tasks.syncPills();
}
function boot() {
  brain = office.brain;
  brainNotes = brain.state.notes; office.setBrainCount(brainNotes);
  if (!DEMO) document.body.classList.add('live-office');
  if (DEMO) loadConnectors().then(c => mcp.init(c));
  tasks = (DEMO ? initTasks : initOfficeWork)({
    hud, R, deptRT, RAIL_SIDE, spawnEmote, chatPush, chatHist, feedPush, zoomToApproval, enterFocus, openAgent, esc,
    brainWrite: (id, title) => brain.write(id, title), brain,
    onLive: (h) => { const ver = document.querySelector('#topbar .brand .ver'); if (ver) ver.textContent = ''; document.title = 'Cloud AI Office'; brainNotes = h.notes; office.setBrainCount(h.notes); brain.setOwner(h.name); brain.setQuiet(true); applyRoster(h.agents); },
    onTools: (agentId, keys) => mcp.onToolsUsed(agentId, keys),
    requestApproval, setStuck: setStuckLive,
    onUsage: (u) => mcp.setUsage(u),
    getFocused: () => focused, getZoom: () => view.zoom, getFocusDim: () => office.focusDim,
    toScreen, reframe,
    pm: () => office.pm,
    rightNow: (scope) => rightNowHTML(rightNowRows({ R: scope && scope !== 'brain' ? Object.fromEntries(Object.entries(R).filter(([, r]) => r.a.dept === scope)) : R, pm: office.pm, DEPTS, live: !DEMO, rnd })),
  });
  // seed a believable history so Activity isn't empty at boot (demo)
  if (DEMO) { for (let i = 0; i < 170; i++) fireAgentEvent(Date.now() - ri(2, 200) * 60000); for (const r of Object.values(R)) r.feed.sort((a, b) => b.ts - a.ts); }
  view.target.set(...overviewPos());
  addEventListener('resize', () => { if (!focused && !office.isTweening()) view.target.set(...overviewPos()); });
  // deterministic view hooks for headless screenshots: #view=sales | #zoom=2.2 | #phase=night
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('zoom')) view.zoom = parseFloat(h.get('zoom')) || 1;
  if (h.get('appr')) requestApproval(h.get('appr') === '1' ? 'apay' : h.get('appr'));
  if (h.get('view') && LAYOUT[h.get('view')]) enterFocus(h.get('view'));
  if (h.get('cam')) office.setCam(h.get('cam') === '1');
  if (h.get('phase')) office.setPhase(h.get('phase'));
  if (h.get('dark') === '1' || forcedDarkAtLoad) office.setDark(true);
  addEventListener('hashchange', () => { const p = new URLSearchParams(location.hash.slice(1)); const d = p.get('dark'); if (d === '1') office.setDark(true); else if (d === '0') office.setDark(false); if (p.get('phase')) office.setPhase(p.get('phase')); });
  if (h.get('board')) { const b = h.get('board'); if (LAYOUT[b] && b !== 'brain') tasks.openFor(b); else tasks.open(); }
  syncOverviewBtn();
  window.CC = { flyTo, zoomToDept, zoomOut, zoomToApproval, requestApproval, openAgent, openPM, view, applyCamera: office.applyCamera, R, emotes: office.emotes,
    setCam: office.setCam, setDark: office.setDark, setPhase: office.setPhase, cyclePhase, phaseToast, office, brain, connectorReveal: () => mcp.startReveal(performance.now()),
    toggleBoard: () => tasks.toggle(), addTask: (agentId, title) => tasks.addTask(agentId, title), tasks, routines: () => tasks.routines };
}
