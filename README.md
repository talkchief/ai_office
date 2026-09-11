# Cloud AI Office

![The office: department rooms around the Program Manager, with the task panel](assets/readme-hero.jpg)

A 3D office run like a company, with you as the CEO. You give work to the **Program Manager**, who hands it to the right **department leads**; leads plan it, hand assignments to their **specialists**, review what comes back against the team's criteria, and only approved work is filed in the **Brain**, the company's shared knowledge. Anything that would send, post, pay or change something outside the office waits for your approval.

A project starts from a brief: say what to build or achieve, attach the documents, and the Program Manager names it, writes the charter, picks the teams, sets the milestones and starts the first tasks. Quick work (a lookup, a summary, a PDF from a note the Brain already holds) is done by the team's lead alone in seconds; everything else goes through the Program Manager and the team, at a thinking level the delegator chooses per assignment. It runs on API keys from any provider: Anthropic, OpenAI, Google Gemini, OpenRouter (GLM, Kimi and many others) or any OpenAI-compatible endpoint, with a model per role, per team and per person. The agents are built on LangChain Deep Agents.

**Beta.** It works end to end. Expect rough edges.

## Moving around

- Scroll to zoom to the cursor, drag to pan, click a room to focus it, click a person to talk to them, double-click the floor or press `0` for the overview.
- **Turn and tilt the office**: drag with the right mouse button (or hold Shift), or `Q` / `E` and the ↺ ↻ buttons. `⌂` straightens the view again.
- `N` cycles morning → day → evening → night to preview the light; by default the office follows your clock (night after 20:00, dark tokens and desk lamps). `D` forces dark, `V` the filming backdrop, `G` the Brain, `B` the board, `X` sends two people to the centre for a chat (offline preview only).

## First five minutes

1. Open http://localhost:4520. The panel on the right shows **Right now**: who is working with whom, live.
2. In the box at the top of the panel, pick a team, or **Let the Program Manager choose**, type what you need and press **Add task**. Under **Assign · due date · more teams · documents** you can name who it is for, set a due date and priority, bring in other teams, and attach documents; they go into the Brain for the team to read.
3. Watch it move: the lead plans, walks over to a specialist, the specialist works, the lead reviews. A lead whose part needs another team hands that part to the Program Manager, who brings the other team in while the first lead carries on. Each card shows the hand-off chain. The result opens as a readable document with the review checks beside it.
4. The **Inbox** (top right, or click the lobby) collects everything that needs you: decisions, approvals for outbound actions, questions, blocked work, overdue work and the daily digest. Turn on desktop alerts there.
5. Click a lead or the Program Manager to talk to them. Type **@** to pick one of the team's tasks, then choose **Ask**, **Correct** or **Note**. A correction reopens the task: the lead reworks it, reviews it again and files a new version. Tick **remember** to keep the correction as a standing rule. Specialists answer questions; corrections go through their lead.
6. Open a finished task and use **Ask for changes** to correct it from there.

## Settings

**Manage** opens the directory: every area in four groups (People, Knowledge, Services, Administration) with a one-line status under each, and whatever needs you (an expired sign-in, a missing key, a task waiting for your decision) listed at the top with the action that fixes it. Each area is a full page (the office pauses behind it) that speaks one status vocabulary, Connected · Signed in · Signed out · Failed · Not set · Waits for you · Saved, keeps its failures in a banner and its confirmations in a toast, and has one save bar that says what is saved and when. Light and dark follow the office theme.

- **Office** — tasks running at once, how long a run may go without progress before it is stopped, when to remind you again, the digest time.
- **Teams & people** — add, rename and remove teams (up to 10; a team is a lead and up to six specialists), each person's job and standing instructions (both required) and model, the team's purpose and working instructions (its charter, required; the six default teams ship with one), review criteria, automated checks, tools, pace, standing rules, and tests.
- **Models & keys** — provider keys, then the models you activate from each provider's own list (nothing is built in), and who runs on what (office default, Program Manager, leads, specialists, reviews, chat).
- **Tools & connectors** — MCP servers by URL or local command, sign-in in a new window, which teams may use each, and approval rules per tool.
- **Vault** — keys, database connections and SSH targets that agents use through the office without ever seeing the secret; see Connectors and approvals below.
- **Skills** — reusable methods you give to teams or people, typed by you or added from the Agency. See [SKILLS.md](SKILLS.md).
- **Routines** — tasks the office starts on its own clock, for any team.
- **Reports & KPIs** — throughput, cycle time, review wait, your response time, rework, overdue work, tokens by model.
- **Brain** — upload documents (PDF, Word, text, Markdown, CSV), search everything, edit notes, rebuild the search index.
- **Audit log** — every configuration change, who made it and what changed.

