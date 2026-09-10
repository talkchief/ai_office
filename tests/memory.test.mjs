import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SqliteMemoryStore, OfficeMemory, MEMORY_NAMESPACES } from '../office-memory.mjs';
import { OfficeStore } from '../office-store.mjs';
import { loadRoster } from '../roster.mjs';
import { officeBackend, FILE_PERMISSIONS } from '../engine/backend.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'talkchief-memory-'));

test('the memory store answers get, search, list and delete, and survives reopening the file', async () => {
  const dir = temp(), file = path.join(dir, 'm.sqlite');
  const store = new SqliteMemoryStore(new Database(file));
  await store.put(['office', 'memories'], '/company/org-chart.md', { content: 'chart', created_at: 'a', modified_at: 'a' });
  await store.put(['office', 'memories'], '/notes/riley.md', { content: 'note', kind: 'note', created_at: 'a', modified_at: 'a' });
  await store.put(['office', 'other'], '/x', { content: 'elsewhere', created_at: 'a', modified_at: 'a' });
  assert.equal((await store.get(['office', 'memories'], '/company/org-chart.md')).value.content, 'chart');
  assert.equal(await store.get(['office', 'memories'], '/missing'), null);
  assert.deepEqual((await store.search(['office', 'memories'])).map(i => i.key), ['/company/org-chart.md', '/notes/riley.md']);
  assert.deepEqual((await store.search(['office', 'memories'], { filter: { kind: 'note' } })).map(i => i.key), ['/notes/riley.md']);
  assert.deepEqual((await store.search(['office'], { limit: 1, offset: 1 })).map(i => i.key), ['/notes/riley.md']);
  assert.deepEqual(await store.listNamespaces({ prefix: ['office'] }), [['office', 'memories'], ['office', 'other']]);
  assert.deepEqual(await store.listNamespaces({ suffix: ['other'] }), [['office', 'other']]);
  assert.deepEqual(await store.listNamespaces({ maxDepth: 1 }), [['office']]);
  const first = await store.get(['office', 'memories'], '/company/org-chart.md');
  await store.put(['office', 'memories'], '/company/org-chart.md', { content: 'chart 2', created_at: 'a', modified_at: 'b' });
  const second = await store.get(['office', 'memories'], '/company/org-chart.md');
  assert.equal(second.value.content, 'chart 2'); assert.equal(second.createdAt.getTime(), first.createdAt.getTime(), 'a rewrite keeps the creation time');
  await store.delete(['office', 'memories'], '/notes/riley.md');
  assert.equal(await store.get(['office', 'memories'], '/notes/riley.md'), null);
  const reopened = new SqliteMemoryStore(new Database(file));
  assert.equal((await reopened.get(['office', 'memories'], '/company/org-chart.md')).value.content, 'chart 2', 'memory is on disk');
});

