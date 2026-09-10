// A toast: a short confirmation or error that slides in at the bottom of the page and goes away on its own.
let host = null;
export function toast(message, { kind = 'ok', ms } = {}) {
  const text = String(message || '').trim(); if (!text || typeof document === 'undefined') return;
  if (!host) { host = document.createElement('div'); host.className = 'toast-host'; host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
  const el = document.createElement('div'); el.className = `toast toast-${kind}`; el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span class="toast-mark" aria-hidden="true">${kind === 'error' ? '!' : '✓'}</span><span class="toast-text"></span>`;
  el.querySelector('.toast-text').textContent = text;
  host.appendChild(el); requestAnimationFrame(() => el.classList.add('in'));
  const life = ms || (kind === 'error' ? 7000 : 3500);
  const gone = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 250); };
  const timer = setTimeout(gone, life); el.onclick = () => { clearTimeout(timer); gone(); };
  while (host.children.length > 4) host.firstChild.remove();
}
