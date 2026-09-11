# Fast lane, dynamic thinking level, more work at once, and a steward for routines

Design for the Agents Office, 2026-09-11. Decisions by the CEO: a lead may answer quick work itself from the Brain; the lead and the Program Manager choose the thinking level per assignment; a simple task (a PDF from a report already in the Brain) must finish in 10 to 30 seconds; the Program Manager and the leads may carry four things at once; leads produce PDFs and decks themselves; routines must be followed up.

## 1. Why

Measured on 2026-09-11 with Gemini 3.8 Flash:

| Run | Wall time | Program Manager's own share | Team chain (lead → specialist → review) |
|---|---|---|---|
| "What was the last task you worked on?" | 166 s | 45 s | 121 s |
| November chain, 8 packages | 23.8 min | ~3.5 min | ~16 min |

The Program Manager is ~15% of a project's time and 8% of its tokens. A small task is slow because of the mandatory chain (8 to 12 model calls, ~2 min floor), not because of the Program Manager's framework. Every task already has its own Program Manager instance, so more Program Managers add no throughput; the settings do.

## 2. Lanes

Every task gets a lane when it arrives; the lane is stored on the task (`job.lane`) and shown on it.

**Triage.** Rules first, then one plain model call.
- Rules: a PROJECT block, more than one named team, or a routine → `standard`. The CEO may pin the lane when creating a task (`lane: quick | standard`), which skips triage.
- Otherwise one call to the office default model with effort low, no tools, JSON out: `{ "lane": "quick" | "standard", "team": "<id>", "effort": "low" | "medium" | "high", "why": "…" }`. Input: the task text (first 1,500 characters), the teams with their purposes (one line each), and the Brain search hits for the text (titles only). Budget 6 s; any failure or timeout → `standard`. Event `lane_chosen`.
- Quick means: one person finishes it in minutes with what the Brain holds or the brief says: a lookup, a short answer, a summary, a format conversion (PDF, deck) of an existing note, a short draft (email, note, checklist) from existing material. Not quick: research with no source, work for several people or teams, numbers that must be computed or verified, anything the lead would need a specialist's skill for.

