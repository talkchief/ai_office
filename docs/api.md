# Office API and live events

The contract between the server and any interface (the current page, or the React Three Fiber rebuild). All routes are under `/api`, JSON in and out. Mutating requests must come from the page's own origin. Errors are `{ "error": "A plain sentence." }` with status 400 (bad input), 404, 409 (not allowed in the current state, or no model key yet) or 401 (office locked).

## Tasks

| Route | Does |
|---|---|
| `GET /tasks` | All tasks, list shape (below). |
| `POST /tasks` | Create. `{ dept, text, depts?, assignee?, dueAt?, priority? (0–2), backlog?, completionApproval? }`. `dept: "auto", depts: "auto"` lets the Program Manager choose the teams. `depts: [a, b]` involves several teams. Empty `text` → 400. No model key → 409 unless `backlog`. |
| `GET /tasks/:id` | Detail shape (below). |
| `POST /tasks/:id/queue` | Edit a queued idea: `{ text?, priority?, state: "queued" \| "backlog" }`. |
| `POST /tasks/:id/cancel` | Stop and close. Nothing is filed. |
| `POST /tasks/:id/seen` | Mark the result or blocker as seen by the CEO. |
| `POST /tasks/:id/retry` | Continue a blocked or escalated task: `{ feedback? }`. |
| `POST /tasks/:id/message` | `{ text, kind: "question" \| "correction" \| "note" \| "message", agent?, refs?: [taskId], remember?: "agent" \| "team" }`. A correction on a done task reopens it, needs a fresh review and files a new version. A note is delivered at the team's next step. A question is recorded without reopening. `remember` keeps the text as a standing rule. |
| `POST /tasks/:id/answer` | Answer an escalation: `{ text }`. |
| `POST /tasks/:id/decide` | Decide pending actions, one decision per action, in order: `{ decisions: [{ type: "approve" } \| { type: "reject", message } \| { type: "edit", args }] }`. A second decision on the same pause is a no-op. |
| `GET /teams/:dept/tasks?q=` | The `@` picker: up to 30 of the team's tasks, open first, newest first: `{ id, title, state, createdAt, doneAt }`. |
| `POST /teams/:dept/test`, `POST /teams/:dept/tests` | Run one saved team test (`{ testId }`) or all. |

**States:** `backlog`, `queued`, `planning`, `working`, `awaiting_lead_review`, `reviewing`, `executing`, `awaiting_ceo` (a decision or approval waits for the CEO), `escalated` (the team needs direction), `blocked`, `saving`, `done`, `cancelled`. Needs the CEO: `awaiting_ceo`, `escalated`, `blocked`. A result is new until `seenAt >= doneAt`.

**List shape:** the task record without large fields, plus `teamName`, `resultPreview`, `versions`, `pendingActions [{ name, agent, requestedAt }]`, `runs` (without output), `subtasks [{ id, title, agent, state }]`, `completedSteps`. Useful fields: `id, title, text, dept, depts, autoRoute, agent, assignee, dueAt, priority, state, stateSince, progressLine, createdAt, updatedAt, doneAt, seenAt, calls, tokens, error, kind` (`task` or `evaluation`).

**Detail shape:** the full record plus `team { id, name, lead, criteria, guardrails }`, `agents`, `runs [{ id, agent, role, title, state, output, sources, tools, model, startedAt, finishedAt, error }]`, `reviews [{ agent, approved, summary, criteria [{ id, passed, evidence }], checks, at }]`, `resultVersions [{ n, at, result, summary, correction? }]`, `result`, `messages`, `decisions`, `pendingActions [{ name, args, agent }]`, `todos`, `sources`, `liveCalls { [agent]: { preview, state } }`, `events`, `tokensByModel`.

## Chat and threads

| Route | Does |
|---|---|
| `POST /chat` | `{ agent, text, taskId?, refs?, kind?, remember? }`. Returns `{ reply, taskId?, suggestedTask?, read? }`. A lead or the Program Manager takes a non-question as a new task (`taskId`). With `taskId`, a question is answered from the task; a correction goes to the task through the lead. Specialists answer from the Brain only and hand corrections to their lead. |
| `GET /threads/:id?after=` | Messages `{ seq, threadId, at, role: ceo \| agent \| system, agent, kind, text, jobId, meta, deliveredAt }`. Thread ids: `agent:<agentId>` for a person's chat, the task id for a task. |

## Inbox

