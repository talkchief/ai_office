# Talkchief AI Space deployment

Live URL: **https://test.talkchief.io:8443**.

Nginx terminates TLS on port 8443 and proxies to `127.0.0.1:4520`. The dedicated
`agents-office` system account runs the enabled systemd service with Node 22.23.2
from `/opt/agents-office-runtime`. Other server applications retain their existing
ports and Node installations.

Installed configuration:

- `/etc/systemd/system/agents-office.service`
- `/etc/nginx/conf.d/agents-office.conf`
- `/etc/agents-office.env` (root-owned, mode 0600; office access key)
- `office.config.local.json` (deployment name and knowledge path)

The access key is exchanged for a signed HttpOnly session cookie. Claude uses its
official browser/code login via **Manage → Claude**. Credentials belong to the
service account and are not returned to the browser. Changing `AO_ACCESS_KEY` and
restarting invalidates existing office sessions. Do not place credentials in git.

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

Back up `data/`, `office.config.local.json`, and the service user's Claude
configuration securely. Stop the service for a filesystem backup of the SQLite
files, or use SQLite's online backup facility. `workflows.sqlite` stores jobs,
events and LangGraph checkpoints. `office.json` stores team settings;
`tools.json` contains private connector configuration; `knowledge/` contains
purpose, notes and approved deliverables. Archived notes remain under `.archive`.

Tasks interrupted during a restart become blocked with their completed subtasks
preserved. Retry resumes unfinished work. Owner approvals wait durably. Older
tasks are imported once as blocked records requiring the new lead verification;
the original `tasks.json` remains intact.

Ideas stay in the backlog without using Claude. Starting one captures the current
team and skill configuration. Queue priority changes scheduling at the next free
slot; it does not interrupt running work. Briefs and priority can be edited until
the first model call. Retry respects the global job limit.

Task details update every two seconds and show public draft text (up to 16,000
characters), model phase, tool names, and reported budget usage. Private reasoning
and raw tool payloads are excluded from progress previews. Connection failures
show a stale-data notice and stop work animations until updates resume.
Cancellation stops running and waiting workers. After all approvals pass, a short
`saving` phase commits the deliverable and cannot be cancelled; interrupted saves
become blocked for explicit retry. Deliverable files are replaced atomically.

## Scope

The six functional areas each support 2–12 agents, including one independent
reviewer. Team settings support up to 12 named tests, individual runs and whole-suite runs.
Evaluations keep their results in the task history without entering shared business
knowledge. The skill library supports up to 50 reusable methods, with task-level
version snapshots. Reports separate test usage from business tasks. Workflow limits cap concurrent workers, calls, reported tokens and
review rounds. A token limit is checked between calls, so an individual call can
cross it, including calls already running concurrently. Plain planning and review calls disable MCP/customizations to reduce
context and isolate tools. Worker tools are restricted to team/agent assignments.

This is a single-owner application. Lead review verifies returned deliverables
and configured checks; it is not proof of an external action. Workflows are
instructed to prepare deliverables without sending, publishing, paying or deleting.
Approving completion saves the reviewed work; it does not execute an outbound
transaction. MCP servers may expose write tools: only connect and assign servers
you intend this office to use. The API-key backend does not implement MCP tools;
the deployed Claude CLI account is the integration backend.

Authenticated configuration requests accept up to 16 MiB for the office, 4 MiB for
MCP definitions and 512 KiB for knowledge notes. Ordinary requests remain limited
to 64 KiB. Field-level and roster limits still apply.

## Validation

`npm test` covers access cookies, login state, independent lead review, failed
acceptance checks, checkpoint approval after restart, retries, roster validation,
MCP configuration redaction/rollback/unassignment, and knowledge paths/graphs.
It also covers backlog scheduling, queue priority, call-budget enforcement with
parallel workers, cancellation during work or completion, draft bounds, UTF-8
request handling, and downstream rework after an upstream rejection.
Browser checks cover live Claude session stability, team zoom and counters,
management menus and Brain editing. A real Claude task was run in isolated state
through worker submission and lead verification, with an approved deliverable.
`npm run check` is the upstream offline-demo checker and retains demo assumptions.
