// The Manage area as a full page, routed by the address bar (#/settings/<section>). While it is open the 3D office is
// hidden and paused, so scrolling here never moves the camera. A grouped rail on the left, one sheet per area on the
// right; every area speaks the same status vocabulary (status.js), files its errors in a banner and its confirmations
// in a toast, and tells the truth about what is saved in one save bar.
import { DEPTS } from './data.js';
import { renderDocument } from './task-output.js';
import { flowSVG } from './milestone-flow.js';
import { readyMilestones, tasksOf, milestoneState } from '../milestones.mjs';
import { stateLabel } from './labels.js';
import { fileIcon } from './fileicon.js';
import { toast } from './toast.js';
import { mark, dot, clock, ago, toolState, officeSummary, dropSummary } from './status.js';
import { MANAGE_CSS } from './manage.css.js';
import { searchAgency } from './agency-search.js';
import { HOSTED, USER, LIMITS, MANAGED_MODELS, PLATFORM_ONLY, isOfficeAdmin, canOpenArea } from './session.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const when = value => value ? new Date(value).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const lines = value => String(value || '').split('\n').map(s => s.trim()).filter(Boolean);
const duration = ms => ms == null ? '—' : ms < 60000 ? Math.round(ms / 1000) + 's' : ms < 3600000 ? Math.round(ms / 60000) + ' min' : (ms / 3600000).toFixed(1) + ' h';
const initials = name => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const SECTIONS = [
  ['profile', 'Profile', 'Administration', 'The company the office works for: its name, and the purpose every planner reads before work.', 'settings'],
  ['office', 'Office settings', 'Administration', 'How the whole office runs. Choices for one team live under Teams & people.', 'settings'],
  ['teams', 'Teams & people', 'People', 'Who is on each team, what they do, and the standing instructions they start every task from. A team is a lead and up to six specialists.', 'office'],
  ['models', 'Models & keys', 'Services', 'Save a provider key, activate the models the office may use, and pick who runs on what. Keys stay on the server and are never shown again.', 'providers'],
  ['tools', 'Tools & connectors', 'Services', 'The outside services the office connects to itself. A connection is separate from permission: sign in here, then choose which teams may use it.', 'tools'],
  ['vault', 'Vault', 'Services', 'Outside-service keys, database connections and SSH targets. Agents never see a secret: the office injects it and the audit log records every use.', 'vault'],
  ['skills', 'Skills', 'Knowledge', 'How a kind of work is done: the steps, the shape of the result and the rules. Tasks keep the skill version they started with.', 'office'],
  ['projects', 'Projects', 'People', 'The big pieces of work: a charter, owning teams, milestones and the Brain folder each one keeps.', ''],
  ['artifacts', 'Office Artifacts', 'Knowledge', 'Everything the teams have produced, newest first. Download a file, or open the task it came from.', ''],
  ['routines', 'Routines', 'People', 'Tasks the office starts on its own clock, run through the team lead like any other. Anything that sends, posts or pays waits for you regardless.', 'routines'],
  ['reports', 'Reports & KPIs', 'Knowledge', 'What the office did, by team and by person, with every figure linked to the tasks behind it.', ''],
  ['brain', 'Brain', 'Knowledge', 'The company’s shared knowledge. Every agent searches it before and during work and cites what it used.', 'brain'],
  ['audit', 'Audit log', 'Administration', 'Every change made through the office, by you or by an agent, with what it was before. Nothing here can be edited.', ''],
  ['users', 'Users & groups', 'Administration', 'The people who sign in to this office, their roles, and the groups you share tasks and projects with. Groups are people, not AI teams.', 'users'],
  ['admin', 'Platform', 'Administration', 'What every office on this platform inherits: the model providers and keys, the limits, who may register, and the offices themselves.', ''],
];
const RESUME = 'ao.settings.resume';
// The rail follows the viewer: a member sees no Tools, Vault, Office settings or Audit; hosted offices have no Models page (the platform's admin panel has it).
const RAIL = [['People', ['teams', 'projects', 'routines']], ['Knowledge', ['brain', 'skills', 'artifacts', 'reports']], ['Services', ['models', 'tools', 'vault']], ['Administration', ['profile', 'users', 'office', 'audit', 'admin']]].map(([g, ids]) => [g, ids.filter(canOpenArea)]).filter(([, ids]) => ids.length);
const readFile = file => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = reject; r.readAsDataURL(file); });
const SEARCH_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

