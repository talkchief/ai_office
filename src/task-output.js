import MarkdownIt from 'markdown-it';
import { stateLabel, stepLabel } from './labels.js';

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
  if (job.state === 'done') return { label: 'Done', tone: 'approved', note: 'Approved by the team lead' };
  if (['waiting', 'awaiting_ceo'].includes(job.state)) return { label: 'Needs you', tone: 'waiting', note: 'Waiting for your decision' };
  if (job.state === 'escalated') return { label: 'Needs your direction', tone: 'blocked', note: 'The team is waiting for you' };
  if (job.state === 'cancelled') return { label: 'Cancelled', tone: 'muted', note: 'This task is closed' };
  if (job.state === 'blocked') return { label: 'Blocked', tone: 'blocked', note: 'Retry when the cause is fixed' };
  if (job.state === 'saving') return { label: 'Saving result', tone: 'waiting', note: 'Approved · filing to the Brain' };
  if (job.state === 'backlog') return { label: 'Idea', tone: 'muted', note: 'Not started' };
  return { label: stateLabel(job.state), tone: 'muted', note: 'Work in progress · not yet approved' };
}

const esc = escapeHTML;
const when = date => date ? new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const prose = (text, prefix) => `<div class="space-document">${renderDocument(text, prefix).html}</div>`;
const empty = (title, text) => `<div class="space-output-empty"><span aria-hidden="true">○</span><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
const KIND = { question: 'question', correction: 'correction', note: 'note', answer: 'answer' };

// One page per task: what you can do now, then the result, then how it was done.
export function renderTaskWorkspace(job, { actions = '', version = null } = {}) {
  const name = id => id === 'pm' ? 'Program Manager' : job.agents?.find(a => a.id === id)?.name || id || 'Unassigned';
  const status = resultState(job), versions = job.resultVersions || [];
  const selected = version && versions[version - 1] ? version : versions.length;
  const chosen = versions[selected - 1], text = chosen?.result || job.result;
  const teams = job.autoRoute ? ['Program Manager', ...new Set((job.runs || []).filter(r => r.role === 'lead').map(r => r.dept))] : [job.team?.name || job.dept];
  const meta = [teams.filter(Boolean).join(' · '), job.assignee ? `For ${name(job.assignee)}` : '', job.dueAt ? `Due ${when(job.dueAt)}` : '', versions.length ? `Version ${selected} of ${versions.length}` : ''].filter(Boolean).join(' · ');
  const result = () => {
    if (!text) return empty(job.state === 'cancelled' ? 'No result was produced' : 'The result will appear here', job.state === 'backlog' ? 'Start the task when you are ready.' : job.state === 'cancelled' ? 'The task was cancelled before a result was filed.' : 'The lead assembles and reviews the result before it is filed.');
    const doc = renderDocument(text, 'result'), top = Math.min(...doc.sections.map(s => s.level));
    const outline = doc.sections.filter(s => s.level <= Math.max(2, top) && !(s.level === 1 && doc.sections.some(o => o.level === 2))).slice(0, 12);
    return `${versions.length > 1 ? `<div class="task-versions" role="group" aria-label="Result versions"><span>Versions</span>${versions.map(v => `<button type="button" data-version="${v.n}" aria-pressed="${v.n === selected}">v${v.n}</button>`).join('')}</div>` : ''}
      ${chosen?.correction?.text ? `<p class="task-version-note">Version ${selected} answers your correction: “${esc(chosen.correction.text.slice(0, 300))}”${chosen.summary ? ` · ${esc(chosen.summary.slice(0, 300))}` : ''}</p>` : ''}
      <div class="space-result-toolbar"><span>${job.state === 'done' ? 'Final result' : 'Draft · not approved yet'}</span><div><button class="space-text-action" id="spaceCopyResult" type="button">Copy</button><button class="space-text-action" id="spaceDownloadResult" type="button">Download .md</button></div></div>
      ${outline.length >= 3 ? `<details class="space-document-outline" data-detail-key="outline"><summary>In this result <small>${outline.length} sections</small></summary><nav aria-label="In this result">${outline.map(s => `<a href="#${s.id}" data-output-anchor="${s.id}">${esc(s.title)}</a>`).join('')}</nav></details>` : ''}
      <article class="space-document space-deliverable" aria-label="${job.state === 'done' ? 'Approved' : 'Draft'} result">${doc.html}</article>`;
  };
  const criteriaText = [...(job.team?.criteria || []), ...(job.team?.guardrails || [])];
  const story = [];
  for (const m of job.messages || []) story.push({ at: m.at, cls: m.role === 'ceo' ? 'ceo' : 'agent', who: m.role === 'ceo' ? 'You' : name(m.agent), kind: KIND[m.kind] || '', html: `<p>${esc(m.text)}</p>` });
  for (const r of job.runs || []) {
    const live = r.state === 'working' ? job.liveCalls?.[r.agent]?.preview : '';
    story.push({ at: r.startedAt || 0, cls: 'run', who: name(r.agent), kind: r.role === 'lead' ? 'lead' : '', html: `<details data-detail-key="run-${esc(r.id)}" ${r.state === 'working' ? 'open' : ''}><summary>${esc(r.title)} <span class="space-state">${esc(stepLabel(r.state))}</span></summary>
      ${live ? `<p class="space-draft-label">Live draft · not reviewed yet</p><div class="space-live-draft">${prose(live, 'live-' + r.id)}</div>` : r.output ? prose(r.output.slice(0, 20000), 'run-' + r.id) : '<p class="space-footnote">Nothing handed over yet.</p>'}
      ${r.sources?.length || r.tools?.length ? `<p class="space-footnote">${r.sources?.length ? 'Brain notes: ' + r.sources.map(esc).join(' · ') : ''}${r.sources?.length && r.tools?.length ? ' — ' : ''}${r.tools?.length ? 'Tools: ' + r.tools.map(esc).join(' · ') : ''}</p>` : ''}${r.error ? `<p class="error">${esc(r.error)}</p>` : ''}</details>` });
  }
  for (const v of job.reviews || []) {
    const checks = [...(v.criteria || []).filter(c => c && typeof c === 'object').map(c => ({ ...c, label: criteriaText[Number(String(c.id || '').replace('criterion-', '')) - 1] || c.id })), ...(v.checks || [])];
    story.push({ at: v.at, cls: `review ${v.approved ? 'pass' : 'fail'}`, who: `${name(v.agent)} · review`, kind: v.approved ? 'approved' : 'changes needed', html: `${v.summary ? `<p>${esc(v.summary)}</p>` : ''}${checks.length ? `<div class="space-review-checks">${checks.map(c => `<div class="space-review-check ${c.passed ? 'passed' : 'failed'}"><span aria-label="${c.passed ? 'Passed' : 'Failed'}">${c.passed ? '✓' : '×'}</span><div><b>${esc(c.label)}</b><p>${esc(c.evidence)}</p></div></div>`).join('')}</div>` : ''}` });
  }
  for (const d of job.decisions || []) story.push({ at: d.at, cls: 'ceo', who: 'You', kind: 'decision', html: `<p>${esc(d.type === 'approve' ? 'Approved' : d.type === 'edit' ? 'Edited and approved' : 'Rejected')} ${esc(d.action === 'complete_task' ? 'closing the task' : d.action)}${d.message ? `: “${esc(d.message)}”` : ''}</p>` });
  story.sort((a, b) => (a.at || 0) - (b.at || 0));
  const plan = (job.todos || []).length ? `<div class="task-plan"><b>The Program Manager’s plan</b><ul>${job.todos.map(t => `<li class="${esc(t.status)}">${esc(t.content)}</li>`).join('')}</ul></div>` : '';
  const usage = `<p class="space-footnote">${job.calls || 0} model calls · ${(job.tokens || 0).toLocaleString()} tokens${Object.keys(job.tokensByModel || {}).length ? ' (' + Object.entries(job.tokensByModel).map(([m, n]) => `${esc(m)} ${n.toLocaleString()}`).join(', ') + ')' : ''}</p>`;
  return `<div class="task-head"><span class="space-result-state ${status.tone}">${esc(status.label)}</span><span class="task-meta">${esc(meta)}</span></div>
    ${job.progressLine && !['done', 'cancelled'].includes(job.state) ? `<p class="task-progress">${esc(job.progressLine)}</p>` : ''}
    ${['blocked', 'escalated'].includes(job.state) && job.error ? `<aside class="space-task-blocker"><b>${job.state === 'escalated' ? 'What the team needs from you' : 'What stopped the work'}</b><p>${esc(job.error)}</p></aside>` : ''}
    ${actions ? `<div class="task-actions">${actions}</div>` : ''}
    <section class="task-result" aria-label="Result">${result()}</section>
    ${(job.sources || []).length ? `<div class="task-sources"><b>Brain notes the team used:</b> ${job.sources.map(p => `<button type="button" data-note="${esc(p)}">${esc(p)}</button>`).join('')}</div>` : ''}
    <details class="task-story" data-detail-key="story" ${job.state === 'done' ? '' : 'open'}><summary>How it was done <small>${story.length} steps</small></summary>${plan}
      <details data-detail-key="brief" class="space-task-brief"><summary>Your original brief</summary>${prose(job.text, 'brief')}</details>
      <ol class="task-story-list">${story.map(item => `<li class="story-item ${item.cls}"><time>${esc(when(item.at))}</time><div><span class="who">${esc(item.who)}</span>${item.kind ? `<span class="kind">${esc(item.kind)}</span>` : ''}<div class="what">${item.html}</div></div></li>`).join('')}</ol>${usage}</details>`;
}
