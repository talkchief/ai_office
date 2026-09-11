# Client Portal Project: Comprehensive Handover Checklist

This handover checklist governs the end-to-end operational transition of the self-service client portal from Delivery build and Quality Assurance into production ownership across Delivery, Operations, Finance, and Marketing. Adhering to the project lifecycle from Kickoff (2026-09-14) through Day-7 Check-in (2026-12-07), this checklist enforces measurable acceptance criteria across all system domains to guarantee that no client data leaves internal infrastructure, brand standards remain uncompromised, and post-launch targets—including an 80% client login rate within 30 days and a 50% reduction in status and invoice support inquiries—are achieved.

---

## 1. Master Milestone Timeline & Governance Framework

The portal implementation follows the standard Delivery project plan framework (`/knowledge/70-Delivery/project-plan-template.md`). Team hours are logged weekly, and any scope modifications require an immediate same-day re-cut of the plan and formal reporting of schedule impact.

| Milestone Stage | Target Date | Governing Lead | Gateway Description & Handover Dependencies |
|---|---|---|---|
| **Kickoff** | 2026-09-14 | Delivery Lead / Program Manager | Project kick-off, confirmation of workstream owners, selection of 3 beta client candidates, and alignment of inter-team handoff interfaces. |
| **Design Round 1** | 2026-09-23 | Technical Lead / Delivery | Delivery of initial interaction mockups and interface designs for status view, asset repository, invoice view, and client authentication. |
| **Scope & Design Sign-off** | 2026-09-30 | Program Manager / CEO | Formal executive approval of the scope package, architecture boundaries, client first actions, interim beta gate structure, and explicit exclusions. |
| **Build Completion** | 2026-10-23 | Technical Lead | Engineering freeze; completion of all core feature modules, automated finals-only validation, and per-client dynamic accent theming in staging. |
| **QA Checklist Pass** | 2026-10-28 | QA Checker | 100% verification across links, numbers ledger alignment, spelling, brand styling, and client first-action user flows. Zero open Sev-1/Sev-2 defects. |
| **Beta Gate (3 Clients)** | 2026-10-31 | Operations Lead | Conditional live beta deployment for 3 selected clients upon issuance of the Operations interim data-protection clearance. |
| **Launch Comms Sign-off** | 2026-11-20 | Marketing Lead / CEO | Executive approval of the Launch Announcement email copy and the Client Onboarding Guide; hard prerequisite for external outreach. |
| **Full Handover & Go-Live** | 2026-11-30 | Operations Lead / Delivery Lead | Final data-protection review sign-off, operations support runbook handover, and migration/activation of all 14 active clients. |
| **Day-7 Check-in** | 2026-12-07 | Delivery Lead / Operations Lead | Post-launch evaluation: verification of client login uptake (tracking toward 80% / 12 clients), support ticket volume vs. baseline, and resolution of beta feedback. |

---

## 2. Comprehensive Handover Checklist by Domain

### Domain 1: Architecture, Infrastructure & Hosting

