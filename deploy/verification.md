# Talkchief AI Space — implementation verification

Verified on 9 September 2026 against the running service at
https://test.talkchief.io:8443 and an isolated instance using the same source and
built HTML. Production data was preserved. The deployed HTML SHA-256 is
`f1883c0a0c2fd58b0ed196ebb10828af63c3b2300cccac2ecb1a9a20321b35c7`.

## Requested capabilities

| Requirement | Implementation and observed evidence |
| --- | --- |
| Real specialized teams | `office-store.mjs` persists team names, purpose, instructions, roles, models, tools and skills. `workflows.mjs` runs a LangGraph planning → worker → review workflow with SQLite checkpoints. A real Claude run used two different specialists concurrently and produced a 4,788-character launch package. |
| Add/remove agents and assign a lead | Current browser check added an agent, made it the marketing lead, saved/reloaded the 3D roster, then removed it and restored the lead. The roster returned from 36 to 35 agents. Validation prevents removing agents with unfinished work and keeps the reviewing lead separate from workers. |
| Design and assign skills | Manage → Skills supports create/edit/remove/unassign. Instructions are versioned and assigned to teams or individual agents. Automated tests verify assigned-only prompts and immutable task snapshots. The real two-worker run used a shared source-discipline skill. A browser/API check saved a library exceeding the former 64 KiB limit. |
| Team purpose and guardrails | Both are editable in Teams and passed into agent instructions. Every guardrail requires an evidenced lead-review entry. Tests verify that missing guardrail coverage blocks approval. The real two-worker run included supplied-fact and external-action boundaries. |
| Editable test harness and multiple tests | Teams support up to 12 saved test cases, individual and suite runs. Automated checks support required/prohibited text and minimum/maximum length; the current browser check created all four types, persisted them, removed a check and verified saved tests could run without a false unsaved-change warning. A real two-test suite recorded one pass and one rejection; results were not manufactured into an all-pass result. Evaluations do not enter the business Brain. |
| Supervisor approval and rework | An independent lead must review the returned deliverables; output checks can veto approval. Rejected work is rerun within configured revision limits, including downstream dependent steps. Automated tests cover missing evidence, check vetoes and dependency rework. The real two-worker run passed all four checks and waited for owner approval before saving. |
| Live work insight and progress | Agent views link to actual plans, assignments, dependencies, acceptance criteria, supplied notes, tools, submissions, review history and execution events. Public drafts appear during worker execution. A real Claude run exposed draft text before review, and the two-worker run independently confirmed simultaneous work and live previews. Browser outage simulation stopped work animations, displayed a stale-data notice and recovered on reconnection. |
| Team reporting | Manage → Reports computes outcomes, active/blocked/waiting work, calls, tokens, cycle time, worker submissions, lead reviews and test-suite outcomes from persisted records. Tests cover period filtering, attribution and separation of tests. The live browser opened Reports and downloaded its JSON export. |
| Budget setting and efficiency | Teams configure call/token budgets, worker concurrency, maximum subtasks, rework rounds and models. Task details display usage against limits. Automated tests prove the call cap holds with concurrent workers and queue priority respects job capacity. Plain model calls exclude unassigned MCP context. The two-worker run used 4 calls and 18,596 reported tokens within its configured limits. |
| Task pipeline | Ideas can be saved without Claude execution, edited and released into a priority queue. Tasks proceed through planning, work, review, optional owner approval and completion, with explicit blocked/retry/cancel states. Browser tests verified no-call idea creation, retained edits across polls and saved priority. Tests cover restart recovery, durable approvals, retry, cancellation and the final save boundary. |
| Claude connection and tools/MCPs | The live office is authenticated to Claude and discovers five connected MCP servers. Tools & MCPs exposes definitions, credentials, authentication and removal; Teams assigns/unassigns tools, with optional per-agent subsets. Browser tests verify assignment persistence. Unit tests verify private credential handling, rollback and unassignment. New-provider OAuth is exercised through the official CLI flow and mocked login tests; no additional third-party account was signed in during this verification. |
| Useful shared Brain | The live Brain uses `data/knowledge`, not bundled example notes. Notes and purpose can be created, edited and archived. Approved work is saved atomically. The real two-worker run verified no note existed before owner approval and that the complete result existed afterward. Tests cover empty graphs, standalone notes, archival and unsafe paths. |
| Preserve the 3D design | The live browser verified team and counter zoom, no connector wires, one compact Manage menu, the requested title and no reload loop or JavaScript errors. Work, lead-review and idle animations were checked, including six distinctive lead desks. |

## Evidence from actual execution

- Automated suite: **38 passed, 0 failed**, using `node --test tests/*.test.mjs`.
- Build and `git diff --check` passed. Live HTML matches the staged build.
- Two-worker task: `0fb3d27d-321d-450e-b91e-7d5335dfca10`, isolated state,
  approved, four checks passed, owner approval recorded, Brain artifact saved.
- Substantive draft-streaming task: `dcaa953f-c062-40fd-8b36-5ca91ff72144`,
  isolated state, approved, 3 calls, 11,887 reported tokens, 5,157 characters.
- Real multi-test suite: `3b9c8037-eddc-413a-9b66-080569b5ec2f`, isolated state,
  one approved and one blocked after review.
