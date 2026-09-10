import MarkdownIt from 'markdown-it';

export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });
// Outputs are untrusted content. Never load remote images or interpret raw HTML.
md.validateLink = href => {
  try { return ['https:', 'http:', 'mailto:'].includes(new URL(href).protocol); }
  catch { return false; }
};
md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return renderer.renderToken(tokens, index, options);
};
md.renderer.rules.image = (tokens, index) => `<span class="space-image-description">${escapeHTML(tokens[index].content || 'Image reference')}</span>`;
md.renderer.rules.table_open = () => '<div class="space-document-table" tabindex="0" role="region" aria-label="Result table"><table>';
md.renderer.rules.table_close = () => '</table></div>';
md.core.ruler.after('inline', 'output_checklists', state => {
  for (let i = 2; i < state.tokens.length; i++) {
    const inline = state.tokens[i], item = state.tokens[i - 2];
    if (inline.type !== 'inline' || item.type !== 'list_item_open' || inline.children?.[0]?.type !== 'text') continue;
    const match = inline.children[0].content.match(/^\[([ xX])\]\s+/);
    if (!match) continue;
    inline.children[0].content = inline.children[0].content.slice(match[0].length);
    const checkbox = new state.Token('output_checkbox', '', 0);
    checkbox.meta = { checked: match[1].toLowerCase() === 'x' };
    inline.children.unshift(checkbox);
    item.attrJoin('class', 'space-checklist-item');
  }
});
md.renderer.rules.output_checkbox = (tokens, index) => `<span class="space-checklist-box" role="img" aria-label="${tokens[index].meta.checked ? 'Checked' : 'Unchecked'}">${tokens[index].meta.checked ? '☑' : '☐'}</span>`;

export function renderDocument(value, prefix = 'output') {
  const tokens = md.parse(String(value || ''), {}), sections = [];
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '');
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'heading_open') continue;
    const id = `${safePrefix}-section-${sections.length + 1}`;
    tokens[i].attrSet('id', id);
    const title = md.renderer.renderInlineAsText(tokens[i + 1]?.children || [], md.options, {});
    sections.push({ id, title, level: Number(tokens[i].tag.slice(1)) });
  }
  return { html: md.renderer.render(tokens, md.options, {}), sections };
}

export function outputExcerpt(value, limit = 160) {
  const tokens = md.parse(String(value || ''), {});
  // Prefer actual prose to a repeated document title or formatting syntax.
  const index = tokens.findIndex(token => token.type === 'paragraph_open');
  const inline = index >= 0 ? tokens[index + 1] : tokens.find(token => token.type === 'inline');
  const text = md.renderer.renderInlineAsText(inline?.children || [], md.options, {}).replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + '…' : text;
}

export function resultState(job) {
  if (job.state === 'done') return { label: 'Approved result', tone: 'approved', note: 'Lead verification complete' };
  if (job.state === 'waiting' && job.review?.approved) return { label: 'Ready for your review', tone: 'waiting', note: 'Lead verified · awaiting your approval' };
  if (job.state === 'cancelled') return { label: 'Cancelled', tone: 'muted', note: 'This task is closed' };
  if (job.state === 'blocked') return { label: 'Needs attention', tone: 'blocked', note: 'Completion is blocked' };
  if (job.state === 'saving') return { label: 'Saving result', tone: 'waiting', note: 'Verification complete · saving to the Brain' };
  return { label: job.state === 'backlog' ? 'Saved idea' : 'In progress', tone: 'muted', note: job.state === 'backlog' ? 'Agents have not started' : 'Work is in progress · not yet approved' };
}

