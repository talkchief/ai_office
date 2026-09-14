# Implementation Plan: A disposable sandbox per task

**Branch**: `003-task-sandbox` | **Date**: 2026-09-14 | **Spec**: specs/003-task-sandbox/spec.md
**Status**: Clarified 2026-09-14; waiting for the owner's go. Q2 (package registries only) is met by the install step in section 5, with no proxy.

## Summary
Agents that were given the Sandbox tool can run shell commands (Python, Node, tests) inside a rootless, network-less Podman container that belongs to one task. The office never shares the live workspace with the container: files are copied in before each command and regular files are copied back after it. A small broker service under its own user owns the container runtime and accepts only a fixed profile. The office destroys the sandbox when the task is delivered, cancelled or deleted, when it sits idle, and at boot.

## Technical Context
**Language/Version**: Node 22 ESM for the office and the broker; the image is Python 3.12 + Node 22 on Debian slim
**Primary Dependencies**: none new in the office (HTTP over a Unix socket with `node:http`); the broker shells out to `podman` only
**Storage**: nothing new on disk for the office; sandbox runs are fields on the task record; broker state is the container labels themselves (`ao.office`, `ao.task`, `ao.started`)
**Testing**: `node --test` with a fake runner for the engine, the tool, the copy rules and the lifecycle (Linux and Windows, no Podman); `scripts/sandbox-smoke.mjs` on the server against the real broker (python-pptx deck, pytest, node --test, symlink and FIFO escape attempts, network probe, fork bomb, memory balloon, destroy on done)
**Target Platform**: this server (RHEL 9 family, Podman 5.8, cgroups v2); unavailable elsewhere unless a broker is configured
**Constraints**: office service hardening unchanged; 4 CPUs / 7 GB RAM box: 2 sandboxes at once, 1 GiB and 1 CPU each by default
**Scale/Scope**: one sandbox per task; hosted mode shares the server-wide slot limit across offices

## Design

### 1. The broker (Q1)
- **User and runtime**: system user `ao-sandbox` with its own subordinate UID/GID range (`/etc/subuid`, `/etc/subgid`), lingering enabled so it has a systemd user instance, and a drop-in `Delegate=cpu memory pids io` on `user@<uid>.service` so rootless containers can be limited in CPU as well as memory and processes. Rootless Podman storage under `/var/lib/ao-sandbox`.
- **Service**: `agents-office-sandbox.service` (`User=ao-sandbox`) runs `node sandbox/broker.mjs`, listening on `/run/agents-office-sandbox/broker.sock` (mode 0660, group `agents-office`). No TCP port.
- **API** (JSON): `POST /sandboxes {office, task}` → create or return the running one; `POST /sandboxes/:task/run {command, timeoutSeconds}` → stream-free result; `PUT /sandboxes/:task/files` and `GET /sandboxes/:task/files?since=` → the copy in and out as a tar stream of regular files only; `DELETE /sandboxes/:task` → destroy; `GET /sandboxes` → list for reaping; `GET /health` → podman version, image present, slots used.
- **Fixed profile**: `podman run -d --name ao-<office>-<task> --label ao.office=… --label ao.task=… --network=none --cap-drop=ALL --security-opt=no-new-privileges --read-only --tmpfs /tmp:rw,size=256m --mount type=volume,src=ao-<office>-<task>-work,dst=/work --user 1000:1000 --memory=1g --memory-swap=1g --pids-limit=256 --cpus=1 --userns=auto localhost/ao-sandbox:<version> sleep infinity`, then `podman exec -w /work` per command wrapped in `timeout`. `/work` is a per-task volume in the broker's own storage (not tmpfs, which would count against the 1 GiB of memory), removed with the container; the broker watches its size and stops a command that passes 2 GB. The office cannot pass a flag, a mount, an image or a user.
- **Validation**: office and task ids match `^[a-z0-9_-]{1,64}$`; command at most 8,000 characters; time limit clamped to 15 minutes; slots enforced in the broker, not trusted from the office.

### 2. Files cross as copies (FR-003, FR-011)
- Copy in: the office packs `/work/` (regular files and folders, skipping anything that is not, 200 MB cap) and the broker unpacks it into the container's `/work` volume before each command, only when the workspace changed since the last copy.
- Copy out: after the command the broker lists files newer than the run start inside the container and returns them as a tar; the office unpacks with its own checks: relative paths only, no `..`, regular files only (tar entries of any other type are refused), 200 MB and 2,000 files per command, never overwriting a path that is a folder, and names the skipped entries in the tool's answer.
- Independent hardening in the office: `workspaceFile` resolves real paths and refuses a path whose real location leaves the workspace; `/api/tasks/:id/file` and `listWorkspaceFiles` use `lstat` and serve regular files only; the Deep Agents filesystem backend is wrapped so a symlink read is refused.

