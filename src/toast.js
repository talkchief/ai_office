// A toast: a short confirmation, warning or error in the top-right corner. Success goes away on its own; a failure stays
// until dismissed, and can carry one action (Retry, Sign in, Open…).
let host = null;
export function toast(message, { kind = 'ok', detail = '', action = null, ms } = {}) {
  const text = String(message || '').trim(); if (!text || typeof document === 'undefined') return;
  if (!host) { host = document.createElement('div'); host.className = 'toast-host'; host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
  const glyph = { ok: '✓', error: '✕', warn: '!', info: 'i' }[kind] || '✓';
  const el = document.createElement('div'); el.className = `toast toast-${kind}`; el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span class="toast-mark" aria-hidden="true">${glyph}</span><span class="toast-text"></span><button type="button" class="toast-x" aria-label="Dismiss">×</button>${detail ? '<span class="toast-detail"></span>' : ''}${action ? '<span class="toast-act"><button type="button"></button></span>' : ''}`;
  el.querySelector('.toast-text').textContent = text;
  if (detail) el.querySelector('.toast-detail').textContent = String(detail);
  host.appendChild(el); requestAnimationFrame(() => el.classList.add('in'));
  const gone = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 250); };
  const life = ms || (kind === 'error' ? 0 : kind === 'warn' ? 9000 : 4500);
  const timer = life ? setTimeout(gone, life) : null;
  el.querySelector('.toast-x').onclick = () => { if (timer) clearTimeout(timer); gone(); };
  if (action) { const b = el.querySelector('.toast-act button'); b.textContent = action.label; b.onclick = () => { if (timer) clearTimeout(timer); gone(); action.onClick?.(); }; }
  while (host.children.length > 4) host.firstChild.remove();
}
