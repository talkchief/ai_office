// The Program Manager's closing summary for a project: what the CEO asked for, what exists now, where to open it, what is open
// and what is next. One model call at the end of a project, written with the office's executive-summary method, stored on the
// project and shown on its Results tab so the CEO never has to read the tasks to find out what they got.
import { loadPlanningSkills } from './project-planner.mjs';
import { usageOfMessage } from './engine/stream.mjs';

export const SUMMARY_LIMITS = { taskChars: 3500, tasksChars: 45000, artifacts: 80, links: 24, headline: 160, summaryChars: 8000, items: 12 };
// The Program Manager's methods for closing a project, built in, read on every summary.
export const SUMMARY_SKILLS = ['writing-an-executive-summary', 'senior-project-manager'];
export const SUMMARY_WORDS = /summary|summaries|executive|closing|hand-?over|wrap|report/i;

const text = (value, max = 4000) => String(value ?? '').replace(/\s+$/g, '').trim().slice(0, max);
const oneLine = (value, max = 200) => text(value, max).replace(/\s+/g, ' ');
const day = ms => ms ? new Date(ms).toISOString().slice(0, 10) : '';
const size = bytes => bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes > 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes || 0} B`;
const URL_RE = /https?:\/\/[^\s<>"')\]}]+/g;
const TRAILING = /[.,;:!?)\]}'"`*_>]+$/;
// An address with a template placeholder in it is a pattern, not a page.
const PLACEHOLDER = /[{}<>]|%7B|\.\.\./;

// The skills the summary is written with: the shipped methods, plus any closing method the CEO put in the Brain's pm-skills.
export const loadSummarySkills = ({ dirs = [], names = SUMMARY_SKILLS } = {}) => loadPlanningSkills({ dirs, names, words: SUMMARY_WORDS });

// The addresses the work produced: every URL in a finished task's result, in order, deduplicated, the office's own pages left out.
export function collectLinks(tasks = [], { max = SUMMARY_LIMITS.links, skip = /^https?:\/\/(localhost|127\.0\.0\.1)/i } = {}) {
  const seen = new Map();
  for (const task of tasks) {
    if (task.state !== 'done') continue;
    for (const raw of `${task.result || ''}\n${task.resultSummary || ''}`.match(URL_RE) || []) {
      const url = raw.replace(TRAILING, '');
      if (url.length > 400 || skip.test(url) || PLACEHOLDER.test(url) || seen.has(url)) continue;
      seen.set(url, { url, taskId: task.id, taskTitle: oneLine(task.title, 120) });
      if (seen.size >= max) return [...seen.values()];
    }
  }
  return [...seen.values()];
}

export const SUMMARY_PROMPT = `You are the Program Manager of a company office, closing a project for the CEO. You wrote none of the work yourself; you read what the teams delivered and tell the CEO what they now have. Follow your executive-summary method. Answer with one JSON object and nothing else:
{"headline":"<one line, under 120 characters: what the CEO now has>","summary":"<markdown, 300-500 words, the body of the summary>","delivered":[{"what":"<the thing, by name>","where":"<the file name, the URL, or the Brain note where it lives>","note":"<one line: what it is for>"}],"links":[{"label":"<what it opens>","url":"<address>"}],"open":["<anything asked for that is not there, or that needs the CEO>"],"next":["<a real next step: the action, who would own it, by when>"]}
Rules: every word comes from the finished tasks and the files listed; never describe plans, intentions or work in progress. If the project produced an address the CEO uses (a published page, a document, a dashboard), it MUST appear in "links" and be named in the summary. Name files exactly as they are listed. Numbers come from the work; invent none. No task ids, no team process, no praise. "open" and "next" are empty arrays when there is genuinely nothing; never invent either. The summary is markdown prose with short headings, decisive and factual, under 500 words.`;

