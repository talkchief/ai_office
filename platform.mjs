// What every hosted office inherits and cannot change, kept by the platform administrator in the Platform panel:
// the model providers, keys and activated models; the limits; who may register; the public address; how long an idle
// office stays loaded; and the mail set-up (provider, key, domain, webhook secret). Lives in AO_PLATFORM_DIR (default
// data/platform/): platform.json (0600, it holds the mail secrets) and providers.json (the one ModelRegistry).
// Environment variables only seed platform.json the first time it is written; from then on the panel is the truth.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ModelRegistry } from './models.mjs';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
export const DEFAULT_LIMITS = { maxTeams: 10, maxMembersPerTeam: 7 };
export const LIMIT_RANGES = { maxTeams: [1, 50], maxMembersPerTeam: [2, 20] };
export const TENANT_RANGES = { idleMinutes: [1, 1440, 30], maxLoaded: [1, 500, 50] };
export const REGISTRATIONS = ['open', 'invite'];
export const MAIL_PROVIDERS = ['postmark', 'mailgun'];
export const MAIL_REGIONS = ['us', 'eu'];
const email = value => String(value || '').trim().toLowerCase();
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const secret = (value, previous, clear, label) => {
  if (clear) return '';
  const v = typeof value === 'string' && value.trim() ? value.trim() : previous || '';
  if (/[\r\n\s]/.test(v) || v.length > 4096) fail(`${label}: invalid value.`);
  return v;
};

export function validatePlatform(input = {}, previous = {}) {
  const limits = {};
  for (const [key, [min, max]] of Object.entries(LIMIT_RANGES)) {
    const raw = input.limits?.[key] ?? previous.limits?.[key] ?? DEFAULT_LIMITS[key], n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) fail(`${key === 'maxTeams' ? 'The maximum number of AI teams per office' : 'The maximum number of agents per AI team'} must be a whole number from ${min} to ${max}.`);
    limits[key] = n;
  }
  const registration = input.registration ?? previous.registration ?? 'open';
  if (!REGISTRATIONS.includes(registration)) fail('Registration must be open or invite.');
  const adminEmails = [...new Set((Array.isArray(input.adminEmails) ? input.adminEmails : previous.adminEmails || []).map(email).filter(emailOk))].slice(0, 50);
  // The address links in mail and invitations point to.
  let publicOrigin = text(input.publicOrigin ?? previous.publicOrigin ?? '', 300);
  if (publicOrigin) { let u; try { u = new URL(publicOrigin); } catch { fail('The public address must be a full URL such as https://office.example.com.'); } if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) fail('The public address must be http(s) without credentials.'); publicOrigin = u.origin; }
  const tenants = {};
  for (const [key, [min, max, dflt]] of Object.entries(TENANT_RANGES)) {
    const n = Number(input.tenants?.[key] ?? previous.tenants?.[key] ?? dflt);
    if (!Number.isInteger(n) || n < min || n > max) fail(`${key === 'idleMinutes' ? 'Minutes before an idle office is put away' : 'Offices loaded at once'} must be a whole number from ${min} to ${max}.`);
    tenants[key] = n;
  }
  const pm = previous.mail || {}, im = input.mail && typeof input.mail === 'object' ? input.mail : {};
  const provider = String(im.provider ?? pm.provider ?? 'postmark').toLowerCase();
  if (!MAIL_PROVIDERS.includes(provider)) fail('The mail provider must be postmark or mailgun.');
  const region = String(im.region ?? pm.region ?? 'us').toLowerCase(); if (!MAIL_REGIONS.includes(region)) fail('The Mailgun region must be us or eu.');
  const domain = text(im.domain ?? pm.domain ?? '', 253).toLowerCase().replace(/^@/, '');
  if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) fail('The mail domain must be a host name such as mail.example.com.');
  const from = text(im.from ?? pm.from ?? '', 254).toLowerCase();
  if (from && !emailOk(from)) fail('The From address must be a valid email address.');
  const mail = { provider, region, domain, from, apiKey: secret(im.apiKey, pm.apiKey, im.clearApiKey, 'The mail API key'), webhookSecret: secret(im.webhookSecret, pm.webhookSecret, im.clearWebhookSecret, 'The webhook secret'), dryRun: typeof im.dryRun === 'boolean' ? im.dryRun : !!pm.dryRun };
  // Cloudflare Turnstile on the sign-in forms: the site key is public (it goes into the page), the secret key never leaves the server.
  const pt = previous.turnstile || {}, it = input.turnstile && typeof input.turnstile === 'object' ? input.turnstile : {};
  const siteKey = it.clearKeys ? '' : text(it.siteKey ?? pt.siteKey ?? '', 200);
  if (/[\s]/.test(siteKey)) fail('The Turnstile site key cannot contain spaces.');
  const turnstile = { siteKey, secretKey: secret(it.secretKey, pt.secretKey, it.clearKeys || it.clearSecretKey, 'The Turnstile secret key') };
  // Whether offices on this platform may run code in sandboxes: on unless the administrator turns it off. It is off per team, not
  // here: an office gives the tool to the teams and people that need it.
  const sandbox = { allowed: typeof input.sandbox?.allowed === 'boolean' ? input.sandbox.allowed : previous.sandbox?.allowed !== false };
  return { version: 3, limits, registration, adminEmails, publicOrigin, tenants, mail, turnstile, sandbox };
}

