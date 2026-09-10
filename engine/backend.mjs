// Each task gets its own workspace at /work/; the Brain is mounted read-only at /knowledge/.
import fs from 'node:fs';
import { CompositeBackend, FilesystemBackend } from 'deepagents';

export function officeBackend({ workspaceDir, knowledgeDir }) {
  fs.mkdirSync(workspaceDir, { recursive: true }); fs.mkdirSync(knowledgeDir, { recursive: true });
  const work = new FilesystemBackend({ rootDir: workspaceDir, virtualMode: true, maxFileSizeMb: 5 });
  const knowledge = new FilesystemBackend({ rootDir: knowledgeDir, virtualMode: true, maxFileSizeMb: 5 });
  return new CompositeBackend(work, { '/work/': work, '/knowledge/': knowledge });
}
// Agents write the Brain only through save_knowledge or task completion; archived notes are out of reach.
export const FILE_PERMISSIONS = [
  { operations: ['read', 'write'], paths: ['/knowledge/.archive/**'], mode: 'deny' },
  { operations: ['write'], paths: ['/knowledge/**'], mode: 'deny' },
];