## The Agency: ready-made people and methods

The office ships the open-source Agency catalogue ([msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents), MIT): 2,155 specialist personas in 24 divisions (Software Engineering, AI & Agents, Data & Analytics, DevOps & Cloud, Security, Design, Marketing, Sales, Finance and more), each with a job title, a one-line description and search tags. In **Teams & people → People → Hire from the Agency**, search by job, skill or tool (results are ranked: "developer" lists developers first) and hire a persona onto a team: they arrive with a role, a job description, standing instructions and their full method as a skill. "Hire as the lead" gives the team's lead that persona's job instead. In **Skills → Add a method from the Agency** you take just the method and give it to teams or people you already have. `node scripts/agency-sync.mjs <clone>` refreshes the catalogue.

## How the Program Manager works

The Program Manager runs on LangChain Deep Agents: it plans every task with the built-in task list (the CEO sees the plan on the task page), delegates to department leads with the delegation tool, and reads its skills on demand. Its skills are the project-management methods from the Agency (project shepherd, senior project manager, studio producer and operations, meeting notes, experiment tracker, Jira workflow steward) plus the office's own *running-a-task* and *cross-team-handoff* methods, under `agency/pm-skills/`. Put your own under `<brain>/Agents Office/pm-skills/<name>/SKILL.md`.

When a lead's assignment needs another team's expertise, or a tool its own team does not have (web research without web access, say), the lead hands that part to the Program Manager and keeps working on its own part. The Program Manager delegates it to the other lead, and the task cannot close until both leads have approved their work.

Who knows what: the Program Manager's prompt carries the whole company, every team's purpose, people, tools and skills, so it can route each part of a task to the team that can actually do it. A lead is told only its own team and its own tools, including any tool a single person on the team has been given; a specialist is told to stop and say so rather than substitute a tool it does not have. Deliverables are Markdown, text, CSV, JSON or HTML in the task workspace, and a team can export a Markdown deliverable as a formatted PDF or as PowerPoint slides; every workspace file is downloadable from the task page's Artifacts tab, and Manage → Office Artifacts lists every file from every task, filtered by type, date and words. PDFs are printed by the Chrome or Edge installed on the machine (set `AO_CHROME` to a browser path elsewhere), with a built-in fallback renderer when there is none. The same pages are kept in long-term memory, a LangGraph store in `data/workflows.sqlite` mounted by role: the Program Manager reads `/memories/company/org-chart.md` and `connectors.md`, a team reads its own `/memories/team/team.md`, and everyone shares `/memories/notes/`. The pages are rewritten whenever teams, people, skills or connectors change, so a task already running reads the current state. A lead delegates only to named people on its team; there is no anonymous general-purpose worker.

## Projects

The Program Manager runs big pieces of work as projects. Under Settings → Projects you define each one: a purpose, a charter written the way you would brief a new hire, owning teams, start and target dates, milestones you tick off, and files uploaded into the project's Brain folder. Attach tasks to a project from the task form or from the project page; every such task starts from the project page, which the office keeps current with the charter, the timeline, the files and what earlier tasks delivered, so the third task knows what the first two did.

## Routines

A routine is a task the office starts by itself: "every weekday at 8am, triage the inbox and tell me what needs me". Add one under **Manage → Routines** with the schedule at the start of the sentence, or tell a lead in chat. Each run goes through the lead like any other task. A routine that would act outside the office waits for your approval. The clock lives in the server: the page does not have to be open.

## The Brain

The company's shared knowledge: your uploads, the office purpose, finished work (`Agents Office/`) and daily digests (`Digests/`). The Program Manager, leads and specialists search it before and during work, and each result lists the notes it used. Search is full-text (Zvec, with a SQLite fallback). In production the Brain lives in `data/knowledge`; the sample notes in `brain/` are for a fresh install.

## Connectors and approvals

Connectors are MCP servers the office connects to itself (Manage → Tools & connectors): add one by URL or local command, sign in in a new window, then choose which teams may use it. Any tool that sends, posts, pays, deletes or changes something outside the office pauses for your approval and runs once after it; the office decides from the tool's name and description, and Approval rules override that per tool.

