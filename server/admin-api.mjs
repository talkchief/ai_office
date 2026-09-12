// The platform admin panel: what every hosted office inherits (models, keys, limits, registration) and the offices themselves.
// Mounted for platform administrators only; serve.mjs refuses everyone else before a handler runs.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readJsonBody as body } from '../http-body.mjs';
import { httpError } from './routes.mjs';
import { registerProviderRoutes } from './providers-api.mjs';

export function registerAdminApi(router, { accounts, platform, registry, mail = { mailer: null }, publicOrigin = () => '' }) {
  const log = (user, summary) => { try { accounts.adminLog(user?.email || 'platform', summary); } catch {} };
  // What an office has spent, for billing. Input, output and cached are priced apart, so they are counted apart; a task
  // from before the office recorded the split carries a total and no breakdown. An idle office is read straight from its
  // own database rather than loaded: a bill that only counts the offices that happen to be awake is not a bill.
  const ZERO = () => ({ input: 0, output: 0, cached: 0, total: 0, tasks: 0 });
  const addJob = (into, j) => { const u = j.usage || { total: j.tokens || 0 }; into.input += u.input || 0; into.output += u.output || 0; into.cached += u.cached || 0; into.total += u.total || 0; into.tasks += 1; return into; };
  // What the office actually spent: the ledger counts the calls that belong to no task too — the sizing before a task,
  // a question, a chat, planning a project. A rollup over tasks alone cannot see them. Null when an office predates it.
  const ledgerOf = (tenantId, instance) => {
    if (instance) { try { return instance.engine.usageSince(0); } catch { return null; } }
    try {
      const file = path.join(registry.dirs(tenantId).data, 'workflows.sqlite');
      if (!fs.existsSync(file)) return null;
      const db = new DatabaseSync(file, { readOnly: true });
      try { const r = db.prepare('SELECT SUM(input) i, SUM(output) o, SUM(cached) c, SUM(total) t, COUNT(*) n FROM office_usage').get(); return { input: r?.i || 0, output: r?.o || 0, cached: r?.c || 0, total: r?.t || 0, calls: r?.n || 0 }; }
      finally { db.close(); }
    } catch { return null; }
  };
  const usageOf = (tenantId, jobs) => {
    if (jobs) return jobs.reduce(addJob, ZERO());
    try {
      const file = path.join(registry.dirs(tenantId).data, 'workflows.sqlite');
      if (!fs.existsSync(file)) return ZERO();
      const db = new DatabaseSync(file, { readOnly: true });
      try { return db.prepare('SELECT body FROM office_jobs').all().reduce((acc, r) => { try { return addJob(acc, JSON.parse(r.body)); } catch { return acc; } }, ZERO()); }
      finally { db.close(); }
    } catch { return ZERO(); }
  };
  // The configuration without its secrets, plus what the administrator needs to copy into the mail provider.
  const configOut = () => { const c = platform.summary(); return { ...c, admins: accounts.platformAdmins().map(u => u.email), webhooks: { postmark: `${publicOrigin()}/api/mail/inbound/postmark`, mailgun: `${publicOrigin()}/api/mail/inbound/mailgun` }, secretSuggestion: platform.newWebhookSecret() }; };
  router.on('GET', '/api/admin/config', () => configOut());
  router.on('PUT', '/api/admin/config', async ({ req, user }) => {
    const before = platform.summary(), next = platform.update(await body(req, 256 * 1024));
    log(user, `Platform config: limits ${next.limits.maxTeams} teams × ${next.limits.maxMembersPerTeam} agents, registration ${next.registration}, ${next.adminEmails.length} admin emails, mail ${next.mail.provider}${next.mail.domain ? ' @' + next.mail.domain : ''}${next.mail.hasApiKey ? ' (key set)' : ''}${next.mail.dryRun ? ' dry run' : ''}, sign-in check ${next.turnstile.enabled ? 'on (Turnstile)' : 'off'}`);
    // Limits apply to the next change in every loaded office; the number itself is read from the office store.
    for (const id of registry.loaded()) { const instance = registry.peek(id); if (instance) { instance.office.limits = { ...instance.office.limits, ...next.limits }; instance.bus.publish('office.updated', { area: 'limits', limits: next.limits }); } }
    return { ...configOut(), before };
  });
  // A test message to the administrator's own address, with the mail set-up as saved.
  router.on('POST', '/api/admin/mail/test', async ({ user }) => {
    if (!mail.mailer?.enabled) throw httpError('Mail is not configured yet: save a provider key (or switch on the dry run) first.', 503);
    const r = await mail.mailer.send({ to: user.email, subject: 'Mail from your Agents Office platform works', text: `This message was sent with the platform's mail settings (${mail.mailer.provider}${mail.mailer.domain ? ', ' + mail.mailer.domain : ''}). Inbound mail arrives through the webhook shown in the Platform panel.`, tag: 'platform-test' });
    log(user, 'Sent a platform test mail'); return { ok: true, to: user.email, dryRun: !!r.dryRun, outbox: mail.mailer.outbox || null };
  });
  registerProviderRoutes(router, platform.models, '/api/admin/providers', {
    record: entry => log(null, entry.summary),
    onChange: () => { for (const id of registry.loaded()) registry.peek(id)?.bus.publish('office.updated', { area: 'models' }); },
  });
  router.on('GET', '/api/admin/tenants', ({ url }) => ({ tenants: accounts.tenants({ q: url.searchParams.get('q') || '' }).map(t => {
    const owner = accounts.user(t.ownerId), stats = accounts.tenantStats(t.id), status = registry.status(t.id), instance = registry.peek(t.id);
    const jobs = instance ? instance.engine.list() : null, usage = usageOf(t.id, jobs);
    return { id: t.id, name: t.name, slug: t.slug, owner: owner ? { id: owner.id, email: owner.email, name: owner.name } : null, users: stats.users, groups: stats.groups, createdAt: t.createdAt, suspendedAt: t.suspendedAt,
      loaded: status.loaded, running: status.running || 0, openTasks: jobs ? jobs.filter(j => !['done', 'cancelled', 'backlog'].includes(j.state)).length : null, tasks: jobs ? jobs.length : null,
      tokens: usage.total, usage, ledger: ledgerOf(t.id, instance), teams: instance ? instance.office.get().teams.length : null };
  }) }));
  // A new office when registration is closed: the administrator names it and its owner. An address that
  // already has an account becomes the owner at once; a new one gets an invitation link (mailed too, if
  // the platform can send), and the office is built when they accept.
  router.on('POST', '/api/admin/tenants', async ({ req, user }) => {
    const input = await body(req);
    const name = String(input.name ?? input.officeName ?? '').trim(), email = String(input.ownerEmail ?? input.email ?? '').trim();
    if (name.length < 2) throw httpError('Name the office you are creating.');
    if (!email) throw httpError('Give the address of the person who will own it.');
    const existing = accounts.userByEmail(email);
    if (existing) {
      if (accounts.tenantsOf(existing.id).length) throw httpError(`${existing.email} already owns or belongs to an office. Invite them into it from that office instead.`, 409);
      const tenant = accounts.createTenant({ name, ownerId: existing.id });
      await registry.provision(tenant);
      log(user, `Created office ${tenant.name} (${tenant.slug}) for ${existing.email}, who already had an account`);
      return { $status: 201, body: { tenant, owner: { id: existing.id, email: existing.email, name: existing.name }, ready: true, invite: null } };
    }
    const inv = accounts.inviteOffice({ officeName: name, email, invitedBy: user?.id || null });
    const link = `${publicOrigin()}/#invite=${inv.token}`;
    let sent = false;
    if (mail.mailer?.enabled) {
      try {
        await mail.mailer.send({ to: inv.email, subject: `Your office “${inv.officeName}” is ready to open`,
          text: `You have been invited to open ${inv.officeName}.\n\nOpen this link, choose a password, and the office is built for you:\n${link}\n\nThe link works once and expires in seven days.`, tag: 'office-invite' });
        sent = true;
      } catch (error) { log(user, `Could not mail the office invitation to ${inv.email}: ${error.message}`); }
    }
    log(user, `Invited ${inv.email} to open office “${inv.officeName}”${sent ? ' (mailed)' : ''}`);
    return { $status: 201, body: { tenant: null, ready: false, invite: { email: inv.email, officeName: inv.officeName, expiresAt: inv.expiresAt, link, sent } } };
  });
  router.on('GET', '/api/admin/office-invites', () => ({ invites: accounts.officeInvites() }));
  router.on('POST', '/api/admin/office-invites/revoke', async ({ req, user }) => {
    const input = await body(req); if (!accounts.revokeOfficeInvite(input.hash)) throw httpError('That invitation is already gone.', 404);
    log(user, 'Revoked an office invitation'); return { ok: true };
  });
  router.on('POST', '/api/admin/tenants/:id/suspend', async ({ params, user }) => { const t = accounts.suspendTenant(params.id, true); await registry.evict(params.id).catch(() => {}); log(user, `Suspended office ${t.name} (${t.slug})`); return t; });
  router.on('POST', '/api/admin/tenants/:id/resume', ({ params, user }) => { const t = accounts.suspendTenant(params.id, false); log(user, `Resumed office ${t.name} (${t.slug})`); return t; });
  router.on('GET', '/api/admin/users', ({ url }) => ({ users: accounts.users({ q: url.searchParams.get('q') || '' }).map(u => ({ id: u.id, email: u.email, name: u.name, platformAdmin: platform.isAdmin(u), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, offices: accounts.tenantsOf(u.id).map(t => ({ id: t.id, name: t.name, role: t.role })) })) }));
  router.on('PUT', '/api/admin/users/:id', async ({ req, params, user }) => {
    const input = await body(req), target = accounts.user(params.id); if (!target) throw httpError('No such user.', 404);
    if (typeof input.platformAdmin !== 'boolean') throw httpError('Say whether this person is a platform admin.');
    if (target.id === user.id && !input.platformAdmin) throw httpError('You cannot remove your own platform access.', 409);
    const u = accounts.setPlatformAdmin(params.id, input.platformAdmin); log(user, `${u.email} is ${input.platformAdmin ? 'now' : 'no longer'} a platform admin`); return { id: u.id, email: u.email, platformAdmin: platform.isAdmin(u) };
  });
  router.on('GET', '/api/admin/log', ({ url }) => accounts.adminLogs(Number(url.searchParams.get('limit')) || 100));
}
