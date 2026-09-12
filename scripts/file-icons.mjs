// Writes the file-type icons out as standalone SVG files, from the same drawing the app uses (src/fileicon.js), so the artwork in
// design/file-icons/ and the icons in the product can never drift apart.   node scripts/file-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileIcon, fileKind } from '../src/fileicon.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'design', 'file-icons');
// One sample name per type; the icon is drawn from the extension.
const SAMPLES = ['report.pdf', 'deck.pptx', 'letter.docx', 'notes.md', 'sheet.xlsx', 'rows.csv', 'data.json', 'page.html', 'photo.png', 'log.txt', 'app.js', 'thing.bin'];

fs.mkdirSync(OUT, { recursive: true });
const written = new Set();
for (const sample of SAMPLES) {
  const [, , label] = fileKind(sample), name = `${label.toLowerCase()}.svg`;
  if (written.has(name)) continue;
  // Standalone artwork: the same paths, with a size so the file opens at a sensible scale on its own.
  const svg = fileIcon(sample).replace('<svg class="file-icon', '<svg xmlns="http://www.w3.org/2000/svg" width="176" height="224" class="file-icon');
  fs.writeFileSync(path.join(OUT, name), svg + '\n');
  written.add(name);
}
console.log(`wrote ${written.size} icons to design/file-icons: ${[...written].join(', ')}`);
