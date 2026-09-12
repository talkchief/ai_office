// One document icon per file type: the page with its folded corner in the type's colour, the extension across it. Drawn as SVG so
// it is crisp at any size and travels inside the single-file bundle; one size for every list, set by `.file-icon` in the stylesheet.
const KINDS = [
  ['pdf', /\.pdf$/i, 'PDF', '#D92B20'], ['deck', /\.pptx?$/i, 'PPTX', '#B4521F'], ['doc', /\.docx?$/i, 'DOCX', '#2B7CD3'],
  ['markdown', /\.(md|markdown)$/i, 'MD', '#1D6FB8'], ['data', /\.(csv|tsv)$/i, 'CSV', '#0E7038'], ['data', /\.json$/i, 'JSON', '#0E7038'],
  ['data', /\.xlsx?$/i, 'XLS', '#0E7038'], ['html', /\.html?$/i, 'HTML', '#0EA5E0'], ['image', /\.(png|jpe?g|gif|svg|webp)$/i, 'IMG', '#B7950B'],
  ['text', /\.(txt|log)$/i, 'TXT', '#5B6467'], ['code', /\.(js|mjs|cjs|ts|jsx|tsx|css|py|sh|xml|ya?ml)$/i, 'CODE', '#4A4F63'],
];
export const fileKind = name => (KINDS.find(([, re]) => re.test(String(name || ''))) || ['other', null, 'FILE', '#7F8C8D']);

// The page, the fold, and the label sized to fit the same band whatever the extension is, so a list of mixed files lines up.
export const fileIcon = name => {
  const [kind, , label, color] = fileKind(name);
  const long = label.length >= 4;
  const fit = long ? ` textLength="17" lengthAdjust="spacingAndGlyphs"` : '';
  return `<svg class="file-icon file-icon-${kind}" viewBox="0 0 22 28" role="img" aria-label="${label} file" focusable="false"><title>${label} file</title>`
    + `<path fill="${color}" d="M3 0h11l8 8v17a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3V3a3 3 0 0 1 3-3Z"/>`
    + `<path fill="#fff" fill-opacity=".42" d="M14 0l8 8h-8Z"/>`
    + `<text x="11" y="21.4" text-anchor="middle" fill="#fff" font-family="Inter, -apple-system, Helvetica Neue, sans-serif" font-size="${long ? 7 : 8.4}" font-weight="700" letter-spacing="${long ? 0 : .3}"${fit}>${label}</text></svg>`;
};
