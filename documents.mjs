import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
// The documents the office can turn into text: what a person uploads to the Brain, a project or a task.
export const READABLE_DOCUMENTS = ['.txt', '.md', '.csv', '.json', '.pdf', '.docx', '.xlsx', '.xls', '.pptx'];
export async function extractDocument({name,data}){
  const limit=5*1024*1024;
  if(typeof name!=='string'||typeof data!=='string'||data.length>Math.ceil(limit/3)*4+1024)throw new Error('Upload a document under 5 MB.');
  const extension=path.extname(name).toLowerCase(),buffer=Buffer.from(data,'base64');
  if(!READABLE_DOCUMENTS.includes(extension))throw new Error('Supported documents: PDF, Word (DOCX), Excel (XLSX, XLS), PowerPoint (PPTX), Markdown, text, CSV and JSON.');
  if(buffer.length>limit)throw new Error('Upload a document under 5 MB.');
  const content=await readDocument({name,bytes:buffer});
  return {name:path.basename(name).slice(0,180),content,characters:content.length};
}

/** The text of one document, as the teams read it. Throws with a sentence the person can act on. */
export async function readDocument({ name, bytes }) {
  const extension = path.extname(String(name || '')).toLowerCase(), buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || '');
  let content = '';
  try {
    if (extension === '.xlsx' || extension === '.xls') content = await spreadsheetText(buffer, name);
    else if (extension === '.pptx') content = await slidesText(buffer, name);
    else if (extension === '.pdf' || extension === '.docx') {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'space-document-'));
      try {
        const file = path.join(dir, 'document' + extension); await fs.writeFile(file, buffer, { mode: 0o600 });
        if (extension === '.pdf') ({ stdout: content } = await exec('pdftotext', ['-layout', file, '-'], { timeout: 60000, maxBuffer: 32 * 1024 * 1024 }));
        else ({ stdout: content } = await exec('python3', ['-c', `import sys,zipfile,xml.etree.ElementTree as E\nwith zipfile.ZipFile(sys.argv[1]) as z:\n info=z.getinfo('word/document.xml')\n if info.file_size>2000000: raise ValueError('Document too large')\n root=E.fromstring(z.read(info))\n print('\\n'.join(''.join(p.itertext()) for p in root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p')))`, file], { timeout: 60000, maxBuffer: 32 * 1024 * 1024 }));
      } finally { await fs.rm(dir, { recursive: true, force: true }); }
    } else if (['.txt', '.md', '.csv', '.json'].includes(extension)) content = buffer.toString('utf8');
    else throw new Error(`${extension || 'This'} files cannot be read as text`);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('The document reader is not installed on this server. Upload text or Markdown.');
    if (error.readable) throw error;
    throw new Error(`Could not read this ${extension === '.xlsx' || extension === '.xls' ? 'spreadsheet' : extension === '.pptx' ? 'presentation' : 'document'}${/password|encrypt/i.test(error.message) ? ': it is protected with a password' : /damaged/.test(error.message) ? ': the file is damaged or is not what its name says' : ''}. Upload an unprotected copy, or a PDF or CSV of it.`);
  }
  content = String(content || '').trim();
  if (!content) throw Object.assign(new Error(extension === '.pdf' ? 'No readable text found: a scanned PDF needs OCR or a text version.' : 'No readable text found in this file.'), { readable: true });
  if (content.length > 2000000) throw Object.assign(new Error('Document exceeds 2,000,000 characters. Split it into smaller files.'), { readable: true });
  return content;
}

