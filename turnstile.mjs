// Cloudflare Turnstile on the sign-in forms. The platform administrator pastes two keys in
// Platform → Sign-in protection: the site key, which is public and goes into the page, and the
// secret key, which never leaves this server. With both set, registering, signing in and accepting
// an invitation carry a challenge token that is checked with Cloudflare before a password is so much
// as looked at. With either key unset nothing changes — the forms work as they always did.
//
// The token is checked, never stored, and the secret key is never logged or sent to the page.
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const fail = (message, status = 403) => { throw Object.assign(new Error(message), { status }); };

export function createTurnstile({ keys = () => ({}), fetchImpl = null, verifyUrl = VERIFY_URL, timeoutMs = 6000 } = {}) {
  const conf = () => { const k = keys() || {}; return { siteKey: String(k.siteKey || ''), secretKey: String(k.secretKey || '') }; };
  const on = () => { const { siteKey, secretKey } = conf(); return !!(siteKey && secretKey); };
  return {
    /** The public half, for the page. Empty while Turnstile is off. */
    siteKey: () => (on() ? conf().siteKey : ''),
    enabled: on,
    /** Passes quietly, or throws with a sentence the form can show. A no-op while the keys are unset. */
    async check(token) {
      if (!on()) return { skipped: true };
      const response = String(token || '').trim();
      if (!response) fail('The sign-in check did not finish. Reload the page and try again.');
      if (response.length > 2048) fail('That sign-in check is not valid. Reload the page and try again.');
      const body = new URLSearchParams({ secret: conf().secretKey, response });
      let answer = null;
      try {
        const call = fetchImpl || fetch;
        const result = await call(verifyUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString(), signal: AbortSignal.timeout(timeoutMs) });
        answer = await result.json();
      } catch {
        // Cloudflare unreachable: the door stays shut rather than open. Clearing the keys in the panel turns the check off.
        fail('The sign-in check could not be reached just now. Try again in a moment.', 503);
      }
      if (!answer || answer.success !== true) fail('The sign-in check did not pass. Reload the page and try again.');
      return { ok: true };
    },
  };
}
