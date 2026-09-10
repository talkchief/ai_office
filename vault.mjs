// The Vault: a secret store like a code host's, for the credentials agents use without ever seeing them. Every entry has a kind:
//   api       an outside service (base address, the header it expects, the key) that agents call through api_get / api_request
//   database  a database connection (host, port, database, user, password) for the database connector
//   ssh       an SSH target (host, port, user, private key or password) for the SSH connector
// The CEO adds an entry under Settings → Vault; the office injects the secret where it is needed; the secret never reaches a
// prompt, a report, a log or the API (which only ever says whether one is stored).
import fs from 'node:fs';
import path from 'node:path';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (value, max) => String(value ?? '').trim().slice(0, max);
export const VAULT_KINDS = ['api', 'database', 'ssh'];

export class VaultStore {
  constructor({ dataDir }) { this.file = path.join(dataDir, 'vault.json'); this.value = { version: 1, services: [] }; this.load(); }
  load() { try { const v = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (Array.isArray(v?.services)) this.value = { version: 1, services: v.services }; } catch {} }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.value, null, 1), { mode: 0o600 }); try { fs.chmodSync(this.file, 0o600); } catch {}
  }
  // What the API and the screens see: everything but the secret.
  list() { return this.value.services.map(({ secret, ...s }) => ({ ...s, hasSecret: !!secret })); }
  get(id) { return this.value.services.find(s => s.id === id) || null; }
  upsert(input = {}) {
    const id = text(input.id, 40).toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!id) fail('Give the entry a short id, such as here.now or crm-db.');
    const before = this.get(id), kind = VAULT_KINDS.includes(input.kind) ? input.kind : before?.kind || 'api';
    // The secret is write-only: a blank field keeps the stored one, clearSecret removes it.
    const secret = input.clearSecret ? '' : typeof input.secret === 'string' && input.secret.trim() ? input.secret.trim() : before?.secret || '';
    if (secret.length > 16384) fail(`${id}: the secret is too long.`);
    if (kind !== 'ssh' && /[\r\n]/.test(secret)) fail(`${id}: a key is a single line.`);
    const teams = Array.isArray(input.teams) ? [...new Set(input.teams.map(t => text(t, 40)).filter(Boolean))].slice(0, 20) : before?.teams || [];
    const entry = { id, kind, name: text(input.name, 80) || before?.name || id, secret, teams, notes: text(input.notes ?? before?.notes, 500), updatedAt: Date.now() };
    if (kind === 'api') {
      let url; try { url = new URL(text(input.baseURL ?? before?.baseURL, 300)); } catch { fail('Base URL must be a full address, such as https://here.now/api/v1.'); }
      if (url.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) fail('Base URL must use HTTPS.');
      const authHeader = text(input.authHeader, 60) || before?.authHeader || 'Authorization';
      if (!/^[A-Za-z0-9-]+$/.test(authHeader)) fail('The header name may hold letters, digits and dashes only.');
      Object.assign(entry, { baseURL: url.origin + url.pathname.replace(/\/+$/, ''), authHeader, authPrefix: input.authPrefix === undefined ? (before?.authPrefix ?? 'Bearer ') : String(input.authPrefix).slice(0, 40) });
    } else {
      const host = text(input.host ?? before?.host, 253); if (!host) fail('Give the host name or address.');
      const port = Number(input.port ?? before?.port ?? (kind === 'ssh' ? 22 : 5432)); if (!Number.isInteger(port) || port < 1 || port > 65535) fail('Port must be a number between 1 and 65535.');
      Object.assign(entry, { host, port, username: text(input.username ?? before?.username, 120), ...(kind === 'database' ? { database: text(input.database ?? before?.database, 120), engine: text(input.engine ?? before?.engine, 40) || 'postgres' } : {}) });
    }
    this.value.services = [...this.value.services.filter(s => s.id !== id), entry].sort((a, b) => a.id.localeCompare(b.id));
    this.save();
    return this.list().find(s => s.id === id);
  }
  remove(id) { if (!this.get(id)) fail('No such entry.', 404); this.value.services = this.value.services.filter(s => s.id !== id); this.save(); return { removed: id }; }
  // What one team may use: entries open to every team, or naming that team. Agents' API tools use the api kind only.
  forTeam(teamId, kind = 'api') { return this.value.services.filter(s => (!kind || s.kind === kind) && (!s.teams?.length || s.teams.includes(teamId))); }
  // Every occurrence of a secret in a text is masked before the text reaches an agent or a log.
  mask(value) { let out = String(value ?? ''); for (const s of this.value.services) if (s.secret && s.secret.length >= 6) out = out.split(s.secret).join('[secret]'); return out; }
}
