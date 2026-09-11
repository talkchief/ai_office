// The platform admin panel: what every hosted office inherits (models, keys, limits, registration) and the offices themselves.
// Mounted for platform administrators only; serve.mjs refuses everyone else before a handler runs.
import { readJsonBody as body } from '../http-body.mjs';
import { httpError } from './routes.mjs';
import { registerProviderRoutes } from './providers-api.mjs';

export function registerAdminApi(router, { accounts, platform, registry }) {
  const log = (user, summary) => { try { accounts.adminLog(user?.email || 'platform', summary); } catch {} };
  router.on('GET', '/api/admin/config', () => ({ ...platform.get(), admins: accounts.platformAdmins().map(u => u.email) }));
  router.on('PUT', '/api/admin/config', async ({ req, user }) => {
    const before = platform.get(), next = platform.update(await body(req));
    log(user, `Platform config: limits ${next.limits.maxTeams} teams × ${next.limits.maxMembersPerTeam} agents, registration ${next.registration}, ${next.adminEmails.length} admin emails`);
    // Limits apply to the next change in every loaded office; the number itself is read from the office store.
    for (const id of registry.loaded()) { const instance = registry.peek(id); if (instance) { instance.office.limits = { ...instance.office.limits, ...next.limits }; instance.bus.publish('office.updated', { area: 'limits', limits: next.limits }); } }
    return { ...next, before };
  });
  registerProviderRoutes(router, platform.models, '/api/admin/providers', {
    record: entry => log(null, entry.summary),
    onChange: () => { for (const id of registry.loaded()) registry.peek(id)?.bus.publish('office.updated', { area: 'models' }); },
  });
  router.on('GET', '/api/admin/tenants', ({ url }) => ({ tenants: accounts.tenants({ q: url.searchParams.get('q') || '' }).map(t => {
    const owner = accounts.user(t.ownerId), stats = accounts.tenantStats(t.id), status = registry.status(t.id), instance = registry.peek(t.id);
    const jobs = instance ? instance.engine.list() : null;
    return { id: t.id, name: t.name, slug: t.slug, owner: owner ? { id: owner.id, email: owner.email, name: owner.name } : null, users: stats.users, groups: stats.groups, createdAt: t.createdAt, suspendedAt: t.suspendedAt,
      loaded: status.loaded, running: status.running || 0, openTasks: jobs ? jobs.filter(j => !['done', 'cancelled', 'backlog'].includes(j.state)).length : null, tasks: jobs ? jobs.length : null,
      tokens: jobs ? jobs.reduce((n, j) => n + (j.tokens || 0), 0) : null, teams: instance ? instance.office.get().teams.length : null };
  }) }));
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
