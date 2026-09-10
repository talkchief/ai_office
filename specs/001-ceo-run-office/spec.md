# Feature Specification: CEO-run office on a Deep Agents harness

**Feature Branch**: `001-ceo-run-office`
**Created**: 2026-09-10
**Status**: Draft
**Input**: Owner review of Talkchief AI Space 3.6.1: stuck lead handoffs, sticky "verified" banners, unfriendly progress UI, weak execution harness, PM/Brain placement, budgets, settings scroll leak, missing company processes, provider lock-in.

## Clarifications

### Session 2026-09-10
- Q: When does closing a task need CEO approval? → A: Only when an outbound action is involved; lead approval closes ordinary tasks. A per-team toggle can require CEO approval on every task (default off).
- Q: Which tools may a specialist use in free chat outside a task? → A: Brain search only; connectors are used inside tasks only.
- Q: How long may a task stay blocked or waiting before re-escalation? → A: 1 hour, then it is repeated in the daily digest.
- Q: Default Brain index? → A: Full-text only for now (Zvec keyword index). Vector search is an optional upgrade enabled by choosing an embedding model in Settings → Models; no embedding model ships by default.
- Q: Re-uploading a document with the same path? → A (default chosen): replaces it; the previous copy is archived under `.archive/` and the index is updated.
- Q: Glossary → Program Manager (PM) is the supervisor role in all UI text; Brain is the knowledge store in UI text, `knowledge` in code.

## User Scenarios & Testing

### User Story 1 - A follow-up never gets stuck (Priority: P1)
The CEO opens a task or an agent's chat, asks for a change or a status, and the request lands in that task's own thread. The Program Manager (PM) re-engages the team; when a specialist submits work, the department lead reviews it; the CEO sees the state move without doing anything else.

**Why this priority**: This is the failure the CEO hits most often today and it makes results untrustworthy.

**Independent Test**: With a scripted model, post a message on a done task; assert the task moves to In progress, then Lead reviewing, then either Done or Needs you, and that every hop is an event.

**Acceptance Scenarios**:
1. **Given** a task in any non-cancelled state, **When** the CEO posts a message on it, **Then** the message is stored in the task thread and the PM run resumes with that message.
2. **Given** a specialist run returns, **When** no lead review is active, **Then** the task is in `awaiting_lead_review` and the PM's next action is the lead review; if the PM stops without it, the engine re-prompts once, then escalates to the inbox.
3. **Given** an agent chat that is not about a task, **When** the CEO asks for work, **Then** the reply offers "Make this a task" and no action is executed from chat.

### User Story 2 - "Done" clears when seen (Priority: P1)
When a task finishes, the agent's pill, desk and the feed card say Done. When the CEO opens that task, those indicators clear and stay cleared.

**Independent Test**: Mark a task done, open it via the API, assert `seenAt` is set, the activity projection for its agents is idle, and the feed card no longer carries the Done marker.

**Acceptance Scenarios**:
1. **Given** a done task not yet seen, **When** the task detail opens, **Then** `seenAt` is recorded and notifications for that task are read.
2. **Given** a seen task, **When** the feed re-renders, **Then** it shows the task under Closed with no Done marker.

### User Story 3 - The CEO decides from one inbox, and approvals execute (Priority: P1)
Everything that needs the CEO (an outbound action, completion approval, a question, a blocker, an escalation, an overdue task) appears in one inbox with the action inline. Approving an outbound action executes exactly that action; rejecting sends the note back to the team.

**Independent Test**: Scripted specialist calls a send tool; assert the task parks in `awaiting_ceo` with the pending action; approve; assert the tool ran once and the run continued; reject; assert the team got the note and nothing was sent.