| Item ID & Work Package | Category / Domain | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|
| **INF-01: Production & Staging Infrastructure** | Architecture & Hosting | Technical Lead | Portal deployed strictly on company-owned infrastructure per the vendor list (`/knowledge/50-Emails/vendor-list.md`). No unauthorized public cloud runtimes, external serverless functions, or unapproved third-party dependencies exist. | System architecture topology diagram, server configuration manifests, and DNS zone verification logs. | Operations Lead |
| **INF-02: Domain & TLS/SSL Hardening** | Architecture & Hosting | Technical Lead | Portal served over HTTPS with TLS 1.3 enforced. HSTS header active with `max-age=31536000; includeSubDomains`. Qualys SSL Labs rating 'A' or higher achieved. Automated certificate renewal configured and tested. | Qualys SSL Labs audit report and cURL header inspection dump showing strict transport security headers. | Operations Lead |
| **INF-03: Multi-Tenant Database Isolation** | Architecture & Hosting | Technical Lead | Strict logical database partitioning implemented. SQL queries enforce tenant filtering (`client_id`) at the data access layer. Cross-tenant data leakage is cryptographically and architecturally prevented. | Automated security penetration testing report and multi-tenant SQL isolation audit signed by engineering. | QA Checker & Operations Lead |
| **INF-04: Concurrency & Performance Profiling** | Architecture & Hosting | Technical Lead | Portal pages achieve full interactive render in under 1.5 seconds on standard broadband and mobile viewports across all 14 client profiles concurrently. Status and invoice API p99 latency remains under 500ms. | Load-testing benchmark report (k6 / Apache Bench execution log under simulated 50 concurrent client sessions). | Delivery Lead |
| **INF-05: Infrastructure Health & Uptime Monitoring** | Architecture & Hosting | Technical Lead | Automated synthetic monitoring configured to poll the `/healthz` endpoint every 60 seconds. Critical failure alerts route directly to `operations@` and emergency SMS with zero false positives. | Monitoring dashboard configuration export and synthetic failure drill incident log demonstrating active paging. | Operations Lead |

---

### Domain 2: Authentication, Access Control & Tenant Security

| Item ID & Work Package | Category / Domain | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|
| **AUT-01: First-Time Login & Password Configuration** | Authentication & Security | Technical Lead | Activation invites generate single-use, cryptographically secure tokens valid for 24 hours. Password policy enforces a minimum of 12 characters with mixed case, numbers, and symbols, hashed via Argon2id or bcrypt. | Password complexity unit test execution logs and token lifecycle expiration audit trail. | QA Checker |
| **AUT-02: Local Identity & Session Management** | Authentication & Security | Technical Lead | Identity management handled strictly within local internal systems without external identity providers (no Auth0, Okta, or Firebase). Session cookies configured with `Secure`, `HttpOnly`, `SameSite=Strict`, and an 8-hour idle timeout. | Cookie header inspection report and network trace proving zero authentication calls to outside servers. | Operations Lead |
| **AUT-03: Role-Based Access Control (RBAC)** | Authentication & Security | Technical Lead | Distinct roles enforced: `Client Admin`, `Client Viewer`, `Studio Admin`, and `Studio Operator`. Client roles strictly limited to their own organization's records; Studio roles bounded by administrative policy. | Privilege escalation test suite logs and RBAC permission assignment audit sheet. | QA Checker |
| **AUT-04: Onboarding Form Consent Capture** | Authentication & Security | Technical Lead | First-time onboarding registration form captures explicit consent in full alignment with the company compliance checklist (`/knowledge/90-Operations/compliance-checklist.md`). Consent timestamp and IP address recorded immutably. | Database schema record showing consent logging fields and UI screenshot of active consent checkbox. | Operations Lead |

---

### Domain 3: Client UI & Core Feature Modules

#### Module A: Project Status View
| Item ID & Work Package | Category / Domain | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|
| **MOD-01: Live Milestone & Stage Tracker** | Client UI & Features | Delivery Lead | Live dashboard displays real-time milestone schedules, active project stages, completed deliverables, and target completion dates matching the delivery plan template (`/knowledge/70-Delivery/project-plan-template.md`). | Functional UI inspection across all active client accounts cross-referenced with active delivery milestone plans. | Operations Lead |
| **MOD-02: Action Item & Decision Notifications** | Client UI & Features | Delivery Lead | Dedicated "Client Next Action" and "Decisions Required" interface panels present outstanding approvals, directly replacing recurring status email threads. | Live UI walkthrough and acceptance confirmation across the 3 beta client profiles. | Delivery Lead |

