// Office Artifacts: every file every task produced, in one list the CEO can filter by kind, by date and by words.
const KINDS = [
  ['pdf', /\.pdf$/i, 'PDF'], ['deck', /\.pptx?$/i, 'Deck'], ['markdown', /\.(md|markdown)$/i, 'Markdown'], ['data', /\.(csv|json|xlsx?|tsv)$/i, 'Data'],
  ['html', /\.html?$/i, 'HTML'], ['image', /\.(png|jpe?g|gif|svg|webp)$/i, 'Image'], ['text', /\.(txt|log)$/i, 'Text'],
];
export const ARTIFACT_KINDS = KINDS.map(([id, , label]) => ({ id, label })).concat([{ id: 'other', label: 'Other' }]);
export const kindOf = name => (KINDS.find(([, re]) => re.test(String(name || ''))) || ['other'])[0];

// One row per file: what it is, which task made it, for which teams and project, when, how big, and where to download it.
export function collectArtifacts({ jobs, filesFor, office }) {
  const teamName = id => office?.teams?.find(t => t.id === id)?.name || id;
  const rows = [];
  for (const job of jobs) {
    let files = []; try { files = filesFor(job.id) || []; } catch { continue; }
    const teams = [...new Set([...(job.depts?.length ? job.depts : job.dept ? [job.dept] : []), ...(job.runs || []).filter(r => r.role === 'lead' && r.dept).map(r => r.dept)])].map(teamName);
    for (const f of files) rows.push({ id: `${job.id}:${f.name}`, taskId: job.id, taskTitle: job.title, taskState: job.state, projectId: job.projectId || null, teams, name: f.name, kind: kindOf(f.name), type: f.type, bytes: f.bytes, modifiedAt: f.modifiedAt, url: `/api/tasks/${job.id}/file?path=${encodeURIComponent(f.name)}` });
  }
  return rows.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

// Filters: kind (one of ARTIFACT_KINDS), from/to (dates, inclusive; a date string or a time), words (in the file name or the task title).
export function filterArtifacts(rows, { kind = '', from = '', to = '', q = '' } = {}) {
  const start = from ? +new Date(from) : NaN, end = to ? +new Date(to) + (String(to).length <= 10 ? 86400000 - 1 : 0) : NaN;
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(r => (!kind || r.kind === kind)
    && (Number.isNaN(start) || r.modifiedAt >= start) && (Number.isNaN(end) || r.modifiedAt <= end)
    && words.every(w => `${r.name} ${r.taskTitle} ${r.teams.join(' ')}`.toLowerCase().includes(w)));
}
