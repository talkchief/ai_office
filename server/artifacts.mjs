// Office Artifacts: every file every task produced, in one list the CEO can filter by kind, by date and by words.
const KINDS = [
  ['pdf', /\.pdf$/i, 'PDF'], ['deck', /\.pptx?$/i, 'PowerPoint'], ['doc', /\.docx?$/i, 'Word'], ['data', /\.(xlsx?|csv|tsv)$/i, 'Excel / CSV'], ['json', /\.json$/i, 'JSON'], ['markdown', /\.(md|markdown)$/i, 'Markdown'],
  ['html', /\.html?$/i, 'HTML'], ['image', /\.(png|jpe?g|gif|svg|webp)$/i, 'Image'], ['text', /\.(txt|log)$/i, 'Text'],
];
export const ARTIFACT_KINDS = KINDS.map(([id, , label]) => ({ id, label })).concat([{ id: 'other', label: 'Other' }]);
// The usable documents: what the CEO opens, sends or prints. Drafts (Markdown, HTML, text) are the teams' working files.
export const DOCUMENT_KINDS = ['pdf', 'deck', 'doc', 'data'];
export const kindOf = name => (KINDS.find(([, re]) => re.test(String(name || ''))) || ['other'])[0];

// One row per file: what it is, which task made it, for which teams and project, when, how big, and where to download it.
export function collectArtifacts({ jobs, filesFor, office }) {
  const teamName = id => office?.teams?.find(t => t.id === id)?.name || id;
  const rows = [];
  for (const job of jobs) {
    let files = []; try { files = filesFor(job.id) || []; } catch { continue; }
    // A task the CEO left to the PM (auto) lists the teams that actually worked; an assigned task lists the assigned teams as well.
    const assigned = job.autoRoute ? [] : job.depts?.length ? job.depts : job.dept && job.dept !== 'auto' ? [job.dept] : [];
    const teams = [...new Set([...assigned, ...(job.runs || []).filter(r => r.role === 'lead' && r.dept).map(r => r.dept)])].map(teamName);
    for (const f of files) rows.push({ id: `${job.id}:${f.name}`, taskId: job.id, taskTitle: job.title, taskState: job.state, projectId: job.projectId || null, teams, name: f.name, kind: kindOf(f.name), type: f.type, bytes: f.bytes, modifiedAt: f.modifiedAt, url: `/api/tasks/${job.id}/file?path=${encodeURIComponent(f.name)}` });
  }
  return rows.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

// Filters: kind (one of ARTIFACT_KINDS, or 'documents' for the usable ones, or '' for everything), from/to (dates, inclusive; a date string or a time), words (in the file name or the task title).
export function filterArtifacts(rows, { kind = '', from = '', to = '', q = '' } = {}) {
  const start = from ? +new Date(from) : NaN, end = to ? +new Date(to) + (String(to).length <= 10 ? 86400000 - 1 : 0) : NaN;
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(r => (!kind || (kind === 'documents' ? DOCUMENT_KINDS.includes(r.kind) : r.kind === kind))
    && (Number.isNaN(start) || r.modifiedAt >= start) && (Number.isNaN(end) || r.modifiedAt <= end)
    && words.every(w => `${r.name} ${r.taskTitle} ${r.teams.join(' ')}`.toLowerCase().includes(w)));
}
