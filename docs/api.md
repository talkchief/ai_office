# Office API and live events

The contract between the server and any interface (the current page, or the React Three Fiber rebuild). All routes are under `/api`, JSON in and out. Mutating requests must come from the page's own origin. Errors are `{ "error": "A plain sentence." }` with status 400 (bad input), 404, 409 (not allowed in the current state, or no model key yet), 401 (office locked, or not signed in) or 403 (in hosted mode: a task or project that belongs to someone else — `This task belongs to someone else in the office.` — or a route for owners and admins only).

## Tasks

| Route | Does |
|---|---|
| `GET /tasks` | All tasks, list shape (below). |
| `POST /tasks` | Create. `{ dept, text, depts?, assignee?, dueAt?, priority? (0–2), backlog?, completionApproval?, visibility? ("private" \| "public"), sharedWith?: { users: [id], groups: [id] } }`. `dept: "auto", depts: "auto"` lets the Program Manager choose the teams. `depts: [a, b]` involves several teams. Empty `text` → 400. No model key → 409 unless `backlog`. |
| `GET /tasks/:id` | Detail shape (below). |
| `POST /tasks/:id/share` | Hosted: `{ visibility, sharedWith: { users, groups } }` → the task in list shape. The task's owner or an office owner/admin only; ids must name members and groups of the office. Everyone receives `task.removed { id }`, then those who may see it `task.updated`. |
| `POST /tasks/:id/attach` | `{ name, data (base64), type? }` → `{ attachments }`. Files land under `/work/inbox/`; 409 once the task has started. When the task belongs to a project, readable text is also filed in the project's Brain folder. |
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

**List shape:** the task record without large fields, plus `teamName`, `resultPreview`, `versions`, `pendingActions [{ name, agent, requestedAt }]`, `runs` (without output), `subtasks [{ id, title, agent, state }]`, `completedSteps`. Useful fields: `id, title, text, dept, depts, autoRoute, agent, assignee, dueAt, priority, state, stateSince, progressLine, createdAt, updatedAt, doneAt, seenAt, calls, tokens, error, kind` (`task` or `evaluation`), and in hosted mode `ownerId`, `visibility`, `sharedWith { users, groups }`, `origin { channel: web \| chat \| routine \| email, from?, messageId?, subject?, routineId? }`, `attachments [{ name, bytes, type, at }]`.

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
| `task.removed` | `{ id }` — the task's audience changed (hosted); drop it, and take it back if a `task.updated` follows. |
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
| `GET/PUT /providers` | Providers (never keys: `hasKey`, `keySource`), models, `roleDefaults`, `roleEfforts`. Send `apiKey` to set a key, `clearKey` to remove one. In hosted mode these routes do not exist (404): the platform's live at `/admin/providers`. |
| `POST /providers/:id/test`, `GET /providers/:id/models` | Test a key; list the provider's models. |
| `GET/PUT /settings` | `maxConcurrentJobs` (1–8), `runTimeoutMinutes` (1–480), `escalateAfterHours` (0.25–72), `digestTime` (HH:MM), `knowledgeSeedNotes` (0–20), `outboundTools`, `readOnlyTools`, `publicOrigin`. |
| `GET /tools`, `POST /tools`, `DELETE /tools/:id` | Connectors. Items have `type` (`builtin`, `http`, `sse`, `stdio`, `candidate`), `auth` (`signed-in`, `not-signed-in`, `none`), `assignedTeams`. |
| `POST /tools/:id/import` | Import a connector found in Claude Code. |
| `POST /tools/:id/oauth/start` | Returns `{ url }` to open in a new window; the office finishes sign-in at its own callback. `POST /tools/:id/oauth/logout` signs out. |
| `GET /tools/catalog` | Every connected tool `{ name, description, outbound }`. |
| `GET/POST /routines`, `POST /routines/:id`, `DELETE /routines/:id`, `POST /routines/:id/run \| pause \| resume` | Routines for any team. `POST /routines { dept, agent, text, needsOk }`; incomplete input → 400 with `needsTime`, `needsDay` or `noSchedule`. |
| `GET /reports?days=`, `GET /kpis?days=` | Team report; KPIs: `throughput { done, perDay, series }`, `cycle { p50, p90 }`, `leadReviewMs`, `ceoLatencyMs`, `reworkRate`, `blockedAgeMs`, `overdue`, `needsYou`, `agents`, `tokensByModel`, `teams`. |
| `GET /audit?limit=&area=` | `[{ seq, at, actor, area, summary, diff }]` |

## Accounts, roles and sharing (hosted mode)

`AO_MODE=hosted`. Sign-in is a session cookie (`ao_session`, HttpOnly, Lax, seven days). Roles inside an office: `owner` (everything, cannot be removed), `admin` (everything but ownership and inviting admins), `member` (own tasks, shared and public ones, the Brain, Teams read-only). Platform administrators additionally get `/admin/*`.

