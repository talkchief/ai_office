// Documents an agent can hand the CEO. Agents write Markdown; this turns it into files the CEO downloads from the task page:
// a PDF (Markdown → HTML with a print stylesheet → Chrome or Edge on this machine; a pure-JavaScript renderer when no browser
// is installed) and a PowerPoint deck (one slide per heading, bullets from lists, tables kept). A model never writes binary by hand.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import MarkdownIt from 'markdown-it';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ---------- the workspace ---------- */
// '/work/notes/brief.md' or 'brief.md' → { abs, rel } inside the workspace; anything that escapes it is refused.
export function workspaceFile(workspaceDir, virtualPath) {
  const rel = String(virtualPath || '').trim().replace(/^\/?work\//, '').replace(/^\/+/, '');
  if (!rel || rel.includes('\0')) throw new Error('Name a file inside /work/, for example /work/report.md.');
  const root = path.resolve(workspaceDir), abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('Only files inside /work/ can be used.');
  return { abs, rel: path.relative(root, abs).split(path.sep).join('/') };
}
export const MIME = { pdf: 'application/pdf', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', json: 'application/json', html: 'text/html; charset=utf-8', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml' };
export const mimeOf = name => MIME[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream';

// Every file in a task's workspace, newest first: what the CEO can download from the task page.
export function listWorkspaceFiles(workspaceDir, { limit = 200 } = {}) {
  const root = path.resolve(workspaceDir); if (!fs.existsSync(root)) return [];
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) { const stat = fs.statSync(full); out.push({ name: path.relative(root, full).split(path.sep).join('/'), bytes: stat.size, modifiedAt: stat.mtimeMs, type: mimeOf(entry.name) }); }
      if (out.length >= limit) return;
    }
  };
  walk(root);
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/* ---------- Markdown → HTML, the shape every document shares ---------- */
const PRINT_CSS = `
  @page { size: A4; margin: 22mm 18mm 20mm 18mm; }
  html { font-size: 11pt; }
  body { margin: 0; font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #151414; line-height: 1.5; }
  .doc-title { font-family: Georgia, "Times New Roman", serif; font-size: 26pt; font-weight: 600; line-height: 1.15; margin: 0 0 4pt; letter-spacing: -0.01em; }
  .doc-meta { font-size: 9pt; color: #6E6A62; margin: 0 0 18pt; padding-bottom: 10pt; border-bottom: 1px solid #C9C4B8; }
  h1, h2, h3, h4 { font-family: Georgia, "Times New Roman", serif; font-weight: 600; line-height: 1.2; page-break-after: avoid; break-after: avoid; }
  h1 { font-size: 20pt; margin: 22pt 0 8pt; } h2 { font-size: 15.5pt; margin: 18pt 0 6pt; } h3 { font-size: 12.5pt; margin: 14pt 0 4pt; } h4 { font-size: 11pt; margin: 12pt 0 3pt; }
  h1 + h2, h2 + h3 { margin-top: 6pt; }
  p { margin: 0 0 8pt; orphans: 3; widows: 3; }
  ul, ol { margin: 0 0 8pt; padding-left: 18pt; } li { margin: 0 0 3pt; } li > p { margin: 0 0 3pt; }
  a { color: #1E5F8C; text-decoration: none; }
  strong { font-weight: 600; }
  blockquote { margin: 6pt 0 10pt; padding: 4pt 0 4pt 12pt; border-left: 2.5pt solid #C9C4B8; color: #4E4A43; }
  code { font-family: Consolas, "Courier New", monospace; font-size: 9.5pt; background: #F1EEE6; padding: 0 3pt; border-radius: 3pt; }
  pre { background: #F4F2EC; border: 1px solid #E2DED4; border-radius: 4pt; padding: 8pt 10pt; font-size: 9pt; line-height: 1.45; white-space: pre-wrap; page-break-inside: avoid; margin: 0 0 10pt; }
  pre code { background: none; padding: 0; font-size: inherit; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0 12pt; font-size: 9.5pt; page-break-inside: auto; }
  thead { display: table-header-group; } tr { page-break-inside: avoid; }
  th, td { text-align: left; vertical-align: top; padding: 5pt 7pt; border-bottom: 1px solid #D9D4C8; }
  th { background: #EFECE4; font-weight: 600; border-bottom: 1.5px solid #B9B4A8; }
  hr { border: 0; border-top: 1px solid #C9C4B8; margin: 14pt 0; }
  img { max-width: 100%; }
`;
export function markdownToHtml(markdown, { title = '', date = new Date() } = {}) {
  const body = md.render(String(markdown || ''));
  // A document whose first heading is the title does not repeat it below the title block.
  const firstHeading = (String(markdown || '').match(/^#\s+(.+)$/m) || [])[1]?.trim();
  const stripped = title && firstHeading === title ? body.replace(/^\s*<h1>[\s\S]*?<\/h1>/, '') : body;
  const meta = date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title || firstHeading || 'Document')}</title><style>${PRINT_CSS}</style></head><body>${title ? `<h1 class="doc-title">${esc(title)}</h1><p class="doc-meta">${esc(meta)}</p>` : ''}${stripped}</body></html>`;
}

/* ---------- PDF ---------- */
// The browser on this machine: Chrome or Edge through playwright-core, or the path in AO_CHROME. Checked once, rechecked after failures.
let browserState = { checkedAt: 0, ok: null, launch: null };
async function browserLaunch() {
  if (browserState.ok === false && Date.now() - browserState.checkedAt < 5 * 60000) return null;
  if (browserState.ok && browserState.launch) return browserState.launch;
  let chromium; try { ({ chromium } = require('playwright-core')); } catch { browserState = { checkedAt: Date.now(), ok: false }; return null; }
  const attempts = [process.env.AO_CHROME ? { executablePath: process.env.AO_CHROME } : null, { channel: 'chrome' }, { channel: 'msedge' }, { channel: 'chromium' }].filter(Boolean);
  for (const options of attempts) {
    try { const b = await chromium.launch({ ...options, headless: true }); await b.close(); browserState = { checkedAt: Date.now(), ok: true, launch: () => chromium.launch({ ...options, headless: true }) }; return browserState.launch; }
    catch { /* try the next one */ }
  }
  browserState = { checkedAt: Date.now(), ok: false }; return null;
}
export async function pdfEngineAvailable() { return !!(await browserLaunch()); }

async function renderPdfWithBrowser({ html, title, out }) {
  const launch = await browserLaunch(); if (!launch) return null;
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: `<div style="font-family:Arial,sans-serif;font-size:7.5pt;color:#8A867E;width:100%;padding:0 18mm;display:flex;justify-content:space-between"><span>${esc(title || '')}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      margin: { top: '22mm', bottom: '20mm', left: '18mm', right: '18mm' } });
    return { engine: 'browser' };
  } finally { await browser.close().catch(() => {}); }
}

