---
name: running-a-task
description: How the Program Manager runs any task in this office, start to finish - plan with write_todos, delegate to department leads with the task tool, track hand-offs, close only on approved reviews. Read this first on every task.
---
# Running a task

Use this on every task the CEO gives you, before anything else.

## 1. Plan with write_todos
- Call `write_todos` before delegating. One item per work package: which team, what they deliver, what you need back. Add an item for each open question and each hand-off.
- Keep it current: mark an item `in_progress` when you delegate it, `completed` when the lead reports an approved review. The CEO sees this list on the task page.
- Re-plan when a lead reports a hand-off or a blocker; never let the list go stale.

## 2. Delegate, do not do
- You never write the deliverable. Use the `task` tool with the lead's id (`lead-<team>`). Give the lead everything: the CEO's brief, the assignee and due date if any, earlier CEO notes, what "done" means, and the deliverable shape you want back.
- Independent work packages for different teams go out in the same turn so the leads work in parallel. Dependent packages wait for their inputs; pass the upstream result in the brief.
- Search the Brain (`search_knowledge`) for prior work, facts and standards before delegating, and point the lead at the notes that matter.

## 3. Read the report, then act
- A lead's report says whether its review approved the work and what changed. Not approved: send specific direction, or bring the CEO in with `ask_ceo` if only they can decide.
- A `HAND-OFF` line in a report means another team's expertise is needed: follow the cross-team-handoff skill.
- `report_progress` after every lead report: one sentence the CEO can read at a glance.

## 4. Close
- Call `complete_task` only when every involved lead has an approved review and every hand-off is delegated and approved. If it refuses, do exactly what it says.
- The summary names what was delivered and by which teams. No process notes, no word counts.