test('the office keeps the org chart, the connectors and one page per team in memory, in the file format agents read', async () => {
  const dir = temp();
  const office = new OfficeStore({ dataDir: dir, initialAgents: loadRoster().agents });
  const cfg = office.get(); cfg.teams.find(t => t.id === 'emails').tools = ['web', 'Google_Calendar']; office.update(cfg);
  const tools = () => [
    { id: 'web', name: 'Web search & fetch', status: 'available', assignedTeams: [{ id: 'emails', name: 'EMAILS' }] },
    { id: 'Google_Calendar', name: 'Google Calendar', status: 'connected', assignedTeams: [{ id: 'emails', name: 'EMAILS' }] },
  ];
  const memory = new OfficeMemory({ db: new Database(path.join(dir, 'm.sqlite')), office, tools, name: 'Northgate', projects: () => projectsList });
  let projectsList = [];
  const first = await memory.refresh();
  assert.deepEqual({ teams: first.teams, tools: first.tools }, { teams: 6, tools: 2 });
  assert.equal(first.changed, 9, 'org chart, connectors, projects and six team pages');
  assert.match(await memory.readCompany('projects.md'), /^# Projects[\s\S]*No projects yet\./);
  const chart = await memory.readCompany('org-chart.md');
  assert.match(chart, /^# Northgate: who does what/);
  assert.match(chart, /## EMAILS \(emails\)[\s\S]*Tools: Web search & fetch, Google Calendar/);
  assert.match(chart, /## MARKETING \(marketing\)[\s\S]*Tools: none besides the Brain/);
  assert.match(chart, /RESEARCH, Daily Research Agent: Scans/);
  assert.match(chart, new RegExp(office.get().teams[0].purpose.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(await memory.readCompany('connectors.md'), /Google Calendar \(Google_Calendar\): connected\. Teams: EMAILS/);
  const fin = await memory.readTeam('fin');
  assert.match(fin, /^# FINANCE[\s\S]*## FINANCE \(fin\)/);
  assert.ok(!fin.includes('## EMAILS'), 'a team page carries that team only');
  const item = await memory.store.get(MEMORY_NAMESPACES.company, '/org-chart.md');
  assert.equal(item.value.mimeType, 'text/markdown'); assert.equal(typeof item.value.created_at, 'string'); assert.equal(typeof item.value.modified_at, 'string');
  assert.equal((await memory.refresh()).changed, 9, 'the timestamp line changes every refresh');

  // A change to the office lands in memory on the next refresh.
  const next = office.get(); next.teams.find(t => t.id === 'sales').tools = ['web']; office.update(next);
  await memory.refresh();
  assert.match(await memory.readCompany('org-chart.md'), /## SALES \(sales\)[\s\S]*Tools: Web search & fetch/);
  assert.match(await memory.readTeam('sales'), /Tools: Web search & fetch/);
  projectsList = [{ id: 'relaunch', name: 'Website relaunch', status: 'active', teams: ['marketing'], next: 'Design signed off by 2026-10-20', open: 2, done: 1, page: 'Projects/relaunch/project.md' }];
  await memory.refresh();
  assert.match(await memory.readCompany('projects.md'), /- Website relaunch \(relaunch\): active, owned by marketing\. Next milestone: Design signed off by 2026-10-20\. Tasks: 2 open, 1 done\. Page: \/knowledge\/Projects\/relaunch\/project\.md/);
});

test('each role gets only the memory it may see: the company for the Program Manager, one page for a team, notes for all', () => {
  const dir = temp();
  const memory = new OfficeMemory({ db: new Database(path.join(dir, 'm.sqlite')), office: { get: () => ({ teams: [], agents: [], skills: [] }) } });
  const pm = officeBackend({ workspaceDir: path.join(dir, 'w1'), knowledgeDir: path.join(dir, 'brain'), memoryRoutes: memory.routesFor({ role: 'pm' }) });
  assert.ok(pm.routePrefixes.includes('/memories/company/') && pm.routePrefixes.includes('/memories/notes/'));
  assert.ok(!pm.routePrefixes.includes('/memories/team/'));
  const lead = officeBackend({ workspaceDir: path.join(dir, 'w2'), knowledgeDir: path.join(dir, 'brain'), memoryRoutes: memory.routesFor({ role: 'lead', teamId: 'fin' }) });
  assert.ok(lead.routePrefixes.includes('/memories/team/') && lead.routePrefixes.includes('/memories/notes/'));
  assert.ok(!lead.routePrefixes.includes('/memories/company/'), 'a lead never sees the company pages');
  assert.deepEqual(MEMORY_NAMESPACES.team('fin'), ['office', 'memories', 'teams', 'fin']);
  assert.ok(!officeBackend({ workspaceDir: path.join(dir, 'w3'), knowledgeDir: path.join(dir, 'brain') }).routePrefixes.some(r => r.startsWith('/memories/')), 'no memory, no mounts');
  const denied = FILE_PERMISSIONS.filter(p => p.mode === 'deny' && p.operations.includes('write')).flatMap(p => p.paths);
  assert.ok(denied.includes('/memories/company/**') && denied.includes('/memories/team/**'));
  assert.ok(!denied.some(p => p.startsWith('/memories/notes')), 'agents may keep their own notes');
});
