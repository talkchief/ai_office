import MarkdownIt from 'markdown-it';
import { fileIcon } from './fileicon.js';

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
// A path in a result is a link. A Brain note (/knowledge/…) opens in the Brain and has a download beside it; a workspace file
// (/work/…) downloads from the task the result belongs to. A folder name may hold a space ("Agents Office").
const PATH_RE = /\/(knowledge|work)\/(?:[^\s()\]"'`,;<>]|\s(?=[^\s\/()\]"'`,;<>]+\/))+/g;
let currentEnv = {};
// A line break is the one piece of HTML a team writes on purpose, usually inside a table cell where markdown has no way to
// say it. It is put back after escaping; nothing else is.
const BREAK = /&lt;br\s*\/?\s*&gt;/gi;
export function linkPaths(text, env = currentEnv) {
  return escapeHTML(text).replace(BREAK, '<br>').replace(PATH_RE, found => {
    const shown = found.replace(/[.:]+$/, ''), tail = found.slice(shown.length);
    if (shown.startsWith('/knowledge/')) { const id = shown.slice('/knowledge/'.length), enc = encodeURIComponent(id); return `<a class="space-ref" href="/api/knowledge/file?id=${enc}" data-ref-note="${id}" title="Open this note in the Brain">${shown}</a><a class="space-ref-dl" href="/api/knowledge/file?id=${enc}" download title="Download this note">↓</a>${tail}`; }
    if (!env?.taskId) return found;
    const rel = shown.slice('/work/'.length);
    return `<a class="space-ref" href="/api/tasks/${encodeURIComponent(env.taskId)}/file?path=${encodeURIComponent(rel)}" download title="Download this file from the task">${shown}</a>${tail}`;
  });
}
md.renderer.rules.text = (tokens, index, options, env) => linkPaths(tokens[index].content, env);
md.renderer.rules.code_inline = (tokens, index, options, env) => `<code>${linkPaths(tokens[index].content, env)}</code>`;
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

export function renderDocument(value, prefix = 'output', env = currentEnv) {
  const tokens = md.parse(String(value || ''), {}), sections = [];
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '');
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'heading_open') continue;
    const id = `${safePrefix}-section-${sections.length + 1}`;
    tokens[i].attrSet('id', id);
    const title = md.renderer.renderInlineAsText(tokens[i + 1]?.children || [], md.options, {});
    sections.push({ id, title, level: Number(tokens[i].tag.slice(1)) });
  }
  return { html: md.renderer.render(tokens, md.options, env || {}), sections };
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

// The task view: the decision first, then the tabs (result, conversation, how it was done, review, artifacts). One status vocabulary, no model details in sight;
// the run's numbers live under a closed fold in Review.
const initials = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const short = date => date ? new Date(date).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const mark = (kind, label) => `<span class="mg-st mg-st-${kind}"><i></i>${esc(label)}</span>`;
const stateMark = job => job.state === 'done' ? mark('ok', 'Approved') : job.state === 'blocked' ? mark('fail', 'Failed · needs you') : job.state === 'waiting' ? mark('warn', 'Waits for you') : job.state === 'saving' ? mark('busy', 'Saving') : job.state === 'cancelled' ? mark('off', 'Cancelled') : job.state === 'backlog' ? mark('off', 'Saved idea') : job.state === 'queued' ? mark('off', 'Queued') : mark('busy', labels[job.state] || job.state);
// What a blocker means, in a sentence a person can act on. The provider's own words stay under a fold.
export function explainError(error) {
  const e = String(error || '');
  if (!e) return 'The task stopped without a reason being recorded.';
  if (/thought_signature/i.test(e)) return 'The model provider refused a tool call: this Gemini model needs thought signatures on function calls, which the office did not send. Retrying usually works; if it repeats, give this person another model under Models & keys.';
  if (/401|403|invalid[ _-]?(api[ _-]?)?key|unauthori[sz]ed|authentication/i.test(e)) return 'The model provider rejected the key. Replace it under Models & keys, then retry.';
  if (/429|rate[ -]?limit|quota|too many requests/i.test(e)) return 'The model provider is rate-limiting the office. Wait a minute and retry, or move this role to another model.';
  if (/\b5\d\d\b|overloaded|timed? ?out|ECONN|fetch failed|socket|network/i.test(e)) return 'The model provider stopped answering. It was retried twice already; retry once more, or move this role to another model under Models & keys.';
  if (/\b400\b|INVALID_ARGUMENT|bad request/i.test(e)) return 'The model provider refused the call as malformed. Retrying usually works; if it repeats, give this person another model under Models & keys.';
  if (/no progress|without progress/i.test(e)) return 'The run made no progress for the office’s limit and was stopped. Retry, or narrow the brief.';
  return e.slice(0, 400);
}

