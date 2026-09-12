import { DEPTS, DEPT_KEYS } from './data.js';
import { officeReady } from './auth.js';
import { HOSTED, USER, PLATFORM_ONLY, isOfficeAdmin, isPlatformAdmin, MANAGED_MODELS, canOpenArea } from './session.js';
import { initSettings } from './settings.js';
import { unseenResult } from './activity.js';
import { readyMilestones } from '../milestones.mjs';
import { initInbox } from './inbox.js';
import { mark, dot, officeSummary } from './status.js';
import { connectLive } from './sse.js';
// The new engine's states, shown with the interface's vocabulary; realState keeps the exact one.
const UI_STATE = { awaiting_ceo: 'waiting', escalated: 'blocked', awaiting_lead_review: 'reviewing', executing: 'working' };
const uiJob = j => ({ ...j, realState: j.state, state: UI_STATE[j.state] || j.state });
const teamChip = k => k === 'auto' ? { chip: '#465B70', name: 'Program Manager chooses' } : DEPTS[k];
import { renderTaskWorkspace, renderDocument } from './task-output.js';
import { rightNowRows, rightNowHTML, jobChain } from './rightnow.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const labels = { backlog: 'Backlog', queued: 'Queued', planning: 'Planning', working: 'Working', reviewing: 'Lead review', saving: 'Saving deliverable', waiting: 'Your approval', blocked: 'Blocked', done: 'Approved', cancelled: 'Cancelled', pending: 'Pending', failed: 'Failed', interrupted: 'Interrupted' };
const when = value => value ? new Date(value).toLocaleString() : '—';
const lines = value => String(value || '').split('\n').map(s => s.trim()).filter(Boolean);
async function api(path, method = 'GET', body) {
  const response = await fetch('/api' + path, { method, signal: AbortSignal.timeout(path.startsWith('/projects/plan') ? 180000 : (path.startsWith('/tools')||path.startsWith('/projects/documents')) ? 45000 : 15000), ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Request failed.');
  return value;
}

export function initOfficeWork(ctx) {
  const { R, deptRT, onLive, onUsage, getFocused } = ctx;
  let jobs = [], config = null, tools = [], selectedTeam = 'auto', filter = 'all', refreshing = false, agentOpen = null, modalKind = '', modalTask = null;
  let reportDays = 7, reportFetchCounter = 0, taskFetchCounter = 0, taskDirty = false, connectionStale = false;
  let taskCurrent = null, taskTab = 'work', taskTabTouched = false, taskSignature = '';
  let taskExpanded = new Map(), taskScroll = {}, taskInputDraft = {};
  const activityByAgent = new Map();
  let settingsDraft = null, settingsTeam = DEPT_KEYS[0], settingsSection = 'overview', toolPoll = null;
  const panel = document.getElementById('tpanel');
  panel.innerHTML = `<button type="button" id="tpanelHandle" aria-label="Expand or collapse the work panel"></button><form class="space-command">
    <div class="space-team-picker"><button id="spaceDept" type="button" aria-expanded="false" aria-controls="spaceTeamMenu"><i style="background:${teamChip(selectedTeam).chip}"></i><span>${esc(teamChip(selectedTeam).name)}</span><span class="space-chevron">⌄</span></button><div id="spaceTeamMenu" hidden><button type="button" data-pick-team="auto"><i style="background:#465B70"></i>Let the Program Manager choose</button>${DEPT_KEYS.map(k => `<button type="button" data-pick-team="${k}"><i style="background:${DEPTS[k].chip}"></i>${esc(DEPTS[k].name)}</button>`).join('')}</div></div>
    <textarea id="spaceBrief" rows="2" aria-label="Task brief" placeholder="What needs to get done? Enter sends, Shift+Enter for a new line" required></textarea>
    <details class="space-options" id="spaceOptions"><summary><span class="opt-pill">Options <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span><span class="opt-hint">assign · due date · more teams · documents</span></summary><div class="space-options-grid"><label>For<span><select id="spaceAssignee"></select><small id="spaceAssignHint"></small></span></label><label>Due<input type="datetime-local" id="spaceDue"></label><label>Priority<select id="spacePriority"><option value="1">Normal</option><option value="2">High</option><option value="0">Low</option></select></label><label>Documents<input type="file" id="spaceFiles" multiple accept=".pdf,.docx,.txt,.md,.csv"></label><label>Project<select id="spaceProject"><option value="">None</option></select></label>${HOSTED ? '<label>Visibility<select id="spaceVisibility"><option value="private">Private</option><option value="public">Everyone in the office</option></select></label><label id="spaceShareWrap">Share with<select id="spaceShare" multiple size="4"></select><small>People and groups who may see this task. You and the office admins always can.</small></label>' : ''}<div class="space-involve" id="spaceInvolve"></div></div></details>
    <div class="space-command-actions"><span>Lead-reviewed work</span><button type="submit" class="space-save-draft" data-backlog="true" title="Save without starting agents">Save idea</button><button type="submit">Add task <span aria-hidden="true">↗</span></button></div><p id="spaceHint" role="status"></p></form>
    <div class="space-now-head"><span class="space-h2">Right now</span></div>
    <div id="spaceNow" class="space-now"></div>
    <div class="space-feed-head"><h2>Work & results</h2><button type="button" id="spaceArtifactsQuick" class="space-feed-link" title="Every file every task produced, filtered by type and date">Office Artifacts ↗</button></div>
    <div id="spaceFilters" class="space-filters"></div><div id="spaceOffline" class="space-offline" hidden></div><div id="spaceProvider" class="space-offline space-provider" hidden></div><div id="spaceJobs" class="space-jobs"></div>`;
  const dialog = document.createElement('dialog'); dialog.id = 'spaceDialog';
  dialog.innerHTML = '<header><h2 id="spaceTitle"></h2><button type="button" id="spaceExpand" aria-label="Full screen" title="Full screen">⤢</button><button type="button" id="spaceClose" aria-label="Close">×</button></header><p id="spaceMessage" role="status"></p><div id="spaceContent"></div>';
  document.body.appendChild(dialog);
  const $ = id => document.getElementById(id), content = $('spaceContent');
  // The handle cycles the sheet: half (the default) → tall → peek (only the handle) → half. Body classes let the scene controls make room.
  $('tpanelHandle').onclick = () => { const next = panel.classList.contains('tall') ? 'peek' : panel.classList.contains('peek') ? 'half' : 'tall'; panel.classList.remove('tall', 'peek'); if (next !== 'half') panel.classList.add(next); document.body.classList.toggle('sheet-peek', next === 'peek'); document.body.classList.toggle('sheet-tall', next === 'tall'); };
  for(const event of ['input','change'])content.addEventListener(event,e=>{if(modalKind==='task'&&e.target.matches('input,textarea,select')){taskDirty=true;if(e.target.id)taskInputDraft[e.target.id]=e.target.value;}});
  const feedback = (text, error = false) => { $('spaceMessage').textContent = text; $('spaceMessage').classList.toggle('error', error); };
  // The task view can fill the screen; the choice is remembered.
  const setFull = on => { dialog.classList.toggle('full', on); const b = $('spaceExpand'); b.textContent = on ? '⤡' : '⤢'; b.title = b.ariaLabel = on ? 'Exit full screen' : 'Full screen'; try { localStorage.setItem('ao.task.full', on ? '1' : ''); } catch {} };
  $('spaceExpand').onclick = () => setFull(!dialog.classList.contains('full'));
  function open(kind, title) { modalKind = kind; dialog.dataset.view = kind; $('spaceTitle').textContent = title; feedback(''); let full = false; try { full = kind === 'task' && localStorage.getItem('ao.task.full') === '1'; } catch {} setFull(full); if (!dialog.open) dialog.showModal(); requestAnimationFrame(()=>{dialog.scrollTop=0;content.scrollTop=0;}); }
  function close() { dialog.close(); modalKind = ''; if (toolPoll) { clearInterval(toolPoll); toolPoll = null; } }
  $('spaceClose').onclick = close; dialog.addEventListener('cancel', close); dialog.addEventListener('keydown', event => event.stopPropagation());
  // The Program Manager takes work for any team and picks the leads itself.
  const projectUI = {
    open() {
      open('projects', 'Program Manager');
      const mine = jobs.filter(j => j.autoRoute).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
      content.innerHTML = `<p>Give the Program Manager anything that spans teams, or when you are not sure who should own it. It brings in the right leads and closes the task once they approve the work.</p><form id="spacePmForm"><label>What needs to get done?<textarea name="text" rows="4" required></textarea></label><div class="space-actions"><button type="submit">Send to the Program Manager ↗</button></div></form><h3>Projects</h3>${projectsOpen.length ? `<div class="space-pm-projects">${projectsOpen.map(p => `<span>${esc(p.name)}${p.status === 'paused' ? ' · paused' : ''}</span>`).join('')}</div>` : '<p>No projects yet.</p>'}<p><a href="#/settings/projects" class="space-text-action">Define a project: charter, timeline, files ↗</a></p><h3>The Program Manager's tasks</h3>${mine.map(j => `<button class="space-note" data-job="${j.id}"><b>${esc(j.title)}</b><span>${labels[j.state] || esc(j.state)}${j.progressLine ? ' · ' + esc(j.progressLine) : ''}</span></button>`).join('') || '<p>None yet.</p>'}`;
      content.querySelectorAll('[data-job]').forEach(b => b.onclick = () => showTask(b.dataset.job));
      $('spacePmForm').onsubmit = async event => { event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true; try { const job = await api('/tasks', 'POST', { dept: 'auto', depts: 'auto', text: event.target.elements.text.value }); await refresh(); projectUI.open(); feedback(`Task received: ${job.title}. Open it from the list when you want to follow the plan.`); } catch (error) { feedback(error.message, true); button.disabled = false; } };
    },
    refresh: async () => {},
    activity: () => { const j = jobs.find(j => j.autoRoute && ['planning', 'working', 'reviewing'].includes(j.state)); return j ? { state: 'running', title: j.title } : null; },
  };
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || !(event.target instanceof HTMLTextAreaElement)) return;
    const t = event.target;
    if (t.id === 'spaceBrief') { event.preventDefault(); t.form?.querySelector('button[type=submit]:not(.space-save-draft)')?.click(); }
    else if (t.id === 'spaceRevision') { event.preventDefault(); (t.closest('details, .space-owner-approval') || t.parentElement)?.querySelector('button[data-action]:not(.space-text-action)')?.click(); }
  }, true);
  const inbox = initInbox({ api, openTask: id => showTask(id), openNote: id => settings.openNote(id), retryTask: id => api(`/tasks/${id}/retry`, 'POST', {}) });
  let rosterChanged = false, projectsOpen = [], providerHealth = null;
  // Open projects for the task form; refreshed with the board.
  const fillProjects = () => { const sel = $('spaceProject'); if (!sel) return; const current = sel.value; sel.innerHTML = '<option value="">None</option>' + projectsOpen.filter(p => p.status !== 'done').map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.status === 'paused' ? ' (paused)' : ''}</option>`).join(''); if (projectsOpen.some(p => p.id === current)) sel.value = current; };
  const reloadForRoster = () => { if (!rosterChanged || settings.isOpen() || dialog.open || taskDirty) return; rosterChanged = false; $('spaceHint').textContent = 'The roster changed. Refreshing the office…'; setTimeout(() => location.reload(), 600); };
  const settings = initSettings({ api, openTask: id => showTask(id), brain: ctx.brain, syncBrain, onShow: () => { if (dialog.open) close(); inbox?.close(); }, onHide: () => setTimeout(reloadForRoster, 50) });
  // The Manage menu is a directory: every area with a one-line status, and what needs the owner at the top.
  const manage = document.createElement('div'); manage.className = 'space-manage';
  manage.innerHTML = `<button id="spaceManage" type="button" aria-label="Manage office" aria-expanded="false" aria-controls="spaceManageMenu"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2.5" fill="var(--cream)"/><circle cx="15" cy="17" r="2.5" fill="var(--cream)"/></svg><span>Manage</span><span class="mg-dot mg-dot-off" id="spaceManageDot" hidden></span></button><div id="spaceManageMenu" hidden role="dialog" aria-label="Manage the office"></div>`;
  $('claudeConnect').before(manage);
  // The directory follows the viewer: a member of a hosted office sees no Tools, Vault, Office settings or Audit; the models are the platform's in hosted mode; platform admins get the Platform panel.
  const DIRECTORY = [['People', [['projects', 'Projects'], ['teams', 'Teams & people'], ['routines', 'Routines']]], ['Knowledge', [['brain', 'Brain'], ['skills', 'Skills'], ['artifacts', 'Office Artifacts'], ['reports', 'Reports & KPIs']]], ['Services', [['models', 'Models & keys'], ['tools', 'Tools & connectors'], ['vault', 'Vault']]], ['Administration', [['profile', 'Profile'], ['users', 'Users & groups'], ['office', 'Office settings'], ['audit', 'Audit log'], ['admin', 'Platform']]]]
    .map(([group, items]) => [group, items.filter(([id]) => canOpenArea(id))]).filter(([, items]) => items.length);
  const goArea = id => { if (id === 'inbox') return inbox.open(); if (id === 'projects') return projectUI.open(); settings.open(id); };
  const renderDirectory = s => {
    const a = id => s?.areas?.[id] || {};
    const item = ([id, label]) => `<button type="button" class="mg-dir-item" data-go="${id}">${esc(label)}${a(id).line ? `<small>${esc(a(id).line)}</small>` : ''}${a(id).dot ? dot(a(id).dot) : ''}</button>`;
    const connect = $('claudeConnect');
    $('spaceManageMenu').innerHTML = `<div class="mg-dir-head"><h2>Manage</h2><span class="mg-eyebrow">${esc(s?.name || 'Your office')}${s ? ' · ' + esc(s.areas.teams.line) : ''}</span>${HOSTED && USER ? `<span class="mg-eyebrow mg-who">${esc(USER.name)} · ${esc(USER.email)} · ${esc(USER.role)}</span>` : ''}<span class="mg-needs">${s ? (s.attention.length ? `${dot(s.attention.some(x => x.kind === 'fail') ? 'fail' : 'warn')}<b>${s.attention.length}</b>&nbsp;need${s.attention.length === 1 ? 's' : ''} you` : `${dot('ok')}Nothing needs you`) : 'Checking…'}</span></div>
      <div class="mg-dir-attn">${(s?.attention || []).slice(0, 4).map(x => `<div class="mg-attn">${mark(x.kind, x.label)}<span>${esc(x.text)}</span><button type="button" data-go="${x.go}">${esc(x.action)}</button></div>`).join('')}</div>
      <div class="mg-dir-body">${DIRECTORY.map(([group, items], i) => `<div class="mg-dir-col"><span class="mg-eyebrow">${group}</span>${items.map(item).join('')}${i === DIRECTORY.length - 1 ? '<div id="claudeConnectSlot"></div>' : ''}</div>`).join('')}</div>
      <div class="mg-dir-foot">${s ? esc(s.foot) : 'Reading the office…'}${HOSTED ? '<button type="button" class="mg-signout" id="spaceSignOut">Sign out</button>' : ''}${s ? mark(s.healthy ? 'ok' : (s.attention.some(x => x.kind === 'fail') ? 'fail' : 'warn'), s.healthy ? 'Office healthy' : (s.attention.some(x => x.kind === 'fail') ? 'Something failed' : 'Needs attention')) : ''}</div>`;
    $('claudeConnectSlot').replaceWith(connect); // the unlock / models shortcut keeps the label auth.js gives it
    const signOut = $('spaceSignOut'); if (signOut) signOut.onclick = async () => { try { await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch {} location.reload(); };
    const d = $('spaceManageDot'); if (s) { d.hidden = !s.attention.length; d.className = 'mg-dot mg-dot-' + (s.attention.some(x => x.kind === 'fail') ? 'fail' : 'warn'); d.title = s.attention.length + ' need you'; }
  };
  renderDirectory(null);
  const toggleMenu = (button, menu, visible) => { $(menu).hidden = !visible; $(button).setAttribute('aria-expanded', String(visible)); };
  $('spaceManage').onclick = async () => { const open = $('spaceManageMenu').hidden; toggleMenu('spaceManage', 'spaceManageMenu', open); if (open) { try { renderDirectory(await officeSummary(api)); } catch {} } };
  $('spaceManageMenu').addEventListener('click', event => { const b = event.target.closest('[data-go]'); if (!b) return; toggleMenu('spaceManage', 'spaceManageMenu', false); goArea(b.dataset.go); });
  officeSummary(api).then(renderDirectory).catch(() => {}); setInterval(() => { if (document.hidden) return; officeSummary(api, { force: true }).then(s => { if ($('spaceManageMenu').hidden) renderDirectory(s); }).catch(() => {}); }, 60000);
  $('claudeConnect').addEventListener('click', () => toggleMenu('spaceManage','spaceManageMenu',false));
  if ($('spaceArtifactsQuick')) $('spaceArtifactsQuick').onclick = () => settings.open('artifacts');
  $('spaceDept').onclick = () => toggleMenu('spaceDept','spaceTeamMenu',$('spaceTeamMenu').hidden);
  $('spaceTeamMenu').querySelectorAll('[data-pick-team]').forEach(button => button.onclick = () => {
    selectedTeam = button.dataset.pickTeam;
    $('spaceDept').innerHTML = `<i style="background:${teamChip(selectedTeam).chip}"></i><span>${esc(teamChip(selectedTeam).name)}</span><span class="space-chevron">⌄</span>`;
    toggleMenu('spaceDept','spaceTeamMenu',false); fillOptions(); $('spaceBrief').focus();
  });
  document.addEventListener('click', event => {
    if (!manage.contains(event.target)) toggleMenu('spaceManage','spaceManageMenu',false);
    if (!event.target.closest('.space-team-picker')) toggleMenu('spaceDept','spaceTeamMenu',false);
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { if (!$('spaceManageMenu').hidden) { toggleMenu('spaceManage','spaceManageMenu',false); $('spaceManage').focus(); } if (!$('spaceTeamMenu').hidden) { toggleMenu('spaceDept','spaceTeamMenu',false); $('spaceDept').focus(); } } });
  function fillOptions() {
    const auto = selectedTeam === 'auto', all = Object.values(R).map(r => r.a), people = all.filter(a => a.dept === selectedTeam);
    const option = a => `<option value="${esc(a.id)}">${esc(a.name)}${a.lead ? ' (lead)' : ''}</option>`;
    $('spaceAssignee').innerHTML = `<option value="">${auto ? 'The Program Manager decides' : 'The lead decides'}</option>`
      + (auto ? DEPT_KEYS.map(k => { const team = all.filter(a => a.dept === k); return team.length ? `<optgroup label="${esc(DEPTS[k].name)}">${team.map(option).join('')}</optgroup>` : ''; }).join('') : people.map(option).join(''));
    $('spaceAssignee').disabled = false;
    $('spaceAssignee').onchange = () => { const a = Object.values(R).find(r => r.a.id === $('spaceAssignee').value)?.a; $('spaceAssignHint').textContent = a && auto ? `${a.name} takes it, so ${DEPTS[a.dept]?.name || a.dept} owns the task.` : ''; };
    $('spaceAssignHint').textContent = '';
    $('spaceInvolve').innerHTML = auto ? '<small>The Program Manager brings in the teams it needs.</small>' : '<span>Also involve</span>' + DEPT_KEYS.filter(k => k !== selectedTeam).map(k => `<label><input type="checkbox" value="${k}">${esc(DEPTS[k].name)}</label>`).join('');
  }
  fillOptions();
  // Hosted offices: who sees a new task. The lists of people and groups come from the office; the owner and the admins always see it.
  let audienceLists = { users: [], groups: [] };
  const audienceName = id => audienceLists.users.find(x => x.id === id)?.name || audienceLists.groups.find(x => x.id === id)?.name || id;
  async function fillAudience() {
    if (!HOSTED) return;
    try { const [u, g] = await Promise.all([api('/users'), api('/groups')]); audienceLists = { users: u.users.filter(x => x.id !== USER?.id), groups: g.groups }; } catch { return; }
    const sel = $('spaceShare'); if (!sel) return; const keep = new Set([...sel.selectedOptions].map(o => o.value));
    sel.innerHTML = (audienceLists.groups.length ? `<optgroup label="Groups">${audienceLists.groups.map(x => `<option value="g:${esc(x.id)}" ${keep.has('g:' + x.id) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>` : '') + `<optgroup label="People">${audienceLists.users.map(x => `<option value="u:${esc(x.id)}" ${keep.has('u:' + x.id) ? 'selected' : ''}>${esc(x.name)} · ${esc(x.role)}</option>`).join('') || '<option disabled>Nobody else yet — invite people under Manage → Users & groups</option>'}</optgroup>`;
  }
  const audienceOf = (visibility, picked) => ({ visibility, sharedWith: { users: picked.filter(v => v.startsWith('u:')).map(v => v.slice(2)), groups: picked.filter(v => v.startsWith('g:')).map(v => v.slice(2)) } });
  const audienceInput = () => HOSTED ? audienceOf($('spaceVisibility')?.value || 'private', [...($('spaceShare')?.selectedOptions || [])].map(o => o.value)) : {};
  if (HOSTED) { $('spaceVisibility').onchange = () => { $('spaceShareWrap').hidden = $('spaceVisibility').value === 'public'; }; fillAudience(); }
  panel.querySelector('form').onsubmit = async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true;
    try {
      // Documents go with the task: it is created as an idea, the files land under its /work/inbox/ (and, for a project task, their text in the project's Brain folder), then it is queued.
      const files = [...($('spaceFiles').files || [])], wantBacklog = !!event.submitter.dataset.backlog;
      for (const file of files) if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} is larger than 25 MB.`);
      const assignee = $('spaceAssignee').value || undefined, forTeam = assignee ? Object.values(R).find(r => r.a.id === assignee)?.a.dept : null;
      const auto = selectedTeam === 'auto' && !forTeam, team = forTeam || selectedTeam, involve = [...$('spaceInvolve').querySelectorAll('input:checked')].map(el => el.value), due = $('spaceDue').value;
      let job = await api('/tasks', 'POST', { dept: auto ? 'auto' : team, ...(auto ? { depts: 'auto' } : involve.length ? { depts: [team, ...involve] } : {}), text: $('spaceBrief').value, assignee, dueAt: due ? new Date(due).getTime() : undefined, priority: Number($('spacePriority').value), backlog: wantBacklog || files.length > 0, projectId: $('spaceProject').value || undefined, ...audienceInput() });
      for (const file of files) {
        $('spaceHint').textContent = `Adding ${file.name} to the task…`;
        const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = reject; r.readAsDataURL(file); });
        await api(`/tasks/${job.id}/attach`, 'POST', { name: file.name, data, type: file.type });
      }
      if (files.length && !wantBacklog) job = await api(`/tasks/${job.id}/queue`, 'POST', { state: 'queued' });
      $('spaceDue').value = ''; $('spaceFiles').value = ''; $('spacePriority').value = '1'; $('spaceOptions').open = false; if (HOSTED) { $('spaceVisibility').value = 'private'; $('spaceShareWrap').hidden = false; for (const o of $('spaceShare').options) o.selected = false; } selectedTeam = 'auto'; $('spaceDept').innerHTML = `<i style="background:${teamChip('auto').chip}"></i><span>${esc(teamChip('auto').name)}</span><span class="space-chevron">⌄</span>`; fillOptions();
      $('spaceBrief').value = ''; $('spaceHint').textContent = job.state === 'backlog' ? 'Idea saved. Start it when you are ready.' : 'Task received. The lead will create the plan; open the task from the list on the right to follow it.';
      await refresh();
    } catch (error) { $('spaceHint').textContent = error.message; if (/model key/i.test(error.message)) settings.open('models'); }
    finally { button.disabled = false; }
  };
  const AGENT_NAMES = {};
  let lastRefreshAt = 0;
  function renderNow() {
    const el = $('spaceNow'); if (!el) return;
    for (const r of Object.values(R)) { const a = activityByAgent.get(r.a.id); r.liveJobId = a?.jobId || null; }
    const rows = rightNowRows({ R, pm: ctx.pm ? ctx.pm() : null, DEPTS, jobs, live: true });
    const html = rightNowHTML(rows);
    if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; el.querySelectorAll('[data-agent]').forEach(row => row.onclick = () => { const id = row.dataset.agent; if (id === 'program-manager') projectUI.open(); else ctx.openAgent && ctx.openAgent(id, 'activity'); }); }
    const ago = lastRefreshAt ? Math.max(0, Math.round((Date.now() - lastRefreshAt) / 1000)) : null;
    // The provider notice can be dismissed; it stays away until a newer failure than the one dismissed comes in.
    const prov = $('spaceProvider'); if (prov) {
      const n = providerHealth?.lastHour || 0, at = providerHealth?.last?.at || 0; let dismissed = 0; try { dismissed = Number(localStorage.getItem('providerNoticeDismissed')) || 0; } catch {}
      prov.hidden = !n || at <= dismissed;
      if (!prov.hidden && prov.dataset.at !== String(at)) {
        prov.dataset.at = String(at);
        const text = document.createElement('span'); text.textContent = `The model provider failed ${n} time${n === 1 ? '' : 's'} in the last hour${providerHealth.last ? ' (last: ' + providerHealth.last.reason.slice(0, 80) + ')' : ''}. Tasks retry on their own; if it keeps happening, change the model under Manage → Models & keys.`;
        const close = document.createElement('button'); close.type = 'button'; close.className = 'space-notice-close'; close.setAttribute('aria-label', 'Dismiss this notice'); close.title = 'Dismiss'; close.textContent = '×';
        close.onclick = () => { try { localStorage.setItem('providerNoticeDismissed', String(at)); } catch {} prov.hidden = true; };
        prov.replaceChildren(text, close);
      }
    }
    const off = $('spaceOffline'); if (off) { off.hidden = !connectionStale; if (connectionStale) off.textContent = `Lost the server${ago != null ? ' ' + ago + 's ago' : ''}. Showing the last known state; work animations paused until it’s back.`; }
  }
  setInterval(renderNow, 1500);
  const involves = (j, key) => (!j.autoRoute && (j.dept === key || (j.depts || []).includes(key))) || (j.runs || []).some(r => r.role === 'lead' && r.dept === key);
  function scopedJobs() { const dept = getFocused(); return dept && dept !== 'brain' ? jobs.filter(j => involves(j, dept)) : jobs; }
  // A project is one card on the board: its tasks stay off the lists and add up to one progress line; blocked work turns the card red.
  const PROJECT_STATES = { blocked: ['blocked'], waiting: ['waiting'], active: ['queued', 'planning', 'working', 'reviewing', 'saving'] };
  function projectSummaries() {
    const dept = getFocused();
    return projectsOpen.map(p => {
      const tasks = jobs.filter(j => j.projectId === p.id), counted = tasks.filter(j => j.state !== 'cancelled');
      if (dept && dept !== 'brain' && tasks.length && !tasks.some(j => involves(j, dept))) return null;
      // Milestones that do not wait for each other are worked in parallel: the ready ones are those with nothing open before them.
      const milestones = p.milestones || [], reached = milestones.filter(m => m.done).length, ready = readyMilestones(milestones), readyIds = new Set(ready.map(m => m.id)), next = ready[0] || null;
      const count = states => tasks.filter(j => states.includes(j.state)).length, done = count(['done']);
      // Progress follows the milestones: each an equal share, an open one counted by its tasks done (a task without a milestone counts for the milestone current when it finished); without milestones, the tasks.
      const since = Math.max(0, ...milestones.filter(m => m.done).map(m => m.doneAt || 0));
      const share = m => { if (m.done) return 1; const own = counted.filter(j => j.milestoneId === m.id || (!j.milestoneId && next?.id === m.id && (j.doneAt || Infinity) > since)); return own.length ? own.filter(j => j.state === 'done').length / own.length : 0; };
      const complete = milestones.length ? milestones.every(m => m.done) : counted.length > 0 && done === counted.length;
      // Nothing running: either the next milestone has tasks waiting (idle) or none at all (unplanned: the Program Manager can plan it, or the project is finished).
      const planned = ready.length ? ready.every(m => counted.some(j => j.milestoneId === m.id || (!j.milestoneId && next?.id === m.id && (j.doneAt || Infinity) > since))) : counted.length > 0;
      const state = p.status === 'done' ? 'done' : count(PROJECT_STATES.blocked) ? 'blocked' : count(PROJECT_STATES.waiting) ? 'waiting' : count(PROJECT_STATES.active) ? 'active' : p.status === 'paused' ? 'paused' : complete ? 'done' : planned ? 'idle' : 'unplanned';
      const percent = p.status === 'done' ? 100 : milestones.length ? Math.round(milestones.reduce((sum, m) => sum + share(m), 0) / milestones.length * 100) : counted.length ? Math.round(done / counted.length * 100) : 0;
      // Each milestone with its tasks and its own state, for the nested rows.
      const rows = milestones.map(m => {
        const own = counted.filter(j => j.milestoneId === m.id || (!j.milestoneId && next?.id === m.id && (j.doneAt || Infinity) > since));
        const has = states => own.some(j => states.includes(j.state));
        const rowState = m.done || (own.length && own.every(j => j.state === 'done')) ? 'done' : has(PROJECT_STATES.blocked) ? 'blocked' : has(PROJECT_STATES.waiting) ? 'waiting' : has(PROJECT_STATES.active) ? 'active' : own.length ? 'idle' : readyIds.has(m.id) ? 'unplanned' : 'later';
        return { ...m, own, rowState };
      });
      return { ...p, milestones, rows, tasks, state, percent, done, reached, next, working: count(PROJECT_STATES.active), blocked: count(PROJECT_STATES.blocked), waiting: count(PROJECT_STATES.waiting), backlog: count(['backlog']), unseen: tasks.some(unseenResult), updatedAt: Math.max(0, ...tasks.map(j => j.doneAt || j.updatedAt || j.createdAt || 0)) };
    }).filter(Boolean);
  }
  const projectMatches = (id, p) => id === 'all' || (id === 'active' ? p.state === 'active' : id === 'waiting' ? p.state === 'waiting' : id === 'blocked' ? p.state === 'blocked' : id === 'done' ? p.state === 'done' : false);
  function projectCard(p) {
    const label = { blocked: 'Blocked', waiting: 'Your call', active: 'In progress', done: 'Complete', paused: 'Paused', idle: 'Nothing running', unplanned: 'Next milestone to plan' }[p.state];
    const first = states => p.tasks.find(j => states.includes(j.state));
    const line = [p.done ? `${p.done} done` : '', p.working ? `${p.working} in progress` : '', p.waiting ? `${p.waiting} for you` : '', p.blocked ? `${p.blocked} blocked` : '', p.backlog ? `${p.backlog} to come` : ''].filter(Boolean).join(' · ') || 'No tasks yet';
    const GLYPH = { done: '✓', blocked: '!', waiting: '?', active: '●', idle: '○', unplanned: '◌', later: '·' };
    const word = r => r.rowState === 'done' ? 'achieved' : r.rowState === 'blocked' ? 'blocked' : r.rowState === 'waiting' ? 'waiting for you' : r.rowState === 'active' ? `${r.own.filter(j => PROJECT_STATES.active.includes(j.state)).length} in progress` : r.rowState === 'idle' ? `${r.own.length} queued` : r.rowState === 'unplanned' ? 'to plan' : 'to come';
    const rows = p.rows.length ? `<ul class="space-ms-list">${p.rows.map(r => `<li class="${r.rowState}" title="${esc(r.title)}${r.dueAt ? ' · due ' + esc(new Date(r.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) : ''}"><i>${GLYPH[r.rowState]}</i><span>${esc(r.title)}</span><em>${word(r)}</em></li>`).join('')}</ul>` : '';
    const stuck = p.state === 'blocked' ? first(PROJECT_STATES.blocked) : p.state === 'waiting' ? first(PROJECT_STATES.waiting) : null;
    // What needs the CEO, by name, and the same buttons a task card has for it.
    const problem = stuck ? ` · <b>${p.state === 'blocked' ? 'Blocked' : 'Waiting for you'}: ${esc(stuck.title.slice(0, 70))}</b>${p.state === 'blocked' && stuck.error ? ' · ' + esc(String(stuck.error).slice(0, 90)) : ''}` : '';
    const actions = p.state === 'blocked' ? `<span class="space-card-actions"><button type="button" data-inline="retry-project" data-project-id="${esc(p.id)}">RETRY</button><button type="button" class="secondary" data-inline="changes" data-job-id="${esc(stuck.id)}">FIX & RETRY</button><button type="button" class="space-text-action" data-inline="read" data-job-id="${esc(stuck.id)}">Open ↗</button></span>`
      : p.state === 'waiting' ? `<span class="space-card-actions">${stuck.review?.approved || stuck.pendingActions?.length ? `<button type="button" data-inline="approve" data-job-id="${esc(stuck.id)}">APPROVE</button>` : ''}<button type="button" class="secondary" data-inline="changes" data-job-id="${esc(stuck.id)}">REQUEST CHANGES</button><button type="button" class="space-text-action" data-inline="read" data-job-id="${esc(stuck.id)}">Read ↗</button></span>` : '';
    const when = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    return `<div class="space-job space-project ${p.state}" data-project-card="${esc(p.id)}" role="button" tabindex="0" title="Open the project"><span class="space-card-top"><span class="space-state">${p.state === 'waiting' ? '<i class="space-unread warn" title="Waiting for you"></i>' : p.state === 'blocked' ? '<i class="space-unread red" title="Blocked"></i>' : p.unseen ? '<i class="space-unread" title="New results, not opened yet"></i>' : ''}Project · ${label}</span><time>${esc(when)}</time></span><strong>${esc(p.name)}</strong><span class="space-progress" role="progressbar" aria-valuenow="${p.percent}" aria-valuemin="0" aria-valuemax="100" title="${p.done} of ${p.tasks.filter(j => j.state !== 'cancelled').length} tasks done · ${p.reached} of ${p.milestones.length} milestones achieved"><span class="space-bar"><i style="width:${p.percent}%"></i></span><b class="space-pct">${p.percent}%</b><span class="space-ms">${p.milestones.length ? `${p.reached} of ${p.milestones.length} milestones` : 'no milestones yet'}</span></span>${rows}<span class="space-card-foot"><span>${esc(line)}${problem}</span>${actions}</span></div>`;
  }
  function render() {
    activityByAgent.clear();
    for (const job of [...jobs].reverse()) {
      if (job.state === 'done') {
        if (unseenResult(job)) for (const id of [job.agent,...job.subtasks.map(s=>s.agent).filter(Boolean)]) activityByAgent.set(id,{phase:'done',title:job.title,jobId:job.id});
      } else if (!['cancelled','backlog'].includes(job.state)) for(const step of job.subtasks) if(step.state==='done' && step.agent && (job.runs||[]).some(r=>r.role==='lead'&&r.state==='working'&&r.dept===R[step.agent]?.a.dept)) activityByAgent.set(step.agent,{phase:'submitted',title:step.title,jobId:job.id});
    }
    for (const job of jobs) {
      if (['planning','reviewing'].includes(job.state)) activityByAgent.set(job.agent,{phase:job.state,title:job.title,jobId:job.id});
      // A lead doing its own work (reading the calendar, checking the inbox) is working, not free.
      if (job.state==='working') for (const r of job.runs||[]) if (r.role==='lead'&&r.state==='working'&&r.agent&&!(job.runs||[]).some(x=>x.role==='specialist'&&x.state==='working'&&x.dept===r.dept)) activityByAgent.set(r.agent,{phase:'working',title:job.title,jobId:job.id});
      if (!['cancelled','done'].includes(job.state)) for (const step of job.subtasks) if (step.state==='working'&&step.agent) activityByAgent.set(step.agent,{phase:'working',title:step.title,jobId:job.id});
    }
    const scope = scopedJobs().filter(j => !j.projectId), projectCards = projectSummaries();
    $('spaceFilters').innerHTML = [['all', 'All'], ['backlog', 'Ideas'], ['active', 'Active'], ['waiting', 'Review'], ['blocked', 'Blocked'], ['done', 'Results']].map(([id, name]) => {
      const count = scope.filter(j => id === 'all' || (id === 'active' ? ['queued', 'planning', 'working', 'reviewing', 'saving'].includes(j.state) : j.state === id)).length + projectCards.filter(p => projectMatches(id, p)).length;
      return `<button class="${filter === id ? 'selected' : ''}" data-filter="${id}">${name} <b>${count}</b></button>`;
    }).join('');
    $('spaceFilters').querySelectorAll('button').forEach(b => b.onclick = () => { filter = b.dataset.filter; render(); });
    const visible = scope.filter(j => filter === 'all' || (filter === 'active' ? ['queued', 'planning', 'working', 'reviewing', 'saving'].includes(j.state) : j.state === filter));
    const historyOpen = $('spaceJobs').querySelector('[data-task-history]')?.open || false;
    const nameOf = id => (R[id] && R[id].a.name) || AGENT_NAMES[id] || id || 'worker';
    const chain = j => `<span class="space-chain">${jobChain(j, nameOf)}</span>`;
    const dateOf = j => new Date(j.doneAt || j.updatedAt || j.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const card = j => {
      const terminal = ['done', 'cancelled'].includes(j.state);
      const lead = nameOf(j.team?.lead || (R[j.agent] && R[j.agent].a.lead ? j.agent : null) || j.agent);
      const loading = j.state === 'planning' && !j.subtasks.length;
      const context = j.state === 'done' ? `${esc(lead)} verified · ${j.resultPreview ? 'read' : 'open'} ↗` : j.state === 'cancelled' ? 'Task closed' : j.state === 'backlog' ? 'Saved for later' : loading ? `${esc(lead)} is planning · reading the Brain · usually under a minute` : j.state === 'blocked' ? (j.error ? esc(j.error.slice(0, 90)) : 'Open to resolve the blocker') : j.state === 'waiting' ? `${esc(lead)} verified · ${j.review?.checks?.length ? j.review.checks.filter(c => c.passed).length + '/' + j.review.checks.length + ' checks passed · ' : ''}ready for your approval` : j.subtasks.length ? `${j.completedSteps}/${j.subtasks.length} steps in · ${labels[j.state].toLowerCase()}` : 'Awaiting the lead’s plan';
      // A task handed across teams belongs to all of them; the card says so and names who is on it right now.
      // The teams that actually worked, in the order they joined; a Program-Manager task lists every team as possible, which is not the same thing.
      const worked = [...new Set((j.runs || []).filter(r => r.role === 'lead' && r.dept).map(r => r.dept))];
      const teamsLine = (worked.length ? worked : j.autoRoute ? [] : [j.dept]).map(d => esc(DEPTS[d]?.name || (d === j.dept ? j.teamName : d) || d)).join(' → ') || 'Program Manager';
      const onIt = terminal || ['backlog', 'queued', 'waiting'].includes(j.state) ? [] : [...new Set((j.runs || []).filter(r => r.state === 'working' && r.agent).map(r => nameOf(r.agent)).filter(Boolean))];
      const actions = j.state === 'waiting' ? `<span class="space-card-actions">${j.review?.approved || j.pendingActions?.length ? `<button type="button" data-inline="approve" data-job-id="${j.id}">APPROVE</button>` : ''}<button type="button" class="secondary" data-inline="changes" data-job-id="${j.id}">REQUEST CHANGES</button><button type="button" class="space-text-action" data-inline="read" data-job-id="${j.id}">Read ↗</button></span>`
        : j.state === 'blocked' ? `<span class="space-card-actions"><button type="button" data-inline="retry" data-job-id="${j.id}">RETRY</button><button type="button" class="secondary" data-inline="changes" data-job-id="${j.id}">FIX & RETRY</button><button type="button" class="space-text-action" data-inline="cancel" data-job-id="${j.id}">Cancel</button></span>`
        : ['queued', 'planning', 'working', 'reviewing', 'backlog'].includes(j.state) ? `<span class="space-card-actions"><button type="button" class="space-text-action" data-inline="cancel" data-job-id="${j.id}">${j.state === 'backlog' ? 'Discard' : 'Cancel'}</button></span>` : '';
      return `<div class="space-job ${j.state}${loading ? ' loading' : ''}" data-job="${j.id}" role="button" tabindex="0"><span class="space-card-top"><span class="space-state">${j.state === 'done' && unseenResult(j) ? '<i class="space-unread" title="Ready, not opened yet"></i>' : ''}${j.state === 'done' ? 'Ready' : loading ? 'Planning' : labels[j.state] || esc(j.state)}${j.priority === 2 ? ' · Priority' : ''}${j.kind === 'evaluation' ? ' · Test' : ''}${j.lane === 'quick' ? ' · Quick' : ''}</span><time>${dateOf(j)}</time></span><strong>${esc(j.title)}</strong>${j.projectName ? `<span class="space-card-project">${esc(j.projectName)}</span>` : ''}${!terminal && j.state !== 'backlog' ? chain(j) : ''}${j.resultPreview && j.state === 'done' ? `<span class="space-result-excerpt">${esc(j.resultPreview)}</span>` : ''}<span class="space-card-context"><b>${teamsLine}</b> · ${onIt.length ? esc(onIt.join(' & ')) + ' on it · ' : ''}${context}</span>${actions}</div>`;
    };
    const groups = [['attention', 'Your call', ['waiting', 'blocked']], ['results', 'Ready to read', ['done']], ['active', 'In progress', ['queued', 'planning', 'working', 'reviewing', 'saving']], ['ideas', 'Ideas', ['backlog']], ['history', 'Closed tasks', ['cancelled']]];
    $('spaceJobs').innerHTML = groups.map(([id, title, states]) => {
      let items = visible.filter(j => states.includes(j.state)).sort((a, b) => (b.doneAt || b.updatedAt || b.createdAt) - (a.doneAt || a.updatedAt || a.createdAt));
      if (!items.length) return '';
      let more = '';
      if (id === 'results' && filter === 'all' && items.length > 3) { more = `<button type="button" class="space-more" data-more="done">+${items.length - 3} more results</button>`; items = items.slice(0, 3); }
      const cards = items.map(card).join('');
      if (id === 'history' && filter === 'all') return `<details class="space-closed-tasks" data-task-history ${historyOpen ? 'open' : ''}><summary>${title} <span>${items.length}</span></summary>${cards}</details>`;
      return `<section class="space-feed-group" aria-label="${title}">${filter === 'all' ? `<div class="space-group-heading">${title}<span>${items.length}</span></div>` : ''}${cards}${more}</section>`;
    }).join('') || (filter === 'all' ? `<div class="space-empty"><h3>The office is quiet.</h3><p>${Object.keys(R).length} agents at their desks, nothing assigned. Three things this office is good at, to get started:</p><div class="space-starters">${[['emails', 'Triage the inbox and tell me what needs me'], ['fin', 'List overdue invoices and draft the reminders'], ['sales', 'Summarise this week’s inbound leads']].filter(([k]) => DEPTS[k]).map(([k, t]) => `<button type="button" data-starter="${k}" data-text="${esc(t)}"><b style="color:${DEPTS[k].ink}">${esc(DEPTS[k].short)}</b>${esc(t)}</button>`).join('')}</div></div>` : '<div class="space-empty"><p>Nothing here right now.</p></div>');
    const shownProjects = projectCards.filter(p => projectMatches(filter, p)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (shownProjects.length) { $('spaceJobs').querySelector('.space-empty')?.remove(); $('spaceJobs').insertAdjacentHTML('afterbegin', `<section class="space-feed-group" aria-label="Projects">${filter === 'all' ? `<div class="space-group-heading">Projects<span>${shownProjects.length}</span></div>` : ''}${shownProjects.map(projectCard).join('')}</section>`); }
    $('spaceJobs').querySelectorAll('[data-project-card]').forEach(b => { b.onclick = e => { if (e.target.closest('[data-inline]')) return; settings.openProject(b.dataset.projectCard); }; b.onkeydown = e => { if (e.key === 'Enter') settings.openProject(b.dataset.projectCard); }; });
    $('spaceJobs').querySelectorAll('[data-starter]').forEach(b => b.onclick = () => { selectedTeam = b.dataset.starter; setTimeout(fillOptions); $('spaceDept').innerHTML = `<i style="background:${teamChip(selectedTeam).chip}"></i><span>${esc(teamChip(selectedTeam).name)}</span><span class="space-chevron">⌄</span>`; $('spaceBrief').value = b.dataset.text; $('spaceBrief').focus(); });
    $('spaceJobs').querySelectorAll('[data-more]').forEach(b => b.onclick = () => { filter = b.dataset.more; render(); });
    $('spaceJobs').querySelectorAll('[data-inline]').forEach(b => b.onclick = async e => {
      e.stopPropagation(); const id = b.dataset.jobId, act = b.dataset.inline;
      if (act === 'read') return showTask(id);
      if (act === 'retry-project') { b.disabled = true; try { for (const j of jobs.filter(x => x.projectId === b.dataset.projectId && PROJECT_STATES.blocked.includes(x.state))) await api(`/tasks/${j.id}/retry`, 'POST', { feedback: '' }); await refresh(); } catch (error) { feedback(error.message, true); b.disabled = false; } return; }
      if (act === 'changes') { await showTask(id); const d = content.querySelector('[data-detail-key="revision"]'); if (d) { d.open = true; d.querySelector('textarea')?.focus(); } return; }
      if (act === 'cancel' && !confirm('Cancel this task?')) return;
      b.disabled = true;
      try { await api(`/tasks/${id}/${act}`, 'POST', act === 'retry' ? { feedback: '' } : {}); await refresh(); } catch (error) { feedback(error.message, true); b.disabled = false; }
    });
    $('spaceJobs').querySelectorAll('[data-job]').forEach(b => { b.onclick = e => { if (e.target.closest('[data-inline]')) return; showTask(b.dataset.job); }; b.onkeydown = e => { if (e.key === 'Enter') showTask(b.dataset.job); }; });
    renderNow();
    for (const key of DEPT_KEYS) {
      const list = jobs.filter(j => involves(j, key));
      const values = { doing: list.filter(j => ['planning', 'working', 'reviewing'].includes(j.state)).length, next: list.filter(j => j.state === 'queued').length, done: list.filter(j => j.state === 'done').length };
      for (const [state, count] of Object.entries(values)) document.querySelectorAll(`[data-tk="${key}-${state}"]`).forEach(el => el.textContent = count);
      const ORDER = { waiting: 0, blocked: 0, working: 1, reviewing: 1, planning: 1, queued: 2 }, WORD = { waiting: 'waits for you', blocked: 'blocked', working: 'working', reviewing: 'in review', planning: 'planning', queued: 'queued' };
      const open = list.filter(j => j.state in ORDER).sort((a, b) => ORDER[a.state] - ORDER[b.state] || (b.updatedAt || 0) - (a.updatedAt || 0));
      const who = j => { const s = (j.subtasks || []).find(x => x.agent && x.state === 'working' && R[x.agent]?.a.dept === key) || (j.runs || []).find(r => r.state === 'working' && r.dept === key); const id = s?.agent; return id && R[id] ? R[id].a.name : ''; };
      const html = open.length ? '<div class="b-eye">Active tasks</div>' + open.slice(0, 5).map(j => `<button type="button" data-task="${esc(j.id)}" title="${esc(j.title)}"><span class="seat ${['waiting', 'blocked'].includes(j.state) ? 'stuck' : j.state === 'queued' ? '' : 'on'}"></span><span class="what">${esc(j.title)}</span><span class="st">${esc(who(j) || WORD[j.state])}</span></button>`).join('') + (open.length > 5 ? `<div class="b-eye" style="padding-top:4px">+${open.length - 5} more</div>` : '') : '';
      document.querySelectorAll(`[data-tjobs="${key}"]`).forEach(el => { if (el.innerHTML !== html) el.innerHTML = html; });
    }
  }
  async function syncBrain() { const graph = await api('/brain'); ctx.brain.setGraph(graph); const count = document.querySelector('.brainTag b'); if (count) count.textContent = graph.notes; }
  async function refresh() {
    if (refreshing) return; refreshing = true;
    try {
      const before = jobs.filter(j => j.state === 'done').length; jobs = (await api('/tasks')).map(uiJob); try { projectsOpen = await api('/projects/open'); fillProjects(); } catch {} try { providerHealth = (await api('/health')).provider || null; } catch {} lastRefreshAt = Date.now(); if(connectionStale){$('spaceHint').textContent='Connection restored.';connectionStale=false;} for (const j of jobs) for (const a of (j.agents || [])) AGENT_NAMES[a.id] = a.name; render(); if (jobs.filter(j => j.state === 'done').length !== before) await syncBrain();
      await projectUI.refresh();
      if (agentOpen) renderAgent(agentOpen);
      if (dialog.open && modalKind === 'reports' && document.activeElement?.id !== 'spaceReportPeriod') await showReports(false);
      if (dialog.open && modalKind === 'task' && !taskDirty && !dialog.contains(document.activeElement?.closest('textarea,input,select'))) await showTask(modalTask, false);
    } catch (error) { connectionStale=true;activityByAgent.clear();$('spaceHint').textContent='Live updates interrupted. Showing the last recorded state; reconnecting…'; }
    finally { refreshing = false; }
  }
  function taskActions(job) {
    const queued = job.calls === 0 && ['backlog', 'queued'].includes(job.state);
    if (['cancelled', 'saving'].includes(job.state)) return '';
    const cancel = '<button type="button" class="tv-btn tv-btn-text tv-danger" data-action="cancel">Cancel task</button>';
    if (job.realState === 'awaiting_ceo' && (job.pendingActions || []).some(a => a.name !== 'complete_task')) return `<div class="tv-pending">${job.pendingActions.map(a => `<div class="tv-pend"><b>${esc(a.name === 'complete_task' ? 'Close the task and file the result' : 'Run ' + a.name)}</b>${a.name === 'complete_task' ? '' : `<pre>${esc(JSON.stringify(a.args, null, 2))}</pre>`}</div>`).join('')}</div><div class="tv-act"><button type="button" class="tv-btn tv-btn-p" data-action="approve">Approve · run it once</button></div><details class="tv-more" data-detail-key="revision"><summary>Reject with a note</summary><label class="tv-field">What should the team do instead?<textarea id="spaceRevision" rows="2"></textarea></label><div class="tv-act"><button type="button" class="tv-btn" data-action="reject">Reject</button></div></details>`;
    if (job.realState === 'escalated') return `<label class="tv-field">Your answer<textarea id="spaceRevision" rows="3" placeholder="Tell the team what to do."></textarea></label><div class="tv-act"><button type="button" class="tv-btn tv-btn-p" data-action="answer">Send to the team</button><span class="tv-sp"></span>${cancel}</div>`;
    if (job.state === 'done') return `<details class="tv-more" data-detail-key="revision"><summary>Ask for changes</summary><label class="tv-field">What should change? The lead reworks it, reviews it again, and you get a new version.<textarea id="spaceRevision" rows="3"></textarea></label><div class="tv-act"><label class="tv-remember"><input type="checkbox" id="spaceRemember"> Remember this for the team from now on</label><span class="tv-sp"></span><button type="button" class="tv-btn tv-btn-p" data-action="message" data-kind="correction">Send correction</button></div></details>`;
    if (queued) return `<label class="tv-field">Task brief<textarea id="spaceQueueBrief" rows="3">${esc(job.text)}</textarea></label><div class="tv-act"><label class="tv-inline">Priority <select id="spaceQueuePriority">${[[2, 'High'], [1, 'Normal'], [0, 'Low']].map(([value, label]) => `<option value="${value}" ${value === (job.priority ?? 1) ? 'selected' : ''}>${label}</option>`).join('')}</select></label><span class="tv-sp"></span><button type="button" class="tv-btn" data-action="queue" data-queue-state="${job.state}">Save changes</button><button type="button" class="tv-btn tv-btn-p" data-action="queue" data-queue-state="${job.state === 'backlog' ? 'queued' : 'backlog'}">${job.state === 'backlog' ? 'Start task' : 'Move to ideas'}</button>${cancel}</div>`;
    if (job.state === 'blocked') return `<label class="tv-field">Tell the team what to change, or leave it blank to retry as it was<textarea id="spaceRevision" rows="2" placeholder="Describe a correction…"></textarea></label><div class="tv-act"><button type="button" class="tv-btn tv-btn-p" data-action="retry">Retry task</button><button type="button" class="tv-btn" data-go-models>Change the model</button><span class="tv-sp"></span>${cancel}</div>`;
    if (job.state === 'waiting') return `${job.review?.approved ? '<div class="tv-act"><button type="button" class="tv-btn tv-btn-p" data-action="approve">Approve completion</button></div>' : ''}<details class="tv-more" data-detail-key="revision"><summary>Request changes</summary><label class="tv-field">What needs to change?<textarea id="spaceRevision" rows="2"></textarea></label><div class="tv-act"><button type="button" class="tv-btn" data-action="reject">Send for revision</button><span class="tv-sp"></span>${cancel}</div></details>`;
    if (['queued', 'planning', 'working', 'reviewing'].includes(job.state)) return `<details class="tv-more" data-detail-key="revision"><summary>Add a note for the team</summary><label class="tv-field">The team gets it at its next step.<textarea id="spaceRevision" rows="2"></textarea></label><div class="tv-act"><button type="button" class="tv-btn tv-btn-p" data-action="message" data-kind="note">Send note</button><span class="tv-sp"></span>${cancel}</div></details>`;
    return `<div class="tv-act"><span class="tv-sp"></span>${cancel}</div>`;
  }
  function rememberTaskView() {
    content.querySelectorAll('[data-detail-key]').forEach(el=>taskExpanded.set(el.dataset.detailKey,el.open));
    taskScroll[taskTab]=content.scrollTop;
  }
  // Hosted offices: who sees this task, and where it came from; the owner or an office admin can change the audience.
  function audienceBar(job) {
    const mine = job.ownerId && job.ownerId === USER?.id, can = isOfficeAdmin() || mine, shared = [...(job.sharedWith?.groups || []), ...(job.sharedWith?.users || [])];
    const who = job.visibility === 'public' ? 'Everyone in the office can see this task' : `Private${shared.length ? ' · shared with ' + shared.map(id => esc(audienceName(id))).join(', ') : ''}`;
    const from = job.origin?.channel === 'email' ? ` · from email${job.origin.from ? ' · ' + esc(job.origin.from) : ''}` : job.origin?.channel === 'routine' ? ' · from a routine' : job.origin?.channel === 'chat' ? ' · from a chat' : '';
    const owner = mine ? 'yours' : job.ownerId ? 'owned by ' + esc(audienceName(job.ownerId)) : '';
    const options = `<optgroup label="Groups">${audienceLists.groups.map(g => `<option value="g:${esc(g.id)}" ${(job.sharedWith?.groups || []).includes(g.id) ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</optgroup><optgroup label="People">${audienceLists.users.filter(u => u.id !== job.ownerId).map(u => `<option value="u:${esc(u.id)}" ${(job.sharedWith?.users || []).includes(u.id) ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</optgroup>`;
    return `<div class="space-audience" data-audience><span>${who}${owner ? ' · ' + owner : ''}${from}</span>${can ? '<button type="button" class="secondary" data-audience-edit>Change</button>' : ''}
      ${can ? `<form class="space-audience-form" data-audience-form hidden><label>Visibility<select name="visibility"><option value="private" ${job.visibility !== 'public' ? 'selected' : ''}>Private</option><option value="public" ${job.visibility === 'public' ? 'selected' : ''}>Everyone in the office</option></select></label><label>Share with<select name="share" multiple size="4">${options}</select></label><button type="submit">Save</button><small>Private covers the record, its thread, progress and files. An approved result is still filed in the shared Brain, which every agent reads.</small></form>` : ''}</div>`;
  }
  function bindAudience(job) {
    const edit = content.querySelector('[data-audience-edit]'), form = content.querySelector('[data-audience-form]'); if (!edit || !form) return;
    edit.onclick = () => { form.hidden = !form.hidden; taskDirty = !form.hidden; };
    form.onsubmit = async event => {
      event.preventDefault(); const picked = [...form.elements.share.selectedOptions].map(o => o.value);
      try { await api(`/tasks/${job.id}/share`, 'POST', audienceOf(form.elements.visibility.value, picked)); taskDirty = false; taskSignature = ''; await refresh(); await showTask(job.id, false); feedback('Saved who sees this task.'); }
      catch (error) { feedback(error.message, true); }
    };
  }
  function renderTaskView() {
    const job=taskCurrent;if(!job)return;
    content.innerHTML=(HOSTED?audienceBar(job):'')+renderTaskWorkspace(job,taskTab,taskActions(job));bindAudience(job);
    content.querySelectorAll('[data-detail-key]').forEach(el=>{if(taskExpanded.has(el.dataset.detailKey))el.open=taskExpanded.get(el.dataset.detailKey);});
    for(const [id,value] of Object.entries(taskInputDraft)){const field=$(id);if(field)field.value=value;}
    content.scrollTop=taskScroll[taskTab] || 0;
    content.querySelectorAll('[data-task-tab]').forEach(button=>button.onclick=()=>{
      rememberTaskView();taskTab=button.dataset.taskTab;taskTabTouched=true;renderTaskView();$('spaceTaskTab-'+taskTab)?.focus({preventScroll:true});
    });
    content.querySelector('[role=tablist]').onkeydown=event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const tabs=['result','work','review','artifacts'];const index=tabs.indexOf(taskTab);
      const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length;
      content.querySelector(`[data-task-tab="${tabs[next]}"]`).click();
    };
    content.querySelectorAll('[data-output-anchor]').forEach(link=>link.onclick=event=>{event.preventDefault();$(link.dataset.outputAnchor)?.scrollIntoView({behavior:'smooth',block:'start'});});
    if($('spaceCopyResult'))$('spaceCopyResult').onclick=async event=>{
      const button=event.currentTarget,article=content.querySelector('.space-deliverable');
      try{
        if(navigator.clipboard.write&&window.ClipboardItem)await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([article.innerHTML],{type:'text/html'}),'text/plain':new Blob([article.innerText],{type:'text/plain'})})]);
        else await navigator.clipboard.writeText(article.innerText);
        button.textContent='Copied';setTimeout(()=>{if(button.isConnected)button.textContent='Copy';},1800);
      }catch{feedback('Copy is unavailable in this browser. You can select the result text or download it.',true);}
    };
    if($('spaceDownloadResult'))$('spaceDownloadResult').onclick=()=>{
      const filename=(job.title || 'result').replace(/[^\p{L}\p{N}._-]+/gu,'-').slice(0,80);
      const text=(job.state==='done'?'':'> Draft — not approved for completion.\n\n')+job.result+'\n';
      const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=(job.state==='done'?'':'draft-')+filename+'.md';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    content.querySelectorAll('[data-go-models]').forEach(b => b.onclick = () => { close(); settings.open('models'); });
    content.querySelectorAll('[data-action]').forEach(button=>button.onclick=async()=>{
      button.disabled=true;
      try{
        await api(`/tasks/${job.id}/${button.dataset.action}`,'POST',button.dataset.action==='queue'?{text:$('spaceQueueBrief').value,priority:Number($('spaceQueuePriority').value),state:button.dataset.queueState}:(()=>{const v=$('spaceRevision')?.value||'';if(['message','answer','reject'].includes(button.dataset.action)&&!v.trim())throw new Error('Write your message first.');return {feedback:v,text:v,kind:button.dataset.kind,remember:$('spaceRemember')?.checked?'team':undefined};})());
        taskDirty=false;taskInputDraft={};taskSignature='';await refresh();await showTask(job.id,false);
      }catch(error){feedback(error.message,true);button.disabled=false;}
    });
  }
  async function showTask(id,reveal=true) {
    const request=++taskFetchCounter;
    if(reveal){taskDirty=false;modalTask=id;taskCurrent=null;taskTabTouched=false;taskSignature='';taskExpanded=new Map();taskScroll={};taskInputDraft={};open('task','Task');content.innerHTML='<p>Loading task…</p>';}
    try{
      const job=uiJob(await api('/tasks/'+id));
      if((!reveal&&taskDirty)||request!==taskFetchCounter||!dialog.open||modalKind!=='task'||modalTask!==id)return;
      const signature=String(job.updatedAt)+':'+job.state+':'+job.events.length;
      // Do not replace a finished document every poll: preserve reading position,
      // text selections, focused controls, and any open verification details.
      if(!reveal&&signature===taskSignature)return;
      if(!reveal&&window.getSelection()?.toString()&&content.contains(window.getSelection().anchorNode))return;
      if(taskCurrent)rememberTaskView();
      taskCurrent=job;taskSignature=signature;if(!taskTabTouched)taskTab=job.result?'result':'work';
      $('spaceTitle').textContent=job.title;renderTaskView();
      // Opening a result, a blocker or a decision marks it seen: the person's pill and desk go back to idle.
      if(reveal&&(unseenResult(job)||['blocked','waiting'].includes(job.state)))api(`/tasks/${id}/seen`,'POST',{}).then(()=>{const local=jobs.find(j=>j.id===id);if(local){local.seenAt=Date.now();render();}}).catch(()=>{});
    }catch(error){feedback(error.message,true);}
  }
  function acknowledgeAgent(id) {
    const mine = jobs.filter(j => unseenResult(j) && (j.agent === id || (j.subtasks || []).some(s => s.agent === id)));
    if (!mine.length) return;
    for (const j of mine) { j.seenAt = Date.now(); api(`/tasks/${j.id}/seen`, 'POST', {}).catch(() => {}); }
    render();
  }
  function renderAgent(id) {
    agentOpen = id; acknowledgeAgent(id);
    const assigned = jobs.filter(j => j.agent === id || j.subtasks.some(s => s.agent === id || s.eligible?.includes(id)));
    $('mNow').innerHTML = `<b>${assigned.some(j => ['working', 'planning', 'reviewing'].includes(j.state)) ? 'Assigned work' : 'Ready for your next task'}</b>`;
    $('mStats').innerHTML = ''; $('mChart').hidden = true;
    $('mFeed').innerHTML = assigned.map(j => `<button class="space-agent-task" data-job="${j.id}"><b>${esc(j.title)}</b><span>${labels[j.state]} · ${j.completedSteps}/${j.subtasks.length} subtasks submitted</span>${j.subtasks.filter(s => s.agent === id || s.eligible?.includes(id)).map(s => `<span>${s.state === 'done' ? 'Submitted' : labels[s.state]}: ${esc(s.title)}</span>`).join('')}<span>Open plan, deliverables and verification →</span></button>`).join('') || '<p>No tasks assigned. Real plans and progress will appear here.</p>';
    $('mFeed').querySelectorAll('[data-job]').forEach(b => b.onclick = () => showTask(b.dataset.job));
  }
  async function showSettings(tab) {
    try {
      [config, tools] = await Promise.all([api('/office'), api('/tools')]); settingsDraft = structuredClone(config);
      open(tab, tab === 'tools' ? 'Tools & MCP servers' : 'Teams & working instructions');
      if (tab === 'tools') renderTools(); else { if(!settingsDraft.teams.some(t=>t.id===settingsTeam))settingsTeam=settingsDraft.teams[0].id;renderTeam(); }
    } catch (error) { feedback(error.message, true); }
  }
  const toolChoices = (selected, prefix) => tools.map(t => `<label class="space-check"><input type="checkbox" data-${prefix}="${esc(t.id)}" ${selected.includes(t.id) ? 'checked' : ''}>${esc(t.name)} <small>${esc(t.origin || t.type)} · ${selected.includes(t.id) ? 'Enabled' : 'Not assigned'}</small></label>`).join('');
  function collectTeam() {
    const form = $('spaceTeamForm'); if (!form) return;
    const team = settingsDraft.teams.find(t => t.id === settingsTeam);
    for (const name of ['name', 'lead', 'purpose', 'instructions', 'planningModel', 'reviewModel']) team[name] = form.elements[name].value;
    for (const name of ['concurrency', 'maxSubtasks', 'maxRevisions', 'maxCalls', 'maxTokens']) team[name] = Number(form.elements[name].value);
    team.guardrails = lines(form.elements.guardrails.value); team.skills = [...form.querySelectorAll('[data-teamskill]:checked')].map(el => el.dataset.teamskill);
    team.requireHumanApproval = form.elements.requireHumanApproval.checked; team.criteria = lines(form.elements.criteria.value);
    team.checks = [...form.querySelectorAll('[data-check-editor]')].map(field => {
      const type = field.querySelector('[data-check-type]').value, value = field.querySelector('[data-check-value]').value;
      return { type, label: field.querySelector('[data-check-label]').value, value: type.includes('length') ? Number(value) : value };
    });
    team.tools = [...form.querySelectorAll('[data-teamtool]:checked')].map(el => el.dataset.teamtool);
    form.querySelectorAll('[data-agent-editor]').forEach(fieldset => {
      const a = settingsDraft.agents.find(a => a.id === fieldset.dataset.agentEditor);
      for (const name of ['name', 'role', 'does', 'brief', 'model', 'effort']) a[name] = fieldset.querySelector(`[data-field="${name}"]`).value;
      a.skills = [...fieldset.querySelectorAll('[data-agentskill]:checked')].map(el => el.dataset.agentskill);
      a.inheritTools = fieldset.querySelector('[data-field="inheritTools"]').checked;
      a.tools = [...fieldset.querySelectorAll('[data-agenttool]:checked')].map(el => el.dataset.agenttool);
    });
    team.tests = [...form.querySelectorAll('[data-test-editor]')].map(field => ({id:field.dataset.testEditor,name:field.querySelector('[data-test-name]').value,prompt:field.querySelector('[data-test-prompt]').value,requiredText:lines(field.querySelector('[data-test-required]').value)}));
  }
  const skillChoices = (selected = [], prefix) => settingsDraft.skills.map(skill => `<label class="space-check"><input type="checkbox" data-${prefix}="${esc(skill.id)}" ${selected.includes(skill.id) ? 'checked' : ''}>${esc(skill.name)} <small>v${skill.revision}</small></label>`).join('');
  function renderTeam() {
    const team = settingsDraft.teams.find(t => t.id === settingsTeam), agents = settingsDraft.agents.filter(a => a.department === team.id);
    const models = selected => ['sonnet', 'opus', 'fable'].map(m => `<option ${m === selected ? 'selected' : ''}>${m}</option>`).join('');
    content.innerHTML = `<div class="space-settings-layout"><aside class="space-settings-nav"><span class="space-eyebrow">FUNCTIONAL AREAS</span><nav class="space-tabs">${settingsDraft.teams.map(t => `<button data-team="${t.id}" class="${t.id === team.id ? 'selected' : ''}">${esc(t.name)}</button>`).join('')}</nav><button type="button" class="secondary" id="spaceAddTeam">+ Add team</button></aside><div class="space-settings-body"><div class="space-settings-heading"><div><span class="space-eyebrow">TEAM WORKSPACE</span><h3>${esc(team.name)}</h3><p>${agents.length} members · ${esc(agents.find(a=>a.id===team.lead)?.name)} leads</p></div><button type="button" class="secondary" id="spaceRemoveTeam">Remove team</button></div><nav class="space-section-tabs">${[['overview','Purpose'],['people','People'],['access','Tools & skills'],['quality','Verification'],['execution','Models & limits'],['tests','Tests']].map(([id,label])=>`<button type="button" data-settings-section="${id}" aria-pressed="${settingsSection===id}">${label}</button>`).join('')}</nav><form id="spaceTeamForm" novalidate><section data-settings-page="overview"><div class="space-grid"><label>Team name<input name="name" value="${esc(team.name)}" required></label><label>Accountable lead<select name="lead">${agents.map(a => `<option value="${a.id}" ${a.id === team.lead ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label></div>
      <label>Team purpose<textarea name="purpose" rows="2" placeholder="What does this team own, and what does success look like?">${esc(team.purpose)}</textarea></label><label>Working instructions<textarea name="instructions" rows="5" placeholder="Purpose, process, tone, source requirements and boundaries for this team.">${esc(team.instructions)}</textarea></label>
      </section><section data-settings-page="quality"><label>Guardrails — one per line<textarea name="guardrails" rows="3" placeholder="Boundaries the lead must verify before approving work.">${esc(team.guardrails.join('\n'))}</textarea></label><label>Lead’s review criteria — one per line<textarea name="criteria" rows="4">${esc(team.criteria.join('\n'))}</textarea></label>
      <h3>Automated acceptance checks</h3><p>These checks must pass even when the lead approves. Text matching ignores case.</p>
      <div id="spaceCheckEditors">${team.checks.map((check, i) => `<details data-check-editor="${i}"><summary>${esc(check.label || 'Acceptance check')}</summary><label>Name<input data-check-label value="${esc(check.label)}" maxlength="160" required></label><div class="space-grid"><label>Rule<select data-check-type>${[['contains','Must contain'],['not_contains','Must not contain'],['min_length','Minimum characters'],['max_length','Maximum characters']].map(([type, label])=>`<option value="${type}" ${check.type===type?'selected':''}>${label}</option>`).join('')}</select></label><label>Value<input data-check-value value="${esc(check.value)}" ${check.type.includes('length')?'type="number" min="1" max="100000" step="1"':'maxlength="1000"'} required></label></div><button type="button" class="secondary" data-remove-check="${i}">Remove check</button></details>`).join('')}</div><button type="button" class="secondary" id="spaceAddCheck">Add check</button>
      <label class="space-check"><input type="checkbox" name="requireHumanApproval" ${team.requireHumanApproval ? 'checked' : ''}>Require my approval after the lead passes the work</label></section><section data-settings-page="execution"><p>The lead chooses each worker’s model and effort from the task complexity. Set the planning and independent review models here; see the actual selections in every task.</p><div class="space-grid"><label>Planning model<select name="planningModel">${models(team.planningModel)}</select></label><label>Review model<select name="reviewModel">${models(team.reviewModel)}</select></label>
      <div class="space-grid">${[['concurrency','Concurrent workers',1,4],['maxSubtasks','Maximum subtasks',1,8],['maxRevisions','Rework rounds',0,3],['maxCalls','Call budget',3,40],['maxTokens','Reported token budget',5000,200000]].map(([name,label,min,max])=>`<label>${label}<input type="number" name="${name}" min="${min}" max="${max}" value="${team[name]}"></label>`).join('')}</div>
      </section><section data-settings-page="access"><h3>Shared skills</h3><div class="space-tool-picks">${skillChoices(team.skills,'teamskill') || 'Create reusable instructions in Manage → Skills.'}</div>
      <h3>Team tools</h3><p>Only assigned tools are available. Worker roles can inherit these tools or use a smaller selection.</p><div class="space-tool-picks">${toolChoices(team.tools,'teamtool') || 'Add connectors in Tools & MCPs.'}</div>
      </section><section data-settings-page="people"><p>Choose a person to edit their responsibilities, model preference and tool access. The lead uses this roster when planning new work.</p><h3>People</h3><div class="space-agent-editors">${agents.map(a => `<details data-agent-editor="${a.id}"><summary><span class="space-avatar">${esc(a.name.slice(0,1))}</span><span><b>${esc(a.name)}</b><small>${a.id === team.lead ? 'Team lead · Plans and verifies' : esc(a.role)}</small></span><span class="space-person-edit">Edit ↗</span></summary><div class="space-grid"><label>Name<input data-field="name" value="${esc(a.name)}" required></label><label>Role<input data-field="role" value="${esc(a.role)}" required></label></div><label>Responsibilities<textarea data-field="does">${esc(a.does)}</textarea></label><label>Role instructions<textarea data-field="brief" rows="3">${esc(a.brief)}</textarea></label><h3>Additional skills</h3><div class="space-tool-picks">${skillChoices(a.skills,'agentskill')}</div><label>Preferred model (lead can adapt per task)<select data-field="model">${models(a.model)}</select></label><label>Effort override<select data-field="effort">${['','low','medium','high','xhigh','max'].map(e=>`<option value="${e}" ${e===(a.effort||'')?'selected':''}>${e || 'Let the lead choose'}</option>`).join('')}</select></label><label class="space-check"><input type="checkbox" data-field="inheritTools" ${a.inheritTools !== false ? 'checked' : ''}>Inherit the team’s tools</label><div class="space-tool-picks">${toolChoices(a.tools,'agenttool')}</div><button class="secondary" type="button" data-remove-agent="${a.id}">Remove agent</button></details>`).join('')}</div>
      <button type="button" class="secondary" id="spaceAddAgent">Add agent</button>
      </section><section data-settings-page="tests"><h3>Team tests</h3><p>Check the full planning, work and review process against known inputs. Tests run without external tools.</p>
      <div id="spaceTestEditors">${team.tests.map(test=>`<details data-test-editor="${esc(test.id)}"><summary>${esc(test.name || 'New test')}</summary><label>Name<input data-test-name value="${esc(test.name)}" required></label><label>Task and supplied facts<textarea data-test-prompt rows="3" required>${esc(test.prompt)}</textarea></label><label>Required text — one per line<textarea data-test-required rows="2">${esc(test.requiredText.join('\n'))}</textarea></label><div class="space-actions"><button type="button" class="secondary" data-run-test="${esc(test.id)}">Run saved test</button><button type="button" class="secondary" data-remove-test="${esc(test.id)}">Remove test</button></div></details>`).join('')}</div>
      <button type="button" class="secondary" id="spaceAddTest">Add test</button>
      </section><div class="space-settings-save"><span id="spaceSaveState">Changes apply when saved</span><button type="submit">Save changes</button><button type="button" class="secondary" id="spaceRunTests" ${team.tests.length ? '' : 'disabled'}>Run all saved tests</button></div></form></div></div>`;
    content.querySelectorAll('[data-settings-page]').forEach(el=>el.hidden=el.dataset.settingsPage!==settingsSection);
    content.querySelectorAll('[data-settings-section]').forEach(b=>b.onclick=()=>{collectTeam();settingsSection=b.dataset.settingsSection;renderTeam();});
    content.querySelectorAll('[data-agent-editor]').forEach(el=>el.addEventListener('toggle',()=>{if(el.open)content.querySelectorAll('[data-agent-editor]').forEach(other=>{if(other!==el)other.open=false;});}));
    $('spaceTeamForm').oninput=()=>{$('spaceSaveState').textContent='Unsaved changes';};
    $('spaceAddTeam').onclick=()=>{collectTeam();if(settingsDraft.teams.length>=10)return feedback('An office supports up to 10 teams.',true);const id='team-'+crypto.randomUUID().slice(0,8),lead=id+'-lead';const template=structuredClone(config.teams[0]);settingsDraft.teams.push({...template,id,name:'New team',lead,purpose:'',instructions:'',guardrails:[],tools:[],skills:[],tests:[],checks:[]});settingsDraft.agents.push({id:lead,department:id,name:'Team lead',role:'Team coordinator',does:'Plan, delegate and verify the work of the current specialists.',brief:'',model:'sonnet',effort:'',tools:[],skills:[],inheritTools:true},{id:id+'-specialist',department:id,name:'Specialist',role:'Specialist',does:'',brief:'',model:'sonnet',effort:'',tools:[],skills:[],inheritTools:true});settingsTeam=id;settingsSection='overview';renderTeam();feedback('Name your team and define its purpose, then configure People and save.');};
    $('spaceRemoveTeam').onclick=()=>{collectTeam();if(settingsDraft.teams.length<=1)return feedback('Keep at least one team.',true);if(!confirm('Remove '+team.name+' and its roster when you save? Past tasks and shared memory are retained. Unfinished work must first be finished or cancelled.'))return;settingsDraft.teams=settingsDraft.teams.filter(t=>t.id!==team.id);settingsDraft.agents=settingsDraft.agents.filter(a=>a.department!==team.id);settingsTeam=settingsDraft.teams[0].id;renderTeam();feedback('Team removal is staged. Save to apply it, or close to discard.');};
    content.querySelectorAll('[data-team]').forEach(b => b.onclick = () => { collectTeam(); settingsTeam = b.dataset.team; renderTeam(); });
    $('spaceAddCheck').onclick = () => { collectTeam(); if(team.checks.length >= 20)return feedback('A team supports up to 20 automated checks.',true); team.checks.push({type:'contains',label:'New acceptance check',value:''});renderTeam();$('spaceCheckEditors').lastElementChild.open=true; };
    content.querySelectorAll('[data-remove-check]').forEach(button=>button.onclick=()=>{collectTeam();team.checks.splice(Number(button.dataset.removeCheck),1);renderTeam();});
    content.querySelectorAll('[data-check-type]').forEach(select=>select.onchange=()=>{
      const input=select.closest('[data-check-editor]').querySelector('[data-check-value]');
      input.type=select.value.includes('length')?'number':'text';input.min='1';input.max='100000';input.step='1';input.maxLength=1000;
    });
    $('spaceAddAgent').onclick = () => { collectTeam(); if (agents.length >= 7) return feedback('A team is a lead and up to six specialists.', true); settingsDraft.agents.push({ id: 'agent-' + crypto.randomUUID().slice(0,8), department: team.id, name: 'New agent', role: 'Specialist', does: '', brief: '', model: 'sonnet', tools: [], inheritTools: true, skills:[] }); renderTeam();content.querySelector('.space-agent-editors').lastElementChild.open=true; };
    content.querySelectorAll('[data-remove-agent]').forEach(b => b.onclick = () => {
      collectTeam(); if (agents.length <= 2) return feedback('Keep a lead and at least one worker.', true);
      settingsDraft.agents = settingsDraft.agents.filter(a => a.id !== b.dataset.removeAgent);
      if (team.lead === b.dataset.removeAgent) team.lead = settingsDraft.agents.find(a => a.department === team.id).id;
      renderTeam();
    });
    $('spaceTeamForm').onsubmit = async event => { event.preventDefault(); collectTeam(); try { const layoutChanged=JSON.stringify(config.agents)!==JSON.stringify(settingsDraft.agents)||JSON.stringify(config.teams.map(t=>[t.id,t.name]))!==JSON.stringify(settingsDraft.teams.map(t=>[t.id,t.name]));config = await api('/office','PUT',settingsDraft);settingsDraft=structuredClone(config);if(layoutChanged){feedback('Saved. Updating the office layout…');setTimeout(()=>location.reload(),600);}else{renderTeam();feedback('Team configuration saved.');} } catch(error) { feedback(error.message,true); } };
    $('spaceAddTest').onclick=()=>{collectTeam();if(team.tests.length>=12)return feedback('A team supports up to 12 tests.',true);team.tests.push({id:'test-'+crypto.randomUUID().slice(0,8),name:'New test',prompt:'',requiredText:[]});renderTeam();$('spaceTestEditors').lastElementChild.open=true;};
    content.querySelectorAll('[data-remove-test]').forEach(button=>button.onclick=()=>{collectTeam();team.tests=team.tests.filter(t=>t.id!==button.dataset.removeTest);renderTeam();});
    const testSaved=()=>{collectTeam();const saved=config.teams.find(t=>t.id===team.id);if(JSON.stringify({...saved,checks:saved.checks.map(({type,label,value})=>({type,label,value}))})!==JSON.stringify({...team,checks:team.checks.map(({type,label,value})=>({type,label,value}))}) || JSON.stringify(config.agents)!==JSON.stringify(settingsDraft.agents)){feedback('Save the team changes before running tests.',true);return false;}return true;};
    content.querySelectorAll('[data-run-test]').forEach(button=>button.onclick=async()=>{if(!testSaved())return;button.disabled=true;try{const job=await api(`/teams/${team.id}/test`,'POST',{testId:button.dataset.runTest});await refresh();await showTask(job.id);}catch(error){feedback(error.message,true);button.disabled=false;}});
    $('spaceRunTests').onclick=async event=>{if(!testSaved())return;event.target.disabled=true;try{const suite=await api(`/teams/${team.id}/tests`,'POST',{});await refresh();await showReports();feedback(`${suite.jobs.length} tests queued. Results update as the lead verifies each one.`);}catch(error){feedback(error.message,true);event.target.disabled=false;}};
  }
  async function showSkills(editId = null) {
    try {
      config = await api('/office');open('skills','Reusable skills');
      const skill = config.skills.find(s=>s.id===editId);
      content.innerHTML = `<p>Save a repeatable method once, then assign it to teams or individual agents. Tasks retain the skill versions they started with.</p><div class="space-skills-list">${config.skills.map(s=>`<button class="space-note" data-edit-skill="${esc(s.id)}"><b>${esc(s.name)} <small>v${s.revision}</small></b><span>${esc(s.description || 'Reusable working instructions')}</span></button>`).join('') || '<p>No skills yet.</p>'}</div><h3>${skill ? 'Edit skill' : 'Create a skill'}</h3><form id="spaceSkillForm"><label>Name<input name="name" value="${esc(skill?.name || '')}" required maxlength="100"></label><label>When to use it<input name="description" value="${esc(skill?.description || '')}" maxlength="500"></label><label>Method and output requirements<textarea name="instructions" rows="8" required maxlength="10000">${esc(skill?.instructions || '')}</textarea></label><div class="space-actions"><button type="submit">Save skill</button>${skill ? '<button class="secondary" type="button" id="spaceNewSkill">New skill</button><button class="secondary" type="button" id="spaceDeleteSkill">Remove & unassign</button>' : ''}</div></form>`;
      content.querySelectorAll('[data-edit-skill]').forEach(button=>button.onclick=()=>showSkills(button.dataset.editSkill));
      $('spaceSkillForm').onsubmit=async event=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.target));const updated={...values,id:skill?.id || 'skill-'+crypto.randomUUID().slice(0,8)};config.skills=skill?config.skills.map(s=>s.id===skill.id?updated:s):[...config.skills,updated];try{await api('/office','PUT',config);await showSkills(updated.id);feedback('Saved. Assign this skill in Teams.');}catch(error){feedback(error.message,true);}};
      if(skill){$('spaceNewSkill').onclick=()=>showSkills();$('spaceDeleteSkill').onclick=async()=>{config.skills=config.skills.filter(s=>s.id!==skill.id);for(const team of config.teams)team.skills=team.skills.filter(id=>id!==skill.id);for(const agent of config.agents)agent.skills=agent.skills.filter(id=>id!==skill.id);try{await api('/office','PUT',config);await showSkills();feedback('Skill removed from the library and assignments. Existing tasks retain their saved version.');}catch(error){feedback(error.message,true);}};}
    }catch(error){feedback(error.message,true);}
  }
  async function showReports(reveal = true) {
    const request = ++reportFetchCounter;
    try {
      const expanded = [...content.querySelectorAll('[data-report-detail][open]')].map(el=>el.dataset.reportDetail);
      const report = await api('/reports?days='+reportDays);
      if(request!==reportFetchCounter || (!reveal && (!dialog.open || modalKind!=='reports')))return;
      if(reveal)open('reports','Team reports');
      const number=value=>value.toLocaleString();
      const cycle=ms=>ms===null?'—':ms<60000?Math.round(ms/1000)+'s':ms<3600000?Math.round(ms/60000)+'m':(ms/3600000).toFixed(1)+'h';
      content.innerHTML=`<div class="space-actions"><label>Tasks created<select id="spaceReportPeriod">${[[7,'Past 7 days'],[30,'Past 30 days'],[90,'Past 90 days'],[0,'All time']].map(([days,label])=>`<option value="${days}" ${days===reportDays?'selected':''}>${label}</option>`).join('')}</select></label><button class="secondary" id="spaceExportReport">Export report</button></div>
        <div class="space-report-stats">${[['Approved',report.summary.approved],['In progress',report.summary.active],['Your review',report.summary.waiting],['Blocked',report.summary.blocked]].map(([label,value])=>`<div><b>${number(value)}</b><span>${label}</span></div>`).join('')}</div>
        <p>${number(report.summary.calls)} model calls · ${number(report.summary.tokens)} reported tokens · ${report.summary.rework} tasks required rework. Tests are counted separately.</p>
        <div class="space-report-table"><table><thead><tr><th>Team</th><th>Approved</th><th>Active</th><th>Blocked</th><th>Calls</th><th>Tokens</th><th>Median cycle</th></tr></thead><tbody>${report.teams.map(t=>`<tr><td>${esc(t.name)}</td><td>${t.approved}</td><td>${t.active}</td><td>${t.blocked}</td><td>${number(t.calls)}</td><td>${number(t.tokens)}</td><td>${cycle(t.medianCycleMs)}</td></tr>`).join('')}</tbody></table></div><p class="space-footnote">Cycle time runs from task creation to approval, including time waiting for review. Counts come from recorded tasks; a dash means no completed sample.</p>
        <h3>Needs attention</h3>${report.attention.map(j=>`<button class="space-note" data-report-job="${j.id}"><b>${esc(j.title)}</b><span>${esc(DEPTS[j.dept]?.name || j.teamName || j.dept)} · ${labels[j.state]} · ${esc(j.reason)}</span></button>`).join('')||'<p>No blocked tasks or pending owner reviews in this period.</p>'}
        <h3>Team detail</h3>${report.teams.map(t=>`<details data-report-detail="team-${t.id}"><summary>${esc(t.name)} · Lead: ${esc(t.lead)}</summary><p>Per-task limits: ${t.limits.callsPerTask} calls, ${number(t.limits.tokensPerTask)} reported tokens. Up to ${t.limits.concurrentWorkers} concurrent workers.</p>${t.agents.map(a=>`<p><b>${esc(a.name)}</b> · ${a.submitted} submissions · ${a.active} active subtasks · ${a.reviews} lead reviews</p>`).join('')}</details>`).join('')}
        <h3>Test results</h3><p>${report.tests.approved}/${report.tests.total} tests passed · ${report.tests.active} running or queued · ${report.tests.blocked} blocked · ${number(report.tests.calls)} calls · ${number(report.tests.tokens)} reported tokens.</p>${report.suites.map(suite=>`<details data-report-detail="suite-${suite.id}"><summary>${esc(DEPTS[suite.dept]?.name)} · ${when(suite.createdAt)} · configuration v${suite.officeRevision}</summary>${suite.jobs.map(j=>`<button class="space-note" data-report-job="${j.id}"><b>${esc(j.name)}</b><span>${j.state==='done'?'Passed':labels[j.state]}${j.error?' · '+esc(j.error):''}</span></button>`).join('')}</details>`).join('')}
        <h3>Approved deliverables</h3>${report.completed.map(j=>`<button class="space-note" data-report-job="${j.id}"><b>${esc(j.title)}</b><span>${esc(DEPTS[j.dept]?.name || j.teamName || j.dept)} · ${when(j.doneAt)}</span></button>`).join('')||'<p>No approved deliverables in this period.</p>'}`;
      content.querySelectorAll('[data-report-detail]').forEach(el=>el.open=expanded.includes(el.dataset.reportDetail));
      $('spaceReportPeriod').onchange=event=>{reportDays=Number(event.target.value);showReports(false);};content.querySelectorAll('[data-report-job]').forEach(button=>button.onclick=()=>showTask(button.dataset.reportJob));
      $('spaceExportReport').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='talkchief-team-report-'+new Date(report.generatedAt).toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    }catch(error){feedback(error.message,true);}
  }
  function renderTools(editing = null) {
    content.innerHTML = `<div class="space-settings-heading"><div><span class="space-eyebrow">CAPABILITIES</span><h3>Tools for your teams</h3><p>Available connections are separate from permission to use them.</p></div><button id="spaceNewTool" type="button">+ Add MCP server</button></div><div class="space-tools">${tools.map(t=>`<article><div><b>${esc(t.name)}</b><span>${esc(t.origin || t.type)}</span><span class="space-tool-access ${t.assignedTeams?.length ? 'enabled' : ''}">${t.assignedTeams?.length ? 'Enabled for '+t.assignedTeams.map(a=>esc(a.name)).join(', ') : 'Not enabled in this office'}</span><small>${t.type==='builtin' ? 'No sign-in needed · Public web research' : 'Provider status: '+esc(t.status)}</small></div><div class="space-actions"><button type="button" data-tool-assign="${t.id}" class="secondary">Team access</button>${t.type !== 'builtin' ? `<button type="button" data-tool-login="${t.id}" class="secondary">Authenticate</button>` : ''}${t.managed ? `<button type="button" data-tool-edit="${t.id}" class="secondary">Edit</button><button type="button" data-tool-remove="${t.id}" class="secondary">Remove</button>` : ''}</div></article>`).join('')}</div>
      <button class="secondary" id="spaceRefreshTools">Check connections</button><section id="spaceToolEditor" ${editing ? '' : 'hidden'}><h3>${editing ? 'Edit server' : 'Add MCP server'}</h3><p>Save the connection, authenticate if needed, then choose the teams that can use it.</p>
      <form id="spaceToolForm"><div class="space-grid"><label>Name<input name="name" value="${esc(editing?.name || '')}" ${editing ? 'readonly' : ''} required pattern="[A-Za-z][A-Za-z0-9_-]*"></label><label>Connection type<select name="type">${['http','sse','stdio'].map(type=>`<option value="${type}" ${type === editing?.type ? 'selected' : ''}>${type === 'stdio' ? 'Local command' : type.toUpperCase()}</option>`).join('')}</select></label></div>
      <div id="spaceRemoteTool"><label>MCP endpoint URL<input name="url" type="url" placeholder="https://example.com/mcp" value="${esc(editing?.url || '')}"></label><label>Bearer token, if required<input name="token" type="password" autocomplete="off" placeholder="${editing?.hasToken ? 'Stored token retained when blank' : 'Optional; OAuth servers use Authenticate'}"></label><label class="space-check"><input type="checkbox" name="clearToken">Remove stored bearer token</label></div>
      <div id="spaceLocalTool" hidden><label>Executable<input name="command" value="${esc(editing?.command || '')}" placeholder="npx"></label><label>Arguments — one per line<textarea name="args">${esc((editing?.args || []).join('\n'))}</textarea></label><label>Environment variables — NAME=value, one per line<textarea name="env" placeholder="API_KEY=your-value"></textarea></label><p>Existing secret values are retained unless replaced. Stored names: ${esc(editing?.envKeys?.join(', ') || 'none')}.</p></div>
      <button type="submit">${editing ? 'Update connection' : 'Add connection'}</button><button type="button" class="secondary" id="spaceCancelTool">Cancel</button></form></section>`;
    $('spaceNewTool').onclick=()=>{$('spaceToolEditor').hidden=false;$('spaceToolForm').elements.name.focus();$('spaceToolEditor').scrollIntoView({block:'start',behavior:'smooth'});};
    $('spaceCancelTool').onclick=()=>renderTools();
    content.querySelectorAll('[data-tool-assign]').forEach(b=>b.onclick=()=>assignTool(b.dataset.toolAssign));
    const form=$('spaceToolForm'), toggle=()=>{ $('spaceLocalTool').hidden=form.elements.type.value!=='stdio'; $('spaceRemoteTool').hidden=form.elements.type.value==='stdio'; }; form.elements.type.onchange=toggle; toggle();
    form.onsubmit=async event=>{ event.preventDefault(); const button=form.querySelector('button[type=submit]'); button.disabled=true;
      try { const input=Object.fromEntries(new FormData(form)); input.clearToken=form.elements.clearToken.checked; input.args=lines(input.args); input.env=Object.fromEntries(lines(input.env).map(line=>{const i=line.indexOf('=');if(i<1)throw new Error('Enter environment variables as NAME=value.');return [line.slice(0,i).trim(),line.slice(i+1)];})); tools=await api('/tools','POST',input); feedback('Connection saved. Assign it to teams to enable it.'); renderTools(); }
      catch(error){feedback(error.message,true);button.disabled=false;} };
    $('spaceRefreshTools').onclick=async()=>{try{tools=await api('/tools?refresh=1');renderTools();}catch(error){feedback(error.message,true);}};
    content.querySelectorAll('[data-tool-edit]').forEach(b=>b.onclick=()=>renderTools(tools.find(t=>t.id===b.dataset.toolEdit)));
    content.querySelectorAll('[data-tool-remove]').forEach(b=>b.onclick=async()=>{try{tools=await api('/tools/'+b.dataset.toolRemove,'DELETE');renderTools();feedback('Removed the connector and its team assignments.');}catch(error){feedback(error.message,true);}});
    content.querySelectorAll('[data-tool-login]').forEach(b=>b.onclick=()=>loginTool(b.dataset.toolLogin));
  }
  async function assignTool(id) {
    try {
      config=await api('/office');const tool=tools.find(t=>t.id===id);
      content.innerHTML=`<button type="button" class="secondary" id="spaceBackTools">← All tools</button><div class="space-settings-heading"><div><span class="space-eyebrow">TEAM ACCESS</span><h3>${esc(tool.name)}</h3><p>${esc(tool.origin)}. Only selected teams can use this tool; individual agents can have a smaller selection.</p></div></div><form id="spaceToolAccess"><div class="space-access-cards">${config.teams.map(t=>`<label class="space-check"><input type="checkbox" value="${t.id}" ${t.tools.includes(id)?'checked':''}><span><b>${esc(t.name)}</b><small>${esc(t.purpose || 'Team workspace')}</small></span></label>`).join('')}</div><div class="space-actions"><button type="submit">Save team access</button></div></form>`;
      $('spaceBackTools').onclick=()=>renderTools();
      $('spaceToolAccess').onsubmit=async e=>{e.preventDefault();const selected=[...e.target.querySelectorAll('input:checked')].map(el=>el.value);for(const team of config.teams)team.tools=[...team.tools.filter(t=>t!==id),...(selected.includes(team.id)?[id]:[])];try{await api('/office','PUT',config);tools=await api('/tools');renderTools();feedback('Team access saved. New model calls use these permissions. Calls already running retain their initial permissions until they return.');}catch(error){feedback(error.message,true);}};
    }catch(error){feedback(error.message,true);}
  }
  async function loginTool(id) {
    try {
      let login=await api(`/tools/${id}/login`,'POST',{});
      content.innerHTML='<p id="mcpMessage">Preparing sign-in…</p><a id="mcpLink" target="_blank" rel="noopener noreferrer" hidden>Open provider sign-in ↗</a><form id="mcpCodeForm"><label>Paste the callback URL or code shown after authorization<input id="mcpCode" type="password" autocomplete="off" required></label><button type="submit">Finish connection</button></form><button class="secondary" id="mcpCancel">Cancel</button>';
      const update=async()=>{login=await api(`/tools/${id}/auth`);$('mcpMessage').textContent=login.message||login.state;if(login.url){$('mcpLink').href=login.url;$('mcpLink').hidden=false;}if(['connected','error','cancelled','expired'].includes(login.state)){clearInterval(toolPoll);toolPoll=null;if(login.state==='connected'){tools=await api('/tools?refresh=1');renderTools();feedback('MCP server authenticated.');}}};
      $('mcpCodeForm').onsubmit=async e=>{e.preventDefault();const code=$('mcpCode').value;$('mcpCode').value='';try{await api(`/tools/${id}/code`,'POST',{id:login.id,code});await update();}catch(error){feedback(error.message,true);}};
      $('mcpCancel').onclick=async()=>{await api(`/tools/${id}/cancel`,'POST',{});clearInterval(toolPoll);toolPoll=null;renderTools();};
      toolPoll=setInterval(()=>update().catch(e=>feedback(e.message,true)),1500);await update();
    }catch(error){feedback(error.message,true);}
  }
  async function showKnowledge() {
    try {
      const notes=await api('/knowledge');open('brain','Brain — shared memory');
      content.innerHTML=`<p>One shared memory across every team. Planning, specialist work and verification retrieve relevant past notes and answers. Approved tasks and projects are saved with their sources; conversations are labelled unreviewed. Time-sensitive facts must be checked again.</p><div class="space-actions"><button id="spacePurpose">Define office purpose</button><button class="secondary" id="spaceNewNote">Add note</button><button class="secondary" id="spaceGraph">View knowledge graph</button></div><label>Find a note<input id="spaceFindNote" type="search" placeholder="Search titles and content previews"></label><div id="spaceKnowledgeList"></div>`;
      const list=()=>{const query=$('spaceFindNote').value.toLowerCase();$('spaceKnowledgeList').innerHTML=notes.filter(n=>(n.title+' '+n.preview).toLowerCase().includes(query)).map(n=>`<button class="space-note" data-note="${esc(n.id)}"><b>${esc(n.title)}</b><span>${n.kind==='deliverable'?'Approved deliverable':n.kind==='conversation'?'Conversation · unreviewed':'Shared knowledge'} · ${when(n.updatedAt)}</span><p>${esc(n.preview)}</p></button>`).join('')||'<div class="space-empty">No notes yet. Start with the office purpose, then add the facts your teams need.</div>';$('spaceKnowledgeList').querySelectorAll('[data-note]').forEach(b=>b.onclick=()=>viewNote(b.dataset.note));};
      $('spaceFindNote').oninput=list;list();$('spaceNewNote').onclick=()=>editNote();$('spacePurpose').onclick=()=>editNote('Knowledge/office-purpose.md',true);$('spaceGraph').onclick=()=>{close();ctx.brain.toggle();};
    }catch(error){feedback(error.message,true);}
  }
  // "Source: /knowledge/…" in a result: the note opens in the Brain (the link's own address downloads it).
  document.addEventListener('click', event => { const link = event.target.closest('a[data-ref-note]'); if (!link) return; event.preventDefault(); open('brain', 'Brain — shared memory'); viewNote(link.dataset.refNote); });
  async function viewNote(id) {
    try{const note=await api('/knowledge/note?id='+encodeURIComponent(id));content.innerHTML=`<div class="space-actions"><button class="secondary" id="spaceBackMemory">← Shared memory</button><button class="secondary" id="spaceEditMemory">Edit note</button></div><p class="space-footnote">${esc(id)} · Updated ${when(note.updatedAt)}</p><article class="space-document">${renderDocument(note.content,'memory',{}).html}</article>`;$('spaceBackMemory').onclick=showKnowledge;$('spaceEditMemory').onclick=()=>editNote(id);}catch(error){feedback(error.message,true);}
  }
  async function editNote(id, purpose=false) {
    let note={content:'',id};
    try{if(id)note=await api('/knowledge/note?id='+encodeURIComponent(id));}catch(error){if(!purpose)return feedback(error.message,true);}
    content.innerHTML=`<button class="secondary" id="spaceBackKnowledge">← Knowledge library</button><h3>${purpose?'Office purpose':id?'Edit note':'New note'}</h3><form id="spaceNoteForm"><label>Title<input name="title" value="${esc(purpose?'Office purpose':note.content.match(/^#\s+(.+)$/m)?.[1]||'')}" required></label><label>${purpose?'Describe the business, who you serve, what teams should achieve, and important constraints.':'Markdown content'}<textarea name="content" rows="16" required>${esc(note.content)}</textarea></label><div class="space-actions"><button type="submit">Save knowledge</button>${id && note.updatedAt ? '<button type="button" class="secondary" id="spaceArchiveNote">Archive note</button>':''}</div></form>`;
    $('spaceBackKnowledge').onclick=showKnowledge;
    $('spaceNoteForm').onsubmit=async event=>{event.preventDefault();try{const form=event.target;await api('/knowledge','POST',{id:note.id,title:form.elements.title.value,content:'# '+form.elements.title.value.trim()+'\n\n'+form.elements.content.value.replace(/^#\s+.*(?:\r?\n)?/, '').trim(),updatedAt:note.updatedAt});await syncBrain();await showKnowledge();feedback('Saved. The next task can use this knowledge.');}catch(error){feedback(error.message,true);}};
    if($('spaceArchiveNote'))$('spaceArchiveNote').onclick=async()=>{try{await api('/knowledge/note?id='+encodeURIComponent(id),'DELETE');await syncBrain();await showKnowledge();feedback('Archived. This note is no longer supplied to agents.');}catch(error){feedback(error.message,true);}};
  }
  // Lead and Program Manager chat: @ or / picks a task; Ask / Correct / Note; "remember" keeps a correction as a standing rule.
  const chat = { agent: null, refs: [], kind: 'question', remember: '', items: [], active: 0, trigger: null, seq: 0 };
  const leadChat = id => id === 'pm' || !!R[id]?.a?.lead;
  const KIND_TEXT = { question: 'Ask', correction: 'Correct', note: 'Note' };
  function chatBar() {
    let bar = $('mCtx');
    if (!bar) {
      const input = $('mIn'); if (!input || !$('mChat')) return null;
      bar = document.createElement('div'); bar.id = 'mCtx'; input.parentElement.before(bar);
      const pick = document.createElement('div'); pick.id = 'mPicker'; pick.hidden = true; pick.setAttribute('role', 'listbox'); $('mChat').appendChild(pick);
      pick.addEventListener('mousedown', e => { const b = e.target.closest('[data-pick]'); if (!b) return; e.preventDefault(); pickTask(+b.dataset.pick); });
      bar.addEventListener('click', e => { const k = e.target.closest('[data-ctx-kind]'), x = e.target.closest('[data-unref]'); if (k) { chat.kind = k.dataset.ctxKind; renderChatBar(); } if (x) { chat.refs.splice(+x.dataset.unref, 1); renderChatBar(); } });
      bar.addEventListener('change', e => { if (e.target.id === 'mRemember') chat.remember = e.target.value; });
    }
    return bar;
  }
  function renderChatBar() {
    const bar = chatBar(); if (!bar) return;
    if (!chat.agent || !leadChat(chat.agent)) { bar.hidden = true; return; }
    bar.hidden = false;
    if (!chat.refs.length) { bar.innerHTML = '<span>Type @ to pick a task to ask about or correct.</span>'; return; }
    bar.innerHTML = chat.refs.map((r, i) => `<span class="ctx-ref">@${esc(r.title.slice(0, 48))}<button type="button" data-unref="${i}" aria-label="Remove">×</button></span>`).join('')
      + `<span class="space-kinds" role="group" aria-label="Message type">${Object.entries(KIND_TEXT).map(([k, l]) => `<button type="button" data-ctx-kind="${k}" aria-pressed="${chat.kind === k}">${l}</button>`).join('')}</span>`
      + (chat.kind === 'correction' ? `<label>Remember<select id="mRemember"><option value="">Only this task</option><option value="agent" ${chat.remember === 'agent' ? 'selected' : ''}>For this lead</option><option value="team" ${chat.remember === 'team' ? 'selected' : ''}>For the team</option></select></label>` : '');
  }
  const closePicker = () => { const p = $('mPicker'); if (p) p.hidden = true; chat.trigger = null; };
  function renderPicker() {
    const p = $('mPicker'); if (!p) return; p.hidden = false;
    p.innerHTML = chat.items.length ? chat.items.map((t, i) => `<button type="button" class="pick-item ${i === chat.active ? 'active' : ''}" data-pick="${i}" role="option">${esc(t.title)}<small>${esc(labels[UI_STATE[t.state] || t.state] || t.state)}</small></button>`).join('') : '<p class="pick-item">No tasks match.</p>';
  }
  async function chatInput(id, el) {
    chat.agent = id; if (!leadChat(id)) return;
    const upto = el.value.slice(0, el.selectionStart ?? el.value.length), m = upto.match(/(?:^|\s)([@/])([^\s@/]{0,40})$/);
    if (!m) return closePicker();
    chat.trigger = { start: upto.length - m[2].length - 1, end: upto.length };
    const seq = ++chat.seq, q = m[2].toLowerCase();
    const items = id === 'pm' ? jobs.filter(j => j.kind !== 'evaluation' && (!q || j.title.toLowerCase().includes(q))).slice(0, 30).map(j => ({ id: j.id, title: j.title, state: j.realState || j.state }))
      : await api(`/teams/${R[id].a.dept}/tasks?q=${encodeURIComponent(q)}`).catch(() => []);
    if (seq !== chat.seq || !chat.trigger) return;
    chat.items = items; chat.active = 0; renderPicker();
  }
  function pickTask(i) {
    const t = chat.items[i], el = $('mIn'); if (!t || !el) return;
    if (chat.trigger) el.value = el.value.slice(0, chat.trigger.start) + el.value.slice(chat.trigger.end);
    if (!chat.refs.some(r => r.id === t.id)) chat.refs = [...chat.refs, t].slice(-3);
    closePicker(); renderChatBar(); el.focus();
  }
  function chatPickerKey(e) {
    const p = $('mPicker'); if (!p || p.hidden) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); chat.active = (chat.active + (e.key === 'ArrowDown' ? 1 : chat.items.length - 1)) % Math.max(1, chat.items.length); renderPicker(); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); if (chat.items.length) pickTask(chat.active); else closePicker(); return true; }
    if (e.key === 'Escape') { closePicker(); return true; }
    return false;
  }
  function chatContext(id) {
    if (chat.agent !== id || !chat.refs.length) return {};
    return { taskId: chat.refs[0].id, refs: chat.refs.map(r => r.id), kind: chat.kind, remember: chat.kind === 'correction' ? chat.remember || undefined : undefined, about: `${KIND_TEXT[chat.kind]} · ${chat.refs.map(r => r.title).join(', ')}` };
  }
  function chatSent(id) { if (chat.agent === id) { chat.refs = []; chat.kind = 'question'; chat.remember = ''; renderChatBar(); } }
  async function loadHistory(id) { const rows = await api('/threads/' + encodeURIComponent('agent:' + id)); return rows.slice(-30).map(m => ({ who: m.role === 'ceo' ? 'user' : 'agent', text: m.text, taskId: m.role === 'ceo' ? undefined : m.jobId || undefined })); }
  const rowHTML = key => { const list = jobs.filter(j => involves(j, key)); return `<div class="b-tasks"><span>ACTIVE<b data-tk="${key}-doing">${list.filter(j => ['planning','working','reviewing'].includes(j.state)).length}</b></span><span>QUEUED<b data-tk="${key}-next">${list.filter(j=>j.state==='queued').length}</b></span><span>APPROVED<b data-tk="${key}-done">${list.filter(j=>j.state==='done').length}</b></span></div>`; };
  for(const key of DEPT_KEYS)(deptRT[key].counts||deptRT[key].apprRow).insertAdjacentHTML(deptRT[key].counts?'beforeend':'beforebegin',rowHTML(key)+(deptRT[key].counts?`<div class="b-jobs" data-tjobs="${key}"></div>`:''));
  window.addEventListener('office:open-task', event => { if (event.detail) showTask(event.detail); });
  window.addEventListener('office:compose', event => { const k = event.detail; if (!DEPT_KEYS.includes(k)) return; selectedTeam = k; $('spaceDept').innerHTML = `<i style="background:${teamChip(k).chip}"></i><span>${esc(teamChip(k).name)}</span><span class="space-chevron">⌄</span>`; fillOptions(); $('spaceBrief').focus(); });
  let liveStatus = 'connecting', taskTimer = null;
  const refreshOpenTask = id => { if (dialog.open && modalKind === 'task' && modalTask === id && !taskDirty) { clearTimeout(taskTimer); taskTimer = setTimeout(() => showTask(id, false), 500); } };
  const onEvent = (type, data) => {
    lastRefreshAt = Date.now();
    settings.onEvent?.(type, data);
    if (type.startsWith('notification.')) inbox.onEvent(type, data);
    else if (type === 'task.updated') { const j = uiJob(data), i = jobs.findIndex(x => x.id === j.id); if (i >= 0) jobs[i] = j; else jobs.unshift(j); render(); if (agentOpen) renderAgent(agentOpen); refreshOpenTask(j.id); }
    else if (['task.state', 'task.live', 'task.event'].includes(type)) refreshOpenTask(data.id);
    // A task's audience changed: everyone drops it; those who may still see it get it back in the task.updated that follows.
    else if (type === 'task.removed') { const i = jobs.findIndex(x => x.id === data.id); if (i >= 0) { jobs.splice(i, 1); render(); } if (modalKind === 'task' && modalTask === data.id) setTimeout(() => { if (!jobs.some(x => x.id === data.id) && modalKind === 'task' && modalTask === data.id) { close(); } }, 600); }
    else if (type === 'brain.updated') syncBrain().catch(() => {});
    else if (type === 'resync' || type === 'office.updated') { if (type === 'office.updated' && data?.area === 'office') { rosterChanged = true; reloadForRoster(); } refresh(); }
  };
  // Polling backs the stream: two seconds while it is down, five while any task is active, fifteen when the office is idle.
  const active = () => jobs.some(j => ['queued', 'planning', 'working', 'reviewing', 'saving'].includes(j.state));
  const poll = () => setTimeout(async () => { await refresh(); poll(); }, liveStatus !== 'live' ? 2000 : active() ? 5000 : 15000);
  // A tab that comes back into view catches up at once (background tabs get throttled timers and may have missed events).
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh().catch(() => {}); });
  // A platform session has no office: straight to the Platform page, nothing else is asked of the server.
  officeReady.then(async()=>{if(PLATFORM_ONLY){settings.open('admin');return;}connectLive({ onEvent, onStatus: status => { const was = liveStatus; liveStatus = status; if (status === 'live' && was !== 'live') refresh(); } });poll();try{const health=await api('/health');onLive?.(health);await syncBrain();await refresh();const wanted=new URLSearchParams(location.hash.slice(1)).get('task');if(wanted)showTask(wanted).catch(()=>{});const usage=await api('/usage');onUsage?.(usage);}catch(error){$('spaceHint').textContent=error.message;}});
  const noop=()=>{};
  return { chatContext, chatInput, chatPickerKey, chatSent, loadHistory, openInbox: () => inbox.open(), needsYouCount: () => inbox.counts.needsYou, settings, get tasks(){return jobs.flatMap(j=>[...j.subtasks.filter(s=>s.agent).map(s=>({...s,agent:s.agent,state:s.state==='working'?'doing':s.state})),...(['planning','reviewing'].includes(j.state)?[{agent:j.agent,state:'doing'}]:[]),...(j.state==='working'?(j.runs||[]).filter(r=>r.role==='lead'&&r.state==='working'&&r.agent&&!(j.runs||[]).some(x=>x.role==='specialist'&&x.state==='working'&&x.dept===r.dept)).map(r=>({agent:r.agent,state:'doing'})):[])]);},
    projectActivity:()=>projectUI.activity(),openProjects:()=>projectUI.open(),agentActivity:id=>activityByAgent.get(id),job:id=>jobs.find(j=>j.id===id),jobs:()=>jobs,tick:noop,panelWidth:()=>panel.offsetWidth,onFocusChange:key=>{ /* the composer keeps the Program Manager until the owner picks a team */ },rowHTML,
    isLive:()=>true,isOpen:()=>dialog.open,open:()=>{open('board','Office work');content.innerHTML=jobs.map(j=>`<button class="space-note" data-job="${j.id}"><b>${esc(j.title)}</b><span>${labels[j.state]} · ${esc(DEPTS[j.dept]?.name || j.teamName || j.dept)}</span></button>`).join('')||'<p>No tasks yet.</p>';content.querySelectorAll('[data-job]').forEach(b=>b.onclick=()=>showTask(b.dataset.job));},
    toggle(){dialog.open?close():this.open();},close,openFor(){this.open();},openTask:showTask,refresh,renderAgent,railFor:id=>{agentOpen=id;acknowledgeAgent(id);const el=$('mRt');if(el)el.hidden=true;if(chat.agent!==id){chat.agent=id;chat.refs=[];chat.kind='question';chat.remember='';}closePicker();renderChatBar();},syncPills:noop,
    onStuck:noop,onResolve:noop,pendingReject:()=>false,rejectLive:noop,resolveLive:noop,revise:()=>false,addTask:()=>null,routines:[],
    handleChat:async(id,text)=>{const match=text.match(/^\s*(?:add\s+(?:a\s+)?task|task|todo)\s*:\s*(.+)$/is);if(match){try{const job=await api('/tasks','POST',{dept:R[id].a.dept,text:match[1]});await refresh();return `Task received by the team lead: ${job.title}. Open Work to follow the plan and verification.`;}catch(error){return error.message;}}return null;},
  };
}