// The fallback renderer: pdfkit, one flow, no explicit coordinates, so the page never runs away.
const FONT = { body: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique', boldItalic: 'Helvetica-BoldOblique', mono: 'Courier' };
const SIZE = { 1: 20, 2: 15.5, 3: 12.5, 4: 11.5, 5: 11, 6: 11, body: 10.5, small: 9 };
const fontFor = run => run.code ? FONT.mono : run.bold && run.italic ? FONT.boldItalic : run.bold ? FONT.bold : run.italic ? FONT.italic : FONT.body;
function runsOf(inline) {
  const runs = []; let bold = 0, italic = 0, link = null;
  for (const t of inline?.children || []) {
    if (t.type === 'strong_open') bold++; else if (t.type === 'strong_close') bold--;
    else if (t.type === 'em_open') italic++; else if (t.type === 'em_close') italic--;
    else if (t.type === 'link_open') link = t.attrGet('href'); else if (t.type === 'link_close') link = null;
    else if (t.type === 'code_inline') runs.push({ text: t.content, code: true, bold: bold > 0, italic: italic > 0, link });
    else if (t.type === 'softbreak' || t.type === 'hardbreak') runs.push({ text: ' ', bold: bold > 0, italic: italic > 0, link });
    else if (t.type === 'text' || t.type === 'html_inline') runs.push({ text: t.content, bold: bold > 0, italic: italic > 0, link });
    else if (t.type === 'image') runs.push({ text: t.content ? `[${t.content}]` : '', italic: true });
  }
  return runs.filter(r => r.text);
}
function paragraph(doc, runs, { size = SIZE.body, indent = 0, color = '#151414', gap = 7, prefix = '' } = {}) {
  const left = doc.page.margins.left, width = doc.page.width - left - doc.page.margins.right - indent;
  if (doc.y > doc.page.height - doc.page.margins.bottom - size * 2) doc.addPage();
  doc.x = left + indent;
  const all = prefix ? [{ text: prefix }, ...runs] : runs;
  if (!all.length) { doc.moveDown(0.3); doc.x = left; return; }
  all.forEach((run, i) => doc.font(fontFor(run)).fontSize(size).fillColor(run.link ? '#1E5F8C' : color).text(run.text, { width, continued: i < all.length - 1, lineGap: 1.5, ...(run.link ? { link: run.link } : {}) }));
  doc.fillColor('#151414').x = left; doc.moveDown(gap / size);
}
function renderTokensPdfkit(doc, tokens) {
  const lists = []; let quote = 0, table = null;
  const indent = () => lists.length * 16 + (quote ? 12 : 0);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t.type) {
      case 'heading_open': {
        const level = Number(t.tag.slice(1)) || 2, size = SIZE[level] || SIZE.body;
        if (level <= 2 && doc.y > doc.page.height - doc.page.margins.bottom - 70) doc.addPage(); else doc.moveDown(level <= 2 ? 0.8 : 0.5);
        paragraph(doc, runsOf(tokens[++i]).map(r => ({ ...r, bold: true })), { size, gap: level <= 2 ? 6 : 4 });
        i++; break;
      }
      case 'paragraph_open': {
        const list = lists.at(-1); let prefix = '';
        if (list?.pendingMarker) { prefix = list.ordered ? `${list.index}.  ` : '•  '; list.pendingMarker = false; }
        paragraph(doc, runsOf(tokens[++i]), { indent: indent(), gap: lists.length ? 3 : 7, color: quote ? '#4E4A43' : '#151414', prefix });
        i++; break;
      }
      case 'bullet_list_open': lists.push({ ordered: false, index: 0 }); break;
      case 'ordered_list_open': lists.push({ ordered: true, index: Number(t.attrGet('start') || 1) - 1 }); break;
      case 'bullet_list_close': case 'ordered_list_close': lists.pop(); if (!lists.length) doc.moveDown(0.3); break;
      case 'list_item_open': { const list = lists.at(-1); if (list) { list.index++; list.pendingMarker = true; } break; }
      case 'fence': case 'code_block': {
        for (const line of t.content.replace(/\n$/, '').split('\n')) paragraph(doc, [{ text: line || ' ', code: true }], { size: 9, indent: indent() + 6, gap: 0, color: '#2B2B2B' });
        doc.moveDown(0.6); break;
      }
      case 'blockquote_open': quote++; break;
      case 'blockquote_close': quote--; break;
      case 'hr': doc.moveDown(0.3); doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).lineWidth(0.5).strokeColor('#C9C4B8').stroke(); doc.moveDown(0.8); break;
      case 'table_open': table = { rows: [], head: [], inHead: false, row: [] }; break;
      case 'thead_open': table.inHead = true; break;
      case 'thead_close': table.inHead = false; break;
      case 'tr_open': table.row = []; break;
      case 'th_open': case 'td_open': table.row.push(runsOf(tokens[++i]).map(r => r.text).join('').trim()); i++; break;
      case 'tr_close': (table.inHead ? table.head : table.rows).push(table.row); break;
      case 'table_close': drawTablePdfkit(doc, table); table = null; break;
      default: break;
    }
  }
}
function drawTablePdfkit(doc, table) {
  const rows = [...(table.head.length ? [table.head] : []), ...table.rows]; if (!rows.length) return;
  const left = doc.page.margins.left, width = doc.page.width - left - doc.page.margins.right;
  const cols = Math.max(...rows.map(r => r.length)), colWidth = width / cols;
  doc.moveDown(0.3);
  rows.forEach((row, r) => {
    const isHead = table.head.length && r === 0;
    doc.font(isHead ? FONT.bold : FONT.body).fontSize(9);
    const height = Math.max(...row.map(cell => doc.heightOfString(cell || ' ', { width: colWidth - 8 }))) + 7;
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const y = doc.y;
    if (isHead) doc.save().rect(left, y - 2, width, height).fillColor('#EFECE4').fill().restore();
    row.forEach((cell, c) => doc.font(isHead ? FONT.bold : FONT.body).fontSize(9).fillColor('#151414').text(cell || '', left + c * colWidth + 4, y + 1, { width: colWidth - 8, lineBreak: true }));
    doc.x = left; doc.y = y + height;
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.4).strokeColor('#D9D4C8').stroke();
  });
  doc.x = left; doc.moveDown(0.8);
}
async function renderPdfWithPdfkit({ markdown, title, out }) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margins: { top: 62, bottom: 60, left: 52, right: 52 }, bufferPages: true, info: { Title: title || path.basename(out, '.pdf'), Author: 'Cloud AI Office' } });
  const stream = fs.createWriteStream(out); doc.pipe(stream);
  if (title) { paragraph(doc, [{ text: title, bold: true }], { size: 24, gap: 2 }); paragraph(doc, [{ text: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) }], { size: 9, color: '#6E6A62', gap: 14 }); }
  const firstHeading = (String(markdown || '').match(/^#\s+(.+)$/m) || [])[1]?.trim();
  const tokens = md.parse(String(markdown || ''), {});
  const start = title && firstHeading === title && tokens[0]?.type === 'heading_open' ? 3 : 0;
  renderTokensPdfkit(doc, tokens.slice(start));
  const range = doc.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    const bottom = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.font(FONT.body).fontSize(8).fillColor('#8A867E').text(`${title ? title + '   ' : ''}${p - range.start + 1} / ${range.count}`, doc.page.margins.left, doc.page.height - 38, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  await new Promise((resolve, reject) => { stream.on('finish', resolve); stream.on('error', reject); });
  return { engine: 'pdfkit', pages: range.count };
}
// Pages in a finished PDF: the page tree's /Count (Chrome writes it in clear), else the page objects.
export function countPdfPages(file) {
  const raw = fs.readFileSync(file, 'latin1');
  const tree = [...raw.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g)].map(m => Number(m[1]));
  if (tree.length) return Math.max(...tree);
  return (raw.match(/\/Type\s*\/Page[^s]/g) || []).length || 1;
}
// Renders Markdown to a PDF file. Returns { pages, bytes, engine }.
export async function renderPdf({ markdown, title = '', out, engine = 'auto' }) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  let result = null;
  if (engine !== 'pdfkit') result = await renderPdfWithBrowser({ html: markdownToHtml(markdown, { title }), title, out }).catch(() => null);
  if (!result) result = await renderPdfWithPdfkit({ markdown, title, out });
  const bytes = fs.statSync(out).size;
  const pages = result.pages || countPdfPages(out);
  return { pages, bytes, engine: result.engine };
}

