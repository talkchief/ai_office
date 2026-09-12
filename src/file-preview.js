// A file the office can draw is drawn here, inside the office, rather than handed to a new tab: the CEO reads the
// deliverable without losing the page they were on. One overlay serves every list that offers a file — the project's
// results, the Brain's notes, the office artifacts, a task's own workspace — opened by any button carrying the file's
// address. It is a modal dialog of its own so it sits above the task dialog, which is one too. Anything the office
// cannot draw (a deck, a spreadsheet) says so and offers the download instead.
import { renderDocument, escapeHTML as esc } from './task-output.js';
import { fileIcon } from './fileicon.js';

const ext = name => (String(name || '').split('.').pop() || '').toLowerCase();
const KIND = {
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image', avif: 'image',
  html: 'page', htm: 'page',
  md: 'markdown', markdown: 'markdown',
  txt: 'text', log: 'text', json: 'text', yaml: 'text', yml: 'text', xml: 'text', css: 'text', js: 'text',
  csv: 'table', tsv: 'table',
};
// What the office can draw for itself. A name it does not know is only worth saving.
export const canShow = name => Boolean(KIND[ext(name)]);
export const previewKind = name => KIND[ext(name)] || '';
const inline = url => url + (url.includes('?') ? '&' : '?') + 'inline=1';
const TOO_BIG = 4 * 1024 * 1024;

// A comma-separated file is a table, quotes and all; a line that is not a row stays a row of one cell.
function parseRows(text, sep) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0] !== '');
}

let host = null;
function shell() {
  if (host) return host;
  host = document.createElement('dialog');
  host.className = 'fp'; host.id = 'filePreview'; host.setAttribute('aria-label', 'File preview');
  host.innerHTML = `<div class="fp-back" data-fp-close></div>
    <div class="fp-panel">
      <header class="fp-head">
        <span class="fp-name" id="fpName"></span>
        <span class="fp-sp"></span>
        <a class="fp-btn" id="fpDownload" download>Download</a>
        <button type="button" class="fp-x" data-fp-close aria-label="Close the preview">✕</button>
      </header>
      <div class="fp-body" id="fpBody"></div>
    </div>`;
  document.body.append(host);
  host.addEventListener('click', event => { if (event.target.closest('[data-fp-close]')) close(); });
  // Esc belongs to the topmost thing on screen: the preview closes, the task dialog under it stays open.
  host.addEventListener('cancel', event => { event.preventDefault(); close(); });
  host.addEventListener('close', () => {
    host.querySelector('#fpBody').innerHTML = '';   // stop a PDF or a page from running on behind the scenes
    document.body.classList.remove('fp-open');
  });
  return host;
}

export function close() { if (host?.open) host.close(); }

// Open one file in the office. `name` decides how it is drawn; `url` is the office's own address for it.
export async function openFile({ url, name, bytes }) {
  if (!url) return;
  const el = shell(), body = el.querySelector('#fpBody');
  el.querySelector('#fpName').innerHTML = `${fileIcon(name)}<b>${esc(String(name || '').split('/').pop())}</b>`;
  el.querySelector('#fpDownload').href = url;
  if (!el.open) el.showModal();
  document.body.classList.add('fp-open');
  el.querySelector('.fp-x').focus();
  const kind = previewKind(name);
  const note = text => { body.innerHTML = `<div class="fp-note"><p>${esc(text)}</p></div>`; };
  body.innerHTML = '<div class="fp-note"><p>Opening…</p></div>';
  if (bytes && bytes > TOO_BIG && kind !== 'pdf' && kind !== 'image') return note('This file is too large to show here. Download it instead.');
  try {
    if (kind === 'pdf') body.innerHTML = `<iframe class="fp-frame" src="${esc(inline(url))}" title="${esc(name)}"></iframe>`;
    else if (kind === 'image') body.innerHTML = `<div class="fp-image"><img src="${esc(inline(url))}" alt="${esc(name)}"></div>`;
    else if (kind === 'page') body.innerHTML = `<iframe class="fp-frame" sandbox src="${esc(inline(url))}" title="${esc(name)}"></iframe>`;
    else {
      const res = await fetch(inline(url));
      if (!res.ok) return note('That file could not be opened. Download it instead.');
      const text = await res.text();
      if (!el.open) return;
      if (kind === 'markdown') body.innerHTML = `<div class="fp-doc">${renderDocument(text, 'preview').html}</div>`;
      else if (kind === 'table') {
        const rows = parseRows(text, ext(name) === 'tsv' ? '\t' : ','), head = rows.shift() || [];
        body.innerHTML = `<div class="fp-sheet"><table><thead><tr>${head.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, 500).map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>${rows.length > 500 ? `<p class="fp-more">${rows.length - 500} more rows. Download the file to see them all.</p>` : ''}</div>`;
      } else body.innerHTML = `<pre class="fp-pre">${esc(text)}</pre>`;
    }
  } catch { note('That file could not be opened. Download it instead.'); }
}

// Any button anywhere in the office that names a file opens it here.
document.addEventListener('click', event => {
  const button = event.target.closest('[data-preview-url]');
  if (!button) return;
  event.preventDefault();
  openFile({ url: button.dataset.previewUrl, name: button.dataset.previewName || '', bytes: Number(button.dataset.previewBytes) || 0 });
});