// The first platform.json takes what the deployment environment says; the panel takes over from there.
export function seedFromEnv(env = {}) {
  const seed = { adminEmails: String(env.AO_PLATFORM_ADMINS || '').split(',').map(s => s.trim()).filter(Boolean), publicOrigin: env.AO_PUBLIC_ORIGIN || '', tenants: {}, mail: {} };
  if (REGISTRATIONS.includes(env.AO_REGISTRATION)) seed.registration = env.AO_REGISTRATION;
  if (env.AO_TENANT_IDLE_MINUTES) seed.tenants.idleMinutes = Number(env.AO_TENANT_IDLE_MINUTES);
  if (env.AO_TENANTS_MAX_LOADED) seed.tenants.maxLoaded = Number(env.AO_TENANTS_MAX_LOADED);
  if (env.AO_MAIL_PROVIDER) seed.mail.provider = env.AO_MAIL_PROVIDER;
  if (env.AO_MAIL_REGION) seed.mail.region = env.AO_MAIL_REGION;
  if (env.AO_MAIL_DOMAIN) seed.mail.domain = env.AO_MAIL_DOMAIN;
  if (env.AO_MAIL_FROM) seed.mail.from = env.AO_MAIL_FROM;
  if (env.AO_MAIL_API_KEY) seed.mail.apiKey = env.AO_MAIL_API_KEY;
  if (env.AO_MAIL_WEBHOOK_SECRET) seed.mail.webhookSecret = env.AO_MAIL_WEBHOOK_SECRET;
  if (env.AO_MAIL_DRY_RUN === '1') seed.mail.dryRun = true;
  seed.turnstile = {};
  if (env.AO_TURNSTILE_SITE_KEY) seed.turnstile.siteKey = env.AO_TURNSTILE_SITE_KEY;
  if (env.AO_TURNSTILE_SECRET_KEY) seed.turnstile.secretKey = env.AO_TURNSTILE_SECRET_KEY;
  return seed;
}

export class PlatformStore {
  constructor({ dir, env = process.env, adminEmails = [], registration = null }) {
    fs.mkdirSync(dir, { recursive: true });
    this.dir = dir; this.file = path.join(dir, 'platform.json');
    let stored = null; try { stored = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    if (stored) {
      // Version 3 made sandboxes allowed by default. A file written before took "not allowed" as the default the day the switch arrived,
      // not as the administrator's choice, so it takes the new default once; from version 3 the stored value is the choice.
      if ((Number(stored.version) || 0) < 3) delete stored.sandbox;
      // An existing file is the truth; the administrator emails named in the environment are always allowed in.
      this.value = validatePlatform({ adminEmails: [...(stored.adminEmails || []), ...adminEmails], ...(registration ? { registration } : {}) }, stored);
    } else {
      const seed = seedFromEnv(env); seed.adminEmails = [...seed.adminEmails, ...adminEmails]; if (registration) seed.registration = registration;
      this.value = validatePlatform(seed, {});
    }
    this.persist();
    this.models = new ModelRegistry({ dataDir: dir, env });
    this.listeners = new Set();
  }
  persist() { fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.value, null, 2), { mode: 0o600 }); fs.renameSync(this.file + '.tmp', this.file); try { fs.chmodSync(this.file, 0o600); } catch {} }
  /** The whole configuration, secrets included: for the server only. */
  get() { return structuredClone(this.value); }
  /** What the panel may see: never a secret, only whether one is set. */
  summary() {
    const { mail, turnstile, ...rest } = this.get(); const { apiKey, webhookSecret, ...m } = mail;
    return { ...rest, mail: { ...m, hasApiKey: !!apiKey, hasWebhookSecret: !!webhookSecret, enabled: !!apiKey || !!mail.dryRun },
      turnstile: { siteKey: turnstile.siteKey, hasSecretKey: !!turnstile.secretKey, enabled: !!(turnstile.siteKey && turnstile.secretKey) } };
  }
  limits() { return { ...this.value.limits }; }
  update(input) { this.value = validatePlatform(input, this.value); this.persist(); for (const fn of this.listeners) { try { fn(this.get()); } catch (error) { console.warn('platform change:', error.message); } } return this.summary(); }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  isAdmin(user) { return !!user && (!!user.platformAdmin || this.value.adminEmails.includes(email(user.email))); }
  registrationOpen() { return this.value.registration === 'open'; }
  /** The Turnstile keys, for the sign-in check. The site key alone is safe to put in the page. */
  turnstile() { return { ...this.value.turnstile }; }
  sandboxAllowed() { return !!this.value.sandbox?.allowed; }
  publicOrigin(fallback = '') { return this.value.publicOrigin || fallback; }
  newWebhookSecret() { return crypto.randomBytes(24).toString('base64url'); }
}
