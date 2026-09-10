// Office access: the office unlocks with its access code. Model keys live in Manage → Models.
export const officeReady = new Promise(resolve => {
  let released = false;
  const button = document.getElementById('claudeConnect');
  const dialog = document.createElement('dialog');
  dialog.id = 'claudeDialog';
  dialog.innerHTML = `
    <div class="auth-head"><h2 id="authTitle">Unlock your office</h2></div>
    <p id="authMessage" role="status" aria-live="polite">Checking access…</p>
    <form id="officeUnlock" hidden>
      <label for="officeKey">Office access code</label>
      <input id="officeKey" type="password" autocomplete="current-password" required>
      <p class="auth-help">Use the access code supplied with this office. It protects your company’s tasks and connectors.</p>
      <button type="submit">Unlock office</button>
    </form>`;
  dialog.setAttribute('aria-labelledby', 'authTitle');
  document.body.appendChild(dialog);
  const $ = id => dialog.querySelector('#' + id);
  const message = (text, error = false) => { $('authMessage').textContent = text; $('authMessage').classList.toggle('auth-error', error); };
  const release = () => { if (!released) { released = true; resolve(); } };
  async function api(path, data) {
    const response = await fetch('/api/auth/' + path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Could not reach the office.'); return value;
  }
  function render(value) {
    if (button) { button.textContent = value.locked ? 'Unlock office' : value.providersReady ? 'Models' : 'Add a model key'; button.classList.toggle('connected', !!value.providersReady); }
    $('officeUnlock').hidden = !value.locked;
    if (value.locked) { message(value.secure ? 'Enter your office access code to continue.' : 'Open this office over HTTPS to sign in.'); if (!dialog.open) dialog.showModal(); }
    else { if (dialog.open) dialog.close(); release(); }
  }
  button?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('office:open', { detail: 'models' })));
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('cancel', event => event.preventDefault());
  $('officeUnlock').addEventListener('submit', async event => {
    event.preventDefault();
    try { await api('unlock', { key: $('officeKey').value }); $('officeKey').value = ''; location.reload(); } catch (error) { message(error.message, true); }
  });
  (async () => {
    // A private access link exchanges its fragment for an HttpOnly session cookie, then removes it from the address.
    const hash = new URLSearchParams(location.hash.slice(1)), key = hash.get('access');
    if (key) {
      hash.delete('access'); history.replaceState(null, '', location.pathname + location.search + (hash.size ? '#' + hash.toString() : ''));
      try { await api('unlock', { key }); location.reload(); return; } catch (error) { dialog.showModal(); message(error.message, true); }
    }
    try { render(await api('status')); } catch (error) { if (!dialog.open) dialog.showModal(); message(error.message, true); }
  })();
});
