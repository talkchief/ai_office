import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../accounts.mjs';
import { PlatformStore } from '../platform.mjs';
import { TenantRegistry } from '../tenant-registry.mjs';
import * as routines from '../routines.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-registry-'));

test('a tenant is provisioned with the shipped seats, served lazily, put away only when idle, and woken by a due routine', async () => {
  const root = temp(); let clock = Date.now();
  const accounts = new Accounts({ file: path.join(root, 'accounts.sqlite'), now: () => clock });
  const platform = new PlatformStore({ dir: path.join(root, 'platform'), env: {} });
  const registry = new TenantRegistry({ accounts, platform, dir: path.join(root, 'tenants'), version: 'test', log: () => {}, idleMs: 60000, now: () => clock });
  try {
    const owner = accounts.createUser({ email: 'o@acme.test', name: 'Owner', password: 'a long enough password' });
    const tenant = accounts.createTenant({ name: 'Acme', ownerId: owner.id });
    const instance = await registry.provision(tenant);
    assert.equal(instance.office.get().teams.length, 6); assert.equal(instance.office.get().agents.length, 35);
    assert.equal(instance.name, 'Acme'); assert.equal(instance.managedModels, true); assert.equal(instance.tenant.ownerId, owner.id);
    assert.ok(fs.existsSync(path.join(root, 'tenants', tenant.id, 'data', 'office.json'))); assert.ok(!fs.existsSync(path.join(root, 'tenants', tenant.id, 'data', 'providers.json')), 'no per-tenant providers file');
    assert.deepEqual(registry.loaded(), [tenant.id]);
    assert.equal(await registry.get(tenant.id), instance, 'the same instance is served again');
    // Not idle for long enough: stays. Idle past the window: put away. A queued task keeps it.
    assert.deepEqual(await registry.evictIdle(), []);
    const job = instance.engine.create({ dept: 'sales', text: 'Keep me', autoStart: false }); clock += 120000;
    assert.deepEqual(await registry.evictIdle(), [], 'a queued task keeps the office loaded');
    instance.engine.cancel(job.id);
    assert.deepEqual(await registry.evictIdle(), [tenant.id]); assert.deepEqual(registry.loaded(), []);
    // A routine due in the evicted office wakes it: the office's own load sets the next run, it is put away, then the run falls due.
    const d = registry.dirs(tenant.id), agents = JSON.parse(fs.readFileSync(path.join(d.data, 'office.json'), 'utf8')).agents;
    const soon = new Date(Date.now() + 10 * 60000), at = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;
    routines.save(d.brain, [{ id: 'morning', dept: 'sales', agent: agents.find(a => a.department === 'sales').id, title: 'Morning list', text: 'List the open deals.', when: { kind: 'daily', at }, needsOk: true, paused: false }]);
    (await registry.get(tenant.id)).loadRoutines(); clock += 120000;
    assert.deepEqual(await registry.evictIdle(), [tenant.id]);
    assert.deepEqual(registry.dueElsewhere(), [], 'not due yet');
    clock += 12 * 60000; assert.deepEqual(registry.dueElsewhere(), [tenant.id]); await registry.tick(); await new Promise(r => setTimeout(r, 50)); await registry.get(tenant.id);
    assert.deepEqual(registry.loaded(), [tenant.id], 'woken up');
    const again = registry.peek(tenant.id);
    assert.ok(again.loadRoutines().some(r => r.id === 'morning'));
    assert.equal(again.engine.get(job.id)?.state, 'cancelled', 'the same data folder');
  } finally { await registry.closeAll(); accounts.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }); }
});