export function initSettings({ api, openTask, brain, syncBrain, onShow, onHide }) {
  if (!document.getElementById('manageStyles')) { const style = document.createElement('style'); style.id = 'manageStyles'; style.textContent = MANAGE_CSS; document.head.appendChild(style); }
  const page = document.createElement('section');
  page.id = 'settingsPage'; page.className = 'mg'; page.hidden = true; page.setAttribute('aria-label', 'Manage');
  const label = id => SECTIONS.find(s => s[0] === id)[1];
  page.innerHTML = `<nav class="mg-rail" aria-label="Manage sections"><a href="#" class="mg-back" id="settingsBack">${PLATFORM_ONLY ? 'Sign out' : '← Back to the office'}</a>
      ${RAIL.map(([group, ids]) => `<span class="mg-eyebrow">${group}</span>${ids.map(id => `<a href="#/settings/${id}" data-section="${id}">${label(id)}<span class="mg-meta" data-rail-meta="${id}"></span></a>`).join('')}`).join('')}
      <div class="mg-rail-office" id="settingsRailOffice"></div></nav>
    <div class="settings-main"><div class="mg-area-head"><div><span class="mg-eyebrow" id="settingsGroup"></span><h1 id="settingsTitle"></h1><p id="settingsIntro"></p></div><div class="mg-area-meta" id="settingsMeta"></div></div><p id="settingsMessage" role="status"></p><div id="settingsContent"></div></div>`;
  document.body.appendChild(page);
  const $ = id => document.getElementById(id), content = $('settingsContent'), main = page.querySelector('.settings-main');
  let section = null, dirty = false, config = null, tools = [], providers = { models: [] }, draft = null, team = null, teamSection = 'overview', reportDays = 7, pendingNote = null, pendingProject = null, projectTab = 'work', projectArt = { kind: '', q: '' }, projectWorkFilter = 'all', projectListTab = 'active', projectListQuery = '', toolPoll = null, statusPoll = null, statusTries = 0, metaStatus = '';

  /* ---------- feedback: a failure stays on the page and in a toast; a success is a toast ---------- */
  const feedback = (text, error = false, extra = {}) => {
    const m = $('settingsMessage'); m.textContent = error ? text : ''; m.classList.toggle('error', !!(error && text));
    if (text) toast(text, { kind: error ? 'error' : (extra.kind || 'ok'), detail: extra.detail, action: extra.action });
    if (error && text) main.scrollTop = 0;
  };
  const clearError = () => { const m = $('settingsMessage'); m.textContent = ''; m.classList.remove('error'); };
  const setMeta = (status, lastChange = '') => { metaStatus = status; $('settingsMeta').innerHTML = `${status}${lastChange ? `<span>${lastChange}</span>` : ''}`; };
  async function refreshMeta(next = section, status = metaStatus) {
    const area = SECTIONS.find(s => s[0] === next)?.[4]; let last = '';
    if (area) { try { const rows = await api(`/audit?limit=1&area=${area}`); if (rows[0]) last = `last change ${when(rows[0].at)} · ${esc(rows[0].actor === 'ceo' ? 'you' : rows[0].actor || 'office')}`; } catch {} }
    if (section === next) setMeta(status, last);
  }
  async function refreshRail() {
    if (PLATFORM_ONLY) { $('settingsRailOffice').innerHTML = `<b>Platform</b>${esc(USER?.email || '')}<br>${dot('ok')} platform administrator`; return; }
    try {
      const s = await officeSummary(api);
      for (const [id, a] of Object.entries(s.areas)) { const el = page.querySelector(`[data-rail-meta="${id}"]`); if (el) el.innerHTML = `${a.dot ? dot(a.dot) : ''}${a.count != null && a.count !== '' ? `<span>${Number(a.count).toLocaleString()}</span>` : ''}`; }
      $('settingsRailOffice').innerHTML = `<b>${esc(s.name || 'Your office')}</b>${s.ready ? '' : 'no model ready<br>'}${s.attention.length ? `${dot(s.attention.some(x => x.kind === 'fail') ? 'fail' : 'warn')} ${s.attention.length} need${s.attention.length === 1 ? 's' : ''} you` : `${dot('ok')} nothing needs you`}`;
    } catch {}
  }

  /* ---------- the save bar: the one place that always tells the truth about what is saved ---------- */
  const saveBar = ({ hint = '', label: text = 'Save changes', extra = '', id = '' } = {}) => `<div class="mg-savebar" data-state="${dirty ? 'dirty' : 'idle'}" data-hint="${esc(hint)}" ${id ? `id="${id}"` : ''}><span class="mg-st mg-st-warn" data-mark><i></i>Not saved</span><div class="mg-savemsg" data-msg>${dirty ? 'Changes not saved' : esc(hint)}${dirty && hint ? `<small>${esc(hint)}</small>` : ''}</div><span class="mg-spacer"></span>${extra}<button type="submit" class="mg-btn mg-btn-primary" data-save>${esc(text)}</button></div>`;
  function setBar(bar, state, text, sub = '') {
    if (!bar) return; bar.dataset.state = state;
    const m = bar.querySelector('[data-mark]'); m.className = 'mg-st mg-st-' + { dirty: 'warn', saving: 'busy', saved: 'ok', failed: 'fail', idle: 'off' }[state]; m.innerHTML = '<i></i>' + { dirty: 'Not saved', saving: 'Saving', saved: 'Saved', failed: 'Refused', idle: '' }[state];
    bar.querySelector('[data-msg]').innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : '');
    const b = bar.querySelector('[data-save]'); if (b) { b.disabled = state === 'saving'; b.innerHTML = state === 'saving' ? '<span class="mg-spin"></span>Saving' : state === 'failed' ? 'Try again' : b.dataset.label || 'Save changes'; }
  }
  const barOf = el => el?.closest?.('form')?.querySelector('.mg-savebar') || el?.querySelector?.('.mg-savebar') || null;
  // Runs a save: the bar says Saving, then Saved with the time, or Refused with the server's sentence. The toast repeats it.
  async function runSave(bar, fn, { ok = 'Saved', sub = 'New work uses these settings. Running tasks finish on what they started with.' } = {}) {
    setBar(bar, 'saving', 'Saving…'); clearError();
    try { const r = await fn(); dirty = false; setBar(bar, 'saved', `Saved at ${clock(Date.now())}`, sub); toast(ok, { kind: 'ok', detail: sub }); dropSummary(); refreshRail(); refreshMeta(section, mark('ok', 'Saved')); return r; }
    catch (error) { setBar(bar, 'failed', 'Not saved: ' + error.message, 'Fix it and save again.'); feedback(error.message, true); throw error; }
  }
  content.addEventListener('input', event => {
    const form = event.target.closest('form[data-dirty]'); if (!form || event.target.closest('.agency-picker')) return;
    dirty = true; const bar = barOf(form); if (bar && bar.dataset.state !== 'saving') setBar(bar, 'dirty', 'Changes not saved', bar.dataset.hint || '');
    const field = event.target.closest('.mg-field, .mg-control'); if (field && 'defaultValue' in event.target && event.target.type !== 'checkbox') field.classList.toggle('changed', event.target.value !== event.target.defaultValue);
  });
  page.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape' && !PLATFORM_ONLY && !event.target.closest('input,textarea,select')) close(); });
  $('settingsBack').onclick = async event => { event.preventDefault(); if (PLATFORM_ONLY) { try { await api('/auth/logout', 'POST', {}); } catch {} location.replace(location.pathname); return; } close(); };
  const RENDER = { profile: showProfile, office: showOffice, teams: showTeams, models: showModels, tools: showTools, vault: showVault, skills: showSkills, projects: showProjects, artifacts: showArtifacts, routines: showRoutines, reports: showReports, brain: showBrain, audit: showAudit, users: showUsers, admin: showAdmin };

  function route() {
    const match = location.hash.match(/^#\/settings(?:\/([\w-]+))?/);
    if (!match) { if (!page.hidden) hide(); return; }
    const next = PLATFORM_ONLY ? 'admin' : RENDER[match[1]] && canOpenArea(match[1]) ? match[1] : canOpenArea('office') ? 'office' : 'profile';
    if (dirty && section && next !== section && !confirm('You have unsaved changes. Leave this page without saving them?')) { history.replaceState(null, '', '#/settings/' + section); return; }
    show(next);
  }
  function show(next) {
    dirty = false; section = next; stopPoll();
    if (page.hidden) { page.hidden = false; document.body.dataset.view = 'settings'; onShow?.(); }
    page.querySelectorAll('[data-section]').forEach(a => a.dataset.section === next ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
    const s = SECTIONS.find(x => x[0] === next); $('settingsGroup').textContent = s[2]; $('settingsTitle').textContent = s[1]; $('settingsIntro').textContent = s[3];
    clearError(); setMeta(''); content.innerHTML = '<p class="mg-intro">Loading…</p>'; content.classList.remove('mg-readonly'); main.scrollTop = 0;
    refreshRail(); RENDER[next]();
  }
  function hide() { page.hidden = true; delete document.body.dataset.view; section = null; dirty = false; stopPoll(); onHide?.(); }
  function open(next = 'office') { const hash = '#/settings/' + next; if (location.hash === hash) route(); else location.hash = hash; }
  function close() {
    if (dirty && !confirm('You have unsaved changes. Leave settings without saving them?')) return;
    dirty = false; history.pushState(null, '', location.pathname + location.search); hide();
  }
  function stopPoll() { if (toolPoll) { clearInterval(toolPoll); toolPoll = null; } if (statusPoll) { clearTimeout(statusPoll); statusPoll = null; } }
  addEventListener('hashchange', route);
  window.addEventListener('office:open', event => { if (event.detail === 'models' || event.detail === 'profile') open(event.detail); });
  const saved = message => { dirty = false; feedback(message); };
  const field = (labelText, control, help = '') => `<label class="mg-field"><span>${labelText}</span>${control}${help ? `<small>${help}</small>` : ''}</label>`;
  const check = (control, text, help = '') => `<label class="mg-check">${control}<span>${text}${help ? `<small> ${help}</small>` : ''}</span></label>`;
  const search = (id, placeholder, value = '', type = 'search') => `<div class="mg-search">${SEARCH_ICON}<input id="${id}" type="${type}" placeholder="${esc(placeholder)}" value="${esc(value)}" aria-label="${esc(placeholder)}"></div>`;
  const empty = (title, text) => `<div class="mg-card" style="text-align:center;padding:36px 22px"><h3>${title}</h3><p style="margin:0">${text}</p></div>`;
  const banner = (kind, html, actions = '') => `<div class="mg-banner mg-banner-${kind}"><span class="mg-glyph">${{ fail: '✕', warn: '!', ok: '✓', info: 'i' }[kind]}</span><div>${html}</div>${actions ? `<div class="mg-actions">${actions}</div>` : ''}</div>`;

  /* ---------- Profile: the company's name and purpose (and, hosted, your own account) ---------- */
  // Email intake (hosted): the address that turns mail into tasks, who may write to it, and a test message.
  function mailCard(mail) {
    if (!mail) return '';
    const senders = mail.senders || [];
    return `<div class="mg-card" id="mailCard"><div class="mg-card-head"><h3>Email intake</h3><span class="mg-count">${mail.enabled ? (mail.address ? 'mail to this address becomes a task' : 'no mail domain configured yet') : 'not configured on this platform'}</span></div>
      ${mail.address ? `<div class="mg-grid">${field('Your office address', `<div class="mg-toolbar" style="margin:0"><code id="mailAlias" style="user-select:all;word-break:break-all;flex:1">${esc(mail.address)}</code><button type="button" class="mg-btn mg-btn-sm" id="mailCopy">Copy</button><button type="button" class="mg-btn mg-btn-sm" id="mailRotate" title="A new random part: the old address stops working">New address</button></div>`, 'The Program Manager takes what you send here as a task: the subject is the title, the body the brief, attachments the task’s files. A question is answered on the same thread. Reply to a receipt to add a note to that task.')}
        ${field('Who may write to it', `<div>${senders.map(x => `<div class="mg-toolbar" style="margin:0 0 6px"><span style="flex:1">${esc(x.address)} ${x.verifiedAt ? mark('ok', 'Verified') : x.pending ? mark('warn', 'Code sent') : mark('off', 'Code expired')}</span>${x.verifiedAt ? '' : `<input data-code="${esc(x.id)}" inputmode="numeric" maxlength="6" placeholder="6-digit code" style="width:110px"><button type="button" class="mg-btn mg-btn-sm" data-verify="${esc(x.id)}">Verify</button>`}<button type="button" class="mg-btn mg-btn-sm mg-btn-danger" data-remove-sender="${esc(x.id)}">Remove</button></div>`).join('')}
          <form id="senderForm" class="mg-toolbar" style="margin:6px 0 0"><input name="address" type="email" required placeholder="you@your-other-mail.com" style="flex:1;min-width:200px"><button type="submit" class="mg-btn mg-btn-sm">Add sender</button></form></div>`, `Your account email (${esc(USER.email)}) always may. Any other address gets a six-digit code by mail and works once you enter it here. Mail from anyone else is dropped silently.`)}
        ${field('Mail me', `<select id="mailPref"><option value="mine" ${mail.prefs.notifyByEmail === 'mine' ? 'selected' : ''}>Results and questions of the tasks I emailed</option><option value="all" ${mail.prefs.notifyByEmail === 'all' ? 'selected' : ''}>Results and questions of all my tasks</option><option value="none" ${mail.prefs.notifyByEmail === 'none' ? 'selected' : ''}>Nothing — I use the office</option></select>`, 'Approvals always happen in the office; a mail tells you one is waiting.')}</div>
        <div class="mg-toolbar" style="margin:12px 0 0"><button type="button" class="mg-btn" id="mailTest">Send yourself a test</button><span class="mg-muted">A private task’s record, thread and files stay private; its approved result is still filed in the shared Brain, which every agent in the office reads.</span></div>` : '<p class="mg-intro">The platform has not set a mail domain (AO_MAIL_DOMAIN), so there is no address to write to yet.</p>'}</div>`;
  }
  function bindMail(mail) {
    if (!mail || !$('mailCard')) return;
    $('mailCopy')?.addEventListener('click', () => navigator.clipboard?.writeText(mail.address).then(() => toast('Address copied', { kind: 'ok' })).catch(() => {}));
    $('mailRotate')?.addEventListener('click', async () => { if (!confirm('Give yourself a new address? Mail to the old one stops arriving.')) return; try { await api('/mail/alias/rotate', 'POST', {}); await showProfile(); } catch (error) { feedback(error.message, true); } });
    $('mailTest')?.addEventListener('click', async () => { try { const r = await api('/mail/test', 'POST', {}); toast(r.dryRun ? 'Test written to the outbox (dry run)' : `Test sent to ${r.to}`, { kind: 'ok' }); } catch (error) { feedback(error.message, true); } });
    $('mailPref')?.addEventListener('change', async () => { try { await api('/auth/prefs', 'PUT', { notifyByEmail: $('mailPref').value }); toast('Saved', { kind: 'ok' }); } catch (error) { feedback(error.message, true); } });
    $('senderForm')?.addEventListener('submit', async event => { event.preventDefault(); try { const r = await api('/mail/senders', 'POST', { address: event.target.elements.address.value.trim() }); toast(r.sent ? `Code sent to ${r.address}` : 'Sender added; the code could not be mailed', { kind: r.sent ? 'ok' : 'error' }); await showProfile(); } catch (error) { feedback(error.message, true); } });
    content.querySelectorAll('[data-verify]').forEach(b => b.onclick = async () => { const code = content.querySelector(`[data-code="${b.dataset.verify}"]`)?.value.trim(); try { await api(`/mail/senders/${b.dataset.verify}/verify`, 'POST', { code }); toast('Sender verified', { kind: 'ok' }); await showProfile(); } catch (error) { feedback(error.message, true); } });
    content.querySelectorAll('[data-remove-sender]').forEach(b => b.onclick = async () => { try { await api('/mail/senders/' + b.dataset.removeSender, 'DELETE'); await showProfile(); } catch (error) { feedback(error.message, true); } });
  }
  function bindAccount() {
    const form = $('setAccount'); if (!form) return;
    form.onsubmit = async event => {
      event.preventDefault(); const name = form.elements.name.value.trim(), current = form.elements.current.value, next = form.elements.next.value;
      try {
        if (name && name !== USER.name) await api('/auth/prefs', 'PUT', { name });
        if (next) { if (!current) throw new Error('Enter your current password to change it.'); await api('/auth/password', 'POST', { current, next }); }
        feedback('Account saved.'); if (name !== USER.name) setTimeout(() => location.reload(), 600); form.elements.current.value = form.elements.next.value = '';
      } catch (error) { feedback(error.message, true); }
    };
  }
  const PURPOSE_ID = 'Knowledge/office-purpose.md';
  async function showProfile() {
    try {
      const [s, health, note] = await Promise.all([api('/settings'), api('/health'), api('/knowledge/note?id=' + encodeURIComponent(PURPOSE_ID)).catch(() => null)]);
      const purpose = note ? note.content.replace(/^#\s+.*(?:\r?\n)?/, '').trim() : '';
      const mail = HOSTED ? await api('/mail/profile').catch(() => null) : null;
      const account = HOSTED && USER ? `<div class="mg-card"><div class="mg-card-head"><h3>Your account</h3><span class="mg-count">${esc(USER.email)} · ${esc(USER.role)}</span></div>
        <form id="setAccount" novalidate><div class="mg-grid">${field('Your name', `<input name="name" value="${esc(USER.name)}" maxlength="80" required>`)}${field('Current password', '<input name="current" type="password" autocomplete="current-password">')}${field('New password', '<input name="next" type="password" autocomplete="new-password" minlength="8">', 'Leave both blank to keep your password. Changing it signs out your other devices.')}</div>
        <div class="mg-toolbar" style="margin:0"><button type="submit" class="mg-btn mg-btn-primary">Save account</button></div></form></div>${mailCard(mail)}` : '';
      if (HOSTED && !isOfficeAdmin()) {
        content.innerHTML = account + `<div class="mg-card"><div class="mg-card-head"><h3>The company</h3><span class="mg-count">${esc(s.officeName || health.name || '')}</span></div><p class="mg-intro">${purpose ? esc(purpose).replace(/\n/g, '<br>') : 'The office owner has not written the office purpose yet.'}</p></div>`;
        bindAccount(); bindMail(mail); setMeta(mark('ok', 'Member')); return;
      }
      content.innerHTML = account + `<form id="setProfile" data-dirty novalidate><div class="mg-card"><div class="mg-card-head"><h3>The company</h3><span class="mg-count">shown across the office and told to every agent</span></div>
        <div class="mg-grid">${field('Office name', `<input name="officeName" value="${esc(s.officeName || health.name || '')}" maxlength="80" placeholder="${esc(health.name || 'Your company')}" required>`, 'The company the teams work for. Agents introduce the office by this name.')}</div></div>
        <div class="mg-card"><div class="mg-card-head"><h3>Office purpose</h3><span class="mg-count">read by every planner before work</span></div>
        ${field('The business, who you serve, what the teams should achieve, and the constraints', `<textarea name="purpose" rows="12" placeholder="What the company does, for whom, what good work looks like, and what must never happen.">${esc(purpose)}</textarea>`, 'Kept in the Brain as Knowledge/office-purpose.md. Markdown is fine.')}
        ${saveBar({ hint: 'New work uses the new name and purpose at once.', label: 'Save profile' })}</div></form>`;
      setMeta(purpose ? mark('ok', 'Purpose written') : mark('warn', 'No purpose yet'), note?.updatedAt ? `purpose updated ${esc(when(note.updatedAt))}` : ''); refreshMeta('profile', purpose ? mark('ok', 'Purpose written') : mark('warn', 'No purpose yet'));
      bindAccount(); bindMail(mail);
      $('setProfile').onsubmit = async event => {
        event.preventDefault(); const form = event.target, name = form.elements.officeName.value.trim(), text = form.elements.purpose.value.trim();
        if (!name) { setBar(barOf(form), 'failed', 'Not saved: the office needs a name'); feedback('Give the office a name.', true); form.elements.officeName.focus(); return; }
        try {
          await runSave(barOf(form), async () => { await api('/settings', 'PUT', { officeName: name }); if (text || note) await api('/knowledge', 'POST', { id: PURPOSE_ID, title: 'Office purpose', content: '# Office purpose\n\n' + text, updatedAt: note?.updatedAt }); }, { ok: 'Profile saved', sub: 'The office answers to its new name from now on.' });
          await syncBrain?.(); await showProfile();
        } catch {}
      };
    } catch (error) { feedback(error.message, true); }
  }

  /* ---------- Office ---------- */
  async function showOffice() {
    try {
      const [s, health] = await Promise.all([api('/settings'), api('/health')]);
      const num = (name, text, min, max, step, help, unit) => `<div class="mg-control"><span>${text}</span><small>${help}</small><div class="mg-ctl"><input type="number" name="${name}" min="${min}" max="${max}" step="${step}" value="${esc(s[name])}"><span class="mg-unit">${unit}</span></div><span class="mg-err">Between ${min} and ${max}.</span></div>`;
      content.innerHTML = `<form id="setOffice" data-dirty novalidate><div class="mg-controls">
        ${num('maxConcurrentJobs', 'Tasks running at once', 1, 8, 1, 'Across all teams. Each team also has its own pace; each person their own (Teams & people).', 'tasks')}
        ${check(`<input type="checkbox" class="mg-switch" name="fastLane" ${s.fastLane !== false ? 'checked' : ''}>`, 'Fast lane', 'Quick work (a lookup, a summary, a PDF from a note the Brain holds) is done by the team’s lead alone, in seconds. Off, and every task goes through the Program Manager.')}
        ${check(`<input type="checkbox" class="mg-switch" name="approvals" ${s.approvals !== false ? 'checked' : ''}>`, 'Ask before outside actions', 'Sending, posting, publishing, writing to a database or running a command on a server pause for your approval. Off, and they run at once; every call stays on the task’s record. A team’s completion approval and a routine’s approval are their own settings.')}
        ${num('runTimeoutMinutes', 'Stop a run after this long without progress', 1, 480, 1, 'A run that makes no progress for this long stops and tells you. A long task that keeps working is never stopped by this.', 'min')}
        ${num('escalateAfterHours', 'Remind me again after', 0.25, 72, 0.25, 'When something needs you and you have not acted.', 'h')}
        ${num('knowledgeSeedNotes', 'Brain notes handed to planners', 0, 20, 1, 'Agents can always search the Brain for more.', 'notes')}
        <div class="mg-control"><span>Daily digest time</span><small>The digest lands in your inbox and in the Brain under Digests.</small><div class="mg-ctl"><input type="time" name="digestTime" value="${esc(s.digestTime)}"></div></div>
        <div class="mg-control"><span>Public address</span><small>Used for connector sign-in links. Leave blank to use this page's address.</small><div class="mg-ctl"><input type="url" name="publicOrigin" value="${esc(s.publicOrigin)}" placeholder="https://office.example.com"></div><span class="mg-err">Must start with https:// or http:// and have no path.</span></div>
        </div>${saveBar({ hint: 'New work uses these settings once saved.' })}</form>`;
      setMeta(health.ready ? mark('ok', 'Ready · teams can work') : mark('warn', 'No model ready')); refreshMeta('office', health.ready ? mark('ok', 'Ready · teams can work') : mark('warn', 'No model ready'));
      if (!health.ready) content.insertAdjacentHTML('afterbegin', MANAGED_MODELS ? banner('warn', '<b>No model can run yet.</b> The models are the platform’s: its administrator saves a provider key and activates a model under Platform → Models & keys.') : banner('warn', '<b>No model can run yet.</b> Add a provider key and activate a model before the teams can work.', '<button type="button" class="mg-btn mg-btn-sm" data-go="models">Open Models &amp; keys</button>'));
      content.querySelectorAll('[data-go]').forEach(b => b.onclick = () => open(b.dataset.go));
      $('setOffice').onsubmit = async event => {
        event.preventDefault(); const form = event.target, f = form.elements; let bad = false;
        form.querySelectorAll('.mg-control').forEach(c => { const el = c.querySelector('input'); if (!el) return; const wrong = el.type === 'number' ? (el.value === '' || +el.value < +el.min || +el.value > +el.max) : el.type === 'url' ? (el.value && !/^https?:\/\/[^/\s]+\/?$/.test(el.value.trim())) : false; c.classList.toggle('invalid', wrong); if (wrong) bad = true; });
        if (bad) { setBar(barOf(form), 'failed', 'Not saved: one field needs attention', 'Fix the field marked in red and save again.'); feedback('One field needs attention before this can be saved.', true); form.querySelector('.invalid input')?.focus(); return; }
        try { await runSave(barOf(form), () => api('/settings', 'PUT', { maxConcurrentJobs: +f.maxConcurrentJobs.value, runTimeoutMinutes: +f.runTimeoutMinutes.value, escalateAfterHours: +f.escalateAfterHours.value, knowledgeSeedNotes: +f.knowledgeSeedNotes.value, digestTime: f.digestTime.value, publicOrigin: f.publicOrigin.value.trim().replace(/\/$/, ''), fastLane: f.fastLane.checked, approvals: f.approvals.checked }), { ok: 'Office settings saved', sub: 'New work uses these settings.' }); form.querySelectorAll('input').forEach(el => { el.defaultValue = el.value; }); form.querySelectorAll('.changed').forEach(c => c.classList.remove('changed')); } catch {}
      };
    } catch (error) { feedback(error.message, true); }
  }

  /* ---------- Teams & people ---------- */
  async function showTeams() {
    try {
      [config, tools, providers] = await Promise.all([api('/office'), api('/tools').catch(() => []), MANAGED_MODELS ? Promise.resolve({ models: [] }) : api('/providers').catch(() => ({ models: [] }))]); draft = structuredClone(config);
      let resume = null; try { resume = JSON.parse(sessionStorage.getItem(RESUME) || 'null'); sessionStorage.removeItem(RESUME); } catch {}
      if (resume?.team && draft.teams.some(t => t.id === resume.team)) { team = resume.team; teamSection = resume.section || teamSection; }
      if (!draft.teams.some(t => t.id === team)) team = draft.teams[0].id;
      setMeta(isOfficeAdmin() ? mark('ok', 'Saved') : mark('off', 'Read-only')); refreshMeta('teams', mark('ok', 'Saved'));
      renderTeam(); content.classList.toggle('mg-readonly', !isOfficeAdmin());
      if (!isOfficeAdmin()) content.insertAdjacentHTML('afterbegin', banner('info', '<b>Read-only.</b> Only the office owner or an admin changes teams and people. You can see who does what and the instructions they work from.'));
      if (resume?.hire) $('spaceAddAgent')?.click();
    } catch (error) { feedback(error.message, true); }
  }
  const toolChoices = (selected, prefix) => tools.filter(t => t.type !== 'candidate').map(t => check(`<input type="checkbox" class="mg-switch" data-${prefix}="${esc(t.id)}" ${selected.includes(t.id) ? 'checked' : ''}>`, esc(t.name), esc(t.origin || t.type))).join('');
  const skillChoices = (selected = [], prefix) => draft.skills.map(skill => check(`<input type="checkbox" class="mg-switch" data-${prefix}="${esc(skill.id)}" ${selected.includes(skill.id) ? 'checked' : ''}>`, esc(skill.name), `v${skill.revision}`)).join('');
  const ruleList = (rules, attr) => rules.length ? `<div class="mg-ledger-wrap"><table class="mg-ledger mg-rules"><tbody>${rules.map((r, i) => `<tr><td>${esc(r.text)}</td><td class="k mg-muted">${r.task ? `from “${esc(r.task)}”` : 'added by you'}${r.at ? ' · ' + esc(when(r.at)) : ''}</td><td class="r"><button type="button" class="space-text-action" data-${attr}="${i}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="mg-intro">No standing rules yet. Tick “remember” when you correct work, or add one here.</p>';
  function collectTeam() {
    const form = $('spaceTeamForm'); if (!form) return;
    const t = draft.teams.find(x => x.id === team);
    for (const name of ['name', 'lead', 'purpose', 'instructions']) t[name] = form.elements[name].value;
    t.models = { lead: form.elements.modelLead.value, specialist: form.elements.modelSpecialist.value, review: form.elements.modelReview.value };
    for (const name of ['maxParallelRuns', 'maxReworkRounds']) t[name] = Number(form.elements[name].value);
    t.guardrails = lines(form.elements.guardrails.value); t.skills = [...form.querySelectorAll('[data-teamskill]:checked')].map(el => el.dataset.teamskill);
    t.completionApproval = form.elements.completionApproval.checked; delete t.requireHumanApproval; t.criteria = lines(form.elements.criteria.value);
    t.checks = [...form.querySelectorAll('[data-check-editor]')].map(field => {
      const type = field.querySelector('[data-check-type]').value, value = field.querySelector('[data-check-value]').value;
      return { type, label: field.querySelector('[data-check-label]').value, value: type.includes('length') ? Number(value) : value };
    });
    t.tools = [...form.querySelectorAll('[data-teamtool]:checked')].map(el => el.dataset.teamtool);
    form.querySelectorAll('[data-agent-editor]').forEach(fieldset => {
      const a = draft.agents.find(x => x.id === fieldset.dataset.agentEditor);
      for (const name of ['name', 'role', 'does', 'brief', 'model', 'effort', 'concurrency']) a[name] = fieldset.querySelector(`[data-field="${name}"]`).value;
      a.skills = [...fieldset.querySelectorAll('[data-agentskill]:checked')].map(el => el.dataset.agentskill);
      a.inheritTools = fieldset.querySelector('[data-field="inheritTools"]').checked;
      a.tools = [...fieldset.querySelectorAll('[data-agenttool]:checked')].map(el => el.dataset.agenttool);
    });
    t.tests = [...form.querySelectorAll('[data-test-editor]')].map(field => ({ id: field.dataset.testEditor, name: field.querySelector('[data-test-name]').value, prompt: field.querySelector('[data-test-prompt]').value, requiredText: lines(field.querySelector('[data-test-required]').value) }));
  }
  function renderTeam() {
    const t = draft.teams.find(x => x.id === team), agents = draft.agents.filter(a => a.department === t.id);
    t.rules ||= [];
    const modelName = id => providers.models.find(m => m.id === id)?.label || id;
    const models = (selected, inherit = 'Use the role default') => `<option value="">${inherit}</option>` + providers.models.filter(m => m.enabled !== false).map(m => `<option value="${esc(m.id)}" ${m.id === selected ? 'selected' : ''}>${esc(m.label || m.id)}</option>`).join('');
    const openAgents = [...content.querySelectorAll('[data-agent-editor][open]')].map(el => el.dataset.agentEditor);
    const unsaved = !config.teams.some(x => x.id === t.id); if (unsaved) teamSection = 'overview';
    const lead = agents.find(a => a.id === t.lead), ruleCount = t.rules.length + agents.reduce((n, a) => n + (a.rules?.length || 0), 0);
    const teamTools = tools.filter(x => x.type !== 'candidate' && t.tools.includes(x.id)).length;
    const person = a => { const own = a.inheritTools === false ? a.tools.length : teamTools + a.tools.filter(id => !t.tools.includes(id)).length; return `<details class="mg-fold mg-person" data-agent-editor="${a.id}" ${openAgents.includes(a.id) ? 'open' : ''}><summary><span class="mg-avatar ${a.id === t.lead ? 'lead' : ''}">${esc(initials(a.name))}</span><span class="mg-who"><b>${esc(a.name)}</b><span>${esc(a.role || '')}${a.id === t.lead ? ' · leads the team' : ''}</span></span><span class="mg-facts"><span class="mg-chip">${esc(a.model ? modelName(a.model) : 'team model')}</span><span class="mg-chip">${own} tool${own === 1 ? '' : 's'}</span><span class="mg-chip">${a.skills?.length || 0} skill${a.skills?.length === 1 ? '' : 's'}</span></span><span class="mg-open">Edit</span><span class="mg-does ${a.does ? '' : 'mg-missing'}">${esc(a.does || 'No job description yet. Open to write one, or draft it with AI.')}</span></summary>
      <div class="mg-fold-body">
        <div class="mg-grid">${field('Name', `<input data-field="name" value="${esc(a.name)}" required>`)}${field('Role', `<input data-field="role" value="${esc(a.role)}" required placeholder="Client Email Agent">`)}</div>
        <div class="mg-toolbar" style="margin:16px 0 6px"><span class="mg-eyebrow">The job</span><span class="mg-spacer"></span><button type="button" class="mg-assist" data-assist="person" data-agent="${a.id}">✦ Draft with AI</button></div>
        ${field('What they do', `<textarea data-field="does" required rows="3" placeholder="What this person does, and does not do.">${esc(a.does)}</textarea>`, 'Read before every assignment.')}
        ${field('Standing instructions', `<textarea data-field="brief" required rows="5" placeholder="How you want this person to work: sources, tone, boundaries, when to stop and ask.">${esc(a.brief)}</textarea>`, 'Up to 2,000 characters. Steps and templates belong in a skill.')}
        <span class="mg-eyebrow" style="display:block;margin:16px 0 8px">Model</span><div class="mg-grid">${field('Model for this person', `<select data-field="model">${models(a.model, 'Use the team or role default')}</select>`)}${field('Effort', `<select data-field="effort">${['', 'low', 'medium', 'high', 'xhigh', 'max'].map(e => `<option value="${e}" ${e === (a.effort || '') ? 'selected' : ''}>${e || 'Role default'}</option>`).join('')}</select>`)}${field('At once', `<input type="number" data-field="concurrency" min="1" max="8" step="1" value="${a.concurrency || 4}">`, 'How many things this person may work on at the same time, across tasks.')}</div>
        <span class="mg-eyebrow" style="display:block;margin:16px 0 8px">Skills</span><div class="mg-picks">${skillChoices(a.skills, 'agentskill') || '<span class="mg-muted">No skills in the library yet.</span>'}</div>
        <span class="mg-eyebrow" style="display:block;margin:16px 0 8px">Tools</span>${check(`<input type="checkbox" class="mg-switch" data-field="inheritTools" ${a.inheritTools !== false ? 'checked' : ''}>`, 'Use the team’s tools', 'Switch off to limit this person to the tools ticked below.')}<div class="mg-picks">${toolChoices(a.tools, 'agenttool') || '<span class="mg-muted">No connectors yet.</span>'}</div>
        <div class="mg-toolbar" style="margin:12px 0 0"><span class="mg-muted">Changes apply when the team is saved.</span><span class="mg-spacer"></span><button class="mg-btn mg-btn-sm mg-btn-danger" type="button" data-remove-agent="${a.id}">Remove person</button></div>
      </div></details>`; };
    content.innerHTML = `<div class="mg-team-strip" role="tablist">${draft.teams.map(x => { const n = draft.agents.filter(a => a.department === x.id); return `<button type="button" class="mg-team-tab" role="tab" data-team="${x.id}" aria-selected="${x.id === t.id}"><b>${esc(x.name)}</b><small>${n.length} people · ${esc(n.find(a => a.id === x.lead)?.name || 'no lead')}</small></button>`; }).join('')}<button type="button" class="mg-team-tab mg-add" id="spaceAddTeam">+ Add team</button></div>
      <div class="mg-team-head"><h2>${esc(t.name)}</h2><span class="mg-lead">Led by <b>${esc(lead?.name || 'nobody yet')}</b> · ${t.maxParallelRuns} at once · ${t.maxReworkRounds} rework rounds · ${t.completionApproval ? mark('warn', 'Asks your OK to close') : mark('off', 'Closes on the lead’s approval')}</span><div class="mg-actions"><button type="button" class="mg-btn mg-btn-sm mg-btn-danger" id="spaceRemoveTeam">${unsaved ? 'Discard' : 'Remove team'}</button></div></div>
      <nav class="mg-subnav" role="tablist" aria-label="Team pages">${[['overview', 'Charter', ''], ['people', 'People', agents.length], ['rules', 'Standing rules', ruleCount], ['access', 'Tools & skills', teamTools + t.skills.length], ['quality', 'Review', t.checks.length || ''], ...(MANAGED_MODELS ? [] : [['execution', 'Models & pace', '']]), ['tests', 'Tests', t.tests.length || '']].map(([id, text, n]) => `<button type="button" class="mg-tab" data-settings-section="${id}" aria-pressed="${teamSection === id}" ${unsaved && id !== 'overview' ? 'disabled title="Create the team first"' : ''}>${text}${n !== '' ? `<span class="mg-n">${n}</span>` : ''}</button>`).join('')}</nav>
      <form id="spaceTeamForm" data-dirty novalidate>
      <section data-settings-page="overview">${unsaved ? banner('info', '<b>This team does not exist yet.</b> Name it, write its charter or draft it with AI, then press Create team. People, rules, tools and tests open once it exists.') : ''}<div class="mg-card"><div class="mg-card-head"><h3>Charter</h3><span class="mg-count">read before every assignment</span><button type="button" class="mg-assist" data-assist="team" style="margin-left:auto">✦ Draft with AI</button></div><div class="mg-grid">${field('Team name', `<input name="name" value="${esc(t.name)}" required>`)}${field('Accountable lead', `<select name="lead">${agents.map(a => `<option value="${a.id}" ${a.id === t.lead ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`, 'Reviews every result against the criteria before it is filed in the Brain.')}</div>
      <div style="margin-top:14px">${field('Purpose', `<textarea name="purpose" rows="2" required placeholder="What does this team own, and what does success look like?">${esc(t.purpose)}</textarea>`, 'What this team owns and what a good result looks like. Read before every assignment.')}${field('Working instructions', `<textarea name="instructions" rows="6" required placeholder="Process, tone, source requirements and boundaries for this team.">${esc(t.instructions)}</textarea>`, 'Process, tone, sources and boundaries. Steps with a template belong in a skill instead.')}</div></div></section>
      <section data-settings-page="people"><div id="spaceAgencyPicker" hidden></div>${agents.map(person).join('')}<div class="mg-toolbar" style="margin-top:14px"><button type="button" class="mg-btn mg-btn-primary" id="spaceAddAgent" ${agents.length >= LIMITS.maxMembersPerTeam ? 'disabled' : ''}>+ Add agent</button><span class="mg-muted">${agents.length >= LIMITS.maxMembersPerTeam ? `This team is full: a lead and ${LIMITS.maxMembersPerTeam - 1} specialists.` : `Room for ${LIMITS.maxMembersPerTeam - agents.length} more on this team.`}</span></div>
      <div class="mg-modal" id="spaceAddAgentModal" hidden role="dialog" aria-modal="true" aria-label="Add an agent"><div class="mg-modal-box">
        <div class="mg-modal-head"><h3>Add an agent to ${esc(t.name)}</h3><button type="button" class="mg-modal-x" data-add-close aria-label="Close">✕</button></div>
        <div class="mg-choices">
          <button type="button" class="mg-choice" data-add="agency" ${unsaved ? 'disabled' : ''}><b>Hire from the Agency</b><span>Pick a ready-made specialist from the Agency catalogue, searchable by job, skill or tool. They arrive with a role, a job description, standing instructions and their method as a skill.</span>${unsaved ? '<em>Create the team first.</em>' : '<em>Recommended</em>'}</button>
          <button type="button" class="mg-choice" data-add="blank"><b>Create from scratch</b><span>A blank seat you write yourself: the name, the role, what they do and how you want them to work. AI can draft the job for you.</span></button>
        </div></div></div></section>
      <section data-settings-page="rules"><div class="mg-card"><h3>Whole team</h3><p>Your own words, kept as you wrote them. Every task for this team starts from them.</p>${ruleList(t.rules, 'remove-team-rule')}<div class="mg-toolbar" style="margin:14px 0 0"><div class="mg-search" style="flex:1">${SEARCH_ICON}<input id="spaceNewTeamRule" maxlength="300" placeholder="Add a rule, e.g. Always quote prices in USD"></div><button type="button" class="mg-btn" id="spaceAddTeamRule">Add rule</button></div></div>
        ${agents.filter(a => a.rules?.length).map(a => `<div class="mg-card"><h3>${esc(a.name)}</h3><p>Rules for this person only.</p>${ruleList(a.rules || [], 'remove-agent-rule-' + a.id)}</div>`).join('')}</section>
      <section data-settings-page="quality"><div class="mg-card"><h3>What the lead checks</h3><p>Guardrails are hard stops; criteria are the bar.</p><div class="mg-grid">${field('Guardrails — one per line', `<textarea name="guardrails" rows="4" placeholder="Boundaries the lead must check before approving work.">${esc(t.guardrails.join('\n'))}</textarea>`)}${field('Lead’s review criteria — one per line', `<textarea name="criteria" rows="4">${esc(t.criteria.join('\n'))}</textarea>`)}</div>
      ${check(`<input type="checkbox" class="mg-switch" name="completionApproval" ${t.completionApproval ? 'checked' : ''}>`, 'Ask me before a finished task is closed', 'Actions that send, post, pay or change things outside the office always ask you first.')}</div>
      <div class="mg-card"><h3>Automated acceptance checks</h3><p>These must pass even when the lead approves. Text matching ignores case.</p>
      <div id="spaceCheckEditors">${t.checks.map((c, i) => `<details class="mg-fold" data-check-editor="${i}"><summary>${esc(c.label || 'Acceptance check')}<small>${esc({ contains: 'must contain', not_contains: 'must not contain', min_length: 'at least', max_length: 'at most' }[c.type] || c.type)} ${esc(String(c.value ?? ''))}</small><span class="mg-open">Edit</span></summary><div class="mg-fold-body">${field('Name', `<input data-check-label value="${esc(c.label)}" maxlength="160" required>`)}<div class="mg-grid">${field('Rule', `<select data-check-type>${[['contains', 'Must contain'], ['not_contains', 'Must not contain'], ['min_length', 'Minimum characters'], ['max_length', 'Maximum characters']].map(([type, text]) => `<option value="${type}" ${c.type === type ? 'selected' : ''}>${text}</option>`).join('')}</select>`)}${field('Value', `<input data-check-value value="${esc(c.value)}" ${c.type.includes('length') ? 'type="number" min="1" max="100000" step="1"' : 'maxlength="1000"'} required>`)}</div><button type="button" class="mg-btn mg-btn-sm mg-btn-danger" data-remove-check="${i}">Remove check</button></div></details>`).join('') || '<p class="mg-intro">No checks yet.</p>'}</div><button type="button" class="mg-btn" id="spaceAddCheck">+ Add check</button></div></section>
      <section data-settings-page="execution"><div class="mg-card"><h3>Models &amp; pace</h3><p>Which model each role on this team runs on, and how much the team does at once. A person’s own model wins over the team’s.</p><div class="mg-grid">${field('Lead', `<select name="modelLead">${models(t.models?.lead)}</select>`)}${field('Specialists', `<select name="modelSpecialist">${models(t.models?.specialist)}</select>`)}${field('Reviews', `<select name="modelReview">${models(t.models?.review)}</select>`)}
      ${field('Specialists working at once', `<input type="number" name="maxParallelRuns" min="1" max="4" value="${t.maxParallelRuns}">`, '1 to 4.')}${field('Rework rounds before it needs you', `<input type="number" name="maxReworkRounds" min="0" max="5" value="${t.maxReworkRounds}">`, '0 to 5.')}</div></div></section>
      <section data-settings-page="access"><div class="mg-card"><h3>Shared skills</h3><p>Methods every person on this team may use.</p><div class="mg-picks">${skillChoices(t.skills, 'teamskill') || '<span class="mg-muted">Create reusable instructions under Skills.</span>'}</div></div>
      <div class="mg-card"><h3>Team tools</h3><p>A person inherits the team’s tools and can be limited or extended on their own card. The lead is told who has what.</p><div class="mg-picks">${toolChoices(t.tools, 'teamtool') || '<span class="mg-muted">Add connectors under Tools &amp; connectors.</span>'}</div></div></section>
      <section data-settings-page="tests"><div class="mg-card"><h3>Team tests</h3><p>Run the whole plan, work and review process against known inputs. Tests run without external tools.</p>
      <div id="spaceTestEditors">${t.tests.map(test => `<details class="mg-fold" data-test-editor="${esc(test.id)}"><summary>${esc(test.name || 'New test')}<small>${test.requiredText.length} required phrase${test.requiredText.length === 1 ? '' : 's'}</small><span class="mg-open">Edit</span></summary><div class="mg-fold-body">${field('Name', `<input data-test-name value="${esc(test.name)}" required>`)}${field('Task and supplied facts', `<textarea data-test-prompt rows="3" required>${esc(test.prompt)}</textarea>`)}${field('Required text — one per line', `<textarea data-test-required rows="2">${esc(test.requiredText.join('\n'))}</textarea>`)}<div class="mg-toolbar" style="margin:0"><button type="button" class="mg-btn mg-btn-sm" data-run-test="${esc(test.id)}">Run saved test</button><button type="button" class="mg-btn mg-btn-sm mg-btn-danger" data-remove-test="${esc(test.id)}">Remove test</button></div></div></details>`).join('') || '<p class="mg-intro">No tests yet.</p>'}</div>
      <div class="mg-toolbar" style="margin:0"><button type="button" class="mg-btn" id="spaceAddTest">+ Add test</button><button type="button" class="mg-btn" id="spaceRunTests" ${t.tests.length ? '' : 'disabled'}>Run all saved tests</button></div></div></section>
      ${saveBar({ hint: unsaved ? 'The office adds a pod for the new team when you create it.' : 'New tasks keep using the last saved version until you save.', label: unsaved ? 'Create team' : 'Save changes' })}</form>`;
    const rerender = () => { collectTeam(); dirty = true; renderTeam(); };
    content.querySelectorAll('[data-settings-page]').forEach(el => el.hidden = el.dataset.settingsPage !== teamSection);
    content.querySelectorAll('[data-settings-section]').forEach(b => b.onclick = () => { collectTeam(); teamSection = b.dataset.settingsSection; renderTeam(); });
    $('spaceAddTeam').onclick = () => {
      collectTeam(); if (draft.teams.length >= 10) return feedback('An office supports up to 10 teams.', true);
      const id = 'team-' + crypto.randomUUID().slice(0, 8), lead = id + '-lead', template = structuredClone(config.teams[0]);
      draft.teams.push({ ...template, id, name: 'New team', lead, purpose: '', instructions: '', guardrails: [], tools: [], skills: [], tests: [], checks: [], rules: [], models: {} });
      draft.agents.push({ id: lead, department: id, name: 'Team lead', role: 'Team lead', does: 'Plans the team’s work, delegates each part to the right specialist and reviews every result against the team’s criteria before it is filed.', brief: 'Read the Brain before planning. Delegate only to people on this team; hand anything outside its field to the Program Manager. Approve nothing that lacks a source.', model: '', effort: '', tools: [], skills: [], rules: [], inheritTools: true }, { id: id + '-specialist', department: id, name: 'Specialist', role: 'Specialist', does: 'Carries out the assignments the lead hands over in this team’s field and returns finished, checkable work.', brief: 'Follow the team’s working instructions. Cite the Brain notes you use. Stop and ask the lead rather than guess.', model: '', effort: '', tools: [], skills: [], rules: [], inheritTools: true });
      team = id; teamSection = 'overview'; dirty = true; renderTeam(); toast('New team staged', { kind: 'info', detail: 'Name it and write its charter, or draft it with AI. Hiring from the Agency saves it for you.' }); content.querySelector('[name=name]')?.select();
    };
    $('spaceRemoveTeam').onclick = () => {
      collectTeam(); if (draft.teams.length <= 1) return feedback('Keep at least one team.', true);
      if (!config.teams.some(x => x.id === t.id)) { draft.teams = draft.teams.filter(x => x.id !== t.id); draft.agents = draft.agents.filter(a => a.department !== t.id); team = draft.teams[0].id; dirty = draft.teams.length !== config.teams.length; renderTeam(); toast('New team discarded', { kind: 'info' }); return; }
      if (!confirm(`Remove ${t.name} and its people when you save? Past tasks and the Brain are kept. Unfinished work must be finished or cancelled first.`)) return;
      draft.teams = draft.teams.filter(x => x.id !== t.id); draft.agents = draft.agents.filter(a => a.department !== t.id); team = draft.teams[0].id; dirty = true; renderTeam(); toast('Removal staged', { kind: 'warn', detail: 'Save to apply it.' });
    };
    content.querySelectorAll('[data-team]').forEach(b => b.onclick = () => { collectTeam(); team = b.dataset.team; renderTeam(); });
    $('spaceAddTeamRule').onclick = () => { const text = $('spaceNewTeamRule').value.trim(); if (!text) return; collectTeam(); t.rules.push({ text, at: Date.now(), task: '' }); dirty = true; renderTeam(); };
    $('spaceNewTeamRule').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('spaceAddTeamRule').click(); } });
    content.querySelectorAll('[data-remove-team-rule]').forEach(b => b.onclick = () => { collectTeam(); t.rules.splice(+b.dataset.removeTeamRule, 1); dirty = true; renderTeam(); });
    for (const a of agents) content.querySelectorAll(`[data-remove-agent-rule-${a.id}]`).forEach(b => b.onclick = () => { collectTeam(); a.rules.splice(+b.getAttribute(`data-remove-agent-rule-${a.id}`), 1); dirty = true; renderTeam(); });
    $('spaceAddCheck').onclick = () => { collectTeam(); if (t.checks.length >= 20) return feedback('A team supports up to 20 checks.', true); t.checks.push({ type: 'contains', label: 'New acceptance check', value: '' }); dirty = true; renderTeam(); $('spaceCheckEditors').lastElementChild.open = true; };
    content.querySelectorAll('[data-remove-check]').forEach(b => b.onclick = () => { collectTeam(); t.checks.splice(Number(b.dataset.removeCheck), 1); rerender(); });
    content.querySelectorAll('[data-check-type]').forEach(select => select.onchange = () => { const input = select.closest('[data-check-editor]').querySelector('[data-check-value]'); input.type = select.value.includes('length') ? 'number' : 'text'; });
    async function hireFromAgency() {
      collectTeam();
      if (!config.teams.some(x => x.id === t.id)) { // not saved yet: the Agency can only hire into a team the office knows
        if (!t.name.trim() || t.name === 'New team' || !t.purpose.trim() || !t.instructions.trim()) { teamSection = 'overview'; renderTeam(); toast('Name the team and write its charter first', { kind: 'warn', detail: 'Or press Draft with AI. Hiring saves the team for you.' }); content.querySelector(t.purpose.trim() ? '[name=instructions]' : '[name=purpose]')?.focus(); return; }
        try { sessionStorage.setItem(RESUME, JSON.stringify({ team: t.id, section: 'people', hire: true })); await runSave(barOf($('spaceTeamForm')), async () => { config = await api('/office', 'PUT', draft); draft = structuredClone(config); }, { ok: 'Team saved', sub: 'The office is adding its pod. The Agency opens when it is back.' }); setTimeout(() => location.reload(), 600); } catch { sessionStorage.removeItem(RESUME); }
        return;
      }
      agencyPicker($('spaceAgencyPicker'), { mode: 'hire', dept: t.id, full: agents.length >= 7, onDone: async () => { dirty = false; await showTeams(); teamSection = 'people'; renderTeam(); } });
      $('spaceAgencyPicker').scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    content.querySelectorAll('[data-assist]').forEach(b => b.onclick = async () => {
      collectTeam(); const form = $('spaceTeamForm'); b.disabled = true; const was = b.textContent; b.innerHTML = '<span class="mg-spin"></span>Drafting…';
      try {
        if (b.dataset.assist === 'team') {
          if ((t.purpose.trim() || t.instructions.trim()) && !confirm('Replace the purpose and working instructions with a fresh draft?')) return;
          const r = await api('/assist', 'POST', { kind: 'team-charter', name: form.elements.name.value, hint: form.elements.purpose.value });
          form.elements.purpose.value = r.purpose; form.elements.instructions.value = r.instructions;
        } else {
          const box = b.closest('[data-agent-editor]'), get = n => box.querySelector(`[data-field="${n}"]`);
          if ((get('does').value.trim() || get('brief').value.trim()) && !confirm('Replace this person’s job description and standing instructions with a fresh draft?')) return;
          const r = await api('/assist', 'POST', { kind: 'person', name: get('name').value, role: get('role').value, teamName: form.elements.name.value, teamPurpose: form.elements.purpose.value });
          get('does').value = r.does; get('brief').value = r.brief;
        }
        dirty = true; setBar(barOf(form), 'dirty', 'Changes not saved', 'Read the draft, change what you like, then save.'); toast('Draft written', { kind: 'ok', detail: 'Read it, change what you like, then save.' });
      } catch (error) { feedback(error.message, true); }
      finally { b.disabled = false; b.textContent = was; }
    });
    const addModal = $('spaceAddAgentModal'), closeAdd = () => { addModal.hidden = true; $('spaceAddAgent')?.focus(); };
    $('spaceAddAgent').onclick = () => { collectTeam(); if (agents.length >= 7) return feedback('A team is a lead and up to six specialists.', true); addModal.hidden = false; addModal.querySelector('.mg-choice:not(:disabled)').focus(); };
    addModal.addEventListener('click', event => {
      if (event.target === addModal || event.target.closest('[data-add-close]')) return closeAdd();
      const choice = event.target.closest('[data-add]'); if (!choice) return;
      closeAdd();
      if (choice.dataset.add === 'agency') return hireFromAgency();
      const id = 'agent-' + crypto.randomUUID().slice(0, 8);
      draft.agents.push({ id, department: t.id, name: 'New agent', role: 'Specialist', does: '', brief: '', model: '', effort: '', tools: [], skills: [], rules: [], inheritTools: true });
      dirty = true; renderTeam();
      const box = content.querySelector(`[data-agent-editor="${id}"]`); box.open = true; box.scrollIntoView({ block: 'center', behavior: 'smooth' }); box.querySelector('[data-field="name"]').select();
    });
    addModal.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); closeAdd(); } });
    content.querySelectorAll('[data-remove-agent]').forEach(b => b.onclick = () => {
      collectTeam(); if (agents.length <= 2) return feedback('Keep a lead and at least one specialist.', true);
      draft.agents = draft.agents.filter(a => a.id !== b.dataset.removeAgent);
      if (t.lead === b.dataset.removeAgent) t.lead = draft.agents.find(a => a.department === t.id).id;
      dirty = true; renderTeam();
    });
    $('spaceTeamForm').onsubmit = async event => {
      event.preventDefault(); collectTeam(); const bar = barOf(event.target);
      try {
        const layoutChanged = JSON.stringify(config.agents.map(a => [a.id, a.department, a.name])) !== JSON.stringify(draft.agents.map(a => [a.id, a.department, a.name])) || JSON.stringify(config.teams.map(x => [x.id, x.name])) !== JSON.stringify(draft.teams.map(x => [x.id, x.name]));
        await runSave(bar, async () => { config = await api('/office', 'PUT', draft); draft = structuredClone(config); }, { ok: 'Team saved', sub: layoutChanged ? 'The office layout is being updated.' : 'New tasks for this team start from the saved version.' });
        if (layoutChanged) { sessionStorage.setItem(RESUME, JSON.stringify({ team, section: teamSection })); setTimeout(() => location.reload(), 600); } else renderTeam();
      } catch {}
    };
    $('spaceAddTest').onclick = () => { collectTeam(); if (t.tests.length >= 12) return feedback('A team supports up to 12 tests.', true); t.tests.push({ id: 'test-' + crypto.randomUUID().slice(0, 8), name: 'New test', prompt: '', requiredText: [] }); dirty = true; renderTeam(); $('spaceTestEditors').lastElementChild.open = true; };
    content.querySelectorAll('[data-remove-test]').forEach(b => b.onclick = () => { collectTeam(); t.tests = t.tests.filter(x => x.id !== b.dataset.removeTest); rerender(); });
    const testSaved = () => { collectTeam(); if (dirty) { feedback('Save the team changes before running tests.', true); return false; } return true; };
    content.querySelectorAll('[data-run-test]').forEach(b => b.onclick = async () => { if (!testSaved()) return; b.disabled = true; try { const job = await api(`/teams/${t.id}/test`, 'POST', { testId: b.dataset.runTest }); openTask(job.id); } catch (error) { feedback(error.message, true); b.disabled = false; } });
    $('spaceRunTests').onclick = async event => { if (!testSaved()) return; event.target.disabled = true; try { const suite = await api(`/teams/${t.id}/tests`, 'POST', {}); toast(`${suite.jobs.length} tests queued`, { kind: 'info', detail: 'Results appear under Reports & KPIs.', action: { label: 'Open reports', onClick: () => open('reports') } }); } catch (error) { feedback(error.message, true); event.target.disabled = false; } };
  }

  /* ---------- Models & keys ---------- */
  // Nothing is built in: a provider gets a key, its model list is fetched from the provider, and the owner activates the ones the office may use.
  const ROLES = [['office', 'Office default'], ['pm', 'Program Manager'], ['lead', 'Team leads'], ['specialist', 'Specialists'], ['review', 'Reviews'], ['chat', 'Chat with people']];
  let modelLists = {}, testResults = {};
  async function showModels(base = '/providers', target = content) {
    try {
      const reg = await api(base), active = structuredClone(reg.models), roles = { ...reg.roleDefaults };
      const providerName = id => reg.providers.find(p => p.id === id)?.label || id;
      const keyState = p => !p.hasKey ? mark('warn', 'Not set') : testResults[p.id]?.ok === false ? mark('fail', 'Key rejected') : testResults[p.id]?.ok ? mark('ok', `Connected · ${(testResults[p.id].ms / 1000).toFixed(1)} s`) : p.enabled === false ? mark('off', 'Disabled') : mark('ok', 'Key stored');
      const without = reg.providers.filter(p => !p.hasKey && p.enabled !== false);
      target.innerHTML = `${reg.ready ? '' : banner('warn', '<b>No model can run yet.</b> Save a provider key, then activate a model from that provider’s list and choose the office default.')}
        ${without.length && reg.ready ? banner('warn', `<b>${without.map(p => esc(p.label)).join(', ')} ${without.length === 1 ? 'has' : 'have'} no key.</b> Tasks cannot fall back to ${without.length === 1 ? 'it' : 'them'} until a key is saved.`) : ''}
        <form id="spaceKeysForm" data-dirty><div class="mg-card"><div class="mg-card-head"><h3>Providers</h3><span class="mg-count">${reg.providers.length} configured · ${reg.providers.filter(p => p.hasKey).length} keyed</span></div>
        <div class="mg-ledger-wrap"><table class="mg-ledger"><thead><tr><th>Provider</th><th>Key</th><th>State</th><th>Models</th><th class="r">Enabled</th><th class="r"></th></tr></thead><tbody>${reg.providers.map(p => `<tr data-provider="${esc(p.id)}"><td><span class="mg-name">${esc(p.label)}</span><span class="mg-sub">${esc(p.type === 'openai-compatible' ? (p.baseURL || 'OpenAI-compatible endpoint') : p.type)}</span>${p.type === 'openai-compatible' ? `<input data-field="baseURL" value="${esc(p.baseURL || '')}" placeholder="https://host/v1" aria-label="Base URL" style="margin-top:6px;width:100%;border:1px solid var(--mg-line2);border-radius:6px;padding:6px 8px;background:var(--mg-card);color:var(--ink);font:12px var(--mg-mono)">` : ''}</td>
          <td class="mg-key"><input data-field="apiKey" type="password" autocomplete="off" placeholder="${p.hasKey ? (p.keySource === 'env' ? 'From the server environment' : 'Stored · paste to replace') : 'Paste the key'}" aria-label="${esc(p.label)} API key" style="width:220px;max-width:100%;border:1px solid var(--mg-line2);border-radius:6px;padding:7px 9px;background:var(--mg-card);color:var(--ink);font:12px var(--mg-mono)">${p.hasKey && p.keySource === 'file' ? `<label class="mg-check" style="margin:6px 0 0;font-size:11px"><input type="checkbox" data-field="clearKey"> Remove the stored key</label>` : ''}</td>
          <td data-key-state="${esc(p.id)}">${keyState(p)}${testResults[p.id]?.error ? `<span class="mg-sub">${esc(testResults[p.id].error)}</span>` : ''}</td>
          <td>${active.filter(m => m.provider === p.id).length} active${roles.office && active.find(m => m.id === roles.office)?.provider === p.id ? ' <span class="mg-chip">office default</span>' : ''}</td>
          <td class="r"><input type="checkbox" class="mg-switch" data-field="enabled" ${p.enabled !== false ? 'checked' : ''} aria-label="Enabled"></td>
          <td class="r"><button type="button" class="mg-btn mg-btn-sm" data-test-provider="${esc(p.id)}" ${p.hasKey ? '' : 'disabled title="Paste a key first"'}>Test</button></td></tr>`).join('')}</tbody></table></div>
        ${saveBar({ hint: 'Keys are stored on the server and never shown again.', label: 'Save keys' })}</div></form>
        <div class="mg-card"><div class="mg-card-head"><h3>Activated models</h3><span class="mg-count">${active.length} active</span></div><p>Models come from each provider’s own list. Activate the ones the office may use.</p><div id="spaceModelsBox"></div></div>
        <div class="mg-card"><div class="mg-card-head"><h3>Who runs on what</h3><span class="mg-count">a team or a person can override these on their own page</span></div><div class="mg-grid" id="spaceRolesBox"></div>
        <div class="mg-savebar" data-state="idle" data-hint="Running tasks finish on the model they started with." id="spaceModelsBar"><span class="mg-st mg-st-warn" data-mark><i></i>Not saved</span><div class="mg-savemsg" data-msg>${reg.ready ? 'Ready: the teams can work.' : 'Activate a model and choose the office default to start work.'}</div><span class="mg-spacer"></span><button type="button" class="mg-btn mg-btn-primary" id="spaceSaveModels" data-save data-label="Save models and roles">Save models and roles</button></div></div>`;
      setMeta(reg.ready ? mark('ok', 'Ready · teams can work') : mark('warn', 'Not ready')); refreshMeta('models', reg.ready ? mark('ok', 'Ready · teams can work') : mark('warn', 'Not ready'));
      const box = $('spaceModelsBox'), modelsBar = $('spaceModelsBar');
      const collectKeys = () => reg.providers.map(({ hasKey, keySource, usable, ...p }) => { const f = content.querySelector(`[data-provider="${p.id}"]`), fieldOf = name => f.querySelector(`[data-field="${name}"]`); return { ...p, apiKey: fieldOf('apiKey').value, enabled: fieldOf('enabled').checked, clearKey: !!fieldOf('clearKey')?.checked, ...(fieldOf('baseURL') ? { baseURL: fieldOf('baseURL').value } : {}) }; });
      const save = async () => { await api(base, 'PUT', { providers: collectKeys(), models: active, roleDefaults: roles, roleEfforts: reg.roleEfforts, embeddings: reg.embeddings }); dirty = false; };
      // Test connection is only offered once there is a key: stored, or typed just now (it is saved first).
      content.querySelectorAll('[data-field="apiKey"]').forEach(input => input.addEventListener('input', () => { const p = reg.providers.find(x => x.id === input.closest('[data-provider]').dataset.provider), b = content.querySelector(`[data-test-provider="${p.id}"]`); b.disabled = !(p.hasKey || input.value.trim()); b.title = b.disabled ? 'Paste a key first' : ''; }));
      content.querySelectorAll('[data-test-provider]').forEach(button => button.onclick = async () => {
        const id = button.dataset.testProvider, cell = content.querySelector(`[data-key-state="${id}"]`); button.disabled = true; button.innerHTML = '<span class="mg-spin"></span>Testing'; cell.innerHTML = mark('busy', 'Testing…');
        try {
          if (content.querySelector(`[data-provider="${id}"] [data-field="apiKey"]`).value.trim()) { await save(); dropSummary(); }
          const r = await api(`${base}/${id}/test`, 'POST', {}); testResults[id] = r;
          if (!r.ok) { cell.innerHTML = mark('fail', 'Key rejected') + `<span class="mg-sub">${esc(r.error || '')}</span>`; toast(`${providerName(id)}: key rejected`, { kind: 'error', detail: r.error || 'The provider refused the key. Replace it and test again.' }); }
          else { cell.innerHTML = mark('ok', r.ms ? `Connected · ${(r.ms / 1000).toFixed(1)} s` : 'Connected'); toast(`${providerName(id)}: connected`, { kind: 'ok', detail: r.model ? `Answered in ${r.ms} ms using ${r.model}.` : `${r.models} models available.` }); if (content.querySelector(`[data-provider="${id}"] [data-field="apiKey"]`).value.trim()) await showModels(base, target); }
        } catch (error) { testResults[id] = { ok: false, error: error.message }; cell.innerHTML = mark('fail', 'Failed') + `<span class="mg-sub">${esc(error.message)}</span>`; feedback(`${providerName(id)}: ${error.message}`, true); }
        finally { if (button.isConnected) { button.disabled = false; button.textContent = 'Test'; } }
      });
      $('spaceKeysForm').onsubmit = async event => { event.preventDefault(); try { await runSave(barOf(event.target), save, { ok: 'Keys saved', sub: 'Stored on the server. Test the connection to be sure.' }); await showModels(base, target); } catch {} };
      const touched = () => { dirty = true; setBar(modelsBar, 'dirty', 'Changes not saved', 'Running tasks finish on the model they started with.'); };
      const renderRoles = () => {
        const options = (selected, blank) => `<option value="">${blank}</option>` + active.filter(m => m.enabled !== false).map(m => `<option value="${esc(m.id)}" ${m.id === selected ? 'selected' : ''}>${esc(m.label || m.id)} · ${esc(providerName(m.provider))}</option>`).join('');
        $('spaceRolesBox').innerHTML = active.length ? ROLES.map(([role, text]) => field(text, `<select data-role="${role}">${options(roles[role], role === 'office' ? 'Choose a model' : 'Use the office default')}</select>`, role === 'office' ? 'Used wherever nothing more specific is set.' : '')).join('') : '<p class="mg-intro">Activate a model first.</p>';
        content.querySelectorAll('[data-role]').forEach(sel => sel.onchange = () => { roles[sel.dataset.role] = sel.value; touched(); });
      };
      const renderModels = () => {
        const withKey = reg.providers.filter(p => p.usable);
        box.innerHTML = withKey.length ? withKey.map(p => { const mine = active.filter(m => m.provider === p.id), list = modelLists[p.id];
          return `<div data-models="${esc(p.id)}" style="margin:0 0 18px"><div class="mg-toolbar" style="margin-bottom:10px"><b>${esc(p.label)}</b><span class="mg-count">${list ? (Array.isArray(list) ? `${list.length} models offered` : '') : 'loading the model list…'}</span>${list?.error ? mark('fail', 'List not loaded') : ''}<span class="mg-spacer"></span><div class="mg-search" style="min-width:300px">${SEARCH_ICON}<input list="spaceList-${esc(p.id)}" data-pick="${esc(p.id)}" placeholder="${Array.isArray(list) ? 'Type to search the provider’s models' : list?.error ? 'Type the model id (the list could not be loaded)' : 'Loading…'}" autocomplete="off" aria-label="Add a model"><datalist id="spaceList-${esc(p.id)}">${(Array.isArray(list) ? list : []).map(m => `<option value="${esc(m.id)}">${esc(m.label !== m.id ? m.label : '')}</option>`).join('')}</datalist></div><button type="button" class="mg-btn" data-activate="${esc(p.id)}">Activate</button></div>${list?.error ? `<p class="mg-intro">${esc(list.error)}</p>` : ''}
            ${mine.length ? `<div class="mg-ledger-wrap"><table class="mg-ledger"><thead><tr><th>Model</th><th>Supports</th><th>Used by</th><th class="r"></th></tr></thead><tbody>${mine.map(m => { const uses = ROLES.filter(([r]) => roles[r] === m.id).map(([, t]) => t); return `<tr><td><span class="mg-name">${esc(m.label || m.id)}</span><span class="mg-sub">${esc(m.id)}</span></td><td><div class="mg-chips">${['tools', 'reasoning', 'effort'].filter(k => m.supports?.[k]).map(k => `<span class="mg-chip">${k}</span>`).join('') || '<span class="mg-muted">—</span>'}</div></td><td>${uses.length ? uses.map(esc).join(', ') : '<span class="mg-muted">—</span>'}</td><td class="r"><button type="button" class="space-text-action" data-deactivate="${esc(m.id)}">Remove</button></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="mg-intro">No models activated from this provider yet.</p>'}</div>`; }).join('')
          : '<p class="mg-intro">Add and save a provider key first; the models come from the provider.</p>';
        box.querySelectorAll('[data-activate]').forEach(b => b.onclick = () => {
          const pid = b.dataset.activate, input = box.querySelector(`[data-pick="${pid}"]`), id = input.value.trim(); if (!id) return feedback('Type or pick a model id first.', true);
          if (active.some(m => m.id === id)) return feedback('That model is already active.', true);
          const found = (Array.isArray(modelLists[pid]) ? modelLists[pid] : []).find(m => m.id === id);
          active.push({ id, provider: pid, label: found?.label || id, supports: found?.supports || { effort: false, reasoning: false } }); if (!roles.office) roles.office = id; touched(); renderModels(); renderRoles();
          if (!found) toast(`“${id}” is not in ${providerName(pid)}’s list`, { kind: 'warn', detail: 'It is activated as typed. Save to keep it.' });
        });
        box.querySelectorAll('[data-pick]').forEach(input => input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); box.querySelector(`[data-activate="${input.dataset.pick}"]`).click(); } }));
        box.querySelectorAll('[data-deactivate]').forEach(b => b.onclick = () => { const id = b.dataset.deactivate; active.splice(active.findIndex(m => m.id === id), 1); for (const r of Object.keys(roles)) if (roles[r] === id) roles[r] = ''; touched(); renderModels(); renderRoles(); });
      };
      renderModels(); renderRoles();
      for (const p of reg.providers.filter(p => p.usable && !modelLists[p.id])) api(`${base}/${p.id}/models`).then(list => { modelLists[p.id] = list; if (section === 'models') renderModels(); }).catch(error => { modelLists[p.id] = { error: error.message }; if (section === 'models') { renderModels(); feedback(`${p.label}: ${error.message}`, true); } });
      $('spaceSaveModels').onclick = async () => { if (active.length && !roles.office) { setBar(modelsBar, 'failed', 'Not saved: choose the office default model'); return feedback('Choose the office default model.', true); } try { await runSave(modelsBar, save, { ok: 'Models and roles saved', sub: 'New work uses these models.' }); await showModels(base, target); } catch {} };
    } catch (error) { feedback(error.message, true); }
  }

  /* ---------- Tools & connectors ---------- */
  async function showTools(editing = null) {
    try { [tools, config] = await Promise.all([api('/tools'), api('/office')]); statusTries = 0; renderTools(editing); } catch (error) { feedback(error.message, true); }
  }
  function renderTools(editing = null) {
    const own = tools.filter(t => t.type !== 'candidate'), found = tools.filter(t => t.type === 'candidate');
    const kindOf = t => t.type === 'builtin' ? 'built in' : t.type === 'stdio' ? 'MCP · local command' : `MCP · ${t.type === 'sse' ? 'SSE' : 'remote'}`;
    const states = own.map(t => ({ t, s: toolState(t) })), failed = states.filter(x => x.s.kind === 'fail'), out = states.filter(x => x.s.kind === 'warn');
    const accessCell = t => t.assignedTeams?.length ? `<div class="mg-chips">${t.assignedTeams.map(a => `<span class="mg-chip mg-chip-ink" title="${a.whole === false && a.people?.length ? esc(a.people.join(', ')) + ' only' : ''}">${esc(a.name)}${a.whole === false && a.people?.length ? ' · ' + a.people.length : ''}</span>`).join('')}</div>` : `<span class="mg-muted">${t.status === 'connected' ? 'no team yet' : '—'}</span>`;
    setMeta(failed.length ? mark('fail', `${failed.length} failed`) : out.length ? mark('warn', `${out.length} signed out`) : own.length ? mark('ok', 'All connected') : mark('off', 'No connectors')); refreshMeta('tools', $('settingsMeta').firstElementChild?.outerHTML || '');
    content.innerHTML = `${failed.map(x => banner('fail', `<b>${esc(x.t.name)}: ${esc(x.s.label.toLowerCase())}.</b> ${esc(x.s.hint)}`, ['http', 'sse'].includes(x.t.type) ? `<button type="button" class="mg-btn mg-btn-sm mg-btn-primary" data-tool-login="${x.t.id}">Sign in again</button>` : `<button type="button" class="mg-btn mg-btn-sm" data-tool-edit="${x.t.id}">Edit connection</button>`)).join('')}
      <div class="mg-toolbar"><span class="mg-count">${own.length} connector${own.length === 1 ? '' : 's'}</span><span class="mg-spacer"></span><button class="mg-btn" id="spaceRefreshTools" type="button">Check connections</button><button class="mg-btn" id="spaceToolRules" type="button">Approval rules for actions</button><button id="spaceNewTool" type="button" class="mg-btn mg-btn-primary">+ Add connector</button></div>
      <div class="mg-ledger-wrap"><table class="mg-ledger"><thead><tr><th>Connector</th><th>Kind</th><th>Sign-in</th><th>Teams with access</th><th class="r"></th></tr></thead><tbody>${states.map(({ t, s }) => `<tr><td><span class="mg-name">${esc(t.name)}</span><span class="mg-sub">${esc(t.origin || t.url || t.command || '')}</span></td><td class="k">${kindOf(t)}</td><td>${mark(s.kind, s.label)}${s.hint && s.kind !== 'ok' ? `<span class="mg-sub">${esc(s.hint)}</span>` : t.type !== 'builtin' && t.hasToken && t.auth !== 'signed-in' ? '<span class="mg-sub">uses a stored token</span>' : ''}</td><td>${accessCell(t)}</td><td class="r"><button type="button" data-tool-assign="${t.id}" class="mg-btn mg-btn-sm">Team access</button> ${['http', 'sse'].includes(t.type) ? (t.auth === 'signed-in' ? `<button type="button" data-tool-logout="${t.id}" class="mg-btn mg-btn-sm">Sign out</button>` : `<button type="button" data-tool-login="${t.id}" class="mg-btn mg-btn-sm ${s.kind === 'ok' ? '' : 'mg-btn-primary'}">Sign in</button>`) : ''} ${t.managed ? `<button type="button" data-tool-edit="${t.id}" class="mg-btn mg-btn-sm">Edit</button> <button type="button" data-tool-remove="${t.id}" class="space-text-action">Remove</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="mg-empty">No connectors yet. Add an MCP server, or import one found in Claude Code on this machine.</td></tr>'}</tbody></table></div>
      ${found.length ? `<div class="mg-card"><div class="mg-card-head"><h3>Found in Claude Code on this machine</h3><span class="mg-count">${found.length}</span></div><p>These connectors belong to the Claude Code login, which the office does not use. Import one to connect it here, then sign in.</p><div class="mg-ledger-wrap" style="margin:0"><table class="mg-ledger"><tbody>${found.map(t => `<tr><td><span class="mg-name">${esc(t.name)}</span><span class="mg-sub">${esc(t.target || '')}</span></td><td class="r"><button type="button" class="mg-btn mg-btn-sm" data-tool-import="${t.id}">Import</button></td></tr>`).join('')}</tbody></table></div></div>` : ''}
      <p class="mg-intro" style="margin-top:14px">Any tool that sends, posts, pays, deletes or changes something outside the office waits for your OK and runs once after it.</p>
      <section id="spaceToolEditor" ${editing ? '' : 'hidden'}><form id="spaceToolForm" class="mg-card"><div class="mg-card-head"><h3>${editing ? 'Edit connection' : 'Add an MCP server'}</h3><span class="mg-count">save, sign in if it asks, then give teams access</span></div><div class="mg-grid">${field('Name', `<input name="name" value="${esc(editing?.name || '')}" ${editing ? 'readonly' : ''} required pattern="[A-Za-z][A-Za-z0-9_-]*" placeholder="Slack">`, 'Letters, digits, _ and -.')}${field('Connection type', `<select name="type">${['http', 'sse', 'stdio'].map(type => `<option value="${type}" ${type === editing?.type ? 'selected' : ''}>${type === 'stdio' ? 'Local command' : type.toUpperCase()}</option>`).join('')}</select>`)}</div>
      <div id="spaceRemoteTool">${field('MCP endpoint URL', `<input name="url" type="url" placeholder="https://example.com/mcp" value="${esc(editing?.url || '')}">`)}${field('Bearer token, if the server uses one', `<input name="token" type="password" autocomplete="off" placeholder="${editing?.hasToken ? 'Stored token kept when blank' : 'Optional. OAuth servers use Sign in instead.'}">`)}${check('<input type="checkbox" class="mg-switch" name="clearToken">', 'Remove the stored bearer token')}</div>
      <div id="spaceLocalTool" hidden>${field('Executable', `<input name="command" value="${esc(editing?.command || '')}" placeholder="npx">`)}${field('Arguments — one per line', `<textarea name="args">${esc((editing?.args || []).join('\n'))}</textarea>`)}${field('Environment variables — NAME=value, one per line', `<textarea name="env" placeholder="API_KEY=your-value"></textarea>`, `Existing secret values are kept unless replaced. Stored names: ${esc(editing?.envKeys?.join(', ') || 'none')}.`)}</div>
      <div class="mg-toolbar" style="margin:0"><button type="submit" class="mg-btn mg-btn-primary">${editing ? 'Update connection' : 'Add connection'}</button><button type="button" class="mg-btn" id="spaceCancelTool">Cancel</button></div></form></section>`;
    $('spaceNewTool').onclick = () => { $('spaceToolEditor').hidden = false; $('spaceToolForm').elements.name.focus(); $('spaceToolEditor').scrollIntoView({ block: 'start', behavior: 'smooth' }); };
    $('spaceCancelTool').onclick = () => renderTools();
    content.querySelectorAll('[data-tool-assign]').forEach(b => b.onclick = () => assignTool(b.dataset.toolAssign));
    const form = $('spaceToolForm'), toggle = () => { $('spaceLocalTool').hidden = form.elements.type.value !== 'stdio'; $('spaceRemoteTool').hidden = form.elements.type.value === 'stdio'; }; form.elements.type.onchange = toggle; toggle();
    form.onsubmit = async event => {
      event.preventDefault(); const button = form.querySelector('button[type=submit]'); button.disabled = true; button.innerHTML = '<span class="mg-spin"></span>Saving';
      try { const input = Object.fromEntries(new FormData(form)); input.clearToken = form.elements.clearToken.checked; input.args = lines(input.args); input.env = Object.fromEntries(lines(input.env).map(line => { const i = line.indexOf('='); if (i < 1) throw new Error('Enter environment variables as NAME=value.'); return [line.slice(0, i).trim(), line.slice(i + 1)]; })); await api('/tools', 'POST', input); dropSummary(); await showTools(); toast('Connection saved', { kind: 'ok', detail: 'Sign in if needed, then give teams access.' }); }
      catch (error) { feedback(error.message, true); button.disabled = false; button.textContent = editing ? 'Update connection' : 'Add connection'; }
    };
    $('spaceRefreshTools').onclick = async event => { const b = event.currentTarget; b.disabled = true; b.innerHTML = '<span class="mg-spin"></span>Checking'; try { tools = await api('/tools?refresh=1'); dropSummary(); renderTools(); const bad = tools.filter(t => t.type !== 'candidate').map(toolState).filter(s => s.kind === 'fail').length; toast(bad ? `${bad} connection${bad === 1 ? '' : 's'} failing` : 'All connections checked', { kind: bad ? 'warn' : 'ok', detail: bad ? 'See the banner for what to do.' : `${tools.filter(t => t.type !== 'candidate').length} connectors answered.` }); } catch (error) { feedback(error.message, true); b.disabled = false; b.textContent = 'Check connections'; } };
    $('spaceToolRules').onclick = showToolRules;
    content.querySelectorAll('[data-tool-edit]').forEach(b => b.onclick = () => renderTools(tools.find(t => t.id === b.dataset.toolEdit)));
    content.querySelectorAll('[data-tool-remove]').forEach(b => b.onclick = async () => { if (!confirm('Remove this connector and its team access?')) return; try { await api('/tools/' + b.dataset.toolRemove, 'DELETE'); dropSummary(); await showTools(); toast('Connector removed', { kind: 'ok', detail: 'Its team access is gone with it.' }); } catch (error) { feedback(error.message, true); } });
    content.querySelectorAll('[data-tool-import]').forEach(b => b.onclick = async () => { b.disabled = true; try { await api(`/tools/${b.dataset.toolImport}/import`, 'POST', {}); dropSummary(); await showTools(); toast('Imported', { kind: 'ok', detail: 'Sign in, then give teams access.' }); } catch (error) { feedback(error.message, true); b.disabled = false; } });
    content.querySelectorAll('[data-tool-logout]').forEach(b => b.onclick = async () => { try { await api(`/tools/${b.dataset.toolLogout}/oauth/logout`, 'POST', {}); dropSummary(); await showTools(); toast('Signed out', { kind: 'ok' }); } catch (error) { feedback(error.message, true); } });
    content.querySelectorAll('[data-tool-login]').forEach(b => b.onclick = () => loginTool(b.dataset.toolLogin));
    // While a connector is still connecting, look again shortly. The live event normally arrives first; this covers a stream that is down.
    if (statusPoll) { clearTimeout(statusPoll); statusPoll = null; }
    if (!editing && own.some(t => t.status === 'connecting') && statusTries < 24) statusPoll = setTimeout(async () => { statusPoll = null; statusTries++; if (section !== 'tools' || !$('spaceRefreshTools') || !$('spaceToolEditor')?.hidden) return; try { tools = await api('/tools'); renderTools(); } catch {} }, 2500);
  }
  async function loginTool(id) {
    // Open the window first, synchronously, so the browser does not block it as a pop-up.
    const popup = window.open('about:blank', '_blank'); const name = tools.find(t => t.id === id)?.name || id;
    try {
      const r = await api(`/tools/${id}/oauth/start`, 'POST', {});
      if (r.url) { if (popup) popup.location = r.url; else window.open(r.url, '_blank'); toast(`Finish signing in to ${name} in the new window`, { kind: 'info', detail: 'This page updates when you are done.', ms: 12000 }); }
      else { popup?.close(); toast(r.message || 'Signed in', { kind: 'ok' }); dropSummary(); await showTools(); return; }
      stopPoll(); let tries = 0;
      toolPoll = setInterval(async () => {
        if (++tries > 100 || section !== 'tools') return stopPoll();
        try { const list = await api('/tools'); if (list.find(t => t.id === id)?.auth === 'signed-in') { stopPoll(); tools = list; dropSummary(); renderTools(); toast(`${name}: signed in`, { kind: 'ok', detail: 'Give teams access to start using it.' }); } } catch {}
      }, 3000);
    } catch (error) { popup?.close(); feedback(error.message, true); }
  }
  async function assignTool(id) {
    try {
      config = await api('/office'); const tool = tools.find(t => t.id === id);
      content.innerHTML = `<div class="mg-toolbar"><button type="button" class="mg-btn mg-btn-sm" id="spaceBackTools">← All connectors</button></div><form id="spaceToolAccess" class="mg-card"><div class="mg-card-head"><h3>Team access · ${esc(tool.name)}</h3><span class="mg-count">people in a team can be limited further under Teams &amp; people</span></div><p>Only the teams you switch on can use this connector.</p><div class="mg-picks">${config.teams.map(t => check(`<input type="checkbox" class="mg-switch" value="${t.id}" ${t.tools.includes(id) ? 'checked' : ''}>`, `<b>${esc(t.name)}</b>`, esc(t.purpose || 'Team').slice(0, 120)))}</div><div class="mg-toolbar" style="margin:0"><button type="submit" class="mg-btn mg-btn-primary">Save team access</button></div></form>`;
      $('spaceBackTools').onclick = () => renderTools();
      $('spaceToolAccess').onsubmit = async e => { e.preventDefault(); const selected = [...e.target.querySelectorAll('input:checked')].map(el => el.value); for (const t of config.teams) t.tools = [...t.tools.filter(x => x !== id), ...(selected.includes(t.id) ? [id] : [])]; try { await api('/office', 'PUT', config); dropSummary(); await showTools(); toast('Team access saved', { kind: 'ok', detail: 'Runs already in progress keep the access they started with.' }); } catch (error) { feedback(error.message, true); } };
    } catch (error) { feedback(error.message, true); }
  }
  async function showToolRules() {
    try {
      const [catalog, s] = await Promise.all([api('/tools/catalog'), api('/settings')]);
      const choice = name => s.outboundTools.includes(name) ? 'ask' : s.readOnlyTools.includes(name) ? 'free' : 'default';
      content.innerHTML = `<div class="mg-toolbar"><button type="button" class="mg-btn mg-btn-sm" id="spaceBackTools">← All connectors</button></div><form id="spaceRulesForm" data-dirty><div class="mg-card"><div class="mg-card-head"><h3>Approval rules for actions</h3><span class="mg-count">${catalog.length} tools</span></div><p>Actions that send, post, pay, delete or change things outside the office wait for your approval. The office decides from the tool's own description and name; override it here.</p>
        ${catalog.length ? `<div class="mg-ledger-wrap" style="margin:0"><table class="mg-ledger"><thead><tr><th>Tool</th><th>Office default</th><th>Your rule</th></tr></thead><tbody>${catalog.map(t => `<tr><td><span class="mg-name">${esc(t.name)}</span><span class="mg-sub">${esc(t.description.slice(0, 140))}</span></td><td>${t.outbound ? mark('warn', 'Waits for you') : mark('ok', 'Runs freely')}</td><td><select data-rule="${esc(t.name)}" style="border:1px solid var(--mg-line2);border-radius:6px;padding:6px 8px;background:var(--mg-card);color:var(--ink);font:12px var(--ui)"><option value="default" ${choice(t.name) === 'default' ? 'selected' : ''}>Use the default</option><option value="ask" ${choice(t.name) === 'ask' ? 'selected' : ''}>Always ask me first</option><option value="free" ${choice(t.name) === 'free' ? 'selected' : ''}>Never ask</option></select></td></tr>`).join('')}</tbody></table></div>` : '<p class="mg-intro">No connected tools yet. Sign in to a connector first.</p>'}
        ${saveBar({ hint: 'Applies to the next action a team takes.', label: 'Save rules' })}</div></form>`;
      $('spaceBackTools').onclick = () => renderTools();
      $('spaceRulesForm').onsubmit = async event => {
        event.preventDefault(); const picks = [...content.querySelectorAll('[data-rule]')].map(el => [el.dataset.rule, el.value]);
        const listed = new Set(picks.map(p => p[0]));
        const outboundTools = [...s.outboundTools.filter(n => !listed.has(n)), ...picks.filter(p => p[1] === 'ask').map(p => p[0])];
        const readOnlyTools = [...s.readOnlyTools.filter(n => !listed.has(n)), ...picks.filter(p => p[1] === 'free').map(p => p[0])];
        try { await runSave(barOf(event.target), () => api('/settings', 'PUT', { outboundTools, readOnlyTools }), { ok: 'Approval rules saved', sub: 'Applies to the next action a team takes.' }); await showToolRules(); } catch {}
      };
    } catch (error) { feedback(error.message, true); }
  }

  /* ---------- The Agency: ready-made people and methods ---------- */
  let agencyIndex = null;
  async function agencyPicker(host, { mode, dept = '', full = false, teams = [], onDone }) {
    host.hidden = !host.hidden; host.closest('form')?.classList.toggle('picker-open', !host.hidden); if (host.hidden) return;
    try { agencyIndex ||= await api('/agency'); } catch (error) { return feedback(error.message, true); }
    const divisions = Object.entries(agencyIndex.divisions), counts = agencyIndex.personas.reduce((n, p) => ({ ...n, [p.division]: (n[p.division] || 0) + 1 }), {});
    host.innerHTML = `<div class="agency-picker" role="region" aria-label="${mode === 'hire' ? 'Hire from the Agency' : 'Add a method from the Agency'}">
      <div class="agency-head"><div><b>${mode === 'hire' ? 'Hire from the Agency' : 'Add a method from the Agency'}</b><p>${mode === 'hire' ? 'A ready-made specialist joins this team with a role, standing instructions and their full method as a skill.' : 'A method becomes a skill you can give to teams and people.'} <small>Open-source Agency catalogue, MIT.</small></p></div><button type="button" class="secondary agency-close" id="agencyClose" aria-label="Close">✕</button></div>
      <div class="agency-search"><input type="search" id="agencyQ" placeholder="Search ${agencyIndex.personas.length.toLocaleString('en')} personas by job, skill or tool" aria-label="Search personas"><select id="agencyDivision" aria-label="Division"><option value="">All divisions</option>${divisions.map(([id, text]) => `<option value="${esc(id)}">${esc(text)} (${counts[id] || 0})</option>`).join('')}</select>${mode === 'skill' ? `<select id="agencyTeam" aria-label="Give it to"><option value="">Give it to nobody yet</option>${teams.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select>` : ''}</div>
      ${mode === 'hire' && full ? '<p class="error">This team is full: a lead and six specialists. Remove someone first, or give the lead a new role with “as the lead”.</p>' : ''}
      <p class="agency-count" id="agencyCount" aria-live="polite"></p>
      <div id="agencyList" class="agency-list"></div></div>`;
    $('agencyClose').onclick = () => { host.hidden = true; host.closest('form')?.classList.remove('picker-open'); };
    const list = () => {
      const q = $('agencyQ').value.trim(), division = $('agencyDivision').value;
      const found = searchAgency(agencyIndex.personas, { q, division }), hits = found.slice(0, 60), total = division ? counts[division] || 0 : agencyIndex.personas.length;
      $('agencyCount').textContent = `${q ? `${found.length.toLocaleString('en')} of ` : ''}${total.toLocaleString('en')} personas${found.length > hits.length ? (q ? ` · the best ${hits.length}` : ` · the first ${hits.length}`) : ''}`;
      $('agencyList').innerHTML = hits.map(p => `<article class="agency-item"><span class="mg-avatar agency-avatar" aria-hidden="true">${esc(initials(p.name))}</span><div class="agency-body"><b>${esc(p.name)}</b><small>${esc(p.label)}${p.role && !p.description.startsWith(p.role.slice(0, 24)) ? ' · ' + esc(p.role) : ''}</small><p>${esc(p.description.slice(0, 180))}${p.description.length > 180 ? '…' : ''}</p></div><div class="agency-actions">${mode === 'hire' ? `<button type="button" class="mg-btn mg-btn-sm mg-btn-primary" data-hire="${esc(p.id)}" ${full ? 'disabled' : ''}>Hire</button><button type="button" class="space-text-action" data-hire-lead="${esc(p.id)}">as the lead</button>` : `<button type="button" class="mg-btn mg-btn-sm mg-btn-primary" data-skill="${esc(p.id)}">Add method</button>`}</div></article>`).join('') || '<p class="agency-empty">No persona matches. Try a role, like “analyst” or “designer”.</p>';
      const act = (attr, fn) => $('agencyList').querySelectorAll(`[${attr}]`).forEach(b => b.onclick = async () => { b.disabled = true; try { const r = await fn(b.getAttribute(attr)); host.hidden = true; host.closest('form')?.classList.remove('picker-open'); dropSummary(); await onDone(r); } catch (error) { feedback(error.message, true); b.disabled = false; } });
      act('data-hire', id => api(`/agency/${id}/hire`, 'POST', { dept }).then(r => { toast(`${r.person.name} joined ${r.team.name}`, { kind: 'ok', detail: `With the “${r.skill.name}” method as a skill.` }); return r; }));
      act('data-hire-lead', id => (confirm('Give this team’s lead the persona’s role, job and standing instructions? Their name stays.') ? api(`/agency/${id}/hire`, 'POST', { dept, lead: true }).then(r => { toast(`${r.person.name} now works as ${r.person.role}`, { kind: 'ok' }); return r; }) : Promise.reject(new Error('Cancelled.'))));
      act('data-skill', id => api(`/agency/${id}/skill`, 'POST', { teams: $('agencyTeam').value ? [$('agencyTeam').value] : [] }));
    };
    $('agencyQ').oninput = list; $('agencyDivision').onchange = list; list(); $('agencyQ').focus();
  }

  /* ---------- Projects ---------- */
  let projectOpen = null;
  const projectSeen = new Set();
  let projectKeys = null;
  const dayOf = ms => ms ? new Date(ms).toISOString().slice(0, 10) : '';
  const dateShort = ms => ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
  const projectMark = p => p.status === 'archived' ? mark('off', 'Archived') : p.status === 'paused' ? mark('off', 'Paused') : p.status === 'done' ? mark('ok', 'Done') : p.milestones?.length && p.milestones.every(m => m.done) ? mark('ok', 'Milestones achieved') : p.next?.dueAt && p.next.dueAt < Date.now() ? mark('warn', 'Milestone overdue') : mark('ok', 'On track');
  async function showProjects() {
    try {
      projectSeen.clear(); projectArt = { kind: '', q: '' };
      const data = await api('/projects');
      if (pendingProject) { const id = pendingProject; pendingProject = null; if (data.projects.some(p => p.id === id)) return editProject(id, data.teams); }
      // Newest first: when the project was created, not when it was last touched, so the order does not move under the CEO.
      const newest = (a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0);
      const list = data.projects.filter(p => p.status !== 'archived').sort(newest), archived = data.projects.filter(p => p.status === 'archived').sort(newest);
      setMeta(list.length ? mark(list.some(p => p.next?.dueAt && p.next.dueAt < Date.now()) ? 'warn' : 'ok', `${list.length} open`) : mark('off', 'No projects'));
      const teamName = id => (data.teams.find(t => t.id === id) || {}).name || id;
      const shown = () => (projectListTab === 'archived' ? archived : projectListTab === 'all' ? [...list, ...archived] : list)
        .filter(p => projectListQuery.toLowerCase().split(/\s+/).filter(Boolean).every(w => `${p.name} ${p.description} ${(p.teams || []).map(teamName).join(' ')}`.toLowerCase().includes(w)));
      const row = p => { const done = (p.milestones || []).filter(m => m.done).length, total = (p.milestones || []).length, pct = total ? Math.round(100 * done / total) : 0;
        const due = p.dueAt ? new Date(p.dueAt) : null;
        return `<tr class="pl-row" data-project="${esc(p.id)}" tabindex="0" role="button" title="Open this project">
          <td><span class="pl-name">${esc(p.name)}</span><span class="pl-desc">${esc(String(p.description || '').slice(0, 150))}</span></td>
          <td>${projectMark(p)}</td>
          <td><span class="pl-ms"><b>${done} / ${total}</b><span class="pl-bar"><i style="width:${pct}%"></i></span></span></td>
          <td class="pl-next">${p.next ? esc(String(p.next.title).slice(0, 46)) : '<span class="pl-dash">—</span>'}</td>
          <td><span class="pl-tasks ${p.open ? 'on' : ''}"><b>${p.open || 0}</b><span>open</span></span></td>
          <td><span class="pl-teams">${(p.teams || []).length ? (p.teams || []).map(t => `<span class="pl-team">${esc(teamName(t))}</span>`).join('') : '<span class="pl-dash">the Program Manager picks</span>'}</span></td>
          <td class="r"><span class="pl-when">${due ? `<b>${esc(due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</b><span>${due.getFullYear()}</span>` : '<b class="pl-dash">no target</b>'}</span></td></tr>`; };
      const draw = () => {
        const rows = shown();
        $('spaceProjectRows').innerHTML = rows.length ? rows.map(row).join('') : `<tr><td colspan="7" class="pl-none">${projectListQuery ? 'No project matches those words.' : 'No project here yet.'}</td></tr>`;
        $('spaceProjectCount').textContent = `Showing ${rows.length} of ${list.length + archived.length} project${list.length + archived.length === 1 ? '' : 's'}`;
        $('spaceProjectRows').querySelectorAll('[data-project]').forEach(b => { b.onclick = () => editProject(b.dataset.project, data.teams); b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.click(); } }; });
      };
      content.innerHTML = `<div class="pl-top">
        <div class="pl-tabs" role="tablist">${[['active', 'Active', list.length], ['archived', 'Archived', archived.length], ['all', 'All', list.length + archived.length]].map(([id, label, n]) => `<button type="button" data-pl-tab="${id}" aria-pressed="${projectListTab === id}">${label} <span>${n}</span></button>`).join('')}</div>
        <span class="mg-spacer"></span>
        <div class="mg-search" style="max-width:280px">${SEARCH_ICON}<input id="spaceProjectFilter" placeholder="Filter by name, purpose or team" value="${esc(projectListQuery)}"></div>
        <button id="spaceNewProject" type="button" class="mg-btn mg-btn-primary">+ New project</button>
      </div>
      <div class="pl-wrap"><table class="pl"><thead><tr><th>Project</th><th>State</th><th>Milestones</th><th>Next</th><th>Tasks</th><th>Teams</th><th class="r">Target</th></tr></thead><tbody id="spaceProjectRows"></tbody></table>
        <div class="pl-foot"><span id="spaceProjectCount"></span><span class="mg-spacer"></span><span>Every project keeps its charter, its milestones and its folder in the Brain.</span></div></div>`;
      draw();

    } catch (error) { feedback(error.message, true); }
  }
  // A project from a brief: the CEO says what to build or achieve and attaches documents; the Program Manager plans the rest.
  function briefProject(teams) {
    projectOpen = null; setMeta(mark('off', 'Not planned yet'));
    content.innerHTML = `<div class="mg-toolbar"><button type="button" class="mg-btn mg-btn-sm" id="spaceBackProjects">← All projects</button></div>
      <form id="spaceProjectBrief" data-dirty novalidate><div class="mg-card"><div class="mg-card-head"><h3>New project</h3><span class="mg-count">the Program Manager plans it</span></div>
        <p>Say what you want to build or achieve, for whom, by when, and what must or must not happen. The Program Manager names the project, writes the charter, picks the teams, sets the milestones with dates and starts the first tasks. Change any of it afterwards.</p>
        ${field('The brief', '<textarea name="text" rows="9" required placeholder="What we are building or achieving, for whom, by when; what done looks like; what must and must not happen; where the material is."></textarea>')}
        ${field('Documents', '<input type="file" name="files" multiple accept=".pdf,.docx,.txt,.md,.csv">', 'Up to 10 files, 25 MB each. They are filed in the project’s Brain folder and given to every task.')}
        <div class="mg-toolbar" style="margin-top:16px"><button type="submit" class="mg-btn mg-btn-primary" id="spacePlanProject">Let the Program Manager plan it</button><button type="button" class="mg-btn" id="spaceManualProject">Fill the form yourself</button><span class="mg-muted" id="spacePlanHint"></span></div></div></form>`;
    $('spaceBackProjects').onclick = () => showProjects();
    $('spaceManualProject').onclick = () => editProject(null, teams);
    $('spaceProjectBrief').onsubmit = async event => {
      event.preventDefault();
      const form = event.target, text = form.elements.text.value.trim(), picked = [...(form.elements.files.files || [])];
      if (text.length < 10) return feedback('Say what the project should build or achieve.', true);
      if (picked.length > 10) return feedback('Attach up to 10 files.', true);
      if (picked.some(f => f.size > 25 * 1024 * 1024)) return feedback('A file is larger than 25 MB.', true);
      const button = $('spacePlanProject'); button.disabled = true; button.textContent = 'Planning…'; $('spacePlanHint').textContent = 'The Program Manager is reading the brief and the documents; this takes up to a minute.';
      try {
        const files = []; for (const file of picked) files.push({ name: file.name, data: await readFile(file) });
        const out = await api('/projects/plan', 'POST', { text, files });
        dirty = false; dropSummary();
        toast(`Project planned: “${out.project.name}”`, { kind: 'ok', detail: `${out.milestones} milestone${out.milestones === 1 ? '' : 's'}, ${out.tasks.length} task${out.tasks.length === 1 ? '' : 's'}; the first milestone’s work has started.` });
        await editProject(out.project.id, teams);
      } catch (error) { button.disabled = false; button.textContent = 'Let the Program Manager plan it'; $('spacePlanHint').textContent = ''; feedback(error.message, true); }
    };
  }
  // Artifacts: what kind each file is, so the Results page can offer only the kinds this project actually produced.
  const ART_KINDS = [['pdf', 'PDF', /\.pdf$/i], ['deck', 'PowerPoint', /\.pptx?$/i], ['doc', 'Word', /\.docx?$/i], ['data', 'Excel / CSV', /\.(xlsx?|csv|tsv)$/i], ['json', 'JSON', /\.json$/i], ['markdown', 'Markdown', /\.(md|markdown)$/i], ['html', 'HTML', /\.html?$/i], ['image', 'Image', /\.(png|jpe?g|gif|svg|webp)$/i], ['text', 'Text', /\.(txt|log)$/i]];
  const DOC_KINDS = ['pdf', 'deck', 'doc', 'data'];
  const artKind = row => row.kind || (ART_KINDS.find(([, , re]) => re.test(String(row.name || ''))) || ['other'])[0];
  const artMatches = (row, { kind, q }) => (!kind || (kind === 'documents' ? DOC_KINDS.includes(artKind(row)) : artKind(row) === kind))
    && String(q || '').toLowerCase().split(/\s+/).filter(Boolean).every(w => `${row.name} ${row.taskTitle}`.toLowerCase().includes(w));
  const artRows = rows => {
    const size = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : (b || 0) + ' B';
    if (!rows.length) return '<p class="mg-sub" style="margin:0">No file matches.</p>';
    return `<div class="mg-ledger-wrap" style="margin:0"><table class="mg-ledger"><tbody>${rows.map(a => `<tr><td>${fileIcon(a.name)} <span class="mg-name">${esc(String(a.name).split('/').pop())}</span><span class="mg-sub">from “${esc(a.taskTitle)}”</span></td><td>${esc(size(a.bytes))}</td><td>${a.modifiedAt ? esc(dateShort(a.modifiedAt)) : ''}</td><td class="r"><a class="mg-btn mg-btn-sm" href="${esc(a.url)}" download>Download</a></td></tr>`).join('')}</tbody></table></div>`;
  };
  // The Work: the project's execution board. A milestone is a parent row with what it is worth and what state it is in; its tasks
  // sit under it with their own progress. The shape follows the CEO's design: the figures first, then the tree, then the way in.
  const PW_ICON = {
    check: '<svg viewBox="0 0 16 16" class="pw-i" aria-hidden="true"><path d="M3.6 8.4l3 3 5.8-6.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    spin: '<svg viewBox="0 0 16 16" class="pw-i pw-spin" aria-hidden="true"><circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-dasharray="24" stroke-dashoffset="8" stroke-linecap="round"/></svg>',
    warn: '<svg viewBox="0 0 16 16" class="pw-i" aria-hidden="true"><path d="M8 2.6l5.6 10.2H2.4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6.6v2.9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="11.4" r=".9" fill="currentColor"/></svg>',
    clock: '<svg viewBox="0 0 16 16" class="pw-i" aria-hidden="true"><circle cx="8" cy="8" r="5.7" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.7V8l2.2 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    circle: '<svg viewBox="0 0 16 16" class="pw-i" aria-hidden="true"><circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    fork: '<svg viewBox="0 0 16 16" class="pw-i" aria-hidden="true"><path d="M5 4.2v3.4a2 2 0 002 2h3.6M5 4.2v7.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="5" cy="3" r="1.5" fill="currentColor"/><circle cx="11.4" cy="9.6" r="1.5" fill="currentColor"/><circle cx="5" cy="13" r="1.5" fill="currentColor"/></svg>',
    flag: '<svg viewBox="0 0 16 16" class="pw-i" aria-hidden="true"><path d="M4 14V3.2c2.4-1.2 4.8 1.2 7.2 0V9c-2.4 1.2-4.8-1.2-7.2 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 16 16" class="pw-i" aria-hidden="true"><path d="M8 3.4v9.2M3.4 8h9.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  };
  // One vocabulary for a milestone and for a task: the office's states, said the way the CEO reads them.
  const MS_CHIP = { done: ['ok', 'Achieved', 'check'], active: ['busy', 'In progress', 'spin'], waiting: ['warn', 'Waits for you', 'warn'],
    blocked: ['fail', 'Blocked', 'warn'], idle: ['busy', 'Queued', 'circle'], unplanned: ['warn', 'To plan', 'clock'], later: ['off', 'To come', 'circle'] };
  const TASK_CHIP = state => state === 'done' ? ['ok', 'Done', 'check']
    : ['blocked', 'escalated', 'failed'].includes(state) ? ['fail', 'Blocked', 'warn']
    : ['waiting', 'awaiting_ceo'].includes(state) ? ['warn', 'Waits for you', 'warn']
    : ['working', 'planning', 'reviewing', 'saving', 'executing', 'awaiting_lead_review'].includes(state) ? ['busy', 'In progress', 'spin']
    : state === 'queued' ? ['busy', 'Queued', 'circle'] : state === 'cancelled' ? ['off', 'Cancelled', 'circle'] : ['off', 'Idea', 'circle'];
  // A step of a task: the assignment a specialist was given, and how it ended.
  const STEP_CHIP = state => state === 'done' ? ['ok', 'Done', 'check']
    : state === 'failed' ? ['fail', 'Failed', 'warn']
    : ['working', 'paused'].includes(state) ? ['busy', 'Under way', 'spin']
    : state === 'interrupted' ? ['off', 'Stopped', 'circle']
    : state === 'cancelled' ? ['off', 'Cancelled', 'circle'] : ['off', String(state || '').replace(/^./, c => c.toUpperCase()) || 'Step', 'circle'];
  const pwChip = ([kind, label, icon]) => `<span class="pw-chip ${kind}">${PW_ICON[icon]}${esc(label)}</span>`;
  const pwWhen = ms => { if (!ms) return ''; const d = new Date(ms);
    return `<b>${esc(d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' }))}</b><span>${esc(d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))}</span>`; };
  const pwTaskPct = t => t.state === 'done' ? 100 : ['cancelled', 'backlog'].includes(t.state) ? 0
    : t.subtasks?.length ? Math.round(100 * (t.completedSteps || 0) / t.subtasks.length) : ['working', 'reviewing', 'saving'].includes(t.state) ? 50 : 0;
  const pwTaskProgress = t => t.state === 'done' ? '100% complete' : t.state === 'cancelled' ? 'Closed' : t.state === 'backlog' ? 'Not started'
    : t.state === 'queued' ? 'Waiting to start' : t.subtasks?.length ? `${pwTaskPct(t)}% complete` : 'Under way';
  const pwRing = kind => `<span class="pw-ring ${kind}" aria-hidden="true"></span>`;

  const projectWork = (detail, teams, roster) => {
    const p = detail.project, all = detail.tasks || [], ms = p.milestones || [];
    // Who is on it: the office's own names, so a row says the team and the person, not an id.
    const nameOf = id => (roster?.agents || []).find(a => a.id === id)?.name || '';
    const leadOf = t => nameOf((t.runs || []).filter(r => r.role === 'lead' && r.agent).at(-1)?.agent) || nameOf(t.agent);
    const tasks = all.filter(t => t.state !== 'cancelled'), ready = readyMilestones(ms), readyIds = new Set(ready.map(m => m.id)), first = ready[0] || null, seen = new Set();
    const rows = ms.map((m, i) => {
      const own = tasksOf(ms, m, tasks, { first }); own.forEach(t => seen.add(t.id));
      const state = milestoneState(m, own, readyIds.has(m.id)), chip = MS_CHIP[state] || MS_CHIP.later;
      const done = own.filter(t => t.state === 'done').length, percent = own.length ? Math.round(100 * done / own.length) : m.done ? 100 : 0;
      return { m, i, own, state, chip, done, percent };
    });
    const loose = tasks.filter(t => !seen.has(t.id));
    const counted = tasks.length, allDone = tasks.filter(t => t.state === 'done').length;
    const overall = ms.length ? Math.round(100 * rows.reduce((sum, r) => sum + (r.m.done ? 1 : r.own.length ? r.done / r.own.length : 0), 0) / ms.length) : counted ? Math.round(100 * allDone / counted) : 0;
    const health = { done: rows.filter(r => r.state === 'done').length, risk: rows.filter(r => ['blocked', 'waiting'].includes(r.state)).length, track: rows.filter(r => ['active', 'idle', 'unplanned'].includes(r.state)).length, later: rows.filter(r => r.state === 'later').length };
    const spread = { done: allDone, going: tasks.filter(t => ['working', 'planning', 'reviewing', 'saving', 'executing', 'awaiting_lead_review', 'queued'].includes(t.state)).length,
      you: tasks.filter(t => ['waiting', 'awaiting_ceo'].includes(t.state)).length, stuck: tasks.filter(t => ['blocked', 'escalated', 'failed'].includes(t.state)).length };
    spread.todo = Math.max(0, counted - spread.done - spread.going - spread.you - spread.stuck);
    const bar = [['done', spread.done], ['going', spread.going], ['you', spread.you], ['stuck', spread.stuck], ['todo', spread.todo]]
      .filter(([, n]) => n > 0).map(([k, n]) => `<i class="${k}" style="width:${counted ? (100 * n / counted) : 0}%" title="${n}"></i>`).join('');
    const next = ready.find(m => !m.done) || null;
    const ring = 100 - overall;

    const group = ({ m, i, own, state, chip, done, percent }) => `<div class="pw-group" data-ms-group="${esc(m.id)}" data-ms-state="${state}">
      <div class="pw-row pw-ms">
        <div class="pw-name"><button type="button" class="pw-x" data-ms-toggle="${esc(m.id)}" aria-expanded="true" aria-label="Show or hide the tasks of this milestone"><svg viewBox="0 0 16 16" class="pw-i"><path d="M4 6.2l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        ${pwRing(chip[0])}<span class="pw-title"><b>Milestone ${i + 1} — ${esc(m.title)}</b><span class="pw-kids">${PW_ICON.fork}${own.length}</span></span></div>
        <div class="pw-progress"><span class="pw-bar ${chip[0]}"><i style="width:${percent}%"></i></span><em>${percent}%</em></div>
        <div class="pw-status">${pwChip(chip)}</div>
        <div class="pw-when">${pwWhen(m.doneAt || m.dueAt) || '<b>—</b>'}${m.dueAt && !m.doneAt ? '<span class="pw-due">due</span>' : ''}</div>
      </div>
      <div class="pw-kidrows" data-ms-child="${esc(m.id)}">
        ${own.length ? own.map(t => task(t)).join('') : (() => {
          const by = m.done && m.taskId ? all.find(t => t.id === m.taskId) : null;
          if (by) return `<div class="pw-row pw-task" data-open-task="${esc(by.id)}" role="button" tabindex="0" title="Open the task that achieved this"><div class="pw-name"><span class="pw-tree" aria-hidden="true"></span><span class="pw-nox" aria-hidden="true"></span>${pwRing('ok')}<span class="pw-tt">${esc(by.title)}<span class="pw-team">achieved it${by.teamName ? ' · ' + esc(by.teamName) : ''}</span></span></div><div class="pw-progress pw-progress-task ok">achieved</div><div class="pw-status">${pwChip(TASK_CHIP(by.state))}</div><div class="pw-when">${pwWhen(m.doneAt || by.doneAt)}</div></div>`;
          return `<div class="pw-row pw-empty"><div class="pw-name"><span class="pw-tree" aria-hidden="true"></span>${m.done ? 'Achieved before the office tracked tasks against milestones.' : readyIds.has(m.id) ? 'Nothing planned yet — the Program Manager takes this milestone, or add a task yourself.' : 'Nothing planned yet; it waits for the milestone before it.'}</div><div></div><div></div><div></div></div>`;
        })()}
        <div class="pw-row pw-addrow"><div class="pw-name"><button type="button" class="pw-add" data-add-task="${esc(m.id)}">${PW_ICON.plus}Add a task to this milestone</button></div><div></div><div></div><div></div></div>
      </div></div>`;
    const task = t => { const c = TASK_CHIP(t.state), steps = t.subtasks || [];
      return `<div class="pw-row pw-task" data-open-task="${esc(t.id)}" role="button" tabindex="0" title="Open this task">
      <div class="pw-name"><span class="pw-tree" aria-hidden="true"></span>${steps.length ? `<button type="button" class="pw-x pw-x-step" data-steps-toggle="${esc(t.id)}" aria-expanded="false" aria-label="Show what this task was broken into"><svg viewBox="0 0 16 16" class="pw-i"><path d="M4 6.2l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : '<span class="pw-nox" aria-hidden="true"></span>'}${pwRing(c[0])}<span class="pw-tt">${esc(t.title)}<span class="pw-team">${esc(t.teamName || '')}${leadOf(t) ? ` · ${esc(leadOf(t))}` : ''}${steps.length ? ` · ${steps.filter(s => s.state === 'done').length} of ${steps.length} assignment${steps.length === 1 ? '' : 's'}` : ''}</span></span></div>
      <div class="pw-progress pw-progress-task ${c[0]}">${esc(pwTaskProgress(t))}</div>
      <div class="pw-status">${pwChip(c)}</div>
      <div class="pw-when">${pwWhen(t.doneAt || t.dueAt || t.createdAt)}</div></div>`
      + (steps.length ? `<div class="pw-steps" data-steps="${esc(t.id)}" hidden>${steps.map(s => { const sc = STEP_CHIP(s.state);
        return `<div class="pw-row pw-step" data-open-task="${esc(t.id)}" role="button" tabindex="0" title="Open the task this belongs to"><div class="pw-name"><span class="pw-tree pw-tree-2" aria-hidden="true"></span>${pwRing(sc[0])}<span class="pw-tt">${esc(String(s.title).slice(0, 120))}${nameOf(s.agent) ? `<span class="pw-team">${esc(nameOf(s.agent))}</span>` : ''}</span></div><div class="pw-progress"></div><div class="pw-status">${pwChip(sc)}</div><div class="pw-when"></div></div>`; }).join('')}</div>` : ''); };

    return `<section class="pw">
      <div class="pw-head">
        <div class="pw-head-text"><h3>${PW_ICON.flag}Project execution &amp; milestones</h3><p>Every milestone, what it is worth, and who is on the tasks under it.</p></div>
        <div class="pw-head-actions">
          <div class="pw-seg" role="group" aria-label="Which milestones">${[['all', 'All milestones'], ['open', 'In progress'], ['stuck', 'Needs attention']].map(([id, label]) => `<button type="button" data-pw-filter="${id}" aria-pressed="${projectWorkFilter === id}">${label}</button>`).join('')}</div>
          <button type="button" class="mg-btn mg-btn-sm" id="spaceNewMilestone">${PW_ICON.plus}New milestone</button>
          <button type="button" class="mg-btn mg-btn-primary mg-btn-sm" data-add-task="">${PW_ICON.plus}New task</button>
        </div>
      </div>
      <div class="pw-kpis">
        <div class="pw-kpi">
          <div class="pw-kpi-top"><div><span class="mg-eyebrow">Overall completion</span><div class="pw-big">${overall}%</div></div>
            <svg class="pw-dial" viewBox="0 0 36 36" aria-hidden="true"><circle class="pw-dial-bg" cx="18" cy="18" r="15.9" fill="none" stroke-width="3.4"/><circle class="pw-dial-fg" cx="18" cy="18" r="15.9" fill="none" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="${overall} ${ring}" transform="rotate(-90 18 18)"/></svg></div>
          <div class="pw-next"><span class="mg-eyebrow">${next ? 'Next milestone' : 'Milestones'}</span><b>${next ? esc(next.title) : ms.length ? 'All achieved' : 'None yet'}</b>${next?.dueAt ? `<span class="pw-next-due">due ${esc(dateShort(next.dueAt))}</span>` : ''}</div>
          <div class="pw-kpi-foot"><span>${PW_ICON.check}${allDone} of ${counted} task${counted === 1 ? '' : 's'} done</span><span>${PW_ICON.flag}${ms.length} milestone${ms.length === 1 ? '' : 's'}</span>${p.dueAt ? `<span>${PW_ICON.clock}target ${esc(dateShort(p.dueAt))}</span>` : ''}</div>
        </div>
        <div class="pw-kpi pw-kpi-wide">
          <div class="pw-kpi-head"><span class="mg-eyebrow">Milestone health</span><span class="pw-kpi-note">${ms.length} tracked${[...new Set(tasks.map(t => t.teamName).filter(Boolean))].length ? ' · ' + esc([...new Set(tasks.map(t => t.teamName).filter(Boolean))].join(', ')) : ''}</span></div>
          <div class="pw-tiles">
            <div class="pw-tile ok"><span>Achieved</span><b>${health.done}</b></div>
            <div class="pw-tile busy"><span>Under way</span><b>${health.track}</b></div>
            <div class="pw-tile ${health.risk ? 'fail' : 'off'}"><span>Needs attention</span><b>${health.risk}</b></div>
          </div>
          <div class="pw-spread"><div class="pw-spread-head"><span>Task distribution</span><em>${spread.done} done · ${spread.going} under way · ${spread.you} for you · ${spread.stuck} blocked · ${spread.todo} to come</em></div><div class="pw-spread-bar">${bar || '<i class="todo" style="width:100%"></i>'}</div></div>
        </div>
      </div>
      <div class="pw-table">
        <div class="pw-row pw-headrow"><div class="pw-name"><button type="button" class="pw-x" id="spacePwFold" aria-expanded="true" aria-label="Fold every milestone"><svg viewBox="0 0 16 16" class="pw-i"><path d="M4 6.2l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></button>Task / milestone</div><div class="pw-progress">Progress</div><div class="pw-status">Status</div><div class="pw-when">When</div></div>
        ${rows.map(group).join('')}
        ${loose.length ? `<div class="pw-group" data-ms-group="none" data-ms-state="later"><div class="pw-row pw-ms"><div class="pw-name"><button type="button" class="pw-x" data-ms-toggle="none" aria-expanded="true" aria-label="Show or hide"><svg viewBox="0 0 16 16" class="pw-i"><path d="M4 6.2l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></button>${pwRing('off')}<span class="pw-title"><b>Not in a milestone</b><span class="pw-kids">${PW_ICON.fork}${loose.length}</span></span></div><div class="pw-progress"></div><div class="pw-status"></div><div class="pw-when"></div></div><div class="pw-kidrows" data-ms-child="none">${loose.map(t => task(t)).join('')}</div></div>` : ''}
        ${!ms.length && !tasks.length ? '<div class="pw-row pw-empty"><div class="pw-name">No milestones and no tasks yet. Add a milestone, or a task.</div><div></div><div></div><div></div></div>' : ''}
        <div class="pw-foot">
          <div class="pw-foot-actions"><button type="button" class="pw-link" data-add-task="">${PW_ICON.plus}Add task</button><span class="pw-sep"></span><button type="button" class="pw-link" id="spaceNewMilestone2">${PW_ICON.plus}Add milestone</button></div>
          <div class="pw-keys"><span><kbd>c</kbd> new task</span><span><kbd>m</kbd> new milestone</span></div>
        </div>
      </div>
    </section>` + newTaskModal(detail, teams) + newMilestoneModal(detail);
  };
  // A milestone the CEO adds here: its name, when it is due, and whether it waits for the one before it.
  const newMilestoneModal = detail => {
    const ms = detail.project.milestones || [];
    return `<div class="mg-modal" id="spaceMilestoneModal" hidden role="dialog" aria-modal="true" aria-label="New milestone"><div class="mg-modal-box pw-modal">
      <div class="mg-modal-head"><h3>New milestone</h3><button type="button" class="mg-modal-x" data-ms-close aria-label="Close">✕</button></div>
      <form id="spaceNewMilestoneForm" class="pw-form">
        ${field('What is true when it is reached', '<input name="title" required maxlength="160" placeholder="A state of the world, not an activity">')}
        <div class="mg-grid">
          ${field('Due', '<input type="date" name="dueAt">')}
          ${field('Waits for', `<select name="after"><option value="">The milestone before it</option><option value="none">Nothing — it can start at once</option>${ms.map((m, i) => `<option value="${esc(m.id)}">${i + 1}. ${esc(m.title.slice(0, 48))}</option>`).join('')}</select>`)}
        </div>
        <div class="mg-savebar"><span class="mg-savemsg" id="spaceNewMsHint">The Program Manager plans it and starts the work when its turn comes.</span><span class="mg-spacer"></span><button type="button" class="mg-btn" data-ms-close>Cancel</button><button type="submit" class="mg-btn mg-btn-primary">Add milestone</button></div>
      </form></div></div>`;
  };
  // Adding a task: the title, which milestone it belongs to, who does it, how it is ranked, and when it is due.
  const newTaskModal = (detail, teams) => {
    const p = detail.project, ms = p.milestones || [], tasks = detail.tasks || [];
    const ready = new Set(readyMilestones(ms).map(m => m.id));
    const pick = ms.map((m, i) => { const own = tasks.filter(t => t.milestoneId === m.id && t.state !== 'cancelled'), done = own.filter(t => t.state === 'done').length;
      return `<label class="pw-pick"><input type="radio" name="milestoneId" value="${esc(m.id)}"><span><b>Milestone ${i + 1} — ${esc(m.title)}</b><small>${own.length ? `${done} of ${own.length} done` : 'nothing planned'}${m.dueAt ? ' · due ' + esc(dateShort(m.dueAt)) : ''}${m.done ? ' · achieved' : ready.has(m.id) ? ' · can start now' : ' · waits for an earlier milestone'}</small></span></label>`; }).join('');
    const prio = [[2, 'High', 'Ahead of the rest'], [1, 'Normal', 'The usual order'], [0, 'Low', 'When there is room']].map(([value, label, hint]) =>
      `<label class="pw-prio"><input type="radio" name="priority" value="${value}" ${value === 1 ? 'checked' : ''}><span><b>${label}</b><small>${hint}</small></span></label>`).join('');
    return `<div class="mg-modal" id="spaceTaskModal" hidden role="dialog" aria-modal="true" aria-label="New task"><div class="mg-modal-box pw-modal">
      <div class="mg-modal-head"><h3>New task</h3><button type="button" class="mg-modal-x" data-task-close aria-label="Close">✕</button></div>
      <form id="spaceNewTask" class="pw-form">
        ${field('What needs to get done', '<input name="title" required maxlength="120" placeholder="Name the deliverable, not the activity">')}
        <div class="pw-field"><span class="mg-eyebrow">Which milestone</span><div class="pw-picks">${pick}<label class="pw-pick"><input type="radio" name="milestoneId" value="" ${ms.length ? '' : 'checked'}><span><b>No milestone</b><small>It belongs to the project, not to a milestone</small></span></label></div></div>
        ${field('The brief', '<textarea name="text" rows="4" placeholder="What it must contain, what to read first, what done looks like."></textarea>', 'Left empty, the team gets the title.')}
        <div class="pw-field"><span class="mg-eyebrow">Priority</span><div class="pw-prios">${prio}</div></div>
        <div class="mg-grid">
          ${field('Team', `<select name="dept"><option value="">Program Manager chooses</option>${(teams || []).map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select>`)}
          ${field('Due', '<input type="date" name="dueAt">')}
          ${field('Start', '<select name="start"><option value="now">Start it now</option><option value="later">Save it for later</option></select>')}
        </div>
        <div class="mg-savebar"><span class="mg-savemsg" id="spaceNewTaskHint">The Program Manager plans it and brings in the teams it needs.</span><span class="mg-spacer"></span><button type="button" class="mg-btn" data-task-close>Cancel</button><button type="submit" class="mg-btn mg-btn-primary">Create task</button></div>
      </form></div></div>`;
  };
  // The project's Results: the Program Manager's closing summary, the addresses it names, and every file the tasks produced.
  const hostOf = url => { try { const u = new URL(url); return (u.host + (u.pathname === '/' ? '' : u.pathname)).replace(/\/$/, ''); } catch { return url; } };
  const fileNames = arts => { const map = new Map(); for (const a of arts) { const name = String(a.name || ''); map.set(name.toLowerCase(), a); map.set(name.split('/').pop().toLowerCase(), a); } return map; };
  const fileLink = a => `<a class="mg-filelink" href="${esc(a.url)}" download title="Download ${esc(a.name)}">${fileIcon(a.name)}<span>${esc(String(a.name).split('/').pop())}</span></a>`;
  // Where a delivered thing lives: an address to open, a file to download, or, failing both, what the Program Manager wrote.
  const whereLink = (where, byName) => {
    const value = String(where || '').trim(); if (!value) return '';
    if (/^https?:\/\//i.test(value)) return `<a class="mg-urllink" href="${esc(value)}" target="_blank" rel="noreferrer noopener">${esc(hostOf(value))} ↗</a>`;
    const file = byName.get(value.toLowerCase()) || byName.get(value.split('/').pop().toLowerCase());
    return file ? fileLink(file) : `<span class="mg-sub" style="margin:0">${esc(value)}</span>`;
  };
  // In the summary's prose, a file name becomes the file and an address becomes a link: the CEO clicks what they read.
  const enrichSummary = (host, arts) => {
    if (!host) return;
    const byName = fileNames(arts);
    // A bullet that opens with its own name becomes a title; the colon that joined it to the sentence has nothing left to join.
    host.querySelectorAll('li > strong:first-child, li > p:first-child > strong:first-child').forEach(title => {
      const next = title.nextSibling;
      if (next && next.nodeType === 3) next.nodeValue = next.nodeValue.replace(/^s*[:—-]s*/, '');
    });
    host.querySelectorAll('code').forEach(code => {
      const raw = code.textContent.trim(), key = raw.replace(/^[('"`]+|[)'"`.,;:]+$/g, '');
      const file = byName.get(key.toLowerCase()) || byName.get(key.split('/').pop().toLowerCase());
      if (file) { const el = document.createElement('span'); el.innerHTML = fileLink(file); code.replaceWith(el.firstChild); return; }
      if (/^https?:\/\/\S+$/i.test(key)) { const a = document.createElement('a'); a.className = 'mg-urllink'; a.href = key; a.target = '_blank'; a.rel = 'noreferrer noopener'; a.textContent = key; code.replaceWith(a); }
    });
    // An address written as plain prose is still an address.
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, { acceptNode: node => node.parentElement.closest('a,code') || !/https?:\/\//.test(node.nodeValue) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const texts = []; while (walker.nextNode()) texts.push(walker.currentNode);
    for (const node of texts) {
      const frag = document.createDocumentFragment(); let last = 0;
      for (const m of node.nodeValue.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
        const url = m[0].replace(/[.,;:!?)\]}'"]+$/, '');
        frag.append(node.nodeValue.slice(last, m.index));
        const a = document.createElement('a'); a.className = 'mg-urllink'; a.href = url; a.target = '_blank'; a.rel = 'noreferrer noopener'; a.textContent = url; frag.append(a);
        last = m.index + url.length;
      }
      frag.append(node.nodeValue.slice(last)); node.replaceWith(frag);
    }
  };
  const resultsCard = detail => {
    const s = detail.project.summary || null, arts = detail.artifacts || [], byName = fileNames(arts);
    const kinds = [...new Set(arts.map(artKind))], present = ART_KINDS.filter(([id]) => kinds.includes(id));
    // The plates: what exists, ready to open. The first address is the one the project was for.
    const opens = (s?.links || []).map((l, i) => `<a class="mg-open${i ? '' : ' primary'}" href="${esc(l.url)}" target="_blank" rel="noreferrer noopener"><span class="mg-open-go" aria-hidden="true">↗</span><span class="mg-open-text"><b>${esc(l.label || hostOf(l.url))}</b><span class="mg-open-host">${esc(hostOf(l.url))}</span></span><span class="mg-open-cta">Open</span></a>`).join('');
    const delivered = (s?.delivered || []).map(d => `<div class="mg-deliv"><div><b>${esc(d.what)}</b>${d.note ? `<span>${esc(d.note)}</span>` : ''}</div><div class="mg-deliv-where">${whereLink(d.where, byName)}</div></div>`).join('');
    const notes = (list, title) => list?.length ? `<div class="mg-results-section"><h4 class="mg-eyebrow" style="margin:0 0 10px">${title}</h4><ul class="mg-note-list">${list.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
    const filters = arts.length ? `<div class="mg-toolbar" style="margin:0 0 12px"><div class="mg-filters" id="spaceArtKinds">${[['', 'Everything'], ...(present.some(([id]) => DOC_KINDS.includes(id)) ? [['documents', 'Documents']] : []), ...present.map(([id, label]) => [id, label]), ...(kinds.includes('other') ? [['other', 'Other']] : [])].map(([id, label]) => `<button type="button" data-art-kind="${esc(id)}" aria-pressed="${projectArt.kind === id}">${esc(label)}</button>`).join('')}</div><span class="mg-spacer"></span><div class="mg-search">${SEARCH_ICON}<input id="spaceArtQ" placeholder="Search the files" value="${esc(projectArt.q)}"></div></div>` : '';
    return `<div class="mg-card">
      ${s ? `<div class="mg-result-head"><span class="mg-result-meta">The Program Manager${s.at ? ' · ' + esc(dateShort(s.at)) : ''}${s.tasks ? ` · ${s.tasks} finished task${s.tasks === 1 ? '' : 's'}` : ''}</span><h2>${esc(s.headline)}</h2></div>
        ${opens ? `<div class="mg-opens">${opens}</div>` : ''}
        <div class="mg-doc mg-summary" id="spaceSummaryDoc">${renderDocument(s.text, 'summary').html}</div>
        ${delivered ? `<div class="mg-results-section"><h4 class="mg-eyebrow" style="margin:0 0 4px">What was delivered</h4>${delivered}</div>` : ''}
        ${notes(s.open, 'Still open')}${notes(s.next, 'Next')}`
        : `<div class="mg-result-head"><span class="mg-result-meta">Results</span><h2>Nothing to show yet</h2></div><p class="mg-intro">The Program Manager writes this when every milestone is achieved and no task is open: what you asked for, what exists now, and where to open it.</p>`}
      <div class="mg-results-section"><div class="mg-card-head" style="margin-bottom:12px"><h3>Artifacts</h3><span class="mg-count">${arts.length} file${arts.length === 1 ? '' : 's'}</span></div>
      ${arts.length ? filters + `<div id="spaceArtList">${artRows(arts.filter(a => artMatches(a, projectArt)))}</div>` : '<p class="mg-sub" style="margin:0">The project\'s tasks have produced no files yet.</p>'}</div>
      <div class="mg-toolbar" style="margin-top:18px"><button type="button" class="mg-btn mg-btn-sm" id="spaceWriteSummary">${s ? 'Write the summary again' : 'Write the summary now'}</button><span class="mg-count" id="spaceSummaryHint"></span></div></div>`;
  };
  async function editProject(id, teams) {
    try {
      const detail = id ? await api(`/projects/${id}`) : null;
      const p = detail?.project || { id: '', name: '', description: '', charter: '', teams: [], status: 'active', startAt: null, dueAt: null, milestones: [], visibility: 'private', sharedWith: { users: [], groups: [] } };
      // Hosted: the people and groups a project can be shared with; only the project's owner or an office admin may change the audience.
      const roster = config || await api('/office').catch(() => null);
      const audience = HOSTED ? await Promise.all([api('/users'), api('/groups')]).then(([u, g]) => ({ users: u.users.filter(x => x.id !== USER?.id && x.id !== p.ownerId), groups: g.groups })).catch(() => null) : null;
      const mayShare = HOSTED && (isOfficeAdmin() || !p.id || p.ownerId === USER?.id);
      projectOpen = p.id || null;
      // "After": the numbers of the milestones this one waits for; blank waits for the one before it, "–" waits for none.
      const afterText = m => Array.isArray(m?.after) ? (m.after.length ? m.after.map(id => p.milestones.findIndex(x => x.id === id) + 1).filter(n => n > 0).join(', ') : '–') : '';
      const milestoneRow = (m = {}, i = p.milestones.length) => `<div class="mg-toolbar" data-milestone style="margin:0 0 8px;flex-wrap:nowrap"><span class="mg-count" style="width:22px;flex:none;text-align:right">${i + 1}.</span><input type="checkbox" class="mg-switch" name="mdone" ${m.done ? 'checked' : ''} title="Done" aria-label="Reached"><input name="mtitle" value="${esc(m.title || '')}" placeholder="Milestone" required style="flex:1;min-width:0;width:auto"><input name="mafter" value="${esc(afterText(m))}" placeholder="after #" title="The numbers of the milestones this one waits for. Blank: the one before it. – : none, it can start at once." style="width:72px;flex:none"><input type="date" name="mdue" value="${dayOf(m.dueAt)}" style="width:170px;flex:none"><input type="hidden" name="mid" value="${esc(m.id || '')}"><button type="button" class="space-text-action" data-remove-milestone>Remove</button></div>`;
      setMeta(p.id ? projectMark(p) : mark('off', 'Not saved yet'));
      content.innerHTML = `<div class="mg-toolbar"><button type="button" class="mg-btn mg-btn-sm" id="spaceBackProjects">← All projects</button><span class="mg-spacer"></span>${p.id ? `<label>State <select id="spaceProjectStatus">${['active', 'paused', 'done', 'archived'].map(st => `<option value="${st}" ${st === p.status ? 'selected' : ''}>${st}</option>`).join('')}</select></label><button type="button" class="mg-btn mg-btn-sm mg-btn-danger" id="spaceDeleteProject">Delete project</button>` : ''}</div>
        ${p.id ? `<nav class="mg-subnav" role="tablist" aria-label="Project pages">${[['charter', 'Project charter', ''], ['tasks', 'Project work', detail.tasks.length], ['results', 'Results', (detail.artifacts || []).length]].map(([id, label, n]) => `<button type="button" class="mg-tab" data-project-tab="${id}" aria-pressed="${projectTab === id}">${label}${n ? `<span class="mg-n">${n}</span>` : ''}</button>`).join('')}</nav>` : ''}
        <div data-project-page="charter">
        <form id="spaceProjectForm" data-dirty novalidate><div class="mg-card"><div class="mg-card-head"><h3>${p.id ? esc(p.name) : 'New project'}</h3><span class="mg-count">${p.id ? `${esc(detail.project.page)} · ${detail.tasks.length} task${detail.tasks.length === 1 ? '' : 's'} · ${detail.files.length} file${detail.files.length === 1 ? '' : 's'}` : 'write the charter the way you would brief a new hire'}</span></div>
          <div class="mg-grid">${field('Name', `<input name="name" value="${esc(p.name)}" required maxlength="80">`)}${field('Start', `<input type="date" name="startAt" value="${dayOf(p.startAt)}">`)}${field('Target date', `<input type="date" name="dueAt" value="${dayOf(p.dueAt)}">`)}</div>
          <div style="margin-top:14px">${field('Purpose', `<textarea name="description" rows="2" required placeholder="What this project is for and what done looks like.">${esc(p.description)}</textarea>`)}${field('Charter', `<textarea name="charter" rows="8" placeholder="Scope and what is out of scope, objectives and how success is measured, constraints, stakeholders, the standards to follow, the decisions already made.">${esc(p.charter)}</textarea>`, 'Every task of this project starts from this.')}</div></div>
          ${audience && mayShare ? `<div class="mg-card"><h3>Who sees it</h3><p>Sharing a project shares every task in it, past and future. You and the office admins always see it; its approved results are filed in the shared Brain.</p><div class="mg-grid">${field('Visibility', `<select name="visibility"><option value="private" ${p.visibility !== 'public' ? 'selected' : ''}>Private</option><option value="public" ${p.visibility === 'public' ? 'selected' : ''}>Everyone in the office</option></select>`)}${field('Shared with', `<select name="share" multiple size="5">${audience.groups.length ? `<optgroup label="Groups">${audience.groups.map(g => `<option value="g:${esc(g.id)}" ${(p.sharedWith?.groups || []).includes(g.id) ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</optgroup>` : ''}<optgroup label="People">${audience.users.map(u => `<option value="u:${esc(u.id)}" ${(p.sharedWith?.users || []).includes(u.id) ? 'selected' : ''}>${esc(u.name)} · ${esc(u.role)}</option>`).join('') || '<option disabled>Nobody else yet</option>'}</optgroup></select>`, 'People and groups from Users & groups. Hold Ctrl or ⌘ to pick several.')}</div></div>` : ''}
          <div class="mg-card"><h3>Owning teams</h3><p>The Program Manager still brings in any team a task needs.</p><div class="mg-picks">${teams.map(t => check(`<input type="checkbox" class="mg-switch" name="teams" value="${esc(t.id)}" ${p.teams.includes(t.id) ? 'checked' : ''}>`, esc(t.name)))}</div></div>
          <div class="mg-card"><h3>Milestones</h3><p>Switch one on when it is reached. “After” holds the numbers of the milestones one waits for (blank: the one before it; –: none). Milestones that do not wait for each other are worked in parallel, and the Program Manager plans any that has no tasks.</p>${p.milestones.length ? `<div class="mf-wrap">${flowSVG(p.milestones, detail?.tasks || [])}</div>` : ''}<div id="spaceMilestones">${p.milestones.map((m, i) => milestoneRow(m, i)).join('')}</div><button type="button" class="mg-btn mg-btn-sm" id="spaceAddMilestone">+ Milestone</button></div>
          ${saveBar({ hint: p.id ? 'Its page in the Brain is rewritten on save.' : 'Not saved yet.', label: p.id ? 'Save project' : 'Create project' })}
        </form>
        ${p.id ? `<div class="mg-card" style="margin-top:16px"><div class="mg-card-head"><h3>Files</h3><span class="mg-count">${detail.files.length}</span></div><p>Uploads land in the project's Brain folder, where every task of this project can read them.</p><div class="mg-upload"><input type="file" id="spaceProjectFiles" multiple accept=".pdf,.docx,.txt,.md,.csv"><button type="button" class="mg-btn mg-btn-sm" id="spaceProjectUpload">Upload</button><small>PDF, Word, text, Markdown or CSV · up to 25 MB each.</small></div>
          ${detail.files.length ? `<div class="mg-ledger-wrap" style="margin:0"><table class="mg-ledger"><tbody>${detail.files.map(f => `<tr><td>${fileIcon(f.id)} <span class="mg-name">${esc(f.title || f.id.split('/').pop())}</span><span class="mg-sub">${esc(f.id)}</span></td><td class="k r">${f.updatedAt ? esc(when(f.updatedAt)) : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>
        ` : ''}
        </div>
        <div data-project-page="tasks">${p.id ? projectWork(detail, teams, roster) : ''}</div>
        <div data-project-page="results">${p.id ? resultsCard(detail) : ''}</div>`;
      // The work and the Results are two pages of the same project: a finished project opens on its Results.
      if (!p.id) projectTab = 'charter';
      else if (!projectSeen.has(p.id)) { projectSeen.add(p.id); projectTab = detail.project.summary?.text ? 'results' : 'tasks'; }
      const showPage = () => { content.querySelectorAll('[data-project-page]').forEach(el => el.hidden = el.dataset.projectPage !== projectTab); content.querySelectorAll('[data-project-tab]').forEach(b => b.setAttribute('aria-pressed', b.dataset.projectTab === projectTab)); };
      showPage();
      content.querySelectorAll('[data-project-tab]').forEach(b => b.onclick = () => { projectTab = b.dataset.projectTab; showPage(); });
      // The artifacts are filtered where they are: by kind, and by words in the file name or the task that made it.
      enrichSummary($('spaceSummaryDoc'), detail.artifacts || []);
      const drawArts = () => { const list = $('spaceArtList'); if (list) list.innerHTML = artRows((detail.artifacts || []).filter(a => artMatches(a, projectArt))); };
      content.querySelectorAll('[data-art-kind]').forEach(b => b.onclick = () => { projectArt.kind = b.dataset.artKind; content.querySelectorAll('[data-art-kind]').forEach(x => x.setAttribute('aria-pressed', x.dataset.artKind === projectArt.kind)); drawArts(); });
      if ($('spaceArtQ')) { let timer = null; $('spaceArtQ').oninput = event => { projectArt.q = event.target.value.trim(); clearTimeout(timer); timer = setTimeout(drawArts, 250); }; }
      $('spaceBackProjects').onclick = () => showProjects();
      const form = $('spaceProjectForm'), rows = $('spaceMilestones');
      $('spaceAddMilestone').onclick = () => { rows.insertAdjacentHTML('beforeend', milestoneRow()); rows.lastElementChild.querySelector('[name=mtitle]').focus(); wireRows(); dirty = true; setBar(barOf(form), 'dirty', 'Changes not saved'); };
      const wireRows = () => rows.querySelectorAll('[data-remove-milestone]').forEach(b => b.onclick = () => { b.closest('[data-milestone]').remove(); dirty = true; setBar(barOf(form), 'dirty', 'Changes not saved'); });
      wireRows();
      const picked = () => form.elements.share ? [...form.elements.share.selectedOptions].map(o => o.value) : [];
      const collect = () => ({ name: form.elements.name.value, description: form.elements.description.value, charter: form.elements.charter.value, startAt: form.elements.startAt.value || null, dueAt: form.elements.dueAt.value || null,
        ...(form.elements.visibility ? { visibility: form.elements.visibility.value, sharedWith: { users: picked().filter(v => v.startsWith('u:')).map(v => v.slice(2)), groups: picked().filter(v => v.startsWith('g:')).map(v => v.slice(2)) } } : {}),
        teams: [...form.querySelectorAll('[name=teams]:checked')].map(el => el.value),
        milestones: [...rows.querySelectorAll('[data-milestone]')].map(row => { const raw = row.querySelector('[name=mafter]').value.trim(); const after = raw === '' ? undefined : /^[-–—]$|^none$|^0$/i.test(raw) ? [] : raw.split(/[\s,;]+/).map(n => Number(n) - 1).filter(n => Number.isInteger(n) && n >= 0); return { id: row.querySelector('[name=mid]').value || undefined, title: row.querySelector('[name=mtitle]').value, dueAt: row.querySelector('[name=mdue]').value || null, done: row.querySelector('[name=mdone]').checked, ...(after ? { after } : {}) }; }) });
      form.onsubmit = async event => { event.preventDefault(); try { const savedProject = await runSave(barOf(form), () => p.id ? api(`/projects/${p.id}`, 'PUT', collect()) : api('/projects', 'POST', collect()), { ok: p.id ? 'Project saved' : 'Project created', sub: p.id ? 'Its page in the Brain is being rewritten.' : 'Add files and tasks below.' }); await editProject(savedProject.id, teams); } catch {} };
      if (p.id) {
        $('spaceProjectStatus').onchange = async event => { try { await api(`/projects/${p.id}/status`, 'POST', { status: event.target.value }); toast(`Project is now ${event.target.value}`, { kind: 'ok' }); dropSummary(); await editProject(p.id, teams); } catch (error) { feedback(error.message, true); } };
        $('spaceProjectUpload').onclick = async () => { const files = [...($('spaceProjectFiles').files || [])]; if (!files.length) return feedback('Choose a file first.', true); try { for (const file of files) { if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} is larger than 25 MB.`); toast(`Adding ${file.name}…`, { kind: 'info', ms: 2500 }); await api(`/projects/${p.id}/upload`, 'POST', { name: file.name, data: await readFile(file) }); } toast(`${files.length} file${files.length === 1 ? '' : 's'} added to the project`, { kind: 'ok' }); await editProject(p.id, teams); } catch (error) { feedback(error.message, true); } };
        const taskModal = $('spaceTaskModal');
        // Which milestones are shown, and folding them all at once.
        const applyWorkFilter = () => content.querySelectorAll('[data-ms-group]').forEach(g => {
          const state = g.dataset.msState;
          g.hidden = projectWorkFilter === 'open' ? !['active', 'idle', 'unplanned'].includes(state) : projectWorkFilter === 'stuck' ? !['blocked', 'waiting'].includes(state) : false;
        });
        applyWorkFilter();
        content.querySelectorAll('[data-pw-filter]').forEach(b => b.onclick = () => {
          projectWorkFilter = b.dataset.pwFilter;
          content.querySelectorAll('[data-pw-filter]').forEach(x => x.setAttribute('aria-pressed', x.dataset.pwFilter === projectWorkFilter));
          applyWorkFilter();
        });
        if ($('spacePwFold')) $('spacePwFold').onclick = () => {
          const open = $('spacePwFold').getAttribute('aria-expanded') !== 'true';
          $('spacePwFold').setAttribute('aria-expanded', String(open));
          content.querySelectorAll('[data-ms-toggle]').forEach(b => { b.setAttribute('aria-expanded', String(open)); foldMilestone(b.dataset.msToggle, open); });
        };
        // A milestone the CEO adds here goes onto the project with the rest.
        const msModal = $('spaceMilestoneModal'), closeMsModal = () => { if (msModal) { msModal.hidden = true; $('spaceNewMilestoneForm')?.reset(); } };
        const openMsModal = () => { if (!msModal) return; msModal.hidden = false; msModal.querySelector('[name=title]').focus(); };
        if ($('spaceNewMilestone')) $('spaceNewMilestone').onclick = openMsModal;
        if ($('spaceNewMilestone2')) $('spaceNewMilestone2').onclick = openMsModal;
        if (msModal) {
          msModal.onclick = event => { if (event.target === msModal || event.target.closest('[data-ms-close]')) closeMsModal(); };
          msModal.onkeydown = event => { if (event.key === 'Escape') closeMsModal(); };
          $('spaceNewMilestoneForm').onsubmit = async event => {
            event.preventDefault();
            const f = event.target.elements, title = f.title.value.trim(); if (!title) return;
            const after = f.after.value === 'none' ? [] : f.after.value ? [f.after.value] : undefined;
            const button = event.target.querySelector('button[type=submit]'); button.disabled = true; $('spaceNewMsHint').textContent = 'Adding…';
            try {
              const kept = (detail.project.milestones || []).map(m => ({ id: m.id, title: m.title, dueAt: m.dueAt, done: !!m.done, ...(Array.isArray(m.after) ? { after: m.after } : {}) }));
              await api(`/projects/${p.id}`, 'PUT', { ...detail.project, milestones: [...kept, { title, dueAt: f.dueAt.value || null, done: false, ...(after ? { after } : {}) }] });
              closeMsModal(); toast('Milestone added', { kind: 'ok', detail: 'The Program Manager plans it when its turn comes.' });
              await editProject(p.id, teams);
            } catch (error) { button.disabled = false; $('spaceNewMsHint').textContent = ''; feedback(error.message, true); }
          };
        }
        // c for a task, m for a milestone, while the work page is open and nothing is being typed into.
        if (projectKeys) document.removeEventListener('keydown', projectKeys);
        projectKeys = event => {
          if (projectTab !== 'tasks' || page.hidden || event.metaKey || event.ctrlKey || event.altKey) return;
          const on = event.target instanceof Element ? event.target : null;
          if (on && on.closest('input, textarea, select, [contenteditable], button')) return;
          if (!taskModal?.hidden || !msModal?.hidden) return;
          if (event.key === 'c') { event.preventDefault(); content.querySelector('[data-add-task]')?.click(); }
          if (event.key === 'm') { event.preventDefault(); openMsModal(); }
        };
        document.addEventListener('keydown', projectKeys);
        // A milestone folds its tasks away; the rows under it carry its id.
        const foldMilestone = (id, open) => content.querySelectorAll(`[data-ms-child="${CSS.escape(id)}"]`).forEach(row => { row.hidden = !open; });
        content.querySelectorAll('[data-ms-toggle]').forEach(b => b.onclick = () => { const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open)); foldMilestone(b.dataset.msToggle, open); });
        content.querySelectorAll('[data-steps-toggle]').forEach(b => b.onclick = event => {
          event.stopPropagation();
          const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open));
          const rows = content.querySelector(`[data-steps="${CSS.escape(b.dataset.stepsToggle)}"]`); if (rows) rows.hidden = !open;
        });
        // Adding a task: the dialog opens on the milestone the CEO pressed.
        const closeTaskModal = () => { if (taskModal) { taskModal.hidden = true; $('spaceNewTask')?.reset(); } };
        content.querySelectorAll('[data-add-task]').forEach(b => b.onclick = () => {
          if (!taskModal) return;
          const wanted = b.dataset.addTask, radios = [...taskModal.querySelectorAll('[name=milestoneId]')];
          const pick = (wanted && radios.find(r => r.value === wanted)) || radios.find(r => r.value) || radios[0];
          if (pick) pick.checked = true;
          taskModal.hidden = false; taskModal.querySelector('[name=title]').focus();
        });
        if (taskModal) {
          taskModal.onclick = event => { if (event.target === taskModal || event.target.closest('[data-task-close]')) closeTaskModal(); };
          taskModal.onkeydown = event => { if (event.key === 'Escape') closeTaskModal(); };
          $('spaceNewTask').onsubmit = async event => {
            event.preventDefault();
            const form = event.target, title = form.elements.title.value.trim(); if (!title) return;
            const dept = form.elements.dept.value, brief = form.elements.text.value.trim();
            const button = form.querySelector('button[type=submit]'); button.disabled = true; $('spaceNewTaskHint').textContent = 'Creating…';
            try {
              await api('/tasks', 'POST', { title, text: brief || title, projectId: p.id, milestoneId: form.elements.milestoneId.value || undefined,
                priority: Number(form.elements.priority.value), dueAt: form.elements.dueAt.value || undefined, backlog: form.elements.start.value === 'later',
                ...(dept ? { dept } : { dept: 'auto', depts: 'auto' }) });
              closeTaskModal(); projectTab = 'tasks';
              toast('Task added', { kind: 'ok', detail: form.elements.start.value === 'later' ? 'Saved for later; start it when you want it.' : 'The team has it.' });
              await editProject(p.id, teams);
            } catch (error) { button.disabled = false; $('spaceNewTaskHint').textContent = ''; feedback(error.message, true); }
          };
        }
        $('spaceWriteSummary').onclick = async event => {
          const button = event.currentTarget; button.disabled = true; $('spaceSummaryHint').textContent = 'The Program Manager is reading the project…';
          try { await api(`/projects/${p.id}/summary`, 'POST', {}); await editProject(p.id, teams); toast('Summary written', { kind: 'ok' }); }
          catch (error) { button.disabled = false; $('spaceSummaryHint').textContent = ''; feedback(error.message, true); }
        };
        content.querySelectorAll('[data-open-task]').forEach(b => b.onclick = () => openTask(b.dataset.openTask));
        content.querySelectorAll('[data-cancel-task]').forEach(b => b.onclick = async () => { if (!confirm('Cancel this task? Work in progress stops; nothing is filed.')) return; try { await api(`/tasks/${b.dataset.cancelTask}/cancel`, 'POST', {}); toast('Task cancelled', { kind: 'ok' }); await editProject(p.id, teams); } catch (error) { feedback(error.message, true); } });
        $('spaceDeleteProject').onclick = async () => { if (!confirm(`Delete “${p.name}”? Finished tasks are kept without the project; its files stay in the Brain under Projects/${p.id}/.`)) return; try { await api(`/projects/${p.id}`, 'DELETE'); dirty = false; toast(`Deleted “${p.name}”`, { kind: 'ok', detail: 'Its files are still in the Brain.' }); dropSummary(); await showProjects(); } catch (error) { feedback(error.message, true); } };
      }
    } catch (error) { feedback(error.message, true); }
  }

  /* ---------- Office Artifacts: every file every task produced, filtered by kind, date and words ---------- */
  const artFilter = { kind: 'documents', from: '', to: '', q: '' };
  async function showArtifacts() {
    try {
      const params = new URLSearchParams(Object.entries(artFilter).filter(([, v]) => v)).toString();
      const data = await api('/artifacts' + (params ? '?' + params : ''));
      if (section !== 'artifacts') return;
      const size = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B';
      const taskMark = st => mark(st === 'done' ? 'ok' : ['blocked', 'failed'].includes(st) ? 'fail' : st === 'waiting' ? 'warn' : ['working', 'planning', 'reviewing', 'saving'].includes(st) ? 'busy' : 'off', stateLabel(st));
      setMeta(mark('off', `${data.total} file${data.total === 1 ? '' : 's'}`));
      content.innerHTML = `<div class="mg-toolbar"><div class="mg-filters" id="artKinds">${[['documents', 'Documents'], ...data.kinds.map(k => [k.id, k.label]), ['', 'Everything']].map(([id, text]) => `<button type="button" data-kind="${esc(id)}" aria-pressed="${artFilter.kind === id}">${esc(text)}</button>`).join('')}</div><span class="mg-spacer"></span><label>From <input type="date" id="artFrom" value="${esc(artFilter.from)}"></label><label>To <input type="date" id="artTo" value="${esc(artFilter.to)}"></label>${search('artQ', 'File, task or team', artFilter.q)}</div>
        ${data.artifacts.length ? `<div class="mg-ledger-wrap"><table class="mg-ledger"><thead><tr><th>File</th><th>From the task</th><th>Team</th><th>State</th><th>When</th><th class="r"></th></tr></thead><tbody>${data.artifacts.map(r => `<tr><td>${fileIcon(r.name)} <span class="mg-name">${esc(r.name.split('/').pop())}</span><span class="mg-sub">${esc(size(r.bytes))}${r.name.includes('/') ? ' · ' + esc(r.name.slice(0, r.name.lastIndexOf('/'))) : ''}</span></td><td><button type="button" class="mg-link" data-open-task="${esc(r.taskId)}">${esc(r.taskTitle.slice(0, 90))}</button>${r.projectId ? `<span class="mg-sub">project ${esc(r.projectId)}</span>` : ''}</td><td><div class="mg-chips">${(r.teams.length ? r.teams : ['Program Manager']).map(t => `<span class="mg-chip mg-chip-ink">${esc(t)}</span>`).join('')}</div></td><td>${taskMark(r.taskState)}</td><td class="k">${esc(when(r.modifiedAt))}</td><td class="r"><a class="mg-btn mg-btn-sm" href="${esc(r.url)}" download style="text-decoration:none">Download</a></td></tr>`).join('')}</tbody></table></div>` : empty('No files match.', 'Loosen a filter, or give the teams a task that produces a document.')}`;
      const apply = () => { artFilter.from = $('artFrom').value; artFilter.to = $('artTo').value; artFilter.q = $('artQ').value.trim(); showArtifacts(); };
      $('artKinds').querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { artFilter.kind = b.dataset.kind; apply(); });
      $('artFrom').onchange = apply; $('artTo').onchange = apply;
      let timer = null; $('artQ').oninput = () => { clearTimeout(timer); timer = setTimeout(apply, 350); };
      content.querySelectorAll('[data-open-task]').forEach(b => b.onclick = () => openTask(b.dataset.openTask));
    } catch (error) { feedback(error.message, true); }
  }

  /* ---------- The Vault: secrets agents use without seeing them. Values are write-only: the screen only ever says whether one is stored. ---------- */
  let vaultEditing = null, vaultKind = '';
  async function showVault() {
    try {
      const [data, office] = await Promise.all([api('/vault'), api('/office')]);
      if (section !== 'vault') return;
      const teams = office.teams || [], kindLabel = { api: 'Outside service (API)', database: 'Database connection', ssh: 'SSH target' }, kindShort = { api: 'api', database: 'database', ssh: 'ssh' };
      const e = vaultEditing ? data.entries.find(x => x.id === vaultEditing) || { id: vaultEditing, kind: 'api', teams: [] } : null;
      const opt = (v, cur, text) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(text)}</option>`;
      const shown = data.entries.filter(x => !vaultKind || x.kind === vaultKind), noSecret = data.entries.filter(x => !x.hasSecret);
      const detailOf = x => x.kind === 'api' ? `${x.baseURL || ''}${x.authHeader ? ' · ' + x.authHeader + ': ' + (x.authPrefix || '').trim() : ''}` : `${x.engine ? x.engine + ' · ' : ''}${x.host || ''}${x.port ? ':' + x.port : ''}${x.database ? '/' + x.database : ''}${x.username ? ' · user ' + x.username : ''}${x.kind === 'ssh' ? ' · ' + (x.allow?.length ? 'allows: ' + x.allow.join(', ') : 'any command') : ''}`;
      const stateOf = x => !x.hasSecret ? mark('warn', 'No secret yet') : x.kind === 'database' ? mark('ok', x.readOnly === false ? 'Writable · you approve each write' : 'Read-only') : x.kind === 'ssh' ? (x.fingerprint ? mark('ok', 'Host key pinned') : mark('warn', 'Host key not pinned')) : mark('ok', 'Secret stored');
      setMeta(data.entries.length ? (noSecret.length ? mark('warn', `${noSecret.length} without a secret`) : mark('ok', `${data.entries.length} entr${data.entries.length === 1 ? 'y' : 'ies'}`)) : mark('off', 'Empty')); refreshMeta('vault', $('settingsMeta').firstElementChild?.outerHTML || '');
      content.innerHTML = `<div class="mg-toolbar"><div class="mg-filters">${[['', 'All'], ['api', 'Outside services'], ['database', 'Databases'], ['ssh', 'SSH targets']].map(([id, text]) => `<button type="button" data-vault-kind="${id}" aria-pressed="${vaultKind === id}">${text}</button>`).join('')}</div><span class="mg-spacer"></span><button type="button" id="vaultNew" class="mg-btn mg-btn-primary">+ Add entry</button></div>
        ${data.entries.length ? `<div class="mg-ledger-wrap"><table class="mg-ledger"><thead><tr><th>Entry</th><th>Kind</th><th>Secret</th><th>State</th><th>Teams</th><th class="r"></th></tr></thead><tbody>${shown.map(x => `<tr><td><span class="mg-name">${esc(x.name || x.id)}</span><span class="mg-sub">${esc(x.id)} · ${esc(detailOf(x))}</span>${x.notes ? `<span class="mg-sub" style="font-family:var(--ui)">${esc(x.notes)}</span>` : ''}</td><td class="k">${kindShort[x.kind] || esc(x.kind)}</td><td class="mg-key">${x.hasSecret ? `<span class="mg-mask">•••••••••••</span>${x.updatedAt ? ` <span class="mg-sub">set ${esc(when(x.updatedAt))}</span>` : ''}` : '<span class="mg-mask">none</span>'}</td><td>${stateOf(x)}</td><td><div class="mg-chips">${x.teams?.length ? x.teams.map(t => `<span class="mg-chip mg-chip-ink">${esc(teams.find(y => y.id === t)?.name || t)}</span>`).join('') : '<span class="mg-chip">every team</span>'}</div></td><td class="r"><button type="button" class="mg-btn mg-btn-sm" data-vault-edit="${esc(x.id)}">Edit</button> <button type="button" class="space-text-action" data-vault-remove="${esc(x.id)}">Remove</button></td></tr>`).join('') || '<tr><td colspan="6" class="mg-empty">Nothing of this kind yet.</td></tr>'}</tbody></table></div>` : empty('The Vault is empty.', 'Add the first entry: for example here.now, so the Website Publisher can publish a site.')}
        <p class="mg-intro">Reads run at once. <span class="mg-mono">api_request</span>, <span class="mg-mono">api_upload</span>, <span class="mg-mono">db_write</span> and <span class="mg-mono">ssh_run</span> pause for your approval. A connection that fails three times is paused for a minute.</p>
        ${e ? `<form id="vaultForm" data-dirty><div class="mg-card"><div class="mg-card-head"><h3>${esc(e.updatedAt ? 'Edit ' + (e.name || e.id) : 'New entry')}</h3><span class="mg-count">the secret is stored on the server and never shown again</span></div>
          <div class="mg-grid">${field('Id', `<input name="id" value="${esc(e.id === 'new' ? '' : e.id)}" ${e.updatedAt ? 'readonly' : ''} placeholder="here.now" required>`)}${field('Kind', `<select name="kind">${['api', 'database', 'ssh'].map(k => opt(k, e.kind || 'api', kindLabel[k])).join('')}</select>`)}${field('Name', `<input name="name" value="${esc(e.name || '')}" placeholder="here.now (website hosting)">`)}</div>
          <div class="mg-grid" data-kind="api" style="margin-top:14px">${field('Base URL', `<input name="baseURL" value="${esc(e.baseURL || '')}" placeholder="https://here.now/api/v1">`)}${field('Header', `<input name="authHeader" value="${esc(e.authHeader || 'Authorization')}">`)}${field('Prefix', `<input name="authPrefix" value="${esc(e.authPrefix ?? 'Bearer ')}">`)}</div>
          <div class="mg-grid" data-kind="database ssh" hidden style="margin-top:14px">${field('Host', `<input name="host" value="${esc(e.host || '')}">`)}${field('Port', `<input name="port" type="number" value="${esc(e.port || '')}">`)}${field('User', `<input name="username" value="${esc(e.username || '')}">`)}<label class="mg-field" data-kind="database"><span>Database</span><input name="database" value="${esc(e.database || '')}"></label><label class="mg-field" data-kind="database"><span>Engine</span><select name="engine">${[['postgres', 'Postgres'], ['mysql', 'MySQL / MariaDB']].map(([k, text]) => opt(k, /mysql|maria/i.test(e.engine || '') ? 'mysql' : 'postgres', text)).join('')}</select></label></div>
          <div data-kind="database" style="margin-top:10px">${check(`<input type="checkbox" class="mg-switch" name="readOnly" ${e.readOnly === false ? '' : 'checked'}>`, 'Read-only: agents may only read from it', 'Switch off to let db_write change data, each statement approved by you first.')}</div>
          <div data-kind="ssh" style="margin-top:10px">${field('Allowed commands — one prefix per line', `<textarea name="allow" rows="3">${esc((e.allow || []).join('\n'))}</textarea>`, 'Such as git pull or systemctl status. Empty means any command; you approve every command either way.')}${field('Host key fingerprint', `<input name="fingerprint" value="${esc(e.fingerprint || '')}" placeholder="SHA256:…">`, 'Optional: from ssh-keygen -lf. When set, a host whose key differs is refused.')}</div>
          <div style="margin-top:10px">${field(`Secret <span class="mg-muted">(${e.hasSecret ? 'stored; leave blank to keep it' : 'the key, password or private key'})</span>`, `<textarea name="secret" rows="2" autocomplete="off" placeholder="${e.hasSecret ? '••••••••' : ''}"></textarea>`)}</div>
          <h4 class="mg-eyebrow" style="margin:6px 0 8px">Teams that may use it <span style="text-transform:none;letter-spacing:0">(none = every team)</span></h4><div class="mg-picks">${teams.map(t => check(`<input type="checkbox" class="mg-switch" name="teams" value="${esc(t.id)}" ${e.teams?.includes(t.id) ? 'checked' : ''}>`, esc(t.name))).join('')}</div>
          ${field('Notes for the agents', `<input name="notes" value="${esc(e.notes || '')}" placeholder="Publishes static sites; the flow is create → upload → finalize">`)}
          ${saveBar({ hint: 'Agents can use it from the next task.', label: 'Save entry', extra: `${e.hasSecret ? '<button type="button" class="mg-btn mg-btn-danger" id="vaultClear">Remove secret</button>' : ''}<button type="button" class="mg-btn" id="vaultCancel">Cancel</button>` })}</div></form>` : ''}`;
      content.querySelectorAll('[data-vault-kind]').forEach(b => b.onclick = () => { vaultKind = b.dataset.vaultKind; showVault(); });
      $('vaultNew').onclick = () => { vaultEditing = 'new'; showVault().then(() => $('vaultForm')?.scrollIntoView({ block: 'start', behavior: 'smooth' })); };
      content.querySelectorAll('[data-vault-edit]').forEach(b => b.onclick = () => { vaultEditing = b.dataset.vaultEdit; showVault().then(() => $('vaultForm')?.scrollIntoView({ block: 'start', behavior: 'smooth' })); });
      content.querySelectorAll('[data-vault-remove]').forEach(b => b.onclick = async () => { if (!confirm(`Remove “${b.dataset.vaultRemove}” from the Vault? Agents lose access at once.`)) return; try { await api(`/vault/${encodeURIComponent(b.dataset.vaultRemove)}`, 'DELETE'); vaultEditing = null; toast('Removed from the Vault', { kind: 'ok', detail: 'Agents lost access at once.' }); dropSummary(); showVault(); } catch (error) { feedback(error.message, true); } });
      const form = $('vaultForm');
      if (form) {
        const showKind = () => { const k = form.elements.kind.value; form.querySelectorAll('[data-kind]').forEach(el => { el.hidden = !el.dataset.kind.split(' ').includes(k); }); };
        form.elements.kind.onchange = showKind; showKind();
        $('vaultCancel').onclick = () => { vaultEditing = null; dirty = false; showVault(); };
        if ($('vaultClear')) $('vaultClear').onclick = async () => { try { await api(`/vault/${encodeURIComponent(e.id)}`, 'PUT', { clearSecret: true }); toast('Secret removed', { kind: 'ok' }); showVault(); } catch (error) { feedback(error.message, true); } };
        form.onsubmit = async event => {
          event.preventDefault(); const f = form.elements, id = (f.id.value || '').trim();
          const payload = { kind: f.kind.value, name: f.name.value, baseURL: f.baseURL.value, authHeader: f.authHeader.value, authPrefix: f.authPrefix.value, host: f.host.value, port: f.port.value ? Number(f.port.value) : undefined, username: f.username.value, database: f.database.value, engine: f.engine.value, readOnly: f.readOnly.checked, allow: f.allow.value.split('\n').map(s => s.trim()).filter(Boolean), fingerprint: f.fingerprint.value, secret: f.secret.value, teams: [...form.querySelectorAll('input[name=teams]:checked')].map(el => el.value), notes: f.notes.value };
          try { await runSave(barOf(form), () => api(`/vault/${encodeURIComponent(id)}`, 'PUT', payload), { ok: `“${id}” saved to the Vault`, sub: 'Agents can use it from the next task.' }); vaultEditing = null; showVault(); } catch {}
        };
      }
    } catch (error) { feedback(error.message, true); }
  }

  /* ---------- Skills: the library of methods ---------- */
  async function showSkills(editId = null) {
    try {
      config = await api('/office');
      const skill = config.skills.find(s => s.id === editId);
      const holders = id => ({ teams: config.teams.filter(t => t.skills?.includes(id)), agents: config.agents.filter(a => a.skills?.includes(id)) });
      setMeta(mark('off', `${config.skills.length} skill${config.skills.length === 1 ? '' : 's'}`)); refreshMeta('skills', mark('off', `${config.skills.length} skill${config.skills.length === 1 ? '' : 's'}`));
      content.innerHTML = `<div class="mg-toolbar"><span class="mg-count">${config.skills.length} in the library</span><span class="mg-spacer"></span><button type="button" class="mg-btn" id="spaceSkillAgency">Add a method from the Agency</button><button type="button" class="mg-btn mg-btn-primary" id="spaceNewSkill">+ New skill</button></div><div id="spaceAgencySkillPicker" hidden></div>
        ${config.skills.length ? `<div class="mg-ledger-wrap"><table class="mg-ledger"><thead><tr><th>Skill</th><th>When to use it</th><th>Given to</th><th class="r"></th></tr></thead><tbody>${config.skills.map(s => { const h = holders(s.id); return `<tr class="${s.id === editId ? 'mg-selected' : ''}"><td><span class="mg-name">${esc(s.name)}</span><span class="mg-sub">v${s.revision}${s.updatedAt ? ' · ' + esc(when(s.updatedAt)) : ''}</span></td><td style="max-width:36ch">${esc(s.description || '')}</td><td><div class="mg-chips">${h.teams.map(t => `<span class="mg-chip mg-chip-ink">${esc(t.name)}</span>`).join('')}${h.agents.map(a => `<span class="mg-chip">${esc(a.name)}</span>`).join('')}${h.teams.length + h.agents.length ? '' : '<span class="mg-muted">nobody yet</span>'}</div></td><td class="r"><button type="button" class="mg-btn mg-btn-sm" data-edit-skill="${esc(s.id)}">${s.id === editId ? 'Editing' : 'Edit'}</button></td></tr>`; }).join('')}</tbody></table></div>` : empty('No skills yet.', 'A skill is a named method: the steps, the shape of the result and the rules. Write one, or add a method from the Agency.')}
        <form id="spaceSkillForm" data-dirty ${skill || editId === 'new' ? '' : 'hidden'}><div class="mg-card"><div class="mg-card-head"><h3>${skill ? 'Edit skill' : 'New skill'}</h3>${skill ? `<span class="mg-count">v${skill.revision} · saving makes v${skill.revision + 1}; tasks keep the version they started with</span>` : '<span class="mg-count">give it to a team or a person under Teams &amp; people</span>'}</div>
          <div class="mg-grid">${field('Name', `<input name="name" value="${esc(skill?.name || '')}" required maxlength="100" placeholder="Weekly pipeline review">`)}${field('When to use it', `<input name="description" value="${esc(skill?.description || '')}" maxlength="500" placeholder="The trigger: “when a client asks for a quote”">`)}</div>
          <div style="margin-top:14px">${field('Method and the shape of the result', `<textarea name="instructions" rows="14" required maxlength="10000" placeholder="1. The steps, in order.&#10;2. What the finished thing looks like: sections, format, length.&#10;3. The rules: what must always and never happen.">${esc(skill?.instructions || '')}</textarea>`, 'Long reference material belongs in the Brain as notes; name them here.')}</div>
          ${saveBar({ hint: 'Give this skill to a team under Teams & people.', label: 'Save skill', extra: `${skill ? '<button class="mg-btn mg-btn-danger" type="button" id="spaceDeleteSkill">Remove</button>' : ''}<button class="mg-btn" type="button" id="spaceCancelSkill">Cancel</button>` })}</div></form>`;
      content.querySelectorAll('[data-edit-skill]').forEach(button => button.onclick = () => showSkills(button.dataset.editSkill).then(() => $('spaceSkillForm')?.scrollIntoView({ block: 'start', behavior: 'smooth' })));
      $('spaceNewSkill').onclick = () => showSkills('new').then(() => $('spaceSkillForm')?.elements.name.focus());
      $('spaceCancelSkill').onclick = () => { dirty = false; showSkills(); };
      $('spaceSkillAgency').onclick = () => agencyPicker($('spaceAgencySkillPicker'), { mode: 'skill', teams: config.teams, onDone: async r => { await showSkills(r.skill.id); toast(`Added “${r.skill.name}”`, { kind: 'ok', detail: `Assigned to: ${[...r.teams, ...r.agents].join(', ') || 'nobody yet'}.` }); } });
      $('spaceSkillForm').onsubmit = async event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.target)); const updated = { ...skill, ...values, id: skill?.id || 'skill-' + crypto.randomUUID().slice(0, 8) }; const next = structuredClone(config); next.skills = skill ? next.skills.map(s => s.id === skill.id ? updated : s) : [...next.skills, updated]; try { await runSave(barOf(event.target), () => api('/office', 'PUT', next), { ok: 'Skill saved', sub: skill ? 'New tasks use the new version.' : 'Give this skill to a team under Teams & people.' }); await showSkills(updated.id); } catch {} };
      if (skill) $('spaceDeleteSkill').onclick = async () => { if (!confirm(`Remove “${skill.name}” from the library and from every team and person?`)) return; const next = structuredClone(config); next.skills = next.skills.filter(s => s.id !== skill.id); for (const t of next.teams) t.skills = t.skills.filter(id => id !== skill.id); for (const a of next.agents) a.skills = a.skills.filter(id => id !== skill.id); try { await api('/office', 'PUT', next); dirty = false; await showSkills(); toast('Skill removed', { kind: 'ok', detail: 'Tasks already running keep their saved copy.' }); } catch (error) { feedback(error.message, true); } };
    } catch (error) { feedback(error.message, true); }
  }

  /* ---------- Routines ---------- */
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function timetable(routines) {
    const cells = []; // { day 0-6, at 'HH:MM', label, kind }
    for (const r of routines) {
      const w = r.when || {}; if (!w.kind) continue;
      const kind = r.paused ? 'off' : r.lastOutcome === 'missed' ? 'fail' : r.lastOutcome === 'waiting' || r.lastLate ? 'warn' : r.lastAt && !r.lastTaskId ? 'fail' : 'ok';
      const days = w.kind === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : w.kind === 'weekdays' || (w.kind === 'hourly' && w.weekdaysOnly) ? [1, 2, 3, 4, 5] : w.kind === 'weekly' ? (w.days || []) : [0, 1, 2, 3, 4, 5, 6];
      const at = w.kind === 'hourly' ? (w.from || '00:00') : (w.at || '09:00'), text = w.kind === 'hourly' ? `${at} every ${w.every || 1} h to ${w.to || '23:59'}` : `${at} ${r.title}`;
      for (const d of days) cells.push({ day: d, at, text, kind });
    }
    if (!cells.length) return '';
    const times = [...new Set(cells.map(c => c.at))].sort();
    const order = [1, 2, 3, 4, 5, 6, 0];
    return `<div class="mg-timetable" aria-hidden="true"><div class="hd"></div>${order.map(d => `<div class="hd">${DAYS[d]}</div>`).join('')}${times.map(t => `<div class="hr">${esc(t)}</div>${order.map(d => `<div class="col ${d >= 1 && d <= 5 ? 'wk' : ''}">${cells.filter(c => c.day === d && c.at === t).map(c => `<span class="mg-rt mg-rt-${c.kind}" title="${esc(c.text)}">${esc(c.text)}</span>`).join('')}</div>`).join('')}`).join('')}</div>`;
  }
  async function showRoutines() {
    try {
      const [data, office] = await Promise.all([api('/routines'), api('/office')]); config = office;
      const teamName = id => office.teams.find(t => t.id === id)?.name || DEPTS[id]?.name || id, personName = id => office.agents.find(a => a.id === id)?.name || id;
      const rs = data.routines, next = rs.filter(r => r.nextAt).sort((a, b) => a.nextAt - b.nextAt)[0];
      const lastMark = r => !r.lastAt ? mark('off', 'Never ran') : r.lastOutcome === 'missed' ? mark('fail', r.failures >= 2 ? `Missed ${r.failures} in a row` : 'Did not complete') : r.lastOutcome === 'waiting' ? mark('warn', 'Waits for your OK') : r.lastOutcome === 'cancelled' ? mark('off', 'Cancelled') : r.lastLate ? mark('warn', 'Ran late') : r.lastOutcome === 'done' ? mark('ok', 'Ran') : mark('busy', 'Running');
      setMeta(rs.length ? (rs.some(r => r.lastLate) ? mark('warn', 'One ran late') : mark('ok', `${rs.length} scheduled`)) : mark('off', 'None yet'), next ? `next run ${esc(when(next.nextAt))}` : ''); refreshMeta('routines', $('settingsMeta').firstElementChild?.outerHTML || '');
      content.innerHTML = `${data.problems?.length ? banner('fail', `<b>Some routines could not be read.</b><br>${data.problems.map(esc).join('<br>')}`) : ''}
        ${timetable(rs)}
        ${rs.length ? `<div class="mg-ledger-wrap"><table class="mg-ledger"><thead><tr><th>Routine</th><th>When</th><th>Runs as</th><th>Last run</th><th>Next</th><th>Before closing</th><th class="r"></th></tr></thead><tbody>${rs.map(r => `<tr><td><span class="mg-name">${esc(r.title)}</span>${r.text && r.text !== r.title ? `<span class="mg-sub" style="font-family:var(--ui)">${esc(r.text.slice(0, 120))}</span>` : ''}</td><td class="k">${esc(r.desc || '')}</td><td>${esc(personName(r.agent))}<span class="mg-sub">${esc(teamName(r.dept))}</span></td><td>${lastMark(r)}${r.lastAt ? `<span class="mg-sub">${esc(when(r.lastAt))} · ${r.runs} run${r.runs === 1 ? '' : 's'}</span>` : ''}</td><td class="k">${r.paused ? mark('off', 'Paused') : esc(when(r.nextAt))}</td><td>${r.needsOk ? mark('warn', 'Asks you') : mark('off', 'Lead approves')}</td><td class="r"><button type="button" class="mg-btn mg-btn-sm" data-routine-run="${esc(r.id)}">Run now</button> <button type="button" class="mg-btn mg-btn-sm" data-routine-pause="${esc(r.id)}" data-paused="${r.paused ? 1 : 0}">${r.paused ? 'Resume' : 'Pause'}</button> <button type="button" class="mg-btn mg-btn-sm" data-routine-ok="${esc(r.id)}" data-ok="${r.needsOk ? 1 : 0}">${r.needsOk ? 'Stop asking me' : 'Ask me first'}</button> ${r.lastTaskId ? `<button type="button" class="space-text-action" data-open-task="${esc(r.lastTaskId)}">Last task</button>` : ''} <button type="button" class="space-text-action" data-routine-remove="${esc(r.id)}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : empty('No routines yet.', 'Say when and what: “Every Monday at 9, list the overdue invoices and draft the reminders.”')}
        <form id="spaceRoutineForm" data-dirty><div class="mg-card"><div class="mg-card-head"><h3>New routine</h3><span class="mg-count">starts with the schedule: “every Monday at 9am, …”, “weekdays 17:30, …”, “daily at 8am, …”</span></div><div class="mg-grid">${field('Team', `<select name="dept">${office.teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>`)}${field('Runs as', `<select name="agent"></select>`)}</div>
        <div style="margin-top:14px">${field('When, and what to do', `<textarea name="text" rows="3" required placeholder="Every weekday at 8am, list yesterday's unanswered customer emails and draft replies."></textarea>`)}</div>
        ${check('<input type="checkbox" class="mg-switch" name="needsOk" checked>', 'Ask me before the result is closed', 'Actions that send, post or pay wait for you regardless.')}
        ${saveBar({ hint: 'The first run is scheduled at once.', label: 'Add routine' })}</div></form>`;
      const form = $('spaceRoutineForm'), people = () => { const dept = form.elements.dept.value, lead = office.teams.find(t => t.id === dept)?.lead; form.elements.agent.innerHTML = office.agents.filter(a => a.department === dept).map(a => `<option value="${a.id}" ${a.id === lead ? 'selected' : ''}>${esc(a.name)}${a.id === lead ? ' (lead)' : ''}</option>`).join(''); };
      form.elements.dept.onchange = people; people();
      form.onsubmit = async event => { event.preventDefault(); const f = form.elements; try { const r = await runSave(barOf(form), () => api('/routines', 'POST', { dept: f.dept.value, agent: f.agent.value, text: f.text.value, needsOk: f.needsOk.checked }), { ok: 'Routine added', sub: '' }); toast(`“${r.routine.title}” scheduled`, { kind: 'ok', detail: r.routine.desc }); await showRoutines(); } catch {} };
      const act = (attr, fn, done) => content.querySelectorAll(`[${attr}]`).forEach(b => b.onclick = async () => { b.disabled = true; try { const r = await fn(b.getAttribute(attr), b); if (r !== null) { dropSummary(); await showRoutines(); done?.(r, b); } else b.disabled = false; } catch (error) { feedback(error.message, true); b.disabled = false; } });
      act('data-routine-run', async id => { const r = await api(`/routines/${id}/run`, 'POST', {}); toast('Routine started', { kind: 'info', detail: 'The task is on the board.', action: r.task?.id ? { label: 'Open the task', onClick: () => openTask(r.task.id) } : null }); return r; });
      act('data-routine-pause', (id, b) => api(`/routines/${id}/${b.dataset.paused === '1' ? 'resume' : 'pause'}`, 'POST', {}), (r, b) => toast(b.dataset.paused === '1' ? 'Routine resumed' : 'Routine paused', { kind: 'ok' }));
      act('data-routine-ok', (id, b) => api(`/routines/${id}`, 'POST', { needsOk: b.dataset.ok !== '1' }), (r, b) => toast(b.dataset.ok !== '1' ? 'It will ask you before closing' : 'It closes on the lead’s approval', { kind: 'ok' }));
      act('data-routine-remove', id => confirm('Remove this routine?') ? api(`/routines/${id}`, 'DELETE') : null, () => toast('Routine removed', { kind: 'ok' }));
      content.querySelectorAll('[data-open-task]').forEach(b => b.onclick = () => openTask(b.dataset.openTask));
    } catch (error) { feedback(error.message, true); }
  }

  /* ---------- Reports & KPIs ---------- */
  async function showReports() {
    try {
      const [report, k] = await Promise.all([api('/reports?days=' + reportDays), api('/kpis?days=' + reportDays)]);
      if (section !== 'reports') return;
      const number = value => Number(value || 0).toLocaleString(), max = Math.max(1, ...k.throughput.series.map(s => s.done));
      const tile = (value, text) => `<div class="mg-kpi"><b>${value}</b><span>${text}</span></div>`;
      const jobMark = j => mark(j.state === 'done' ? 'ok' : ['blocked', 'failed'].includes(j.state) ? 'fail' : j.state === 'waiting' ? 'warn' : ['working', 'planning', 'reviewing'].includes(j.state) ? 'busy' : 'off', j.state === 'done' ? 'Passed' : stateLabel(j.state));
      setMeta(k.needsYou ? mark('warn', `${k.needsYou} need you`) : mark('ok', 'Nothing waits on you'), `${number(k.throughput.done)} done · ${reportDays ? 'past ' + reportDays + ' days' : 'all time'}`);
      content.innerHTML = `<div class="mg-toolbar"><div class="mg-filters">${[[7, 'Past 7 days'], [30, 'Past 30 days'], [90, 'Past 90 days'], [0, 'All time']].map(([days, text]) => `<button type="button" data-days="${days}" aria-pressed="${days === reportDays}">${text}</button>`).join('')}</div><span class="mg-spacer"></span><button type="button" class="mg-btn" id="spaceReportRefresh">Refresh</button><button type="button" class="mg-btn" id="spaceExportReport">Export report</button></div>
        <div class="mg-kpis">${tile(number(k.throughput.done), `tasks done · ${k.throughput.perDay} a day`)}${tile(duration(k.cycle.p50), `typical time to done · slowest 10% ${duration(k.cycle.p90)}`)}${tile(duration(k.leadReviewMs), 'average wait for a lead review')}${tile(duration(k.ceoLatencyMs), 'your average response time')}${tile(k.reworkRate == null ? '—' : Math.round(k.reworkRate * 100) + '%', 'of reviewed work sent back')}${tile(number(k.needsYou), 'need you now')}${tile(number(k.overdue), 'overdue')}${tile(duration(k.blockedAgeMs), 'longest wait on you')}</div>
        ${k.throughput.series.length ? `<div class="mg-card"><div class="mg-bars" aria-label="Tasks done per day">${k.throughput.series.map(s => `<i style="height:${Math.round(100 * s.done / max)}%" title="${esc(s.day)}: ${s.done}"></i>`).join('')}</div><span class="mg-count">tasks done per day</span></div>` : ''}
        <div class="mg-card"><div class="mg-card-head"><h3>Teams</h3></div><div class="mg-ledger-wrap" style="margin:0"><table class="mg-ledger"><thead><tr><th>Team</th><th>Done</th><th>Active</th><th>Blocked</th><th>Calls</th><th>Tokens</th><th>Typical cycle</th></tr></thead><tbody>${report.teams.map(t => `<tr><td class="mg-name">${esc(t.name)}</td><td class="k">${t.approved}</td><td class="k">${t.active}</td><td class="k">${t.blocked ? mark('fail', t.blocked) : '0'}</td><td class="k">${number(t.calls)}</td><td class="k">${number(t.tokens)}</td><td class="k">${duration(t.medianCycleMs)}</td></tr>`).join('')}</tbody></table></div></div>
        <div class="mg-card"><div class="mg-card-head"><h3>People</h3></div><div class="mg-ledger-wrap" style="margin:0"><table class="mg-ledger"><thead><tr><th>Person</th><th>Working now</th><th>Runs</th><th>Average run</th></tr></thead><tbody>${k.agents.filter(a => a.runs || a.active).map(a => `<tr><td class="mg-name">${esc(a.name)}</td><td class="k">${a.active ? mark('busy', a.active) : '0'}</td><td class="k">${a.runs}</td><td class="k">${duration(a.avgRunMs)}</td></tr>`).join('') || '<tr><td colspan="4" class="mg-empty">No runs in this period.</td></tr>'}</tbody></table></div></div>
        ${Object.keys(k.tokensByModel || {}).length ? `<div class="mg-card"><div class="mg-card-head"><h3>Tokens by model</h3></div><div class="mg-ledger-wrap" style="margin:0"><table class="mg-ledger"><tbody>${Object.entries(k.tokensByModel).sort((a, b) => b[1] - a[1]).map(([m, n]) => `<tr><td class="k">${esc(m)}</td><td class="k r">${number(n)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
        <div class="mg-card"><div class="mg-card-head"><h3>Needs attention</h3><span class="mg-count">${report.attention.length}</span></div>${report.attention.length ? `<div class="mg-ledger-wrap" style="margin:0"><table class="mg-ledger"><tbody>${report.attention.map(j => `<tr class="mg-row" data-report-job="${j.id}"><td><span class="mg-name">${esc(j.title)}</span><span class="mg-sub" style="font-family:var(--ui)">${esc(j.reason)}</span></td><td>${esc(j.teamName || DEPTS[j.dept]?.name || j.dept)}</td><td>${jobMark(j)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mg-intro" style="margin:0">Nothing is blocked or waiting for you in this period.</p>'}</div>
        <div class="mg-card"><div class="mg-card-head"><h3>Test results</h3><span class="mg-count">${report.tests.approved}/${report.tests.total} passed · ${report.tests.active} running or queued · ${report.tests.blocked} blocked</span></div>${report.suites.map(suite => `<details class="mg-fold"><summary>${esc(DEPTS[suite.dept]?.name || suite.dept)}<small>${esc(when(suite.createdAt))}</small></summary><div class="mg-fold-body"><table class="mg-ledger"><tbody>${suite.jobs.map(j => `<tr class="mg-row" data-report-job="${j.id}"><td class="mg-name">${esc(j.name)}</td><td>${jobMark(j)}${j.error ? `<span class="mg-sub">${esc(j.error)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div></details>`).join('') || '<p class="mg-intro" style="margin:0">No test suites in this period.</p>'}</div>
        <div class="mg-card"><div class="mg-card-head"><h3>Finished work</h3><span class="mg-count">${report.completed.length}</span></div>${report.completed.length ? `<div class="mg-ledger-wrap" style="margin:0"><table class="mg-ledger"><tbody>${report.completed.map(j => `<tr class="mg-row" data-report-job="${j.id}"><td class="mg-name">${esc(j.title)}</td><td>${esc(j.teamName || DEPTS[j.dept]?.name || j.dept)}</td><td class="k r">${esc(when(j.doneAt))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mg-intro" style="margin:0">Nothing finished in this period.</p>'}</div>`;
      content.querySelectorAll('[data-days]').forEach(b => b.onclick = () => { reportDays = Number(b.dataset.days); showReports(); });
      $('spaceReportRefresh').onclick = () => showReports();
      content.querySelectorAll('[data-report-job]').forEach(button => button.onclick = () => openTask(button.dataset.reportJob));
      $('spaceExportReport').onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify({ report, kpis: k }, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'office-report-' + new Date(report.generatedAt).toISOString().slice(0, 10) + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Report exported', { kind: 'ok', detail: link.download }); };
    } catch (error) { feedback(error.message, true); }
  }

  /* ---------- Brain ---------- */
  let brainFolder = '', brainQuery = '';
  async function showBrain() {
    try {
      const [notes, folders, status] = await Promise.all([api('/knowledge'), api('/knowledge/folders'), api('/knowledge/status').catch(() => null)]);
      if (section !== 'brain') return;
      const count = f => notes.filter(n => n.id.startsWith(f + '/')).length;
      const indexMark = status ? mark('ok', `Index fresh · ${Number(status.notes ?? notes.length).toLocaleString()} notes${status.passages != null ? ' · ' + Number(status.passages).toLocaleString() + ' passages' : ''}`) : mark('warn', 'Index status unknown');
      setMeta(indexMark, status?.builtAt || status?.updatedAt ? `updated ${esc(when(status.builtAt || status.updatedAt))}` : `${esc(status?.backend || '')}`); refreshMeta('brain', indexMark);
      content.innerHTML = `<div class="mg-toolbar"><form id="spaceSearchForm" class="mg-search" style="flex:1;max-width:520px">${SEARCH_ICON}<input name="q" type="search" placeholder="What do we know about…" value="${esc(brainQuery)}" aria-label="Search the Brain"></form><span class="mg-spacer"></span><button type="button" class="mg-btn" id="spacePurpose">Office purpose</button><button type="button" class="mg-btn" id="spaceGraph">View the map</button><button type="button" class="mg-btn" id="spaceReindex">Rebuild index</button><button type="button" class="mg-btn mg-btn-primary" id="spaceNewNote">+ Add note</button></div>
        <div class="mg-brain"><div class="mg-folders"><button type="button" data-folder="" aria-pressed="${!brainFolder}">All notes<span class="mg-n">${notes.length}</span></button>${folders.map(f => `<button type="button" data-folder="${esc(f)}" aria-pressed="${f === brainFolder}">${esc(f)}<span class="mg-n">${count(f)}</span></button>`).join('')}</div>
        <div><form id="spaceUploadForm" class="mg-upload"><select name="folder" aria-label="Folder" style="border:1px solid var(--mg-line2);border-radius:6px;padding:6px 8px;background:var(--mg-card);color:var(--ink);font:12px var(--ui)">${folders.map(f => `<option ${f === (brainFolder || 'Company') ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select><input type="file" name="files" multiple accept=".pdf,.docx,.txt,.md,.csv"><button type="submit" class="mg-btn mg-btn-sm">Upload</button><small>PDF, Word, text, Markdown or CSV · up to 25 MB each. A file with the same name replaces the old one and archives it.</small></form>
        <div id="spaceSearchResults"></div><div class="mg-toolbar" style="margin-bottom:10px"><span class="mg-count" id="spaceNoteCount"></span><span class="mg-spacer"></span>${search('spaceFindNote', 'Filter by title or text')}</div><div id="spaceKnowledgeList"></div></div></div>`;
      const list = () => { const query = $('spaceFindNote').value.toLowerCase(); const rows = notes.filter(n => (!brainFolder || n.id.startsWith(brainFolder + '/')) && (n.title + ' ' + n.preview).toLowerCase().includes(query)); $('spaceNoteCount').textContent = `${rows.length} note${rows.length === 1 ? '' : 's'}${brainFolder ? ' in ' + brainFolder : ''}`; $('spaceKnowledgeList').innerHTML = rows.length ? `<div class="mg-ledger-wrap"><table class="mg-ledger"><thead><tr><th>Note</th><th>Folder</th><th>Updated</th></tr></thead><tbody>${rows.slice(0, 200).map(n => `<tr class="mg-row" data-note="${esc(n.id)}"><td><span class="mg-name">${esc(n.title)}</span><span class="mg-snippet">${esc(n.preview.slice(0, 160))}</span></td><td><span class="mg-chip">${esc(n.id.split('/').slice(0, -1).join('/') || 'Brain')}</span></td><td class="k">${esc(when(n.updatedAt))}</td></tr>`).join('')}</tbody></table></div>${rows.length > 200 ? '<p class="mg-intro">Showing the first 200. Narrow the filter to see the rest.</p>' : ''}` : empty('No notes here yet.', 'Upload a document, or add a note.'); $('spaceKnowledgeList').querySelectorAll('[data-note]').forEach(b => b.onclick = () => viewNote(b.dataset.note)); };
      $('spaceFindNote').oninput = list; content.querySelectorAll('[data-folder]').forEach(b => b.onclick = () => { brainFolder = b.dataset.folder; content.querySelectorAll('[data-folder]').forEach(x => x.setAttribute('aria-pressed', x === b)); $('spaceUploadForm').elements.folder.value = brainFolder || 'Company'; list(); }); list();
      $('spaceNewNote').onclick = () => editNote(); $('spacePurpose').onclick = () => editNote('Knowledge/office-purpose.md', true);
      $('spaceGraph').onclick = () => { close(); brain?.toggle?.(); };
      $('spaceReindex').onclick = async event => { const b = event.currentTarget; b.disabled = true; b.innerHTML = '<span class="mg-spin"></span>Rebuilding'; setMeta(mark('busy', 'Rebuilding the index…')); try { const r = await api('/knowledge/reindex', 'POST', {}); toast('Search index rebuilt', { kind: 'ok', detail: `From ${r.notes} notes.` }); await showBrain(); } catch (error) { feedback(error.message, true); b.disabled = false; b.textContent = 'Rebuild index'; } };
      $('spaceUploadForm').onsubmit = async event => {
        event.preventDefault(); const form = event.target, files = [...form.elements.files.files], button = form.querySelector('button'); if (!files.length) return feedback('Choose at least one file.', true);
        button.disabled = true; button.innerHTML = '<span class="mg-spin"></span>Uploading';
        try {
          const done = [];
          for (const file of files) { if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} is larger than 25 MB.`); toast(`Reading ${file.name}…`, { kind: 'info', ms: 2500 }); const r = await api('/knowledge/upload', 'POST', { folder: form.elements.folder.value, name: file.name, data: await readFile(file) }); done.push(`${r.id}${r.replaced ? ' (replaced)' : ''}`); }
          await syncBrain?.(); dropSummary(); await showBrain(); toast(`Added to the Brain: ${done.length} file${done.length === 1 ? '' : 's'}`, { kind: 'ok', detail: `${done.join(', ')}. Agents can search it now.` });
        } catch (error) { feedback(error.message, true); button.disabled = false; button.textContent = 'Upload'; }
      };
      const runSearch = async q => {
        brainQuery = q; if (!q) { $('spaceSearchResults').innerHTML = ''; return; }
        $('spaceSearchResults').innerHTML = `<p class="mg-intro">${mark('busy', 'Searching…')}</p>`;
        try {
          const r = await api('/knowledge/search?q=' + encodeURIComponent(q) + (brainFolder ? '&folder=' + encodeURIComponent(brainFolder) : ''));
          const hits = Array.isArray(r) ? r : r.results || r.hits || [];
          $('spaceSearchResults').innerHTML = `<div class="mg-card"><div class="mg-card-head"><h3>Results for “${esc(q)}”</h3><span class="mg-count">${hits.length} hit${hits.length === 1 ? '' : 's'}${brainFolder ? ' in ' + esc(brainFolder) : ''}</span><button type="button" class="mg-btn mg-btn-sm" id="spaceClearSearch" style="margin-left:auto">Clear</button></div>${hits.length ? `<div class="mg-ledger-wrap" style="margin:0"><table class="mg-ledger"><tbody>${hits.map(h => `<tr class="mg-row" data-note="${esc(h.id || h.path)}"><td><span class="mg-name">${esc(h.title || h.id || h.path)}</span><span class="mg-snippet">${esc(String(h.snippet || h.text || '').slice(0, 300))}</span></td><td class="k r">${esc(h.id || h.path)}${h.score != null ? `<span class="mg-sub">match ${Number(h.score).toFixed(2)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mg-intro" style="margin:0">Nothing in the Brain matches that yet.</p>'}</div>`;
          $('spaceClearSearch').onclick = () => { $('spaceSearchForm').elements.q.value = ''; runSearch(''); };
          $('spaceSearchResults').querySelectorAll('[data-note]').forEach(b => b.onclick = () => viewNote(b.dataset.note));
        } catch (error) { $('spaceSearchResults').innerHTML = ''; feedback(error.message, true); }
      };
      $('spaceSearchForm').onsubmit = event => { event.preventDefault(); runSearch(event.target.elements.q.value.trim()); };
      if (brainQuery) runSearch(brainQuery);
      if (pendingNote) { const id = pendingNote; pendingNote = null; viewNote(id); }
    } catch (error) { feedback(error.message, true); }
  }
  async function viewNote(id) {
    try {
      const note = await api('/knowledge/note?id=' + encodeURIComponent(id));
      setMeta(mark('off', 'Note'), `updated ${esc(when(note.updatedAt))}`);
      content.innerHTML = `<div class="mg-toolbar"><button type="button" class="mg-btn mg-btn-sm" id="spaceBackMemory">← Brain</button><span class="mg-count">${esc(id)}</span><span class="mg-spacer"></span><button type="button" class="mg-btn mg-btn-sm" id="spaceEditMemory">Edit note</button></div><article class="space-document mg-doc">${renderDocument(note.content.slice(0, 200000), 'memory').html}</article>`;
      $('spaceBackMemory').onclick = showBrain; $('spaceEditMemory').onclick = () => editNote(id); main.scrollTop = 0;
    } catch (error) { feedback(error.message, true); }
  }
  async function editNote(id, purpose = false) {
    let note = { content: '', id };
    try { if (id) note = await api('/knowledge/note?id=' + encodeURIComponent(id)); } catch (error) { if (!purpose) return feedback(error.message, true); }
    setMeta(mark('off', purpose ? 'Office purpose' : id ? 'Editing' : 'New note'));
    content.innerHTML = `<div class="mg-toolbar"><button type="button" class="mg-btn mg-btn-sm" id="spaceBackKnowledge">← Brain</button>${id ? `<span class="mg-count">${esc(id)}</span>` : ''}</div><form id="spaceNoteForm" data-dirty><div class="mg-card"><div class="mg-card-head"><h3>${purpose ? 'Office purpose' : id ? 'Edit note' : 'New note'}</h3>${purpose ? '<span class="mg-count">read by every planner before work</span>' : ''}</div>${field('Title', `<input name="title" value="${esc(purpose ? 'Office purpose' : note.content.match(/^#\s+(.+)$/m)?.[1] || '')}" required>`)}${field(purpose ? 'The business, who you serve, what the teams should achieve, and the constraints' : 'Content, in Markdown', `<textarea name="content" rows="18" required style="font-family:var(--mg-mono);font-size:12.5px">${esc(note.content)}</textarea>`)}${saveBar({ hint: 'The next task can use it.', label: 'Save note', extra: id && note.updatedAt ? '<button type="button" class="mg-btn mg-btn-danger" id="spaceArchiveNote">Archive note</button>' : '' })}</div></form>`;
    $('spaceBackKnowledge').onclick = showBrain;
    $('spaceNoteForm').onsubmit = async event => { event.preventDefault(); const form = event.target; try { await runSave(barOf(form), () => api('/knowledge', 'POST', { id: note.id, title: form.elements.title.value, content: '# ' + form.elements.title.value.trim() + '\n\n' + form.elements.content.value.replace(/^#\s+.*(?:\r?\n)?/, '').trim(), updatedAt: note.updatedAt }), { ok: 'Note saved', sub: 'The next task can use it.' }); await syncBrain?.(); await showBrain(); } catch {} };
    if ($('spaceArchiveNote')) $('spaceArchiveNote').onclick = async () => { if (!confirm('Archive this note? Agents will stop finding it.')) return; try { await api('/knowledge/note?id=' + encodeURIComponent(id), 'DELETE'); dirty = false; await syncBrain?.(); await showBrain(); toast('Note archived', { kind: 'ok', detail: 'Agents no longer find it.' }); } catch (error) { feedback(error.message, true); } };
  }

  /* ---------- Audit ---------- */
  let auditArea = '';
  /* ---------- Users & groups (hosted): who signs in, their roles, and the groups tasks are shared with ---------- */
  async function showUsers() {
    try {
      const [u, g] = await Promise.all([api('/users'), api('/groups')]);
      if (section !== 'users') return;
      const me = USER, isOwner = me?.role === 'owner';
      const roleCell = x => x.role === 'owner' || !isOwner ? `<span class="mg-chip">${esc(x.role)}</span>` : `<select data-role="${esc(x.id)}" aria-label="Role of ${esc(x.name)}"><option value="member" ${x.role === 'member' ? 'selected' : ''}>member</option><option value="admin" ${x.role === 'admin' ? 'selected' : ''}>admin</option></select>`;
      const removable = x => x.role !== 'owner' && x.id !== me?.id && (isOwner || x.role === 'member');
      setMeta(mark('ok', `${u.users.length} people`), g.groups.length ? `${g.groups.length} group${g.groups.length === 1 ? '' : 's'}` : ''); refreshMeta('users', mark('ok', `${u.users.length} people`));
      content.innerHTML = `<div class="mg-card"><div class="mg-card-head"><h3>People</h3><span class="mg-count">${u.users.length} in this office · owner, admins and members</span></div>
        <div class="mg-ledger-wrap"><table class="mg-ledger"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last sign-in</th><th class="r"></th></tr></thead><tbody>${u.users.map(x => `<tr><td><span class="mg-name">${esc(x.name)}${x.id === me?.id ? ' <span class="mg-muted">(you)</span>' : ''}</span></td><td>${esc(x.email)}</td><td>${roleCell(x)}</td><td class="k">${x.lastLoginAt ? esc(ago(x.lastLoginAt)) : '—'}</td><td class="r">${removable(x) ? `<button type="button" class="mg-btn mg-btn-sm mg-btn-danger" data-remove-user="${esc(x.id)}">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
        <form id="inviteForm" class="mg-toolbar" style="margin-top:14px"><input name="email" type="email" required placeholder="colleague@company.com" aria-label="Email to invite" style="flex:1;min-width:220px"><select name="role" aria-label="Role"><option value="member">member</option>${isOwner ? '<option value="admin">admin</option>' : ''}</select><button type="submit" class="mg-btn mg-btn-primary">Invite</button></form>
        <div id="inviteResult"></div>
        ${u.invites.length ? `<h4 style="margin:14px 0 6px">Open invitations</h4><div class="mg-ledger-wrap"><table class="mg-ledger"><tbody>${u.invites.map(i => `<tr><td>${esc(i.email)}</td><td><span class="mg-chip">${esc(i.role)}</span></td><td class="k">expires ${esc(when(i.expiresAt))}</td><td class="r"><button type="button" class="mg-btn mg-btn-sm" data-revoke="${esc(i.hash)}">Revoke</button></td></tr>`).join('')}</tbody></table></div>` : ''}</div>
        <div class="mg-card"><div class="mg-card-head"><h3>Groups</h3><span class="mg-count">people you share tasks and projects with · not AI teams</span></div>
        ${g.groups.map(grp => `<details class="mg-fold"><summary>${esc(grp.name)}<small>${grp.users.length} people</small><span class="mg-open">Edit</span></summary><div class="mg-fold-body"><form data-group-form="${esc(grp.id)}">${field('Name', `<input name="name" value="${esc(grp.name)}" required maxlength="60">`)}<div class="mg-grid">${u.users.map(x => check(`<input type="checkbox" name="users" value="${esc(x.id)}" ${grp.users.includes(x.id) ? 'checked' : ''}>`, esc(x.name), esc(x.email))).join('')}</div><div class="mg-toolbar" style="margin:10px 0 0"><button type="submit" class="mg-btn mg-btn-primary mg-btn-sm">Save group</button><button type="button" class="mg-btn mg-btn-sm mg-btn-danger" data-delete-group="${esc(grp.id)}">Delete group</button></div></form></div></details>`).join('') || '<p class="mg-intro">No groups yet. A group is a set of people; sharing a task with the group shares it with everyone in it.</p>'}
        <form id="groupForm" class="mg-toolbar" style="margin-top:14px"><input name="name" required placeholder="Sales staff" aria-label="Group name" maxlength="60" style="flex:1;min-width:220px"><button type="submit" class="mg-btn mg-btn-primary">+ New group</button></form></div>`;
      $('inviteForm').onsubmit = async event => {
        event.preventDefault(); const f = event.target;
        try { const r = await api('/auth/invite', 'POST', { email: f.elements.email.value.trim(), role: f.elements.role.value }); $('inviteResult').innerHTML = banner('ok', `<b>Invitation for ${esc(r.email)}.</b> Send them this link; it works once and expires ${esc(when(r.expiresAt))}.<br><code style="user-select:all;word-break:break-all">${esc(r.link)}</code>`, `<button type="button" class="mg-btn mg-btn-sm" id="copyInvite">Copy link</button>`); $('copyInvite').onclick = () => navigator.clipboard?.writeText(r.link).then(() => toast('Link copied', { kind: 'ok' })).catch(() => {}); f.reset(); }
        catch (error) { feedback(error.message, true); }
      };
      content.querySelectorAll('[data-role]').forEach(sel => sel.onchange = async () => { try { await api('/users/' + sel.dataset.role, 'PUT', { role: sel.value }); toast('Role saved', { kind: 'ok' }); } catch (error) { feedback(error.message, true); await showUsers(); } });
      content.querySelectorAll('[data-remove-user]').forEach(b => b.onclick = async () => { if (!confirm('Remove this person from the office? Their tasks stay; they can no longer sign in here.')) return; try { await api('/users/' + b.dataset.removeUser, 'DELETE'); await showUsers(); } catch (error) { feedback(error.message, true); } });
      content.querySelectorAll('[data-revoke]').forEach(b => b.onclick = async () => { try { await api('/auth/invite/' + b.dataset.revoke, 'DELETE'); await showUsers(); } catch (error) { feedback(error.message, true); } });
      $('groupForm').onsubmit = async event => { event.preventDefault(); try { await api('/groups', 'POST', { name: event.target.elements.name.value.trim() }); await showUsers(); } catch (error) { feedback(error.message, true); } };
      content.querySelectorAll('[data-group-form]').forEach(f => f.onsubmit = async event => {
        event.preventDefault(); const id = f.dataset.groupForm, users = [...f.querySelectorAll('input[name=users]:checked')].map(i => i.value);
        try { await api('/groups/' + id, 'PUT', { name: f.elements.name.value.trim() }); await api(`/groups/${id}/members`, 'PUT', { users }); toast('Group saved', { kind: 'ok' }); await showUsers(); } catch (error) { feedback(error.message, true); }
      });
      content.querySelectorAll('[data-delete-group]').forEach(b => b.onclick = async () => { if (!confirm('Delete this group? Tasks shared with it are no longer shared through it.')) return; try { await api('/groups/' + b.dataset.deleteGroup, 'DELETE'); await showUsers(); } catch (error) { feedback(error.message, true); } });
    } catch (error) { feedback(error.message, true); }
  }

  /* ---------- Platform (platform admins): models and keys for every office, limits, registration, the offices, the people ---------- */
  let adminTab = 'models', adminQ = '';
  async function showAdmin() {
    try {
      const cfg = await api('/admin/config');
      if (section !== 'admin') return;
      content.innerHTML = `<nav class="mg-subnav" role="tablist" aria-label="Platform pages">${[['models', 'Models & keys'], ['mail', 'Mail'], ['limits', 'Settings'], ['tenants', 'Offices'], ['people', 'People']].map(([id, text]) => `<button type="button" class="mg-tab" data-admin-tab="${id}" aria-pressed="${adminTab === id}">${text}</button>`).join('')}</nav><div id="adminBody"></div>`;
      content.querySelectorAll('[data-admin-tab]').forEach(b => b.onclick = () => { adminTab = b.dataset.adminTab; showAdmin(); });
      const body = $('adminBody');
      setMeta(mark(cfg.mail.enabled ? 'ok' : 'warn', `${cfg.limits.maxTeams} teams × ${cfg.limits.maxMembersPerTeam} agents · mail ${cfg.mail.enabled ? 'on' : 'off'}`), `registration ${cfg.registration}`);
      if (adminTab === 'models') { body.innerHTML = banner('info', '<b>Every office runs on these.</b> Companies never see providers, keys or models; they inherit what is activated here.'); const inner = document.createElement('div'); body.appendChild(inner); await showModels('/admin/providers', inner); return; }
      if (adminTab === 'mail') {
        const m = cfg.mail;
        body.innerHTML = `${banner(m.enabled ? 'ok' : 'warn', m.enabled ? `<b>Mail is on.</b> ${m.dryRun ? 'Dry run: messages are written to the outbox file, nothing is sent.' : `Sending through ${esc(m.provider)}${m.domain ? ' from @' + esc(m.domain) : ''}.`}` : '<b>Mail is off.</b> Save a provider key (or switch on the dry run) and a mail domain; then every member gets an address that turns mail into tasks.')}
          <form id="mailForm" data-dirty novalidate><div class="mg-card"><div class="mg-card-head"><h3>Provider</h3><span class="mg-count">every office writes and receives through this account</span></div><div class="mg-grid">
            ${field('Provider', `<select name="provider"><option value="postmark" ${m.provider === 'postmark' ? 'selected' : ''}>Postmark</option><option value="mailgun" ${m.provider === 'mailgun' ? 'selected' : ''}>Mailgun</option></select>`)}
            ${field('API key', `<input name="apiKey" type="password" autocomplete="off" placeholder="${m.hasApiKey ? 'Stored · paste to replace' : 'Paste the key'}">${m.hasApiKey ? '<label class="mg-check" style="margin:6px 0 0;font-size:11px"><input type="checkbox" name="clearApiKey"> Remove the stored key</label>' : ''}`, 'Stored on the server, never shown again. Postmark: the server token. Mailgun: the private API key.')}
            ${field('Mail domain', `<input name="domain" value="${esc(m.domain || '')}" placeholder="mail.example.com">`, 'Members get <office>.<person>.<code>@this domain. Point its MX at the provider and add the DKIM and Return-Path records the provider shows.')}
            ${field('From address', `<input name="from" type="email" value="${esc(m.from || '')}" placeholder="office@${esc(m.domain || 'mail.example.com')}">`, 'Receipts, results and questions come from here. Blank means office@ the mail domain.')}
            ${field('Mailgun region', `<select name="region"><option value="us" ${m.region !== 'eu' ? 'selected' : ''}>US (api.mailgun.net)</option><option value="eu" ${m.region === 'eu' ? 'selected' : ''}>EU (api.eu.mailgun.net)</option></select>`, 'Postmark ignores this.')}
            ${field('Dry run', check('<input type="checkbox" name="dryRun" ' + (m.dryRun ? 'checked' : '') + '>', 'Write every outbound message to the outbox file instead of sending', 'For trying the flows without a provider account.'))}</div></div>
          <div class="mg-card"><div class="mg-card-head"><h3>Inbound webhook</h3><span class="mg-count">the provider posts incoming mail here</span></div><div class="mg-grid">
            ${field('Webhook secret', `<div class="mg-toolbar" style="margin:0"><input name="webhookSecret" type="password" autocomplete="off" placeholder="${m.hasWebhookSecret ? 'Stored · paste to replace' : 'Paste or generate one'}" style="flex:1"><button type="button" class="mg-btn mg-btn-sm" id="mailGenSecret">Generate</button></div>${m.hasWebhookSecret ? '<label class="mg-check" style="margin:6px 0 0;font-size:11px"><input type="checkbox" name="clearWebhookSecret"> Remove the stored secret</label>' : ''}`, 'Postmark: put it in the webhook URL as postmark:<secret>@. Mailgun: use the webhook signing key of your Mailgun account here, or send the X-AO-Webhook-Token header.')}
            ${field('Postmark inbound webhook URL', `<code style="user-select:all;word-break:break-all">${esc(cfg.webhooks.postmark.replace(/^(https?:\/\/)/, '$1postmark:<secret>@'))}</code>`, 'Postmark → Servers → Inbound → Webhook. MX: inbound.postmarkapp.com.')}
            ${field('Mailgun route', `<code style="user-select:all;word-break:break-all">forward("${esc(cfg.webhooks.mailgun)}")</code>`, 'Mailgun → Receiving → Routes: match_recipient(".*@<mail domain>") with this forward action. MX: mxa.mailgun.org and mxb.mailgun.org.')}</div>
            ${saveBar({ hint: 'Applies at once to every office.', label: 'Save mail settings', extra: `<button type="button" class="mg-btn" id="mailTestBtn" ${m.enabled ? '' : 'disabled'}>Send me a test</button>` })}</div></form>`;
        $('mailGenSecret').onclick = () => { const f = $('mailForm'); f.elements.webhookSecret.type = 'text'; f.elements.webhookSecret.value = cfg.secretSuggestion; dirty = true; setBar(barOf(f), 'dirty', 'Changes not saved', 'Copy the secret into the provider before you save, it is not shown again.'); };
        $('mailForm').onsubmit = async event => {
          event.preventDefault(); const f = event.target;
          const m2 = { provider: f.elements.provider.value, domain: f.elements.domain.value.trim(), from: f.elements.from.value.trim(), region: f.elements.region.value, dryRun: f.elements.dryRun.checked };
          if (f.elements.apiKey.value.trim()) m2.apiKey = f.elements.apiKey.value.trim(); if (f.elements.clearApiKey?.checked) m2.clearApiKey = true;
          if (f.elements.webhookSecret.value.trim()) m2.webhookSecret = f.elements.webhookSecret.value.trim(); if (f.elements.clearWebhookSecret?.checked) m2.clearWebhookSecret = true;
          try { await runSave(barOf(f), () => api('/admin/config', 'PUT', { mail: m2 }), { ok: 'Mail settings saved', sub: 'Every office uses them from now on.' }); await showAdmin(); } catch {}
        };
        $('mailTestBtn').onclick = async () => { try { const r = await api('/admin/mail/test', 'POST', {}); toast(r.dryRun ? 'Test written to the outbox (dry run)' : `Test sent to ${r.to}`, { kind: 'ok', detail: r.outbox || '' }); } catch (error) { feedback(error.message, true); } };
        return;
      }
      if (adminTab === 'limits') {
        body.innerHTML = `<form id="platformForm" data-dirty novalidate><div class="mg-card"><div class="mg-card-head"><h3>Limits</h3><span class="mg-count">apply to the next change in every office</span></div><div class="mg-grid">
          ${field('Maximum AI teams per office', `<input name="maxTeams" type="number" min="1" max="50" value="${cfg.limits.maxTeams}" required>`, 'From 1 to 50. An office already above a lowered number keeps working; its next change to teams is refused until it fits.')}
          ${field('Maximum agents per AI team', `<input name="maxMembersPerTeam" type="number" min="2" max="20" value="${cfg.limits.maxMembersPerTeam}" required>`, 'A lead and the specialists, from 2 to 20.')}</div></div>
          <div class="mg-card"><div class="mg-card-head"><h3>Registration and administrators</h3></div><div class="mg-grid">
          ${field('Who may create an office', `<select name="registration"><option value="open" ${cfg.registration === 'open' ? 'selected' : ''}>Anyone with the address (open)</option><option value="invite" ${cfg.registration === 'invite' ? 'selected' : ''}>Invitation only</option></select>`)}
          ${field('Platform administrator emails — one per line', `<textarea name="adminEmails" rows="4">${esc(cfg.adminEmails.join('\n'))}</textarea>`, 'These accounts see this panel. People flagged in the People tab count too.')}</div></div>
          <div class="mg-card"><div class="mg-card-head"><h3>Addresses and capacity</h3></div><div class="mg-grid">
          ${field('Public address', `<input name="publicOrigin" value="${esc(cfg.publicOrigin || '')}" placeholder="https://office.example.com">`, 'Links in mail and invitations point here. Blank uses this server’s own address.')}
          ${field('Minutes before an idle office is put away', `<input name="idleMinutes" type="number" min="1" max="1440" value="${cfg.tenants.idleMinutes}" required>`, 'An office with nothing running, nothing queued and nobody watching is closed after this long; a due routine wakes it.')}
          ${field('Offices loaded at once', `<input name="maxLoaded" type="number" min="1" max="500" value="${cfg.tenants.maxLoaded}" required>`, 'The oldest idle office is put away when a new one needs the room.')}</div>
          ${saveBar({ hint: 'Limits apply to the next change in every office.', label: 'Save platform settings' })}</div></form>`;
        $('platformForm').onsubmit = async event => { event.preventDefault(); const f = event.target; try { await runSave(barOf(f), () => api('/admin/config', 'PUT', { limits: { maxTeams: Number(f.elements.maxTeams.value), maxMembersPerTeam: Number(f.elements.maxMembersPerTeam.value) }, registration: f.elements.registration.value, adminEmails: lines(f.elements.adminEmails.value), publicOrigin: f.elements.publicOrigin.value.trim(), tenants: { idleMinutes: Number(f.elements.idleMinutes.value), maxLoaded: Number(f.elements.maxLoaded.value) } }), { ok: 'Platform settings saved', sub: 'Every office inherits them at its next change.' }); await showAdmin(); } catch {} };
        return;
      }
      if (adminTab === 'tenants') {
        const t = await api('/admin/tenants' + (adminQ ? '?q=' + encodeURIComponent(adminQ) : ''));
        body.innerHTML = `<div class="mg-toolbar">${search('tenantQ', 'Search offices', adminQ)}<span class="mg-spacer"></span><span class="mg-muted">${t.tenants.length} office${t.tenants.length === 1 ? '' : 's'}</span></div>
          <div class="mg-ledger-wrap"><table class="mg-ledger"><thead><tr><th>Office</th><th>Owner</th><th>People</th><th>Teams</th><th>Tasks</th><th>Tokens</th><th>State</th><th class="r"></th></tr></thead><tbody>${t.tenants.map(x => `<tr><td><span class="mg-name">${esc(x.name)}</span><span class="mg-sub">${esc(x.slug)} · since ${esc(when(x.createdAt))}</span></td><td>${esc(x.owner?.email || '—')}</td><td class="k">${x.users}</td><td class="k">${x.teams ?? '—'}</td><td class="k">${x.tasks == null ? '—' : `${x.openTasks} open · ${x.tasks}`}</td><td class="k">${x.tokens == null ? '—' : Number(x.tokens).toLocaleString()}</td><td>${x.suspendedAt ? mark('fail', 'Suspended') : x.loaded ? mark('ok', x.running ? `Working · ${x.running}` : 'Loaded') : mark('off', 'Put away')}</td><td class="r"><button type="button" class="mg-btn mg-btn-sm ${x.suspendedAt ? '' : 'mg-btn-danger'}" data-tenant="${esc(x.id)}" data-act="${x.suspendedAt ? 'resume' : 'suspend'}">${x.suspendedAt ? 'Resume' : 'Suspend'}</button></td></tr>`).join('') || '<tr><td colspan="8" class="mg-muted">No offices yet.</td></tr>'}</tbody></table></div>`;
        $('tenantQ').oninput = () => { adminQ = $('tenantQ').value; clearTimeout(statusPoll); statusPoll = setTimeout(showAdmin, 300); };
        body.querySelectorAll('[data-tenant]').forEach(b => b.onclick = async () => { if (b.dataset.act === 'suspend' && !confirm('Suspend this office? Its people are signed out and nothing runs until it is resumed.')) return; try { await api(`/admin/tenants/${b.dataset.tenant}/${b.dataset.act}`, 'POST', {}); await showAdmin(); } catch (error) { feedback(error.message, true); } });
        return;
      }
      const u = await api('/admin/users' + (adminQ ? '?q=' + encodeURIComponent(adminQ) : ''));
      body.innerHTML = `<div class="mg-toolbar">${search('userQ', 'Search people', adminQ)}<span class="mg-spacer"></span><span class="mg-muted">${u.users.length} shown</span></div>
        <div class="mg-ledger-wrap"><table class="mg-ledger"><thead><tr><th>Name</th><th>Email</th><th>Offices</th><th>Last sign-in</th><th class="r">Platform admin</th></tr></thead><tbody>${u.users.map(x => `<tr><td><span class="mg-name">${esc(x.name)}</span></td><td>${esc(x.email)}</td><td>${x.offices.map(o => `<span class="mg-chip">${esc(o.name)} · ${esc(o.role)}</span>`).join(' ') || '—'}</td><td class="k">${x.lastLoginAt ? esc(ago(x.lastLoginAt)) : '—'}</td><td class="r"><input type="checkbox" data-padmin="${esc(x.id)}" ${x.platformAdmin ? 'checked' : ''} ${x.id === USER?.id ? 'disabled' : ''} aria-label="Platform admin"></td></tr>`).join('')}</tbody></table></div>`;
      $('userQ').oninput = () => { adminQ = $('userQ').value; clearTimeout(statusPoll); statusPoll = setTimeout(showAdmin, 300); };
      body.querySelectorAll('[data-padmin]').forEach(c => c.onchange = async () => { try { await api('/admin/users/' + c.dataset.padmin, 'PUT', { platformAdmin: c.checked }); toast(c.checked ? 'Platform admin added' : 'Platform admin removed', { kind: 'ok' }); } catch (error) { feedback(error.message, true); c.checked = !c.checked; } });
    } catch (error) { feedback(error.message, true); }
  }

  async function showAudit() {
    try {
      const rows = await api('/audit?limit=200' + (auditArea ? '&area=' + auditArea : ''));
      if (section !== 'audit') return;
      const show = v => v === undefined ? '—' : esc(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 240);
      const AREAS = [['', 'Everything'], ['office', 'Teams & people'], ...(MANAGED_MODELS ? [] : [['providers', 'Models & keys']]), ['settings', 'Office settings'], ['tools', 'Connectors'], ['vault', 'Vault'], ['routines', 'Routines'], ['projects', 'Projects'], ['brain', 'Brain'], ...(HOSTED ? [['tasks', 'Sharing'], ['users', 'Users'], ['groups', 'Groups'], ['mail', 'Email']] : [])];
      setMeta(mark('off', `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`), rows[0] ? `last ${esc(when(rows[0].at))}` : '');
      content.innerHTML = `<div class="mg-toolbar"><div class="mg-filters">${AREAS.map(([id, text]) => `<button type="button" data-audit-area="${id}" aria-pressed="${id === auditArea}">${text}</button>`).join('')}</div><span class="mg-spacer"></span>${search('auditQ', 'Search entries')}</div>
        ${rows.length ? `<div class="mg-ledger-wrap"><table class="mg-ledger" id="auditTable"><thead><tr><th>#</th><th>When</th><th>Who</th><th>Area</th><th>What changed</th><th class="r"></th></tr></thead><tbody>${rows.map(r => `<tr class="mg-row" data-toggle="audit-${r.seq}" data-text="${esc((r.summary + ' ' + (r.actor || '') + ' ' + r.area).toLowerCase())}"><td class="k mg-muted">${r.seq}</td><td class="k">${esc(when(r.at))}</td><td>${esc(r.actor === 'ceo' ? 'you' : r.actor || 'office')}</td><td><span class="mg-chip">${esc(r.area)}</span></td><td>${esc(r.summary)}</td><td class="r mg-muted">${r.diff?.length ? `${r.diff.length} change${r.diff.length === 1 ? '' : 's'} ▾` : ''}</td></tr>${r.diff?.length ? `<tr id="audit-${r.seq}" hidden><td class="mg-diffcell" colspan="6"><pre class="mg-diff">${r.diff.slice(0, 40).map(d => `${esc(d.path || d.key || '')}\n${d.before !== undefined ? `<span class="del">- ${show(d.before)}</span>\n` : ''}${d.after !== undefined ? `<span class="add">+ ${show(d.after)}</span>` : ''}`).join('\n')}</pre></td></tr>` : ''}`).join('')}</tbody></table></div>` : empty('No changes recorded yet.', 'Every change through the office lands here, with what it was before.')}`;
      content.querySelectorAll('[data-audit-area]').forEach(b => b.onclick = () => { auditArea = b.dataset.auditArea; showAudit(); });
      content.querySelectorAll('[data-toggle]').forEach(r => r.onclick = () => { const d = document.getElementById(r.dataset.toggle); if (!d) return; d.hidden = !d.hidden; r.querySelector('td:last-child').textContent = r.querySelector('td:last-child').textContent.replace(/[▾▴]/, d.hidden ? '▾' : '▴'); });
      $('auditQ').oninput = () => { const q = $('auditQ').value.toLowerCase().trim(); content.querySelectorAll('[data-toggle]').forEach(r => { const hit = !q || r.dataset.text.includes(q); r.hidden = !hit; const d = document.getElementById(r.dataset.toggle); if (d && !hit) d.hidden = true; }); };
    } catch (error) { feedback(error.message, true); }
  }

  route();
  return { open, close, isOpen: () => !page.hidden, onEvent: (type, data) => { if (type === 'office.updated' && data?.area === 'tools' && section === 'tools' && $('spaceRefreshTools') && $('spaceToolEditor')?.hidden) showTools(); }, openNote: id => { pendingNote = id; open('brain'); if (section === 'brain') showBrain(); }, openProject: id => { pendingProject = id; open('projects'); if (section === 'projects') showProjects(); } };
}