Keys, passwords and SSH credentials live in the **Vault** (Manage → Vault), a secret store like a code host's. An entry is an outside service (a base address, the header it expects, the key), a database connection (Postgres or MySQL: host, port, database, user, password, read-only unless you untick it) or an SSH target (host, port, user, a private key or a password, optionally the command prefixes it may run and its host key fingerprint); each can be limited to some teams. Agents use an entry through the office and never see the value. `api_get` reads from a service; `api_request` and `api_upload` change something there and wait for you. `db_list` shows a team its databases, `db_schema` lists tables and columns, `db_query` runs one read statement (SELECT, WITH … SELECT, SHOW or EXPLAIN; one statement, no comments, at most 200 rows and 100 KB, a SELECT without LIMIT gets LIMIT 200), and `db_write` runs one INSERT, UPDATE or DELETE on a connection you marked writable, after your approval; DROP, ALTER, TRUNCATE, GRANT and the like are never run, whatever you answer. `ssh_list` shows a team its targets and `ssh_run` runs one command on one of them, always after your approval; a target with allowed prefixes runs only commands that start with one of them, and `rm -rf /`, `mkfs`, `dd if=`, `shutdown`, `reboot`, fork bombs and their kind are refused outright. A connection that fails three times in a row is paused for a minute. Every call is written to the task's timeline without the secret, and a secret that shows up in an answer is masked before an agent or a log sees it. The drivers are optional: `npm install pg mysql2 ssh2` adds them; without one, the tool says so.

## Keys

| Key | Does |
|---|---|
| `1` to `6` | Marketing, Emails, Sales, Operations, Finance, Delivery |
| `B` | The company board: every department, scheduled to done |
| `G` | The Brain graph |
| `C` | Chat with the department lead |
| `X` | Send two agents to meet at the Brain |
| `V` | Full screen view with dimmed lighting |
| `D` | Dark mode. http://localhost:4520/dark opens in it |
| `Esc` | Back |

## Running it for real

- **Backups.** `npm run backup` copies the data folder (tasks, memory, keys, connectors, projects) and the Brain to `backups/<timestamp>/`, keeping the newest seven (`--keep N` for more); `npm run backups` lists them; `npm run restore -- <name>` puts one back after you stop the office, saving the current state first. Schedule the backup daily with cron or a Windows scheduled task.
- **CI.** `.github/workflows/check.yml` runs the whole check loop on Linux and Windows for every push and pull request.
- **Docker.** The `Dockerfile` builds an image with Node 22 and a Chromium for PDF export; mount `/app/data` and `/app/brain`, publish port 4520, pass provider keys as environment or add them in Settings. The image reports health on `/api/health`.
- **Soak runs.** `npm run soak` fires one real task per team plus a Program Manager task against the running office, waits for them, and prints time, tokens, teams, hand-offs, reviews and files per task (`--file tasks.json` for your own set, `--parallel` to start them together). Run it after changing a model or a prompt; it costs what the tasks cost.
- **Post-mortems.** `node scripts/report.mjs <task id or start of its title>` (or `--latest N`) prints one task’s timeline: who worked for how long, tokens and calls per agent, the plan, reviews, hand-offs, loop stops, tool-call counts and files. Read it before changing a prompt or a limit.
- **Importing skills as people.** `node scripts/import-skills.mjs <folder of skill folders>` turns every SKILL.md into an Agency persona (offensive-security skills are skipped), so a team can be built from any skill catalogue; `node scripts/agency-curate.mjs <curation.json>` then gives each new persona a job title, a role line, one plain description, a division and search tags, or drops it (duplicates, placeholders, helpers for a single coding tool). `--refresh <skills folder>` writes every method again from its source skill with the guides under `references/` and `resources/` inlined (an agent is given the method and never the skill's folder, so a pointer to a file it cannot open would only stall it), drops the catalogue's stock lines and removes a persona left with almost no method; `--missions <file.json>` gives personas standing instructions written from their own method; `--methods <file.json>` replaces a method the catalogue never really wrote (a list of other skills to invoke, a table of contents, a marketing page) with one written for the office, which the persona then says plainly and `--refresh` leaves alone; `--reindex` rebuilds the Agency index from the persona files. The shipped catalogue includes the Agentic Awesome Skills library (MIT), a Website Publisher for here.now and an IT Designer Pro (UI UX Pro Max method).
- **Provider trouble.** A model call that produces nothing for five minutes fails and is retried; a rate limit, a 5xx or an overload is waited out and the call sent again (Retry-After honoured, about three minutes at most), a dropped connection is retried on a fresh one, and a call that still fails blocks the task quietly while the office retries it by itself four times with growing pauses before you are asked. A provider that keeps failing is a provider to change under Settings → Models & keys.
- **Runaway work.** A run that makes no progress for the no-progress limit (Settings → Office, default 20 minutes) stops with a Retry. There is no cap on tokens: a big task is allowed to be big. An agent that repeats the same tool call with the same arguments is refused from the fifth time and told to finish with what it has or report what is missing, so a lead cannot sit listing an empty workspace while another team works. Deliverables are handed over as files under /work/ and read once by the lead, not re-typed.

## Hosted mode: many companies, one process

`AO_MODE=hosted` turns the office into a multi-tenant product. A company registers its office online (email and password); the
person who registers becomes the office's **owner** and invites colleagues as **admins** or **members** (an invitation is a link
that works once for seven days). Each office has its own teams, connectors, Vault and Brain; **tasks and projects are private
by default** (the owner, the office admins and whoever they are shared with see them), can be made public to the whole office,
or shared with named members or **member groups** (groups of people, defined under Manage → Users & groups; not AI teams).
Sharing a project shares every task in it. A private task's record, thread, progress and files stay private; its approved
result is still filed in the office's shared Brain, which every agent reads.