#### Module B: Deliverable & Asset Hub
| Item ID & Work Package | Category / Domain | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|
| **MOD-03: Finals-Only Asset Repository & Validation** | Client UI & Features | Technical Lead / QA Checker | Clients can view and download approved final assets. Server-side validation strictly blocks any file flagged as draft, WIP, or unapproved from being uploaded or displayed (`/knowledge/70-Delivery/asset-conventions.md`). | Automated negative upload test rejecting draft assets and verified download logs for final files. | QA Checker |
| **MOD-04: Asset Naming & Format Standard Compliance** | Client UI & Features | Delivery Lead | All uploaded client files strictly follow directory and naming conventions: `client / project / type / version`. Logos are systematically provided in all 4 mandatory file formats: SVG, PNG, PDF, and favicon. | Asset repository audit report confirming 100% path convention adherence across all active client repositories. | Delivery Lead |
| **MOD-05: Local File Delivery Architecture** | Client UI & Features | Technical Lead | Deliverable files are served directly from internal company hosting storage. Zero external file storage links (e.g. Dropbox, Google Drive, Box, AWS public buckets) are exposed to clients. | Network inspector HAR log demonstrating local origin domain URLs for 100% of asset downloads. | Operations Lead |

#### Module C: Invoice View & Payment Module
| Item ID & Work Package | Category / Domain | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|
| **MOD-06: Invoicing Schedule & Ledger Synchronization** | Client UI & Features | Finance Lead | Invoices display accurate billing schedules per finance rules (`/knowledge/80-Finance/invoicing-rules.md`): retainers on the 1st of the month; project builds 50% upfront, 50% at handover. Status tags: Paid, Due, Overdue. | Reconciliation audit sheet matching portal invoice lists against the internal accounting ledger. | Finance Lead |
| **MOD-07: Payment Reminder Lifecycle Display** | Client UI & Features | Finance Lead | Overdue notices and invoice schedules adhere to the standard Day 7, Day 14, and Day 21 reminder lifecycle. Credit notes display only after explicit owner approval per invoicing rules. | Functional test of simulated aging invoices demonstrating correct lifecycle display flags and credit note logs. | Finance Lead |
| **MOD-08: In-Portal Payment Handling / Bank Instructions** | Client UI & Features | Technical Lead / Finance Lead | Scope-governed implementation: If an inbound gateway is approved by the CEO, embedded checkout functions without data leakage; if deferred, clear BACS/wire transfer rail instructions and remittance details are displayed. | Code audit of payment modal OR screenshot inspection of bank transfer details panel. | Finance Lead & Operations Lead |

#### Module D: Client Onboarding Flow
| Item ID & Work Package | Category / Domain | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|
| **MOD-09: Guided Interactive First Session** | Client UI & Features | Technical Lead / Marketing Lead | Guided 3-step walkthrough on initial login: (1) Confirm account and establish secure password, (2) Review project status view, (3) Inspect invoice and download sample final asset. Flow completes in under 10 minutes. | Video recording of complete first-time user journey from invitation email click through completion of all 3 actions. | Delivery Lead |

---

### Domain 4: Admin Dashboard & Operations Controls

| Item ID & Work Package | Category / Domain | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|
| **ADM-01: Tenant Lifecycle Management** | Admin & Operations | Technical Lead | Internal management interface allows Operations staff to provision new client tenants, configure client accent colors, issue user invitations, and instantly suspend/deprovision accounts upon project completion or contract termination. | Operational test execution log showing successful client provisioning, access modification, and instant deprovisioning. | Operations Lead |
| **ADM-02: Asset Staging & Release Workflow** | Admin & Operations | Delivery Lead | Administrative publishing interface enforces mandatory metadata (`client`, `project`, `type`, `version`), requires explicit "Mark as Final" approval checkbox, and rejects non-compliant file names. | Interface screengrabs and signed release approval audit records for initial staging deliverables. | Operations Lead |
| **ADM-03: Security & Activity Audit Logging** | Admin & Operations | Technical Lead | Immutable system logging captures all administrative operations, user logins, asset downloads, password changes, and permission edits. Logs are stored locally and retained for 3 years (`/knowledge/90-Operations/compliance-checklist.md`). | Sample RFC 5424 structured log export and proof of write-protected local archive storage. | Operations Lead |

---

### Domain 5: Data Protection, Privacy & Legal Compliance

