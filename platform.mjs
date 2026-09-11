// What every hosted office inherits and cannot change: the model providers, keys and activated models, and the limits.
// Lives in AO_PLATFORM_DIR (default data/platform/): platform.json for the limits and registration, providers.json for
// the one ModelRegistry. Process environment keys (ANTHROPIC_API_KEY, …) apply to this registry only.
import fs from 'node:fs';
import path from 'node:path';
import { ModelRegistry } from './models.mjs';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const DEFAULT_LIMITS = { maxTeams: 10, maxMembersPerTeam: 7 };
export const LIMIT_RANGES = { maxTeams: [1, 50], maxMembersPerTeam: [2, 20] };
export const REGISTRATIONS = ['open', 'invite'];
const email = value => String(value || '').trim().toLowerCase();

export function validatePlatform(input = {}, previous = {}) {
  const limits = {};
  for (const [key, [min, max]] of Object.entries(LIMIT_RANGES)) {
    const raw = input.limits?.[key] ?? previous.limits?.[key] ?? DEFAULT_LIMITS[key], n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) fail(`${key === 'maxTeams' ? 'The maximum number of AI teams per office' : 'The maximum number of agents per AI team'} must be a whole number from ${min} to ${max}.`);
    limits[key] = n;
  }
  const registration = input.registration ?? previous.registration ?? 'open';
  if (!REGISTRATIONS.includes(registration)) fail('Registration must be open or invite.');
  const adminEmails = [...new Set((Array.isArray(input.adminEmails) ? input.adminEmails : previous.adminEmails || []).map(email).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))].slice(0, 50);
  return { version: 1, limits, registration, adminEmails };
}

export class PlatformStore {
  constructor({ dir, env = process.env, adminEmails = [], registration = null }) {
    fs.mkdirSync(dir, { recursive: true });
    this.dir = dir; this.file = path.join(dir, 'platform.json');
    let stored = {}; try { stored = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    this.value = validatePlatform({ adminEmails: [...(stored.adminEmails || []), ...adminEmails], ...(registration ? { registration } : {}) }, stored);
    this.persist();
    this.models = new ModelRegistry({ dataDir: dir, env });
  }
  persist() { fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.value, null, 2)); fs.renameSync(this.file + '.tmp', this.file); }
  get() { return structuredClone(this.value); }
  limits() { return { ...this.value.limits }; }
  update(input) { this.value = validatePlatform(input, this.value); this.persist(); return this.get(); }
  isAdmin(user) { return !!user && (!!user.platformAdmin || this.value.adminEmails.includes(email(user.email))); }
  registrationOpen() { return this.value.registration === 'open'; }
}
