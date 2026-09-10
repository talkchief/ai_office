# Tasks: CEO-run office on a Deep Agents harness

**Input**: specs/001-ceo-run-office/{spec.md,plan.md}
**Format**: `- [ ] T### [P?] [US#] description with file path` — [P] = parallelisable, [US#] = user story

## Phase 1: M0 Hotfixes (ships on the current engine)
- [ ] T001 [P] [US5] Scope the wheel handler to the canvas and never preventDefault over scrollable UI in src/main.js (window listener at ~451)
- [ ] T002 [P] [US2] Add `seenAt` to jobs and `POST /api/tasks/:id/seen` in workflows.mjs and serve.mjs; call it from src/office.js showTask
- [ ] T003 [US2] Derive Done indicators from `done && !seenAt` in src/office.js activityByAgent and feed card; pill text "Done" in src/main.js
- [ ] T004 [P] [US10][US14] Remove call/token budget fields, gates and counters (keep team `concurrency` renamed `maxParallelRuns` and `maxRevisions` renamed `maxReworkRounds`, exhausting it escalates instead of blocking): office-store.mjs, workflows.mjs (:25,:159,:163,:180,:206,:258,:311), projects.mjs (:35), reporting.mjs, src/office.js (:205,:232,:292,:122 → startedAt), src/task-output.js (:104), src/projects.js; delete tests/workflows.test.mjs budget cases
- [ ] T005 [P] [US1] Fix orphaned submitted subtasks and error masking in workflows.mjs (:150,:226-230,:285): failing sibling marks only itself; job blocks after all settle; real error preserved; blocked event emitted
- [ ] T006 [P] [US1] retry() keeps an approved review in workflows.mjs (:309)
- [ ] T007 [P] [US6] Create src/labels.js single vocabulary; use it in src/office.js and src/task-output.js
- [ ] T008 [P] [US6] Preserve feed scroll position across re-renders in src/office.js (keyed DOM update instead of innerHTML)
- [ ] T009 [P] Delete dead server code: run/writeNote/save/route/legacy import in serve.mjs, onboard.mjs, learn.mjs, usage.mjs and /api/usage, /api/lessons, file-skill loader route; `claude mcp add-json/remove/login` calls in tool-store.mjs (tools.json becomes store of record)
- [ ] T010 [US1][US2][US10] Tests (write before T005/T006): sibling failure keeps submitted work; retry keeps review; seen flag; no budget fields in validate() (tests/workflows.test.mjs, tests/task-output.test.mjs)

## Phase 2: M1 Harness (Deep Agents, providers, threads, inbox, SSE)
- [ ] T011 package.json: add deepagents, langchain, @langchain/anthropic, @langchain/openai, @langchain/mcp-adapters, @modelcontextprotocol/sdk, langsmith; bump @langchain/core; remove @anthropic-ai/sdk optional dep
- [ ] T012 [P] [US4] models.mjs: providers.json (0600) + env fallback, instance() per provider type, effort mapping, resolve() precedence, test(), listModels(), ready(); never return keys
- [ ] T013 [P] [US4] server/routes-settings.mjs: GET/PUT /api/providers, POST /api/providers/:id/test, GET /api/providers/:id/models, PUT /api/settings/models, GET/PUT /api/settings (FR-041 fields with defaults: maxConcurrentJobs 2, runTimeoutMinutes 45, escalateAfterHours 1, outboundTools, readOnlyTools, digestTime 08:00, knowledgeSeedNotes 6, embeddingModel none)
- [ ] T014 [P] [US1] threads.mjs: office_threads/office_messages DDL, pick(agentId), append, GET /api/threads/:id
- [ ] T015 [P] [US3] notifications.mjs: office_notifications DDL, notify(), read/ack, GET /api/inbox, POST /api/inbox/:id/read, POST /api/inbox/read-all
- [ ] T016 [P] [US3] sse.mjs: event bus, /api/events with Last-Event-ID replay buffer, 25 s heartbeat; event names task.updated, task.live, notification.new, notification.read, office.updated
- [ ] T017 [US3] engine/tools.mjs: MultiServerMCPClient from tools.json (+ optional claude mcp list import), per-agent filtering (mcp__<server>__<tool>, web), local web_fetch, Anthropic server web_search, office tools record_review/complete_task/ask_ceo/save_knowledge/report_progress, outbound classification → interruptOn; evaluation runs get no outbound tools
- [ ] T018 [P] [US1] engine/backend.mjs: CompositeBackend with /work (data/workspaces/<job>) and read-only /knowledge (data/knowledge)
- [ ] T019 [P] [US1] engine/prompts.mjs: PM / lead / specialist / reviewer prompts from office.json (identity, purpose, guardrails, skills, standing rules, tools, workspace, role contract, OUTPUT_GUIDANCE)
- [ ] T026 [US1][US3][US4] Tests FIRST (Principle V): tests/helpers/fake-model.mjs; tests/engine.test.mjs scenarios (plan→delegate→review→complete; per-team parallel-run limit SC-013; rework rounds escalate; refused completion; awaiting_lead_review re-prompt/escalate; outbound pause/approve/edit-validated/reject/duplicate-decision no-op; message on done task reopens and needs new review; restart recovery; cancel; timeout); tests/models.test.mjs; tests/tools.test.mjs (classification, filtering, redaction, OAuth state check); tests/notifications.test.mjs; tests/threads.test.mjs; tests/sse.test.mjs (replay, cap, heartbeat); tests/migrations.test.mjs
- [ ] T020 [US1][US3] engine/deep-agents.mjs: OfficeEngine (create/start/cancel/retry/decide/answer/message/seen), build PM with lead CompiledSubAgents and specialist SubAgents, streamEvents with thread_id = job id, interrupts → awaiting_ceo + pendingActions, Command resume with decisions, enforceReview guard, awaiting_lead_review re-prompt then escalate, completionApproval per team (default off), wall-clock + parallelism (office maxConcurrentJobs, per-team maxParallelRuns semaphore around the lead's task tool, per-agent single run) from Settings/team, rework rounds escalate, recover() on boot; job body stores configSnapshot {officeRevision, skills, models} only (no team/agents copies)
- [ ] T021 [US1] engine/stream.mjs: map streamEvents to liveCalls/runs/events/tokens with throttling; publish SSE
- [ ] T022 [US1][US3] server/routes-tasks.mjs + routes-inbox.mjs + routes-chat.mjs: new task API (message, seen, decide with schema validation of edits, answer, retry, cancel, start; assignee/dueAt/depts accepted, assignee must be in a task department), inbox routes, chat → threads (agent thread with search_knowledge only, or task thread; leads/PM auto-create tasks; suggestedTask in replies)
- [ ] T023 [P] [US4] tool-store.mjs: office-owned MCP OAuth (OAuthClientProvider, PKCE, DCR), routes /api/tools/:id/oauth/{start,callback,logout}, import from discovery; redact tokens
- [ ] T024 migrations.mjs: office_jobs v1→v2 (waiting→awaiting_ceo, subtasks→runs, drop team/agents copies, legacy flag), office.json cleanup (budgets out; models/rules/completionApproval in), one-shot file-skill import, archive old `Conversation *` notes; run before recover()
- [ ] T025 serve.mjs: delete askX/CLI spawn, Claude OAuth auth, usage gauge, /api/mcp, /api/projects*; mount route modules; 409 gating when !models.ready()
- [ ] T027 deploy: env keys in /etc/agents-office.env; nginx `/api/events` proxy_buffering off + read timeout; deploy/README.md

## Phase 3: M2 UI
- [ ] T028 [P] [US5] src/router.js hash routes (#/, #/settings/*, #/task/:id, #/inbox); body[data-view] hides scene/panels; renderer loop pauses when hidden
- [ ] T029a [US5][US14] src/settings.js shell + pages Office (FR-041 fields, maxConcurrentJobs), Teams (add/rename/remove teams, lead picker, models per role, completionApproval, maxParallelRuns, maxReworkRounds, tools; refuse removing busy teams), People (add/remove agents per team, role, description, standing rules, model, effort, tools, inheritTools; refuse removing busy agents); move renderers out of src/office.js; CSS from #spaceDialog to .space-page in src/shell.html
- [ ] T029b [US4][US5] Settings pages Models (providers, Test connection, model table, role defaults, embedding model) and Tools (registry, OAuth start/callback status, import from discovery, per-tool outbound/read-only override toggle, reconnect banner)
- [ ] T029c [US5] Settings pages Skills, Routines (placeholder until T041), Reports (placeholder until T043), Brain (placeholder until T053), Audit (placeholder until T042)
- [ ] T030 [P] [US3] src/inbox.js: bell + unread count, drawer with Needs you / Updates, inline Approve / Edit & approve / Reject / Answer / Retry / Open; desktop alerts opt-in via Notification API
- [ ] T031 [P] [US3] src/sse.js: EventSource client, incremental job map updates, reconnect with backoff, polling fallback, Live/Reconnecting hint
- [ ] T032 [US6][US14] src/data.js LAYOUT.brain → LAYOUT.pm; ring layout for any team count and desk grid for any agent count kept from data.js:86-110 with the PM radius accounted for; src/main.js builds the PM office at the centre (lead desk + person, id `pm`), removes the side PM plinth and pill; walkways lead to PM
- [ ] T033 [P] [US6] Brain icon #brainBtn top-left (src/shell.html, src/main.js), opens overlay; src/brain.js drops floor sprite; overview button shifts right
- [ ] T034 [US6] Pill redesign: one chip (Working/Reviewing/Needs you/Done) in src/main.js ~1187-1201 + CSS; desk screen states in src/builders.js ~93-106; activityByAgent from runs + state + seenAt
- [ ] T035 [US6] Feed cards with 5-step stepper, progress sentence, assignee, due chip in src/office.js; department badge rows Active · Needs you · Done today
- [ ] T036 [US6] src/task-output.js single-page task view: actions first, result, timeline (todos, runs, review criteria, decisions, messages), message box → POST /api/tasks/:id/message
- [ ] T037 [US1] src/chat.js: thread context chip, durable history from GET /api/threads/:id, "Make this a task" button; remove revise: stub and demo grammar from #mIn placeholder
- [ ] T038 [P] Remove demo mode: delete src/tasks.js, src/v1data.js, dead builders (makeNeuralBrain, makeHolo, makeFloorTitle, makeServerRack, makeMeetingTable), DEMO branches, demo CSS/DOM (#tpBig, .tp-*, .bd-*), roster.mjs V1 dependency; src/auth.js unlock-only; connectors dock reads /api/tools
- [ ] T039 [US7][US11] Task creation form: assignee picker, due date, priority, "Also involve" departments; project document upload folded in (src/office.js)

## Phase 3b: M2b Knowledge base (Brain)
- [ ] T054 [US12] Tests FIRST: tests/knowledge-index.test.mjs (chunking, upsert/delete consistency, full-text ranking on a 20-document fixture, hybrid ranking when an embedding stub is configured, rebuild while searching, FTS fallback, 5 MB PDF timing SC-011)
- [ ] T050 [US12] knowledge.mjs: folders (Company, Projects, Status, Departments, Digests, Tasks), upload endpoint POST /api/knowledge/upload (multipart or base64, 25 MB) reusing documents.mjs extraction; archive/edit keep index hooks
- [ ] T051 [US12] knowledge-index.mjs: heading-aware chunking, Zvec collection at data/knowledge.zvec with full-text query by default and hybrid query when an embedding adapter (local ONNX or OpenAI-compatible, optional) is configured, SQLite FTS fallback when bindings are missing, incremental upsert/delete (same path replaces + archives), full rebuild, GET /api/knowledge/search
- [ ] T052 [US12] engine/tools.mjs: search_knowledge tool for PM/leads/specialists; prompts instruct to search before planning and cite paths; run record stores sources
- [ ] T053 [P] [US12] Settings → Brain page: folder tree, upload with progress, index status, Rebuild index, embedding model selector (src/settings.js); task page lists sources

## Phase 3c: M2c Office motion
- [ ] T055 [US13] CEO desk at the front of the office in src/data.js LAYOUT + src/main.js (fixed element, click opens inbox)
- [ ] T056 [US13] src/meetings.js: per-person animation queues, walk-to-target along walkways (reuse person rig, poseWork, applyStandAndFacing), speech bubbles (reuse bubble sprite), scripted lines per event kind, return-to-desk; "Needs you" bubble at the CEO desk clears on acknowledgement
- [ ] T057 [US13] Wire SSE events run_finished/review_started/review_recorded/notification.new(kind ceo_decision|question) into meetings.js; never block on animation
- [ ] T058 [US13] Playwright check in check.mjs: scripted event pair triggers a meeting and returns

## Phase 3d: M2d Correction loop
- [ ] T061 [US15] Tests FIRST: tests/engine.test.mjs additions (correction via lead chat with tagged task → working → new review → resultVersions n+1 with changeSummary; correction from a specialist chat is refused with a hand-off; tagged reference tasks appear in the lead prompt; mid-run note queued, delivered at next turn boundary, survives restart; question does not change state; remember-this writes a rule and the next prompt contains it)
- [ ] T059 [US15] engine/deep-agents.mjs + threads.mjs: message kinds question|correction|note; correction reopens with the correction as first instruction and keeps resultVersions; pending notes table/column injected at the next turn boundary with read timestamps; complete_task records a version with the lead's change summary; standing rules writer (agent/team scope) into office.json rules[] with date and task; prompts include rules
- [ ] T060 [US15] UI: lead chat with `@`/`/` task picker (team tasks, open then done, searchable; chips on the message), message kind Ask / Correct / Note, "Remember this as a standing rule" tick (src/chat.js); task page message box posts into the same thread with the task pre-tagged (src/task-output.js); specialist chat offers "Send to <lead> as a correction"; result version switcher with change summaries; Settings → People/Teams standing-rules editor (T029a)
- [ ] T062 [US15] server/routes-chat.mjs + threads.mjs: `taskRefs[]` on messages, GET /api/teams/:dept/tasks?q= for the picker, reference context builder (brief, latest result, review summary, capped) supplied to the lead/PM run

## Phase 4: M3 Processes
- [ ] T040 [P] [US7] scheduler.mjs: 60 s tick; overdue notify once; escalate blocked/escalated older than settings.escalateAfterHours; skip routines when !models.ready()
- [ ] T041 [P] [US8] routines.mjs: all departments; kind task|digest; built-in daily digest per team created on first boot; Settings → Routines page (list, form, Run now, pause) in src/settings.js
- [ ] T042 [P] [US9] audit.mjs + GET /api/audit; record in PUT /api/office, tools, providers, routines, settings; Settings → Audit page
- [ ] T043 [P] [US9] reporting.mjs KPIs + GET /api/kpis; Settings → Reports dashboard (throughput, cycle p50/p90, lead-review wait, CEO latency, rework, blocked age, overdue, per-agent load, tokens by provider)
- [ ] T044 [US1] Typed events (state_changed, run_started/finished, review_recorded, decision, message, todos_updated) merged into the task timeline
- [ ] T045 [US7][US8][US9] Tests: tests/scheduler.test.mjs (fake clock), tests/audit.test.mjs, tests/reporting.test.mjs (KPIs)

## Phase 5: M4 Hardening
- [ ] T046 check.mjs rewrite: build (assert no demo identifiers in the bundle and record size, SC-008), roster/skills validation from office.json, live-server Playwright smoke (settings scroll isolation, canvas zoom, PM pill, brain icon, CEO desk, task card stepper, inbox, SSE connected, feed render timing); CHECK_LIVE end-to-end task + follow-up + approval
- [ ] T047 [P] Workspace retention (30 days for done/cancelled), SSE connection cap per session, provider_error inbox items
- [ ] T048 [P] README.md, CLAUDE.md, deploy/README.md, CHANGELOG.md rewritten for PM → leads → specialists, providers, inbox, approvals, settings pages; remove 35-seat and CLI-connector rules
- [ ] T049 Release: version bump, `node scripts/release.mjs`, service restart, backup of data/ before migration

## Dependencies
- Phase 1 independent. Phase 3b after T017/T020 (tools) and can run parallel to Phase 3. Phase 3c after T031/T032 (SSE client, PM centre). Phase 3d after T020/T036/T037. Phase 2 after Phase 1 (T004/T009 remove code T025 would otherwise re-touch). T020 depends on T012, T014–T019. Phase 3 after T016/T022 (SSE + routes); T032–T034 can start after T003. Phase 4 after T020. Phase 5 after Phase 3.