| Item ID & Work Package | Category / Domain | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|
| **SEC-01: Data Boundary Enforcement** | Data Protection & Compliance | Operations Lead | Formal data-flow audit proving client credentials, project status, deliverables, invoices, and theming settings are stored and processed strictly within internal systems, satisfying the charter rule "No client data leaves our systems". | Data Flow Architecture Diagram and signed Operations Compliance Review statement. | Operations Lead & CEO |
| **SEC-02: Automated 3-Year Retention & Purge Routine** | Data Protection & Compliance | Operations Lead / Technical Lead | Automated cron routine configured to flag and purge client records, system logs, and deliverable files exactly 36 months after contract termination, with audit entries written to the compliance register (`/knowledge/90-Operations/compliance-checklist.md`). | Cron job configuration file, scheduled script dry-run log, and database automated deletion unit test results. | Operations Lead |
| **SEC-03: Master Agreement Coverage Verification** | Data Protection & Compliance | Operations Lead | 100% of onboarded active clients (all 14 active clients as of 1 Sep 2026 per `/knowledge/00-Meta/numbers-ledger.md`) have an executed Master Agreement on file covering portal access terms, liability caps, and confidentiality (`/knowledge/90-Operations/legal-basics.md`). | Master Agreement audit registry cross-referenced against the active client roster. | Operations Lead |
| **SEC-04: Backup Integrity & Disaster Recovery Drill** | Data Protection & Compliance | Technical Lead | Automated daily encrypted database and asset backups stored in an isolated local backup repository. Successful disaster recovery restoration executed from backup to staging environment in under 30 minutes. | Restoration execution log with timestamped staging verification and cryptographic database checksum match. | Operations Lead |

---

### Domain 6: Quality Assurance & Operational Readiness

| Item ID & Work Package | Category / Domain | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|
| **QAR-01: Link Integrity & External Tracker Audit** | QA & Readiness | QA Checker | 100% of internal links, anchors, and download buttons functional with zero 404 errors. Absolute absence of external tracking beacons, third-party analytics pixels, or unauthorized remote scripts. | Automated crawler report (0 broken links) and browser network inspection trace verifying zero external requests. | Delivery Lead |
| **QAR-02: Numbers Ledger Metric Alignment** | QA & Readiness | QA Checker / Finance Lead | All displayed financial and operational numbers reconcile perfectly with `/knowledge/00-Meta/numbers-ledger.md` (e.g., active client counts, retainer fees, project build 50/50 splits, and invoice amounts). | Metric reconciliation sign-off sheet comparing portal production data against the numbers ledger. | Finance Lead |
| **QAR-03: Copy, Spelling & Grammar Inspection** | QA & Readiness | QA Checker | Zero spelling, punctuation, or grammatical errors across all UI copy, error alerts, notification emails, and guided onboarding modals. | Comprehensive QA copy sign-off checklist signed by QA Checker. | Delivery Lead |
| **QAR-04: Visual Identity & Client Accent Styling** | QA & Readiness | QA Checker | Full adherence to brand standards (`/knowledge/20-Brand/visual-identity.md`): base styling strictly "Ink on Cream", approved typography, and exactly one designated accent color correctly applied per client tenant view. | Visual inspection audit across 5 distinct client tenant views with CSS color variable validation. | Delivery Lead |
| **QAR-05: Three First Actions Validation Suite** | QA & Readiness | QA Checker | Seamless end-to-end execution of the 3 mandatory client actions: (1) Set password, (2) View project status, (3) Inspect invoice / download asset, tested across Safari, Chrome, Firefox, iOS, and Android. | Cross-browser and device test execution matrix with 100% pass rate. | Delivery Lead |
| **QAR-06: Operations Support Runbook Handover** | QA & Readiness | Operations Lead | Comprehensive Standard Operating Procedure (SOP) addressing common client inquiries: credential resets, asset download troubleshooting, invoice questions, and access revocation. | Finalized Operations Support Runbook published to `/work/operations-support-runbook.md`. | Operations Lead |
| **QAR-07: Support Triage SLA & Baseline Measurement** | QA & Readiness | Operations Lead | Pre-launch support inquiry baseline measured from existing inbox. Shared queue configured with a 1-hour first-response SLA for active portal clients ("clients first, within the hour"). | Pre-launch baseline volume report and helpdesk queue SLA routing configuration sheet. | Operations Lead |
| **QAR-08: Technical Maintenance & Recovery SOP** | QA & Readiness | Technical Lead | Technical maintenance runbook detailing application restart procedures, database re-indexing, deployment rollback steps, and emergency developer escalation contact hierarchy. | Technical Maintenance Playbook archived in operational repository and signed off by Technical Lead. | Operations Lead |
| **QAR-09: Internal Operational Staff Training** | QA & Readiness | Delivery Lead | 45-minute training session delivered to Delivery and Operations personnel covering tenant provisioning, asset release verification, and ticket escalation workflows. | Training attendance log, presentation materials, and session recording archive link. | Operations Lead |

