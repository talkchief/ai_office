// Settings as a full page, routed by the address bar (#/settings/<section>). While it is open the 3D office is
// hidden and paused, so scrolling here never moves the camera. Every existing screen lives here as a section.
import { DEPTS } from './data.js';
import { renderDocument } from './task-output.js';
import { stateLabel } from './labels.js';
import { fileIcon } from './fileicon.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const when = value => value ? new Date(value).toLocaleString() : '—';
const lines = value => String(value || '').split('\n').map(s => s.trim()).filter(Boolean);
const duration = ms => ms == null ? '—' : ms < 60000 ? Math.round(ms / 1000) + 's' : ms < 3600000 ? Math.round(ms / 60000) + ' min' : (ms / 3600000).toFixed(1) + ' h';
const SECTIONS = [['office', 'Office'], ['teams', 'Teams & people'], ['models', 'Models & keys'], ['tools', 'Tools & connectors'], ['skills', 'Skills'], ['projects', 'Projects'], ['artifacts', 'Office Artifacts'], ['routines', 'Routines'], ['reports', 'Reports & KPIs'], ['brain', 'Brain'], ['audit', 'Audit log']];
const readFile = file => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = reject; r.readAsDataURL(file); });

export function initSettings({ api, openTask, brain, syncBrain, onShow, onHide }) {
  const page = document.createElement('section');
  page.id = 'settingsPage'; page.hidden = true; page.setAttribute('aria-label', 'Settings');
  page.innerHTML = `<nav class="settings-nav" aria-label="Settings sections"><a href="#" class="settings-back" id="settingsBack">← Back to the office</a>${SECTIONS.map(([id, label]) => `<a href="#/settings/${id}" data-section="${id}">${label}</a>`).join('')}</nav>
    <div class="settings-main"><header><h2 id="settingsTitle"></h2></header><p id="settingsMessage" role="status"></p><div id="settingsContent"></div></div>`;
  document.body.appendChild(page);
  const $ = id => document.getElementById(id), content = $('settingsContent'), main = page.querySelector('.settings-main');
  let section = null, dirty = false, config = null, tools = [], providers = { models: [] }, draft = null, team = null, teamSection = 'overview', reportDays = 7, pendingNote = null, toolPoll = null, statusPoll = null, statusTries = 0;
  const feedback = (text, error = false) => { const m = $('settingsMessage'); m.textContent = text; m.classList.toggle('error', error); };
  content.addEventListener('input', event => { if (event.target.closest('form[data-dirty]') && !event.target.closest('.agency-picker')) dirty = true; });
  page.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape' && !event.target.closest('input,textarea,select')) close(); });
  $('settingsBack').onclick = event => { event.preventDefault(); close(); };
  const RENDER = { office: showOffice, teams: showTeams, models: showModels, tools: showTools, skills: showSkills, projects: showProjects, artifacts: showArtifacts, routines: showRoutines, reports: showReports, brain: showBrain, audit: showAudit };

  function route() {
    const match = location.hash.match(/^#\/settings(?:\/([\w-]+))?/);
    if (!match) { if (!page.hidden) hide(); return; }
    const next = RENDER[match[1]] ? match[1] : 'office';
    if (dirty && section && next !== section && !confirm('You have unsaved changes. Leave this page without saving them?')) { history.replaceState(null, '', '#/settings/' + section); return; }
    show(next);
  }
  function show(next) {
    dirty = false; section = next; stopPoll();
    if (page.hidden) { page.hidden = false; document.body.dataset.view = 'settings'; onShow?.(); }
    page.querySelectorAll('[data-section]').forEach(a => a.dataset.section === next ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
    $('settingsTitle').textContent = SECTIONS.find(s => s[0] === next)[1]; feedback(''); content.innerHTML = '<p>Loading…</p>'; main.scrollTop = 0;
    RENDER[next]();
  }
  function hide() { page.hidden = true; delete document.body.dataset.view; section = null; dirty = false; stopPoll(); onHide?.(); }
  function open(next = 'office') { const hash = '#/settings/' + next; if (location.hash === hash) route(); else location.hash = hash; }
  function close() {
    if (dirty && !confirm('You have unsaved changes. Leave settings without saving them?')) return;
    dirty = false; history.pushState(null, '', location.pathname + location.search); hide();
  }
  function stopPoll() { if (toolPoll) { clearInterval(toolPoll); toolPoll = null; } if (statusPoll) { clearTimeout(statusPoll); statusPoll = null; } }
  addEventListener('hashchange', route);
  window.addEventListener('office:open', event => { if (event.detail === 'models') open('models'); });
  const saved = message => { dirty = false; feedback(message); };

  /* ---------- Office ---------- */
  async function showOffice() {
    try {
      const [s, health] = await Promise.all([api('/settings'), api('/health')]);
      const num = (name, label, min, max, step, help) => `<label>${label}<input type="number" name="${name}" min="${min}" max="${max}" step="${step}" value="${esc(s[name])}"><small>${help}</small></label>`;
      content.innerHTML = `<p>How the whole office runs. Choices for one team live under Teams & people.</p><form id="setOffice" data-dirty><div class="space-grid">
        ${num('maxConcurrentJobs', 'Tasks running at once', 1, 8, 1, 'Across all teams. Each team also has its own pace.')}
        ${num('runTimeoutMinutes', 'Stop a run after this long without progress (minutes)', 1, 480, 1, 'A run that makes no progress for this long stops and tells you. A long task that keeps working is never stopped by this.')}
        ${num('escalateAfterHours', 'Remind me again after (hours)', 0.25, 72, 0.25, 'When something needs you and you have not acted.')}
        ${num('knowledgeSeedNotes', 'Brain notes handed to planners', 0, 20, 1, 'Agents can always search the Brain for more.')}
        <label>Daily digest time<input type="time" name="digestTime" value="${esc(s.digestTime)}"><small>The digest lands in your inbox and in the Brain under Digests.</small></label>
        <label>Public address<input name="publicOrigin" value="${esc(s.publicOrigin)}" placeholder="https://office.example.com"><small>Used for connector sign-in links. Leave blank to use this page's address.</small></label></div>
        <div class="space-settings-save"><span>${health.ready ? 'Models ready: the teams can work.' : 'Add a model key under Models & keys before work can start.'}</span><button type="submit">Save</button></div></form>`;
      $('setOffice').onsubmit = async event => {
        event.preventDefault(); const f = event.target.elements;
        try { await api('/settings', 'PUT', { maxConcurrentJobs: +f.maxConcurrentJobs.value, runTimeoutMinutes: +f.runTimeoutMinutes.value, escalateAfterHours: +f.escalateAfterHours.value, knowledgeSeedNotes: +f.knowledgeSeedNotes.value, digestTime: f.digestTime.value, publicOrigin: f.publicOrigin.value }); saved('Saved. New work uses these settings.'); }
        catch (error) { feedback(error.message, true); }
      };
    } catch (error) { feedback(error.message, true); }
  }

  /* ---------- Teams & people ---------- */
  async function showTeams() {
    try {
      [config, tools, providers] = await Promise.all([api('/office'), api('/tools'), api('/providers')]); draft = structuredClone(config);
      if (!draft.teams.some(t => t.id === team)) team = draft.teams[0].id;
      renderTeam();
    } catch (error) { feedback(error.message, true); }
  }
  const toolChoices = (selected, prefix) => tools.filter(t => t.type !== 'candidate').map(t => `<label class="space-check"><input type="checkbox" data-${prefix}="${esc(t.id)}" ${selected.includes(t.id) ? 'checked' : ''}>${esc(t.name)} <small>${esc(t.origin || t.type)}</small></label>`).join('');
  const skillChoices = (selected = [], prefix) => draft.skills.map(skill => `<label class="space-check"><input type="checkbox" data-${prefix}="${esc(skill.id)}" ${selected.includes(skill.id) ? 'checked' : ''}>${esc(skill.name)} <small>v${skill.revision}</small></label>`).join('');
  const ruleList = (rules, attr) => rules.length ? `<ul class="rule-list">${rules.map((r, i) => `<li><span>${esc(r.text)}${r.task ? ` <small>from “${esc(r.task)}”</small>` : ''}</span><button type="button" class="space-text-action" data-${attr}="${i}">Remove</button></li>`).join('')}</ul>` : '<p class="space-footnote">No standing rules yet. Tick “remember” when you correct work, or add one here.</p>';
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
      for (const name of ['name', 'role', 'does', 'brief', 'model', 'effort']) a[name] = fieldset.querySelector(`[data-field="${name}"]`).value;
      a.skills = [...fieldset.querySelectorAll('[data-agentskill]:checked')].map(el => el.dataset.agentskill);
      a.inheritTools = fieldset.querySelector('[data-field="inheritTools"]').checked;
      a.tools = [...fieldset.querySelectorAll('[data-agenttool]:checked')].map(el => el.dataset.agenttool);
    });
    t.tests = [...form.querySelectorAll('[data-test-editor]')].map(field => ({ id: field.dataset.testEditor, name: field.querySelector('[data-test-name]').value, prompt: field.querySelector('[data-test-prompt]').value, requiredText: lines(field.querySelector('[data-test-required]').value) }));
  }
  function renderTeam() {
    const t = draft.teams.find(x => x.id === team), agents = draft.agents.filter(a => a.department === t.id);
    t.rules ||= [];
    const models = (selected, inherit = 'Use the role default') => `<option value="">${inherit}</option>` + providers.models.filter(m => m.enabled !== false).map(m => `<option value="${esc(m.id)}" ${m.id === selected ? 'selected' : ''}>${esc(m.label || m.id)}</option>`).join('');
    const openAgents = [...content.querySelectorAll('[data-agent-editor][open]')].map(el => el.dataset.agentEditor);
    content.innerHTML = `<div class="space-settings-layout"><aside class="space-settings-nav"><span class="space-eyebrow">TEAMS</span><nav class="space-tabs">${draft.teams.map(x => `<button type="button" data-team="${x.id}" class="${x.id === t.id ? 'selected' : ''}">${esc(x.name)}</button>`).join('')}</nav><button type="button" class="secondary" id="spaceAddTeam">+ Add team</button></aside><div class="space-settings-body"><div class="space-settings-heading"><div><span class="space-eyebrow">TEAM</span><h3>${esc(t.name)}</h3><p>${agents.length} people · ${esc(agents.find(a => a.id === t.lead)?.name || 'no lead')} leads</p></div><button type="button" class="secondary" id="spaceRemoveTeam">Remove team</button></div>
      <nav class="space-section-tabs">${[['overview', 'Purpose'], ['people', 'People'], ['rules', 'Standing rules'], ['access', 'Tools & skills'], ['quality', 'Review'], ['execution', 'Models & pace'], ['tests', 'Tests']].map(([id, label]) => `<button type="button" data-settings-section="${id}" aria-pressed="${teamSection === id}">${label}</button>`).join('')}</nav>
      <form id="spaceTeamForm" data-dirty novalidate><section data-settings-page="overview"><div class="space-grid"><label>Team name<input name="name" value="${esc(t.name)}" required></label><label>Accountable lead<select name="lead">${agents.map(a => `<option value="${a.id}" ${a.id === t.lead ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label></div>
      <label>Team purpose<textarea name="purpose" rows="2" required placeholder="What does this team own, and what does success look like?">${esc(t.purpose)}</textarea></label><label>Working instructions<textarea name="instructions" rows="5" required placeholder="Process, tone, source requirements and boundaries for this team.">${esc(t.instructions)}</textarea></label></section>
      <section data-settings-page="rules"><p>Standing rules are your own words, kept as you wrote them. Every task for this team, and every task for the person named, starts from them.</p><h3>Whole team</h3>${ruleList(t.rules, 'remove-team-rule')}<div class="space-actions"><input id="spaceNewTeamRule" maxlength="300" placeholder="e.g. Always quote prices in USD"><button type="button" class="secondary" id="spaceAddTeamRule">Add rule</button></div>
        ${agents.map(a => `<h3>${esc(a.name)}</h3>${ruleList(a.rules || [], 'remove-agent-rule-' + a.id)}`).join('')}</section>
      <section data-settings-page="quality"><label>Guardrails — one per line<textarea name="guardrails" rows="3" placeholder="Boundaries the lead must check before approving work.">${esc(t.guardrails.join('\n'))}</textarea></label><label>Lead’s review criteria — one per line<textarea name="criteria" rows="4">${esc(t.criteria.join('\n'))}</textarea></label>
      <h3>Automated acceptance checks</h3><p>These must pass even when the lead approves. Text matching ignores case.</p>
      <div id="spaceCheckEditors">${t.checks.map((check, i) => `<details data-check-editor="${i}"><summary>${esc(check.label || 'Acceptance check')}</summary><label>Name<input data-check-label value="${esc(check.label)}" maxlength="160" required></label><div class="space-grid"><label>Rule<select data-check-type>${[['contains', 'Must contain'], ['not_contains', 'Must not contain'], ['min_length', 'Minimum characters'], ['max_length', 'Maximum characters']].map(([type, label]) => `<option value="${type}" ${check.type === type ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Value<input data-check-value value="${esc(check.value)}" ${check.type.includes('length') ? 'type="number" min="1" max="100000" step="1"' : 'maxlength="1000"'} required></label></div><button type="button" class="secondary" data-remove-check="${i}">Remove check</button></details>`).join('')}</div><button type="button" class="secondary" id="spaceAddCheck">Add check</button>
      <label class="space-check"><input type="checkbox" name="completionApproval" ${t.completionApproval ? 'checked' : ''}>Ask me before a finished task is closed. Actions that send, post, pay or change things outside the office always ask you first.</label></section>
      <section data-settings-page="execution"><p>Choose models for this team, or leave the role defaults from Models & keys. A person’s own model wins over the team’s.</p><div class="space-grid"><label>Lead<select name="modelLead">${models(t.models?.lead)}</select></label><label>Specialists<select name="modelSpecialist">${models(t.models?.specialist)}</select></label><label>Reviews<select name="modelReview">${models(t.models?.review)}</select></label></div>
      <div class="space-grid">${[['maxParallelRuns', 'Specialists working at once', 1, 4], ['maxReworkRounds', 'Rework rounds before it needs you', 0, 5]].map(([name, label, min, max]) => `<label>${label}<input type="number" name="${name}" min="${min}" max="${max}" value="${t[name]}"></label>`).join('')}</div></section>
      <section data-settings-page="access"><h3>Shared skills</h3><div class="space-tool-picks">${skillChoices(t.skills, 'teamskill') || 'Create reusable instructions under Skills.'}</div>
      <h3>Team tools</h3><p>A person inherits the team’s tools. Tick a tool here to give it to this person even if the team does not have it; untick inherit to limit them to the tools ticked. The lead is told who has what.</p><div class="space-tool-picks">${toolChoices(t.tools, 'teamtool') || 'Add connectors under Tools & connectors.'}</div></section>
      <section data-settings-page="people"><p>The lead plans with this roster. Open a person to edit their job, model and tools.</p><div class="space-agent-editors">${agents.map(a => `<details data-agent-editor="${a.id}" ${openAgents.includes(a.id) ? 'open' : ''}><summary><span class="space-avatar">${esc(a.name.slice(0, 1))}</span><span><b>${esc(a.name)}</b><small>${a.id === t.lead ? 'Team lead · plans and reviews' : esc(a.role)}</small></span><span class="space-person-edit">Edit</span></summary><div class="space-grid"><label>Name<input data-field="name" value="${esc(a.name)}" required></label><label>Role<input data-field="role" value="${esc(a.role)}" required></label></div><label>Responsibilities<textarea data-field="does" required>${esc(a.does)}</textarea></label><label>Standing instructions<textarea data-field="brief" required rows="3">${esc(a.brief)}</textarea></label><h3>Additional skills</h3><div class="space-tool-picks">${skillChoices(a.skills, 'agentskill')}</div><label>Model for this person<select data-field="model">${models(a.model, 'Use the team or role default')}</select></label><label>Effort<select data-field="effort">${['', 'low', 'medium', 'high', 'xhigh', 'max'].map(e => `<option value="${e}" ${e === (a.effort || '') ? 'selected' : ''}>${e || 'Role default'}</option>`).join('')}</select></label><label class="space-check"><input type="checkbox" data-field="inheritTools" ${a.inheritTools !== false ? 'checked' : ''}>Use the team’s tools</label><div class="space-tool-picks">${toolChoices(a.tools, 'agenttool')}</div><button class="secondary" type="button" data-remove-agent="${a.id}">Remove person</button></details>`).join('')}</div>
      <div class="space-actions"><button type="button" class="secondary" id="spaceAddAgent">Add person</button><button type="button" class="secondary" id="spaceHireAgency">Hire from the Agency</button></div><div id="spaceAgencyPicker" hidden></div></section>
      <section data-settings-page="tests"><h3>Team tests</h3><p>Run the whole plan, work and review process against known inputs. Tests run without external tools.</p>
      <div id="spaceTestEditors">${t.tests.map(test => `<details data-test-editor="${esc(test.id)}"><summary>${esc(test.name || 'New test')}</summary><label>Name<input data-test-name value="${esc(test.name)}" required></label><label>Task and supplied facts<textarea data-test-prompt rows="3" required>${esc(test.prompt)}</textarea></label><label>Required text — one per line<textarea data-test-required rows="2">${esc(test.requiredText.join('\n'))}</textarea></label><div class="space-actions"><button type="button" class="secondary" data-run-test="${esc(test.id)}">Run saved test</button><button type="button" class="secondary" data-remove-test="${esc(test.id)}">Remove test</button></div></details>`).join('')}</div>
      <button type="button" class="secondary" id="spaceAddTest">Add test</button></section>
      <div class="space-settings-save"><span id="spaceSaveState">${dirty ? 'Unsaved changes' : 'Changes apply when saved'}</span><button type="submit">Save changes</button><button type="button" class="secondary" id="spaceRunTests" ${t.tests.length ? '' : 'disabled'}>Run all saved tests</button></div></form></div></div>`;
    const rerender = () => { collectTeam(); dirty = true; renderTeam(); };
    content.querySelectorAll('[data-settings-page]').forEach(el => el.hidden = el.dataset.settingsPage !== teamSection);
    content.querySelectorAll('[data-settings-section]').forEach(b => b.onclick = () => { collectTeam(); teamSection = b.dataset.settingsSection; renderTeam(); });
    $('spaceTeamForm').addEventListener('input', event => { if (!event.target.closest('.agency-picker')) $('spaceSaveState').textContent = 'Unsaved changes'; });
    $('spaceAddTeam').onclick = () => {
      collectTeam(); if (draft.teams.length >= 10) return feedback('An office supports up to 10 teams.', true);
      const id = 'team-' + crypto.randomUUID().slice(0, 8), lead = id + '-lead', template = structuredClone(config.teams[0]);
      draft.teams.push({ ...template, id, name: 'New team', lead, purpose: '', instructions: '', guardrails: [], tools: [], skills: [], tests: [], checks: [], rules: [], models: {} });
      draft.agents.push({ id: lead, department: id, name: 'Team lead', role: 'Team lead', does: 'Plan, delegate and review the work of the team.', brief: '', model: '', effort: '', tools: [], skills: [], rules: [], inheritTools: true }, { id: id + '-specialist', department: id, name: 'Specialist', role: 'Specialist', does: '', brief: '', model: '', effort: '', tools: [], skills: [], rules: [], inheritTools: true });
      team = id; teamSection = 'overview'; dirty = true; renderTeam(); feedback('Name the team and describe its purpose, then set up People and save.');
    };
    $('spaceRemoveTeam').onclick = () => {
      collectTeam(); if (draft.teams.length <= 1) return feedback('Keep at least one team.', true);
      if (!confirm(`Remove ${t.name} and its people when you save? Past tasks and the Brain are kept. Unfinished work must be finished or cancelled first.`)) return;
      draft.teams = draft.teams.filter(x => x.id !== t.id); draft.agents = draft.agents.filter(a => a.department !== t.id); team = draft.teams[0].id; dirty = true; renderTeam(); feedback('Removal is staged. Save to apply it.');
    };
    content.querySelectorAll('[data-team]').forEach(b => b.onclick = () => { collectTeam(); team = b.dataset.team; renderTeam(); });
    $('spaceAddTeamRule').onclick = () => { const text = $('spaceNewTeamRule').value.trim(); if (!text) return; collectTeam(); t.rules.push({ text, at: Date.now(), task: '' }); dirty = true; renderTeam(); };
    content.querySelectorAll('[data-remove-team-rule]').forEach(b => b.onclick = () => { collectTeam(); t.rules.splice(+b.dataset.removeTeamRule, 1); dirty = true; renderTeam(); });
    for (const a of agents) content.querySelectorAll(`[data-remove-agent-rule-${a.id}]`).forEach(b => b.onclick = () => { collectTeam(); a.rules.splice(+b.getAttribute(`data-remove-agent-rule-${a.id}`), 1); dirty = true; renderTeam(); });
    $('spaceAddCheck').onclick = () => { collectTeam(); if (t.checks.length >= 20) return feedback('A team supports up to 20 checks.', true); t.checks.push({ type: 'contains', label: 'New acceptance check', value: '' }); dirty = true; renderTeam(); $('spaceCheckEditors').lastElementChild.open = true; };
    content.querySelectorAll('[data-remove-check]').forEach(b => b.onclick = () => { collectTeam(); t.checks.splice(Number(b.dataset.removeCheck), 1); rerender(); });
    content.querySelectorAll('[data-check-type]').forEach(select => select.onchange = () => { const input = select.closest('[data-check-editor]').querySelector('[data-check-value]'); input.type = select.value.includes('length') ? 'number' : 'text'; });
    $('spaceHireAgency').onclick = () => agencyPicker($('spaceAgencyPicker'), { mode: 'hire', dept: t.id, full: agents.length >= 7, onDone: async () => { dirty = false; await showTeams(); teamSection = 'people'; renderTeam(); } });
    $('spaceAddAgent').onclick = () => { collectTeam(); if (agents.length >= 7) return feedback('A team is a lead and up to six specialists.', true); const id = 'agent-' + crypto.randomUUID().slice(0, 8); draft.agents.push({ id, department: t.id, name: 'New person', role: 'Specialist', does: '', brief: '', model: '', effort: '', tools: [], skills: [], rules: [], inheritTools: true }); dirty = true; renderTeam(); content.querySelector(`[data-agent-editor="${id}"]`).open = true; };
    content.querySelectorAll('[data-remove-agent]').forEach(b => b.onclick = () => {
      collectTeam(); if (agents.length <= 2) return feedback('Keep a lead and at least one specialist.', true);
      draft.agents = draft.agents.filter(a => a.id !== b.dataset.removeAgent);
      if (t.lead === b.dataset.removeAgent) t.lead = draft.agents.find(a => a.department === t.id).id;
      dirty = true; renderTeam();
    });
    $('spaceTeamForm').onsubmit = async event => {
      event.preventDefault(); collectTeam();
      try {
        const layoutChanged = JSON.stringify(config.agents.map(a => [a.id, a.department, a.name])) !== JSON.stringify(draft.agents.map(a => [a.id, a.department, a.name])) || JSON.stringify(config.teams.map(x => [x.id, x.name])) !== JSON.stringify(draft.teams.map(x => [x.id, x.name]));
        config = await api('/office', 'PUT', draft); draft = structuredClone(config); dirty = false;
        if (layoutChanged) { feedback('Saved. Updating the office layout…'); setTimeout(() => location.reload(), 600); } else { renderTeam(); feedback('Team saved.'); }
      } catch (error) { feedback(error.message, true); }
    };
    $('spaceAddTest').onclick = () => { collectTeam(); if (t.tests.length >= 12) return feedback('A team supports up to 12 tests.', true); t.tests.push({ id: 'test-' + crypto.randomUUID().slice(0, 8), name: 'New test', prompt: '', requiredText: [] }); dirty = true; renderTeam(); $('spaceTestEditors').lastElementChild.open = true; };
    content.querySelectorAll('[data-remove-test]').forEach(b => b.onclick = () => { collectTeam(); t.tests = t.tests.filter(x => x.id !== b.dataset.removeTest); rerender(); });
    const testSaved = () => { collectTeam(); if (dirty) { feedback('Save the team changes before running tests.', true); return false; } return true; };
    content.querySelectorAll('[data-run-test]').forEach(b => b.onclick = async () => { if (!testSaved()) return; b.disabled = true; try { const job = await api(`/teams/${t.id}/test`, 'POST', { testId: b.dataset.runTest }); openTask(job.id); } catch (error) { feedback(error.message, true); b.disabled = false; } });
    $('spaceRunTests').onclick = async event => { if (!testSaved()) return; event.target.disabled = true; try { const suite = await api(`/teams/${t.id}/tests`, 'POST', {}); feedback(`${suite.jobs.length} tests queued. Results appear under Reports & KPIs.`); } catch (error) { feedback(error.message, true); event.target.disabled = false; } };
  }

  /* ---------- Models & keys ---------- */
  // Nothing is built in: a provider gets a key, its model list is fetched from the provider, and the owner activates the ones the office may use.
  const ROLES = [['office', 'Office default'], ['pm', 'Program Manager'], ['lead', 'Team leads'], ['specialist', 'Specialists'], ['review', 'Reviews'], ['chat', 'Chat with people']];
  let modelLists = {};
  async function showModels() {
    try {
      const reg = await api('/providers'), active = structuredClone(reg.models), roles = { ...reg.roleDefaults };
      const providerName = id => reg.providers.find(p => p.id === id)?.label || id;
      content.innerHTML = `<p>The office runs on API keys. Add a key for any provider (Anthropic, OpenAI, OpenRouter for GLM, Kimi and many more, or any OpenAI-compatible endpoint), save it, then activate the models the office may use from that provider's own list. Keys stay on the server and are never shown again.</p>
        <form id="spaceKeysForm" data-dirty><h3>Providers</h3>${reg.providers.map(p => `<fieldset data-provider="${esc(p.id)}"><legend>${esc(p.label)}<small>${p.hasKey ? 'Key stored' + (p.keySource === 'env' ? ' in the server environment' : '') : 'No key yet'}${p.enabled === false ? ' · disabled' : ''}</small></legend>${p.type === 'openai-compatible' ? `<label>Base URL<input data-field="baseURL" value="${esc(p.baseURL || '')}"></label>` : ''}<label>API key<input data-field="apiKey" type="password" autocomplete="off" placeholder="${p.hasKey ? 'Leave blank to keep the stored key' : 'Paste the key'}"></label><div class="space-actions"><label class="space-check"><input type="checkbox" data-field="enabled" ${p.enabled !== false ? 'checked' : ''}>Enabled</label>${p.hasKey && p.keySource === 'file' ? '<label class="space-check"><input type="checkbox" data-field="clearKey">Remove stored key</label>' : ''}<button type="button" class="secondary" data-test-provider="${esc(p.id)}" ${p.hasKey ? '' : 'disabled'} title="${p.hasKey ? '' : 'Paste a key first'}">Test connection</button></div></fieldset>`).join('')}
        <div class="space-settings-save"><span id="spaceKeysState">${reg.providers.some(p => p.hasKey) ? 'Keys are stored on the server.' : 'Add at least one key.'}</span><button type="submit">Save keys</button></div></form>
        <h3>Active models</h3><div id="spaceModelsBox"></div>
        <h3>Who runs on what</h3><p>Every role can have its own model; a role left on the office default follows it.</p><div class="space-grid" id="spaceRolesBox"></div>
        <div class="space-settings-save"><span>${reg.ready ? 'Ready: the teams can work.' : 'Activate a model and choose the office default to start work.'}</span><button type="button" id="spaceSaveModels">Save models and roles</button></div>`;
      const box = $('spaceModelsBox');
      const collectKeys = () => reg.providers.map(({ hasKey, keySource, usable, ...p }) => { const f = content.querySelector(`[data-provider="${p.id}"]`), field = name => f.querySelector(`[data-field="${name}"]`); return { ...p, apiKey: field('apiKey').value, enabled: field('enabled').checked, clearKey: !!field('clearKey')?.checked, ...(field('baseURL') ? { baseURL: field('baseURL').value } : {}) }; });
      const save = async message => { await api('/providers', 'PUT', { providers: collectKeys(), models: active, roleDefaults: roles, roleEfforts: reg.roleEfforts, embeddings: reg.embeddings }); dirty = false; await showModels(); if (message) feedback(message); };
      // Test connection is only offered once there is a key: stored, or typed just now (it is saved first).
      content.querySelectorAll('[data-field="apiKey"]').forEach(input => input.addEventListener('input', () => { const p = reg.providers.find(x => x.id === input.closest('[data-provider]').dataset.provider), b = content.querySelector(`[data-test-provider="${p.id}"]`); b.disabled = !(p.hasKey || input.value.trim()); b.title = b.disabled ? 'Paste a key first' : ''; }));
      content.querySelectorAll('[data-test-provider]').forEach(button => button.onclick = async () => {
        const id = button.dataset.testProvider; button.disabled = true;
        try {
          if (content.querySelector(`[data-provider="${id}"] [data-field="apiKey"]`).value.trim()) { await save(); return feedback(`Key saved. ${await testText(id)}`); }
          feedback(await testText(id));
        } catch (error) { feedback(error.message, true); } finally { if (button.isConnected) button.disabled = false; }
      });
      const testText = async id => { const r = await api(`/providers/${id}/test`, 'POST', {}); if (!r.ok) throw new Error(`${providerName(id)}: ${r.error}`); return r.model ? `${providerName(id)} answered in ${r.ms} ms using ${r.model}.` : `${providerName(id)} accepted the key: ${r.models} models available.`; };
      $('spaceKeysForm').onsubmit = async event => { event.preventDefault(); try { await save('Keys saved.'); } catch (error) { feedback(error.message, true); } };
      const renderRoles = () => {
        const options = (selected, blank) => `<option value="">${blank}</option>` + active.filter(m => m.enabled !== false).map(m => `<option value="${esc(m.id)}" ${m.id === selected ? 'selected' : ''}>${esc(m.label || m.id)} · ${esc(providerName(m.provider))}</option>`).join('');
        $('spaceRolesBox').innerHTML = active.length ? ROLES.map(([role, label]) => `<label>${label}<select data-role="${role}">${options(roles[role], role === 'office' ? 'Choose a model' : 'Use the office default')}</select></label>`).join('') : '<p>Activate a model first.</p>';
        content.querySelectorAll('[data-role]').forEach(sel => sel.onchange = () => { roles[sel.dataset.role] = sel.value; dirty = true; });
      };
      const renderModels = () => {
        const withKey = reg.providers.filter(p => p.usable);
        box.innerHTML = withKey.length ? withKey.map(p => { const mine = active.filter(m => m.provider === p.id), list = modelLists[p.id];
          return `<fieldset data-models="${esc(p.id)}"><legend>${esc(p.label)}<small>${list ? `${list.length} models offered` : list === null ? 'could not load the model list' : 'loading the model list…'}</small></legend>
            <div class="model-pick"><label>Add a model<input list="spaceList-${esc(p.id)}" data-pick="${esc(p.id)}" placeholder="${list ? 'Type to search the provider’s models' : 'Loading…'}" autocomplete="off"><datalist id="spaceList-${esc(p.id)}">${(list || []).map(m => `<option value="${esc(m.id)}">${esc(m.label !== m.id ? m.label : '')}</option>`).join('')}</datalist></label><button type="button" data-activate="${esc(p.id)}">Activate</button></div>
            ${mine.length ? `<ul class="model-list">${mine.map(m => `<li><b>${esc(m.label || m.id)}</b><small>${esc(m.id)}${m.supports?.effort ? ' · effort' : m.supports?.reasoning ? ' · reasoning' : ''}</small><button type="button" class="space-text-action" data-deactivate="${esc(m.id)}">Remove</button></li>`).join('')}</ul>` : '<p class="space-footnote">No models activated from this provider yet.</p>'}</fieldset>`; }).join('')
          : '<p>Add and save a provider key first; the models come from the provider.</p>';
        box.querySelectorAll('[data-activate]').forEach(b => b.onclick = () => {
          const pid = b.dataset.activate, input = box.querySelector(`[data-pick="${pid}"]`), id = input.value.trim(); if (!id) return feedback('Type or pick a model id first.', true);
          if (active.some(m => m.id === id)) return feedback('That model is already active.', true);
          const found = (modelLists[pid] || []).find(m => m.id === id);
          active.push({ id, provider: pid, label: found?.label || id, supports: found?.supports || { effort: false, reasoning: false } }); if (!roles.office) roles.office = id; dirty = true; renderModels(); renderRoles();
          if (!found) feedback(`“${id}” is not in ${providerName(pid)}’s list; it is activated as typed.`);
        });
        box.querySelectorAll('[data-pick]').forEach(input => input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); box.querySelector(`[data-activate="${input.dataset.pick}"]`).click(); } }));
        box.querySelectorAll('[data-deactivate]').forEach(b => b.onclick = () => { const id = b.dataset.deactivate; active.splice(active.findIndex(m => m.id === id), 1); for (const r of Object.keys(roles)) if (roles[r] === id) roles[r] = ''; dirty = true; renderModels(); renderRoles(); });
      };
      renderModels(); renderRoles();
      for (const p of reg.providers.filter(p => p.usable && !modelLists[p.id])) api(`/providers/${p.id}/models`).then(list => { modelLists[p.id] = list; if (section === 'models') renderModels(); }).catch(error => { modelLists[p.id] = null; if (section === 'models') { renderModels(); feedback(`${p.label}: ${error.message}`, true); } });
      $('spaceSaveModels').onclick = async () => { if (active.length && !roles.office) return feedback('Choose the office default model.', true); try { await save('Saved. New work uses these models.'); } catch (error) { feedback(error.message, true); } };
    } catch (error) { feedback(error.message, true); }
  }

  /* ---------- Tools & connectors ---------- */
  async function showTools(editing = null) {
    try { [tools, config] = await Promise.all([api('/tools'), api('/office')]); statusTries = 0; renderTools(editing); } catch (error) { feedback(error.message, true); }
  }
  function renderTools(editing = null) {
    const own = tools.filter(t => t.type !== 'candidate'), found = tools.filter(t => t.type === 'candidate');
    const authLabel = t => t.type === 'builtin' ? 'No sign-in needed' : t.type === 'stdio' ? 'Runs on this server' : t.auth === 'signed-in' ? 'Signed in' : t.hasToken ? 'Uses a stored token' : 'Not signed in';
    // The connection itself, in words. The server says 'unavailable' whenever the MCP handshake produced no tools: for a
    // remote server nobody has signed in to that is expected, for anything else it is a failure the owner can act on.
    const toolStatus = t => {
      if (t.type === 'builtin') return null;
      if (t.status === 'connected') return { cls: 'connected', label: 'Connected', hint: '' };
      if (t.status === 'connecting') return { cls: 'connecting', label: 'Connecting…', hint: 'Checking the server now. This card updates by itself.' };
      if (t.status === 'unavailable') return ['http', 'sse'].includes(t.type) && t.auth !== 'signed-in' && !t.hasToken
        ? { cls: 'warn', label: 'Needs sign-in', hint: 'Press Sign in, or edit the connection to add a bearer token.' }
        : { cls: 'failed', label: 'Connection failed', hint: t.type === 'stdio' ? 'The command did not start or offered no tools. Check the executable and arguments, then press Check connections.' : 'The server answered with no tools. Check the URL and the sign-in, then press Check connections.' };
      return { cls: 'pending', label: 'Not checked yet', hint: 'Press Check connections.' };
    };
    const statusPill = t => { const s = toolStatus(t); return s ? ` · <span class="tool-status ${s.cls}">${s.label}</span>${s.hint ? `<em class="tool-status-hint">${esc(s.hint)}</em>` : ''}` : ''; };
    const accessLine = t => t.assignedTeams?.length ? 'Used by ' + t.assignedTeams.map(a => esc(a.name) + (a.whole === false && a.people?.length ? ' (' + a.people.map(esc).join(', ') + ' only)' : '')).join(', ') : t.status === 'connected' ? 'Connected, but no team can use it yet — press Team access' : 'No team can use it yet';
    content.innerHTML = `<div class="space-settings-heading"><div><span class="space-eyebrow">CONNECTORS</span><h3>Tools your teams can use</h3><p>A connection is separate from permission: choose which teams may use each tool.</p></div><button id="spaceNewTool" type="button">+ Add MCP server</button></div>
      <div class="space-tools">${own.map(t => `<article><div><b>${esc(t.name)}</b><span>${esc(t.origin || t.type)}</span><span class="space-tool-access ${t.assignedTeams?.length ? 'enabled' : ''}">${accessLine(t)}</span><small>${authLabel(t)}${statusPill(t)}</small></div><div class="space-actions"><button type="button" data-tool-assign="${t.id}" class="secondary">Team access</button>${['http', 'sse'].includes(t.type) ? (t.auth === 'signed-in' ? `<button type="button" data-tool-logout="${t.id}" class="secondary">Sign out</button>` : `<button type="button" data-tool-login="${t.id}" class="secondary">Sign in</button>`) : ''}${t.managed ? `<button type="button" data-tool-edit="${t.id}" class="secondary">Edit</button><button type="button" data-tool-remove="${t.id}" class="secondary">Remove</button>` : ''}</div></article>`).join('')}</div>
      ${found.length ? `<h3>Found in Claude Code on this server</h3><p>These connectors belong to the Claude Code login, which the office no longer uses. Import one to connect it here, then sign in.</p><div class="space-tools">${found.map(t => `<article><div><b>${esc(t.name)}</b><span>${esc(t.target || '')}</span></div><div class="space-actions"><button type="button" data-tool-import="${t.id}">Import</button></div></article>`).join('')}</div>` : ''}
      <div class="space-actions"><button class="secondary" id="spaceRefreshTools" type="button">Check connections</button><button class="secondary" id="spaceToolRules" type="button">Approval rules for actions</button></div>
      <section id="spaceToolEditor" ${editing ? '' : 'hidden'}><h3>${editing ? 'Edit server' : 'Add MCP server'}</h3><p>Save the connection, sign in if it asks, then choose the teams that can use it.</p>
      <form id="spaceToolForm"><div class="space-grid"><label>Name<input name="name" value="${esc(editing?.name || '')}" ${editing ? 'readonly' : ''} required pattern="[A-Za-z][A-Za-z0-9_-]*"></label><label>Connection type<select name="type">${['http', 'sse', 'stdio'].map(type => `<option value="${type}" ${type === editing?.type ? 'selected' : ''}>${type === 'stdio' ? 'Local command' : type.toUpperCase()}</option>`).join('')}</select></label></div>
      <div id="spaceRemoteTool"><label>MCP endpoint URL<input name="url" type="url" placeholder="https://example.com/mcp" value="${esc(editing?.url || '')}"></label><label>Bearer token, if the server uses one<input name="token" type="password" autocomplete="off" placeholder="${editing?.hasToken ? 'Stored token kept when blank' : 'Optional. OAuth servers use Sign in instead.'}"></label><label class="space-check"><input type="checkbox" name="clearToken">Remove stored bearer token</label></div>
      <div id="spaceLocalTool" hidden><label>Executable<input name="command" value="${esc(editing?.command || '')}" placeholder="npx"></label><label>Arguments — one per line<textarea name="args">${esc((editing?.args || []).join('\n'))}</textarea></label><label>Environment variables — NAME=value, one per line<textarea name="env" placeholder="API_KEY=your-value"></textarea></label><p>Existing secret values are kept unless replaced. Stored names: ${esc(editing?.envKeys?.join(', ') || 'none')}.</p></div>
      <div class="space-actions"><button type="submit">${editing ? 'Update connection' : 'Add connection'}</button><button type="button" class="secondary" id="spaceCancelTool">Cancel</button></div></form></section>`;
    $('spaceNewTool').onclick = () => { $('spaceToolEditor').hidden = false; $('spaceToolForm').elements.name.focus(); $('spaceToolEditor').scrollIntoView({ block: 'start', behavior: 'smooth' }); };
    $('spaceCancelTool').onclick = () => renderTools();
    content.querySelectorAll('[data-tool-assign]').forEach(b => b.onclick = () => assignTool(b.dataset.toolAssign));
    const form = $('spaceToolForm'), toggle = () => { $('spaceLocalTool').hidden = form.elements.type.value !== 'stdio'; $('spaceRemoteTool').hidden = form.elements.type.value === 'stdio'; }; form.elements.type.onchange = toggle; toggle();
    form.onsubmit = async event => {
      event.preventDefault(); const button = form.querySelector('button[type=submit]'); button.disabled = true;
      try { const input = Object.fromEntries(new FormData(form)); input.clearToken = form.elements.clearToken.checked; input.args = lines(input.args); input.env = Object.fromEntries(lines(input.env).map(line => { const i = line.indexOf('='); if (i < 1) throw new Error('Enter environment variables as NAME=value.'); return [line.slice(0, i).trim(), line.slice(i + 1)]; })); await api('/tools', 'POST', input); await showTools(); feedback('Connection saved. Sign in if needed, then give teams access.'); }
      catch (error) { feedback(error.message, true); button.disabled = false; }
    };
    $('spaceRefreshTools').onclick = async () => { try { tools = await api('/tools?refresh=1'); renderTools(); feedback('Connections checked.'); } catch (error) { feedback(error.message, true); } };
    $('spaceToolRules').onclick = showToolRules;
    content.querySelectorAll('[data-tool-edit]').forEach(b => b.onclick = () => renderTools(tools.find(t => t.id === b.dataset.toolEdit)));
    content.querySelectorAll('[data-tool-remove]').forEach(b => b.onclick = async () => { if (!confirm('Remove this connector and its team access?')) return; try { await api('/tools/' + b.dataset.toolRemove, 'DELETE'); await showTools(); feedback('Removed the connector and its team access.'); } catch (error) { feedback(error.message, true); } });
    content.querySelectorAll('[data-tool-import]').forEach(b => b.onclick = async () => { b.disabled = true; try { await api(`/tools/${b.dataset.toolImport}/import`, 'POST', {}); await showTools(); feedback('Imported. Sign in, then give teams access.'); } catch (error) { feedback(error.message, true); b.disabled = false; } });
    content.querySelectorAll('[data-tool-logout]').forEach(b => b.onclick = async () => { try { await api(`/tools/${b.dataset.toolLogout}/oauth/logout`, 'POST', {}); await showTools(); feedback('Signed out.'); } catch (error) { feedback(error.message, true); } });
    content.querySelectorAll('[data-tool-login]').forEach(b => b.onclick = () => loginTool(b.dataset.toolLogin));
    // While a connector is still connecting, look again shortly. The live event normally arrives first; this covers a stream that is down.
    if (statusPoll) { clearTimeout(statusPoll); statusPoll = null; }
    if (!editing && own.some(t => t.status === 'connecting') && statusTries < 24) statusPoll = setTimeout(async () => { statusPoll = null; statusTries++; if (section !== 'tools' || !$('spaceRefreshTools') || !$('spaceToolEditor')?.hidden) return; try { tools = await api('/tools'); renderTools(); } catch {} }, 2500);
  }
  async function loginTool(id) {
    // Open the window first, synchronously, so the browser does not block it as a pop-up.
    const popup = window.open('about:blank', '_blank');
    try {
      const r = await api(`/tools/${id}/oauth/start`, 'POST', {});
      if (r.url) { if (popup) popup.location = r.url; else window.open(r.url, '_blank'); feedback('Finish signing in in the new window. This page updates when you are done.'); }
      else { popup?.close(); feedback(r.message || 'Signed in.'); await showTools(); return; }
      stopPoll(); let tries = 0;
      toolPoll = setInterval(async () => {
        if (++tries > 100 || section !== 'tools') return stopPoll();
        try { const list = await api('/tools'); if (list.find(t => t.id === id)?.auth === 'signed-in') { stopPoll(); tools = list; renderTools(); feedback('Signed in. Give teams access to start using it.'); } } catch {}
      }, 3000);
    } catch (error) { popup?.close(); feedback(error.message, true); }
  }
  async function assignTool(id) {
    try {
      config = await api('/office'); const tool = tools.find(t => t.id === id);
      content.innerHTML = `<button type="button" class="secondary" id="spaceBackTools">← All tools</button><div class="space-settings-heading"><div><span class="space-eyebrow">TEAM ACCESS</span><h3>${esc(tool.name)}</h3><p>Only the teams you tick can use this tool. People in a team can be limited further under Teams & people.</p></div></div><form id="spaceToolAccess"><div class="space-access-cards">${config.teams.map(t => `<label class="space-check"><input type="checkbox" value="${t.id}" ${t.tools.includes(id) ? 'checked' : ''}><span><b>${esc(t.name)}</b><small>${esc(t.purpose || 'Team')}</small></span></label>`).join('')}</div><div class="space-actions"><button type="submit">Save team access</button></div></form>`;
      $('spaceBackTools').onclick = () => renderTools();
      $('spaceToolAccess').onsubmit = async e => { e.preventDefault(); const selected = [...e.target.querySelectorAll('input:checked')].map(el => el.value); for (const t of config.teams) t.tools = [...t.tools.filter(x => x !== id), ...(selected.includes(t.id) ? [id] : [])]; try { await api('/office', 'PUT', config); await showTools(); feedback('Team access saved. Runs already in progress keep the access they started with.'); } catch (error) { feedback(error.message, true); } };
    } catch (error) { feedback(error.message, true); }
  }
  async function showToolRules() {
    try {
      const [catalog, s] = await Promise.all([api('/tools/catalog'), api('/settings')]);
      const choice = name => s.outboundTools.includes(name) ? 'ask' : s.readOnlyTools.includes(name) ? 'free' : 'default';
      content.innerHTML = `<button type="button" class="secondary" id="spaceBackTools">← All tools</button><h3>Approval rules for actions</h3><p>Actions that send, post, pay, delete or change things outside the office wait for your approval. The office decides from the tool's own description and name; override it here.</p>
        <form id="spaceRulesForm" data-dirty>${catalog.length ? `<div class="space-report-table"><table><thead><tr><th>Tool</th><th>Default</th><th>Rule</th></tr></thead><tbody>${catalog.map(t => `<tr><td><b>${esc(t.name)}</b><br><small>${esc(t.description.slice(0, 140))}</small></td><td>${choice(t.name) === 'default' ? (t.outbound ? '<span class="tool-flag">Asks you first</span>' : '<span class="tool-flag read">Runs freely</span>') : ''}</td><td><select data-rule="${esc(t.name)}"><option value="default" ${choice(t.name) === 'default' ? 'selected' : ''}>Use the default</option><option value="ask" ${choice(t.name) === 'ask' ? 'selected' : ''}>Always ask me first</option><option value="free" ${choice(t.name) === 'free' ? 'selected' : ''}>Never ask</option></select></td></tr>`).join('')}</tbody></table></div>` : '<p>No connected tools yet. Sign in to a connector first.</p>'}
        <div class="space-settings-save"><span>Applies to the next action a team takes.</span><button type="submit" ${catalog.length ? '' : 'disabled'}>Save rules</button></div></form>`;
      $('spaceBackTools').onclick = () => renderTools();
      $('spaceRulesForm').onsubmit = async event => {
        event.preventDefault(); const picks = [...content.querySelectorAll('[data-rule]')].map(el => [el.dataset.rule, el.value]);
        const listed = new Set(picks.map(p => p[0]));
        const outboundTools = [...s.outboundTools.filter(n => !listed.has(n)), ...picks.filter(p => p[1] === 'ask').map(p => p[0])];
        const readOnlyTools = [...s.readOnlyTools.filter(n => !listed.has(n)), ...picks.filter(p => p[1] === 'free').map(p => p[0])];
        try { await api('/settings', 'PUT', { outboundTools, readOnlyTools }); dirty = false; await showToolRules(); feedback('Approval rules saved.'); } catch (error) { feedback(error.message, true); }
      };
    } catch (error) { feedback(error.message, true); }
  }

  /* ---------- The Agency: ready-made people and methods ---------- */
  let agencyIndex = null;
  async function agencyPicker(host, { mode, dept = '', full = false, teams = [], onDone }) {
    host.hidden = !host.hidden; host.closest('form')?.classList.toggle('picker-open', !host.hidden); if (host.hidden) return;
    try { agencyIndex ||= await api('/agency'); } catch (error) { return feedback(error.message, true); }
    const divisions = Object.entries(agencyIndex.divisions);
    host.innerHTML = `<div class="agency-picker" role="region" aria-label="${mode === 'hire' ? 'Hire from the Agency' : 'Add a method from the Agency'}">
      <div class="agency-head"><div><b>${mode === 'hire' ? 'Hire from the Agency' : 'Add a method from the Agency'}</b><p>${mode === 'hire' ? 'A ready-made specialist joins this team with a role, standing instructions and their full method as a skill.' : 'A method becomes a skill you can give to teams and people.'} <small>Open-source Agency catalogue, MIT.</small></p></div><button type="button" class="secondary agency-close" id="agencyClose" aria-label="Close">✕</button></div>
      <div class="agency-search"><input type="search" id="agencyQ" placeholder="Search ${agencyIndex.personas.length} personas by name, role or skill" aria-label="Search personas"><select id="agencyDivision" aria-label="Division"><option value="">All divisions</option>${divisions.map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join('')}</select>${mode === 'skill' ? `<select id="agencyTeam" aria-label="Give it to"><option value="">Give it to nobody yet</option>${teams.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select>` : ''}</div>
      ${mode === 'hire' && full ? '<p class="error">This team is full: a lead and six specialists. Remove someone first, or give the lead a new role with “as the lead”.</p>' : ''}
      <p class="agency-count" id="agencyCount" aria-live="polite"></p>
      <div id="agencyList" class="agency-list"></div></div>`;
    $('agencyClose').onclick = () => { host.hidden = true; host.closest('form')?.classList.remove('picker-open'); };
    const list = () => {
      const q = $('agencyQ').value.toLowerCase().trim(), division = $('agencyDivision').value;
      const hits = agencyIndex.personas.filter(p => (!division || p.division === division) && (!q || `${p.name} ${p.description} ${p.role} ${p.label}`.toLowerCase().includes(q))).slice(0, 60);
      const total = agencyIndex.personas.filter(p => (!division || p.division === division)).length;
      $('agencyCount').textContent = hits.length === total ? `${total} personas` : `${hits.length} of ${total} personas`;
      $('agencyList').innerHTML = hits.map(p => `<article class="agency-item"><span class="agency-emoji" aria-hidden="true">${esc(p.emoji || '•')}</span><div class="agency-body"><b>${esc(p.name)}</b><small>${esc(p.label)}${p.role && !p.description.startsWith(p.role.slice(0, 24)) ? ' · ' + esc(p.role) : ''}</small><p>${esc(p.description.slice(0, 180))}${p.description.length > 180 ? '…' : ''}</p></div><div class="agency-actions">${mode === 'hire' ? `<button type="button" data-hire="${esc(p.id)}" ${full ? 'disabled' : ''}>Hire</button><button type="button" class="space-text-action" data-hire-lead="${esc(p.id)}">as the lead</button>` : `<button type="button" data-skill="${esc(p.id)}">Add method</button>`}</div></article>`).join('') || '<p class="agency-empty">No persona matches. Try a role, like “analyst” or “designer”.</p>';
      const act = (attr, fn) => $('agencyList').querySelectorAll(`[${attr}]`).forEach(b => b.onclick = async () => { b.disabled = true; try { const r = await fn(b.getAttribute(attr)); host.hidden = true; host.closest('form')?.classList.remove('picker-open'); await onDone(r); } catch (error) { feedback(error.message, true); b.disabled = false; } });
      act('data-hire', id => api(`/agency/${id}/hire`, 'POST', { dept }).then(r => { feedback(`${r.person.name} joined ${r.team.name} with the “${r.skill.name}” method.`); return r; }));
      act('data-hire-lead', id => (confirm('Give this team’s lead the persona’s role, job and standing instructions? Their name stays.') ? api(`/agency/${id}/hire`, 'POST', { dept, lead: true }).then(r => { feedback(`${r.person.name} now works as ${r.person.role}.`); return r; }) : Promise.reject(new Error('Cancelled.'))));
      act('data-skill', id => api(`/agency/${id}/skill`, 'POST', { teams: $('agencyTeam').value ? [$('agencyTeam').value] : [] }));
    };
    $('agencyQ').oninput = list; $('agencyDivision').onchange = list; list(); $('agencyQ').focus();
  }

  /* ---------- Projects ---------- */
  let projectOpen = null;
  const dayOf = ms => ms ? new Date(ms).toISOString().slice(0, 10) : '';
  const sizeOf = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  async function showProjects() {
    try {
      const data = await api('/projects');
      const list = data.projects.filter(p => p.status !== 'archived'), archived = data.projects.filter(p => p.status === 'archived');
      content.innerHTML = `<div class="space-settings-heading"><div><span class="space-eyebrow">PROJECTS</span><h3>The big pieces of work</h3><p>A project has a charter, owners, a timeline with milestones and a folder of files. Every task you attach to it starts from that page, and the Program Manager keeps the project's history there.</p></div><button id="spaceNewProject" type="button">+ New project</button></div>
        ${list.length ? `<div class="space-project-list">${list.map(p => { const done = p.milestones.filter(m => m.done).length, total = p.milestones.length; return `<div class="space-project-card" role="button" tabindex="0" data-project="${esc(p.id)}"><div class="space-project-top"><b>${esc(p.name)}</b><span class="space-project-status ${esc(p.status)}">${esc(p.status)}</span></div><p class="space-project-desc">${esc(p.description)}</p>${total ? `<div class="space-project-progress" title="${done} of ${total} milestones reached"><i style="width:${Math.round(done / total * 100)}%"></i></div>` : ''}<div class="space-project-meta"><span>${p.next ? `Next: ${esc(p.next.title)}${p.next.dueAt ? ' · ' + dayOf(p.next.dueAt) : ''}` : 'No milestone ahead'}</span><span>${p.open} open task${p.open === 1 ? '' : 's'}</span>${p.dueAt ? `<span>Target ${dayOf(p.dueAt)}</span>` : ''}${p.teams.length ? `<span>${p.teams.map(t => esc(data.teams.find(x => x.id === t)?.name || t)).join(', ')}</span>` : ''}</div></div>`; }).join('')}</div>` : '<p class="space-projects-empty">No projects yet. Define the first one: what it is for, who owns it, the milestones, and the files the teams should start from.</p>'}
        ${archived.length ? `<details class="space-archived"><summary>${archived.length} archived</summary>${archived.map(p => `<button type="button" class="space-text-action" data-project="${esc(p.id)}">${esc(p.name)}</button>`).join(' · ')}</details>` : ''}`;
      $('spaceNewProject').onclick = () => editProject(null, data.teams);
      content.querySelectorAll('[data-project]').forEach(b => { b.onclick = () => editProject(b.dataset.project, data.teams); b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.click(); } }; });
    } catch (error) { feedback(error.message, true); }
  }
  async function editProject(id, teams) {
    try {
      const detail = id ? await api(`/projects/${id}`) : null;
      const p = detail?.project || { id: '', name: '', description: '', charter: '', teams: [], status: 'active', startAt: null, dueAt: null, milestones: [] };
      projectOpen = p.id || null;
      const milestoneRow = (m = {}) => `<div class="space-milestone" data-milestone><input type="checkbox" name="mdone" ${m.done ? 'checked' : ''} title="Done"><input name="mtitle" value="${esc(m.title || '')}" placeholder="Milestone" required><input type="date" name="mdue" value="${dayOf(m.dueAt)}"><input type="hidden" name="mid" value="${esc(m.id || '')}"><button type="button" class="space-text-action" data-remove-milestone>Remove</button></div>`;
      content.innerHTML = `<button type="button" class="secondary" id="spaceBackProjects">← All projects</button>
        <div class="space-settings-heading"><div><span class="space-eyebrow">PROJECT</span><h3>${p.id ? esc(p.name) : 'New project'}</h3><p>${p.id ? `Page in the Brain: /knowledge/${esc(detail.project.page)} · ${detail.tasks.length} task${detail.tasks.length === 1 ? '' : 's'} · ${detail.files.length} file${detail.files.length === 1 ? '' : 's'}` : 'The charter is what every task of this project starts from. Write it the way you would brief a new hire.'}</p></div>${p.id ? `<div class="space-actions"><select id="spaceProjectStatus">${['active', 'paused', 'done', 'archived'].map(st => `<option value="${st}" ${st === p.status ? 'selected' : ''}>${st}</option>`).join('')}</select><button type="button" class="secondary" id="spaceDeleteProject">Delete project</button></div>` : ''}</div>
        <form id="spaceProjectForm" data-dirty novalidate>
          <div class="space-grid"><label>Name<input name="name" value="${esc(p.name)}" required maxlength="80"></label><label>Target date<input type="date" name="dueAt" value="${dayOf(p.dueAt)}"></label><label>Start<input type="date" name="startAt" value="${dayOf(p.startAt)}"></label></div>
          <label>Purpose<textarea name="description" rows="2" required placeholder="What this project is for and what done looks like.">${esc(p.description)}</textarea></label>
          <label>Charter<textarea name="charter" rows="8" placeholder="Scope and what is out of scope, objectives and how success is measured, constraints, stakeholders, the standards to follow, the decisions already made.">${esc(p.charter)}</textarea></label>
          <fieldset class="space-fieldset"><legend>Owning teams <small>The Program Manager still brings in any team a task needs.</small></legend><div class="space-tool-picks">${teams.map(t => `<label class="space-check"><input type="checkbox" name="teams" value="${esc(t.id)}" ${p.teams.includes(t.id) ? 'checked' : ''}>${esc(t.name)}</label>`).join('')}</div></fieldset>
          <fieldset class="space-fieldset"><legend>Milestones <small>Tick one when it is reached; the next one is what the Program Manager plans against.</small></legend><div id="spaceMilestones">${p.milestones.map(milestoneRow).join('')}</div><button type="button" class="secondary" id="spaceAddMilestone">+ Milestone</button></fieldset>
          <div class="space-settings-save"><span id="spaceProjectState">${p.id ? 'Changes apply when saved' : 'Not saved yet'}</span><button type="submit">${p.id ? 'Save project' : 'Create project'}</button></div>
        </form>
        ${p.id ? `<section class="space-project-files"><h3>Files</h3><p>Uploads land in the project's Brain folder, where every task of this project can read them.</p><div class="space-actions"><input type="file" id="spaceProjectFiles" multiple accept=".pdf,.docx,.txt,.md,.csv"><button type="button" class="secondary" id="spaceProjectUpload">Upload</button></div>
          ${detail.files.length ? `<ul class="space-project-file-list">${detail.files.map(f => `<li><b>${esc(f.title || f.id.split('/').pop())}</b><small>/knowledge/${esc(f.id)}${f.updatedAt ? ' · ' + esc(when(f.updatedAt)) : ''}</small></li>`).join('')}</ul>` : '<p class="space-projects-empty">No files yet.</p>'}</section>
          <section class="space-project-tasks"><h3>Tasks</h3><form id="spaceProjectTask" class="space-actions"><input name="text" placeholder="Add a task to this project" required><button type="submit">Add task</button></form>
          ${detail.tasks.length ? `<div class="space-tools">${detail.tasks.map(t => `<article><div><b>${esc(t.title)}</b><span>${esc(t.teamName)} · ${esc(stateLabel(t.state))}${t.resultPreview ? ' · ' + esc(String(t.resultPreview).slice(0, 120)) : ''}</span></div><div class="space-actions"><button type="button" class="secondary" data-open-task="${esc(t.id)}">Open</button>${!['done', 'cancelled'].includes(t.state) ? `<button type="button" class="space-text-action" data-cancel-task="${esc(t.id)}">Cancel</button>` : ''}</div></article>`).join('')}</div>` : '<p class="space-projects-empty">No tasks yet. Add the first one above, or pick this project on the task form.</p>'}</section>` : ''}`;
      $('spaceBackProjects').onclick = () => showProjects();
      const form = $('spaceProjectForm'), rows = $('spaceMilestones');
      $('spaceAddMilestone').onclick = () => { rows.insertAdjacentHTML('beforeend', milestoneRow()); rows.lastElementChild.querySelector('[name=mtitle]').focus(); wireRows(); dirty = true; };
      const wireRows = () => rows.querySelectorAll('[data-remove-milestone]').forEach(b => b.onclick = () => { b.closest('[data-milestone]').remove(); dirty = true; });
      wireRows();
      const collect = () => ({ name: form.elements.name.value, description: form.elements.description.value, charter: form.elements.charter.value, startAt: form.elements.startAt.value || null, dueAt: form.elements.dueAt.value || null,
        teams: [...form.querySelectorAll('[name=teams]:checked')].map(el => el.value),
        milestones: [...rows.querySelectorAll('[data-milestone]')].map(row => ({ id: row.querySelector('[name=mid]').value || undefined, title: row.querySelector('[name=mtitle]').value, dueAt: row.querySelector('[name=mdue]').value || null, done: row.querySelector('[name=mdone]').checked })) });
      form.onsubmit = async event => { event.preventDefault(); try { const saved = p.id ? await api(`/projects/${p.id}`, 'PUT', collect()) : await api('/projects', 'POST', collect()); dirty = false; feedback(p.id ? 'Project saved. Its page in the Brain is being rewritten.' : `Project “${saved.name}” created. Add files and tasks below.`); await editProject(saved.id, teams); } catch (error) { feedback(error.message, true); } };
      if (p.id) {
        $('spaceProjectStatus').onchange = async event => { try { await api(`/projects/${p.id}/status`, 'POST', { status: event.target.value }); feedback(`Project is now ${event.target.value}.`); await editProject(p.id, teams); } catch (error) { feedback(error.message, true); } };
        $('spaceProjectUpload').onclick = async () => { const files = [...($('spaceProjectFiles').files || [])]; if (!files.length) return feedback('Choose a file first.', true); try { for (const file of files) { if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} is larger than 25 MB.`); feedback(`Adding ${file.name}…`); await api(`/projects/${p.id}/upload`, 'POST', { name: file.name, data: await readFile(file) }); } feedback(`${files.length} file${files.length === 1 ? '' : 's'} added to the project.`); await editProject(p.id, teams); } catch (error) { feedback(error.message, true); } };
        $('spaceProjectTask').onsubmit = async event => { event.preventDefault(); const text = event.target.elements.text.value.trim(); if (!text) return; try { await api('/tasks', 'POST', { dept: 'auto', depts: 'auto', text, projectId: p.id }); feedback('Task added to the project. The Program Manager has it.'); await editProject(p.id, teams); } catch (error) { feedback(error.message, true); } };
        content.querySelectorAll('[data-open-task]').forEach(b => b.onclick = () => openTask(b.dataset.openTask));
        content.querySelectorAll('[data-cancel-task]').forEach(b => b.onclick = async () => { if (!confirm('Cancel this task? Work in progress stops; nothing is filed.')) return; try { await api(`/tasks/${b.dataset.cancelTask}/cancel`, 'POST', {}); feedback('Task cancelled.'); await editProject(p.id, teams); } catch (error) { feedback(error.message, true); } });
        $('spaceDeleteProject').onclick = async () => { if (!confirm(`Delete “${p.name}”? Finished tasks are kept without the project; its files stay in the Brain under Projects/${p.id}/.`)) return; try { await api(`/projects/${p.id}`, 'DELETE'); dirty = false; feedback(`Deleted “${p.name}”. Its files are still in the Brain.`); await showProjects(); } catch (error) { feedback(error.message, true); } };
      }
    } catch (error) { feedback(error.message, true); }
  }

  /* ---------- Skills ---------- */
  // Office Artifacts: every file every task produced, filtered by kind, date and words.
  const artFilter = { kind: '', from: '', to: '', q: '' };
  async function showArtifacts() {
    try {
      const params = new URLSearchParams(Object.entries(artFilter).filter(([, v]) => v)).toString();
      const data = await api('/artifacts' + (params ? '?' + params : ''));
      if (section !== 'artifacts') return;
      const size = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B';
      const kindLabel = Object.fromEntries(data.kinds.map(k => [k.id, k.label]));
      content.innerHTML = `<p>Every file the teams produced, across every task: drafts, exports, data. Download one, or open the task it came from.</p>
        <div class="space-actions"><label>Type<select id="artKind"><option value="">All types</option>${data.kinds.map(k => `<option value="${k.id}"${artFilter.kind === k.id ? ' selected' : ''}>${esc(k.label)}</option>`).join('')}</select></label>
        <label>From<input type="date" id="artFrom" value="${esc(artFilter.from)}"></label><label>To<input type="date" id="artTo" value="${esc(artFilter.to)}"></label>
        <label>Search<input type="search" id="artQ" placeholder="file, task or team" value="${esc(artFilter.q)}"></label><span class="space-count">${data.total} file${data.total === 1 ? '' : 's'}</span></div>
        ${data.artifacts.length ? data.artifacts.map(r => `<div class="audit-item art-item"><time>${when(r.modifiedAt)}</time>${fileIcon(r.name)}<b><a href="${esc(r.url)}" download>${esc(r.name.split('/').pop())}</a></b> <small>${esc(size(r.bytes))}${r.name.includes('/') ? ' · ' + esc(r.name.slice(0, r.name.lastIndexOf('/'))) : ''}</small><div class="art-task"><button type="button" class="space-link" data-open-task="${esc(r.taskId)}">${esc(r.taskTitle.slice(0, 90))}</button> <small>${esc(r.teams.join(', ') || 'Program Manager')}${r.projectId ? ' · project ' + esc(r.projectId) : ''} · ${esc(r.taskState)}</small></div></div>`).join('') : '<div class="space-empty"><h3>No files match.</h3><p>Loosen a filter, or give the teams a task that produces a document.</p></div>'}`;
      const apply = () => { artFilter.kind = $('artKind').value; artFilter.from = $('artFrom').value; artFilter.to = $('artTo').value; artFilter.q = $('artQ').value.trim(); showArtifacts(); };
      $('artKind').onchange = apply; $('artFrom').onchange = apply; $('artTo').onchange = apply;
      let timer = null; $('artQ').oninput = () => { clearTimeout(timer); timer = setTimeout(apply, 350); };
      content.querySelectorAll('[data-open-task]').forEach(b => b.onclick = () => openTask(b.dataset.openTask));
    } catch (error) { feedback(error.message, true); }
  }
  async function showSkills(editId = null) {
    try {
      config = await api('/office');
      const skill = config.skills.find(s => s.id === editId);
      content.innerHTML = `<p>Save a repeatable method once, then give it to teams or individual people under Teams & people. Tasks keep the skill version they started with.</p><div class="space-skills-list">${config.skills.map(s => `<button type="button" class="space-note" data-edit-skill="${esc(s.id)}"><b>${esc(s.name)} <small>v${s.revision}</small></b><span>${esc(s.description || 'Reusable working instructions')}</span></button>`).join('') || '<p>No skills yet.</p>'}</div><div class="space-actions"><button type="button" class="secondary" id="spaceSkillAgency">Add a method from the Agency</button></div><div id="spaceAgencySkillPicker" hidden></div><h3>${skill ? 'Edit skill' : 'Create a skill'}</h3><form id="spaceSkillForm" data-dirty><label>Name<input name="name" value="${esc(skill?.name || '')}" required maxlength="100"></label><label>When to use it<input name="description" value="${esc(skill?.description || '')}" maxlength="500"></label><label>Method and output requirements<textarea name="instructions" rows="8" required maxlength="10000">${esc(skill?.instructions || '')}</textarea></label><div class="space-actions"><button type="submit">Save skill</button>${skill ? '<button class="secondary" type="button" id="spaceNewSkill">New skill</button><button class="secondary" type="button" id="spaceDeleteSkill">Remove</button>' : ''}</div></form>`;
      content.querySelectorAll('[data-edit-skill]').forEach(button => button.onclick = () => showSkills(button.dataset.editSkill));
      $('spaceSkillAgency').onclick = () => agencyPicker($('spaceAgencySkillPicker'), { mode: 'skill', teams: config.teams, onDone: async r => { await showSkills(r.skill.id); feedback(`Added “${r.skill.name}”. It is assigned to: ${[...r.teams, ...r.agents].join(', ') || 'nobody yet'}.`); } });
      $('spaceSkillForm').onsubmit = async event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.target)); const updated = { ...skill, ...values, id: skill?.id || 'skill-' + crypto.randomUUID().slice(0, 8) }; config.skills = skill ? config.skills.map(s => s.id === skill.id ? updated : s) : [...config.skills, updated]; try { await api('/office', 'PUT', config); dirty = false; await showSkills(updated.id); feedback('Saved. Give this skill to a team under Teams & people.'); } catch (error) { feedback(error.message, true); } };
      if (skill) {
        $('spaceNewSkill').onclick = () => showSkills();
        $('spaceDeleteSkill').onclick = async () => { if (!confirm(`Remove “${skill.name}” from the library and from every team and person?`)) return; config.skills = config.skills.filter(s => s.id !== skill.id); for (const t of config.teams) t.skills = t.skills.filter(id => id !== skill.id); for (const a of config.agents) a.skills = a.skills.filter(id => id !== skill.id); try { await api('/office', 'PUT', config); await showSkills(); feedback('Skill removed. Tasks already running keep their saved copy.'); } catch (error) { feedback(error.message, true); } };
      }
    } catch (error) { feedback(error.message, true); }
  }

  /* ---------- Routines ---------- */
  async function showRoutines() {
    try {
      const [data, office] = await Promise.all([api('/routines'), api('/office')]); config = office;
      const teamName = id => office.teams.find(t => t.id === id)?.name || DEPTS[id]?.name || id, personName = id => office.agents.find(a => a.id === id)?.name || id;
      content.innerHTML = `<p>Routines are tasks the office starts on its own clock. Each one runs through the team lead like any other task.</p>
        ${data.problems?.length ? `<aside class="space-task-blocker"><b>Some routines could not be read</b><p>${data.problems.map(esc).join('<br>')}</p></aside>` : ''}
        <div class="space-tools">${data.routines.map(r => `<article><div><b>${esc(r.title)}</b><span>${esc(teamName(r.dept))} · ${esc(personName(r.agent))} · ${esc(r.desc || '')}</span><small>${r.paused ? 'Paused' : 'Next run ' + when(r.nextAt)}${r.lastAt ? ' · Last run ' + when(r.lastAt) : ''} · ${r.needsOk ? 'Asks you before closing' : 'Closes after the lead approves'}</small></div><div class="space-actions"><button type="button" class="secondary" data-routine-run="${esc(r.id)}">Run now</button><button type="button" class="secondary" data-routine-pause="${esc(r.id)}" data-paused="${r.paused ? 1 : 0}">${r.paused ? 'Resume' : 'Pause'}</button><button type="button" class="secondary" data-routine-ok="${esc(r.id)}" data-ok="${r.needsOk ? 1 : 0}">${r.needsOk ? 'Stop asking me' : 'Ask me first'}</button><button type="button" class="secondary" data-routine-remove="${esc(r.id)}">Remove</button></div></article>`).join('') || '<p>No routines yet.</p>'}</div>
        <h3>New routine</h3><form id="spaceRoutineForm" data-dirty><div class="space-grid"><label>Team<select name="dept">${office.teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label><label>Owner<select name="agent"></select></label></div>
        <label>When, and what to do<textarea name="text" rows="3" required placeholder="Every weekday at 8am, list yesterday's unanswered customer emails and draft replies."></textarea><small>Start with the schedule: “every Monday at 9am, …”, “weekdays 17:30, …”, “daily at 8am, …”.</small></label>
        <label class="space-check"><input type="checkbox" name="needsOk" checked>Ask me before the result is closed</label><div class="space-actions"><button type="submit">Add routine</button></div></form>`;
      const form = $('spaceRoutineForm'), people = () => { const dept = form.elements.dept.value, lead = office.teams.find(t => t.id === dept)?.lead; form.elements.agent.innerHTML = office.agents.filter(a => a.department === dept).map(a => `<option value="${a.id}" ${a.id === lead ? 'selected' : ''}>${esc(a.name)}${a.id === lead ? ' (lead)' : ''}</option>`).join(''); };
      form.elements.dept.onchange = people; people();
      form.onsubmit = async event => { event.preventDefault(); const f = form.elements; try { const r = await api('/routines', 'POST', { dept: f.dept.value, agent: f.agent.value, text: f.text.value, needsOk: f.needsOk.checked }); dirty = false; await showRoutines(); feedback(`Added “${r.routine.title}”: ${r.routine.desc}.`); } catch (error) { feedback(error.message, true); } };
      const act = (attr, fn) => content.querySelectorAll(`[${attr}]`).forEach(b => b.onclick = async () => { b.disabled = true; try { await fn(b.getAttribute(attr), b); await showRoutines(); } catch (error) { feedback(error.message, true); b.disabled = false; } });
      act('data-routine-run', async id => { const r = await api(`/routines/${id}/run`, 'POST', {}); feedback('Started. The task is on the board.'); if (r.task?.id) setTimeout(() => openTask(r.task.id), 300); });
      act('data-routine-pause', (id, b) => api(`/routines/${id}/${b.dataset.paused === '1' ? 'resume' : 'pause'}`, 'POST', {}));
      act('data-routine-ok', (id, b) => api(`/routines/${id}`, 'POST', { needsOk: b.dataset.ok !== '1' }));
      act('data-routine-remove', id => confirm('Remove this routine?') ? api(`/routines/${id}`, 'DELETE') : null);
    } catch (error) { feedback(error.message, true); }
  }

  /* ---------- Reports & KPIs ---------- */
  async function showReports() {
    try {
      const [report, k] = await Promise.all([api('/reports?days=' + reportDays), api('/kpis?days=' + reportDays)]);
      if (section !== 'reports') return;
      const number = value => Number(value || 0).toLocaleString(), max = Math.max(1, ...k.throughput.series.map(s => s.done));
      const tile = (value, label) => `<div class="kpi"><b>${value}</b><span>${label}</span></div>`;
      content.innerHTML = `<div class="space-actions"><label>Period<select id="spaceReportPeriod">${[[7, 'Past 7 days'], [30, 'Past 30 days'], [90, 'Past 90 days'], [0, 'All time']].map(([days, label]) => `<option value="${days}" ${days === reportDays ? 'selected' : ''}>${label}</option>`).join('')}</select></label><button type="button" class="secondary" id="spaceReportRefresh">Refresh</button><button type="button" class="secondary" id="spaceExportReport">Export report</button></div>
        <div class="kpi-grid">${tile(number(k.throughput.done), `tasks done · ${k.throughput.perDay} a day`)}${tile(duration(k.cycle.p50), `typical time to done · slowest 10% ${duration(k.cycle.p90)}`)}${tile(duration(k.leadReviewMs), 'average wait for a lead review')}${tile(duration(k.ceoLatencyMs), 'your average response time')}${tile(k.reworkRate == null ? '—' : Math.round(k.reworkRate * 100) + '%', 'of reviewed work sent back')}${tile(number(k.needsYou), 'need you now')}${tile(number(k.overdue), 'overdue')}${tile(duration(k.blockedAgeMs), 'longest wait on you')}</div>
        ${k.throughput.series.length ? `<div class="kpi-bars" aria-label="Tasks done per day">${k.throughput.series.map(s => `<i style="height:${Math.round(100 * s.done / max)}%" title="${esc(s.day)}: ${s.done}"></i>`).join('')}</div><p class="space-footnote">Tasks done per day.</p>` : ''}
        <h3>Teams</h3><div class="space-report-table"><table><thead><tr><th>Team</th><th>Done</th><th>Active</th><th>Blocked</th><th>Calls</th><th>Tokens</th><th>Typical cycle</th></tr></thead><tbody>${report.teams.map(t => `<tr><td>${esc(t.name)}</td><td>${t.approved}</td><td>${t.active}</td><td>${t.blocked}</td><td>${number(t.calls)}</td><td>${number(t.tokens)}</td><td>${duration(t.medianCycleMs)}</td></tr>`).join('')}</tbody></table></div>
        <h3>People</h3><div class="space-report-table"><table><thead><tr><th>Person</th><th>Working now</th><th>Runs</th><th>Average run</th></tr></thead><tbody>${k.agents.filter(a => a.runs || a.active).map(a => `<tr><td>${esc(a.name)}</td><td>${a.active}</td><td>${a.runs}</td><td>${duration(a.avgRunMs)}</td></tr>`).join('') || '<tr><td colspan="4">No runs in this period.</td></tr>'}</tbody></table></div>
        ${Object.keys(k.tokensByModel || {}).length ? `<h3>Tokens by model</h3><div class="space-report-table"><table><tbody>${Object.entries(k.tokensByModel).map(([m, n]) => `<tr><td>${esc(m)}</td><td>${number(n)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <h3>Needs attention</h3>${report.attention.map(j => `<button type="button" class="space-note" data-report-job="${j.id}"><b>${esc(j.title)}</b><span>${esc(j.teamName || DEPTS[j.dept]?.name || j.dept)} · ${stateLabel(j.state)} · ${esc(j.reason)}</span></button>`).join('') || '<p>Nothing is blocked or waiting for you in this period.</p>'}
        <h3>Test results</h3><p>${report.tests.approved}/${report.tests.total} passed · ${report.tests.active} running or queued · ${report.tests.blocked} blocked.</p>${report.suites.map(suite => `<details><summary>${esc(DEPTS[suite.dept]?.name || suite.dept)} · ${when(suite.createdAt)}</summary>${suite.jobs.map(j => `<button type="button" class="space-note" data-report-job="${j.id}"><b>${esc(j.name)}</b><span>${j.state === 'done' ? 'Passed' : stateLabel(j.state)}${j.error ? ' · ' + esc(j.error) : ''}</span></button>`).join('')}</details>`).join('')}
        <h3>Finished work</h3>${report.completed.map(j => `<button type="button" class="space-note" data-report-job="${j.id}"><b>${esc(j.title)}</b><span>${esc(j.teamName || DEPTS[j.dept]?.name || j.dept)} · ${when(j.doneAt)}</span></button>`).join('') || '<p>Nothing finished in this period.</p>'}`;
      $('spaceReportPeriod').onchange = event => { reportDays = Number(event.target.value); showReports(); };
      $('spaceReportRefresh').onclick = () => showReports();
      content.querySelectorAll('[data-report-job]').forEach(button => button.onclick = () => openTask(button.dataset.reportJob));
      $('spaceExportReport').onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify({ report, kpis: k }, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'office-report-' + new Date(report.generatedAt).toISOString().slice(0, 10) + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    } catch (error) { feedback(error.message, true); }
  }

  /* ---------- Brain ---------- */
  let brainFolder = '';
  async function showBrain() {
    try {
      const [notes, folders, status] = await Promise.all([api('/knowledge'), api('/knowledge/folders'), api('/knowledge/status').catch(() => null)]);
      if (section !== 'brain') return;
      const indexLine = status ? `Search index: ${esc(status.backend || status.engine || 'ready')}${status.notes != null ? ` · ${Number(status.notes).toLocaleString()} notes` : ''}${status.chunks != null ? ` · ${Number(status.chunks).toLocaleString()} passages` : ''}${status.builtAt || status.updatedAt ? ` · updated ${when(status.builtAt || status.updatedAt)}` : ''}` : 'Search index status unavailable.';
      content.innerHTML = `<p>The company's shared memory. The Program Manager, every lead and every specialist search it before and during work. Finished tasks, digests and your uploads land here.</p>
        <div class="space-actions"><button type="button" id="spacePurpose">Office purpose</button><button type="button" class="secondary" id="spaceNewNote">Add note</button><button type="button" class="secondary" id="spaceGraph">View the Brain</button><button type="button" class="secondary" id="spaceReindex">Rebuild search index</button></div><p class="space-footnote">${indexLine}</p>
        <h3>Upload documents</h3><form id="spaceUploadForm"><div class="space-grid"><label>Folder<select name="folder">${folders.map(f => `<option ${f === 'Company' ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></label><label class="space-upload">Files<input type="file" name="files" multiple accept=".pdf,.docx,.txt,.md,.csv"><small>PDF, Word, text, Markdown or CSV · up to 25 MB each. Uploading a file with the same name replaces it and archives the old copy.</small></label></div><div class="space-actions"><button type="submit">Upload</button></div></form>
        <h3>Search</h3><form id="spaceSearchForm" class="space-actions"><input name="q" type="search" placeholder="What do we know about…" required><button type="submit" class="secondary">Search</button></form><div id="spaceSearchResults"></div>
        <h3>Notes</h3><div class="space-actions"><label>Folder<select id="spaceNoteFolder"><option value="">All folders</option>${folders.map(f => `<option ${f === brainFolder ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></label><input id="spaceFindNote" type="search" placeholder="Filter by title or text"></div><div id="spaceKnowledgeList"></div>`;
      const list = () => { const query = $('spaceFindNote').value.toLowerCase(); $('spaceKnowledgeList').innerHTML = notes.filter(n => (!brainFolder || n.id.startsWith(brainFolder + '/')) && (n.title + ' ' + n.preview).toLowerCase().includes(query)).slice(0, 200).map(n => `<button type="button" class="space-note" data-note="${esc(n.id)}"><b>${esc(n.title)}</b><span>${esc(n.id.split('/').slice(0, -1).join('/') || 'Brain')} · ${when(n.updatedAt)}</span><p>${esc(n.preview)}</p></button>`).join('') || '<div class="space-empty">No notes here yet.</div>'; $('spaceKnowledgeList').querySelectorAll('[data-note]').forEach(b => b.onclick = () => viewNote(b.dataset.note)); };
      $('spaceFindNote').oninput = list; $('spaceNoteFolder').onchange = event => { brainFolder = event.target.value; list(); }; list();
      $('spaceNewNote').onclick = () => editNote(); $('spacePurpose').onclick = () => editNote('Knowledge/office-purpose.md', true);
      $('spaceGraph').onclick = () => { close(); brain?.toggle?.(); };
      $('spaceReindex').onclick = async event => { event.target.disabled = true; try { const r = await api('/knowledge/reindex', 'POST', {}); feedback(`Search index rebuilt from ${r.notes} notes.`); await showBrain(); } catch (error) { feedback(error.message, true); event.target.disabled = false; } };
      $('spaceUploadForm').onsubmit = async event => {
        event.preventDefault(); const form = event.target, files = [...form.elements.files.files], button = form.querySelector('button'); if (!files.length) return feedback('Choose at least one file.', true);
        button.disabled = true;
        try {
          const done = [];
          for (const file of files) { if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} is larger than 25 MB.`); feedback(`Reading ${file.name}…`); const r = await api('/knowledge/upload', 'POST', { folder: form.elements.folder.value, name: file.name, data: await readFile(file) }); done.push(`${r.id}${r.replaced ? ' (replaced)' : ''}`); }
          await syncBrain?.(); await showBrain(); feedback(`Added to the Brain: ${done.join(', ')}. Agents can search it now.`);
        } catch (error) { feedback(error.message, true); button.disabled = false; }
      };
      $('spaceSearchForm').onsubmit = async event => {
        event.preventDefault(); const q = event.target.elements.q.value.trim(); if (!q) return;
        try {
          const r = await api('/knowledge/search?q=' + encodeURIComponent(q) + (brainFolder ? '&folder=' + encodeURIComponent(brainFolder) : ''));
          const hits = Array.isArray(r) ? r : r.results || r.hits || [];
          $('spaceSearchResults').innerHTML = hits.map(h => `<button type="button" class="space-note" data-note="${esc(h.id || h.path)}"><b>${esc(h.title || h.id || h.path)}</b><span>${esc(h.id || h.path)}${h.score != null ? ` · match ${Number(h.score).toFixed(2)}` : ''}</span><p>${esc(String(h.snippet || h.text || '').slice(0, 300))}</p></button>`).join('') || '<p>Nothing in the Brain matches that yet.</p>';
          $('spaceSearchResults').querySelectorAll('[data-note]').forEach(b => b.onclick = () => viewNote(b.dataset.note));
        } catch (error) { feedback(error.message, true); }
      };
      if (pendingNote) { const id = pendingNote; pendingNote = null; viewNote(id); }
    } catch (error) { feedback(error.message, true); }
  }
  async function viewNote(id) {
    try {
      const note = await api('/knowledge/note?id=' + encodeURIComponent(id));
      content.innerHTML = `<div class="space-actions"><button type="button" class="secondary" id="spaceBackMemory">← Brain</button><button type="button" class="secondary" id="spaceEditMemory">Edit note</button></div><p class="space-footnote">${esc(id)} · Updated ${when(note.updatedAt)}</p><article class="space-document">${renderDocument(note.content.slice(0, 200000), 'memory').html}</article>`;
      $('spaceBackMemory').onclick = showBrain; $('spaceEditMemory').onclick = () => editNote(id); main.scrollTop = 0;
    } catch (error) { feedback(error.message, true); }
  }
  async function editNote(id, purpose = false) {
    let note = { content: '', id };
    try { if (id) note = await api('/knowledge/note?id=' + encodeURIComponent(id)); } catch (error) { if (!purpose) return feedback(error.message, true); }
    content.innerHTML = `<button type="button" class="secondary" id="spaceBackKnowledge">← Brain</button><h3>${purpose ? 'Office purpose' : id ? 'Edit note' : 'New note'}</h3><form id="spaceNoteForm" data-dirty><label>Title<input name="title" value="${esc(purpose ? 'Office purpose' : note.content.match(/^#\s+(.+)$/m)?.[1] || '')}" required></label><label>${purpose ? 'Describe the business, who you serve, what the teams should achieve, and important constraints.' : 'Markdown content'}<textarea name="content" rows="16" required>${esc(note.content)}</textarea></label><div class="space-actions"><button type="submit">Save</button>${id && note.updatedAt ? '<button type="button" class="secondary" id="spaceArchiveNote">Archive note</button>' : ''}</div></form>`;
    $('spaceBackKnowledge').onclick = showBrain;
    $('spaceNoteForm').onsubmit = async event => { event.preventDefault(); try { const form = event.target; await api('/knowledge', 'POST', { id: note.id, title: form.elements.title.value, content: '# ' + form.elements.title.value.trim() + '\n\n' + form.elements.content.value.replace(/^#\s+.*(?:\r?\n)?/, '').trim(), updatedAt: note.updatedAt }); dirty = false; await syncBrain?.(); await showBrain(); feedback('Saved. The next task can use it.'); } catch (error) { feedback(error.message, true); } };
    if ($('spaceArchiveNote')) $('spaceArchiveNote').onclick = async () => { if (!confirm('Archive this note? Agents will stop finding it.')) return; try { await api('/knowledge/note?id=' + encodeURIComponent(id), 'DELETE'); dirty = false; await syncBrain?.(); await showBrain(); feedback('Archived. Agents no longer find this note.'); } catch (error) { feedback(error.message, true); } };
  }

  /* ---------- Audit ---------- */
  let auditArea = '';
  async function showAudit() {
    try {
      const rows = await api('/audit?limit=200' + (auditArea ? '&area=' + auditArea : ''));
      if (section !== 'audit') return;
      const show = v => v === undefined ? '—' : esc(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 240);
      content.innerHTML = `<p>Every change to the office's configuration, who made it and what changed. Keys and tokens are never recorded.</p><div class="space-actions"><label>Area<select id="spaceAuditArea">${[['', 'Everything'], ['office', 'Teams & people'], ['providers', 'Models & keys'], ['settings', 'Office settings'], ['tools', 'Connectors'], ['routines', 'Routines'], ['brain', 'Brain']].map(([id, label]) => `<option value="${id}" ${id === auditArea ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>
        ${rows.map(r => `<div class="audit-item"><time>${when(r.at)}</time><b>${esc(r.summary)}</b> <small>${esc(r.actor || 'you')} · ${esc(r.area)}</small>${r.diff?.length ? `<details><summary>${r.diff.length} change${r.diff.length === 1 ? '' : 's'}</summary>${r.diff.slice(0, 40).map(d => `<p><code>${esc(d.path || d.key || '')}</code> ${show(d.before)} → ${show(d.after)}</p>`).join('')}</details>` : ''}</div>`).join('') || '<p>No changes recorded yet.</p>'}`;
      $('spaceAuditArea').onchange = event => { auditArea = event.target.value; showAudit(); };
    } catch (error) { feedback(error.message, true); }
  }

  route();
  return { open, close, isOpen: () => !page.hidden, onEvent: (type, data) => { if (type === 'office.updated' && data?.area === 'tools' && section === 'tools' && $('spaceRefreshTools') && $('spaceToolEditor')?.hidden) showTools(); }, openNote: id => { pendingNote = id; open('brain'); if (section === 'brain') showBrain(); } };
}
