// Office-wide settings the CEO edits in Settings → Office. Stored in data/settings.json.
import fs from 'node:fs';
import path from 'node:path';

export const SETTINGS_DEFAULTS = { maxConcurrentJobs: 4, runTimeoutMinutes: 20, escalateAfterHours: 1, outboundTools: [], readOnlyTools: [], digestTime: '08:00', knowledgeSeedNotes: 6, publicOrigin: '', officeName: '', fastLane: true, approvals: true, sandbox: true, sandboxCommandMinutes: 5, sandboxIdleMinutes: 20 };
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const number = (value, fallback, min, max, label) => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value); if (!Number.isFinite(n) || n < min || n > max) fail(`${label} must be between ${min} and ${max}.`); return n;
};
const names = (value, label) => { if (value === undefined) return []; if (!Array.isArray(value) || value.length > 200 || value.some(v => typeof v !== 'string' || !v.trim() || v.length > 160)) fail(`${label} must be a list of tool names.`); return [...new Set(value.map(v => v.trim()))]; };

export class SettingsStore {
  constructor({ dataDir }) {
    this.file = path.join(dataDir, 'settings.json'); fs.mkdirSync(dataDir, { recursive: true });
    this.value = this.validate(fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {});
  }
  validate(input = {}) {
    const d = SETTINGS_DEFAULTS;
    const digestTime = input.digestTime ?? d.digestTime; if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(digestTime)) fail('Digest time must be HH:MM.');
    const officeName = String(input.officeName ?? '').trim().slice(0, 80);
    let publicOrigin = String(input.publicOrigin ?? '').trim().replace(/\/$/, '');
    if (publicOrigin) { let url; try { url = new URL(publicOrigin); } catch { fail('Public address must be a URL such as https://office.example.com.'); } if (url.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) fail('Public address must use HTTPS.'); publicOrigin = url.origin; }
    return { maxConcurrentJobs: Math.round(number(input.maxConcurrentJobs, d.maxConcurrentJobs, 1, 8, 'Tasks running at once')), runTimeoutMinutes: number(input.runTimeoutMinutes, d.runTimeoutMinutes, 1, 480, 'Minutes without progress before a run stops'),
      escalateAfterHours: number(input.escalateAfterHours, d.escalateAfterHours, 0.25, 72, 'Escalate after (hours)'), outboundTools: names(input.outboundTools, 'Always ask before'), readOnlyTools: names(input.readOnlyTools, 'Never ask before'),
      digestTime, knowledgeSeedNotes: Math.round(number(input.knowledgeSeedNotes, d.knowledgeSeedNotes, 0, 20, 'Brain notes given to planners')), publicOrigin, officeName,
      // The fast lane: quick work done by the lead alone. Off, and every task goes through the Program Manager.
      fastLane: input.fastLane === undefined ? d.fastLane : !(input.fastLane === false || input.fastLane === 0 || /^(false|no|0|off)$/i.test(String(input.fastLane))),
      approvals: input.approvals === undefined ? d.approvals : !(input.approvals === false || input.approvals === 0 || /^(false|no|0|off)$/i.test(String(input.approvals))),
      // The sandbox (people granted it run code in a throwaway container per task): on or off, a command's time limit, how long an idle one lives.
      sandbox: input.sandbox === undefined ? d.sandbox : !(input.sandbox === false || input.sandbox === 0 || /^(false|no|0|off)$/i.test(String(input.sandbox))),
      sandboxCommandMinutes: Math.round(number(input.sandboxCommandMinutes, d.sandboxCommandMinutes, 1, 15, 'Minutes a sandbox command may run')), sandboxIdleMinutes: Math.round(number(input.sandboxIdleMinutes, d.sandboxIdleMinutes, 5, 240, 'Minutes an idle sandbox is kept')) };
  }
  get() { return structuredClone(this.value); }
  update(input) {
    this.value = this.validate({ ...this.value, ...input });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.value, null, 2), { mode: 0o600 }); fs.renameSync(this.file + '.tmp', this.file);
    return this.get();
  }
}
