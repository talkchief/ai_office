# Tasks: A disposable sandbox per task

**Input**: specs/003-task-sandbox/{spec.md,plan.md}
**Format**: `- [ ] T### [P?] [US#] description with file path` — [P] = parallelisable, [US#] = user story
**Status**: clarified 2026-09-14; not started, waiting for the owner's go.

## Phase 0: Decisions (owner)
- [x] T001 Owner answered Q1 (separate broker), Q2 (package registries only), Q3 (granted per team), Q4 (Python + Node + tools); spec and plan updated 2026-09-14
- [ ] T002 Owner's go for the implementation, and for the server set-up in T305

## Phase 1: Workspace hardening, shippable on its own (FR-011)
- [ ] T101 [P] engine/documents.mjs: `workspaceFile` resolves the real path and refuses one that leaves the workspace; `listWorkspaceFiles` uses `lstat`, lists regular files only
- [ ] T102 [P] server/api.mjs: `/api/tasks/:id/file` serves regular files only (`lstat`), never follows a link
- [ ] T103 engine/backend.mjs: wrap the `/work/` and `/knowledge/` filesystem backends so a read or write through a symlink is refused
- [ ] T104 tests/workspace-links.test.mjs: a real symlink to a file outside, a FIFO and a directory link are refused by all three paths (skipped where the OS cannot make links)

## Phase 2: Engine and tool with a fake runner (US1, US2, US5)
- [ ] T201 engine/sandbox.mjs: `SandboxClient` (Unix-socket broker client), `FakeSandbox`, `copyIn`/`copyOut` with the FR-003 rules and caps, `destroy`, `reap`
- [ ] T202 engine/deep-agents.mjs: `sandbox_run` for leads and specialists whose tools include `sandbox` (standard and quick lanes); timeline events; `job.sandbox` (started, last used, seconds, runs)
- [ ] T203 engine/deep-agents.mjs: destroy on `finish` (done), `cancel`, `remove`; idle timer; `recover()` reaps sandboxes without an open task
- [ ] T203b engine/sandbox.mjs, engine/deep-agents.mjs: `sandbox_install { manager, packages }` with validation, in `VAULT_APPROVALS`-style approvals; the per-task package volume mounted read-only at `/deps`
- [ ] T204 engine/prompts.mjs: SANDBOX block for people who have the tool; lead and Program Manager told who has it
- [ ] T205 office-store.mjs, src/settings.js, office-memory.mjs: built-in tool id `sandbox` beside `web` for teams and people; org chart page lists it
- [ ] T206 settings.mjs, platform.mjs, src/settings.js: office `sandbox { enabled, commandMinutes, idleMinutes }`; platform `sandbox { allowed, slots, memoryMb }`; Settings shows availability and why
- [ ] T207 src/task-output.js: task page shows sandbox runs (command, exit code, duration, files) and sandbox seconds
- [ ] T208 tests/sandbox.test.mjs: tool round trip with files in and out; symlink, FIFO and oversize refused on the way back; time limit; busy slots; destroy on done, cancel, delete; reap at boot; tool absent when off or ungranted
- [ ] T209 tests/prompts.test.mjs: the SANDBOX block appears only for people with the tool

## Phase 3: Broker and image on the server (Q1, Q4)
- [ ] T301 sandbox/broker.mjs: the Unix-socket API, fixed profile, the offline install helper (pip wheels only, npm --ignore-scripts, no task files), id and command validation, slot limit, size watchdog, periodic reaper, `/health`
- [ ] T302 sandbox/Containerfile, scripts/sandbox-image.mjs: the image and its build as `ao-sandbox`, tagged by version, old tags pruned
- [ ] T303 deploy/sandbox/: `agents-office-sandbox.service`, `user@.service` delegation drop-in, `setup-sandbox.sh` (user, subuid/subgid, linger, storage path, socket directory); README and CLAUDE.md sections
- [ ] T304 scripts/sandbox-smoke.mjs: python-pptx deck, pytest, node --test, network probe fails, a pip and an npm install through the helper then imported offline, a source-only package refused, symlink and FIFO escapes refused, fork bomb and memory balloon contained, destroy on done within 60 s
- [ ] T305 Owner go → run the set-up on the server, build the image, start the broker, run the smoke script

## Phase 4: Rollout (US5)
- [ ] T401 Enable for one team; one real task (a deck with charts from an attached workbook) end to end; check the timeline, artifacts and that the container is gone after delivery
- [ ] T402 `npm run check` green (Linux; CI on Windows without Podman); deploy; commit and push
