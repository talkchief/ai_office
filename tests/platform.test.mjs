import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PlatformStore, validatePlatform } from '../platform.mjs';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-platform-'));

test('platform limits are bounded and refused with a sentence; admin emails and registration persist', () => {
  const dir = temp();
  try {
    const platform = new PlatformStore({ dir, env: {}, adminEmails: ['Admin@Platform.test'] });
    assert.deepEqual(platform.limits(), { maxTeams: 10, maxMembersPerTeam: 7 });
    assert.equal(platform.registrationOpen(), true);
    assert.ok(platform.isAdmin({ email: 'admin@platform.test' })); assert.ok(!platform.isAdmin({ email: 'someone@else.test' })); assert.ok(platform.isAdmin({ email: 'x@y.test', platformAdmin: true }));
    assert.throws(() => platform.update({ limits: { maxTeams: 0 } }), /1 to 50/);
    assert.throws(() => platform.update({ limits: { maxMembersPerTeam: 21 } }), /2 to 20/);
    assert.throws(() => validatePlatform({ registration: 'anyone' }), /open or invite/);
    platform.update({ limits: { maxTeams: 2 }, registration: 'invite', adminEmails: ['a@b.test', 'not-an-email'] });
    const again = new PlatformStore({ dir, env: {} });
    assert.deepEqual(again.limits(), { maxTeams: 2, maxMembersPerTeam: 7 }); assert.equal(again.registrationOpen(), false); assert.deepEqual(again.get().adminEmails, ['a@b.test']);
    assert.ok(fs.existsSync(path.join(dir, 'providers.json')) || again.models.value.providers.length >= 1, 'the platform has the one model registry');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an office store honours the platform limits: a third team is refused when the limit is two, and the number is in the sentence', () => {
  const dir = temp();
  try {
    const store = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents, limits: { maxTeams: 2, maxMembersPerTeam: 3 } });
    assert.equal(store.get().teams.length, 6, 'a shipped office with six teams still loads under a lower limit');
    const config = store.get(); config.teams.push({ ...config.teams[0], id: 'seventh', name: 'Seventh', lead: 'ghost' });
    assert.throws(() => store.update(config), /1–2 teams/);
    const trimmed = store.get(); const keep = new Set(['emails', 'sales']);
    trimmed.teams = trimmed.teams.filter(t => keep.has(t.id)); trimmed.agents = trimmed.agents.filter(a => keep.has(a.department));
    assert.throws(() => store.update(trimmed), /maximum of 3 agents \(a lead and 2 specialists\)/, 'the per-team limit names its number');
    const loose = new OfficeStore({ dataDir: temp(), initialAgents: loadRoster().agents, limits: { maxTeams: 'many', maxMembersPerTeam: -1 } });
    assert.deepEqual(loose.limits, { maxTeams: 10, maxMembersPerTeam: 7 }, 'bad limit values fall back to the defaults');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
