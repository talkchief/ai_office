# Implementation Plan: CEO-run office on a Deep Agents harness

**Branch**: `001-ceo-run-office` | **Date**: 2026-09-10 | **Spec**: specs/001-ceo-run-office/spec.md

## Summary
Replace the hand-rolled LangGraph engine with a Deep Agents supervisor (Program Manager → department lead subagents → specialist subagents) on any LangChain chat model, add real states, durable threads, an inbox with approvals that execute, SSE, a provider registry with per-role models, a full-page settings router, a redesigned scene (PM at centre, Brain icon) and company processes (assignment, due dates, digests, audit, KPIs). Remove budgets, demo mode and the Claude CLI execution path.

## Technical Context
**Language/Version**: Node 22 ESM (service runtime `/opt/agents-office-runtime`), vanilla JS + three.js bundled by esbuild
**Primary Dependencies**: deepagents ^1.13.4, langchain ^1.5.10, @langchain/core ^1.2.10, @langchain/langgraph ^1.4.14, @langchain/langgraph-checkpoint-sqlite ^1.0.4, @langchain/anthropic ^1.5.10, @langchain/openai ^1.5.12, @langchain/mcp-adapters ^1.1.4, @modelcontextprotocol/sdk, markdown-it, zod, @zvec/zvec ^0.7.1 (vector + full-text index), @huggingface/transformers ^4.2 (optional local embeddings, not installed by default), pdf/docx extraction (existing documents.mjs)
**Storage**: SQLite `data/workflows.sqlite` (jobs, events, threads, messages, notifications, audit, LangGraph checkpoints); JSON files `data/office.json`, `data/providers.json`, `data/tools.json`; Markdown knowledge in `data/knowledge`; per-task workspaces in `data/workspaces/<id>`
**Testing**: `node --test tests/*.test.mjs` with a scripted fake chat model; Playwright smoke in `check.mjs` against the live server
**Target Platform**: Linux server behind nginx (SSE needs `proxy_buffering off`)
**Project Type**: single web service + SPA
**Performance Goals**: live updates within 1 s of a change; task list render under 50 ms for 500 tasks; no full-note scans per model call
**Constraints**: single owner; secrets never to browser; Settings defaults: maxConcurrentJobs 2, runTimeoutMinutes 45, escalateAfterHours 1, digestTime 08:00, knowledgeSeedNotes 6, embeddingModel none; completion approval per team (default off), outbound actions always pause; parallelism = maxConcurrentJobs (office) + maxParallelRuns per team (1–4, default 2) + one run per agent; maxReworkRounds per team (default 3) escalates
**Scale/Scope**: 6 teams, up to 12 agents each, thousands of tasks over time

## Constitution Check
- I One store per fact: PASS — job/thread/notification/audit in SQLite; config in office.json; keys in providers.json; connectors in tools.json. Legacy `data/tasks.json` ignored and deletable.
- II States enforced: PASS — FR-001/003/004 implemented by engine guards and tools, not prose.
- III Nothing leaves without the CEO: PASS — interruptOn on every outbound tool; evaluation runs get none.
- IV Provider-agnostic: PASS — models.mjs registry; CLI path deleted.
- V Test-first for the engine: PASS — tests/engine.test.mjs precedes UI milestones.
- VI One UI code path: PASS — demo modules deleted in M2.
- VII Every CEO-relevant event is a notification: PASS — notifications.mjs + SSE + seenAt.

## Project Structure

### Documentation (this feature)
```
specs/001-ceo-run-office/
├── spec.md
├── plan.md
├── tasks.md
└── checklists/requirements.md
```

