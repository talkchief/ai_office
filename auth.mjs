// Delegate account authentication and credential storage to the official Claude CLI.
import { createHmac, timingSafeEqual } from 'node:crypto';

const same = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
};

export function createOfficeAccess(key = '') {
  const signature = value => createHmac('sha256', key).update(value).digest('hex');
  return {
    required: !!key,
    matches: candidate => !!key && same(candidate, key),
    cookie(secure = false) {
      const expires = String(Date.now() + 7 * 86400000);
      return `ao_session=${expires}.${signature(expires)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure ? '; Secure' : ''}`;
    },
    allowed(req) {
      if (!key) return true;
      const value = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('ao_session='))?.slice(11) || '';
      const [expires, sig] = value.split('.');
      return /^\d+$/.test(expires || '') && +expires > Date.now() && same(signature(expires), sig);
    },
  };
}

// Hosted mode: the account session. Lax so a link in a mail (or a later OAuth redirect) carries the cookie; sameOrigin still guards every mutation.
export const sessionCookie = (id, { secure = false, maxAge = 604800 } = {}) => `ao_session=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
export const clearCookie = ({ secure = false } = {}) => `ao_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
export const cookieValue = (req, name = 'ao_session') => String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(name + '='))?.slice(name.length + 1) || '';

export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return req.headers['sec-fetch-site'] !== 'cross-site';
  try { return new URL(origin).host === req.headers.host && ['http:', 'https:'].includes(new URL(origin).protocol); }
  catch { return false; }
}