- Live checks: HTTPS and signed office access succeeded; Claude remained connected;
  one navigation, no page errors, functioning team zoom, editable-check UI,
  Skills, Reports export and budget details.
- The existing two production task records and office configuration were byte-for-byte
  unchanged across deployment. No verification tasks were added to production.

## Operational boundaries

This is an internal office with one shared owner login and six configurable
functional areas, each with 2–12 agents. It does not provide separate co-founder
accounts or multiple tenant workspaces. Budgets are per-task model-call and
reported-token limits, not currency spending accounts. Token limits are checked
between calls; calls already in flight can cross the remaining token budget.

Progress uses two-second polling and public text previews, not private model
reasoning. Lead verification combines a separate model review with deterministic
output checks; it is not a guarantee that every factual claim is correct.
Configured guardrails govern instructions and review. MCP assignment restricts
available servers, but is not a per-operation approval broker for their write tools.
The workflow prepares deliverables and does not implement an approved outbound
send/publish/pay transaction. The deployed Claude CLI supports MCP integration;
the optional API-key backend does not.

The upstream offline demo remains available as source/reference. Its checker has
demo assumptions and is not counted as a passing production workflow test.

## Result presentation update

Completed tasks open on Result, with formatted Markdown prose, tables, source
links and read-only checklists. Team work and Review retain the plan, individual
submissions, live drafts, evidence and run history in separate tabs. Rich-text copy
and Markdown download preserve usable output; draft downloads are marked as drafts.
The task feed groups attention, active work, ready results, ideas and closed tasks.
Unchanged task polling preserves the document DOM, selection and reading position.

Verification covered safe rendering of untrusted HTML/links/images, document
structure, mobile layout, light/dark themes, clipboard copy, downloaded content,
retained feedback across tabs, approval/revision actions and saved queue edits.
A fresh Claude task (`a390572d-9f39-423c-aa6a-7699354180b0`, isolated state)
produced a recommendation first, a three-option comparison and a first-week
checklist, with assumptions collected at the end: 3 calls, 15,427 reported tokens,
4,797 characters, passing independent lead review. Existing production outputs
were reformatted for display without rewriting their stored content.

## Team coordination and project office — 9 September 2026

Lead chat now delegates to persistent workflows using the current specialist roster
and owner-only follow-up context. Validated per-step model, effort, complexity,
selection rationale and tool IDs reach execution. Unassigned tools cannot enter a
plan, and permissions are rechecked at each model call. Reviews may use assigned
research tools to spot-check sources. CLI input uses stdin and a private temporary
system-prompt file, cleaned after exit, to support larger requirements.

Office configuration supports 1–12 teams with 2–12 members each. Team CRUD updates
3D placement, labels, focus and task selectors. Removing a team with unfinished work
or a dependent project is blocked. Existing tasks and shared notes are retained.
Teams use focused Purpose, People, Tools & skills, Verification, Models & limits,
and Tests sections. Tools distinguish account provenance from office assignments.

Shared memory retrieves dated notes across teams during planning, work and review.
Lead-approved task and project results are saved automatically. New specialist chat
answers are stored as unreviewed conversations; they are never labelled verified
facts. Archived notes are excluded. Historical, time-sensitive claims require fresh
verification. Retrieval currently uses bounded keyword relevance, not embeddings.

The Program Manager stands on a dedicated floor and opens Projects. Project intake
accepts PDF, DOCX, text, Markdown and CSV (10 documents, 5 MB each, 150000 extracted
characters total; scanned PDFs need a readable text version). SQLite preserves
scope, clarifications, assignments, dependencies, feedback and review evidence.
Only ready assignments dispatch to team leads. Completion requires all child tasks
to be approved and every scope requirement to have passing PM evidence. Rejected
scope can trigger two correction rounds. Coordination is limited to 10 calls and
180000 reported tokens, with each team retaining its own budgets. Projects with
interrupted coordination require explicit resumption. Reports poll actual states.

Validation: 47 automated checks pass, plus browser coverage for adding/removing a
seventh team, zoom into that team, tool assignment/unassignment, document upload,
responsive settings without horizontal overflow, model/effort display, 16px
planning/verifying status, spinners and the actual green completed monitor texture.
PDF/DOCX parsing was checked with generated document fixtures.

Isolated real Claude runs (not production tasks):
- 1f1afd94-e17c-4ac6-92bf-34ec651b2b7e: Accounting Lead selected the existing
  Financial Advisor, Opus/medium, and public web tools; WebSearch and WebFetch calls
  were recorded and the deliverable passed independent lead review.
- b54e6e5f-11d9-441b-ab14-d46077cb50cf: Program Manager planned three dependent
  Marketing, Finance and Delivery assignments; all three passed their leads;
  all four project scope requirements passed PM review; delivery saved to memory.
- 211f1886-86db-4929-aa5f-c78ce509cb46: fresh planning/work/review completed using
  stdin plus the private system-prompt file.

Planning and review progress shows operational status and recorded model/tool
choices, not hidden model reasoning. Tool removal affects subsequent calls; an
already-running call retains its initial permissions until it returns.

Production validation: 36 saved agents including the Financial Advisor, three original task records, no test projects, valid Claude authentication, one page navigation, no browser errors, working team zoom, no connector wires. Finance public web was enabled; all inherited MCPs remain unassigned. Project dispatch uses a single database transaction to prevent orphaned duplicate assignments on interrupted saves.
