# Talkchief AI Space deployment

Live URL: **https://test.talkchief.io:8443**.

Nginx terminates TLS on port 8443 and proxies to `127.0.0.1:4520`. The dedicated
`agents-office` system account runs the enabled systemd service with Node 22.23.2
from `/opt/agents-office-runtime`. Other server applications retain their existing
ports and Node installations.

Installed configuration:

- `/etc/systemd/system/agents-office.service`
- `/etc/nginx/conf.d/agents-office.conf`
- `/etc/agents-office.env` (root-owned, mode 0600; office access key and optional model keys)
- `office.config.local.json` (deployment name and knowledge path)

The access key is exchanged for a signed HttpOnly session cookie. Changing `AO_ACCESS_KEY` and
restarting invalidates existing office sessions. Do not place credentials in git.

### Models and keys

The office calls models through API keys; it does not use a Claude Code login. Add keys in
**Manage → Models & keys** (stored in `data/providers.json`, mode 0600, never sent to the browser)
or in `/etc/agents-office.env`:

```sh
ANTHROPIC_API_KEY=...     # Claude models
OPENAI_API_KEY=...        # OpenAI models
OPENROUTER_API_KEY=...    # GLM, Kimi, DeepSeek and others through OpenRouter
```

A key in the environment is used when the office file has none. The same page chooses the model for
the Program Manager, department leads, specialists, reviews and chat; a team, an agent, a routine or a
task can override it. Until a key is set, ideas can be saved but no work starts.

### Connectors

Connectors live in `data/tools.json` (mode 0600). Servers found by `claude mcp list` on this host show
as “Found in Claude Code”; import them to keep their existing team assignments. Connectors that need a
sign-in (Gmail, Calendar, Drive and similar) must be signed in again from **Manage → Tools** after the
upgrade: the office runs its own OAuth sign-in and callback at
`https://<host>/api/tools/<id>/oauth/callback`. Tools that send, post, pay, delete or change data pause
for the CEO’s approval before they run.

### Live updates

The browser receives updates over Server-Sent Events at `/api/events`, with a 25-second heartbeat.
The nginx site already disables proxy buffering and allows 360 seconds of read inactivity, which the
heartbeat keeps well within. If updates stop, the page falls back to polling.

## Operations

```sh
cd /opt/agents-office
PATH=/opt/agents-office-runtime/bin:$PATH npm test
PATH=/opt/agents-office-runtime/bin:$PATH npm run build
systemctl restart agents-office
systemctl status agents-office
journalctl -u agents-office -n 30 --no-pager
curl -fsS https://test.talkchief.io:8443/api/auth/status
```

Stage UI builds with `AO_DIST=/tmp/talkchief-build` and point the staging server
at that HTML using `AO_HTML`. Build and restart together during updates: the frontend and workflow API must be
from the same release. Use isolated `AO_DATA`, `AO_BRAIN` and a loopback `PORT` for
staging; test records must never enter the production task list.

## State and recovery

Retention: once a day the scheduler clears the scratch workspace and resumable checkpoints of tasks finished or cancelled more than 30 days ago. Task records, results, reviews, threads and the Brain are kept; a later correction on such a task restarts the conversation from the brief and the latest result.

Back up `data/` and `office.config.local.json`. Stop the service for a filesystem backup of the SQLite
files, or use SQLite's online backup facility. `workflows.sqlite` holds tasks, events, conversation
threads, the inbox and the agents' checkpoints. `office.json` holds teams and people; `providers.json`
holds model keys; `tools.json` holds connectors and their sign-in tokens; `settings.json` holds office
settings; `workspaces/` holds each task's working files. The Brain folder (`knowledge/` here) holds
purpose, notes and filed results; archived notes stay under `.archive`.

On the first start after the upgrade, older tasks are converted once: finished results and reviews are
kept, and unfinished ones become Blocked with a note to retry them on the new harness.

A task that was running during a restart becomes Blocked; Retry continues from where it stopped.
A task waiting for the CEO's decision stays waiting across restarts and resumes when decided. Notes
sent while a task works are kept and delivered at its next step.

Ideas stay in the backlog without calling any model. Queue priority changes scheduling at the next
free slot. Cancellation stops running work. The short `saving` step that files a result cannot be
cancelled.

## Scope

Up to 12 teams of 2–12 people, each with one lead. The Program Manager delegates to the leads of the
teams a task involves; leads delegate to their specialists and must record an approved review before
the Program Manager can complete the task. There are no call or token budgets. Settings limit how many
tasks run at once, how many specialists of a team work at once, how many rework rounds happen before
the CEO is asked, and how long a run may take.

Anything that sends, posts, pays, deletes or changes data outside the office pauses for the CEO. The
CEO approves, edits or rejects the exact action; approval runs it once. Team tests never receive such
tools. This is a single-owner application: the office access code is the only login.

Authenticated configuration requests accept up to 16 MiB for the office, 4 MiB for connector
definitions and 512 KiB for knowledge notes. Ordinary requests are limited to 64 KiB.

## Validation

`npm run check` builds, validates the configuration, runs the whole test suite and smoke-tests the API on a temporary copy of the data and Brain folders, so it is safe to run next to a live office. `CHECK_LIVE=1 npm run check` also runs one real task through the configured provider.

`npm test` covers the provider registry (key privacy, precedence, effort mapping), the inbox, threads,
live events, the Office Engine with scripted models (delegation, enforced lead review, re-prompt and
escalation, approvals that pause and survive a restart, rejected and edited actions, completion
approval, rework limits, corrections, mid-run notes, team pacing, cancellation, time limits, provider
errors and team tests), connector storage and sign-in, outbound tool classification, the web fetch
address guard, the upgrade of older tasks, and office and Brain storage.

Staging runs use isolated `AO_DATA`, `AO_BRAIN` and `AO_HTML` on a loopback port. `npm run check` is
the upstream offline-demo checker and still carries demo assumptions until it is rewritten.