// A spreadsheet as the teams read it: every sheet as a table with Excel's own column letters and row numbers, so a finding can
// name its cell; then the formulas (the logic of a model or a scoring framework lives there) and the cell comments.
const MAX_SHEET_ROWS = 1500, MAX_SHEET_COLS = 60, MAX_FORMULAS = 400, MAX_COMMENTS = 200, MAX_SPREADSHEET_CHARS = 600000;
const cellText = v => String(v ?? '').replace(/\r?\n/g, ' ⏎ ').replace(/\|/g, '\\|').trim();
export async function spreadsheetText(buffer, name = 'spreadsheet') {
  // The parser reads almost anything as a sheet, so a damaged file would come back as nonsense cells: check what it really is first.
  // An .xlsx is a ZIP; an .xls is Excel's binary (OLE) or, from many web apps, HTML, XML Spreadsheet 2003 or delimited text.
  const head = buffer.subarray(0, 512).toString('latin1'), ext = path.extname(String(name)).toLowerCase();
  const zip = head.startsWith('PK\x03\x04'), ole = head.startsWith('\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1'), texty = !/[\x00-\x08\x0E-\x1F]/.test(head);
  if (ext === '.xlsx' && !zip) throw new Error('not a real Excel workbook: the file is damaged or is not an .xlsx');
  if (ext === '.xls' && !ole && !zip && !texty) throw new Error('not a real Excel workbook: the file is damaged or is not an .xls');
  const XLSX = await import('xlsx');
  const book = XLSX.read(buffer, { type: 'buffer', cellFormula: true, cellNF: true, cellText: true, cellDates: true, sheetStubs: false });
  const hidden = new Set((book.Workbook?.Sheets || []).filter(s => s.Hidden).map(s => s.name));
  const parts = [], summary = [];
  let total = 0;
  for (const sheetName of book.SheetNames) {
    const ws = book.Sheets[sheetName]; if (!ws || !ws['!ref']) { summary.push(`${sheetName} (empty)`); continue; }
    const range = XLSX.utils.decode_range(ws['!ref']);
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true });
    // Trim the empty margin Excel keeps: trailing blank rows and columns carry nothing.
    let lastRow = rows.length - 1; while (lastRow >= 0 && rows[lastRow].every(c => String(c).trim() === '')) lastRow--;
    let lastCol = -1; for (let r = 0; r <= lastRow; r++) for (let c = rows[r].length - 1; c > lastCol; c--) if (String(rows[r][c]).trim() !== '') { lastCol = c; break; }
    const shownRows = Math.min(lastRow + 1, MAX_SHEET_ROWS), shownCols = Math.min(lastCol + 1, MAX_SHEET_COLS);
    summary.push(`${sheetName}${hidden.has(sheetName) ? ' (hidden)' : ''}: ${lastRow + 1} rows × ${lastCol + 1} columns`);
    const letters = Array.from({ length: shownCols }, (_, c) => XLSX.utils.encode_col(range.s.c + c));
    const lines = [`## Sheet: ${sheetName}${hidden.has(sheetName) ? ' (hidden)' : ''}`, '', `Cells ${XLSX.utils.encode_cell({ r: range.s.r, c: range.s.c })} to ${XLSX.utils.encode_cell({ r: range.s.r + lastRow, c: range.s.c + lastCol })}.`, ''];
    if (shownCols > 0) {
      lines.push(`| Row | ${letters.join(' | ')} |`, `|---|${letters.map(() => '---').join('|')}|`);
      for (let r = 0; r < shownRows; r++) { const row = rows[r] || []; if (row.every(c => String(c).trim() === '')) continue; lines.push(`| ${range.s.r + r + 1} | ${letters.map((_, c) => cellText(row[c])).join(' | ')} |`); }
      if (lastRow + 1 > MAX_SHEET_ROWS) lines.push('', `(Rows ${MAX_SHEET_ROWS + 1} to ${lastRow + 1} are not shown.)`);
      if (lastCol + 1 > MAX_SHEET_COLS) lines.push('', `(Columns after ${letters.at(-1)} are not shown.)`);
    }
    const formulas = [], comments = [];
    for (const [ref, cell] of Object.entries(ws)) {
      if (ref.startsWith('!')) continue;
      if (cell.f && formulas.length < MAX_FORMULAS) formulas.push(`- ${ref}: =${cell.f}${cell.w !== undefined ? ` → ${cellText(cell.w)}` : ''}`);
      if (Array.isArray(cell.c) && comments.length < MAX_COMMENTS) for (const note of cell.c) comments.push(`- ${ref}: ${cellText(note.t)}${note.a ? ` (${cellText(note.a)})` : ''}`);
    }
    if (formulas.length) lines.push('', `### Formulas in ${sheetName}`, '', ...formulas);
    if (comments.length) lines.push('', `### Comments in ${sheetName}`, '', ...comments);
    const text = lines.join('\n');
    if (total + text.length > MAX_SPREADSHEET_CHARS) { parts.push(`## Sheet: ${sheetName}\n\n(Not shown: the text copy reached its size limit. Ask for this sheet on its own, or as a CSV.)`); continue; }
    parts.push(text); total += text.length;
  }
  if (!parts.length) return '';
  return [`# ${path.basename(String(name))}`, '', `A spreadsheet with ${book.SheetNames.length} sheet${book.SheetNames.length === 1 ? '' : 's'}: ${summary.join('; ')}. Values are shown as the spreadsheet displays them; cells are named by column letter and row number.`, '', parts.join('\n\n')].join('\n');
}

// A slide deck as text: each slide's words in order, then its speaker notes.
export async function slidesText(buffer, name = 'presentation') {
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(buffer), { filter: f => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(f.name) });
  const words = xml => [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)].map(p => [...p[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(t => t[1]).join('')).map(t => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim()).filter(Boolean);
  const numbers = Object.keys(files).map(f => /slides\/slide(\d+)\.xml$/.exec(f)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
  const slides = numbers.map(n => { const body = words(strFromU8(files[`ppt/slides/slide${n}.xml`])), notes = files[`ppt/notesSlides/notesSlide${n}.xml`] ? words(strFromU8(files[`ppt/notesSlides/notesSlide${n}.xml`])).filter(l => !/^\d+$/.test(l)) : [];
    return [`## Slide ${n}`, '', ...body, ...(notes.length ? ['', 'Speaker notes:', ...notes] : [])].join('\n'); });
  if (!slides.some(s => s.split('\n').length > 2)) return '';
  return [`# ${path.basename(String(name))}`, '', `A presentation with ${slides.length} slide${slides.length === 1 ? '' : 's'}.`, '', slides.join('\n\n')].join('\n');
}
