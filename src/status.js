// One status vocabulary for the Manage area, and the office roll-up the directory and the rail read.
// A mark is a coloured dot and a word: Connected, Signed in, Failed, Not set, Waits for you, Saved… the same everywhere.
import { MANAGED_MODELS, PLATFORM_ONLY } from './session.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const mark = (kind, label, attrs = '') => `<span class="mg-st mg-st-${kind}" ${attrs}><i></i>${esc(label)}</span>`;
export const dot = (kind, title = '') => `<span class="mg-dot mg-dot-${kind}" ${title ? `title="${esc(title)}"` : ''}></span>`;
export const ago = at => { if (!at) return '—'; const s = Math.max(0, (Date.now() - at) / 1000); if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
export const clock = at => at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

/** The connection of one connector, in the vocabulary. The server says 'unavailable' whenever the MCP handshake produced no tools. */
export function toolState(t) {
  if (t.type === 'builtin') return { kind: 'ok', label: 'Always available', hint: '' };
  if (t.status === 'connected') return { kind: 'ok', label: t.auth === 'signed-in' ? 'Signed in' : 'Connected', hint: '' };
  if (t.status === 'connecting') return { kind: 'busy', label: 'Connecting…', hint: 'Checking the server now. This row updates by itself.' };
  if (t.status === 'unavailable') {
    if (['http', 'sse'].includes(t.type) && t.auth !== 'signed-in' && !t.hasToken) return { kind: 'warn', label: 'Signed out', hint: 'Press Sign in, or edit the connection to add a bearer token.' };
    if (['http', 'sse'].includes(t.type) && t.auth === 'signed-in') return { kind: 'fail', label: 'Sign-in expired', hint: 'The server answered with no tools. Sign in again.' };
    return { kind: 'fail', label: 'Connection failed', hint: t.type === 'stdio' ? 'The command did not start or offered no tools. Check the executable and arguments, then press Check connections.' : 'The server answered with no tools. Check the URL and the sign-in, then press Check connections.' };
  }
  return { kind: 'off', label: 'Not checked yet', hint: 'Press Check connections.' };
}

/** The roll-up: one object the directory, the rail and the area headers read. Cached for a short while; `force` refreshes. */
let cache = null, cachedAt = 0, inflight = null;
export async function officeSummary(api, { force = false } = {}) {
  // A platform administrator's session belongs to no office, so every one of these would be refused (403).
  // It asks for nothing and says so with null; the directory and the rail show the Platform line instead.
  if (PLATFORM_ONLY) return null;
  if (!force && cache && Date.now() - cachedAt < 15000) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const soft = p => p.catch(() => null);
    const [health, tools, routines, projects, vault, arts, audit, inbox] = await Promise.all([
      api('/health'), soft(api('/tools')), soft(api('/routines')), soft(api('/projects')), soft(api('/vault')), soft(api('/artifacts?kind=documents')), soft(api('/audit?limit=1')), soft(api('/inbox')),
    ]);
    const own = (tools || []).filter(t => t.type !== 'candidate'), states = own.map(t => ({ t, s: toolState(t) }));
    const failed = states.filter(x => x.s.kind === 'fail'), signedOut = states.filter(x => x.s.kind === 'warn');
    const providers = health.providers?.providers || [], keyed = providers.filter(p => p.hasKey || p.usable), rejected = providers.filter(p => p.lastTest && p.lastTest.ok === false);
    const rs = routines?.routines || [], paused = rs.filter(r => r.paused), late = rs.filter(r => r.lastLate), next = rs.filter(r => r.nextAt).sort((a, b) => a.nextAt - b.nextAt)[0];
    const open = (projects?.projects || []).filter(p => p.status !== 'archived'), soonest = open.map(p => p.next).filter(n => n?.dueAt).sort((a, b) => a.dueAt - b.dueAt)[0];
    const entries = vault?.entries || [], noSecret = entries.filter(e => !e.hasSecret);
    const needs = health.inbox?.needsYou ?? inbox?.counts?.needsYou ?? 0, unread = health.inbox?.unread ?? inbox?.counts?.unread ?? 0;
    const attention = [];
    for (const x of failed) attention.push({ kind: 'fail', label: x.s.label, text: `${x.t.name}: ${x.s.hint || 'the connection failed.'}`, go: 'tools', action: ['http', 'sse'].includes(x.t.type) ? 'Sign in' : 'Check' });
    if (!health.ready) attention.push(MANAGED_MODELS ? { kind: 'warn', label: 'Not set', text: 'No model can run yet. The platform administrator adds one.', go: 'profile', action: 'Details' } : { kind: 'warn', label: 'Not set', text: 'No model can run yet. Save a provider key and activate a model.', go: 'models', action: 'Add key' });
    for (const p of rejected) attention.push({ kind: 'fail', label: 'Key rejected', text: `${p.label} refused the stored key.`, go: 'models', action: 'Replace key' });
    if (needs) attention.push({ kind: 'warn', label: 'Waits for you', text: `${needs} task${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} your decision.`, go: 'inbox', action: 'Open inbox' });
    for (const r of late) attention.push({ kind: 'warn', label: 'Ran late', text: `Routine “${r.title}” ran later than planned.`, go: 'routines', action: 'Review' });
    for (const e of noSecret) attention.push({ kind: 'warn', label: 'Not set', text: `Vault entry “${e.name || e.id}” has no secret yet.`, go: 'vault', action: 'Add secret' });
    if (health.faults?.length) attention.push({ kind: 'fail', label: 'Failed', text: String(health.faults[health.faults.length - 1]?.message || health.faults[health.faults.length - 1] || 'The server logged a fault.').slice(0, 140), go: 'audit', action: 'Details' });
    const teams = health.teams || [], agents = health.agents || [];
    const providerLine = health.provider?.last ? `provider answering in ${(health.provider.last.ms / 1000).toFixed(1)} s` : health.provider?.lastHour ? `${health.provider.lastHour} provider failures in the last hour` : '';
    cache = {
      at: Date.now(), name: health.name, version: health.version, ready: health.ready, needs, unread, attention,
      areas: {
        teams: { line: `${teams.length} team${teams.length === 1 ? '' : 's'} · ${agents.length} people`, count: agents.length },
        projects: { line: projects ? `${open.length} open${soonest ? ' · milestone ' + new Date(soonest.dueAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}` : '', count: open.length },
        routines: { line: routines ? (rs.length ? `${rs.length} scheduled${next ? ' · next ' + clock(next.nextAt) : ''}${paused.length ? ' · ' + paused.length + ' paused' : ''}` : 'none yet') : '', count: rs.length, dot: late.length ? 'warn' : '' },
        brain: { line: `${Number(health.knowledge?.notes ?? health.notes ?? 0).toLocaleString()} notes${health.knowledge?.passages ? ' · index fresh' : ''}`, count: health.knowledge?.notes ?? health.notes ?? 0 },
        skills: { line: '', count: null },
        artifacts: { line: arts ? `${arts.total} document${arts.total === 1 ? '' : 's'}` : '', count: arts?.total },
        reports: { line: 'last 7 days', count: null },
        models: MANAGED_MODELS ? { line: `provided by the platform · ${health.ready ? 'ready' : 'not ready'}`, dot: health.ready ? 'ok' : 'warn' } : { line: `${keyed.length} of ${providers.length} provider${providers.length === 1 ? '' : 's'} keyed · ${health.ready ? 'ready' : 'not ready'}`, dot: health.ready ? (rejected.length ? 'fail' : 'ok') : 'warn' },
        tools: { line: tools ? `${own.length} connector${own.length === 1 ? '' : 's'}${failed.length ? ' · ' + failed.length + ' failed' : signedOut.length ? ' · ' + signedOut.length + ' signed out' : ''}` : '', dot: failed.length ? 'fail' : signedOut.length ? 'warn' : own.length ? 'ok' : '' },
        vault: { line: vault ? `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}${noSecret.length ? ' · ' + noSecret.length + ' without a secret' : ''}` : '', dot: entries.length ? (noSecret.length ? 'warn' : 'ok') : '' },
        profile: { line: health.name || '' },
        office: { line: `${health.settings?.maxConcurrentJobs ?? '—'} tasks at once · digest ${health.settings?.digestTime || '—'}` },
        audit: { line: audit?.[0] ? `#${audit[0].seq} · ${ago(audit[0].at)}` : '', count: audit?.[0]?.seq },
      },
      foot: [health.ready ? 'Models ready' : 'No model ready', providerLine].filter(Boolean).join(' · '),
      healthy: health.ready && !failed.length && !rejected.length && !health.faults?.length,
    };
    cachedAt = Date.now(); return cache;
  })().finally(() => { inflight = null; });
  return inflight;
}
export const dropSummary = () => { cache = null; };