### 3. The office side
- `engine/sandbox.mjs`: `SandboxClient` (broker over the Unix socket) and `FakeSandbox` (tests); `sandboxTool(jobId, agentId)` returning `sandbox_run`; `copyIn`, `copyOut` with the rules above; `destroy(jobId, reason)`; `reap(openTaskIds)`.
- `engine/deep-agents.mjs`: offer the tool to leads and specialists whose tools include `sandbox` (`connectorTools`-style gate), in both lanes; call `destroy` in `finish` (after `done`), `cancel`, `remove`, and on the idle timer; `recover()` calls `reap` with the open tasks; events `sandbox_started`, `sandbox_command` (exit code, duration, files), `sandbox_removed` (reason).
- `engine/prompts.mjs`: a SANDBOX block for people who have it (what for, `/work/` is copied in and out, no internet, limits, gone at delivery, write outputs to `/work/`).
- Tool grant: a built-in tool id `sandbox` beside `web` in the team and person tool lists (office-store validation, Settings → Tools & skills, the org chart page in office memory).
- Settings: `sandbox { enabled, commandMinutes, idleMinutes }` in `settings.json` (office); `sandbox { allowed, slots, memoryMb }` in `platform.json` (hosted), with the platform value winning.
- Usage: sandbox seconds per task on the task record (`job.sandbox.seconds`), shown on the task page beside tokens; no price in the first version.

### 4. The image (Q4)
`sandbox/Containerfile`: `python:3.12-slim-bookworm`; apt `git build-essential curl ca-certificates fonts-dejavu`; Node 22 from the official tarball; `pip install pandas numpy scipy matplotlib simpy python-pptx python-docx openpyxl reportlab pytest`; user `1000:1000` named `sandbox`; `WORKDIR /work`. Built by `scripts/sandbox-image.mjs` (runs `podman build` as `ao-sandbox`), tagged with the office version, old tags pruned. Deploy recipe gains one step.

### 5. Packages without giving the sandbox a network (Q2)
- `sandbox_install { manager: "pip" | "npm", packages: [...] }`, gated by approvals like `api_request`.
- Validation in the office and again in the broker: each entry matches `^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9,._-]+\])?((==|>=|<=|~=|!=)[A-Za-z0-9.*+!_-]+)?$` for pip or `^(@[a-z0-9-~][a-z0-9-._~]*/)?[a-z0-9-~][a-z0-9-._~]*(@[A-Za-z0-9.^~<>=*|-]+)?$` for npm; at most 40.
- The broker runs a helper container from the same image: default rootless network (pasta), no task volume, the per-task package volume `ao-<office>-<task>-deps` mounted read-write, `--cap-drop=ALL`, `no-new-privileges`, 1 GiB, 5 minutes. pip: `pip install --only-binary=:all: --index-url https://pypi.org/simple --target /deps/python <packages>`; npm: `npm install --ignore-scripts --registry=https://registry.npmjs.org --prefix /deps/node <packages>`. No install script runs, so nothing but the package managers uses the network.
- The sandbox mounts the package volume read-only at `/deps` with `PYTHONPATH=/deps/python` and `NODE_PATH=/deps/node/node_modules`; the volume is removed with the sandbox.
- A package that needs a source build or a postinstall script fails with its own message; the tool's answer says so and suggests a version with a wheel.

## Security Review
| Threat | Mitigation |
|---|---|
| Container escape to the host | Rootless Podman under a dedicated user with no other rights; `--cap-drop=ALL`, `no-new-privileges`, user namespace; kernel updates on the box; gVisor is the next step if the owner wants a stronger boundary |
| Reading office secrets through the workspace | No live mount; copies of regular files only; office readers refuse symlinks (FR-003, FR-011) |
| Reaching the internet or the metadata/local services | `--network=none` for every command; packages come from a helper container that has no task files, runs no install scripts and waits for the owner's approval |
| Exhausting the box | Memory, pids, CPU and disk caps; 2 slots server-wide; command and idle time limits |
| One office seeing another's work | One sandbox per task; ids validated; the broker keys every call by office and task |
| The office asking for a dangerous container | The broker has no parameters for image, mounts, user, network or privileges |
| Leftovers | Destroy on done, cancel, delete, idle; reap at boot and every 10 minutes in the broker for containers older than their idle limit |

## Constitution Check
- I One store per fact: PASS — container labels are the broker's state; sandbox facts on the task record.
- II States enforced: PASS — lifecycle hooks sit on the engine's state transitions.
- III Nothing leaves without the CEO: PASS — no network; approvals apply if network is ever allowed.
- IV Provider-agnostic: PASS — a tool like any other.
- V Test-first for the engine: PASS — fake runner tests before the broker exists.

## Rollout
1. Office-side hardening (FR-011) ships first, on its own: it is worth having even without sandboxes.
2. Engine, tool, prompts and settings with the fake runner; everything off by default.
3. Server set-up (user, subuids, delegation, broker service, image) behind the owner's go; smoke script green.
4. The owner enables the sandbox for one team; one real task (python-pptx deck) end to end; then wider.

## Open Items
- The owner's go, and a separate go for the server set-up (user, subordinate IDs, delegation drop-in, broker service, image build).
- Whether sandbox seconds should be priced in the usage ledger later.
- Whether a self-hosted Docker install gets a CLI runner (no broker) in a later version.