The **models are the platform's**: a company never sees providers, keys or models; it inherits what the platform administrator
activates under the Platform panel (Manage → Platform, or `/api/admin/*`). The panel is also where every other platform-wide
setting lives: the limits (maximum AI teams per office, maximum agents per team), whether registration is open or
invitation-only, the public address, how long an idle office stays loaded, and the **mail set-up** (provider, API key, mail
domain, From address, webhook secret, dry run). It is kept in `platform.json` (mode 0600; secrets are write-only and never
shown again). The platform administrator is a dedicated account that belongs to no office: set `"platformAdmin": { "email": …, "password": … }`
in `office.config.local.json` (or `AO_PLATFORM_ADMIN_EMAIL` / `AO_PLATFORM_ADMIN_PASSWORD`); the account is created or its password kept current
at every start, and signing in with it opens the Platform page and nothing else. Office accounts never see the panel.

The environment names where things are and seeds the first `platform.json`; after that first start the panel is the truth and
the seeding variables are ignored.

| Variable | Meaning |
|---|---|
| `AO_MODE` | `single` (default: one office, the access code) or `hosted`. The same as `"mode": "hosted"` in `office.config.local.json`, which also takes `"platformAdmins": ["you@example.com"]`. A single office turned hosted hands its provider keys to the platform on the first start |
| `AO_TENANTS_DIR` | Where each company's `data/` and `brain/` live (default `tenants/`, one folder per tenant id) |
| `AO_ACCOUNTS` | The accounts database (users, offices, memberships, groups, sessions, invites, mail identities; default `data/accounts.sqlite`) |
| `AO_PLATFORM_DIR` | `platform.json` (limits, registration, admin emails) and the platform's `providers.json` (default `data/platform/`) |
| `AO_PLATFORM_ADMINS` | Comma-separated emails that may open the Platform panel |
| `AO_REGISTRATION`, `AO_PUBLIC_ORIGIN`, `AO_TENANT_IDLE_MINUTES`, `AO_TENANTS_MAX_LOADED` | Seed only: registration mode, the public address links point to, minutes before an idle office is put away, offices loaded at once. Change them in Platform → Settings afterwards |
| `AO_MAIL_PROVIDER`, `AO_MAIL_API_KEY`, `AO_MAIL_DOMAIN`, `AO_MAIL_FROM`, `AO_MAIL_REGION`, `AO_MAIL_WEBHOOK_SECRET`, `AO_MAIL_DRY_RUN` | Seed only: the mail set-up. Change it in Platform → Mail afterwards, where the panel also shows the webhook address to paste into the provider and sends a test message |
| `AO_MAIL_OUTBOX` | Where a dry run writes its messages (default `<platform dir>/mail-outbox.json`) |
| `AO_BRAIN_TEMPLATE` | A folder copied into every new office's Brain |

