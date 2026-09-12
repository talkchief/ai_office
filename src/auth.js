// Office access. A single office unlocks with its access code; a hosted office asks you to sign in, create an office,
// or accept an invitation (#invite=<token> in the address). Model keys live in Manage → Models (or with the platform).
import { HOSTED, USER, TURNSTILE } from './session.js';

export const officeReady = new Promise(resolve => {
  let released = false;
  const button = document.getElementById('claudeConnect');
  const dialog = document.createElement('dialog');
  dialog.id = 'claudeDialog';
  dialog.innerHTML = HOSTED ? `
    <div class="auth-head"><h2 id="authTitle">Sign in to your office</h2></div>
    <div class="auth-tabs" id="authTabs" hidden><button type="button" data-auth-tab="login" aria-pressed="true">Sign in</button><button type="button" data-auth-tab="register" aria-pressed="false">Create an office</button></div>
    <p id="authMessage" role="status" aria-live="polite">Checking access…</p>
    <div id="authTurnstile"${TURNSTILE ? '' : ' hidden'}></div>
    <form id="authLogin" hidden>
      <label for="loginEmail">Email</label><input id="loginEmail" type="email" autocomplete="username" required>
      <label for="loginPassword">Password</label><input id="loginPassword" type="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
    </form>
    <form id="authRegister" hidden>
      <label for="regOffice">Company or office name</label><input id="regOffice" maxlength="80" required>
      <label for="regName">Your name</label><input id="regName" maxlength="80" required>
      <label for="regEmail">Email</label><input id="regEmail" type="email" autocomplete="username" required>
      <label for="regPassword">Password</label><input id="regPassword" type="password" autocomplete="new-password" minlength="8" required>
      <p class="auth-help">You become the office’s owner. Invite your colleagues from Manage → Users & groups; the models are provided by the platform.</p>
      <button type="submit">Create the office</button>
    </form>
    <form id="authAccept" hidden>
      <p id="acceptWho" class="auth-help"></p>
      <label for="accName" id="accNameLabel">Your name</label><input id="accName" maxlength="80">
      <label for="accPassword" id="accPasswordLabel">Choose a password</label><input id="accPassword" type="password" autocomplete="new-password" minlength="8" required>
      <button type="submit">Join the office</button>
    </form>` : `
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
  async function api(path, data, method = data === undefined ? 'GET' : 'POST') {
    const response = await fetch('/api/auth/' + path, { method, ...(data !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}) });
    const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Could not reach the office.'); return value;
  }
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('cancel', event => event.preventDefault());

  /* ---------- Cloudflare Turnstile (hosted, when the platform saved its keys) ---------- */
  // One widget serves the sign-in, register and accept forms. Its token is single use, so every
  // attempt takes a fresh one and the widget is reset after a failure.
  let challengeToken = '', widget = null;
  if (TURNSTILE) {
    window.__aoTurnstile = () => {
      try {
        widget = window.turnstile.render('#authTurnstile', { sitekey: TURNSTILE, theme: 'auto', action: 'office-sign-in',
          callback: token => { challengeToken = token; }, 'expired-callback': () => { challengeToken = ''; }, 'error-callback': () => { challengeToken = ''; } });
      } catch { /* the forms still work; the server says if the check is required */ }
    };
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__aoTurnstile';
    script.async = script.defer = true;
    document.head.appendChild(script);
  }
  const resetChallenge = () => { challengeToken = ''; if (TURNSTILE && widget !== null) { try { window.turnstile.reset(widget); } catch {} } };
  // Every sign-in call carries the challenge; without Turnstile the field is simply absent.
  const withChallenge = data => (TURNSTILE ? { ...data, turnstile: challengeToken } : data);

  if (!HOSTED) {
    function render(value) {
      if (button) { button.textContent = value.locked ? 'Unlock office' : value.providersReady ? 'Models' : 'Add a model key'; button.classList.toggle('connected', !!value.providersReady); }
      $('officeUnlock').hidden = !value.locked;
      if (value.locked) { message(value.secure ? 'Enter your office access code to continue.' : 'Open this office over HTTPS to sign in.'); if (!dialog.open) dialog.showModal(); }
      else { if (dialog.open) dialog.close(); release(); }
    }
    button?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('office:open', { detail: 'models' })));
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
    return;
  }

  /* ---------- hosted: sign in, create an office, accept an invitation ---------- */
  let registrationOpen = true, secure = true;
  const hash = new URLSearchParams(location.hash.slice(1)), inviteToken = hash.get('invite');
  const show = tab => {
    for (const id of ['authLogin', 'authRegister', 'authAccept']) $(id).hidden = true;
    dialog.querySelectorAll('[data-auth-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.authTab === tab)));
    $('authTabs').hidden = tab === 'accept' || !registrationOpen;
    $('authTitle').textContent = tab === 'register' ? 'Create your office' : tab === 'accept' ? 'You are invited' : 'Sign in to your office';
    $(tab === 'register' ? 'authRegister' : tab === 'accept' ? 'authAccept' : 'authLogin').hidden = false;
    message(secure ? (tab === 'register' ? 'A company registers its office here.' : tab === 'accept' ? '' : 'Enter your email and password.') : 'Open this office over HTTPS to sign in.');
  };
  dialog.querySelectorAll('[data-auth-tab]').forEach(b => b.onclick = () => show(b.dataset.authTab));
  // The top-bar button is the person: their name opens the Profile (account, email intake); signed out, it opens the sign-in.
  if (button) { button.textContent = USER ? USER.name : 'Sign in'; button.classList.toggle('connected', !!USER); button.addEventListener('click', () => { if (USER) window.dispatchEvent(new CustomEvent('office:open', { detail: 'profile' })); else if (!dialog.open) { dialog.showModal(); show('login'); } }); }
  const submit = (form, fn) => $(form).addEventListener('submit', async event => {
    event.preventDefault(); const b = event.target.querySelector('button[type=submit]'); b.disabled = true;
    try { await fn(); history.replaceState(null, '', location.pathname + location.search); location.reload(); } catch (error) { message(error.message, true); resetChallenge(); b.disabled = false; }
  });
  submit('authLogin', () => api('login', withChallenge({ email: $('loginEmail').value.trim(), password: $('loginPassword').value })));
  submit('authRegister', () => api('register', withChallenge({ officeName: $('regOffice').value.trim(), name: $('regName').value.trim(), email: $('regEmail').value.trim(), password: $('regPassword').value })));
  submit('authAccept', () => api('accept', withChallenge({ token: inviteToken, name: $('accName').value.trim(), password: $('accPassword').value })));
  (async () => {
    try {
      const status = await api('status'); registrationOpen = !!status.registrationOpen; secure = !!status.secure;
      if (!status.locked && !inviteToken) { if (dialog.open) dialog.close(); release(); return; }
      if (!dialog.open) dialog.showModal();
      if (inviteToken) {
        try {
          const inv = await api('invite/' + encodeURIComponent(inviteToken));
          show('accept');
          $('acceptWho').textContent = `${inv.email} is invited to ${inv.office} as ${inv.role}.${inv.existing ? ' You already have an account: sign in with your password to join.' : ''}`;
          $('accName').hidden = $('accNameLabel').hidden = !!inv.existing; $('accPasswordLabel').textContent = inv.existing ? 'Your password' : 'Choose a password';
        } catch (error) {
          // A used or expired link while signed in (the reload after accepting): carry on into the office.
          if (!status.locked) { history.replaceState(null, '', location.pathname + location.search); if (dialog.open) dialog.close(); release(); return; }
          show('login'); message(error.message, true);
        }
      } else show('login');
    } catch (error) { if (!dialog.open) dialog.showModal(); show('login'); message(error.message, true); }
  })();
});
