// Mail bodies. Agents write Markdown, which is right for the office screens and wrong in a mail client: asterisks and
// hashes arrive literally. Every outbound message is built here into two parts — plain prose and a small HTML
// alternative — from the same text. Safe on text that was never Markdown: a receipt passes through unchanged.
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Markdown → the plain-text part: nothing left for a mail client to show as syntax. */
export function mailText(markdown) {
  let t = String(markdown || '').replace(/\r\n/g, '\n');
  t = t.replace(/```[\w-]*\n([\s\S]*?)```/g, (_, code) => String(code).replace(/\n$/, ''));
  t = t.replace(/`([^`\n]+)`/g, '$1');
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, label, url) => (label.trim() === url.trim() ? url : `${label.trim()} (${url})`));
  // Line-anchored patterns use [ \t], never \s: \s matches newlines too, so `\s*$` runs past the end of
  // its own line and swallows the blank line after it — which ran whole messages together into one block.
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, '$1');
  t = t.replace(/^[ \t]{0,3}>[ \t]?/gm, '');
  t = t.replace(/^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '—');
  t = t.replace(/^([ \t]*)[-*+][ \t]+/gm, '$1– ');
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1');
  t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1$2');
  t = t.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1$2');
  return t.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Markdown → the HTML part: inline styles only, no document chrome, nothing a mail client will strip. */
export function mailHtml(markdown) {
  const body = md.render(String(markdown || '')).trim();
  return body || `<p>${esc(String(markdown || ''))}</p>`;
}

/**
 * Both parts of one message, with the office's sign-off and an optional footer line.
 * `body` is what the agent wrote; everything else is the office speaking.
 */
export function mailParts(body, { signature = '', footer = '' } = {}) {
  const text = [mailText(body), [signature ? `— ${signature}` : '', footer].filter(Boolean).join('\n')].filter(Boolean).join('\n\n');
  const sign = [signature ? `— ${esc(signature)}` : '', footer ? esc(footer) : ''].filter(Boolean).join('<br>');
  const html = `<div style="font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;max-width:640px">`
    + mailHtml(body)
    + (sign ? `<p style="margin:22px 0 0;padding-top:12px;border-top:1px solid #e4e4e0;color:#6b6b66;font-size:13px">${sign}</p>` : '')
    + `</div>`;
  return { text, html };
}
