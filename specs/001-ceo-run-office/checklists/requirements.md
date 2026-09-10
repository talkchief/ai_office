# Requirements Quality Checklist: CEO-run office

**Purpose**: Unit tests for the requirements in spec.md — are they complete, clear, consistent, measurable and ready to build? `[x]` means a reviewer approved the requirement's quality, not that the feature works.
**Created**: 2026-09-10

## Requirement Completeness
- [ ] CHK001 - Is the policy for when task completion needs CEO approval defined, including the default for teams? [Gap, U2]
- [ ] CHK002 - Are the tools a specialist may use in free chat (not on a task) enumerated? [Gap, U3]
- [ ] CHK003 - Are Settings fields and defaults (concurrency, run timeout, escalation hours, outbound/read-only overrides, completion approval, digest time, seed notes) specified? [Gap, U7]
- [ ] CHK004 - Is document identity on upload (same path replaces / versions) specified? [Gap, U8]
- [ ] CHK005 - Are OAuth callback protections (PKCE, state, allowed origin) specified for connector login? [Gap, U9]
- [ ] CHK006 - Is the "Make this a task" suggestion a requirement, not only a scenario? [Gap, C4]

## Requirement Clarity
- [ ] CHK007 - Are edited approval arguments required to validate against the tool schema before execution? [Clarity, FR-006, U1]
- [ ] CHK008 - Is the state a done task enters after a CEO message named, and is a new review required? [Clarity, FR-002, U4]
- [ ] CHK009 - Is "N relevant notes" replaced with a concrete default? [Ambiguity, Edge Cases, A1]
- [ ] CHK010 - Is the length of a handover conversation bounded (bubbles per person, total seconds)? [Ambiguity, US13, A2]

## Requirement Consistency
- [ ] CHK011 - Is one name used for the supervisor role (Program Manager) and one for the knowledge store (Brain in UI, knowledge in code)? [Consistency, I1]
- [ ] CHK012 - Does the scene-layout requirement include the CEO desk introduced by the motion requirement? [Consistency, FR-016 vs FR-037, I2]
- [ ] CHK013 - Do the job schema and the constitution agree that configuration is referenced by id and only labelled snapshots are stored? [Consistency, Principle I, K1]

## Acceptance Criteria Quality
- [ ] CHK014 - Is every SC verified by a named task (SC-008 bundle size, SC-011 indexing time)? [Measurability, C2]
- [ ] CHK015 - Are the retrieval quality figures (top-3 for 90% of 30 queries) reproducible from a committed fixture? [Measurability, SC-010]

## Scenario Coverage
- [ ] CHK016 - Is the assignee-outside-department case defined? [Coverage, FR-020, U5]
- [ ] CHK017 - Are duplicate decisions on the same pending action defined (second is a no-op)? [Coverage, Edge Cases]
- [ ] CHK018 - Is behaviour during index rebuild defined for agents that search meanwhile? [Coverage, FR-034]

## Edge Case Coverage
- [ ] CHK019 - Is the restart-during-rebuild or restart-during-upload behaviour specified? [Edge Case, FR-031/034]
- [ ] CHK020 - Is the behaviour when the local embedding model cannot load (missing bindings, no CPU support) specified? [Edge Case, FR-033]

## Non-Functional Requirements
- [ ] CHK021 - Are secrets-at-rest rules (0600 files, redaction in every list endpoint and audit diff) stated for providers, tools and audit? [Security, FR-011/023/029]
- [ ] CHK022 - Is the SSE connection cap and heartbeat interval stated as a requirement rather than only a hardening task? [Reliability, FR-010]

## Dependencies & Assumptions
- [ ] CHK023 - Is the assumption that claude.ai-managed connectors must be re-authorised (or replaced) surfaced to the CEO as a migration step? [Assumption, FR-029]
- [ ] CHK024 - Is linux-x64 (Zvec bindings) recorded as a platform assumption with a fallback (full-text only) if bindings are unavailable? [Assumption, FR-032]

## Notes
- Items reference finding ids in analysis.md. `/speckit.implement` reads this checklist but does not modify markers.
