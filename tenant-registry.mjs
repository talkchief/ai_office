// One office per company, built when first needed and put away when idle. Each tenant has its own folder pair under
// AO_TENANTS_DIR (tenants/<id>/data and tenants/<id>/brain); all share the platform's model registry and one Agency.
// The registry wakes an evicted office when one of its routines falls due, so nothing on the timetable is missed.
import fs from 'node:fs';
import path from 'node:path';
import { createOfficeInstance } from './office-instance.mjs';
import { Agency } from './agency.mjs';
import * as routines from './routines.mjs';
import { assignOwners } from './migrations.mjs';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

export class TenantRegistry {
  constructor({ accounts, platform, dir, version = '?', agency = new Agency(), log = console.log, idleMs = 30 * 60000, maxLoaded = 50, now = () => Date.now(), brainTemplate = null, createInstance = createOfficeInstance, cfg = {}, onLoad = null }) {
    Object.assign(this, { accounts, platform, dir, version, agency, log, idleMs, maxLoaded, now, brainTemplate, createInstance, cfg, onLoad });
    this.instances = new Map(); this.loading = new Map(); this.timer = null; this.lastScan = 0;
    fs.mkdirSync(dir, { recursive: true });
  }
  // The platform panel's numbers when there is one, else the constructor's.
  idleLimitMs() { const m = this.platform?.get?.()?.tenants?.idleMinutes; return m ? m * 60000 : this.idleMs; }
  loadedLimit() { return this.platform?.get?.()?.tenants?.maxLoaded || this.maxLoaded; }
  dirs(id) { const root = path.join(this.dir, id); return { root, data: path.join(root, 'data'), brain: path.join(root, 'brain') }; }
  loaded() { return [...this.instances.keys()]; }
  peek(id) { return this.instances.get(id)?.instance || null; }
  // A viewer list for per-user digests and the owner for records without one; read live so a new member is seen at once.
  tenantContext(tenant) {
    const accounts = this.accounts;
    return { id: tenant.id, slug: tenant.slug, name: tenant.name, ownerId: tenant.ownerId, viewers: () => accounts.members(tenant.id).map(m => ({ id: m.id, role: m.role, email: m.email, name: m.name, groups: accounts.groupsOf(m.id, tenant.id) })), audience: sharedWith => accounts.validAudience(tenant.id, sharedWith) };
  }
  // Folders for a new office, the shipped Brain template if one is configured, then the first boot (which seeds the 35 seats).
  async provision(tenant) {
    const d = this.dirs(tenant.id);
    fs.mkdirSync(d.data, { recursive: true }); fs.mkdirSync(d.brain, { recursive: true });
    if (this.brainTemplate && fs.existsSync(this.brainTemplate)) fs.cpSync(this.brainTemplate, d.brain, { recursive: true, force: false });
    const instance = await this.get(tenant.id);
    if (!instance.settings.get().officeName) instance.settings.update({ officeName: tenant.name });
    return instance;
  }
  async get(id) {
    const entry = this.instances.get(id);
    if (entry) { entry.lastUsed = this.now(); return entry.instance; }
    if (this.loading.has(id)) return this.loading.get(id);
    const promise = this.load(id).finally(() => this.loading.delete(id));
    this.loading.set(id, promise); return promise;
  }
  async load(id) {
    const tenant = this.accounts.tenant(id); if (!tenant) fail('No such office.', 404);
    if (this.instances.size >= this.loadedLimit()) await this.evictIdle({ force: true });
    const d = this.dirs(id); fs.mkdirSync(d.data, { recursive: true }); fs.mkdirSync(d.brain, { recursive: true });
    const instance = await this.createInstance({ dataDir: d.data, brainDir: d.brain, cfg: { ...this.cfg, name: tenant.name }, name: tenant.name, version: this.version, models: this.platform.models, agency: this.agency, discovery: false, allowStdio: false, limits: this.platform.limits(), tenant: this.tenantContext(tenant), sandboxAllowed: () => !!this.platform.sandboxAllowed?.(), log: line => this.log(`  [${tenant.slug}]${line}`) });
    await instance.boot();
    try { assignOwners({ engine: instance.engine, projects: instance.projects, routines: instance.routineRecords, ownerId: tenant.ownerId }); } catch (error) { console.warn(`owners (${tenant.slug}):`, error.message); }
    try { await instance.scheduler.tick(); } catch (error) { console.warn(`scheduler (${tenant.slug}):`, error.message); }
    instance.start();
    this.instances.set(id, { instance, lastUsed: this.now(), loadedAt: this.now() });
    try { this.onLoad?.(instance); } catch (error) { console.warn('on load:', error.message); }
    this.log(`  office loaded: ${tenant.name} (${tenant.slug})`);
    return instance;
  }
  // An office may be put away only when nothing is happening in it: no run, nothing queued, no browser listening.
  idle(entry) {
    const e = entry.instance.engine;
    return e.running.size === 0 && e.waiting.length === 0 && entry.instance.bus.clients.size === 0 && !e.list().some(j => j.state === 'queued');
  }
  async evict(id) { const entry = this.instances.get(id); if (!entry) return false; this.instances.delete(id); await entry.instance.close(); this.log(`  office put away: ${id}`); return true; }
  async evictIdle({ force = false } = {}) {
    const t = this.now(), candidates = [...this.instances.entries()].filter(([, e]) => this.idle(e) && (force || t - e.lastUsed >= this.idleLimitMs())).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    const out = [];
    for (const [id] of force ? candidates.slice(0, 1) : candidates) { await this.evict(id); out.push(id); }
    return out;
  }
  // An evicted office whose routines file names a run that is due is loaded so its clock can fire it.
  dueElsewhere() {
    const t = this.now(), due = [];
    for (const tenant of this.accounts.tenants()) {
      if (tenant.suspendedAt || this.instances.has(tenant.id) || this.loading.has(tenant.id)) continue;
      const d = this.dirs(tenant.id); let agents = [];
      try { agents = JSON.parse(fs.readFileSync(path.join(d.data, 'office.json'), 'utf8')).agents || []; } catch { continue; }
      try {
        const loaded = routines.load(d.brain, agents); if (!loaded.routines.length) continue;
        const { list } = routines.withState(loaded.routines, routines.loadState(d.data), t);
        if (list.some(r => !r.paused && r.nextAt && r.nextAt <= t)) due.push(tenant.id);
      } catch {}
    }
    return due;
  }
  async tick() {
    try { await this.evictIdle(); } catch (error) { console.warn('registry:', error.message); }
    if (this.now() - this.lastScan >= 60000) {
      this.lastScan = this.now();
      for (const id of this.dueElsewhere()) this.get(id).catch(error => console.warn('wake-up:', error.message));
    }
  }
  start(intervalMs = 20000) { this.stop(); this.timer = setInterval(() => this.tick(), intervalMs); this.timer.unref?.(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async closeAll() { this.stop(); for (const id of [...this.instances.keys()]) await this.evict(id); }
  // For the admin panel: what is loaded and how busy it is.
  status(id) { const e = this.instances.get(id); return e ? { loaded: true, since: e.loadedAt, lastUsed: e.lastUsed, running: e.instance.engine.running.size, clients: e.instance.bus.clients.size } : { loaded: false }; }
}