**Email intake.** Every member has an address of the form `<office>.<person>.<suffix>@<mail domain>` (Manage → Profile → Email
intake, with a Copy button). Mail to it from the member's own account email, or from an address they verified with a six-digit
code, becomes a task for the Program Manager: the subject is the title, the body the brief, attachments (PDF, Word, Excel,
PowerPoint, CSV, text, Markdown, JSON, PNG, JPEG; 25 MB each) land under the task's `/work/inbox/` and readable ones are also
filed in the Brain under `Inbox/<person>/`. A plain question is answered by the Program Manager on the same thread instead. The
office writes back a receipt, the finished result (with the newest PDF or the result as Markdown) and any question the team
has; approvals stay in the app. Replying to a receipt adds a note to that task; a question in the reply is answered from it.
Mail from anyone else is dropped and logged, never bounced. Set up at the provider: point the domain's MX at the provider
(Postmark: `inbound.postmarkapp.com`; Mailgun: `mxa.mailgun.org` and `mxb.mailgun.org`), add its DKIM and Return-Path records,
and set the inbound webhook to `https://postmark:<secret>@<host>/api/mail/inbound/postmark` (Postmark) or a route that posts
to `https://<host>/api/mail/inbound/mailgun` (Mailgun, signed with the webhook signing key you save as the webhook secret in
Platform → Mail; the panel shows both addresses ready to copy).
The webhook answers `202` and processes the message in the background; a repeated delivery is acknowledged and ignored.

**Moving a self-hosted office in.** Register the office in hosted mode, stop both servers, then
`node scripts/tenant-import.mjs --tenant <tenantId> --data ./data --brain ./brain`. On the next start every task, project and
routine without an owner belongs to the office's owner.

## The build loop

```bash
npm test              # the test suite (engine, providers, inbox, scheduler, Brain search, …)
npm run check         # build, configuration checks, the test suite, and an API smoke test on throwaway data
CHECK_LIVE=1 npm run check   # … plus one real task through your model provider
```

## Where things live

| Path | What |
|---|---|
| `src/` | The page: `main.js` chrome, rail, chat and hotkeys; `office.js` the task panel, task view and chat context; `settings.js` the settings page; `inbox.js` the inbox; `sse.js` live updates; `rightnow.js` the "Right now" rows and hand-off chains; `brain.js` the Brain view; `mcp.js` connector docks |
| `src/scene/` | The 3D office on React Three Fiber: `index.jsx` mounts it; `office.jsx` the building and rooms; `person.js` the figures; `sim.js` their life and the walk-and-talk hand-overs; `nav.js` walking; `screens.js` wall screens; `overlays.js` pills and speech bubbles; `rig.js` the camera |
| `serve.mjs` · `office-instance.mjs` · `server/` | The server (both modes), one office as an instance, and the API ([docs/api.md](docs/api.md)); `server/visibility.mjs` decides who sees a task |
| `accounts.mjs` · `platform.mjs` · `tenant-registry.mjs` | Hosted mode: users, offices, groups, sessions and invitations; the platform's models and limits; one office per tenant, loaded on demand |
| `mail/` · `channels/` | Email intake: the providers' inbound webhooks (Postmark, Mailgun), outbound mail, the intake that turns mail into tasks; the shapes a later channel (WhatsApp) implements |
| `engine/` | The Program Manager → leads → specialists harness on Deep Agents: prompts, tools, approvals, reviews, live progress |
| `agency/` · `agency.mjs` | The Agency catalogue (personas, MIT), the Program Manager's skills, and the importer |
| `models.mjs` | Providers, models and who runs on what |
| `notifications.mjs` · `threads.mjs` · `sse.mjs` | The inbox, conversations, live events |
| `scheduler.mjs` · `routines.mjs` | Overdue notices, reminders, the daily digest, retention; routines |
| `knowledge.mjs` · `knowledge-index.mjs` · `documents.mjs` | The Brain, its search index, document text extraction |
| `office-store.mjs` · `settings.mjs` · `tool-store.mjs` · `audit.mjs` | Teams and people, office settings, connectors, the audit log |
| `vault.mjs` · `connectors/` | The Vault; the database (`database.mjs`) and SSH (`ssh.mjs`) connectors behind it |
| `data/` | Everything the office stores (ignored by git): `office.json`, `providers.json`, `settings.json`, `tools.json`, `workflows.sqlite`, `knowledge/`; in hosted mode also `accounts.sqlite` and `platform/` |
| `tenants/` | Hosted mode (ignored by git): `<tenantId>/data/` and `<tenantId>/brain/` per company |
| `deploy/` | Running it as a service ([deploy/README.md](deploy/README.md)) |

## Privacy

Your notes and documents are read on the server and sent to your model provider only as context for the task or chat at hand. Connector calls go to that service with the sign-in you gave the office. Provider keys and connector tokens are stored on the server, readable only by the service, and never sent to the browser. Nothing else leaves the machine.