**Quick lane.** The team's lead runs alone as a plain LangChain agent (`createAgent`), not a Deep Agent.
- Prompt: `quickLeadPrompt` (identity, team charter and criteria, standing rules, the quick-lane method: read what the brief names and what search returns, write the deliverable under `/work/`, export if asked, record the review, stop).
- Tools: the office filesystem (Deep Agents' `createFilesystemMiddleware` with the office backend, so `/work/` and `/knowledge/` are the same as everywhere), `search_knowledge`, `export_pdf`, `export_pptx`, `assemble_files`, `report_progress`, the read-only Vault and connector tools (`vault_list`, `api_get`, `db_list`, `db_schema`, `db_query`, `ssh_list`), `record_review`, and `needs_the_team` (promotion, below). Nothing that pauses for the CEO: `api_request`, `api_upload`, `db_write`, `ssh_run` are not in the quick lane.
- Review: `record_review` accepts the lead's own deliverable in the quick lane (the "a specialist must have handed over" gate does not apply); every other check stays: criteria evidence, automated checks, placeholder check, binary paths refused.
- Completion: when the stream ends with an approved review, the engine files the result itself (`finish`, the completion logic lifted out of `complete_task`): no Program Manager call. The review records `lane: 'quick'` and `self: true`.
- Budget: 8 tool calls, 45 s without an event, or one re-prompt when the lead ends without recording a review. Past the budget, or when the lead calls `needs_the_team` (with why), the task is promoted: `lane = 'standard'`, the lead's run marked `promoted`, the workspace kept, event `lane_promoted`, and the standard lane starts with a note naming the files already there. A wrong sizing costs at most the budget, never quality.
- Guards on the lean lead: loop guard (with the repeated-read rule), step guard at 8, the read cap is the step cap.
- Runs and tokens: the engine opens the lead's run record before streaming and closes it after; the same `RunTracker` handles the stream's tool and model events, so calls, tokens, previews and the Right now panel work as for any run.
- Interrupted (restart, provider failure): the quick lane is rerun from the start (cheap and idempotent: same files); a second interruption promotes.

**Standard lane.** Unchanged: the Deep Agent Program Manager plans and delegates; a plain question the Brain answers is still answered directly by the Program Manager.

Questions go through the quick lane when triage says so (the lead answers from the Brain, citing notes, with `deliverable` text and a review); otherwise the Program Manager's direct answer applies.

## 3. Dynamic thinking level (effort)

- Lane base: triage's `effort` (low for quick, medium or high for standard as triage judges) applies to the Program Manager's or the lead's own model instance for that task.
- Delegation: the Program Manager chooses the effort per lead and the lead per specialist. Deep Agents' `task` tool has a fixed schema (`description`, `subagent_type`), so the effort travels as the first line of the description: `Effort: low` (or medium, high). The office strips it, records it on the run (`run.effort`) and applies it to that run's model calls (a `wrapModelCall` middleware on the subagent swaps in a model instance built with that effort; instances are cached per effort). The prompts say when to use which: low for lookups, formatting and drafts from existing material; medium for standard deliverables; high for numbers, analysis, decisions and anything the CEO will send out.
- Bounds, highest first: an effort pinned by the CEO on the task, the routine, the person or the team always wins; then the delegator's choice; then the lane base; then the role default; then the office default. So Manage settings are never overridden by an agent.
- Post-mortem (`scripts/report.mjs`) prints the effort per run.

## 4. More work at once

- `maxConcurrentJobs` default 2 → 4 (the Program Manager has one instance per task, so this is "four Program Managers").
- A person's gate: the engine gave every person one model call at a time across tasks; the default becomes 4 for everyone (`concurrency` on the person, editable in Manage → Teams & people). A team's `maxParallelRuns` per task stays 2 by default.
- PDF and PPTX: leads and the quick lane already carry `export_pdf`, `export_pptx` and `assemble_files`; the quick-lane prompt names them as the way to answer "make me a PDF of …".

## 5. A steward for routines

No coordinator agent. The scheduler becomes the steward:
- After a routine fires, it tracks the task's outcome (`done`, `blocked`, `escalated`, `cancelled`, `awaiting_ceo`) in `data/routines.json` (`lastOutcome`, `failures` in a row).
- A run that blocks is retried once by the engine's automatic retry; a routine whose task is still not done by its deadline (the next due time, or 2 hours, whichever is first) is marked `missed` and the CEO gets one inbox item with "Run now".
- Two failures in a row flag the routine in Right now and in Settings → Routines; the daily digest carries a "Routines" section: ran on time, late, missed, waiting for your OK.
- Optional per routine: `followUp: true` creates a Program Manager task "Routine <title> did not complete: find out why and get it done" after the second failure.

## 6. UI

- The task card and the task page show the lane ("Quick · Delivery") and, after promotion, "Promoted to the team".
- Settings → Office: "Fast lane" on/off (`fastLane`, default on) and "Tasks running at once" default 4.
- The composer gets no new control; the CEO can pin a lane through the API (`lane`) and, later, a "Quick" chip.

## 7. Tests

Engine (scripted models): a quick-lane task completes with the lead alone (no specialist run, `review.self`, result filed, `lane_chosen`); budget promotion (9 tool calls → promoted, standard lane completes, files kept); `needs_the_team` promotion; a lead that ends without a review is re-prompted once, then promoted; triage rules (project block → standard, pinned lane honoured, model failure → standard); effort: the specialist's model is built with the effort the lead chose, a CEO pin wins, `run.effort` recorded; a lead's gate admits four calls at once; `record_review` in the standard lane still refuses a lead's own work. Prompts: `quickLeadPrompt` names the tools and the review. Settings: `fastLane`, `maxConcurrentJobs` default 4. Scheduler: outcome tracking, `missed`, two failures flag, digest section.

## 8. Order

1. Quick lane with the lean lead, self-review, engine completion, budget and promotion, lane events and label.
2. Effort: lane base, delegation effort, bounds, report.
3. Concurrency defaults and the person gate.
4. Routine steward and digest section.

Built on the branch `fast-lane`; merged to main and deployed on the CEO's approval.