/* ---------- PowerPoint ---------- */
// Slides from Markdown: `#` is the title slide, every `##` (or `###`) starts a slide; lists become bullets, a table stays a
// table, other paragraphs become short lines. A section with too many points continues on the next slide.
export function markdownToSlides(markdown, { maxBullets = 8 } = {}) {
  const tokens = md.parse(String(markdown || ''), {});
  const text = inline => runsOf(inline).map(r => r.text).join('').trim();
  const slides = []; let current = null, title = '', subtitle = [];
  let table = null, listDepth = 0;
  const open = heading => { current = { title: heading, bullets: [], table: null, notes: [] }; slides.push(current); };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open') {
      const level = Number(t.tag.slice(1)), heading = text(tokens[++i]); i++;
      if (level === 1 && !title && !slides.length) { title = heading; continue; }
      open(heading); continue;
    }
    if (t.type === 'paragraph_open') {
      const line = text(tokens[++i]); i++;
      if (!line) continue;
      if (!current) { subtitle.push(line); continue; }
      current.bullets.push({ text: line, level: Math.max(0, listDepth - 1), plain: listDepth === 0 });
      continue;
    }
    if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') listDepth++;
    else if (t.type === 'bullet_list_close' || t.type === 'ordered_list_close') listDepth--;
    else if (t.type === 'table_open') table = { head: [], rows: [], inHead: false, row: [] };
    else if (t.type === 'thead_open') table.inHead = true;
    else if (t.type === 'thead_close') table.inHead = false;
    else if (t.type === 'tr_open') table.row = [];
    else if (t.type === 'th_open' || t.type === 'td_open') { table.row.push(text(tokens[++i])); i++; }
    else if (t.type === 'tr_close') (table.inHead ? table.head : table.rows).push(table.row);
    else if (t.type === 'table_close') { if (!current) open(title || 'Overview'); current.table = { head: table.head[0] || [], rows: table.rows }; table = null; }
    else if (t.type === 'fence' || t.type === 'code_block') { if (!current) open(title || 'Overview'); current.bullets.push({ text: t.content.trim().split('\n').slice(0, 6).join('\n'), level: 0, code: true }); }
  }
  // Long sections continue on the next slide.
  const out = [];
  for (const s of slides) {
    if (s.bullets.length <= maxBullets) { out.push(s); continue; }
    for (let i = 0; i < s.bullets.length; i += maxBullets) out.push({ ...s, title: i ? `${s.title} (continued)` : s.title, bullets: s.bullets.slice(i, i + maxBullets), table: i ? null : s.table });
  }
  return { title: title || out[0]?.title || 'Presentation', subtitle: subtitle.join(' ').slice(0, 240), slides: out };
}
const DECK = { ink: '151414', cream: 'FDFBF7', grey: '6E6A62', accent: '287657', line: 'C9C4B8', font: 'Calibri', serif: 'Georgia' };
export async function renderPptx({ markdown, title = '', out }) {
  const PptxGenJS = require('pptxgenjs');
  const deck = markdownToSlides(markdown), name = title || deck.title;
  const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_16x9'; pptx.title = name; pptx.author = 'Cloud AI Office';
  const W = 10, H = 5.625;
  const cover = pptx.addSlide(); cover.background = { color: DECK.cream };
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: H, fill: { color: DECK.accent } });
  cover.addText(name, { x: 0.7, y: 1.5, w: W - 1.4, h: 1.6, fontFace: DECK.serif, fontSize: 36, bold: true, color: DECK.ink, valign: 'bottom' });
  cover.addText(deck.subtitle || new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), { x: 0.7, y: 3.2, w: W - 1.4, h: 0.9, fontFace: DECK.font, fontSize: 16, color: DECK.grey, valign: 'top' });
  deck.slides.forEach((s, index) => {
    const slide = pptx.addSlide(); slide.background = { color: DECK.cream };
    slide.addText(s.title, { x: 0.6, y: 0.35, w: W - 1.2, h: 0.8, fontFace: DECK.serif, fontSize: 26, bold: true, color: DECK.ink, valign: 'middle' });
    slide.addShape(pptx.ShapeType.line, { x: 0.6, y: 1.2, w: W - 1.2, h: 0, line: { color: DECK.line, width: 0.75 } });
    let y = 1.4;
    if (s.bullets.length) {
      const items = s.bullets.map(b => ({ text: b.text, options: { bullet: b.plain && !b.code ? false : b.code ? false : { indent: 14 }, indentLevel: b.level, fontFace: b.code ? 'Consolas' : DECK.font, fontSize: b.code ? 11 : s.bullets.length > 6 ? 14 : 16, color: DECK.ink, paraSpaceAfter: 6, breakLine: true } }));
      const h = s.table ? 2.0 : H - 1.4 - 0.6;
      slide.addText(items, { x: 0.6, y, w: W - 1.2, h, valign: 'top', fit: 'shrink' });
      y += h + 0.1;
    }
    if (s.table) {
      const rows = [...(s.table.head.length ? [s.table.head.map(c => ({ text: c, options: { bold: true, fill: { color: 'EFECE4' }, color: DECK.ink } }))] : []), ...s.table.rows.map(r => r.map(c => ({ text: c, options: { color: DECK.ink } })))];
      slide.addTable(rows, { x: 0.6, y, w: W - 1.2, fontFace: DECK.font, fontSize: 11, border: { type: 'solid', color: 'D9D4C8', pt: 0.5 }, autoPage: false, rowH: 0.32 });
    }
    slide.addText(`${name}   ${index + 1} / ${deck.slides.length}`, { x: 0.6, y: H - 0.45, w: W - 1.2, h: 0.3, fontFace: DECK.font, fontSize: 9, color: DECK.grey, align: 'right' });
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await pptx.writeFile({ fileName: out });
  return { slides: deck.slides.length + 1, bytes: fs.statSync(out).size };
}

/* ---------- the tools agents call ---------- */
const sizeOf = bytes => `${Math.max(1, Math.round(bytes / 1024))} KB`;
function sourceOf(workspaceDir, source) {
  const src = workspaceFile(workspaceDir, source);
  if (!fs.existsSync(src.abs)) return { error: `There is no file at /work/${src.rel}. Write the Markdown there first, then export it.` };
  if (!/\.(md|markdown|txt)$/i.test(src.rel)) return { error: 'Point this at a Markdown (.md) file in /work/; write the document as Markdown first.' };
  const markdown = fs.readFileSync(src.abs, 'utf8');
  return { src, markdown, heading: (markdown.match(/^#\s+(.+)$/m) || [])[1]?.trim() || '' };
}
export function exportPdfTool({ workspaceDir, onSaved = () => {} }) {
  return tool(async ({ source, output, title }) => {
    try {
      const s = sourceOf(workspaceDir, source); if (s.error) return s.error;
      const dest = workspaceFile(workspaceDir, output || s.src.rel.replace(/\.(md|markdown|txt)$/i, '') + '.pdf');
      if (!/\.pdf$/i.test(dest.rel)) return 'The output name must end in .pdf.';
      const { pages, bytes, engine } = await renderPdf({ markdown: s.markdown, title: title || s.heading, out: dest.abs });
      onSaved({ file: dest.rel, pages, bytes, engine });
      return `Saved /work/${dest.rel}: ${pages} page${pages === 1 ? '' : 's'}, ${sizeOf(bytes)}. Name the file in your answer; the CEO downloads it from the task page under Artifacts.`;
    } catch (error) { return `Could not export the PDF: ${error.message}`; }
  }, { name: 'export_pdf', description: 'Turn a Markdown file in /work/ into a formatted PDF the CEO downloads from the task page. Write the document as Markdown first (a title heading, sections, lists, tables), then call this with its path. Never try to write PDF bytes yourself.',
    schema: z.object({ source: z.string().describe('Path of the Markdown file, e.g. /work/report.md'), output: z.string().optional().describe('PDF path, default: the same name with .pdf'), title: z.string().optional().describe('Title on the first page and in the footer; default: the first heading') }) });
}
export function exportPptxTool({ workspaceDir, onSaved = () => {} }) {
  return tool(async ({ source, output, title }) => {
    try {
      const s = sourceOf(workspaceDir, source); if (s.error) return s.error;
      const dest = workspaceFile(workspaceDir, output || s.src.rel.replace(/\.(md|markdown|txt)$/i, '') + '.pptx');
      if (!/\.pptx$/i.test(dest.rel)) return 'The output name must end in .pptx.';
      const { slides, bytes } = await renderPptx({ markdown: s.markdown, title: title || s.heading, out: dest.abs });
      onSaved({ file: dest.rel, slides, bytes });
      return `Saved /work/${dest.rel}: ${slides} slides, ${sizeOf(bytes)}. Name the file in your answer; the CEO downloads it from the task page under Artifacts.`;
    } catch (error) { return `Could not export the slides: ${error.message}`; }
  }, { name: 'export_pptx', description: 'Turn a Markdown file in /work/ into a PowerPoint deck the CEO downloads from the task page. Write the deck as Markdown first: `#` is the title, every `##` is one slide, list items are its bullets (keep 3 to 6 per slide, one line each), a table stays a table. Then call this with the path. Never try to write PPTX bytes yourself.',
    schema: z.object({ source: z.string().describe('Path of the Markdown file, e.g. /work/deck.md'), output: z.string().optional().describe('Deck path, default: the same name with .pptx'), title: z.string().optional().describe('Deck title on the cover; default: the first heading') }) });
}
