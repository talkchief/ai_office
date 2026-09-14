# Feature Specification: A disposable sandbox per task, for code the team runs

**Feature Branch**: `003-task-sandbox` (artifacts on `main`, as for 001 and 002)
**Created**: 2026-09-14
**Status**: Implemented and deployed 2026-09-14 on the owner's go ("go ahead, finalize, deploy and commit and push to main"). Clarifications: Q1, Q3, Q4 took the recommended answers; Q2 chose package registries only.
**Input**: Owner request (14 Sep 2026): "we need to be able to spin sandbox to support agent work and testing where needed for simulation, running python code to generate pptx, development and testing.... this spawned sandbox should be destroyed when the task is delivered"

## Context

Today an agent can read and write text files in its task's `/work/` folder and turn them into a PDF, a deck or a workbook with the office's own export tools. It cannot run anything: no Python, no tests, no simulation. That was a deliberate line ("agents never get a shell or the server's files"). This feature moves the line carefully: code runs, but only inside a throwaway, locked-down container that belongs to one task and disappears when the task is delivered.

What the server can do today (probed 14 Sep 2026): Podman 5.8.2 with crun and overlay storage, no images yet; user namespaces enabled; cgroups v2 with `memory` and `pids` delegated to user sessions (not `cpu`); 4 CPUs, 7 GB RAM (about 4 GB free), 100 GB disk free; no gVisor. The office service runs as `agents-office` with `NoNewPrivileges=true` and `ProtectHome=true`, which rules out rootless Podman from inside the office process itself (the UID-mapping helper relies on a file capability that `NoNewPrivileges` disables). The server is reachable from the internet with no host firewall.

## Clarifications

### Session 2026-09-14
- Q1: How do containers run next to the hardened office service? → **A separate sandbox broker service** under its own unprivileged user `ao-sandbox`, running rootless Podman, reached by the office over a local socket; the broker accepts only a fixed container profile, so the office keeps its hardening and can never ask for a privileged container, a host mount or a network it was not allowed.
- Q2: Internet from inside a sandbox? → **Package registries only.** Resolved without a proxy: installing is its own step, `sandbox_install`, which fetches the named packages from PyPI or npm in a short-lived helper container that has the network but never the task's files, and runs no install scripts (pip wheels only, npm `--ignore-scripts`). The installed packages are mounted read-only into the task's sandbox, which itself never has a network. `sandbox_install` waits for the owner while "Ask before outside actions" is on (package names chosen by an agent could carry data out); `sandbox_run` does not.
- Q3: Who gets it? → **A tool the office admin gives to a team or a person**, off for everyone by default. Corrected by the owner the same day: the platform switch is **on** by default ("sandbox in platform should be on by default but I can assign it to teams, it is off on the team level not platform level"); the platform administrator can still turn it off for every office.
- Q4: What the image holds → **Python 3.12 with pandas, numpy, scipy, matplotlib, simpy, python-pptx, python-docx, openpyxl, reportlab and pytest; Node 22 with npm; git; common build tools**, about 1.2 GB, rebuilt on deploy.

## User Scenarios & Testing

### User Story 1 - The team runs Python to build what a task needs (Priority: P1)
The CEO asks for a board deck with charts from an attached workbook. The specialist writes `/work/build_deck.py` using pandas, matplotlib and python-pptx, runs it with the sandbox tool, reads the error, fixes the script, runs it again, and `/work/board-deck.pptx` appears under the task's Artifacts. The lead reviews it like any deliverable.

**Why this priority**: It is the owner's first example and the most common one: files the export tools cannot make (charts, custom layouts, computed tables).

**Independent Test**: With a fake runner, an engine test gives a specialist the tool, the tool call runs `python /work/x.py`, the fake writes `/work/out.pptx` into the sandbox copy, and after the call the file is in the task workspace and listed by `GET /api/tasks/:id`. On the server, `scripts/sandbox-smoke.mjs` runs a real python-pptx script through the broker and opens the result.