**Acceptance Scenarios**:
1. **Given** a run calls a tool classified outbound, **When** it is called, **Then** the run pauses, the inbox shows the action with its arguments, and nothing executes.
2. **Given** a pending action, **When** the CEO approves or edits and approves, **Then** the (edited) action executes once and the result is in the timeline.
3. **Given** a pending action, **When** the CEO rejects with a note, **Then** the action is skipped and the note reaches the agent.
4. **Given** the tab is in the background and desktop alerts are enabled, **When** an item lands in Needs you, **Then** a browser notification appears; clicking it opens the item.

### User Story 4 - Any model, per role (Priority: P1)
The CEO adds provider keys (Anthropic, OpenAI, OpenRouter, custom OpenAI-compatible), tests the connection, and chooses which model runs the PM, the department leads, the specialists, reviews and chat. Any team, agent, routine or task can override.

**Independent Test**: Configure two providers in a fixture; resolve models for a task with agent and team overrides; assert precedence; assert `GET /api/providers` never returns a key.

**Acceptance Scenarios**:
1. **Given** no provider key, **When** the CEO starts a task, **Then** the office refuses with a link to Settings → Models and the idea is kept.
2. **Given** an OpenRouter key, **When** the CEO sets a GLM model as the specialist default, **Then** specialist runs use it and the timeline names the model used per run.

### User Story 5 - Settings is a page, and the office never zooms under it (Priority: P2)
Settings (Office, Teams, People, Models, Tools, Skills, Routines, Reports, Brain, Audit) is a full page that hides the 3D office. Scrolling anywhere in the UI never zooms or pans the scene.

**Independent Test**: Playwright: open `#/settings/teams`, wheel over the content, assert the scene zoom value is unchanged; close, wheel over the canvas, assert it changed.

### User Story 6 - The office reads at a glance (Priority: P2)
The PM sits at the centre of the office; the Brain is an icon at the top-left of the canvas. Each agent shows a name and at most one short chip (Working, Reviewing, Needs you, Done). Feed cards show a five-step progress line and one plain sentence. The task page shows actions first, the result second, and the story of how it was done third.

**Independent Test**: Playwright screenshot assertions on the pill DOM (one chip max), the stepper, and the task page order.

### User Story 7 - Assign, date, and escalate (Priority: P2)
The CEO can hand a task to a named agent, set a due date, and be told when it is overdue or when a blocked task has waited too long.

**Independent Test**: Create a task with `assignee` and a past `dueAt`; tick the scheduler with a fake clock; assert one overdue notification and an `escalated` state after the configured hours.

### User Story 8 - Every department reports daily (Priority: P3)
Each department has a daily digest routine (editable, pausable) whose result lands in the inbox and the Brain. Routines exist for all six departments and are managed on a Settings page.

### User Story 9 - The CEO measures the company (Priority: P3)
A Reports page shows throughput, cycle time, CEO latency, rework rate, blocked age, overdue count, per-agent load and tokens by provider. An Audit page lists every configuration change.

### User Story 10 - No budgets (Priority: P1)
No call or token budget exists anywhere. Long tasks are never cut off by a counter. A runaway run is stopped by a wall-clock limit and shown as Blocked with Retry.

### User Story 11 - Work that spans departments (Priority: P2)
A task can involve several departments; the PM delegates to each lead and combines the result. The separate project pipeline is retired.

### User Story 12 - The Brain is the company's knowledge base (Priority: P1)
The CEO uploads documents (PDF, DOCX, Markdown, CSV, text) into the Brain, organised by folder (Company, Projects, Status, Departments). The PM, leads and specialists search it semantically and by keyword before and during work, and cite what they used. Reviewed deliverables and digests are filed back into it.

**Independent Test**: Upload a PDF; assert it is extracted, chunked and indexed; call `search_knowledge` with a paraphrase of a sentence in it; assert the chunk is in the top 3 results with its source path.

