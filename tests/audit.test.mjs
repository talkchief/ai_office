import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { AuditLog, diff } from '../audit.mjs';

test('configuration changes are recorded field by field, by id, with secrets redacted', () => {
  const log = new AuditLog({ db: SqliteSaver.fromConnString(':memory:').db });
  const before = { teams: [{ id: 'sales', name: 'Sales', maxParallelRuns: 2 }, { id: 'fin', name: 'Finance' }], providers: [{ id: 'openrouter', apiKey: 'sk-or-old' }] };
  const after = { teams: [{ id: 'fin', name: 'Finance' }, { id: 'sales', name: 'Sales team', maxParallelRuns: 3 }], providers: [{ id: 'openrouter', apiKey: 'sk-or-new' }] };
  const entry = log.record({ area: 'office', summary: 'Edited teams', before, after });
  assert.deepEqual(entry.diff.map(d => d.path), ['teams[sales].name', 'teams[sales].maxParallelRuns', 'providers[openrouter].apiKey']);
  assert.doesNotMatch(JSON.stringify(entry), /sk-or-/); assert.equal(entry.diff[2].after, '[redacted]');
  assert.equal(log.record({ area: 'office', summary: 'No change', before, after: structuredClone(before) }), null);
  log.record({ area: 'tools', summary: 'Removed Gmail' });
  assert.deepEqual(log.list().map(e => e.area), ['tools', 'office']); assert.equal(log.list({ area: 'office' }).length, 1);
  assert.deepEqual(diff({ headers: { Authorization: 'Bearer x' } }, { headers: { Authorization: 'Bearer y' } })[0], { path: 'headers.Authorization', before: '[redacted]', after: '[redacted]' });
});
