import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PlatformStore, validatePlatform, seedFromEnv } from '../platform.mjs';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-platform-'));

test('platform limits are bounded and refused with a sentence; admin emails and registration persist', () => {
  const dir = temp();
  try {
    const platform = new PlatformStore({ dir, env: {}, adminEmails: ['Admin@Platform.test'] });
    assert.deepEqual(platform.limits(), { maxTeams: 10, maxMembersPerTeam: 7 });
    assert.equal(platform.registrationOpen(), true);
    assert.ok(platform.isAdmin({ email: 'admin@platform.test' })); assert.ok(!platform.isAdmin({ email: 'someone@else.test' })); assert.ok(platform.isAdmin({ email: 'x@y.test', platformAdmin: true }));
    assert.throws(() => platform.update({ limits: { maxTeams: 0 } }), /1 to 50/);
    assert.throws(() => platform.update({ limits: { maxMembersPerTeam: 21 } }), /2 to 20/);
    assert.throws(() => validatePlatform({ registration: 'anyone' }), /open or invite/);
    platform.update({ limits: { maxTeams: 2 }, registration: 'invite', adminEmails: ['a@b.test', 'not-an-email'] });
    const again = new PlatformStore({ dir, env: {} });
    assert.deepEqual(again.limits(), { maxTeams: 2, maxMembersPerTeam: 7 }); assert.equal(again.registrationOpen(), false); assert.deepEqual(again.get().adminEmails, ['a@b.test']);
    assert.deepEqual(again.get().tenants, { idleMinutes: 30, maxLoaded: 50 }); assert.equal(again.get().mail.provider, 'postmark'); assert.equal(again.summary().mail.enabled, false);
    assert.ok(fs.existsSync(path.join(dir, 'providers.json')) || again.models.value.providers.length >= 1, 'the platform has the one model registry');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('sandboxes are allowed on a platform by default, the administrator can turn them off, and an older file takes the new default once', () => {
  const dir = temp();
  try {
    const platform = new PlatformStore({ dir, env: {} });
    assert.equal(platform.sandboxAllowed(), true, 'on by default: the grant that is off by default is per team');
    assert.deepEqual(platform.summary().sandbox, { allowed: true }); assert.equal(platform.get().version, 3);
    platform.update({ sandbox: { allowed: false } });
    assert.equal(new PlatformStore({ dir, env: {} }).sandboxAllowed(), false, 'the administrator’s choice persists');
    platform.update({ limits: { maxTeams: 3 } }); assert.equal(new PlatformStore({ dir, env: {} }).sandboxAllowed(), false, 'another change leaves it alone');
    // A version 2 file stored "not allowed" as the old default, not as a choice.
    const file = path.join(dir, 'platform.json'), old = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...old, version: 2, sandbox: { allowed: false } }));
    const upgraded = new PlatformStore({ dir, env: {} });
    assert.equal(upgraded.sandboxAllowed(), true); assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 3);
    assert.deepEqual(upgraded.limits(), { maxTeams: 3, maxMembersPerTeam: 7 }, 'nothing else in the file changes');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the mail set-up lives in the platform file: secrets are write-only and masked, the environment only seeds the first file', () => {
  const dir = temp();
  try {
    const env = { AO_MAIL_PROVIDER: 'mailgun', AO_MAIL_API_KEY: 'key-from-env', AO_MAIL_DOMAIN: 'Mail.Example.com', AO_MAIL_WEBHOOK_SECRET: 'hook-from-env', AO_PUBLIC_ORIGIN: 'https://office.example.com/some/path', AO_TENANT_IDLE_MINUTES: '5', AO_REGISTRATION: 'invite' };
    assert.equal(seedFromEnv(env).mail.apiKey, 'key-from-env');
    const platform = new PlatformStore({ dir, env });
    const c = platform.get();
    assert.equal(c.mail.provider, 'mailgun'); assert.equal(c.mail.apiKey, 'key-from-env'); assert.equal(c.mail.domain, 'mail.example.com'); assert.equal(c.publicOrigin, 'https://office.example.com'); assert.equal(c.tenants.idleMinutes, 5); assert.equal(c.registration, 'invite');
    const seen = platform.summary(); assert.equal(seen.mail.apiKey, undefined); assert.equal(seen.mail.webhookSecret, undefined); assert.equal(seen.mail.hasApiKey, true); assert.equal(seen.mail.hasWebhookSecret, true); assert.equal(seen.mail.enabled, true);
    assert.ok(!JSON.stringify(seen).includes('key-from-env'), 'no secret in the summary');
    // The panel is the truth from now on: a blank key keeps the stored one, clearApiKey removes it, the environment no longer matters.
    let changes = 0; platform.onChange(() => changes++);
    platform.update({ mail: { provider: 'postmark', apiKey: '', domain: 'mail.acme.test' } });
    assert.equal(platform.get().mail.apiKey, 'key-from-env'); assert.equal(platform.get().mail.provider, 'postmark'); assert.equal(changes, 1);
    platform.update({ mail: { clearApiKey: true, dryRun: true } }); assert.equal(platform.get().mail.apiKey, ''); assert.equal(platform.summary().mail.enabled, true, 'dry run counts as on');
    assert.throws(() => platform.update({ mail: { provider: 'pigeon' } }), /postmark or mailgun/);
    assert.throws(() => platform.update({ mail: { domain: 'not a domain' } }), /host name/);
    assert.throws(() => platform.update({ mail: { from: 'nobody' } }), /valid email/);
    assert.throws(() => platform.update({ publicOrigin: 'office.example.com' }), /full URL/);
    assert.throws(() => platform.update({ tenants: { idleMinutes: 0 } }), /1 to 1440/);
    const reopened = new PlatformStore({ dir, env: { ...env, AO_MAIL_API_KEY: 'a-newer-env-key', AO_MAIL_DOMAIN: 'other.example.com' } });
    assert.equal(reopened.get().mail.apiKey, '', 'an existing file is not overwritten by the environment'); assert.equal(reopened.get().mail.domain, 'mail.acme.test');
    assert.equal((fs.statSync(path.join(dir, 'platform.json')).mode & 0o777) <= 0o666, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an office store honours the platform limits: a third team is refused when the limit is two, and the number is in the sentence', () => {
  const dir = temp();
  try {
    const store = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents, limits: { maxTeams: 2, maxMembersPerTeam: 3 } });
    assert.equal(store.get().teams.length, 6, 'a shipped office with six teams still loads under a lower limit');
    const config = store.get(); config.teams.push({ ...config.teams[0], id: 'seventh', name: 'Seventh', lead: 'ghost' });
    assert.throws(() => store.update(config), /1–2 teams/);
    const trimmed = store.get(); const keep = new Set(['emails', 'sales']);
    trimmed.teams = trimmed.teams.filter(t => keep.has(t.id)); trimmed.agents = trimmed.agents.filter(a => keep.has(a.department));
    assert.throws(() => store.update(trimmed), /maximum of 3 agents \(a lead and 2 specialists\)/, 'the per-team limit names its number');
    const loose = new OfficeStore({ dataDir: temp(), initialAgents: loadRoster().agents, limits: { maxTeams: 'many', maxMembersPerTeam: -1 } });
    assert.deepEqual(loose.limits, { maxTeams: 10, maxMembersPerTeam: 7 }, 'bad limit values fall back to the defaults');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Cloudflare Turnstile: the secret key is write-only and masked, the site key is public, and the check gates the sign-in forms', async () => {
  const dir = temp();
  try {
    const platform = new PlatformStore({ dir, env: { AO_TURNSTILE_SITE_KEY: '0xSITE', AO_TURNSTILE_SECRET_KEY: '0xSECRET' } });
    // The environment seeds the first file; the panel takes over from there.
    assert.deepEqual(platform.turnstile(), { siteKey: '0xSITE', secretKey: '0xSECRET' });
    const summary = platform.summary();
    assert.equal(summary.turnstile.siteKey, '0xSITE', 'the site key is public: the page needs it');
    assert.equal(summary.turnstile.hasSecretKey, true); assert.equal(summary.turnstile.enabled, true);
    assert.equal('secretKey' in summary.turnstile, false, 'the secret key never reaches the panel');
    assert.ok(!JSON.stringify(summary).includes('0xSECRET'));
    // Saving without touching the secret keeps it; the file on disk is the only place it lives.
    platform.update({ turnstile: { siteKey: '0xSITE2' } });
    assert.deepEqual(platform.turnstile(), { siteKey: '0xSITE2', secretKey: '0xSECRET' });
    assert.throws(() => platform.update({ turnstile: { siteKey: 'has space' } }), /cannot contain spaces/);
    // The check itself: on only with both keys, one call to Cloudflare, fail closed.
    const { createTurnstile } = await import('../turnstile.mjs');
    const calls = [];
    const stub = async (url, options) => { calls.push([url, options.body]); return { json: async () => ({ success: !String(options.body).includes('response=bad') }) }; };
    let keys = { siteKey: '', secretKey: '' };
    const check = createTurnstile({ keys: () => keys, fetchImpl: stub });
    assert.equal(check.enabled(), false); assert.equal(check.siteKey(), '');
    assert.deepEqual(await check.check(''), { skipped: true }, 'unconfigured: the forms work as before');
    keys = { siteKey: '0xSITE', secretKey: '0xSECRET' };
    assert.equal(check.enabled(), true); assert.equal(check.siteKey(), '0xSITE');
    await assert.rejects(() => check.check(''), /did not finish/, 'enabled and no token: refused');
    await assert.rejects(() => check.check('bad'), /did not pass/);
    assert.deepEqual(await check.check('good'), { ok: true });
    assert.equal(calls.length, 2); assert.ok(calls[1][1].includes('secret=0xSECRET') && calls[1][1].includes('response=good'));
    const broken = createTurnstile({ keys: () => keys, fetchImpl: async () => { throw new Error('network'); } });
    await assert.rejects(() => broken.check('good'), /could not be reached/, 'Cloudflare unreachable: the door stays shut');
    // Turning it off forgets both keys.
    platform.update({ turnstile: { clearKeys: true } });
    assert.deepEqual(platform.turnstile(), { siteKey: '', secretKey: '' });
    assert.equal(platform.summary().turnstile.enabled, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