const esc = escapeHTML;
const labels = { backlog:'Saved idea', queued:'Queued', planning:'Planning', working:'Working', reviewing:'Lead review', waiting:'Awaiting approval', saving:'Saving', blocked:'Blocked', done:'Submitted', pending:'Pending', failed:'Failed', interrupted:'Interrupted', cancelled:'Cancelled' };
const when = date => date ? new Date(date).toLocaleString() : '—';
const prose = (text, prefix) => `<div class="space-document">${renderDocument(text, prefix).html}</div>`;
const empty = (title, text) => `<div class="space-output-empty"><span aria-hidden="true">○</span><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;

export function renderTaskWorkspace(job, tab, actions = '') {
  const name = id => job.agents.find(a => a.id === id)?.name || id || 'Unassigned';
  const status = resultState(job);
  const total = job.subtasks.length, submitted = job.subtasks.filter(s => s.state === 'done').length;
  const result = () => {
    if (!job.result) return empty(job.state === 'cancelled' ? 'No result was produced' : 'The result will appear here', job.state === 'backlog' ? 'Refine the brief in Team work, then start the task when you are ready.' : job.state === 'blocked' ? 'Check the blocker and the team’s work before retrying.' : job.state === 'cancelled' ? 'The task was cancelled before a deliverable was assembled.' : 'Follow individual drafts in Team work. The lead will assemble and verify the final deliverable.');
    const document = renderDocument(job.result, 'result');
    const topLevel = Math.min(...document.sections.map(s => s.level));
    const contents = document.sections.filter(s => s.level <= Math.max(2, topLevel) && !(s.level === 1 && document.sections.some(other => other.level === 2))).slice(0, 12);
    const last = job.reviews?.[job.reviews.length - 1];
    const criteria = [...(job.team.criteria || []), ...(job.team.guardrails || [])];
    const checks = last ? [...(last.criteria || []).filter(c => c && typeof c === 'object').map(c => ({ ...c, label: criteria[Number(String(c.id || '').replace('criterion-', '')) - 1] || c.id })), ...(last.checks || [])] : [];
    const workers = job.subtasks.filter(s => s.agent).map(s => `<div class="space-aside-row"><span class="rn-a" style="border-color:${s.state === 'done' ? '#1E9070' : 'rgba(21,20,20,.3)'}">${esc(name(s.agent)[0] || '·')}</span><span>${esc(name(s.agent))} ${s.state === 'done' ? 'did' : 'is on'} ${esc(s.title.toLowerCase())}${s.tools?.length ? `<small>${s.tools.map(esc).join(' · ')}</small>` : ''}</span></div>`).join('');
    const started = job.createdAt ? new Date(job.createdAt) : null, ended = job.doneAt || job.review?.at ? new Date(job.doneAt || job.review.at) : null;
    const dur = started && ended ? Math.max(1, Math.round((ended - started) / 60000)) + ' min' : '';
    const aside = `<aside class="space-result-aside"><div><div class="space-aside-lab">WHO</div><div class="space-aside-row"><span class="rn-a" style="border-color:#C8A438">★</span><span>${esc(name(job.team.lead))} planned${job.review ? ' · reviewed' : ''}</span></div>${workers}</div>
      ${checks.length ? `<div><div class="space-aside-lab">CHECKS · ${checks.filter(c => c.passed).length}/${checks.length}</div>${checks.map(c => `<div class="space-aside-check ${c.passed ? '' : 'failed'}"><span>${c.passed ? '✓' : '×'}</span><div>${esc(c.label)}</div></div>`).join('')}</div>` : ''}
      ${last?.summary ? `<div><div class="space-aside-lab">LEAD’S NOTE</div><div class="space-aside-note">${esc(last.summary)}</div></div>` : ''}
      <div class="space-aside-stats">${[job.model, job.effort, job.calls ? job.calls + ' calls' : '', job.tokens ? (job.tokens / 1000).toFixed(1) + 'k tokens' : '', dur].filter(Boolean).map(esc).join(' · ')}${job.state === 'waiting' ? '<br>Approving saves this to the Brain as a note the whole office can read.' : ''}</div></aside>`;
    return `<div class="space-result-toolbar"><span>${job.state === 'done' ? 'Final deliverable' : 'Draft deliverable · not approved for completion'}</span><div><button class="space-text-action" id="spaceCopyResult" type="button">Copy</button><button class="space-text-action" id="spaceDownloadResult" type="button">Download .md</button></div></div>
      <div class="space-result-layout"><div>${contents.length >= 3 ? `<details class="space-document-outline" data-detail-key="outline"><summary>In this result <small>${contents.length} sections</small></summary><nav aria-label="In this result">${contents.map(s=>`<a href="#${s.id}" data-output-anchor="${s.id}">${esc(s.title)}</a>`).join('')}</nav></details>` : ''}
      <article class="space-document space-deliverable" aria-label="${job.state === 'done' ? 'Approved' : 'Draft'} deliverable">${document.html}</article>
      <footer class="space-result-provenance"><span>${esc(status.note)}</span><span>${esc(name(job.team.lead))}${job.review?.at ? ' · ' + esc(when(job.review.at)) : ''}</span></footer></div>${aside}</div>`;
  };
  // Artifacts: every file the team wrote in this task's workspace, newest first, exported documents first; each one downloads.
  const size = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const artifacts = () => {
    const exported = n => /\.(pdf|pptx|docx)$/i.test(n);
    const files = [...(job.files || [])].sort((a, b) => (exported(b.name) - exported(a.name)) || b.modifiedAt - a.modifiedAt);
    if (!files.length) return empty('No files yet', job.state === 'done' ? 'This task delivered its result as text. Ask for a PDF and the team exports one here.' : 'Files the team writes while working appear here: drafts, exports, data.');
    return `<div class="space-artifacts"><p class="space-artifacts-intro">${files.length} file${files.length === 1 ? '' : 's'} in this task’s workspace. Documents the team exported come first.</p><ul class="space-artifact-list">${files.map(f => `<li class="space-artifact${exported(f.name) ? ' pdf' : ''}"><span class="space-artifact-icon" aria-hidden="true">${/\.pdf$/i.test(f.name) ? 'PDF' : /\.pptx$/i.test(f.name) ? 'PPTX' : /\.docx$/i.test(f.name) ? 'DOCX' : /\.(md|markdown)$/i.test(f.name) ? 'MD' : /\.csv$/i.test(f.name) ? 'CSV' : /\.json$/i.test(f.name) ? 'JSON' : /\.html?$/i.test(f.name) ? 'HTML' : 'FILE'}</span><span class="space-artifact-body"><b>${esc(f.name)}</b><small>${size(f.bytes)} · ${esc(when(f.modifiedAt))}</small></span><a class="space-artifact-download" href="/api/tasks/${job.id}/file?path=${encodeURIComponent(f.name)}" download>Download</a></li>`).join('')}</ul></div>`;
  };
  const work = () => `<details data-detail-key="brief" class="space-task-brief"><summary>Original brief</summary>${prose(job.text,'brief')}</details>
    <div class="space-work-intro"><h3>${total ? 'The team’s plan' : job.state === 'backlog' ? 'Shape the brief' : 'Planning'}</h3><p>${esc(job.plan || (job.state === 'backlog' ? 'This idea is saved. Edit the brief and start it below.' : job.state === 'cancelled' ? 'No plan was completed.' : 'The lead will define the assignments and acceptance criteria.'))}</p>${total ? `<span class="space-footnote">${submitted} of ${total} assignments submitted${job.review?.approved ? ' · Lead review passed' : ' · Lead verification required'}</span>` : ''}</div>
    ${(job.todos || []).length ? `<div class="task-plan"><b>The Program Manager’s plan</b><ul>${job.todos.map(t => `<li class="${esc(t.status)}">${esc(t.content)}</li>`).join('')}</ul></div>` : ''}
    <div class="space-steps">${job.subtasks.map((step, i) => {
      const live = step.state === 'working' ? job.liveCalls?.[step.agent] : null;
      const preview = live?.preview;
      return `<details data-step-id="${step.id}" data-detail-key="step-${step.id}" ${step.state === 'working' ? 'open' : ''}><summary><span class="space-step-number">${String(i + 1).padStart(2,'0')}</span><span class="space-step-title">${esc(step.title)}<small>${esc(name(step.agent || step.eligible[0]))}</small></span><span class="space-state">${labels[step.state] || esc(step.state)}</span></summary><div class="space-execution-choice"><b>${esc(step.modelUsed || job.model || step.model || 'Configured model')} · ${esc(step.effortUsed || step.effort || 'default')} effort</b><span>${esc(step.complexity || '')} · ${esc(step.routingReason || 'Saved execution settings')}</span><span>Selected tools: ${(step.requiredTools || []).map(esc).join(', ') || 'None'}</span></div><p>${esc(step.instructions)}</p>
        <div class="space-step-requirements"><b>Acceptance</b><ul>${step.acceptance.map(c=>`<li>${esc(c)}</li>`).join('')}</ul></div>
        ${step.dependencies.length ? `<p class="space-footnote">Depends on: ${step.dependencies.map(id=>esc(job.subtasks.find(s=>s.id===id)?.title || id)).join(' · ')}</p>` : ''}
        ${step.feedback ? `<aside class="space-review-note"><b>Requested changes</b><p>${esc(step.feedback)}</p></aside>` : ''}
        ${step.error && ['failed','interrupted'].includes(step.state) ? `<p class="error">${esc(step.error)}</p>` : ''}
        ${preview ? `<p class="space-draft-label">Live draft · not yet reviewed</p><div class="space-live-draft">${prose(preview,'draft-'+i)}</div>` : step.output ? `<p class="space-draft-label">${step.state === 'done' ? 'Worker submission' : 'Previous submission'}</p>${prose(step.output,'submission-'+i)}` : '<p class="space-footnote">No submission yet.</p>'}
        ${live?.state === 'running' ? `<p class="space-footnote">${live.tool ? esc(live.tool)+' · ' : ''}Last update ${esc(when(live.lastEventAt))}</p>` : ''}
        ${step.notes?.length || step.tools?.length ? `<details data-detail-key="sources-${step.id}"><summary>Sources & tools</summary>${step.notes?.length ? `<p>Knowledge: ${step.notes.map(esc).join(' · ')}</p>` : ''}${step.tools?.length ? `<p>Tools used: ${step.tools.map(esc).join(' · ')}</p>` : ''}</details>` : ''}</details>`;
    }).join('')}</div>
    <details data-detail-key="timeline"><summary>Activity timeline <small>${job.events.length} recorded events</small></summary><ol class="space-history">${job.events.map(e=>`<li><time>${esc(when(e.at))}</time><div><b>${esc(e.agent ? name(e.agent) : 'Office')}</b><span>${esc(e.message)}</span></div></li>`).join('')}</ol></details>`;
  const review = () => {
    const criteria = [...job.team.criteria, ...(job.team.guardrails || [])];
    return `<div class="space-work-intro"><h3>Lead verification</h3><p>${job.review?.approved ? 'The lead checked the assembled deliverable against the team’s requirements.' : 'Submissions must pass the lead’s review and every automated check before completion.'}</p></div>
      ${job.reviews.length ? job.reviews.map((r,i)=>`<details data-review-id="review-${i}" data-detail-key="review-${i}" ${i===job.reviews.length-1?'open':''}><summary>Review ${i+1} · ${r.approved ? 'Passed' : 'Changes required'}<small>${esc(name(r.agent))} · ${esc(when(r.at))}</small></summary><p>${esc(r.summary)}</p><div class="space-review-checks">${[...(r.criteria || []).filter(c=>c&&typeof c==='object').map(c=>({...c,label:criteria[Number(String(c.id || '').replace('criterion-',''))-1] || c.id})),...(r.checks || [])].map(c=>`<div class="space-review-check ${c.passed?'passed':'failed'}"><span aria-label="${c.passed?'Passed':'Failed'}">${c.passed?'✓':'×'}</span><div><b>${esc(c.label)}</b><p>${esc(c.evidence)}</p></div></div>`).join('')}</div></details>`).join('') : empty('Review has not started', 'The lead will review the actual submissions once the team has finished its work.')}
      ${job.requireHumanApproval ? `<p class="space-approval-record">${job.humanApproved ? '✓ Owner approval recorded' : 'Owner approval is required before completion.'}</p>` : ''}
      <details data-detail-key="run-details"><summary>Run details</summary><div class="space-task-meta"><span>${job.calls}/${job.team.maxCalls} model calls</span><span>${job.tokens.toLocaleString()}/${job.team.maxTokens.toLocaleString()} reported tokens</span><span>Team configuration v${job.officeRevision}</span>${job.skills?.length ? `<span>Skills: ${job.skills.map(s=>esc(s.name)+' v'+s.revision).join(' · ')}</span>` : ''}</div></details>`;
  };
  return `${['planning','reviewing'].includes(job.state)?`<div class="space-phase-banner ${job.state}"><i class="space-spinner"></i><div><b>${job.state==='planning'?'Planning the work':'Verifying the deliverable'}</b><span>${esc(name(job.team.lead))} · ${esc(job.liveCalls?.[job.team.lead]?.model || job.model || (job.state==='planning'?job.team.planningModel:job.team.reviewModel))} · ${esc(job.liveCalls?.[job.team.lead]?.effort || 'high')} effort</span></div></div>`:''}<div class="space-task-summary"><span class="space-result-state ${status.tone}">${esc(status.label)}</span><span>${esc(job.team.name)} · ${esc(name(job.team.lead))}</span></div>
    ${job.state === 'blocked' && job.error ? `<aside class="space-task-blocker"><b>What needs attention</b><p>${esc(job.error)}</p></aside>` : ''}
    <nav class="space-task-tabs" role="tablist" aria-label="Task views">${[['result','Result'],['work','How it was done'],['review','Review'],['artifacts','Artifacts']].map(([id,label])=>`<button type="button" role="tab" id="spaceTaskTab-${id}" data-task-tab="${id}" aria-selected="${tab===id}" aria-controls="spaceTaskPanel-${id}" tabindex="${tab===id?'0':'-1'}">${label}${id==='work'&&total?` <span>${total} step${total===1?'':'s'}</span>`:id==='review'&&job.reviews?.length?` <span>${job.reviews[job.reviews.length-1].approved?'passed':'changes'}</span>`:id==='artifacts'&&(job.files||[]).length?` <span>${job.files.length}</span>`:''}</button>`).join('')}</nav>
    ${['result','work','review','artifacts'].map(id=>`<section class="space-task-section" role="tabpanel" id="spaceTaskPanel-${id}" aria-labelledby="spaceTaskTab-${id}" tabindex="0" ${tab!==id?'hidden':''}>${tab!==id?'':id==='result'?result():id==='work'?work():id==='artifacts'?artifacts():review()}</section>`).join('')}
    ${actions ? `<div class="space-task-controls${['waiting','blocked'].includes(job.state) ? ' space-decision-wrap' : ''}">${actions}</div>` : ''}`;
}
