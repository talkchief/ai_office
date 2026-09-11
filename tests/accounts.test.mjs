import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Accounts, hashPassword, verifyPassword, SESSION_MS } from '../accounts.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-accounts-'));
const open = (now) => { const dir = temp(); return { dir, accounts: new Accounts({ file: path.join(dir, 'accounts.sqlite'), now }) }; };
const done = (dir, accounts) => { accounts.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); };

test('passwords are scrypt hashes that verify and never match a different password', () => {
  const stored = hashPassword('correct horse battery');
  assert.match(stored, /^scrypt\$16384\$8\$1\$/);
  assert.equal(verifyPassword('correct horse battery', stored), true);
  assert.equal(verifyPassword('correct horse batter', stored), false);
  assert.equal(verifyPassword('anything', 'not-a-hash'), false);
  assert.notEqual(hashPassword('same'), hashPassword('same'), 'a fresh salt every time');
});

test('a company registers: the person owns the office, signs in, and the session expires on the clock', () => {
  let clock = 1_000_000; const { dir, accounts } = open(() => clock);
  try {
    assert.throws(() => accounts.createUser({ email: 'ceo@acme.test', name: 'Dana', password: 'short' }), /at least 8/);
    const user = accounts.createUser({ email: 'CEO@Acme.test', name: 'Dana', password: 'a long enough password' });
    assert.equal(user.email, 'ceo@acme.test');
    assert.throws(() => accounts.createUser({ email: 'ceo@acme.test', name: 'Again', password: 'a long enough password' }), /already exists/);
    const tenant = accounts.createTenant({ name: 'Acme Widgets', ownerId: user.id });
    assert.equal(tenant.slug, 'acme-widgets'); assert.match(tenant.id, /^t_[a-z2-7]{10}$/);
    assert.equal(accounts.createTenant({ name: 'Acme Widgets', ownerId: user.id }).slug, 'acme-widgets-2', 'a second office of the same name gets a numbered slug');
    assert.equal(accounts.membership(user.id, tenant.id).role, 'owner');
    assert.equal(accounts.verifyLogin('ceo@acme.test', 'wrong password here'), null);
    const s = accounts.createSession(user.id, tenant.id, { ua: 'test' });
    const viewer = accounts.sessionUser(s.id);
    assert.equal(viewer.id, user.id); assert.equal(viewer.role, 'owner'); assert.equal(viewer.tenantId, tenant.id); assert.deepEqual(viewer.groups, []);
    assert.equal(accounts.sessionUser('nonsense'), null);
    clock += SESSION_MS + 1;
    assert.equal(accounts.sessionUser(s.id), null, 'expired');
    const again = accounts.createSession(user.id, tenant.id); accounts.logout(again.id); assert.equal(accounts.sessionUser(again.id), null);
    accounts.suspendTenant(tenant.id); assert.ok(accounts.tenant(tenant.id).suspendedAt); accounts.suspendTenant(tenant.id, false); assert.equal(accounts.tenant(tenant.id).suspendedAt, null);
  } finally { done(dir, accounts); }
});

test('invitations: a token joins a new person as a member; the owner cannot be removed; roles are bounded', () => {
  let clock = 5_000_000; const { dir, accounts } = open(() => clock);
  try {
    const owner = accounts.createUser({ email: 'owner@acme.test', name: 'Owner', password: 'a long enough password' });
    const tenant = accounts.createTenant({ name: 'Acme', ownerId: owner.id });
    const inv = accounts.invite({ tenantId: tenant.id, email: 'Sam@acme.test', role: 'member', invitedBy: owner.id });
    assert.equal(inv.email, 'sam@acme.test'); assert.equal(accounts.invites(tenant.id).length, 1);
    assert.throws(() => accounts.acceptInvite('wrong-token', { name: 'Sam', password: 'a long enough password' }), /expired or was already used/);
    const { user: sam } = accounts.acceptInvite(inv.token, { name: 'Sam', password: 'another long password' });
    assert.equal(accounts.membership(sam.id, tenant.id).role, 'member');
    assert.throws(() => accounts.acceptInvite(inv.token, { name: 'Sam', password: 'another long password' }), /expired or was already used/, 'single use');
    assert.equal(accounts.members(tenant.id).length, 2);
    assert.equal(accounts.setRole(tenant.id, sam.id, 'admin').role, 'admin');
    assert.throws(() => accounts.setRole(tenant.id, owner.id, 'member'), /owner/);
    assert.throws(() => accounts.removeMember(tenant.id, owner.id), /cannot be removed/);
    const expiring = accounts.invite({ tenantId: tenant.id, email: 'late@acme.test' }); clock += 8 * 86400000;
    assert.throws(() => accounts.acceptInvite(expiring.token, { name: 'Late', password: 'a long enough password' }), /expired/);
    // Someone who already has an account joins with their own password.
    const other = accounts.createTenant({ name: 'Other Co', ownerId: sam.id });
    const cross = accounts.invite({ tenantId: other.id, email: 'owner@acme.test', role: 'member' });
    assert.throws(() => accounts.acceptInvite(cross.token, { password: 'not their password' }), /existing password/);
    accounts.acceptInvite(cross.token, { password: 'a long enough password' });
    assert.equal(accounts.tenantsOf(owner.id).length, 2);
    accounts.removeMember(tenant.id, sam.id); assert.equal(accounts.membership(sam.id, tenant.id), null);
  } finally { done(dir, accounts); }
});

