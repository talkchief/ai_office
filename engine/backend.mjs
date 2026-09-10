// Each task gets its own workspace at /work/; the Brain is mounted read-only at /knowledge/.
import fs from 'node:fs';
import { CompositeBackend, FilesystemBackend } from 'deepagents';

// Skills (Agent Skills folders with a SKILL.md) are mounted read-only under /skills/<source>/ and read on demand.
export function officeBackend({ workspaceDir, knowledgeDir, skillDirs = {} }) {
  fs.mkdirSync(workspaceDir, { recursive: true }); fs.mkdirSync(knowledgeDir, { recursive: true });
  const work = new FilesystemBackend({ rootDir: workspaceDir, virtualMode: true, maxFileSizeMb: 5 });
  const knowledge = new FilesystemBackend({ rootDir: knowledgeDir, virtualMode: true, maxFileSizeMb: 5 });
  const routes = { '/work/': work, '/knowledge/': knowledge };
  for (const [source, dir] of Object.entries(skillDirs)) { fs.mkdirSync(dir, { recursive: true }); routes[`/skills/${source}/`] = new FilesystemBackend({ rootDir: dir, virtualMode: true, maxFileSizeMb: 2 }); }
  return new CompositeBackend(work, routes);
}
export const SKILL_SOURCES = skillDirs => Object.keys(skillDirs).map(source => `/skills/${source}/`);
// Agents write the Brain only through save_knowledge or task completion; archived notes are out of reach.
export const FILE_PERMISSIONS = [
  { operations: ['read', 'write'], paths: ['/knowledge/.archive/**'], mode: 'deny' },
  { operations: ['write'], paths: ['/knowledge/**'], mode: 'deny' },
  { operations: ['write'], paths: ['/skills/**'], mode: 'deny' },
];
