import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TYPES } from '../src/sse.js';

// The page subscribes to event types by name: one the server publishes but the page does not list never arrives.
test('the page listens for every event type the server publishes', () => {
  const published = new Set(), walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'tests', 'data', 'tenants', 'brain', 'backups', '.git'].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.mjs')) for (const m of fs.readFileSync(file, 'utf8').matchAll(/publish(?:Live)?\((?:[^,()]+,\s*)?'([a-z]+\.[a-z]+)'/g)) published.add(m[1]);
    }
  };
  walk(process.cwd());
  assert.ok(published.has('task.removed') && published.has('task.updated'), 'the scan finds the published types');
  assert.deepEqual([...published].filter(type => !TYPES.includes(type)).sort(), []);
});
