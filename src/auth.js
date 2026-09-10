// Office access and Claude's official browser/code sign-in flow.
export const officeReady = location.protocol === 'file:' ? Promise.resolve() : new Promise(resolve => {
  let state = null, poll = null, released = false;
  const button = document.getElementById('claudeConnect');
  const dialog = document.createElement('dialog');
  dialog.id = 'claudeDialog';
  dialog.innerHTML = `
    <div class="auth-head"><h2 id="authTitle">Connect Claude</h2><button type="button" id="authClose" aria-label="Close">×</button></div>
    <p id="authMessage" role="status" aria-live="polite">Checking connection…</p>
    <form id="officeUnlock" hidden>
      <label for="officeKey">Office access code</label>
      <input id="officeKey" type="password" autocomplete="current-password" required>
      <p class="auth-help">Use the access code supplied with this office. It protects your account and tasks.</p>
      <button type="submit">Unlock office</button>
    </form>
    <div id="claudeActions" hidden>
      <p class="auth-help">Sign in with your Claude Pro, Max, Team or Enterprise account. Your password stays on Claude’s website.</p>
      <button type="button" id="claudeStart">Sign in with Claude</button>
      <div id="claudeLogin" hidden>
        <a id="claudeLink" class="auth-primary" target="_blank" rel="noopener noreferrer">Open Claude sign-in ↗</a>
        <p class="auth-help">Approve the connection in that tab. Copy the code Claude shows and paste it below.</p>
        <form id="claudeCodeForm">
          <label for="claudeCode">Code from Claude</label>
          <input id="claudeCode" type="password" autocomplete="off" spellcheck="false" required>
          <button type="submit" id="claudeSubmit">Finish connecting</button>
        </form>
      </div>
      <button type="button" id="claudeCancel" class="auth-secondary" hidden>Cancel sign-in</button>
      <button type="button" id="claudeDisconnect" class="auth-secondary" hidden>Disconnect Claude</button>
    </div>`;
  dialog.setAttribute('aria-labelledby', 'authTitle');
  document.body.appendChild(dialog);
  const $ = id => dialog.querySelector('#' + id);
  function message(text, error = false) { $('authMessage').textContent = text; $('authMessage').classList.toggle('auth-error', error); }
  function release() { if (!released) { released = true; resolve(); } }
  function show() { if (!dialog.open) dialog.showModal(); }
  async function api(path, data) {
    const response = await fetch('/api/auth/' + path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Could not reach the office.');
    return value;
  }
  function render(value) {
    state = value;
    const login = value.login || { state: 'idle' };
    const active = ['starting', 'waiting', 'verifying'].includes(login.state);
    button.textContent = value.locked ? 'Unlock office' : value.authenticated ? 'Claude connected' : 'Connect Claude';
    button.classList.toggle('connected', !!value.authenticated);
    $('authTitle').textContent = value.locked ? 'Unlock your office' : value.authenticated ? 'Claude is connected' : 'Connect Claude';
    $('officeUnlock').hidden = !value.locked;
    $('claudeActions').hidden = value.locked;
    $('authClose').hidden = value.locked;
    $('claudeStart').hidden = value.authenticated || active;
    $('claudeStart').disabled = !value.secure || value.cliInstalled === false;
    $('claudeLogin').hidden = !login.url || !active;
    if (login.url) $('claudeLink').href = login.url;
    $('claudeCancel').hidden = !active;
    $('claudeDisconnect').hidden = !value.authenticated || value.method === 'api-key';
    $('claudeSubmit').disabled = login.state !== 'waiting';
    $('claudeCode').disabled = login.state !== 'waiting';
    const text = value.locked ? 'Enter your office access code to continue.'
      : !value.secure ? 'Open this office over HTTPS to connect Claude securely.'
      : value.authenticated ? 'New tasks and agent chats will use your connected Claude account.'
      : value.cliInstalled === false ? 'Claude Code needs to be installed on the server.'
      : login.message || 'No Claude account is connected. Agents stay idle until you add real work.';
    message(text, ['error', 'expired'].includes(login.state));
    const mode = document.querySelector('.tp-mode');
    if (mode) { mode.hidden = false; mode.textContent = value.authenticated ? 'CONNECTED · CLAUDE' : 'CLAUDE NOT CONNECTED'; mode.classList.toggle('live', !!value.authenticated); }
    if (!active && poll) { clearInterval(poll); poll = null; }
    if (active && !poll) poll = setInterval(refresh, 1500);
    if (!value.locked) release();
  }
  async function refresh() {
    try {
      const wasAuthenticated = state?.authenticated;
      const value = await api('status');
      render(value);
      if (value.locked) show();
      if (wasAuthenticated === false && value.authenticated && value.login?.state === 'connected') {
        message('Claude is connected. Reloading your office…');
        setTimeout(() => location.reload(), 900);
      }
    } catch (error) { message(error.message, true); }
  }
  button.addEventListener('click', () => { show(); refresh(); });
  $('authClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('cancel', event => { if (state?.locked) event.preventDefault(); });
  $('officeUnlock').addEventListener('submit', async event => {
    event.preventDefault();
    try { await api('unlock', { key: $('officeKey').value }); $('officeKey').value = ''; location.reload(); }
    catch (error) { message(error.message, true); }
  });
  $('claudeStart').addEventListener('click', async () => {
    $('claudeStart').disabled = true;
    try { await api('login', {}); await refresh(); }
    catch (error) { message(error.message, true); $('claudeStart').disabled = false; }
  });
  $('claudeCodeForm').addEventListener('submit', async event => {
    event.preventDefault();
    const code = $('claudeCode').value; $('claudeCode').value = ''; $('claudeSubmit').disabled = true;
    try { await api('code', { id: state.login.id, code }); await refresh(); }
    catch (error) { message(error.message, true); $('claudeSubmit').disabled = false; }
  });
  $('claudeCancel').addEventListener('click', async () => {
    try { await api('cancel', {}); await refresh(); } catch (error) { message(error.message, true); }
  });
  $('claudeDisconnect').addEventListener('click', async () => {
    try { await api('logout', {}); location.reload(); } catch (error) { message(error.message, true); }
  });
  (async () => {
    // A private access link exchanges its fragment for an HttpOnly session cookie.
    // The access code is removed from the address before any other navigation.
    const hash = new URLSearchParams(location.hash.slice(1));
    const key = hash.get('access');
    if (key) {
      hash.delete('access'); history.replaceState(null, '', location.pathname + location.search + (hash.size ? '#' + hash.toString() : ''));
      try { await api('unlock', { key }); location.reload(); return; } catch (error) { show(); message(error.message, true); }
    }
    await refresh();
  })();
});
