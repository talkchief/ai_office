# Agents Office — for Claude Code

You are in the Agents Office repo. The office is a company the owner runs as CEO. Every task goes to the **Program Manager**, who hands it to one or more **department leads**; leads hand assignments to their **specialists**, review the result against the team's criteria, and only approved work is filed in the Brain. One exception: a plain question the Brain already answers (what was delivered, when, which file) the Program Manager answers alone from the Brain, citing the notes, and it is filed as answered from the Brain without a team (`complete_task` with `answer`; the task must read as a question and the answer must name `/knowledge/` notes). It runs on API keys from any provider (Anthropic, OpenAI, Google Gemini, OpenRouter, any OpenAI-compatible endpoint), with a model per role, team and person.

The owner most often asks you to change **who is on a team and what they do**, to teach **how a kind of work is done** (a skill), to put something **on the timetable** (a routine), or to change **which connectors a team may use**. Do those through the office's settings or its API, as described below. Do not change `src/`, `engine/`, `server/` or the build for those requests.

## Where the configuration lives

All in the data folder (`data/`, or `AO_DATA`). The server owns these files; do not edit them by hand while it runs.

| File | Holds | Change it in |
|---|---|---|
| `office.json` | Teams, people, skills, standing rules | Settings → Teams & people, Settings → Skills, or `PUT /api/office` |
| `providers.json` (0600) | Provider keys, activated models, who runs on what | Settings → Models & keys, or `PUT /api/providers` |
| `settings.json` | Tasks at once, time limit, reminder window, digest time, approval rules | Settings → Office, or `PUT /api/settings` |
| `tools.json` (0600) | Connectors (MCP servers) and their sign-ins | Settings → Tools & connectors |
| `vault.json` (0600) | The Vault: outside-service keys, database connections, SSH targets | Settings → Vault, or `PUT /api/vault/:id` |
| `accounts.sqlite`, `platform/` (hosted) | Users, offices, groups, sessions, invitations, mail identities; the platform's limits and the one providers file | Manage → Users & groups, Manage → Platform, or `/api/users*`, `/api/groups*`, `/api/admin/*` |
| `workflows.sqlite` | Tasks, threads, inbox, audit log, checkpoints | Never by hand |

No model is built in: the owner saves a provider key, the office fetches that provider's model list (`GET /api/providers/:id/models`), and the owner activates the models the office may use and picks the office default and any per-role models. A lead whose assignment needs another team's expertise calls `hand_to_program_manager`; the Program Manager must delegate that part to the other lead before the task can close, and the other lead's review is then required.

Every change through the API is validated (a bad edit is refused with a sentence, nothing is applied) and recorded in the audit log. **Never print, copy or commit provider keys or connector tokens.** Keys can also come from the environment: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), `OPENROUTER_API_KEY`. Google Gemini is the built-in provider `google`: Google's OpenAI-compatible endpoint, model ids such as `gemini-2.5-flash` (the list drops the `models/` prefix and the non-chat models), its own rate budget rather than OpenRouter's shared one. Gemini 3 thought signatures (returned with every function call, required back with it in later turns) are remembered by tool call id and put back by `thoughtSignatures` in models.mjs; a call whose signature is gone gets Google's bypass value.

## Changing teams and people

For a running office, read `GET /api/office`, change what the owner asked for, and send the whole object back with `PUT /api/office`. A person has `id, department, name, role, does, brief, model, effort, tools, inheritTools, skills, rules`; a team has `id, name, lead, purpose, instructions, criteria, guardrails, checks, tools, skills, models {lead, specialist, review}, maxParallelRuns (1–4), maxReworkRounds (0–5), completionApproval, rules, tests`.

- `does` is the person's job description, read before every assignment. `brief` is the owner's standing instructions to that person (up to 2,000 characters). Both are required: a person without them is refused with a sentence. Anything longer, or with steps and a template, is a skill.
- A team's `purpose` and `instructions` are required too (its charter). The six default teams ship with charters in `office-charters.mjs` and every default seat ships with a brief in `office.agents.json`; an older office gets them filled once, only where a field was empty. When the CEO adds a team or a person, they write these; hiring from the Agency fills them from the persona.
- `model` is a model id from Settings → Models & keys, or empty for the team's, then the role's default.
- `rules` are the owner's standing rules in their own words. The office adds them when the owner ticks "remember" on a correction. Only remove one when the owner asks.
- Teams can be added, renamed and removed (up to 10 teams; a team is a lead and one to six specialists). A team with unfinished work cannot be removed.

