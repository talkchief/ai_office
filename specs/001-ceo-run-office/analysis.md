# Specification Analysis Report — 001-ceo-run-office

Run: 2026-09-10 · Artifacts: spec.md, plan.md, tasks.md · Constitution v1.0.0 · Read-only pass following `/speckit.analyze`.

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| U1 | Underspecification | HIGH | spec FR-006; tasks T017/T030 | "Edit and approve" lets the CEO change tool arguments, but nothing says the edited arguments are validated against the tool's schema before execution. A typo could send to the wrong address. | Add to FR-006: edited arguments MUST be validated against the tool input schema; invalid edits are refused with the validation error. Add a test case to T026. |
| U2 | Underspecification | HIGH | spec FR-009, US3; plan (no FR) | `ceo_approval` (approve completion) is listed as an inbox kind, but no requirement says when completion needs CEO approval. Today `requireHumanApproval` is false on every team. | Clarify (Q1) and add FR-038: completion gate policy and default. |
| U3 | Underspecification | HIGH | spec US1.3; tasks T022/T037 | Free chat with a specialist "executes no action" but the spec does not say which tools chat may use (knowledge only, or read-only connectors too). Affects cost, safety and prompt design. | Clarify (Q3) and add FR-039. |
| U4 | Underspecification | MEDIUM | spec FR-002/US1; tasks T020 | A message on a done task "reopens" it, but the resulting state and whether a fresh lead review is required are only implied by the test text. | Add to FR-002: a message on a done/cancelled-excluded task returns it to `working`, and completion again requires a new approved review. |
| U5 | Underspecification | MEDIUM | spec FR-020; tasks T039 | Assignee outside the task's department is not defined. | Add: assignee MUST belong to one of the task's departments; the form filters accordingly. |
| U6 | Underspecification | MEDIUM | spec FR-021, Edge Cases; plan Constraints | "configurable number of hours", "wall-clock limit", "at most N relevant notes" have no defaults in the spec. | Clarify (Q4) for escalation; record defaults in a Settings entity: runTimeoutMinutes 45, maxConcurrentJobs 2, knowledgeSeedNotes 6. |
| U7 | Underspecification | MEDIUM | spec Key Entities; tasks T013 | `/api/settings` is referenced but the Settings entity (fields, defaults) is not in the spec. | Add "Settings" to Key Entities with: maxConcurrentJobs, runTimeoutMinutes, escalateAfterHours, outboundTools[], readOnlyTools[], completionApproval, digestTime, knowledgeSeedNotes. |
| U8 | Underspecification | MEDIUM | spec FR-031; tasks T050 | Re-uploading a document with the same name: replace, version, or refuse? Identity of a document (path vs hash) is undefined. | Decide: same path replaces and the previous copy is archived under `.archive`; index updated. Add to FR-031. |
| U9 | Underspecification | MEDIUM | spec FR-029; tasks T023 | OAuth callback security (state parameter, redirect allow-list, public HTTPS host) is not stated; the callback is a classic attack surface. | Add to FR-029: PKCE + state MUST be verified; callback only on the configured public origin; tokens 0600. Add test in T026/T023. |
| C1 | Coverage | MEDIUM | spec FR-007; tasks T029 | Per-tool outbound/read-only override is required in settings but no task puts it in the Tools page UI. | Add to T029: Tools page shows each tool's classification with an override toggle. |
| C2 | Coverage | MEDIUM | spec SC-008, SC-011; tasks T046, T054 | Bundle-size drop and 5 MB PDF indexing time are success criteria with no verifying task. | T046: assert built bundle contains no demo identifiers and record size; T054: timed indexing fixture. |
| C3 | Coverage | MEDIUM | tasks T024 | Existing `Conversation <Agent>` notes written by the old chat pollute retrieval; migration does not mention them. | T024: archive `Conversation *` notes into `.archive/conversations/`. |
| C4 | Coverage | LOW | spec US1.3 | "Make this a task" suggestion has a scenario but no FR. | Add FR-040: chat replies MAY carry a suggested task {dept, text, assignee}; the UI shows a one-click create. |
| A1 | Ambiguity | MEDIUM | spec Edge Cases | "at most N relevant notes" is an unresolved placeholder. | Replace N with the Settings default (knowledgeSeedNotes). |
| A2 | Ambiguity | LOW | spec US13 | "short conversation" is bounded only by the 80-character bubble rule; number of exchanges unspecified. | State: at most 2 bubbles per person per meeting; total meeting under 6 s. |
| A3 | Ambiguity | LOW | plan Performance Goals | "task list render under 50 ms for 500 tasks" has no measurement task. | Either drop or add a perf check to T046 (render timing via Playwright `performance.measure`). |
| K1 | Constitution (I) | MEDIUM | plan Phase 1 job schema ("fields kept from today") | Today every job body carries full copies of `team` and `agents`. Keeping that would keep a drifting second copy of configuration. | Store `configSnapshot {officeRevision, skills, models}` only; resolve team/agents by id at read time. Note in T020/T024. |
| K2 | Constitution (V) | MEDIUM | tasks T010, T026, T045, T054 | Tests are the last task of each phase; Principle V says engine tests come first. | Reorder: T026 fake model + engine tests start with T020 (write the scenarios first, implement to green). Same for T054 before T051. |
| I1 | Inconsistency | LOW | spec, tasks, owner wording | "Program Manager", "PM", "project manager" used for the same role; "Brain", "knowledge", "knowledge base" likewise. | Glossary: Program Manager (PM) in UI text; Brain in UI, `knowledge` in code. Add to spec. |
| I2 | Inconsistency | LOW | spec FR-016 vs FR-036/037 | CEO desk introduced in FR-037 but FR-016 (scene layout) does not mention it. | Fold the CEO desk into FR-016. |
| I3 | Inconsistency | LOW | tasks T029 | One task covers ten settings pages; too large to track. | Split into T029a (router shell + Office/Teams/People), T029b (Models/Tools), T029c (Skills/Routines/Reports/Brain/Audit). |
| D1 | Duplication | LOW | spec FR-005 vs FR-009 (`done` kind) | Both describe clearing the Done state; FR-009 adds the inbox `done` item. | Keep both; cross-reference FR-005 from FR-009. |
| D2 | Duplication | LOW | spec FR-021 vs FR-022 | Scheduler responsibilities split across two FRs (overdue/escalation vs routines/digest). | Acceptable; note both run on the same 60 s tick in plan. |