---

### Domain 7: Client Onboarding, Marketing & Post-Launch Support

| Item ID & Work Package | Category / Domain | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|
| **COM-01: Launch Announcement Email Finalization** | Onboarding & Marketing | Marketing Lead | Launch announcement email drafted in accordance with approved voice and tone guidelines, emphasizing finals-only asset delivery, strict data protection, and self-service speed. | Final copy document with subject line variants approved by Marketing Lead. | CEO |
| **COM-02: Client Onboarding Guide Documentation** | Onboarding & Marketing | Marketing Lead | Production of the guide: "Your client portal: up and running in ten minutes", featuring concise instructions, single-screen walkthroughs for the 3 first actions, and support contacts. | Final formatted PDF guide packaged for distribution. | CEO |
| **COM-03: Beta Client Recruitment & Feedback Loop** | Onboarding & Marketing | Delivery Lead / Operations Lead | Three active clients onboarded into live beta on 2026-10-31 (representing 1 retainer client, 1 project client, and 1 asset-intensive client). Structured feedback collected weekly. | Beta client onboarding confirmation memo and consolidated beta feedback log. | Delivery Lead |
| **COM-04: Client Login Adoption Tracking (80% Target)** | Onboarding & Marketing | Delivery Lead / Operations Lead | Telemetry dashboard tracking individual client activations toward the milestone goal of 80% of active clients (at least 12 of 14 active clients) logged in within 30 days of launch. | Weekly adoption report detailing login timestamps and outreach log for pending clients. | Program Manager |
| **COM-05: Support Inquiry Reduction Evaluation** | Onboarding & Marketing | Operations Lead | Support inbox ticket tracking evaluating status and invoice inquiry volume against pre-launch baseline, measuring progress toward the 50% inquiry reduction target. | Monthly support volume comparative analytics report. | Delivery Lead & Operations Lead |

---

## 3. Operational Sign-off & Handover Approvals Matrix

Formal progression through project gates requires written authorization from designated department leads. No milestone gate may be bypassed without explicit executive approval.

| Phase Gate / Decision Milestone | Mandatory Exit Criteria | Handover Artifact / Proof Required | Approving Authority | Approval Status |
|---|---|---|---|---|
| **Gate 1: Scope & Design Sign-off (2026-09-30)** | Complete functional scope agreement, out-of-scope exclusions affirmed, 3 first actions confirmed, and milestone build schedule approved. | Scope & Design Sign-off Package (`/work/client-portal-launch/scope-and-design-signoff-package.pdf`). | Program Manager & CEO | Pending Sign-Off |
| **Gate 2: QA Checklist Pass (2026-10-28)** | 100% test pass on links, numbers ledger alignment, typography, brand styling, finals-only asset checks, and 3 first actions. | QA Verification Test Matrix signed by QA Checker. | QA Checker & Delivery Lead | Queued for Build Freeze |
| **Gate 3: Beta Release Gate (2026-10-31)** | Interim Operations clearance issued, 3 beta clients confirmed, consent wording live in registration form, payment flows isolated. | Executed Interim Beta Clearance Certificate. | Operations Lead | Conditional Approval |
| **Gate 4: Launch Comms Sign-off (2026-11-20)** | Launch announcement copy polished, onboarding guide completed, CEO quote confirmed, and delivery schedule approved. | Approved Marketing Launch Pack & PDF Onboarding Guide. | Marketing Lead & CEO | Scheduled |
| **Gate 5: Full Handover & Go-Live (2026-11-30)** | Full data-protection compliance review signed off, support runbook operational, staff training complete, all 14 client tenants provisioned. | Delivery-to-Operations Formal Handover Certificate. | Delivery Lead & Operations Lead | Scheduled |
| **Gate 6: Day-7 Post-Launch Review (2026-12-07)** | 7 days of live production telemetry, login adoption tracking toward 80% (12 clients), support volume compared to baseline. | Day-7 Post-Launch Evaluation Report. | Delivery Lead & Operations Lead | Scheduled |