**Acceptance Scenarios**:
1. **Given** a team with the sandbox tool, **When** a specialist calls `sandbox_run` with a command, **Then** the office starts the task's sandbox if none is running, copies `/work/` in, runs the command with the task's limits, copies new and changed regular files back, and returns the exit code, the duration and the last 20,000 characters of output.
2. **Given** a command that runs past its time limit (default 5 minutes, at most 15), **When** the limit passes, **Then** the process is killed, the call returns "stopped after N minutes" with the output so far, and the sandbox stays usable.
3. **Given** a command that fails, **When** it exits non-zero, **Then** the agent gets the exit code and stderr and can try again; nothing blocks the task.

### User Story 2 - The sandbox is gone when the task is delivered (Priority: P1)
When the task is done, cancelled or deleted, its sandbox is removed: the container, its writable layer and anything it installed. What the team produced stays, because it was copied into `/work/` after every command.

**Why this priority**: The owner's explicit rule, and the reason the risk is acceptable: nothing a task ran outlives it.

**Independent Test**: Engine test with the fake runner: `finish`, `cancel` and `remove` each call `destroy(taskId)` once; a restart with a leftover sandbox for a finished task removes it at boot. On the server: create a task that runs one command, approve it, and `podman ps -a` under `ao-sandbox` shows no container for it within a minute.

**Acceptance Scenarios**:
1. **Given** a task with a running sandbox, **When** the task is delivered (state `done`), **Then** the sandbox is destroyed and the task's timeline says "Sandbox removed: the task was delivered".
2. **Given** a blocked or waiting task, **When** its sandbox has been idle for 20 minutes, **Then** it is stopped and removed; the next `sandbox_run` starts a fresh one from `/work/` (installed extras are gone, files are not).
3. **Given** the office restarts, **When** it boots, **Then** every sandbox whose task is finished, cancelled, deleted or unknown is removed.

### User Story 2b - A package the image lacks (Priority: P2)
A specialist needs `python-dateutil` pinned to an older version, or an npm library for a prototype. They call `sandbox_install { manager: "pip", packages: ["python-dateutil==2.8.2"] }`; the owner sees the package list and approves; the helper container fetches wheels from PyPI (no install scripts run, no task files present) into the task's package volume; the next `sandbox_run` imports it. The sandbox that runs the code never touches the network.

**Acceptance Scenarios**:
1. **Given** "Ask before outside actions" on, **When** an agent calls `sandbox_install`, **Then** the task waits for the owner with the manager and the exact package list; approved, the install runs once.
2. **Given** a package name with a URL, a path, `git+`, an option or more than 40 packages, **Then** the call is refused with a sentence before anything runs.
3. **Given** a package that has no wheel for the image's Python, **Then** the install fails with pip's message and the advice to pick a version with a wheel; no source build runs.

### User Story 3 - Development and testing (Priority: P2)
A developer specialist writes a small service and its tests under `/work/app/`, runs `npm test` or `pytest` in the sandbox, reads the failures, fixes the code and hands the lead a passing suite with the test output quoted.

**Independent Test**: Broker smoke: `node --test` and `pytest -q` on fixture projects inside a real sandbox, both green.

### User Story 4 - Simulation and analysis (Priority: P2)
An analyst runs a Monte Carlo or a discrete-event simulation (numpy, scipy, simpy), writes the summary table to `/work/results.csv`, and turns it into a workbook with `export_xlsx`.

### User Story 5 - The owner controls it (Priority: P1)
The owner gives the sandbox to the teams that need it, sees on each task when a sandbox ran and what it cost in time, and can switch the feature off. In hosted mode the platform administrator decides whether offices may use sandboxes at all, and how many may run at once on the server.

**Acceptance Scenarios**:
1. **Given** Settings → Teams & people → Tools & skills, **When** the owner ticks Sandbox for a team (or a person), **Then** only those people get `sandbox_run`, and the lead and the Program Manager are told who has it.
2. **Given** Settings → Office → Sandbox off (or the broker unavailable), **Then** no agent is offered the tool, prompts do not mention it, and a sentence says why in Settings.
3. **Given** two sandboxes already running on the server (the platform limit), **When** a third task asks for one, **Then** the call waits up to 2 minutes for a free slot and otherwise returns "The sandbox is busy; try again shortly", without blocking the task.