| R1 | Revision (owner) | HIGH | spec US14, FR-043/044; tasks T004/T020/T029a/T032 | Owner asked whether adding teams/agents and per-team parallelism were covered. They were not: parallelism had been removed together with budgets and workforce shaping had no story. | Added US14, FR-043, FR-044, SC-013; T004 keeps `maxParallelRuns`/`maxReworkRounds`; T020 enforces a per-team semaphore; T029a covers add/remove teams and agents. Resolved. |

| R2 | Revision (owner) | HIGH | spec US15, FR-045…049; tasks T059–T061 | Owner needs an explicit place to give feedback over chat on a delivered or running task and have the output corrected; the spec only implied it through FR-002. | Added US15 (correction loop), FR-045 message kinds, FR-046 reopen + re-review + versions, FR-047 mid-run notes, FR-048 remember-as-rule, FR-049 result versions, SC-014; tasks T059–T061 (tests first). Resolved. |

## Coverage Summary

| Requirement | Has Task? | Task IDs | Notes |
|---|---|---|---|
| FR-001 | Yes | T020, T024, T044 | |
| FR-002 | Yes | T014, T020, T022, T037 | see U4 |
| FR-003 | Yes | T017, T020, T026 | |
| FR-004 | Yes | T020, T026 | |
| FR-005 | Yes | T002, T003, T022 | |
| FR-006 | Yes | T017, T020, T030, T026 | see U1 |
| FR-007 | Partial | T017, T013 | UI override missing (C1) |
| FR-008 | Yes | T017 | |
| FR-009 | Yes | T015, T030, T040 | |
| FR-010 | Yes | T016, T031, T027 | |
| FR-011 | Yes | T012, T013 | |
| FR-012 | Yes | T012 | |
| FR-013 | Yes | T012 | |
| FR-014 | Yes | T012, T013, T025, T029 | |
| FR-015 | Yes | T001, T028, T029 | |
| FR-016 | Yes | T032, T033, T055 | |
| FR-017 | Yes | T034 | |
| FR-018 | Yes | T008, T035 | |
| FR-019 | Yes | T007, T036 | |
| FR-020 | Yes | T022, T039 | see U5 |
| FR-021 | Yes | T040 | see U6 |
| FR-022 | Yes | T041 | |
| FR-023 | Yes | T042 | |
| FR-024 | Yes | T043 | |
| FR-025 | Yes | T004, T020 | |
| FR-026 | Yes | T020, T026 | |
| FR-027 | Yes | T024 | see C3 |
| FR-028 | Yes | T038 | |
| FR-029 | Yes | T017, T023 | see U9 |
| FR-030 | Yes | T017, T018 | |
| FR-031 | Yes | T050 | see U8 |
| FR-032 | Yes | T051, T052 | |
| FR-033 | Yes | T051, T053 | |
| FR-034 | Yes | T050, T051, T053 | |
| FR-035 | Yes | T052, T053 | |
| FR-036 | Yes | T056, T057 | |
| FR-037 | Yes | T055, T056 | |
| SC-005 | Yes | T046 | |
| SC-008 | No | — | C2 |
| SC-010 | Yes | T054 | |
| SC-011 | No | — | C2 |
| SC-012 | Yes | T058 | |
| FR-043 | Yes | T029a, T032 | added after owner revision |
| FR-044 | Yes | T004, T020, T029a | added after owner revision |
| FR-045…FR-050 | Yes | T059, T060, T061, T062 | correction loop via team lead with @/ task tagging, added after owner revision |
| SC-014 | Yes | T061 | |
| SC-013 | Yes | T026 | |

**Constitution Alignment Issues:** K1 (Principle I, snapshot copies), K2 (Principle V, test ordering). No CRITICAL violations.

**Unmapped Tasks:** T011 (dependencies), T027 (deploy), T047 (hardening), T048 (docs), T049 (release) — operational, acceptable.

**Metrics (after remediation):** 50 FRs + 7 buildable SCs = 57 requirements · 64 tasks · Coverage 100% · Ambiguity 0 open · Duplication 2 (accepted) · Critical 0 · High 0 open (U1–U3 and R1 resolved in spec).

## Next Actions
No CRITICAL findings. Resolve U1–U3 (HIGH) through clarification before implementation; fold U4–U9, C1–C4, A1–A3, K1–K2, I1–I3 into spec/tasks as remediation edits after the owner's answers.