test('member groups are per office, name their members, and share lists are checked against them', () => {
  const { dir, accounts } = open();
  try {
    const owner = accounts.createUser({ email: 'o@x.test', name: 'O', password: 'a long enough password' });
    const tenant = accounts.createTenant({ name: 'X Co', ownerId: owner.id });
    const member = accounts.createUser({ email: 'm@x.test', name: 'M', password: 'a long enough password' }); accounts.addMember(tenant.id, member.id, 'member');
    const stranger = accounts.createUser({ email: 's@y.test', name: 'S', password: 'a long enough password' });
    const sales = accounts.createGroup(tenant.id, 'Sales staff', owner.id);
    assert.throws(() => accounts.createGroup(tenant.id, 'Sales staff'), /already a group/);
    accounts.setGroupMembers(tenant.id, sales.id, [member.id]);
    assert.deepEqual(accounts.groupsOf(member.id, tenant.id), [sales.id]); assert.deepEqual(accounts.groupsOf(owner.id, tenant.id), []);
    assert.throws(() => accounts.setGroupMembers(tenant.id, sales.id, [stranger.id]), /belong to this office/);
    assert.deepEqual(accounts.validAudience(tenant.id, { users: [member.id, member.id], groups: [sales.id] }), { users: [member.id], groups: [sales.id] });
    assert.throws(() => accounts.validAudience(tenant.id, { users: [stranger.id] }), /people who are in this office/);
    assert.throws(() => accounts.validAudience(tenant.id, { groups: ['g_nope'] }), /groups of this office/);
    assert.equal(accounts.renameGroup(tenant.id, sales.id, 'Sales team').name, 'Sales team');
    accounts.deleteGroup(tenant.id, sales.id); assert.equal(accounts.groups(tenant.id).length, 0);
  } finally { done(dir, accounts); }
});

test('mail aliases resolve only with the right suffix; senders must be verified; a provider message id is recorded once', () => {
  let clock = 9_000_000; const { dir, accounts } = open(() => clock);
  try {
    const owner = accounts.createUser({ email: 'dana@acme.test', name: 'Dana Q', password: 'a long enough password' });
    const tenant = accounts.createTenant({ name: 'Acme Widgets', ownerId: owner.id });
    const alias = accounts.mailHandleFor(owner.id, tenant.id);
    assert.equal(alias.handle, 'dana.q'); assert.match(alias.suffix, /^[a-z2-7]{6}$/);
    const local = `${tenant.slug}.${alias.handle}.${alias.suffix}`;
    assert.deepEqual(accounts.resolveAlias(local), { tenantId: tenant.id, userId: owner.id, tag: null });
    assert.deepEqual(accounts.resolveAlias(local.toUpperCase() + '+ab12cd34'), { tenantId: tenant.id, userId: owner.id, tag: 'ab12cd34' });
    assert.equal(accounts.resolveAlias(`${tenant.slug}.${alias.handle}.zzzzzz`), null, 'a guessed suffix is refused');
    const rotated = accounts.rotateMailSuffix(owner.id, tenant.id); assert.notEqual(rotated.suffix, alias.suffix); assert.equal(accounts.resolveAlias(local), null);
    assert.equal(accounts.isSenderAllowed(owner.id, tenant.id, 'Dana@Acme.test'), true, 'the account email is always allowed');
    assert.equal(accounts.isSenderAllowed(owner.id, tenant.id, 'dana@gmail.test'), false);
    const s = accounts.addSender(owner.id, tenant.id, 'dana@gmail.test'); assert.match(s.code, /^\d{6}$/);
    assert.throws(() => accounts.verifySender(owner.id, tenant.id, s.id, '000000'), /not right/);
    accounts.verifySender(owner.id, tenant.id, s.id, s.code);
    assert.equal(accounts.isSenderAllowed(owner.id, tenant.id, 'dana@gmail.test'), true);
    const late = accounts.addSender(owner.id, tenant.id, 'late@gmail.test'); clock += 11 * 60000;
    assert.throws(() => accounts.verifySender(owner.id, tenant.id, late.id, late.code), /expired/);
    assert.equal(accounts.recordInbound({ provider: 'postmark', providerMessageId: 'pm-1', tenantId: tenant.id }), true);
    assert.equal(accounts.recordInbound({ provider: 'postmark', providerMessageId: 'pm-1' }), false, 'duplicate');
    accounts.recordMailMessage({ tenantId: tenant.id, jobId: 'job-1', direction: 'out', messageId: '<abc@office>' });
    assert.deepEqual(accounts.findThread(['<nope>', '<abc@office>']), { tenantId: tenant.id, jobId: 'job-1' });
  } finally { done(dir, accounts); }
});