**Acceptance Scenarios**:
1. **Given** a document under 25 MB, **When** the CEO uploads it to a Brain folder, **Then** its text is extracted, chunked, embedded, and searchable within 60 seconds, and the note appears in the graph.
2. **Given** an agent run, **When** the agent calls `search_knowledge(query, folder?)`, **Then** it receives the top matches with source path and heading, combining vector similarity and full-text matching.
3. **Given** a note is edited or archived, **When** the change is saved, **Then** the index reflects it on the next search.
4. **Given** no embedding model is configured, **When** the office boots, **Then** full-text search works with no key and no download.

### User Story 13 - The office moves (Priority: P2)
When one person needs something from another, they walk to that person's desk and a short conversation appears as speech bubbles: a specialist walks to the lead to hand over work, the lead walks to the PM to report, and the PM walks to the CEO's desk when a decision is needed.

**Independent Test**: Emit a scripted run_finished(specialist) then review_started(lead) event pair; assert the specialist rig's target is the lead's desk, a bubble with the handover line appears, and both return to their desks after the exchange.

**Acceptance Scenarios**:
1. **Given** a specialist run finishes, **When** the event arrives, **Then** the specialist walks to the lead's desk, shows a one-line bubble, the lead answers with a bubble, and both return.
2. **Given** the PM needs the CEO, **When** a decision or question is created, **Then** the PM walks to the CEO desk at the front of the office and stays with a "Needs you" bubble until the item is acknowledged.
3. **Given** many events, **When** they arrive faster than animations play, **Then** they are queued per person and never overlap; the scene never blocks on animation.

### User Story 14 - The CEO shapes the workforce (Priority: P1)
The CEO adds, renames or removes teams and agents in Settings, picks each team's lead, sets each agent's role, description, standing rules, model and tools, and decides how much work runs in parallel: office-wide, per team, and one run at a time per agent. The office scene re-lays itself out for any number of teams and agents.

**Independent Test**: Create a seventh team with three agents through the API; assert validation, that the scene layout function returns seven pods on the ring plus the PM centre, that the lead is on the front desk, and that a task in that team runs with at most the team's parallel-run limit (engine test with a fake model that requests four specialists at once).

**Acceptance Scenarios**:
1. **Given** Settings → Teams, **When** the CEO adds a team or an agent, **Then** it is saved with validation (1–12 teams, 2–12 agents per team including one lead) and appears in the office on the next page load without a restart.
2. **Given** an agent or team with running work, **When** the CEO tries to remove or move it, **Then** the office refuses with the list of running tasks.
3. **Given** a team's parallel-run limit is 2, **When** its lead delegates four runs at once, **Then** at most two run concurrently and the rest queue; the task is never blocked by the limit.
4. **Given** the office-wide job limit is reached, **When** a new task starts, **Then** it waits in Queued with its position shown, and starts as soon as a slot frees.

### User Story 15 - Correct the work from chat (Priority: P1)
In the team lead's chat (or from the task page, which opens the same thread), the CEO tags a task with `@` or `/` and says what to change in its delivered or in-progress result ("shorten the intro", "use last quarter's numbers", "wrong tone"). The lead owns the rework: it re-delegates, re-reviews, and a new version of the result appears next to the old one with what changed. Tagging also works for older tasks of that team, so the CEO can say "like @Q2 pricing sheet". The CEO can tick "remember this" so the correction becomes a standing rule for that agent or team. Specialist chats answer questions only; they cannot take corrections.

**Why this priority**: Without a correction loop the CEO redoes the work by hand, and the office never improves.

**Independent Test**: With a scripted model, post a correction on a done task; assert a new result version is produced, the lead review ran again, the task page lists v1 and v2 with the change summary, and, when "remember" was ticked, the rule appears in the agent's standing rules and in the next run's prompt.

