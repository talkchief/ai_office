// A small document tile per file type (the extension on a colour), so a list of files reads at a glance.
const KINDS = [
  ['pdf', /\.pdf$/i, 'PDF', '#C0392B'], ['deck', /\.pptx?$/i, 'PPTX', '#D35400'], ['doc', /\.docx?$/i, 'DOCX', '#2E5CB8'],
  ['markdown', /\.(md|markdown)$/i, 'MD', '#2C6E9E'], ['data', /\.(csv|tsv)$/i, 'CSV', '#1E8449'], ['data', /\.json$/i, 'JSON', '#1E8449'],
  ['data', /\.xlsx?$/i, 'XLSX', '#1E8449'], ['html', /\.html?$/i, 'HTML', '#7D3C98'], ['image', /\.(png|jpe?g|gif|svg|webp)$/i, 'IMG', '#B7950B'],
  ['text', /\.(txt|log)$/i, 'TXT', '#616A6B'],
];
export const fileKind = name => (KINDS.find(([, re]) => re.test(String(name || ''))) || ['other', null, 'FILE', '#7F8C8D']);
export const fileIcon = name => { const [kind, , label, color] = fileKind(name); return `<span class="file-icon file-icon-${kind}" style="--file-color:${color}" title="${label} file" role="img" aria-label="${label} file">${label}</span>`; };