| Route | Does |
|---|---|
| `GET /inbox?limit=&open=1` | `{ items, counts: { unread, needsYou } }`. Item: `{ id, kind, severity, title, body, jobId, dept, action: { type: decide \| answer \| retry \| open \| note, id? }, at, readAt, ackedAt }`. |
| `POST /inbox/:id/read`, `POST /inbox/read-all`, `POST /inbox/:id/ack` | Mark read or done. |

Kinds: `ceo_decision`, `ceo_approval`, `question`, `blocked`, `provider_error`, `escalated`, `overdue` (all need the CEO), `done`, `digest`, `routine_failed`, `config_changed`. Items clear themselves when the task moves on.

## Live events: `GET /events`

A server-sent event stream. Reconnect with `?lastEventId=` (or the browser's own `Last-Event-ID`) to replay what was missed; `resync` means reload everything. Four connections per browser session at most.

| Event | Data |
|---|---|
| `task.updated` | A task in list shape. |
| `task.state` | `{ id, from, to }` |
| `task.event` | `{ id, type, agent, message, role, approved, … }` for hand-overs worth animating (a run starting or finishing, a review, a decision). |
| `task.live` | `{ id, agent, preview }` — a specialist's draft as it is written, throttled. |
| `notification.new` | An inbox item. |
| `notification.read` | `{ ids, acked? }` |
| `thread.message` | A thread message. |
| `thread.delivered` | Messages passed to the team at its next step. |
| `office.updated` | `{ area, revision? }` — teams, people or connectors changed. |
| `brain.updated` | `{ notes }` |
| `audit.recorded` | `{ seq, area, summary }` |

## Settings

| Route | Does |
|---|---|
| `GET/PUT /office` | Teams, people, skills, standing rules. Send the whole object back. Removing a team with unfinished work → 409. |
| `GET /agents` | `{ agents }` |
| `GET/PUT /providers` | Providers (never keys: `hasKey`, `keySource`), models, `roleDefaults`, `roleEfforts`. Send `apiKey` to set a key, `clearKey` to remove one. |
| `POST /providers/:id/test`, `GET /providers/:id/models` | Test a key; list the provider's models. |
| `GET/PUT /settings` | `maxConcurrentJobs` (1–8), `runTimeoutMinutes` (1–480), `escalateAfterHours` (0.25–72), `digestTime` (HH:MM), `knowledgeSeedNotes` (0–20), `outboundTools`, `readOnlyTools`, `publicOrigin`. |
| `GET /tools`, `POST /tools`, `DELETE /tools/:id` | Connectors. Items have `type` (`builtin`, `http`, `sse`, `stdio`, `candidate`), `auth` (`signed-in`, `not-signed-in`, `none`), `assignedTeams`. |
| `POST /tools/:id/import` | Import a connector found in Claude Code. |
| `POST /tools/:id/oauth/start` | Returns `{ url }` to open in a new window; the office finishes sign-in at its own callback. `POST /tools/:id/oauth/logout` signs out. |
| `GET /tools/catalog` | Every connected tool `{ name, description, outbound }`. |
| `GET/POST /routines`, `POST /routines/:id`, `DELETE /routines/:id`, `POST /routines/:id/run \| pause \| resume` | Routines for any team. `POST /routines { dept, agent, text, needsOk }`; incomplete input → 400 with `needsTime`, `needsDay` or `noSchedule`. |
| `GET /reports?days=`, `GET /kpis?days=` | Team report; KPIs: `throughput { done, perDay, series }`, `cycle { p50, p90 }`, `leadReviewMs`, `ceoLatencyMs`, `reworkRate`, `blockedAgeMs`, `overdue`, `needsYou`, `agents`, `tokensByModel`, `teams`. |
| `GET /audit?limit=&area=` | `[{ seq, at, actor, area, summary, diff }]` |

## The Brain

| Route | Does |
|---|---|
| `GET /brain` | The graph for the Brain view (`notes`, `nodes`, `links`). |
| `GET /knowledge`, `GET /knowledge/folders` | Notes `{ id, title, preview, updatedAt, kind }`; folder names. |
| `GET/POST/DELETE /knowledge/note?id=` · `POST /knowledge` | Read, save (`{ id?, title, content, updatedAt? }`) or archive a note. |
| `POST /knowledge/upload` | `{ folder, name, data: base64 }` (PDF, Word, text, Markdown, CSV; 25 MB). Returns `{ id, replaced, characters }`. |
| `GET /knowledge/search?q=&folder=&k=` | Full-text search results with note ids and passages. |
| `GET /knowledge/status`, `POST /knowledge/reindex` | Index status; rebuild. |

## Health

`GET /health` → `{ ok, version, name, ready, providers, depts, teams, agents, notes, knowledge, connectors, inbox, settings }`. `ready` is false until a provider key is set.