**First start only:** a brand-new office seeds its people from `office.agents.json` → `<brain>/Agents Office/agents.json` → `office.agents.local.json` (later wins), 35 seats in six departments. After the first start these files are not read again, so edits to them do nothing for a running office.

## Hiring from the Agency

The office ships 2,200+ ready-made personas under `agency/` (from github.com/msitarzewski/agency-agents and open-source skill catalogues, MIT), in 24 divisions (`DIVISIONS` in `agency.mjs`), each with a job title, a one-line description and search tags; search is ranked by `src/agency-search.js`. New imports go through `scripts/import-skills.mjs`, then `scripts/agency-curate.mjs` (`<curation.json>` for titles and divisions, `--refresh <skills folder>` to write the methods again with the skill's own guides inlined, `--missions <file>` for standing instructions written from each method, `--methods <file>` for a method written for the office where the catalogue's text was not one). When the owner wants a new kind of specialist ("I need an SEO person", "add a security reviewer to Delivery"), look in the catalogue first: `GET /api/agency?q=seo`, then `POST /api/agency/<id>/hire { dept }` adds the persona to that team with its role, job, standing instructions and its full method as a skill (`{ lead: true }` gives the team's lead that role instead). `POST /api/agency/<id>/skill { teams, agents }` adds only the method. Say which persona you chose and why. A team holds a lead and up to six specialists.

The Program Manager's own skills (project management methods, plus `running-a-task` and `cross-team-handoff`) live in `agency/pm-skills/<name>/SKILL.md`; the owner's additions go in `<brain>/Agents Office/pm-skills/<name>/SKILL.md` (Agent Skills shape: front matter `name` and `description`, then the method). The Program Manager reads them on demand with Deep Agents' skills middleware and plans every task with `write_todos`; a delegation before the plan exists is refused.

## Teaching how a task is done (skills)

When the owner says "this is how we do X", shares an SOP, a template or an example they liked, or asks why results are generic, the answer is a **skill**: a named method with steps, the shape of the result and rules. Create it in Settings → Skills (or add it to `skills` in `office.json` through `PUT /api/office`), then give it to a team or a person. Tasks keep the skill version they started with.

Decide brief or skill first: a paragraph with no steps and no template is a `brief`; steps, a shape, rules or a document to copy make a skill. Before writing one you need the trigger, the source material, the shape of the finished thing and the rules. If one is missing, ask one question for it; never invent the owner's process. Long reference material belongs in the Brain as ordinary notes; the skill names them. Full writing guide: `SKILLS.md`.

Skill folders in `<brain>/Agents Office/skills/` are imported once, when an older office is upgraded.

## Who knows what

The Program Manager sees the whole company in its prompt: every team's purpose, people, tools and skills. A lead sees only its own team and its own tools, and hands off through the Program Manager when a task needs another team's expertise or a tool it does not have; a specialist is told to stop rather than substitute a tool. The same pages live in long-term memory (`office-memory.mjs`, a LangGraph store on `workflows.sqlite`), mounted by role: the Program Manager's file system carries `/memories/company/org-chart.md` and `/memories/company/connectors.md`, a team's carries only `/memories/team/team.md`, and everyone shares `/memories/notes/`. The pages are rewritten on every change to teams, people, skills or connectors, so a task already running sees the change; they are read-only to agents. Every worker a lead can delegate to is a named person on its team: Deep Agents' built-in general-purpose worker is switched off for every provider (`engine/deep-agents.mjs`). A hire from the Agency always arrives with a brief; a persona file without rules gets one derived from its description and method.

## The Brain

The company's shared knowledge, in the folder named by `brain` in `office.config(.local).json` (default `./brain`, or `AO_BRAIN`). The Program Manager, leads and specialists search it before and during work and cite the notes they used. Owners upload documents (PDF, Word, text, Markdown, CSV; 25 MB each) into folders such as Company, Projects, Departments. Uploading a file with the same name replaces it and archives the old copy. Finished tasks land in `Agents Office/`, digests in `Digests/`. The search index lives in `data/knowledge-index/`; Settings → Brain can rebuild it.

## Projects: the big pieces of work

A project (Settings → Projects, or `POST/PUT /api/projects`, stored in `data/projects.json` by `projects.mjs`) has a name, a purpose, a charter, owning teams, start and target dates, milestones and a Brain folder `Projects/<id>/` for its files (`POST /api/projects/:id/upload`). The office keeps `Projects/<id>/project.md` current: charter, timeline, files and what the project's tasks delivered. A task created with `projectId` starts with a PROJECT block (purpose, charter, next milestone, page path); the Program Manager reads the page before planning and passes the project to every lead; `/memories/company/projects.md` lists every open project. Owning teams are a hint, not a fence: the Program Manager brings in any team a task needs. Archived projects take no new tasks.

## Routines: tasks on the office's own clock

"Every Monday …", "each morning …", "automatically at …" is a **routine**: a task the office starts by itself and runs through the team lead like any other. **Every team can have routines.** Create one in Settings → Routines, with `POST /api/routines` (`{ dept, agent, text, needsOk }`, where `text` starts with the schedule), or in `<brain>/Agents Office/routines.json`:

```json
{ "id": "overdue-reminders", "dept": "fin", "agent": "invo",
  "title": "List the overdue invoices and draft the reminders",
  "text": "List the overdue invoices and draft the reminders.",
  "when": { "kind": "weekly", "days": [1], "at": "09:00" },
  "needsOk": true, "paused": false }
```

- `dept` is a team id; `agent` a person in that team (default: the lead). Say which one you chose.
- `when`: `{"kind":"daily","at":"HH:MM"}` · `{"kind":"weekdays","at":"HH:MM"}` · `{"kind":"weekly","days":[1,4],"at":"HH:MM"}` (0 = Sunday) · `{"kind":"hourly","every":1,"from":"09:00","to":"17:00","weekdaysOnly":true}`. Local 24-hour time.
- `needsOk` (default true): the owner approves before the result is closed. Actions that send, post, pay or change things outside the office always wait for the owner regardless.

The server re-reads the file every 20 seconds. Run state lives in `data/routines.json`, never in the Brain.

## Connectors and approvals

Connectors are MCP servers the office connects to itself (Settings → Tools & connectors): add by URL or local command, sign in with OAuth in a new window, then give teams access. A person inherits the team's tools, can be limited to a smaller set, or can be given a tool the team does not have (`tools` on the person); the lead and the Program Manager are told who has what, so work that needs the tool goes to that person rather than to another team. Connectors found in this machine's Claude Code can be imported, then signed in again; the office does not use the Claude Code login.

Any tool that sends, posts, pays, deletes or changes something outside the office pauses for the owner's approval and runs once after it. The office decides from the tool's description and name; Settings → Tools & connectors → Approval rules overrides that per tool. Agents never get a shell or the server's files; each task has its own scratch workspace, and the Brain is read-only to them. They write Markdown, text, CSV, JSON and HTML into that workspace, and turn a Markdown file into a PDF with `export_pdf` or a PowerPoint deck with `export_pptx` (engine/documents.mjs: Markdown to HTML with a print stylesheet, printed by Chrome or Edge on the machine through playwright-core, or by pdfkit when no browser is installed; decks through pptxgenjs, one slide per `##` heading). The task page's Artifacts tab lists the workspace files with download links (`GET /api/tasks/:id/file?path=`). A rate limit (429) or a 5xx from the provider is waited out and the call re-sent below the SDKs (`fetchWithRetries` in models.mjs: Retry-After honoured, about three minutes at most; LangChain itself treats a headerless 429 as final), including OpenRouter's way of reporting an upstream refusal as a 200 whose first stream event is an error object (the first event is peeked); a call that still fails blocks the task quietly and the office retries it by itself four times with growing pauses (½, 1½, 3 and 5 minutes; `providerRetryDelays`), the count starting again after each recorded review; the board shows a notice while the provider keeps failing (`/api/health` → `provider`, waits under `provider.waits`). A model call that stays silent for five minutes fails and is retried instead of running to the task limit.

Secrets live in the Vault (`vault.mjs`, `data/vault.json`, Settings → Vault): an entry is an outside service (`api`), a database connection (`database`: engine postgres or mysql, host, port, database, user, password, `readOnly` default true) or an SSH target (`ssh`: host, port, user, key or password, optional `allow` command prefixes and a host key `fingerprint`), each limitable to teams. Agents never see a secret; the office injects it. Leads and specialists get `vault_list`, `api_get`, `api_request`, `api_upload`, and from the connectors in `connectors/` (`database.mjs`, `ssh.mjs`) `db_list`, `db_schema`, `db_query`, `db_write`, `ssh_list`, `ssh_run`. Reads run at once; `api_request`, `api_upload`, `db_write` and `ssh_run` pause for the owner (`VAULT_APPROVALS` in `engine/deep-agents.mjs`). One statement at a time, no comments, DDL never, LIMIT 200 added, 200 rows and 100 KB back at most; a deny list and the entry's allowed prefixes for commands; a connection that fails three times is paused for a minute. `pg`, `mysql2` and `ssh2` are optional dependencies loaded on first use. When the owner wants a team to use a database or a server, add the Vault entry (or ask for the secret to be typed in Settings → Vault; never put a secret in a prompt, a file or a commit) and, for a database that must accept changes, untick Read-only.

## Hosted mode: many companies in one process

`AO_MODE=hosted` (serve.mjs) serves many companies. The control plane is `accounts.mjs` on `accounts.sqlite` (users, tenants, memberships with roles owner/admin/member, member groups, sessions as hashed cookies, invitations, mail identities); `platform.mjs` holds what every office inherits (`platform.json`: limits `maxTeams`/`maxMembersPerTeam`, registration open/invite, admin emails; and the one `providers.json`); `tenant-registry.mjs` builds one `office-instance.mjs` per tenant on `tenants/<id>/data` and `tenants/<id>/brain`, puts idle ones away and wakes one whose routine falls due. A tenant has no `providers.json`: models, keys and limits are the platform administrator's (`/api/admin/*`, Manage → Platform); `/api/providers` does not exist in hosted mode.

Tasks, projects and routines carry `ownerId`; tasks and projects carry `visibility` (`private` by default, or `public`) and `sharedWith { users, groups }`. `server/visibility.mjs` is the one place that decides who sees what: no viewer (single mode) or an office owner/admin sees everything; else the owner, public, or shared with the person or one of their groups; a task inherits its project's audience. Invisible means 403 on direct access and absent from lists, artifacts, reports, KPIs, usage and the event stream. Inbox items are addressed to a person (`userId`); a person's chats with the agents are their own (`agent:<id>:<userId>`); the audit actor is the signed-in email. Members cannot change teams, connectors, the Vault or office settings and do not see the audit log. The Brain, teams, connectors and Vault are shared by the whole office, so an approved result of a private task is still filed in the Brain.

When the owner asks about people or sharing in a hosted office, use the API: `GET/POST /api/users`, `/api/groups`, `POST /api/auth/invite` (returns the link to hand over), `POST /api/tasks/:id/share { visibility, sharedWith }`, `PUT /api/projects/:id` with the same fields. Email intake (`mail/`): each member's alias is `<office>.<person>.<suffix>@AO_MAIL_DOMAIN` (Profile → Email intake); mail from the account email or a verified sender becomes a Program Manager task (subject → title, body → brief, attachments → `/work/inbox/` via `engine.attach`), a question is answered on the thread, and the office mails back the receipt, the result and the team's questions; the webhook is `POST /api/mail/inbound/<postmark|mailgun>` guarded by `AO_MAIL_WEBHOOK_SECRET`. The mail set-up (provider, key, domain, From, webhook secret, dry run), the public address, registration mode and the idle/loaded numbers are platform configuration: Platform → Mail and Platform → Settings, or `PUT /api/admin/config` (`platform.mjs`, `platform.json` 0600; secrets write-only, `summary()` masks them). Environment variables only seed the first platform.json. Never put a mail API key in a prompt, a file or a commit: the administrator pastes it in the panel.

## Everything else

- `npm run check` is the loop: build, configuration checks, the whole test suite, and an API smoke test on throwaway data. Run it after any code change and fix what is red. `CHECK_LIVE=1 npm run check` also runs one real task through the configured provider.
- `npm test` runs the test suite alone (Node 22).
- `npm run check` is the loop. Run it after any change to code; fix what is red. CI (`.github/workflows/check.yml`) runs it on Linux and Windows; the suite is green on both.
- `npm run backup` / `npm run backups` / `npm run restore -- <name>` (scripts/backup.mjs) copy and restore `data/` and the Brain. The `Dockerfile` ships the office with a Chromium for PDFs; `AO_CHROME` names the browser binary elsewhere.
- The 3D office is `src/scene/` (React Three Fiber; `index.jsx` returns the handle `src/main.js` uses). Change the building in `office.jsx` / `furniture.js`, the figures in `person.js`, their behaviour in `sim.js`, walking in `nav.js`, the wall screens in `screens.js`, the light in `daylight.js`. `node scripts/screenshots.mjs` shows the result headless.
- `README.md` says what the product does. Keep it true to the code.
- Release: `node scripts/release.mjs --push` (owner only).
