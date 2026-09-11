// Hosted mode: signing up and in (before the gate), and the routes about people once signed in (users, groups, profile).
// Every handler receives the viewer (`user`) and, past the gate, the tenant's office (`instance`) for its audit log.
import { readJsonBody as body } from '../http-body.mjs';
import { httpError } from './routes.mjs';
import { sessionCookie, clearCookie } from '../auth.mjs';
import { PLATFORM_SESSION } from '../accounts.mjs';
import { requireRole } from './visibility.mjs';
import { RateLimiter } from './ratelimit.mjs';

const publicUser = (u, platform) => u && { id: u.id, email: u.email, name: u.name, role: u.role, platform: !!u.platform, platformAdmin: !!u.platform, tenantId: u.tenantId };
const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);

/** The routes that run before the gate: register, login, accept an invitation, logout. serve.mjs guards them (HTTPS or local, rate limit). */
export function registerAuthRoutes(router, { accounts, platform, registry, log = () => {} }) {
  const signIn = (res, user, tenant, { secure, ua }) => { const s = accounts.createSession(user.id, tenant.id, { ua }); res.setHeader('Set-Cookie', sessionCookie(s.id, { secure })); return { user: publicUser({ ...user, tenantId: tenant.id, role: accounts.membership(user.id, tenant.id)?.role }, platform), tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name } }; };
  // A company registers its office: the person becomes its owner and the office is built at once.
  router.on('POST', '/api/auth/register', async ({ req, res, secure, ua }) => {
    if (!platform.registrationOpen()) throw httpError('This platform is invitation-only. Ask an office owner for an invitation.', 403);
    const input = await body(req);
    if (!text(input.officeName, 80)) throw httpError('Name the office you are creating.');
    const user = accounts.createUser({ email: input.email, name: input.name, password: input.password });
    const tenant = accounts.createTenant({ name: input.officeName, ownerId: user.id });
    await registry.provision(tenant);
    log(`  registered: ${user.email} → ${tenant.name} (${tenant.slug})`);
    return { $status: 201, body: signIn(res, user, tenant, { secure, ua }) };
  });
  router.on('POST', '/api/auth/login', async ({ req, res, secure, ua }) => {
    const input = await body(req), user = accounts.verifyLogin(input.email, input.password);
    if (!user) throw httpError('That email and password do not match.', 401);
    const tenants = accounts.tenantsOf(user.id).filter(t => !t.suspendedAt);
    // The platform administrator signs in to the platform itself, not to an office.
    if (user.platformAdmin && !tenants.length) { const s = accounts.createSession(user.id, PLATFORM_SESSION, { ua }); res.setHeader('Set-Cookie', sessionCookie(s.id, { secure })); return { user: publicUser({ ...user, platform: true, role: 'platform', tenantId: null }, platform), platform: true }; }
    const wanted = input.tenantId ? tenants.find(t => t.id === input.tenantId) : tenants[0];
    if (!wanted) throw httpError(tenants.length ? 'You are not a member of that office.' : 'You are not a member of any office yet. Create one, or ask for an invitation.', 403);
    return signIn(res, user, wanted, { secure, ua });
  });
  router.on('POST', '/api/auth/accept', async ({ req, res, secure, ua }) => {
    const input = await body(req), { user, tenant } = accounts.acceptInvite(input.token, { name: input.name, password: input.password });
    return signIn(res, user, tenant, { secure, ua });
  });
  router.on('POST', '/api/auth/logout', ({ res, cookie, secure }) => { accounts.logout(cookie); res.setHeader('Set-Cookie', clearCookie({ secure })); return { ok: true }; });
  // What an invitation is for, so the accept form can say which office and whether an account already exists.
  router.on('GET', '/api/auth/invite/:token', ({ params }) => { const inv = accounts.inviteByToken(params.token); if (!inv || inv.acceptedAt || inv.expiresAt <= Date.now()) throw httpError('This invitation has expired or was already used.', 410); return { email: inv.email, role: inv.role, office: inv.tenantName, existing: !!accounts.userByEmail(inv.email) }; });
}