### Source Code (repository root)
```
serve.mjs                    # boot, static, auth, mounts server/routes-*.mjs
server/routes.mjs            # matcher + json()
server/routes-{tasks,inbox,chat,settings,tools,reports}.mjs
engine/deep-agents.mjs       # OfficeEngine: lifecycle, build agent per job, stream, interrupts, recovery
engine/prompts.mjs           # PM / lead / specialist / reviewer prompts
engine/tools.mjs             # MCP + web + office tools, outbound classification → interruptOn
engine/backend.mjs           # CompositeBackend: /work (per task) + /knowledge (read-only)
engine/stream.mjs            # streamEvents → job.liveCalls/runs/events → SSE
knowledge.mjs                # Brain files: folders, upload/extract, notes CRUD (existing, extended)
knowledge-index.mjs          # chunking, embeddings (local or provider), Zvec collection, hybrid search, rebuild
models.mjs                   # provider registry, per-role resolution, effort mapping, test/list
threads.mjs                  # durable threads + messages (question | correction | note), pending-note queue, standing-rules writer
notifications.mjs            # inbox
sse.mjs                      # event bus + /api/events
scheduler.mjs                # routines (all depts), due/overdue, escalation, digests
audit.mjs                    # config audit log
reporting.mjs                # KPIs
migrations.mjs               # office_jobs v1→v2, office.json cleanup, file-skill import
office-store.mjs             # teams/agents/skills/rules/role models (no budgets)
tool-store.mjs               # tools.json registry + MCP OAuth flow
src/main.js                  # scene, PM at centre, brain icon, pills, wheel scoping
src/router.js src/settings.js src/inbox.js src/sse.js src/chat.js src/labels.js
src/office.js                # feed + task view only
src/meetings.js              # walk-and-talk choreography from SSE events (queue per person, bubbles)
src/task-output.js           # single-page task view
src/shell.html               # settings page markup/CSS, bell, brain button
tests/*.test.mjs             # engine, models, tools, notifications, threads, scheduler, audit, reporting, sse, migrations
check.mjs                    # build + live Playwright smoke
```

## Phase 0: Research decisions (resolved)
- Deep Agents subagent shapes verified in `deepagents@1.13.4` types: declarative `SubAgent {name, description, systemPrompt, tools, model, interruptOn, skills, responseFormat, mode}` and `CompiledSubAgent {name, description, runnable}`; backends `FilesystemBackend`, `CompositeBackend`, `StateBackend`; per-path `FilesystemPermission`.
- `@langchain/anthropic@1.5.10` supports `outputConfig.effort` and `thinking: {type:'adaptive'}` natively.
- `@langchain/mcp-adapters@1.1.4` accepts an `OAuthClientProvider` per connection.
- `@zvec/zvec@0.7.1` publishes Node bindings for linux-x64 with full-text, vector and hybrid queries. Default mode is full-text only (no embedding model, no download); vectors are enabled by choosing an embedding model in Settings, with SQLite FTS as the fallback when bindings are unavailable.
- Spec Kit installed from the repository tree (v1.x publishes no release zips).

## Phase 1: Design
- Job state machine and schema as in spec FR-001; SQLite DDL for office_threads, office_messages, office_notifications, office_audit, office_meta.
- API: `/api/events` (SSE), `/api/tasks` (+assignee, dueAt, depts), `/api/tasks/:id/{message,seen,decide,answer,retry,cancel,start}`, `/api/inbox`, `/api/inbox/:id/read`, `/api/inbox/read-all`, `/api/threads/:id`, `/api/chat`, `/api/providers`, `/api/providers/:id/{test,models}`, `/api/settings`, `/api/settings/models`, `/api/routines` (all depts), `/api/audit`, `/api/kpis`, `/api/tools` (+oauth start/callback/logout, import). Removed: `/api/auth/{login,code,cancel,logout}`, `/api/usage`, `/api/mcp`, `/api/lessons`, `/api/skills` file loader, `/api/projects*`, `/api/tasks/:id/{approve,reject,queue}` (replaced by decide/message/start).
- Milestones M0–M4 as in tasks.md; M0 ships on the current engine.

## Glossary
- **Program Manager (PM)**: the supervisor agent at the office centre; never "project manager" in UI text.
- **Department lead**: reviews and delegates within one team. **Specialist**: does the work; cannot complete tasks.
- **Brain**: the knowledge store in UI text; `knowledge` in code. **Inbox**: the CEO's action list.
- **Correction loop**: a CEO message on a task is a question (answer in thread) or a correction (reopen, rework, re-review, new result version); "remember this" turns it into a standing rule.
- **Run**: one delegated unit of work inside a task (replaces "subtask").

## Complexity Tracking
| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| Nested deep agents (PM → leads → specialists) | mirrors the org and keeps the PM context small | a flat PM with 35 specialists blows the tool list and loses the lead review step |
| Per-team run semaphore inside the lead's task tool | the CEO wants to tune how much a team does at once | relying on the model to self-limit parallel task calls is not enforceable |
| Zvec index beside Markdown files | semantic search over company documents for every agent | keyword scoring re-reads every note per call and cannot match paraphrases |
| Client-side meeting choreography | the walk-and-talk animation the CEO asked for | driving it from the engine would couple state timing to animation (Principle II) |
| Own MCP OAuth flow | claude.ai-managed connectors are unreachable without the CLI | keeping the CLI reintroduces a vendor runtime dependency (Principle IV) |