### Edge Cases
- A script creates a symlink, a FIFO or a device node in `/work/`: nothing but regular files and folders is copied back; the rest is skipped and named in the tool's answer.
- A script writes 5 GB: the sandbox's disk quota stops it; the copy back takes at most 200 MB and 2,000 files per command and says what it left behind.
- A fork bomb or a memory balloon: the pids (256) and memory (1 GiB) limits kill it; the office and the other tasks are unaffected.
- The agent tries to reach the internet from `sandbox_run`: the connection fails at once; the answer says the sandbox has no internet and names `sandbox_install` for packages.
- The agent asks to run as root or mount something: there is no such option; the profile is fixed in the broker.
- The broker is down: the tool answers "The sandbox is not available right now" and the lead is told once; the task goes on without it.
- Windows or a laptop without Podman: the feature reports itself unavailable; every test runs against a fake runner.

## Requirements

### Functional Requirements
- **FR-001**: A task has at most one sandbox, created on the first `sandbox_run` of that task, labelled with the office and the task.
- **FR-002**: `sandbox_run { command, timeout_seconds? }` runs one shell command in `/work` inside the sandbox and returns exit code, duration, stdout and stderr (the last 20,000 characters each), and the files added or changed.
- **FR-003**: The sandbox never mounts the task's live workspace. Before each command the office copies `/work/` (regular files and folders only, attachments' originals included) into the sandbox; after it, it copies back new and changed regular files only, refusing symlinks, hard links to outside files, FIFOs, sockets and devices, with size and count caps.
- **FR-004**: The container profile is fixed: rootless, `--network=none`, `--cap-drop=ALL`, `--security-opt=no-new-privileges`, read-only root filesystem with a writable `/work` and `/tmp`, memory 1 GiB, pids 256, CPU 1 (once CPU is delegated), disk quota for the writable layer, no host environment, no secrets, no Vault access, a non-root user inside.
- **FR-005**: The sandbox is destroyed when its task reaches `done` or `cancelled`, when the task is deleted, after 20 minutes idle, and at boot for any sandbox without an open task.
- **FR-006**: `sandbox_run` is a tool granted like a connector: per team and per person, off by default; the Program Manager does not run code itself.
- **FR-007**: Office setting `sandbox` (on/off, command time limit, idle limit) and, in hosted mode, platform settings (allowed on/off, sandboxes at once on the server, memory per sandbox).
- **FR-008**: Every command is recorded on the task (tool call, exit code, duration, files changed); sandbox start and removal are timeline events.
- **FR-009**: Prompts tell the people who have the tool what it is for (running code to compute, simulate, test, and make files), that `/work/` is shared with it, that it has no internet, the time limit, and that it is gone at delivery.
- **FR-010**: `sandbox_run` needs no approval: it has no network, so nothing outside the office changes. `sandbox_install { manager: pip|npm, packages }` joins the actions that wait for the owner while "Ask before outside actions" is on; it runs in a helper container with the network and without the task's files, pip with `--only-binary=:all:` from pypi.org, npm with `--ignore-scripts` from registry.npmjs.org, names validated (no URLs, paths, VCS specs or options; at most 40), 5 minutes and 1 GiB at most, into a per-task package volume mounted read-only in the sandbox and removed with it.
- **FR-011**: Hardening that stands on its own: the task file download, the artifact list and the agents' file tools refuse symlinks and non-regular files in a workspace.

### Key Entities
- **Sandbox**: task id, office id, container id, started at, last used at, state (starting, ready, stopped), limits.
- **Sandbox run**: task id, agent, command, started at, duration, exit code, files changed, truncated output (on the task's record, not a new store).

## Success Criteria
- **SC-001**: A python-pptx script produces a deck in `/work/` within one agent turn on the server; median command start under 3 seconds with a warm image.
- **SC-002**: After any task is delivered, no container for it exists 60 seconds later (checked by the smoke script and at boot).
- **SC-003**: A symlink, FIFO or oversized output written in a sandbox never reaches the workspace; the download route never serves a file outside the workspace (tests with real symlinks).
- **SC-004**: With two sandboxes busy at their limits, the office's own API p95 stays under 500 ms.
- **SC-005**: `npm run check` stays green on Linux and Windows with no container runtime present.

## Assumptions
- The owner's server stays the only host for now; the broker design also serves a self-hosted install (Docker or Podman on PATH) later.
- The existing export tools stay; the sandbox is for what they cannot do.
- A sandbox is per task, not per person or per team, so two tasks never see each other's files.