**Acceptance Scenarios**:
1. **Given** a done task of a team, **When** the CEO posts a correction in that team lead's chat with the task tagged (or from the task page), **Then** the task returns to In progress with the correction as the first instruction, the lead re-delegates (same specialist unless it reassigns), re-reviews, and completion produces result version n+1.
6. **Given** the lead's chat, **When** the CEO types `@` or `/`, **Then** a picker lists that team's tasks (open first, then done, newest first, searchable by title); choosing one attaches it to the message, and the lead receives the tagged task's brief, latest result and review as reference context.
7. **Given** a specialist's chat, **When** the CEO asks for a change, **Then** the specialist answers the question and offers "Send this to <lead> as a correction", which opens the lead's chat with the task tagged and the text prefilled.
2. **Given** a task that is running, **When** the CEO posts a note, **Then** it is queued and delivered to the PM at the next turn boundary (after the current run returns), the UI shows "Queued, will be picked up", and the timeline records when it was read.
3. **Given** a correction, **When** the CEO ticks "remember this", **Then** a short absolute rule is written to the agent's (or team's) standing rules with the date and the task, and it is included in every later prompt for that agent (or team).
4. **Given** a task with several versions, **When** the task page opens, **Then** the latest version is shown, older versions are one click away, and each version carries the correction that caused it and the lead's summary of what changed.
5. **Given** a message that is a question, not a correction ("why did you choose X?"), **When** the CEO sends it, **Then** the agent answers in the thread without reopening the task; the CEO chooses "Apply as correction" to reopen.

### Edge Cases
- Server restart mid-run: a run parked on an approval resumes as `awaiting_ceo`; any other active run becomes `blocked` and Retry continues from the checkpoint without repeating finished work.
- A provider returns a refusal or an error: the task is `blocked` with the reason; retry is available; the inbox gets one `provider_error`.
- A message posted on a cancelled task is refused with a clear reason.
- An outbound tool whose server does not declare read-only hints is treated as outbound unless the CEO lists it as read-only.
- Two approvals arrive for the same action: the second is a no-op with a message.
- The SSE connection drops: the UI shows Reconnecting and falls back to polling until it reconnects.
- The knowledge folder is large: agents read notes on demand; the planner prompt seeds at most `knowledgeSeedNotes` (default 6) search hits.

## Requirements

### Functional Requirements