| Route | Does |
|---|---|
| `GET /auth/status` | `{ mode, locked, user, secure, registrationOpen, providersReady }` (single mode: `{ mode: "single", locked, secure, accessRequired, providersReady }`). |
| `POST /auth/register` | `{ email, password (≥ 10), name, officeName }` → `201 { user, tenant }` and the cookie; 409 taken; 403 invitation-only. Over HTTPS or locally; rate-limited per address. |
| `POST /auth/login`, `POST /auth/logout` | `{ email, password, tenantId? }` → `{ user, tenant }` and the cookie (401 for a wrong pair, 403 when not a member of any office) / clears the cookie. |
| `GET /auth/invite/:token`, `POST /auth/accept` | What an invitation is for; `{ token, name?, password }` joins the office (an existing account signs in with its own password). 410 expired or used. |
| `GET /auth/me` | `{ user { id, email, name, role, platformAdmin }, tenant, groups, mail { address }, prefs, tenants }`. |
| `POST /auth/switch`, `POST /auth/password`, `PUT /auth/prefs` | `{ tenantId }`; `{ current, next }`; `{ name?, notifyByEmail?: none \| mine \| all }`. |
| `POST /auth/invite`, `DELETE /auth/invite/:hash` | Owner or admin (only the owner invites admins): `{ email, role }` → `201 { email, role, expiresAt, link, sent }`; revoke. |
| `GET /users`, `PUT /users/:id`, `DELETE /users/:id` | Members `{ id, name, email, role, lastLoginAt }` and (owner/admin) open invitations; `{ role }` (owner only; the owner → 409); remove (an admin removes members only). |
| `GET/POST /groups`, `PUT/DELETE /groups/:id`, `PUT /groups/:id/members` | Member groups (people, not AI teams): `{ name, users? }`, `{ name }`, `{ users: [id] }`. Owner or admin. |
| `GET/PUT /projects/:id` | Projects carry `ownerId`, `visibility`, `sharedWith`; the project's owner or an office admin changes them. Sharing a project shares its tasks. |
| `GET /health` | Adds `mode`, `limits { maxTeams, maxMembersPerTeam }` and `platform { managedModels }`. |

Members and admins only see what the rules allow: `GET /tasks`, `/artifacts`, `/reports`, `/kpis`, `/usage`, `/projects` and the event stream are filtered; `GET /tasks/:id` and every `/tasks/:id/*` answer 403 for someone else's private task. Inbox items reach the person they are addressed to and the owner/admin. `PUT /settings`, `PUT /office`, `/tools*`, `/vault*`, the Agency's hire and skill routes, Brain re-indexing and note deletion, team tests and `GET /audit` need owner or admin.

### Platform panel (platform administrators)

| Route | Does |
|---|---|
| `GET/PUT /admin/config` | `{ limits { maxTeams (1–50), maxMembersPerTeam (2–20) }, registration (open \| invite), adminEmails, publicOrigin, tenants { idleMinutes (1–1440), maxLoaded (1–500) }, mail { provider (postmark \| mailgun), domain, from, region (us \| eu), dryRun, apiKey?, clearApiKey?, webhookSecret?, clearWebhookSecret? } }`. Secrets are write-only: the response carries `mail.hasApiKey`, `mail.hasWebhookSecret`, `mail.enabled`, the `webhooks` addresses to paste into the provider and a `secretSuggestion`. Limits apply to every office's next change; mail applies at once. |
| `POST /admin/mail/test` | A test message to the administrator's own address with the saved mail set-up → `{ ok, to, dryRun, outbox }`. |
| `GET/PUT /admin/providers`, `POST /admin/providers/:id/test`, `GET /admin/providers/:id/models` | The one model registry every office inherits; same bodies as `/providers`. |
| `GET /admin/tenants`, `POST /admin/tenants/:id/suspend \| resume` | Every office: owner, people, teams, open tasks, tokens, loaded or put away, suspended. |
| `GET /admin/users?q=`, `PUT /admin/users/:id` | People across offices; `{ platformAdmin }`. |
| `GET /admin/log` | What platform administrators did. |

### Email intake

| Route | Does |
|---|---|
| `POST /mail/inbound/:provider` | The provider's webhook (`postmark`, `mailgun`). No cookie, no same-origin check; the shared secret (Basic `postmark:<secret>`, `X-AO-Webhook-Token`) or Mailgun's signature is the proof. `202 { ok }` and the message is handled in the background; `200 { duplicate: true }` for a repeated delivery; 401, 400, 413 (over 40 MB), 503 (mail not configured). |
| `GET /mail/profile` | `{ enabled, domain, address, senders [{ id, address, verifiedAt, pending }], prefs }`. |
| `POST /mail/senders`, `POST /mail/senders/:id/verify`, `DELETE /mail/senders/:id` | `{ address }` mails a six-digit code (five per hour); `{ code }`; remove. |
| `POST /mail/alias/rotate`, `POST /mail/test` | A new random part in the alias; a test message to the account email. |

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