---

## 4. Material Assumptions & Governance Constraints

### 4.1 Executive Decisions Required (CEO / Legal)
1. **Confirmation of Inbound Payment Rails**:
   - *Status*: Open CEO decision.
   - *Detail*: Finance records confirm that no merchant gateway or automated inbound client payment provider is currently registered. The CEO must determine whether an unrecorded gateway exists or confirm that existing client payments arrive strictly via BACS/wire transfer.
2. **In-Portal Automated Payment Scope**:
   - *Status*: Open CEO decision.
   - *Detail*: The CEO must formally confirm whether automated in-portal payment processing remains in scope for the 2026-11-30 general launch or is deferred to Phase 2. If retained in scope, the provider selection, commercial terms, and spend authorization require executive approval.
3. **Data-Protection Definition of Hosting Infrastructure**:
   - *Status*: Open CEO & Legal Counsel decision.
   - *Detail*: Operations requires an executive and legal ruling affirming that hosting client records and assets on the company's existing server (per `/knowledge/50-Emails/vendor-list.md`, renewing March) complies with the charter constraint *"no client data leaves our systems"*. If the hosting agreement lacks explicit data processing terms, legal review must be conducted prior to the 2026-11-30 full launch.
4. **Marketing Launch Communications & Leadership Attribution**:
   - *Status*: Open CEO approval (due 2026-11-20).
   - *Detail*: Formal sign-off on the Launch Announcement email text, Onboarding Guide PDF, and confirmed attribution for the executive quote.

### 4.2 Material Operational Assumptions
1. **Active Client Baseline**:
   - *Evidence*: `/knowledge/00-Meta/numbers-ledger.md` (verified as of 1 Sep 2026).
   - *Assumption*: The active client base consists of exactly 14 client organizations, representing $38,400 MRR. Achieving the 80% 30-day login adoption goal requires successful first-time activation by at least 12 distinct client organizations.
2. **Support Inquiry Volume Baseline**:
   - *Evidence*: Delivery build plan charter (`/knowledge/Agents Office/task-de60d80d-8b69-46cf-b374-3f930e376b34.md`).
   - *Assumption*: Operations maintains a measurable pre-launch baseline of status and invoice inquiry email volume in the primary support inbox, against which the 50% volume reduction target will be evaluated at the Day-7 review.
3. **Beta Client Distribution Criteria**:
   - *Evidence*: Delivery project plan guidelines.
   - *Assumption*: The 3 beta clients selected at Kickoff will comprise: (1) one retainer client (evaluating the 1st-of-month invoice cycle), (2) one project client (evaluating the 50/50 invoicing milestone structure), and (3) one asset-heavy client (evaluating high-volume deliverable downloads).
4. **Scope Freeze Governance**:
   - *Evidence*: Project plan template (`/knowledge/70-Delivery/project-plan-template.md`).
   - *Assumption*: Any functional changes or out-of-scope requests (e.g. mobile applications, billing terms adjustments) introduced after the 2026-09-30 Scope Sign-off will immediately require a formal plan re-cut, recalculation of delivery hours, and CEO sign-off.