// A file the office can draw: a PDF, an image, a page, plain text, a table. A deck or a spreadsheet is only worth saving.
const SHOWS = /\.(pdf|png|jpe?g|gif|svg|webp|html?|md|markdown|txt|log|csv|tsv|json)$/i;
export function renderTaskWorkspace(job, tab, actions = '') {
  currentEnv = { taskId: job.id };
  const name = id => job.agents.find(a => a.id === id)?.name || id || 'Unassigned';
  const status = resultState(job);
  const total = job.subtasks.length, submitted = job.subtasks.filter(s => s.state === 'done').length;
  const last = job.reviews?.[job.reviews.length - 1];
  const criteriaLabels = [...(job.team.criteria || []), ...(job.team.guardrails || [])];
  const checksOf = r => r ? [...(r.criteria || []).filter(c => c && typeof c === 'object').map((c, i) => ({ ...c, label: criteriaLabels[Number(String(c.id || '').replace('criterion-', '')) - 1] || (c.evidence ? String(c.evidence).split(/(?<=[.!?])s/)[0].slice(0, 90) : 'Check ' + (i + 1)) })), ...(r.checks || [])] : [];
  const checks = checksOf(last), passed = checks.filter(c => c.passed).length;
  const started = job.createdAt ? new Date(job.createdAt) : null, ended = job.doneAt || job.review?.at ? new Date(job.doneAt || job.review.at) : null;
  const dur = started && ended ? Math.max(1, Math.round((ended - started) / 60000)) + ' min' : '';
  const lead = name(job.team.lead);

  /* ---- the head: who, the state, the title, the facts that are not about the model ---- */
  const head = `<div class="tv-head"><div class="tv-top"><span class="mg-eyebrow">Task · ${esc(job.team.name)} · ${esc(lead)}</span>${stateMark(job)}${job.lane === 'quick' ? '<span class="tv-chip" title="Quick work: the lead delivered and reviewed it alone">Quick lane</span>' : ''}${job.projectName ? `<span class="tv-chip">${esc(job.projectName)}</span>` : ''}</div><h1 class="tv-title">${esc(job.title)}</h1>
    <div class="tv-facts">${job.createdAt ? `<span>created <b>${esc(short(job.createdAt))}</b></span>` : ''}${dur ? `<span>took <b>${esc(dur)}</b></span>` : ''}${job.dueAt ? `<span>due <b>${esc(short(job.dueAt))}</b></span>` : ''}${job.state === 'done' && (job.doneAt || job.review?.at) ? `<span>approved <b>${esc(short(job.doneAt || job.review.at))}</b> · filed in the Brain</span>` : ''}${total ? `<span><b>${submitted}</b> of <b>${total}</b> assignments submitted</span>` : ''}</div></div>`;

  /* ---- the decision: what this task needs from you, with the controls inside it ---- */
  const decision = () => {
    let kind = 'off', glyph = '·', title = '', text = '', raw = '';
    if (job.state === 'blocked') { kind = 'fail'; glyph = '✕'; title = 'The task stopped and needs you.'; text = explainError(job.error); raw = job.error ? `<details class="tv-raw" data-detail-key="raw-error"><summary>What went wrong, verbatim</summary><pre>${esc(String(job.error).slice(0, 4000))}</pre></details>` : ''; }
    else if (job.realState === 'awaiting_ceo' && (job.pendingActions || []).some(a => a.name !== 'complete_task')) { kind = 'warn'; glyph = '!'; title = 'The team wants to act outside the office.'; text = 'Approve to let it run once, or reject with a note. Nothing runs until you decide.'; }
    else if (job.realState === 'escalated') { kind = 'warn'; glyph = '?'; title = 'The team needs your direction.'; text = job.error ? String(job.error).slice(0, 600) : 'Answer below and the team carries on.'; }
    else if (job.state === 'waiting') { kind = 'warn'; glyph = '!'; title = job.review?.approved ? 'The lead verified this result. Your approval files it in the Brain.' : 'This task waits for you.'; text = checks.length ? `${passed} of ${checks.length} checks passed.` : ''; }
    else if (job.state === 'done') { kind = 'ok'; glyph = '✓'; title = `Approved and filed in the Brain${job.doneAt || job.review?.at ? ' on ' + short(job.doneAt || job.review.at) : ''}.`; text = checks.length ? `The lead verified the deliverable against ${passed} of ${checks.length} checks. Every team can read it now.` : 'Every team can read it now.'; }
    else if (job.state === 'saving') { kind = 'busy'; glyph = '…'; title = 'Verified. Saving the result to the Brain.'; }
    else if (job.state === 'cancelled') { kind = 'off'; glyph = '–'; title = 'Cancelled.'; text = 'This task is closed. Nothing was filed.'; }
    else if (job.state === 'backlog') { kind = 'off'; glyph = '○'; title = 'A saved idea. Nobody has started it.'; text = 'Refine the brief below and start it when you are ready.'; }
    else if (job.state === 'queued') { kind = 'off'; glyph = '○'; title = 'Queued. The lead picks it up next.'; text = 'You can still change the brief or the priority.'; }
    else if (job.state === 'planning') { kind = 'busy'; glyph = '…'; title = `${lead} is planning the work.`; text = 'Assignments and acceptance criteria come first; the team starts once they are set.'; }
    else if (job.state === 'reviewing') { kind = 'busy'; glyph = '…'; title = `${lead} is verifying the deliverable.`; text = 'The assembled result is being checked against the team’s criteria.'; }
    else { kind = 'busy'; glyph = '…'; title = total ? `${submitted} of ${total} assignments submitted.` : 'The team is working.'; text = job.progressLine || ''; }
    return `<section class="tv-decision tv-${kind}"><span class="tv-glyph">${glyph}</span><div class="tv-dtext"><b>${esc(title)}</b>${text ? `<p>${esc(text)}</p>` : ''}${raw}</div>${actions ? `<div class="tv-dact">${actions}</div>` : ''}</section>`;
  };

  /* ---- the four tabs ---- */
  const result = () => {
    if (!job.result) return `<div class="tv-stop"><b>${job.state === 'cancelled' ? 'No result was produced.' : 'No result yet.'}</b>${esc(job.state === 'backlog' ? 'Refine the brief under How it was done, then start the task.' : job.state === 'blocked' ? 'The task stopped before a deliverable was assembled. Retry above, or read How it was done to see where it stopped.' : job.state === 'cancelled' ? 'The task was cancelled before a deliverable was assembled.' : 'Follow the drafts under How it was done. The lead assembles and verifies the final deliverable.')}</div>`;
    const document = renderDocument(job.result, 'result');
    const topLevel = Math.min(...document.sections.map(s => s.level));
    const contents = document.sections.filter(s => s.level <= Math.max(2, topLevel) && !(s.level === 1 && document.sections.some(other => other.level === 2))).slice(0, 12);
    const workers = job.subtasks.filter(s => s.agent).map(s => `<div class="tv-row"><span class="tv-avatar">${esc(initials(name(s.agent)))}</span><div>${esc(name(s.agent))}<small>${s.state === 'done' ? 'did' : 'is on'} ${esc(String(s.title).toLowerCase().slice(0, 60))}</small></div></div>`).join('');
    const rail = `<aside class="tv-rail"><div><div class="tv-lab">Who</div><div class="tv-row"><span class="tv-avatar lead">★</span><div>${esc(lead)}<small>planned${job.review ? ' · reviewed' : ''}</small></div></div>${workers}</div>
      ${checks.length ? `<div><div class="tv-lab">Checks · ${passed} of ${checks.length}</div>${checks.map(c => `<div class="tv-row"><span class="tv-tick ${c.passed ? 'pass' : 'fail'}">${c.passed ? '✓' : '✕'}</span><div>${esc(c.label)}</div></div>`).join('')}</div>` : ''}
      ${last?.summary ? `<div><div class="tv-lab">Lead’s note</div><div class="tv-note">${esc(last.summary)}</div></div>` : ''}
      <div class="tv-stats">${dur ? 'took ' + esc(dur) : ''}${job.state === 'waiting' ? '<br>Approving files this in the Brain as a note the whole office can read.' : job.state === 'done' ? '<br>Filed in the Brain as a note the whole office can read.' : ''}</div></aside>`;
    return `<div class="tv-two"><div><div class="tv-toolbar"><span class="mg-eyebrow">${job.state === 'done' ? 'Final deliverable' : 'Draft deliverable · not approved'}</span><span class="tv-sp"></span><button class="tv-btn tv-btn-sm" id="spaceCopyResult" type="button">Copy</button><button class="tv-btn tv-btn-sm" id="spaceDownloadResult" type="button">Download .md</button></div>
      ${contents.length >= 3 ? `<nav class="tv-outline" aria-label="In this result">${contents.map(s => `<a href="#${s.id}" data-output-anchor="${s.id}">${esc(s.title)}</a>`).join('')}</nav>` : ''}
      <article class="space-document space-deliverable tv-doc" aria-label="${job.state === 'done' ? 'Approved' : 'Draft'} deliverable">${document.html}</article>
      <footer class="tv-prov"><span>${esc(status.note)}</span><span>${esc(lead)}${job.review?.at ? ' · ' + esc(short(job.review.at)) : ''}</span></footer></div>${rail}</div>`;
  };
  const work = () => `<details class="tv-fold" data-detail-key="brief"><summary>Original brief<span class="tv-sp"></span><small>as you wrote it</small></summary><div class="tv-in">${prose(job.text, 'brief')}</div></details>
    <div class="tv-card"><h3>${total ? 'The team’s plan' : job.state === 'backlog' ? 'Shape the brief' : 'Planning'}</h3><p class="tv-plan-text">${esc(job.plan || (job.state === 'backlog' ? 'This idea is saved. Edit the brief above and start it when you are ready.' : job.state === 'cancelled' ? 'No plan was completed.' : job.state === 'blocked' && !total ? 'No plan was made. The task stopped on its first call.' : total ? `${total} assignment${total === 1 ? '' : 's'}, planned by ${lead}.` : 'The lead will define the assignments and acceptance criteria.'))}</p>
    ${total ? `<div class="tv-plan"><span>${submitted} of ${total} assignments submitted</span><span class="tv-bar"><i style="width:${Math.round(100 * submitted / total)}%"></i></span>${job.review?.approved ? mark('ok', 'Lead review passed') : mark('off', 'Lead verification required')}</div>` : ''}
    ${(job.todos || []).length ? `<div class="tv-todos"><div class="tv-lab">The Program Manager’s plan</div><ul>${job.todos.map(t => `<li class="${esc(t.status)}">${esc(t.content)}</li>`).join('')}</ul></div>` : ''}
    ${total ? `<div class="tv-steps">${job.subtasks.map((step, i) => {
      const live = step.state === 'working' ? job.liveCalls?.[step.agent] : null, preview = live?.preview, who = name(step.agent || step.eligible?.[0]);
      const k = step.state === 'done' ? 'ok' : ['failed', 'interrupted'].includes(step.state) ? 'fail' : step.state === 'working' ? 'busy' : 'off';
      return `<details class="tv-step" data-step-id="${step.id}" data-detail-key="step-${step.id}" ${step.state === 'working' ? 'open' : ''}><summary><span class="tv-n">${String(i + 1).padStart(2, '0')}</span><span class="tv-avatar">${esc(initials(who))}</span><span class="tv-t">${esc(step.title)}<small>${esc(who)}</small></span>${mark(k, labels[step.state] || step.state)}</summary><div class="tv-in">
        ${step.instructions && step.instructions !== step.title ? `<p class="tv-instr">${esc(step.instructions)}</p>` : ''}${(step.requiredTools || []).length ? `<div class="tv-meta">tools: ${step.requiredTools.map(esc).join(', ')}</div>` : ''}
        ${(step.acceptance || []).length ? `<div class="tv-lab">Acceptance</div><ul class="tv-accept">${step.acceptance.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
        ${step.dependencies?.length ? `<div class="tv-meta">depends on: ${step.dependencies.map(id => esc(job.subtasks.find(s => s.id === id)?.title || id)).join(' · ')}</div>` : ''}
        ${step.feedback ? `<div class="tv-lab">Requested changes</div><div class="tv-note">${esc(step.feedback)}</div>` : ''}
        ${step.error && ['failed', 'interrupted'].includes(step.state) ? `<p class="tv-err">${esc(step.error)}</p>` : ''}
        ${preview ? `<div class="tv-lab">Live draft · not yet reviewed</div><div class="tv-excerpt">${prose(preview, 'draft-' + i)}</div>` : step.output ? `<div class="tv-lab">${step.state === 'done' ? 'Submission' : 'Previous submission'}</div><div class="tv-excerpt">${prose(step.output, 'submission-' + i)}</div>` : '<p class="tv-meta">No submission yet.</p>'}
        ${live?.state === 'running' ? `<p class="tv-meta">${live.tool ? esc(live.tool) + ' · ' : ''}last update ${esc(short(live.lastEventAt))}</p>` : ''}
        ${step.notes?.length || step.tools?.length ? `<details class="tv-sub" data-detail-key="sources-${step.id}"><summary>Sources and tools</summary>${step.notes?.length ? `<p>Brain: ${step.notes.map(esc).join(' · ')}</p>` : ''}${step.tools?.length ? `<p>Tools used: ${step.tools.map(esc).join(' · ')}</p>` : ''}</details>` : ''}</div></details>`;
    }).join('')}</div>` : ''}</div>
    <details class="tv-fold" data-detail-key="timeline"><summary>Activity timeline<span class="tv-sp"></span><small>${job.events.length} event${job.events.length === 1 ? '' : 's'}</small></summary><div class="tv-in"><ol class="tv-timeline">${job.events.map(e => `<li><time>${esc(short(e.at))}</time><div><b>${esc(e.agent ? name(e.agent) : 'Office')}</b>${esc(e.message)}</div></li>`).join('')}</ol></div></details>`;
  const review = () => {
    const reviews = job.reviews || [];
    return `${reviews.length ? reviews.map((r, i) => { const rc = checksOf(r), rp = rc.filter(c => c.passed).length; return `<details class="tv-fold tv-review" data-review-id="review-${i}" data-detail-key="review-${i}" ${i === reviews.length - 1 ? 'open' : ''}><summary>Review ${i + 1}${mark(r.approved ? 'ok' : 'warn', r.approved ? 'Passed' : 'Changes required')}<span class="tv-sp"></span><small>${esc(name(r.agent))}${r.at ? ' · ' + esc(short(r.at)) : ''}${rc.length ? ` · ${rp} of ${rc.length}` : ''}</small></summary><div class="tv-in">${r.summary ? `<div class="tv-note">${esc(r.summary)}</div>` : ''}<div class="tv-checks">${rc.map(c => `<div class="tv-check ${c.passed ? 'pass' : 'fail'}"><span class="tv-tick ${c.passed ? 'pass' : 'fail'}" aria-label="${c.passed ? 'Passed' : 'Failed'}">${c.passed ? '✓' : '✕'}</span><b>${esc(c.label)}</b><p>${esc(c.evidence || '')}</p></div>`).join('')}</div></div></details>`; }).join('')
      : `<div class="tv-stop"><b>Review has not started.</b>The lead reviews the actual submissions once the team has finished its work.</div>`}
      ${job.requireHumanApproval ? `<p class="tv-meta">${job.humanApproved ? '✓ Owner approval recorded.' : 'Owner approval is required before completion.'}</p>` : ''}
      <details class="tv-fold" data-detail-key="run-details"><summary>Run details<span class="tv-sp"></span><small>model, calls, tokens</small></summary><div class="tv-in"><table class="tv-ledger"><tbody>${job.model ? `<tr><td>Model</td><td class="k">${esc(job.model)}${job.effort ? ' · ' + esc(job.effort) : ''}</td></tr>` : ''}<tr><td>Model calls</td><td class="k">${job.calls}/${job.team.maxCalls} model calls</td></tr><tr><td>Reported tokens</td><td class="k">${Number(job.tokens || 0).toLocaleString()}/${Number(job.team.maxTokens || 0).toLocaleString()}</td></tr><tr><td>Team configuration</td><td class="k">v${job.officeRevision}</td></tr>${job.skills?.length ? `<tr><td>Skills</td><td class="k">${job.skills.map(s => esc(s.name) + ' v' + s.revision).join(' · ')}</td></tr>` : ''}</tbody></table></div></details>`;
  };
  const artifacts = () => {
    const exported = n => /\.(pdf|pptx|docx|xlsx)$/i.test(n);
    const files = [...(job.files || [])].sort((a, b) => (exported(b.name) - exported(a.name)) || b.modifiedAt - a.modifiedAt);
    if (!files.length) return `<div class="tv-stop"><b>No files.</b>${esc(job.state === 'done' ? 'This task delivered its result as text. Ask for a PDF and the team exports one here.' : 'Files the team writes while working appear here: drafts, exports, data.')}</div>`;
    const size = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
    return `<table class="tv-ledger"><thead><tr><th>File</th><th>Size</th><th>When</th><th></th></tr></thead><tbody>${files.map(f => `<tr><td>${fileIcon(f.name)} <b>${esc(f.name)}</b>${exported(f.name) ? '<small class="tv-sub2">exported document</small>' : ''}</td><td class="k">${size(f.bytes)}</td><td class="k">${esc(short(f.modifiedAt))}</td><td class="r">${SHOWS.test(f.name) ? `<button type="button" class="tv-btn tv-btn-sm" data-preview-url="/api/tasks/${job.id}/file?path=${encodeURIComponent(f.name)}" data-preview-name="${esc(f.name)}" data-preview-bytes="${f.bytes || 0}" title="Read it here">Preview</button>` : ''}<a class="tv-btn tv-btn-sm" href="/api/tasks/${job.id}/file?path=${encodeURIComponent(f.name)}" download>Download</a></td></tr>`).join('')}</tbody></table>`;
  };
  /* ---- the conversation: what you wrote, what the team asked and answered, and each version it delivered, in time order ---- */
  const team = job.autoRoute ? 'Program Manager' : lead;
  const ATTACHED = /^Read the attached files under \/work\/inbox\/ before planning: /;
  const conversationItems = () => {
    const messages = (job.messages || []).length ? job.messages : job.text ? [{ seq: 0, at: job.createdAt, role: 'ceo', kind: 'message', text: job.text, deliveredAt: job.createdAt }] : [];
    const items = messages.map((m, i) => ({ at: m.at, order: 0, m, brief: i === 0 && m.role === 'ceo' }));
    for (const v of job.resultVersions || []) items.push({ at: v.at, order: 1, v });
    return items.sort((a, b) => (a.at || 0) - (b.at || 0) || a.order - b.order);
  };
  const conversation = () => {
    const items = conversationItems(), latest = (job.resultVersions || []).length;
    const YOURS = { message: 'Message', correction: 'Correction', note: 'Note for the team', answer: 'Your answer', question: 'Question' };
    const row = item => {
      if (item.v) {
        // What the team sent back is a reply in the conversation: a short answer in full, a long deliverable as its summary with a way to it.
        const v = item.v, current = v.n === latest, result = String(v.result || ''), long = result.length > 2600;
        const status = current ? (job.state === 'done' ? 'approved' : job.state === 'waiting' ? 'waits for your approval' : '') : 'replaced by a later version';
        const body = long ? `${v.summary ? `<p class="tv-msg-summary">${esc(v.summary)}</p>` : ''}${current ? `<button type="button" class="tv-btn tv-btn-sm" data-open-result>Read the result</button>` : ''}`
          : result.length > 900 ? `<details class="tv-msg-fold" data-detail-key="convo-v${v.n}"${current ? ' open' : ''}><summary>${esc(outputExcerpt(result, 220))}<span>Show the whole answer</span></summary>${prose(result, 'convo-v' + v.n)}</details>`
          : prose(result || v.summary || 'Delivered.', 'convo-v' + v.n);
        return `<li class="tv-msg team tv-reply${current ? '' : ' tv-replaced'}" data-version="${v.n}"><div class="tv-msg-who"><b>${esc(team)}</b><span class="tv-msg-tag">${esc(v.n > 1 ? `Version ${v.n}` : 'Result')}</span>${status ? `<span class="tv-msg-status">${esc(status)}</span>` : ''}<time>${esc(short(v.at))}</time></div><div class="tv-bubble">${body}</div></li>`;
      }
      const m = item.m;
      if (m.role === 'system') return `<li class="tv-event">${esc(m.text)}<time>${esc(short(m.at))}</time></li>`;
      if (m.role === 'ceo' && ATTACHED.test(m.text)) return `<li class="tv-event">You attached <b>${esc(m.text.replace(ATTACHED, '').replace(/\.$/, ''))}</b><time>${esc(short(m.at))}</time></li>`;
      const you = m.role === 'ceo';
      const who = you ? 'You' : m.agent === 'pm' ? 'Program Manager' : m.agent ? name(m.agent) : team;
      const tag = you ? (item.brief ? 'Brief' : YOURS[m.kind] || 'Message') : m.kind === 'question' ? 'asks' : m.kind === 'answer' ? 'answers' : '';
      const text = String(m.text || ''), long = item.brief && text.length > 480;
      const body = long ? `<details class="tv-msg-fold" data-detail-key="convo-brief"><summary>${esc(outputExcerpt(text, 220))}<span>Show the whole brief</span></summary>${prose(text, 'convo-' + m.seq)}</details>` : prose(text, 'convo-' + m.seq);
      const state = you && !item.brief && !m.deliveredAt && ['queued', 'planning', 'working', 'reviewing'].includes(job.state) ? 'waits for the team’s next step' : '';
      return `<li class="tv-msg ${you ? 'you' : 'team'}" data-seq="${esc(m.seq)}"><div class="tv-msg-who"><b>${esc(who)}</b>${tag ? `<span class="tv-msg-tag">${esc(tag)}</span>` : ''}<time>${esc(short(m.at))}</time></div><div class="tv-bubble">${body}</div>${state ? `<div class="tv-msg-state">${esc(state)}</div>` : ''}</li>`;
    };
    const lastItem = items[items.length - 1];
    const tail = lastItem?.m?.role === 'ceo' && ['queued', 'planning', 'working', 'reviewing', 'saving'].includes(job.state) ? `<li class="tv-event tv-typing"><i></i><i></i><i></i> ${esc(team)} is on it</li>`
      : job.state === 'waiting' ? `<li class="tv-event">Waits for your approval</li>` : job.state === 'blocked' ? `<li class="tv-event tv-stopped">The task stopped · retry it above</li>` : '';
    return `<ol class="tv-convo" aria-label="The conversation on this task">${items.map(row).join('')}${tail}</ol>`;
  };
  const talk = conversationItems().filter(item => !item.brief).length;
  const tabs = [['result', 'Result', ''], ['conversation', 'Conversation', talk ? `<span class="tv-c">${talk}</span>` : ''], ['work', 'How it was done', total ? `<span class="tv-c">${total} step${total === 1 ? '' : 's'}</span>` : ''], ['review', 'Review', last ? mark(last.approved ? 'ok' : 'warn', last.approved ? 'passed' : 'changes') : ''], ['artifacts', 'Artifacts', (job.files || []).length ? `<span class="tv-c">${job.files.length}</span>` : '']];
  return `${head}${decision()}
    <nav class="tv-tabs" role="tablist" aria-label="Task views">${tabs.map(([id, label, extra]) => `<button type="button" role="tab" id="spaceTaskTab-${id}" data-task-tab="${id}" aria-selected="${tab === id}" aria-controls="spaceTaskPanel-${id}" tabindex="${tab === id ? '0' : '-1'}">${label}${extra}</button>`).join('')}</nav>
    ${['result', 'conversation', 'work', 'review', 'artifacts'].map(id => `<section class="tv-pane" role="tabpanel" id="spaceTaskPanel-${id}" aria-labelledby="spaceTaskTab-${id}" tabindex="0" ${tab !== id ? 'hidden' : ''}>${tab !== id ? '' : id === 'result' ? result() : id === 'conversation' ? conversation() : id === 'work' ? work() : id === 'artifacts' ? artifacts() : review()}</section>`).join('')}`;
}
