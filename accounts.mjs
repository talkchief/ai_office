// The control plane of a hosted office: users, the companies (tenants) they belong to, member groups, sessions, invites,
// and the mail identities the intake uses. One SQLite file (AO_ACCOUNTS, default data/accounts.sqlite), never a tenant's.
// Passwords are scrypt hashes; a session cookie is a random value of which only the SHA-256 is stored.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
export const shortId = (prefix, n = 10) => prefix + [...crypto.randomBytes(n)].map(b => BASE32[b & 31]).join('');
export const slugOf = name => text(name, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'office';
export const normEmail = value => { const e = text(value, 254).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fail('Enter a valid email address.'); return e; };
const sha = value => crypto.createHash('sha256').update(String(value)).digest('hex');
export const ROLES = ['owner', 'admin', 'member'];
export const PLATFORM_SESSION = 'platform';
export const SESSION_MS = 7 * 86400000, INVITE_MS = 7 * 86400000, CODE_MS = 10 * 60000;

export function hashPassword(password, { N = 16384, r = 8, p = 1 } = {}) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(String(password), salt, 64, { N, r, p }).toString('base64url');
  return `scrypt$${N}$${r}$${p}$${salt}$${hash}`;
}
export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$'); if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  try { const candidate = crypto.scryptSync(String(password), salt, 64, { N: +N, r: +r, p: +p }); const known = Buffer.from(hash, 'base64url'); return candidate.length === known.length && crypto.timingSafeEqual(candidate, known); }
  catch { return false; }
}
export const checkPassword = password => { if (typeof password !== 'string' || password.length < 8) fail('Use a password of at least 8 characters.'); if (password.length > 200) fail('That password is too long.'); return password; };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT, platform_admin INTEGER NOT NULL DEFAULT 0, prefs TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, last_login_at INTEGER);
CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, owner_id TEXT NOT NULL, suspended_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS memberships (user_id TEXT NOT NULL, tenant_id TEXT NOT NULL, role TEXT NOT NULL, invited_by TEXT, created_at INTEGER NOT NULL, mail_handle TEXT, mail_suffix TEXT, PRIMARY KEY (user_id, tenant_id), UNIQUE (tenant_id, mail_handle));
CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, created_by TEXT, created_at INTEGER NOT NULL, UNIQUE (tenant_id, name));
CREATE TABLE IF NOT EXISTS group_members (group_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (group_id, user_id));
CREATE TABLE IF NOT EXISTS sessions (id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, tenant_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen_at INTEGER, ua TEXT);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS invites (token_hash TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, invited_by TEXT, expires_at INTEGER NOT NULL, accepted_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS identities (user_id TEXT NOT NULL, provider TEXT NOT NULL, provider_id TEXT NOT NULL, PRIMARY KEY (provider, provider_id));
CREATE TABLE IF NOT EXISTS sender_whitelist (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, address TEXT NOT NULL, code_hash TEXT, code_expires_at INTEGER, verified_at INTEGER, created_at INTEGER NOT NULL, UNIQUE (tenant_id, user_id, address));
CREATE TABLE IF NOT EXISTS inbound_mail (provider TEXT NOT NULL, provider_message_id TEXT NOT NULL, tenant_id TEXT, user_id TEXT, job_id TEXT, at INTEGER NOT NULL, outcome TEXT, PRIMARY KEY (provider, provider_message_id));
CREATE TABLE IF NOT EXISTS mail_messages (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, job_id TEXT, direction TEXT NOT NULL, message_id TEXT, provider_id TEXT, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mail_messages_mid ON mail_messages(message_id);
CREATE INDEX IF NOT EXISTS mail_messages_job ON mail_messages(job_id);
CREATE TABLE IF NOT EXISTS mail_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, level TEXT NOT NULL, summary TEXT NOT NULL, detail TEXT);
CREATE TABLE IF NOT EXISTS admin_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, summary TEXT NOT NULL);
`;

export class Accounts {
  constructor({ file, now = () => Date.now() }) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.file = file; this.now = now;
    this.db = new Database(file); this.db.pragma('journal_mode = WAL'); this.db.pragma('busy_timeout = 5000'); this.db.exec(SCHEMA);
    try { fs.chmodSync(file, 0o600); } catch {}
    this.q = {};
  }
  close() { this.db.close(); }
  prep(sql) { return this.q[sql] ||= this.db.prepare(sql); }
  tx(fn) { return this.db.transaction(fn)(); }

  /* ---------- users ---------- */
  userRow(r) { if (!r) return null; return { id: r.id, email: r.email, name: r.name, platformAdmin: !!r.platform_admin, prefs: JSON.parse(r.prefs || '{}'), createdAt: r.created_at, lastLoginAt: r.last_login_at }; }
  user(id) { return this.userRow(this.prep('SELECT * FROM users WHERE id = ?').get(id)); }
  userByEmail(email) { return this.userRow(this.prep('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase().trim())); }
  createUser({ email, name, password, platformAdmin = false }) {
    const e = normEmail(email), n = text(name, 80) || e.split('@')[0];
    if (this.userByEmail(e)) fail('An account with that email already exists. Sign in instead.', 409);
    const id = shortId('u_'), hash = password == null ? null : hashPassword(checkPassword(password));
    this.prep('INSERT INTO users(id, email, name, password_hash, platform_admin, prefs, created_at) VALUES (?,?,?,?,?,?,?)').run(id, e, n, hash, platformAdmin ? 1 : 0, '{}', this.now());
    if (hash) this.prep('INSERT OR IGNORE INTO identities(user_id, provider, provider_id) VALUES (?,?,?)').run(id, 'password', e);
    return this.user(id);
  }
  updateUser(id, { name, prefs } = {}) {
    const u = this.user(id); if (!u) fail('No such user.', 404);
    const next = { name: name !== undefined ? text(name, 80) || u.name : u.name, prefs: prefs && typeof prefs === 'object' ? { ...u.prefs, ...prefs } : u.prefs };
    this.prep('UPDATE users SET name = ?, prefs = ? WHERE id = ?').run(next.name, JSON.stringify(next.prefs), id); return this.user(id);
  }
  setPassword(id, next) { this.prep('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(checkPassword(next)), id); this.revokeSessions(id); }
  verifyLogin(email, password) {
    const row = this.prep('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase().trim());
    if (!row || !row.password_hash || !verifyPassword(password, row.password_hash)) return null;
    this.prep('UPDATE users SET last_login_at = ? WHERE id = ?').run(this.now(), row.id); return this.userRow(row);
  }
  // The platform administrator account: created (or its password kept current) from the configuration at every start.
  ensurePlatformAdmin({ email, password, name = 'Platform administrator' }) {
    const e = normEmail(email); let u = this.userByEmail(e);
    if (!u) u = this.createUser({ email: e, name, password: password || null, platformAdmin: true });
    else {
      if (!u.platformAdmin) this.setPlatformAdmin(u.id, true);
      if (password && !verifyPassword(password, this.prep('SELECT password_hash FROM users WHERE id = ?').get(u.id)?.password_hash)) { this.prep('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(checkPassword(password)), u.id); this.revokeSessions(u.id); }
    }
    return this.user(u.id);
  }
  setPlatformAdmin(id, flag) { this.prep('UPDATE users SET platform_admin = ? WHERE id = ?').run(flag ? 1 : 0, id); return this.user(id); }
  platformAdmins() { return this.prep('SELECT * FROM users WHERE platform_admin = 1 ORDER BY email').all().map(r => this.userRow(r)); }
  users({ q = '', limit = 100 } = {}) {
    const like = `%${text(q, 80).toLowerCase()}%`;
    return this.prep('SELECT * FROM users WHERE email LIKE ? OR lower(name) LIKE ? ORDER BY created_at DESC LIMIT ?').all(like, like, Math.min(500, limit)).map(r => this.userRow(r));
  }

  /* ---------- tenants ---------- */
  tenantRow(r) { if (!r) return null; return { id: r.id, slug: r.slug, name: r.name, ownerId: r.owner_id, suspendedAt: r.suspended_at, createdAt: r.created_at }; }
  tenant(id) { return this.tenantRow(this.prep('SELECT * FROM tenants WHERE id = ?').get(id)); }
  tenantBySlug(slug) { return this.tenantRow(this.prep('SELECT * FROM tenants WHERE slug = ?').get(slug)); }
  tenants({ q = '' } = {}) { const like = `%${text(q, 80).toLowerCase()}%`; return this.prep('SELECT * FROM tenants WHERE lower(name) LIKE ? OR slug LIKE ? ORDER BY created_at DESC').all(like, like).map(r => this.tenantRow(r)); }
  createTenant({ name, ownerId }) {
    const n = text(name, 80); if (n.length < 2) fail('Give the office a name.');
    if (!this.user(ownerId)) fail('No such user.', 404);
    let slug = slugOf(n); for (let i = 2; this.tenantBySlug(slug); i++) slug = slugOf(n).slice(0, 36) + '-' + i;
    const id = shortId('t_'), now = this.now();
    this.tx(() => {
      this.prep('INSERT INTO tenants(id, slug, name, owner_id, created_at) VALUES (?,?,?,?,?)').run(id, slug, n, ownerId, now);
      this.prep('INSERT INTO memberships(user_id, tenant_id, role, invited_by, created_at, mail_handle, mail_suffix) VALUES (?,?,?,?,?,?,?)').run(ownerId, id, 'owner', null, now, this.freeHandle(id, this.user(ownerId)), shortId('', 6));
    });
    return this.tenant(id);
  }
  renameTenant(id, name) { const n = text(name, 80); if (n.length < 2) fail('Give the office a name.'); this.prep('UPDATE tenants SET name = ? WHERE id = ?').run(n, id); return this.tenant(id); }
  suspendTenant(id, suspended = true) { if (!this.tenant(id)) fail('No such office.', 404); this.prep('UPDATE tenants SET suspended_at = ? WHERE id = ?').run(suspended ? this.now() : null, id); if (suspended) this.prep('DELETE FROM sessions WHERE tenant_id = ?').run(id); return this.tenant(id); }

  /* ---------- memberships ---------- */
  memberRow(r) { if (!r) return null; return { id: r.user_id, tenantId: r.tenant_id, role: r.role, email: r.email, name: r.name, invitedBy: r.invited_by, joinedAt: r.created_at, lastLoginAt: r.last_login_at, mailHandle: r.mail_handle, mailSuffix: r.mail_suffix, platformAdmin: !!r.platform_admin }; }
  membership(userId, tenantId) { return this.memberRow(this.prep('SELECT m.*, u.email, u.name, u.last_login_at, u.platform_admin FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.user_id = ? AND m.tenant_id = ?').get(userId, tenantId)); }
  members(tenantId) { return this.prep("SELECT m.*, u.email, u.name, u.last_login_at, u.platform_admin FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name").all(tenantId).map(r => this.memberRow(r)); }
  tenantsOf(userId) { return this.prep("SELECT t.*, m.role FROM memberships m JOIN tenants t ON t.id = m.tenant_id WHERE m.user_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, t.created_at").all(userId).map(r => ({ ...this.tenantRow(r), role: r.role })); }
  freeHandle(tenantId, user) {
    const base = text(user.name || user.email.split('@')[0], 40).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'member';
    let handle = base; for (let i = 2; this.prep('SELECT 1 FROM memberships WHERE tenant_id = ? AND mail_handle = ?').get(tenantId, handle); i++) handle = base + i;
    return handle;
  }
  addMember(tenantId, userId, role = 'member', invitedBy = null) {
    if (!ROLES.includes(role)) fail('Role must be owner, admin or member.');
    const user = this.user(userId); if (!user || !this.tenant(tenantId)) fail('No such user or office.', 404);
    if (this.membership(userId, tenantId)) fail(`${user.email} is already in this office.`, 409);
    this.prep('INSERT INTO memberships(user_id, tenant_id, role, invited_by, created_at, mail_handle, mail_suffix) VALUES (?,?,?,?,?,?,?)').run(userId, tenantId, role, invitedBy, this.now(), this.freeHandle(tenantId, user), shortId('', 6));
    return this.membership(userId, tenantId);
  }
  setRole(tenantId, userId, role) {
    if (!['admin', 'member'].includes(role)) fail('Choose admin or member.');
    const m = this.membership(userId, tenantId); if (!m) fail('That person is not in this office.', 404);
    if (m.role === 'owner') fail('The owner’s role cannot be changed. Transfer ownership first.', 409);
    this.prep('UPDATE memberships SET role = ? WHERE user_id = ? AND tenant_id = ?').run(role, userId, tenantId); return this.membership(userId, tenantId);
  }
  removeMember(tenantId, userId) {
    const m = this.membership(userId, tenantId); if (!m) fail('That person is not in this office.', 404);
    if (m.role === 'owner') fail('The owner cannot be removed from the office.', 409);
    this.tx(() => {
      this.prep('DELETE FROM memberships WHERE user_id = ? AND tenant_id = ?').run(userId, tenantId);
      this.prep('DELETE FROM group_members WHERE user_id = ? AND group_id IN (SELECT id FROM groups WHERE tenant_id = ?)').run(userId, tenantId);
      this.prep('DELETE FROM sessions WHERE user_id = ? AND tenant_id = ?').run(userId, tenantId);
      this.prep('DELETE FROM sender_whitelist WHERE user_id = ? AND tenant_id = ?').run(userId, tenantId);
    });
    return { ok: true };
  }

  /* ---------- sessions ---------- */
  createSession(userId, tenantId, { ua = '' } = {}) {
    const id = crypto.randomBytes(32).toString('base64url'), now = this.now();
    this.prep('INSERT INTO sessions(id_hash, user_id, tenant_id, created_at, expires_at, last_seen_at, ua) VALUES (?,?,?,?,?,?,?)').run(sha(id), userId, tenantId, now, now + SESSION_MS, now, text(ua, 200));
    return { id, expiresAt: now + SESSION_MS };
  }
  // The viewer for one request: the user, the office the session is in and the role there. Null when the cookie is unknown or expired.
  // A platform session (tenant 'platform') belongs to a platform administrator and to no office: it sees the Platform page only.
  sessionUser(cookieValue, { touchEveryMs = 5 * 60000 } = {}) {
    if (!cookieValue) return null;
    const row = this.prep('SELECT * FROM sessions WHERE id_hash = ?').get(sha(cookieValue)), now = this.now();
    if (!row || row.expires_at <= now) { if (row) this.prep('DELETE FROM sessions WHERE id_hash = ?').run(row.id_hash); return null; }
    if (row.tenant_id === PLATFORM_SESSION) {
      const user = this.user(row.user_id); if (!user?.platformAdmin) { this.prep('DELETE FROM sessions WHERE id_hash = ?').run(row.id_hash); return null; }
      if (now - (row.last_seen_at || 0) >= touchEveryMs) this.prep('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?').run(now, row.id_hash);
      return { id: user.id, email: user.email, name: user.name, prefs: user.prefs, platformAdmin: true, platform: true, tenantId: null, role: 'platform', groups: [] };
    }
    const m = this.membership(row.user_id, row.tenant_id); if (!m) { this.prep('DELETE FROM sessions WHERE id_hash = ?').run(row.id_hash); return null; }
    if (now - (row.last_seen_at || 0) >= touchEveryMs) this.prep('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?').run(now, row.id_hash);
    const user = this.user(row.user_id);
    return { id: user.id, email: user.email, name: user.name, prefs: user.prefs, platformAdmin: user.platformAdmin, tenantId: row.tenant_id, role: m.role, groups: this.groupsOf(user.id, row.tenant_id), mailHandle: m.mailHandle, mailSuffix: m.mailSuffix };
  }
  switchTenant(cookieValue, tenantId) {
    const row = this.prep('SELECT * FROM sessions WHERE id_hash = ?').get(sha(cookieValue)); if (!row) fail('Sign in first.', 401);
    if (!this.membership(row.user_id, tenantId)) fail('You are not a member of that office.', 403);
    this.prep('UPDATE sessions SET tenant_id = ? WHERE id_hash = ?').run(tenantId, row.id_hash); return this.sessionUser(cookieValue);
  }
  logout(cookieValue) { if (cookieValue) this.prep('DELETE FROM sessions WHERE id_hash = ?').run(sha(cookieValue)); return { ok: true }; }
  revokeSessions(userId) { this.prep('DELETE FROM sessions WHERE user_id = ?').run(userId); }
  pruneSessions() { return this.prep('DELETE FROM sessions WHERE expires_at <= ?').run(this.now()).changes; }

  /* ---------- invites ---------- */
  invite({ tenantId, email, role = 'member', invitedBy = null }) {
    const e = normEmail(email); if (!['admin', 'member'].includes(role)) fail('Invite people as admin or member.');
    if (!this.tenant(tenantId)) fail('No such office.', 404);
    const existing = this.userByEmail(e); if (existing && this.membership(existing.id, tenantId)) fail(`${e} is already in this office.`, 409);
    const token = crypto.randomBytes(32).toString('base64url'), now = this.now();
    this.tx(() => {
      this.prep('DELETE FROM invites WHERE tenant_id = ? AND email = ? AND accepted_at IS NULL').run(tenantId, e);
      this.prep('INSERT INTO invites(token_hash, tenant_id, email, role, invited_by, expires_at, created_at) VALUES (?,?,?,?,?,?,?)').run(sha(token), tenantId, e, role, invitedBy, now + INVITE_MS, now);
    });
    return { token, email: e, role, expiresAt: now + INVITE_MS };
  }
  invites(tenantId) { return this.prep('SELECT * FROM invites WHERE tenant_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC').all(tenantId, this.now()).map(r => ({ email: r.email, role: r.role, invitedBy: r.invited_by, expiresAt: r.expires_at, createdAt: r.created_at, tokenHash: r.token_hash })); }
  inviteByToken(token) { const r = this.prep('SELECT * FROM invites WHERE token_hash = ?').get(sha(String(token || ''))); if (!r) return null; return { tenantId: r.tenant_id, email: r.email, role: r.role, expiresAt: r.expires_at, acceptedAt: r.accepted_at, tenantName: this.tenant(r.tenant_id)?.name }; }
  revokeInvite(tenantId, tokenHash) { return this.prep('DELETE FROM invites WHERE tenant_id = ? AND token_hash = ?').run(tenantId, tokenHash).changes > 0; }
  // A new person sets a name and password; someone who already has an account joins the office with the account they have.
  acceptInvite(token, { name, password } = {}) {
    const inv = this.inviteByToken(token); if (!inv || inv.acceptedAt || inv.expiresAt <= this.now()) fail('This invitation has expired or was already used. Ask for a new one.', 410);
    const tenant = this.tenant(inv.tenantId); if (!tenant || tenant.suspendedAt) fail('That office is not available.', 410);
    let user = this.userByEmail(inv.email);
    return this.tx(() => {
      if (!user) user = this.createUser({ email: inv.email, name, password });
      else if (password && !verifyPassword(password, this.prep('SELECT password_hash FROM users WHERE id = ?').get(user.id)?.password_hash)) fail('You already have an account with this email. Sign in with your existing password to accept.', 401);
      if (!this.membership(user.id, tenant.id)) this.addMember(tenant.id, user.id, inv.role, null);
      this.prep('UPDATE invites SET accepted_at = ? WHERE token_hash = ?').run(this.now(), sha(token));
      return { user, tenant };
    });
  }

  /* ---------- member groups (people, not AI teams) ---------- */
  groupRow(r) { if (!r) return null; return { id: r.id, tenantId: r.tenant_id, name: r.name, createdBy: r.created_by, createdAt: r.created_at, users: this.prep('SELECT user_id FROM group_members WHERE group_id = ?').all(r.id).map(x => x.user_id) }; }
  group(id) { return this.groupRow(this.prep('SELECT * FROM groups WHERE id = ?').get(id)); }
  groups(tenantId) { return this.prep('SELECT * FROM groups WHERE tenant_id = ? ORDER BY name').all(tenantId).map(r => this.groupRow(r)); }
  createGroup(tenantId, name, createdBy = null) {
    const n = text(name, 60); if (n.length < 2) fail('Give the group a name.');
    if (this.prep('SELECT 1 FROM groups WHERE tenant_id = ? AND name = ?').get(tenantId, n)) fail(`There is already a group called “${n}”.`, 409);
    if (this.groups(tenantId).length >= 50) fail('An office can have up to 50 groups.');
    const id = shortId('g_'); this.prep('INSERT INTO groups(id, tenant_id, name, created_by, created_at) VALUES (?,?,?,?,?)').run(id, tenantId, n, createdBy, this.now()); return this.group(id);
  }
  renameGroup(tenantId, id, name) {
    const g = this.group(id); if (!g || g.tenantId !== tenantId) fail('No such group.', 404);
    const n = text(name, 60); if (n.length < 2) fail('Give the group a name.');
    if (this.prep('SELECT 1 FROM groups WHERE tenant_id = ? AND name = ? AND id <> ?').get(tenantId, n, id)) fail(`There is already a group called “${n}”.`, 409);
    this.prep('UPDATE groups SET name = ? WHERE id = ?').run(n, id); return this.group(id);
  }
  deleteGroup(tenantId, id) { const g = this.group(id); if (!g || g.tenantId !== tenantId) fail('No such group.', 404); this.tx(() => { this.prep('DELETE FROM group_members WHERE group_id = ?').run(id); this.prep('DELETE FROM groups WHERE id = ?').run(id); }); return { ok: true }; }
  setGroupMembers(tenantId, id, userIds) {
    const g = this.group(id); if (!g || g.tenantId !== tenantId) fail('No such group.', 404);
    const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map(u => text(u, 40)).filter(Boolean))];
    for (const u of ids) if (!this.membership(u, tenantId)) fail('Every group member must belong to this office.');
    this.tx(() => { this.prep('DELETE FROM group_members WHERE group_id = ?').run(id); for (const u of ids) this.prep('INSERT INTO group_members(group_id, user_id) VALUES (?,?)').run(id, u); });
    return this.group(id);
  }
  groupsOf(userId, tenantId) { return this.prep('SELECT g.id FROM group_members gm JOIN groups g ON g.id = gm.group_id WHERE gm.user_id = ? AND g.tenant_id = ?').all(userId, tenantId).map(r => r.id); }
  // The ids a share list may name: members and groups of this office only.
  validAudience(tenantId, sharedWith = {}) {
    const users = [...new Set((Array.isArray(sharedWith.users) ? sharedWith.users : []).map(u => text(u, 40)).filter(Boolean))].slice(0, 50);
    const groups = [...new Set((Array.isArray(sharedWith.groups) ? sharedWith.groups : []).map(g => text(g, 40)).filter(Boolean))].slice(0, 50);
    for (const u of users) if (!this.membership(u, tenantId)) fail('Share only with people who are in this office.');
    for (const g of groups) { const grp = this.group(g); if (!grp || grp.tenantId !== tenantId) fail('Share only with groups of this office.'); }
    return { users, groups };
  }

  /* ---------- mail identities: the alias each member writes to, and who may write to it ---------- */
  mailHandleFor(userId, tenantId) { const m = this.membership(userId, tenantId); return m ? { handle: m.mailHandle, suffix: m.mailSuffix } : null; }
  rotateMailSuffix(userId, tenantId) { if (!this.membership(userId, tenantId)) fail('Not a member.', 404); this.prep('UPDATE memberships SET mail_suffix = ? WHERE user_id = ? AND tenant_id = ?').run(shortId('', 6), userId, tenantId); return this.mailHandleFor(userId, tenantId); }
  // <slug>.<handle>.<suffix>[+<tag>]@domain → the member it belongs to, or null.
  resolveAlias(localPart) {
    const m = /^([a-z0-9-]+)\.([a-z0-9.]+)\.([a-z0-9]{6})(?:\+([a-z0-9-]+))?$/i.exec(String(localPart || '').trim()); if (!m) return null;
    const tenant = this.tenantBySlug(m[1].toLowerCase()); if (!tenant) return null;
    const row = this.prep('SELECT user_id, mail_suffix FROM memberships WHERE tenant_id = ? AND mail_handle = ?').get(tenant.id, m[2].toLowerCase()); if (!row) return null;
    const a = Buffer.from(row.mail_suffix), b = Buffer.from(m[3].toLowerCase()); if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return { tenantId: tenant.id, userId: row.user_id, tag: m[4] ? m[4].toLowerCase() : null };
  }
  senders(userId, tenantId) { return this.prep('SELECT * FROM sender_whitelist WHERE user_id = ? AND tenant_id = ? ORDER BY created_at').all(userId, tenantId).map(r => ({ id: r.id, address: r.address, verifiedAt: r.verified_at, pending: !r.verified_at && r.code_expires_at > this.now(), createdAt: r.created_at })); }
  addSender(userId, tenantId, address) {
    const e = normEmail(address); if (this.senders(userId, tenantId).length >= 20) fail('Up to 20 sender addresses per person.');
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'), id = shortId('s_'), now = this.now();
    this.prep('INSERT INTO sender_whitelist(id, tenant_id, user_id, address, code_hash, code_expires_at, verified_at, created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id, user_id, address) DO UPDATE SET code_hash = excluded.code_hash, code_expires_at = excluded.code_expires_at').run(id, tenantId, userId, e, sha(code), now + CODE_MS, null, now);
    const row = this.prep('SELECT id FROM sender_whitelist WHERE tenant_id = ? AND user_id = ? AND address = ?').get(tenantId, userId, e);
    return { id: row.id, address: e, code, expiresAt: now + CODE_MS };
  }
  verifySender(userId, tenantId, id, code) {
    const r = this.prep('SELECT * FROM sender_whitelist WHERE id = ? AND user_id = ? AND tenant_id = ?').get(id, userId, tenantId); if (!r) fail('No such sender.', 404);
    if (r.verified_at) return { ok: true, already: true };
    if (!r.code_hash || r.code_expires_at <= this.now()) fail('That code has expired. Send a new one.', 410);
    const a = Buffer.from(r.code_hash), b = Buffer.from(sha(String(code || '').trim())); if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) fail('That code is not right.', 400);
    this.prep('UPDATE sender_whitelist SET verified_at = ?, code_hash = NULL, code_expires_at = NULL WHERE id = ?').run(this.now(), id); return { ok: true };
  }
  removeSender(userId, tenantId, id) { return this.prep('DELETE FROM sender_whitelist WHERE id = ? AND user_id = ? AND tenant_id = ?').run(id, userId, tenantId).changes > 0; }
  // The account's own email is always allowed; anything else must be a verified sender of this member.
  isSenderAllowed(userId, tenantId, address) {
    const e = String(address || '').toLowerCase().trim(), user = this.user(userId); if (!user) return false;
    if (user.email === e) return true;
    return !!this.prep('SELECT 1 FROM sender_whitelist WHERE user_id = ? AND tenant_id = ? AND address = ? AND verified_at IS NOT NULL').get(userId, tenantId, e);
  }
  // Idempotency for the webhook: true the first time a provider message id is seen.
  recordInbound({ provider, providerMessageId, tenantId = null, userId = null, jobId = null, outcome = 'received' }) {
    try { this.prep('INSERT INTO inbound_mail(provider, provider_message_id, tenant_id, user_id, job_id, at, outcome) VALUES (?,?,?,?,?,?,?)').run(provider, String(providerMessageId), tenantId, userId, jobId, this.now(), outcome); return true; }
    catch (error) { if (/UNIQUE|PRIMARY/.test(error.message)) return false; throw error; }
  }
  updateInbound(provider, providerMessageId, { tenantId, userId, jobId, outcome }) { this.prep('UPDATE inbound_mail SET tenant_id = COALESCE(?, tenant_id), user_id = COALESCE(?, user_id), job_id = COALESCE(?, job_id), outcome = COALESCE(?, outcome) WHERE provider = ? AND provider_message_id = ?').run(tenantId ?? null, userId ?? null, jobId ?? null, outcome ?? null, provider, String(providerMessageId)); }
  recordMailMessage({ tenantId, jobId = null, direction, messageId = null, providerId = null }) { const id = shortId('m_'); this.prep('INSERT INTO mail_messages(id, tenant_id, job_id, direction, message_id, provider_id, at) VALUES (?,?,?,?,?,?,?)').run(id, tenantId, jobId, direction, messageId ? String(messageId).trim() : null, providerId, this.now()); return id; }
  threadMessageIds(jobId) { return this.prep('SELECT message_id FROM mail_messages WHERE job_id = ? AND message_id IS NOT NULL ORDER BY at').all(jobId).map(r => r.message_id); }
  findThread(messageIds = []) { for (const mid of messageIds.filter(Boolean)) { const r = this.prep('SELECT tenant_id, job_id FROM mail_messages WHERE message_id = ? AND job_id IS NOT NULL ORDER BY at DESC').get(String(mid).trim()); if (r) return { tenantId: r.tenant_id, jobId: r.job_id }; } return null; }
  mailLog({ level = 'info', summary, detail = null }) { this.prep('INSERT INTO mail_log(at, level, summary, detail) VALUES (?,?,?,?)').run(this.now(), level, text(summary, 300), detail ? JSON.stringify(detail).slice(0, 4000) : null); }
  mailLogs(limit = 100) { return this.prep('SELECT * FROM mail_log ORDER BY seq DESC LIMIT ?').all(limit).map(r => ({ seq: r.seq, at: r.at, level: r.level, summary: r.summary, detail: r.detail ? JSON.parse(r.detail) : null })); }
  adminLog(actor, summary) { this.prep('INSERT INTO admin_log(at, actor, summary) VALUES (?,?,?)').run(this.now(), text(actor, 200), text(summary, 300)); }
  adminLogs(limit = 100) { return this.prep('SELECT * FROM admin_log ORDER BY seq DESC LIMIT ?').all(limit); }

  /* ---------- counts for the admin panel ---------- */
  tenantStats(tenantId) { return { users: this.prep('SELECT COUNT(*) AS n FROM memberships WHERE tenant_id = ?').get(tenantId).n, groups: this.prep('SELECT COUNT(*) AS n FROM groups WHERE tenant_id = ?').get(tenantId).n }; }
}