- **FR-001**: Each task MUST have exactly one state from: backlog, queued, planning, working, awaiting_lead_review, reviewing, awaiting_ceo, executing, saving, done, blocked, escalated, cancelled. Every transition MUST write an event with from/to.
- **FR-002**: Every task MUST own a durable thread (thread id = task id). Messages from the CEO on a task MUST be stored and MUST resume the task's PM run with that message.
- **FR-003**: Specialist runs MUST NOT be able to record a review or complete a task; only a lead may record a review and only the PM may complete, and completion MUST be refused unless an approved review exists since the last specialist run.
- **FR-004**: If a task sits in awaiting_lead_review after the PM ends its turn, the engine MUST re-prompt the PM once and then escalate to the inbox.
- **FR-005**: Opening a task MUST record `seenAt`, mark its notifications read, and clear Done indicators for that task in every view.
- **FR-006**: Any tool classified outbound MUST pause the run for a CEO decision (approve, edit, reject). Approve/edit MUST execute the action once; edited arguments MUST validate against the tool's input schema or the edit is refused with the validation error; reject MUST return the note to the agent without executing. A second decision on the same action MUST be a no-op with a message.
- **FR-007**: Outbound classification MUST use the tool's read-only annotation when present, a name pattern otherwise, and MUST be overridable per tool in settings.
- **FR-008**: Evaluation runs MUST never receive outbound tools.
- **FR-009**: The inbox MUST list items with kinds ceo_decision, ceo_approval, question, blocked, escalated, done, overdue, digest, routine_failed, config_changed, provider_error, with read and acknowledged timestamps; taking the linked action MUST acknowledge the item.
- **FR-010**: Live updates MUST be delivered over Server-Sent Events with replay from the last event id, and the UI MUST fall back to polling after repeated failures.
- **FR-011**: The office MUST support providers of type anthropic, openai and openai-compatible (base URL + key + headers), with keys stored server-side (mode 0600 file or environment) and never returned to the browser.
- **FR-012**: Model and effort MUST resolve per role (pm, lead, specialist, review, chat) with precedence task > routine > agent > team > role default > office default.
- **FR-013**: Effort MUST map to provider-native controls (Anthropic output effort and adaptive thinking; OpenAI reasoning effort) and be ignored where unsupported.
- **FR-014**: Each provider MUST expose Test connection and a model list; starting work with no ready provider MUST be refused with a link to Settings → Models.
- **FR-015**: Settings MUST be a full page reachable by hash route that hides the 3D scene; the scene MUST NOT receive wheel events whose target is inside any scrollable UI.
- **FR-016**: The PM MUST be rendered at the office centre with its own chat; the Brain MUST be an icon at the top-left of the canvas that opens the graph overlay; a CEO desk MUST be a fixed element at the front of the office (click opens the inbox).
- **FR-017**: Agent pills MUST show at most one state chip from Working, Reviewing, Needs you, Done; desk screens MUST use the same five states.
- **FR-018**: Feed cards MUST show a five-step progress (Plan, Work, Lead review, Your approval, Done), one progress sentence, assignee and due date; feed re-renders MUST preserve scroll position.
- **FR-019**: The task page MUST present actions first, result second, and the timeline (todos, runs with live preview, review criteria, decisions, messages) third; state labels MUST come from one vocabulary module.
- **FR-020**: Task creation MUST accept an optional assignee, due date, priority and additional departments; the assignee MUST belong to one of the task's departments.
- **FR-021**: The scheduler MUST notify once when a task passes its due date and MUST re-escalate a task blocked or escalated longer than `escalateAfterHours` (default 1) and repeat it in the daily digest.
- **FR-022**: Routines MUST be available for every department, MUST include a built-in daily digest per department, and MUST be manageable on a Settings page including Run now, pause and edit.
- **FR-023**: Every configuration change (teams, agents, skills, tools, providers, routines, settings) MUST be recorded in an audit log with a redacted diff.
- **FR-024**: Reports MUST compute throughput, median and p90 cycle time, time in awaiting_lead_review, time in awaiting_ceo, rework rate, blocked age, overdue count, per-agent load and tokens by provider for 7, 30 and 90 days.
- **FR-025**: No call or token budget MUST exist; the only execution limits are the parallelism settings in FR-044 and a wall-clock limit per run.
- **FR-026**: On restart, runs parked on an approval MUST recover as awaiting_ceo; other active runs MUST become blocked and Retry MUST continue from the checkpoint.
- **FR-027**: Existing job records MUST be migrated once, idempotently, to the new schema; records without a checkpoint MUST be marked legacy and read-only.
- **FR-028**: Demo mode and its modules MUST be removed; the served app MUST be the only UI code path.
- **FR-029**: MCP connectors MUST be defined in the office's own store, with the office's own OAuth flow for servers that need it (PKCE and `state` verified; callback accepted only on the configured public origin; tokens stored mode 0600 and redacted everywhere); discovery from a Claude Code installation MAY offer import but MUST NOT be required at runtime.
- **FR-030**: Agents MUST read knowledge on demand through the workspace filesystem; the Brain MUST only be written through the save_knowledge tool or task completion.
- **FR-031**: The Brain MUST accept document uploads (PDF, DOCX, Markdown, CSV, plain text; 25 MB max) into named folders, extract text, chunk it (heading-aware, ~800 tokens, 100 overlap) and index it for search. A document is identified by its path; uploading to an existing path replaces it and archives the previous copy.
- **FR-032**: Knowledge search MUST run through an embedded Zvec collection stored under data/: full-text (default) and, when an embedding model is configured, hybrid vector plus full-text, with a `search_knowledge(query, folder?, k?)` tool available to the PM, leads and specialists, returning path, heading, snippet and score.
- **FR-033**: Embeddings MUST be optional and provider-agnostic: none by default (full-text only); a local ONNX model or an OpenAI-compatible embedding endpoint MAY be selected in Settings → Models; selecting or changing one MUST trigger a re-index, during which full-text search keeps working. If Zvec bindings are unavailable on the host, search MUST fall back to SQLite FTS with the same tool contract.
- **FR-034**: The index MUST be kept consistent with the Brain: create, edit, archive and completion-filing MUST update it; a full rebuild MUST be available from Settings → Brain.
- **FR-035**: Agents MUST cite the knowledge they used (paths) in the run record; the task page MUST list sources.
- **FR-036**: The scene MUST animate handovers: on run_finished(specialist) the specialist walks to its lead; on review_recorded the lead walks to the PM; on ceo_decision/question the PM walks to a CEO desk placed at the front of the office; each with short speech bubbles (max 80 characters, at most 2 per person per meeting, whole meeting under 6 s) and a return to the desk; animations MUST be queued per person and MUST never delay engine state.
- **FR-037**: The CEO desk MUST be a fixed scene element at the front of the office; a "Needs you" bubble there MUST clear when the inbox item is acknowledged.
- **FR-038**: Completing a task MUST require CEO approval only when the team's `completionApproval` toggle is on (default off); outbound actions always pause regardless.
- **FR-039**: Free chat with an agent outside a task MUST have only the `search_knowledge` tool (plus the agent's own task history in the prompt); connectors are available inside tasks only.
- **FR-040**: A chat reply MAY carry a suggested task {dept, text, assignee}; the UI MUST offer one-click creation and nothing is executed from chat.
- **FR-041**: Settings MUST expose and persist: maxConcurrentJobs (2), runTimeoutMinutes (45), escalateAfterHours (1), outboundTools[], readOnlyTools[], digestTime (08:00 local), knowledgeSeedNotes (6), embeddingModel (none).
- **FR-042**: Live-update connections MUST be authenticated like every API route, capped at 4 per session, and MUST send a heartbeat every 25 s.
- **FR-043**: Teams and agents MUST be creatable, editable and removable in Settings (1–12 teams; 2–12 agents per team including exactly one lead; fields: name, role, description, standing rules, model, effort, tools, inheritTools); the scene MUST lay out any number of teams on a ring around the PM and any number of agents on a desk grid; removal or moving of busy agents/teams MUST be refused with the running tasks named.
- **FR-044**: Execution parallelism MUST be configurable and MUST only queue work, never block it: office-wide `maxConcurrentJobs` (default 2), per-team `maxParallelRuns` (1–4, default 2; concurrent specialist runs a lead may have in flight), and one run at a time per agent. Rework rounds beyond the team's `maxReworkRounds` (default 3) MUST escalate to the inbox rather than block. Call and token budgets MUST NOT exist.
- **FR-045**: Corrections MUST be given through the team lead (the lead's chat or the task page, which posts into the same task thread). A lead's chat message MUST be one of: question (answered, no state change), correction (reopens or redirects the tagged task), or note (queued to a running tagged task). Specialist chats MUST accept questions only and MUST offer a hand-off to the lead for corrections.
- **FR-050**: The lead's chat MUST support tagging tasks with `@` or `/`: a picker over that team's tasks (open first, then done, newest first, searchable), attaching the task id to the message; tagged tasks MUST be supplied to the lead as reference context (brief, latest result, review summary), and one message MAY tag several tasks (one target, others as reference).
- **FR-046**: A correction on a done task MUST return it to `working` with the correction as the first instruction to the PM, keep the previous result as a version, require a new lead review, and produce a new result version with the lead's change summary on completion.
- **FR-047**: A note posted while a run is active MUST be queued and injected as the next CEO message at the next turn boundary; the thread MUST show queued/read timestamps; the note MUST never be lost on restart.
- **FR-048**: A correction MAY be marked "remember this"; the office MUST then append a dated, one-line absolute rule to the agent's or team's standing rules (owner-editable in Settings → People/Teams) and include it in every later prompt for that scope. Rules MUST never be invented from prose the CEO did not write.
- **FR-049**: Results MUST be versioned per task (v1…vn) with, per version: createdAt, the triggering correction (if any), the lead's change summary, and the deliverable path; the task page MUST show the latest and allow opening older versions.

### Key Entities
- **Task**: state, kind, depts, assignee, dueAt, seenAt, thread, todos, runs, review(s), pendingActions, decisions, resultVersions[], result (latest), tokens.
- **Result version**: n, createdAt, correction (message id), changeSummary, path.
- **Standing rule**: scope (agent|team), text, createdAt, sourceTask.
- **Run**: one delegated unit of work (agent, subagent name, state, preview, tools, timing).
- **Thread / Message**: durable conversation per task or per agent.
- **Notification**: inbox item with kind, severity, action, read/acked.
- **Provider / Model / RoleDefaults**: registry entries and per-role selection.
- **Routine**: scheduled task definition incl. digest kind.
- **Audit entry**: actor, area, summary, diff.
- **Settings**: the fields in FR-041 plus maxConcurrentJobs; per-team maxParallelRuns and maxReworkRounds live on the team.
- **Knowledge document / chunk**: path, folder, title, headings, chunk text, embedding, updatedAt.
- **Meeting (animation)**: from, to, lines[], startedAt; client-side only.

## Success Criteria

- **SC-001**: In the engine test suite, 100% of tasks that receive a CEO message leave `awaiting_lead_review` within one re-prompt or become `escalated`; none remain without an owner.
- **SC-002**: After opening a done task, zero Done indicators remain for that task in the scene, feed and inbox (Playwright assertion).
- **SC-003**: Every outbound tool call in tests pauses before execution; approve executes exactly once; reject executes zero times.
- **SC-004**: Provider precedence tests pass for all six levels; `GET /api/providers` responses contain no key material (regex scan in test).
- **SC-005**: Wheel events inside settings, the feed, dialogs and the rail change the scene zoom by 0 in Playwright; wheel over the canvas changes it.
- **SC-006**: A task created with a past due date produces exactly one overdue notification and reaches `escalated` after the configured hours in a fake-clock test.
- **SC-007**: `npm test` and `npm run check` pass on the service Node runtime before each milestone deploy.
- **SC-008**: The bundled UI has no reference to demo modules; the served bundle size drops by at least the size of the removed demo modules.
- **SC-009**: A CEO can add a provider, pick models per role, create a task, approve an outbound action and see the result without leaving the app or editing files.
- **SC-010**: For a fixture of 20 documents, keyword queries return the source chunk in the top 3 for at least 90% of 30 queries in tests; with an embedding model enabled, paraphrased queries reach the same bar.
- **SC-011**: Indexing a 5 MB PDF completes within 60 s on the service host in full-text mode.
- **SC-014**: In the engine tests, 100% of corrections on done tasks yield a new result version after a fresh lead review; notes posted mid-run are delivered within one turn boundary and survive a restart.
- **SC-013**: With a team limit of 2 and four delegated runs, the engine test observes at most 2 concurrent specialist model calls and all four complete.
- **SC-012**: Handover animations play for 100% of run_finished/review_recorded/ceo_decision events in a Playwright run, with no overlap per person and no change to engine timing.

## Assumptions
- Single CEO user; office access key remains the only login.
- API-key billing for all providers; no subscription logins.
- Connectors reachable from the service host over HTTP/SSE/stdio MCP; claude.ai-managed connectors must be re-authorised through the office's own OAuth flow or replaced.
- Node 22 runtime as deployed; SQLite remains the store; Zvec (@zvec/zvec) runs in-process on linux-x64 with an SQLite FTS fallback.
- Embeddings are off by default; enabling them is a settings choice with a re-index.
