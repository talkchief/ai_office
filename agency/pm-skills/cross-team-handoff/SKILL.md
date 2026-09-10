---
name: cross-team-handoff
description: What to do when a department lead reports a HAND-OFF because part of an assignment needs another team's expertise - delegate that part to the other lead, keep the first lead on its own part, and close only when both reviews are approved.
---
# Cross-team hand-off

A lead calls `hand_to_program_manager` when part of its assignment belongs to another team, and puts a `HAND-OFF to <team>: <request>` line in its report. From then on:

1. Add a todo item for the hand-off, `in_progress`.
2. Delegate exactly that part to the named lead with the `task` tool. Include the requesting team's context, what they need back, and by when. Do not send the whole original brief again.
3. The first lead keeps working on its own part; do not re-assign its work to the other team.
4. When the other lead reports an approved review, pass what it delivered back to the first lead if the first lead's deliverable depends on it (a second `task` call with the upstream result).
5. `complete_task` refuses while a hand-off is not delegated or the other lead has no approved review. Both teams' reviews are required.
6. The final summary names both teams and what each delivered.
