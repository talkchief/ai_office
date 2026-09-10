# Talkchief AI Space Constitution

## Core Principles

### I. One store per fact (NON-NEGOTIABLE)
Every fact lives in exactly one place. Task, run, review, decision, thread and notification
state live in `data/workflows.sqlite`. Office configuration (teams, agents, skills, rules,
role models) lives in `data/office.json`. Provider keys live in `data/providers.json` or the
service environment. Connector definitions and tokens live in `data/tools.json`. No fact is
copied into a second store that can drift; snapshots taken for a run are labelled as snapshots.

### II. States are enforced, never implied
A task's state is a machine-enforced value set by the engine, never inferred from model prose.
"Waiting for the lead", "needs the CEO", "blocked" and "done" MUST each be a real state with a
runner or a human action behind it. A tool call, not free text, records reviews and completion.
Every transition writes an event. Nothing may sit in a non-terminal state without an owner.

### III. Nothing leaves the machine without the CEO
Read-only work is free. Any tool that sends, posts, pays, deletes, or changes data outside this
machine MUST pause for the CEO's approve/edit/reject before it executes. Approval executes the
exact action shown; drafts are never silently sent. Evaluation runs never get outbound tools.

### IV. Provider-agnostic by construction
The office runs on any chat model reachable through a LangChain model class: Anthropic, OpenAI,
OpenRouter, or any OpenAI-compatible endpoint. Model choice is configuration, resolved per role
with a fixed precedence (task > routine > agent > team > role default > office default). No
runtime dependency on a vendor CLI or a subscription login.

### V. Test-first for the engine
State transitions, approval gates, restart recovery, provider resolution and notification
semantics are covered by `npm test` with scripted fake models before UI work begins. `npm test`
and `npm run check` MUST be green before a build is deployed.

### VI. One UI code path
The served app is the only app. No demo forks, no duplicated panels, no dead builders. Labels for
task states come from one vocabulary module. Deleting dead code is part of every milestone.

### VII. Every CEO-relevant event is a notification
Decisions, questions, blockers, escalations, overdue tasks, completions and configuration changes
land in the inbox with read/acknowledged semantics and reach open browsers live (SSE, with a
polling fallback). Indicators that say "done" or "needs you" clear when the CEO has seen the item.

## Operational Constraints

- Single-owner deployment (one CEO login); no multi-user roles in this release.
- Node 22 on the service runtime; Linux; systemd + nginx; SQLite in WAL mode.
- Secrets are never returned to the browser; files holding secrets are mode 0600.
- Global concurrency and a wall-clock limit per run are the only execution limits. There are no
  call or token budgets.

## Development Workflow

- Milestones ship independently: M0 hotfixes, M1 harness, M2 UI, M3 processes, M4 hardening.
- Each milestone updates README.md, CLAUDE.md and deploy/README.md to stay true to the code.
- Data migrations are one-shot, idempotent, and run before recovery at boot; `data/` is backed
  up before deploying a migration.

## Governance

This constitution supersedes older guidance in CLAUDE.md where they conflict (fixed 35 seats,
Claude-CLI connectors, routine department limits). Amendments require a written rationale in
CHANGELOG.md. `/speckit.analyze` treats a violation of Principles I–VII as CRITICAL.

**Version**: 1.0.0 | **Ratified**: 2026-09-10 | **Last Amended**: 2026-09-10