/** The routes past the gate: who am I, the people of the office, member groups, the profile. */
// `mail` is { mailer, domain }, read at call time from the platform configuration.
export function registerAccountsApi(router, { accounts, platform, publicOrigin = () => '', mail = { mailer: null, domain: '' } }) {
  const mailer = () => mail.mailer, mailDomain = () => mail.domain || '';
  const codeLimiter = new RateLimiter({ max: 5, windowMs: 3600000 });
  const admin = user => requireRole(user, ['owner', 'admin']);
  const record = (instance, entry) => { try { instance?.audit.record(entry); } catch (error) { console.warn('audit:', error.message); } };
  const memberOut = m => ({ id: m.id, name: m.name, email: m.email, role: m.role, lastLoginAt: m.lastLoginAt, joinedAt: m.joinedAt });
  const mailAddress = user => { const h = accounts.mailHandleFor(user.id, user.tenantId), t = accounts.tenant(user.tenantId); return h && mailDomain() ? `${t.slug}.${h.handle}.${h.suffix}@${mailDomain()}` : null; };
  router.on('GET', '/api/auth/me', ({ user }) => {
    if (user.platform) return { user: publicUser(user, platform), platform: true, tenant: null, groups: [], mail: { address: null }, prefs: user.prefs || {}, tenants: [] };
    const tenant = accounts.tenant(user.tenantId);
    return { user: publicUser(user, platform), tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name }, groups: accounts.groups(user.tenantId).filter(g => g.users.includes(user.id)).map(g => ({ id: g.id, name: g.name })), mail: { address: mailAddress(user) }, prefs: user.prefs || {}, tenants: accounts.tenantsOf(user.id).map(t => ({ id: t.id, slug: t.slug, name: t.name, role: t.role })) };
  });
  router.on('POST', '/api/auth/switch', async ({ req, cookie }) => { const input = await body(req); const next = accounts.switchTenant(cookie, text(input.tenantId, 40)); return { user: publicUser(next, platform) }; });
  router.on('POST', '/api/auth/password', async ({ req, res, user, secure, ua }) => {
    const input = await body(req); if (!accounts.verifyLogin(user.email, input.current)) throw httpError('Your current password is not right.', 401);
    accounts.setPassword(user.id, input.next);
    const s = accounts.createSession(user.id, user.tenantId, { ua }); res.setHeader('Set-Cookie', sessionCookie(s.id, { secure })); return { ok: true };
  });
  router.on('PUT', '/api/auth/prefs', async ({ req, user }) => { const input = await body(req); const prefs = {}; if (typeof input.notifyByEmail === 'string' && ['none', 'mine', 'all'].includes(input.notifyByEmail)) prefs.notifyByEmail = input.notifyByEmail; const u = accounts.updateUser(user.id, { name: input.name, prefs }); return { name: u.name, prefs: u.prefs }; });
  // Invitations: the owner may invite admins; an admin invites members.
  router.on('POST', '/api/auth/invite', async ({ req, user, instance }) => {
    admin(user); const input = await body(req), role = input.role === 'admin' ? 'admin' : 'member';
    if (role === 'admin' && user.role !== 'owner') throw httpError('Only the owner can invite another admin.', 403);
    if (accounts.invites(user.tenantId).length >= 50) throw httpError('Too many open invitations. Revoke some first.', 429);
    const inv = accounts.invite({ tenantId: user.tenantId, email: input.email, role, invitedBy: user.id });
    record(instance, { area: 'users', summary: `Invited ${inv.email} as ${inv.role}` });
    return { $status: 201, body: { email: inv.email, role: inv.role, expiresAt: inv.expiresAt, link: `${publicOrigin()}/#invite=${inv.token}`, sent: false } };
  });
  router.on('DELETE', '/api/auth/invite/:hash', ({ params, user, instance }) => { admin(user); const gone = accounts.revokeInvite(user.tenantId, params.hash); if (gone) record(instance, { area: 'users', summary: 'Revoked an invitation' }); return { ok: gone }; });
  router.on('GET', '/api/users', ({ user }) => ({ users: accounts.members(user.tenantId).map(memberOut), invites: ['owner', 'admin'].includes(user.role) ? accounts.invites(user.tenantId).map(i => ({ email: i.email, role: i.role, expiresAt: i.expiresAt, hash: i.tokenHash })) : [] }));
  router.on('PUT', '/api/users/:id', async ({ req, params, user, instance }) => {
    requireRole(user, ['owner'], 'Only the owner can change roles.'); const input = await body(req);
    const before = accounts.membership(params.id, user.tenantId); const m = accounts.setRole(user.tenantId, params.id, text(input.role, 20));
    record(instance, { area: 'users', summary: `${m.email} is now ${m.role}`, before: { role: before?.role }, after: { role: m.role } }); return memberOut(m);
  });
  router.on('DELETE', '/api/users/:id', ({ params, user, instance }) => {
    admin(user); const m = accounts.membership(params.id, user.tenantId); if (!m) throw httpError('That person is not in this office.', 404);
    if (m.role === 'admin' && user.role !== 'owner') throw httpError('Only the owner can remove an admin.', 403);
    if (m.id === user.id) throw httpError('You cannot remove yourself. Ask the owner.', 409);
    accounts.removeMember(user.tenantId, params.id); record(instance, { area: 'users', summary: `Removed ${m.email} from the office` }); return { ok: true };
  });
  /* ---------- email intake: the member's alias, who may write to it, and a test ---------- */
  const mailProfile = user => ({ enabled: !!mailer()?.enabled, domain: mailDomain(), address: mailAddress(user), senders: accounts.senders(user.id, user.tenantId), prefs: { notifyByEmail: user.prefs?.notifyByEmail || 'mine' } });
  router.on('GET', '/api/mail/profile', ({ user }) => mailProfile(user));
  router.on('POST', '/api/mail/alias/rotate', ({ user, instance }) => { accounts.rotateMailSuffix(user.id, user.tenantId); record(instance, { area: 'mail', summary: `${user.email} rotated their email alias` }); return mailProfile({ ...user }); });
  // A sender is verified by a six-digit code mailed to that address; the code is never returned to the browser.
  router.on('POST', '/api/mail/senders', async ({ req, user, instance }) => {
    if (!mailer()?.enabled) throw httpError('Mail is not configured on this platform.', 503);
    if (!codeLimiter.hit(user.id)) throw httpError('Too many verification codes this hour. Try again later.', 429);
    const input = await body(req), s = accounts.addSender(user.id, user.tenantId, input.address);
    let sent = false; try { await mailer().send({ to: s.address, subject: `Your code to write to ${accounts.tenant(user.tenantId)?.name || 'the office'}`, text: `${user.name} is adding ${s.address} as a sender for their office email alias.

The code is ${s.code}. It works for ten minutes.

If this was not you, ignore this message.`, tag: 'verify' }); sent = true; } catch (error) { console.warn('verification mail:', error.message); }
    record(instance, { area: 'mail', summary: `${user.email} asked to verify the sender ${s.address}` });
    return { $status: 201, body: { id: s.id, address: s.address, expiresAt: s.expiresAt, sent } };
  });
  router.on('POST', '/api/mail/senders/:id/verify', async ({ req, params, user, instance }) => { const input = await body(req); const out = accounts.verifySender(user.id, user.tenantId, params.id, input.code); record(instance, { area: 'mail', summary: `${user.email} verified a sender address` }); return { ...out, senders: accounts.senders(user.id, user.tenantId) }; });
  router.on('DELETE', '/api/mail/senders/:id', ({ params, user }) => { accounts.removeSender(user.id, user.tenantId, params.id); return { ok: true, senders: accounts.senders(user.id, user.tenantId) }; });
  router.on('POST', '/api/mail/test', async ({ user }) => {
    if (!mailer()?.enabled) throw httpError('Mail is not configured on this platform.', 503);
    const address = mailAddress(user), tenant = accounts.tenant(user.tenantId);
    const r = await mailer().send({ to: user.email, subject: `Your office email address for ${tenant?.name || 'the office'}`, text: `Write to ${address || '(no mail domain is configured yet)'} and the Program Manager takes it as a task: the subject becomes the title, the body the brief, attachments the task's files. A question is answered on the same thread.

Only your account email and the senders you verify under Profile may write to it.`, replyTo: address || undefined, tag: 'test' });
    return { ok: true, to: user.email, dryRun: !!r.dryRun };
  });

  /* ---------- member groups: people, not AI teams ---------- */
  const groupOut = g => ({ id: g.id, name: g.name, users: g.users, createdAt: g.createdAt });
  router.on('GET', '/api/groups', ({ user }) => ({ groups: accounts.groups(user.tenantId).map(groupOut) }));
  router.on('POST', '/api/groups', async ({ req, user, instance }) => { admin(user); const input = await body(req); const g = accounts.createGroup(user.tenantId, input.name, user.id); if (Array.isArray(input.users)) accounts.setGroupMembers(user.tenantId, g.id, input.users); record(instance, { area: 'groups', summary: `Created group “${g.name}”` }); return { $status: 201, body: groupOut(accounts.group(g.id)) }; });
  router.on('PUT', '/api/groups/:id', async ({ req, params, user, instance }) => { admin(user); const input = await body(req); const before = accounts.group(params.id); const g = accounts.renameGroup(user.tenantId, params.id, input.name); record(instance, { area: 'groups', summary: `Renamed group “${before?.name}” to “${g.name}”` }); return groupOut(g); });
  router.on('PUT', '/api/groups/:id/members', async ({ req, params, user, instance }) => { admin(user); const input = await body(req); const before = accounts.group(params.id); const g = accounts.setGroupMembers(user.tenantId, params.id, input.users); record(instance, { area: 'groups', summary: `Changed who is in “${g.name}” (${g.users.length} people)`, before: { users: before?.users }, after: { users: g.users } }); return groupOut(g); });
  router.on('DELETE', '/api/groups/:id', ({ params, user, instance }) => { admin(user); const g = accounts.group(params.id); const out = accounts.deleteGroup(user.tenantId, params.id); record(instance, { area: 'groups', summary: `Deleted group “${g?.name}”` }); return out; });
}