// The ask: the CEO's brief, the milestones, what each finished task delivered, the files, the addresses found, the methods.
export function summaryAsk({ project, tasks = [], artifacts = [], links = [], skills = [], today = Date.now() }) {
  const done = tasks.filter(t => t.state === 'done'), unfinished = tasks.filter(t => !['done', 'cancelled'].includes(t.state));
  const filesFor = id => artifacts.filter(a => a.taskId === id);
  let budget = SUMMARY_LIMITS.tasksChars;
  const work = done.map(t => {
    const body = text(t.result || t.resultSummary || '', Math.max(0, Math.min(SUMMARY_LIMITS.taskChars, budget)));
    budget -= body.length;
    const files = filesFor(t.id).map(f => `${f.name} (${size(f.bytes)})`).join(', ');
    return [`### ${oneLine(t.title, 160)}`, t.teamName ? `Team: ${t.teamName}. Finished ${day(t.doneAt) || 'recently'}.` : '', files ? `Files: ${files}` : 'Files: none', body || '(no written result)'].filter(Boolean).join('\n');
  }).join('\n\n');
  const milestones = (project.milestones || []).map(m => `- [${m.done ? 'x' : ' '}] ${m.title}${m.dueAt ? ` (due ${day(m.dueAt)})` : ''}`).join('\n');
  const files = artifacts.slice(0, SUMMARY_LIMITS.artifacts).map(a => `- ${a.name} — ${size(a.bytes)}, from “${oneLine(a.taskTitle, 90)}”`).join('\n');
  const found = links.map(l => `- ${l.url} (in “${oneLine(l.taskTitle, 90)}”)`).join('\n');
  const methods = skills.length ? `Your methods, built in (follow them):\n\n${skills.map(s => `### ${s.name}${s.description ? ' — ' + s.description : ''}\n${s.text}`).join('\n\n')}` : '';
  return [`Today: ${day(today)}.`,
    `Project: ${project.name} (${project.status}${project.dueAt ? `, target ${day(project.dueAt)}` : ''}).`,
    `What the CEO asked for:\n${text(project.description, 2000)}${project.charter ? `\n\nCharter:\n${text(project.charter, 6000)}` : ''}`,
    milestones ? `Milestones:\n${milestones}` : '',
    unfinished.length ? `Still open: ${unfinished.map(t => `${oneLine(t.title, 90)} (${t.state})`).join('; ')}.` : 'Every task of this project is finished.',
    work ? `What the teams delivered:\n\n${work}` : 'No task of this project delivered anything.',
    files ? `Files produced (download names):\n${files}` : 'No files were produced.',
    found ? `Addresses found in the results (use the ones that are the CEO's to open):\n${found}` : '',
    methods].filter(Boolean).join('\n\n');
}

// The reply becomes the stored summary. Forgiving about fences and missing optional fields; a summary without prose is refused.
export function parseSummary(raw, { links = [] } = {}) {
  const body = String(raw ?? '').trim(), fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(body);
  const source = fenced ? fenced[1] : body;
  const start = source.indexOf('{'), end = source.lastIndexOf('}');
  if (start < 0 || end <= start) return { summary: null, problems: ['the reply was not JSON'] };
  let v; try { v = JSON.parse(source.slice(start, end + 1)); } catch (error) { return { summary: null, problems: [`the JSON could not be read (${error.message.slice(0, 80)})`] }; }
  const prose = text(v?.summary, SUMMARY_LIMITS.summaryChars);
  if (prose.length < 40) return { summary: null, problems: ['no summary text'] };
  const list = (value, map) => (Array.isArray(value) ? value : []).map(map).filter(Boolean).slice(0, SUMMARY_LIMITS.items);
  const url = value => { const u = oneLine(value, 400); return /^https?:\/\//i.test(u) ? u.replace(TRAILING, '') : ''; };
  const delivered = list(v?.delivered, d => { const what = oneLine(d?.what, 200); return what ? { what, where: oneLine(d?.where, 300), note: oneLine(d?.note, 240) } : null; });
  const named = list(v?.links, l => { const href = url(l?.url); return href ? { label: oneLine(l?.label, 120) || href, url: href } : null; });
  // The Program Manager chooses which addresses matter. Only when it named none does the office fall back to what the work
  // produced, and then to the first few: a summary listing every script, font and analytics host helps nobody.
  const extra = named.length ? [] : links.slice(0, 3).map(l => ({ label: l.url, url: l.url }));
  return { summary: { headline: oneLine(v?.headline, SUMMARY_LIMITS.headline) || 'Project complete', text: prose, delivered, links: [...named, ...extra], open: list(v?.open, o => oneLine(o, 300)), next: list(v?.next, n => oneLine(n, 300)) }, problems: [] };
}

// One call to the Program Manager's model, at high effort, with two attempts.
export async function summariseProject({ project, tasks = [], artifacts = [], skills = [], models, instance = null, today = Date.now(), onUsage = () => {} }) {
  const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
  const spec = models.resolve({ role: 'pm' });
  if (!spec.model) throw Object.assign(new Error('No model is configured for the Program Manager. Choose one in Settings → Models & keys.'), { status: 409 });
  const model = instance || await models.instance({ model: spec.model, effort: 'high', streaming: false, maxTokens: 6000 });
  const links = collectLinks(tasks);
  const ask = summaryAsk({ project, tasks, artifacts, links, skills, today });
  const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => typeof p === 'string' ? p : p?.text || '').join('') : '';
  let last = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const messages = [new SystemMessage(SUMMARY_PROMPT), new HumanMessage(ask)];
    if (last?.problems?.length) messages.push(new HumanMessage(`Office: your summary could not be used (${last.problems.join('; ')}). Send the whole JSON object again, complete.`));
    const reply = await model.invoke(messages);
    try { onUsage({ message: reply, model: spec.model }); } catch {}
    last = parseSummary(textOf(reply?.content), { links });
    if (last.summary) return { ...last.summary, at: Date.now(), by: 'pm', tasks: tasks.filter(t => t.state === 'done').length, artifacts: artifacts.length };
  }
  throw Object.assign(new Error(`The Program Manager could not write the summary (${last.problems.join('; ')}).`), { status: 422 });
}
