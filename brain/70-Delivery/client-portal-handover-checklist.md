# Client Portal Project: Handover Checklist

The purpose of this handover checklist is to govern the transition of the self-service client portal from Delivery build and QA into operational ownership across Delivery, Operations, Finance, and Marketing, targeting a structured progression from Kickoff (2026-09-14), Scope Sign-off (2026-09-30), Build Completion (2026-10-23), QA Pass (2026-10-28), 3-Client Beta Gate (2026-10-31), Launch Comms Sign-off (2026-11-20), Full Handover & Go-Live (2026-11-30), through post-launch Day-7 Check-in (2026-12-07). It establishes unambiguous verification criteria, assigned ownership, and strict governance to ensure that no client data leaves internal systems, brand standards are strictly enforced, and support volume targets (halving status/invoice queries and achieving 80% client login within 30 days) are met.

---

## 1. Master Milestone Timeline & Governance Framework

| Milestone Stage | Target Date | Governing Lead | Gateway Description & Handover Dependencies |
|---|---|---|---|
| **Kickoff** | 2026-09-14 | Delivery Lead / Program Manager | Project kick-off, confirm workstream owners, select 3 beta client candidates, align handoff points. |
| **Design Round 1** | 2026-09-23 | Technical Lead / Delivery | Initial screen mockups and interaction flows (status view, deliverable download, invoice view, login). |
| **Scope & Design Sign-off** | 2026-09-30 | Program Manager / CEO | Approval of scope, build plan, client first actions, interim beta gate structure, and exclusions. |
| **Build Completion** | 2026-10-23 | Technical Lead | Engineering freeze; all core modules, finals-only validation, and client theming built in staging. |
| **QA Checklist Pass** | 2026-10-28 | QA Checker | 100% verification across links, numbers ledger alignment, spelling, brand styling, and core user flows. |
| **Beta Gate (3 Clients)** | 2026-10-31 | Operations Lead | Conditional live beta release for 3 selected clients upon Operations interim data-protection clearance. |
| **Launch Comms Sign-off** | 2026-11-20 | Marketing Lead / CEO | Formal approval of the Launch Announcement email and Onboarding Guide; prerequisite for outreach. |
| **Full Handover & Go-Live** | 2026-11-30 | Operations Lead / Delivery Lead | Final data-protection review sign-off, support runbook handover, migration of all 14 active clients. |
| **Day-7 Check-in** | 2026-12-07 | Delivery Lead / Operations Lead | Post-launch evaluation: login uptake (tracking to 80% / 12 clients), support ticket trends, beta bug log. |

---

## 2. Comprehensive Handover Checklist by Domain

### 2.1 Architecture & Infrastructure

| ID | Item / Work Package Name | Category | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|---|
| **INF-01** | Production & Staging Hosting Environment | Architecture & Infrastructure | Technical Lead | Portal deployed exclusively on company-owned infrastructure per vendor list (`/knowledge/50-Emails/vendor-list.md`). No external serverless runtimes or unauthorized multi-cloud dependencies. | Infrastructure topology diagram, server configuration dump, DNS zone records. | Operations Lead |
| **INF-02** | Custom Domain & TLS/SSL Hardening | Architecture & Infrastructure | Technical Lead | Portal served over HTTPS with TLS 1.3 enforced, HSTS header active (`max-age=31536000`), Qualys SSL Labs rating 'A' or higher, automated Let's Encrypt / CA certificate renewal verified. | SSL Labs audit report, curl header inspection log showing strict transport security. | Operations Lead |
| **INF-03** | Database Isolation & Multi-Tenant Data Boundaries | Architecture & Infrastructure | Technical Lead | Strict logical database partitioning ensuring client records, invoices, files, and status data cannot cross-contaminate between client IDs. Query-level tenant filtering strictly enforced. | Automated penetration test log, multi-tenant SQL isolation audit report signed by engineering. | QA Checker & Operations Lead |
| **INF-04** | Performance & Concurrency Load Profiling | Architecture & Infrastructure | Technical Lead | Core portal pages load in under 1.5 seconds on standard broadband/mobile for all 14 client profiles concurrently; 99th percentile response time < 500ms for status and invoice APIs. | Load testing benchmark report (k6 or Apache Bench summary log under simulated 50-user load). | Delivery Lead |
| **INF-05** | Production Uptime Monitoring & Health Checks | Architecture & Infrastructure | Technical Lead | Automated uptime monitor pinging `/healthz` endpoint every 60 seconds. Synthetic checks alerting directly to `operations@` and emergency SMS with zero false positives. | Monitoring dashboard configuration export, synthetic failure test alert incident log. | Operations Lead |

---

### 2.2 Authentication, Access Control & Tenant Security

| ID | Item / Work Package Name | Category | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|---|
| **AUT-01** | First-Time Login & Secure Password Setup | Authentication & Access | Technical Lead | Single-use cryptographically secure activation tokens (valid 24 hours). Mandatory password strength enforcement (minimum 12 chars, mixed case, numbers, symbols) with salt hashing (Argon2id or bcrypt). | Password policy test execution log, sample activation token lifecycle verification audit. | QA Checker |
| **AUT-02** | Local Identity & Session Management | Authentication & Access | Technical Lead | Identity managed locally within internal systems; zero third-party auth services (no Auth0, Okta, Firebase). Session cookies configured with `Secure`, `HttpOnly`, `SameSite=Strict`, 8-hour expiry. | Cookie security header dump, architectural authentication trace proving local internal storage. | Operations Lead |
| **AUT-03** | Role-Based Access Control (RBAC) Enforcement | Authentication & Access | Technical Lead | Distinct roles enforced: `Client Admin`, `Client Viewer`, `Studio Admin`, `Studio Operator`. Clients restricted strictly to their own tenant record; Studio Admins restricted per role definitions. | Access control matrix verification log, negative privilege escalation test results. | QA Checker |
| **AUT-04** | Consent Capture on Initial Onboarding Form | Authentication & Access | Technical Lead | Registration/activation form contains explicit consent wording compliant with company standard (`/knowledge/90-Operations/compliance-checklist.md`). Timestamped consent record stored in database. | Database schema record showing consent timestamp/IP, UI screenshot of active consent checkbox. | Operations Lead |

---

### 2.3 Client UI & Core Feature Modules

#### Module A: Project Status View
| ID | Item / Work Package Name | Category | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|---|
| **MOD-01** | Live Milestone & Progress Dashboard | Client UI & Features | Delivery Lead | Displays live milestone schedule, current active stage, completed sign-offs, and upcoming actions matching the Delivery template (`/knowledge/70-Delivery/project-plan-template.md`). | UI screenshot comparison against active project milestone plan; functional review log. | Operations Lead |
| **MOD-02** | Client Next Action & Blocker Notification | Client UI & Features | Delivery Lead | Clear display of "What you need to decide" or "Client next action" cards, eliminating ambiguity and directly replacing recurring weekly status email threads. | Live UI walkthrough, client view validation for all 3 beta test client configurations. | Delivery Lead |

#### Module B: Deliverable & Asset Hub
| ID | Item / Work Package Name | Category | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|---|
| **MOD-03** | Deliverable Download & Finals-Only Check | Client UI & Features | Technical Lead / QA Checker | Clients can view and download final files. Strict automated server validation: files marked as draft, WIP, or unapproved cannot be uploaded or downloaded (`/knowledge/70-Delivery/asset-conventions.md`). | Automated negative test attempt uploading draft file; verified file download audit log. | QA Checker |
| **MOD-04** | Asset Naming Convention Enforcement | Client UI & Features | Delivery Lead | Every deliverable file complies with the directory and naming structure: `client / project / type / version`. Logos strictly available in all 4 mandatory formats: SVG, PNG, PDF, and favicon. | Asset directory audit report across all client folders; file type validation check. | Delivery Lead |
| **MOD-05** | Local Asset Serving Architecture | Client UI & Features | Technical Lead | Assets served directly from company hosting storage endpoints; zero third-party storage links (e.g., Dropbox, Box, Google Drive, AWS public S3 buckets) exposed to clients. | Network inspector HAR log confirming local origin domain on all download links. | Operations Lead |

#### Module C: Invoice View & Payment Module
| ID | Item / Work Package Name | Category | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|---|
| **MOD-06** | Invoicing Schedule & Status Alignment | Client UI & Features | Finance Lead | Invoices displayed matching ledger rules: retainers on the 1st of month; project builds 50% upfront, 50% at handover (`/knowledge/80-Finance/invoicing-rules.md`). Status flags: Paid, Due, Overdue. | Cross-check reconciliation sheet between Finance invoicing ledger and portal invoice table. | Finance Lead |
| **MOD-07** | Automated Reminder Cadence Display | Client UI & Features | Finance Lead | Display reflects the standard Day 7, Day 14, and Day 21 invoice reminder lifecycle. Credit notes, adjustments, and owner approvals display accurately per Finance rules. | Portal view test on simulated overdue invoice matching notification timestamps. | Finance Lead |
| **MOD-08** | In-Portal Payment Gateway / Bank Rail Handling | Client UI & Features | Technical Lead / Finance Lead | Scope-governed implementation: If payment provider approved by CEO, secure embedded checkout compliant with data boundaries; if deferred, clear manual transfer instructions (BACS/ACH rails). | Code inspection of payment modal OR verified static wire transfer instruction panel. | Finance Lead & Operations Lead |

#### Module D: Client Onboarding Flow
| ID | Item / Work Package Name | Category | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|---|
| **MOD-09** | Guided First-Session Interactive Flow | Client UI & Features | Technical Lead / Marketing Lead | Guided 3-step walkthrough on initial login: (1) Confirm account & set password, (2) Navigate project status view, (3) Inspect invoice & download sample final asset. Completed in < 10 mins. | Video screen-recording of complete first-time user journey from invitation email to completion. | Delivery Lead |

---

### 2.4 Admin Dashboard & Operations Controls

| ID | Item / Work Package Name | Category | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|---|
| **ADM-01** | Client Account Provisioning & Deprovisioning | Admin & Operations | Technical Lead | Admin UI allows Operations staff to provision new client tenants, assign client accent colors, invite client users, and instantly suspend/deprovision accounts upon project completion or contract termination. | Operational test execution log provisioning a test client account and verifying revocation. | Operations Lead |
| **ADM-02** | Deliverable Upload & Release Approval Pipeline | Admin & Operations | Delivery Lead | Upload interface with mandatory metadata inputs (`client`, `project`, `type`, `version`), required "Mark as Final" approval checkbox, and draft file rejection. | Screenshots of upload UI, release approval log signed by Delivery Lead. | Operations Lead |
| **ADM-03** | Immutable Security & System Audit Logging | Admin & Operations | Technical Lead | Tamper-proof logging of all administrative actions, logins, asset downloads, password resets, and permission changes. Logs retained locally for 3 years per retention policy. | Log export sample demonstrating RFC 5424 compliance and local retention storage proof. | Operations Lead |

---

### 2.5 Data Protection, Security & Compliance

| ID | Item / Work Package Name | Category | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|---|
| **SEC-01** | "No Client Data Leaves Our Systems" Enforcement | Data Protection & Compliance | Operations Lead | Comprehensive data-flow mapping proving client credentials, project status, deliverable files, invoice records, and theming settings are stored and processed strictly within internal company systems. | Data Flow Architecture Diagram & signed Operations Compliance Review statement. | Operations Lead & CEO |
| **SEC-02** | 3-Year-Then-Delete Data Retention Automation | Data Protection & Compliance | Operations Lead / Technical Lead | Automated cron routine flagging and purging client records, logs, and deliverable archives precisely 36 months after contract close, logged in compliance register (`/knowledge/90-Operations/compliance-checklist.md`). | Script execution log, scheduled job configuration, database purge unit test record. | Operations Lead |
| **SEC-03** | Master Agreement & Terms Coverage Verification | Data Protection & Compliance | Operations Lead | 100% of onboarded active clients (all 14 active clients as of 1 Sep 2026) have an executed Master Agreement on file covering portal access, liability caps, and confidentiality (`/knowledge/90-Operations/legal-basics.md`). | Executed contract audit register cross-referenced with active client ledger. | Operations Lead |
| **SEC-04** | Backup Integrity & Disaster Recovery Run-Through | Data Protection & Compliance | Technical Lead | Daily automated encrypted database and asset backups stored in isolated local repository. Successful test recovery executed from backup archive to staging environment in < 30 minutes. | Backup recovery test log with timestamped restoration proof and database checksum match. | Operations Lead |

---

### 2.6 QA & Operational Readiness

| ID | Item / Work Package Name | Category | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|---|
| **QAR-01** | Full Link Integrity & Navigation Sweep | QA & Operational Readiness | QA Checker | Zero 404s, broken anchors, dead redirects, or external tracking beacon requests across all portal views, navigation menus, and downloadable asset links (`/knowledge/70-Delivery/qa-checklist.md`). | Automated crawler report (e.g. Broken Link Checker report) with 0 errors detected. | Delivery Lead |
| **QAR-02** | Numbers Ledger Verification & Financial Consistency | QA & Operational Readiness | QA Checker / Finance Lead | Every financial and client metric displayed in the portal reconciles exactly with `/knowledge/00-Meta/numbers-ledger.md` (e.g., $38,400 MRR, active client counts, retainer and project milestones). | Reconciliation audit sign-off sheet comparing portal display figures against ledger. | Finance Lead |
| **QAR-03** | Content, Typography & Copy Quality Pass | QA & Operational Readiness | QA Checker | Zero spelling, punctuation, or grammatical errors across all UI copy, error alerts, automated email templates, tooltips, and onboarding modals. | Completed QA content checklist signed by QA Checker. | Delivery Lead |
| **QAR-04** | Brand Visual Identity & Dynamic Accent Styling | QA & Operational Readiness | QA Checker | Strict compliance with Brand visual identity (`/knowledge/20-Brand/visual-identity.md`): base theme "Ink on Cream", typography strictly adhered to, exactly one custom accent color correctly applied per client tenant. | Visual QA inspection report across 5 distinct client tenant views with CSS color validation. | Delivery Lead |
| **QAR-05** | Three First Actions End-to-End User Flow Pass | QA & Operational Readiness | QA Checker | Flawless completion of the 3 fundamental actions: (1) Account activation & password setup, (2) Project status check, (3) Invoice inspection/payment, tested across desktop and mobile viewports. | End-to-end QA test execution matrix showing passes across Safari, Chrome, Firefox, iOS, Android. | Delivery Lead |

---

### 2.7 Documentation & Operational Runbooks

| ID | Item / Work Package Name | Category | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|---|
| **DOC-01** | Operations Support Runbook | Runbooks & Ops Procedures | Operations Lead | Detailed SOP addressing common client inquiries: password resets, asset download failures, invoice disputes, milestone updates, and access revocation. Step-by-step resolution paths documented. | Approved Operations Runbook document in `/work/operations-support-runbook.md`. | Operations Lead |
| **DOC-02** | Support Email Baseline & Triage SLA Setup | Runbooks & Ops Procedures | Operations Lead | Pre-launch support inquiry volume benchmark established from email inbox. Shared support queue configured with 1-hour first-response SLA for active portal clients ("clients first, within the hour"). | Baseline volume report, helpdesk/inbox routing configuration export, SLA rule confirmation. | Operations Lead |
| **DOC-03** | Technical Maintenance & Incident Escalation Runbook | Runbooks & Ops Procedures | Technical Lead | Technical recovery playbook documenting server restart procedures, database maintenance, deployment rollback steps, and emergency developer escalation contact chain. | Maintenance SOP filed in operational repo, reviewed and signed off by Technical Lead. | Operations Lead |

---

### 2.8 Client Communications, Onboarding & Training

| ID | Item / Work Package Name | Category | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|---|
| **COM-01** | Marketing Launch Announcement Email Draft | Client Comms & Onboarding | Marketing Lead | Launch email drafted per approved tone (`/knowledge/Agents Office/task-de60d80d-8b69-46cf-b374-3f930e376b34.md`), emphasizing finals-only files, internal data security, and instant access. | Final copy document with subject line variants, approved by Marketing Lead. | CEO |
| **COM-02** | Client Onboarding Guide Document | Client Comms & Onboarding | Marketing Lead | Production of "Your client portal: up and running in ten minutes", containing plain-language instructions, single-screen screenshots for the 3 first actions, and support contacts. | Final formatted PDF guide attached to launch pack. | CEO |
| **COM-03** | Internal Staff Training on Portal Administration | Client Comms & Onboarding | Delivery Lead | 45-minute recorded training session conducted for Delivery and Operations staff covering client provisioning, deliverable publishing, and ticket escalation. | Training attendance sheet, slide deck, and video recording link archived. | Operations Lead |

---

### 2.9 Final Handover Sign-Offs & Governance

| ID | Item / Work Package Name | Category | Specific Owner | What "Done" Looks Like (Measurable Criteria) | Verification / Evidence Required | Handover Recipient / Sign-off Authority |
|---|---|---|---|---|---|---|
| **GOV-01** | Interim Beta Gate Sign-off (3 Clients) | Governance & Sign-off | Operations Lead | Conditional gate approval for releasing the portal to 3 selected beta clients on 2026-10-31 upon verification of local hosting, finals-only rules, and absence of external data leaks. | Formally executed Beta Gate Approval Certificate signed by Operations Lead. | Program Manager |
| **GOV-02** | CEO Launch Communications Sign-off | Governance & Sign-off | CEO | Formal written approval from the CEO authorising the release of the Launch Announcement email and Onboarding Guide to all 14 active clients. | Signed CEO decision memo or approved task card sign-off. | Marketing Lead |
| **GOV-03** | Delivery-to-Operations Formal Handover Sign-off | Governance & Sign-off | Delivery Lead & Operations Lead | Joint sign-off confirming full transfer of system maintenance, support triage, and client administrative rights from the project build team to standing Operations. | Fully executed Handover Sign-Off Certificate signed by Delivery Lead and Operations Lead. | Program Manager |
| **GOV-04** | Day-7 Post-Launch Review & Adoption Check-in | Governance & Sign-off | Delivery Lead & Operations Lead | Post-launch assessment conducted on 2026-12-07 evaluating: client login uptake (targeting 80% / at least 12 of 14 active clients), support ticket metrics, and system defect logs. | Day-7 Post-Launch Evaluation Report published to `/work/`. | Program Manager & CEO |

---

## 3. Operational Acceptance & Sign-off Matrix

| Phase Gate | Mandatory Prerequisites | Handover Artifact / Proof Required | Approver / Authority | Gate Status |
|---|---|---|---|---|
| **Milestone 1: Scope Sign-Off (2026-09-30)** | Complete scope agreement, exclusions affirmed, client first actions confirmed, milestone timeline approved. | Scope & Design Sign-off Package (`/work/client-portal-launch/scope-and-design-signoff-package.pdf`). | Program Manager & CEO | Pending Sign-Off |
| **Milestone 2: QA Pass (2026-10-28)** | 100% test pass on links, numbers ledger trace, brand styling, finals-only checks, and 3 first actions. | QA Verification Test Matrix signed by QA Checker. | QA Checker & Delivery Lead | Queued for Build Freeze |
| **Milestone 3: Beta Gate (2026-10-31)** | Interim Operations clearance, 3 beta clients picked, consent wording live, in-portal payment isolated. | Executed Interim Beta Clearance Certificate. | Operations Lead | Conditional Approval |
| **Milestone 4: Launch Comms (2026-11-20)** | Launch announcement copy polished, onboarding guide completed, CEO quote confirmed. | Approved Marketing Launch Pack & PDF Onboarding Guide. | CEO & Marketing Lead | Scheduled |
| **Milestone 5: Full Handover (2026-11-30)** | Full data protection sign-off, support runbook in place, staff training completed, 14 active clients provisioned. | Delivery-to-Operations Formal Handover Certificate. | Operations Lead & Delivery Lead | Scheduled |
| **Milestone 6: Day-7 Review (2026-12-07)** | 7 days live operational data, login adoption tracking, support email ticket metrics vs baseline. | Day-7 Post-Launch Assessment Report. | Program Manager & Operations Lead | Scheduled |

---

## 4. Material Assumptions, Missing Inputs & CEO Decisions

### 4.1 CEO Decisions Required
1. **Confirmation of Payment Provider & Existing Rails**:
   - *Status*: Open CEO decision.
   - *Detail*: Finance confirmed (memo 2026-09-10) that no inbound client payment provider or gateway exists on record. The CEO must confirm whether an unrecorded payment merchant account exists or formally confirm that existing client payments arrive strictly via bank transfer (BACS/wire).
2. **In-Portal Payment Scope & Vendor Authorization**:
   - *Status*: Open CEO decision.
   - *Detail*: The CEO must decide whether in-portal automated payment remains in scope for general launch (2026-11-30) or is deferred to Phase 2. If kept in scope, the CEO must approve the provider procurement route and authorize associated platform/transaction spend.
3. **Data-Protection Definition of Hosting Infrastructure**:
   - *Status*: Open CEO & Legal Counsel decision.
   - *Detail*: Operations requires an executive and legal ruling on whether data resident on our third-party hosting server (per `/knowledge/50-Emails/vendor-list.md`, renewing March) complies with the charter constraint *"no client data leaves our systems"*. If the hosting contract is silent on data processing, counsel review is required.
4. **Marketing Launch Communications & Quote Sign-off**:
   - *Status*: Open CEO approval (due 2026-11-20).
   - *Detail*: Approval of the final Launch Announcement text, onboarding guide, and confirmation of the placeholder CEO quote (`"We built Growth for owners who do not have time to run marketing..."` / portal equivalent).

### 4.2 Material Assumptions
1. **Active Client Baseline**:
   - *Source*: `/knowledge/00-Meta/numbers-ledger.md` (as of 1 Sep 2026).
   - *Assumption*: Active client roster is exactly 14 clients, representing $38,400 MRR. The 80% 30-day login target therefore requires at least 12 individual client organizations successfully activated.
2. **Support Volume Baseline**:
   - *Source*: Delivery build plan assumption (`/knowledge/Agents Office/task-de60d80d-8b69-46cf-b374-3f930e376b34.md`).
   - *Assumption*: Operations maintains a measurable pre-launch baseline of status and invoice inquiry email volume in the primary support inbox, against which the "halving" target will be evaluated during the Day-7 review.
3. **Beta Client Selection Criteria**:
   - *Source*: Delivery proposed build plan.
   - *Assumption*: The 3 beta clients selected at Kickoff will comprise: (1) one retainer client (testing the 1st-of-month invoice cycle), (2) one project client (testing 50/50 invoicing), and (3) one asset-heavy client (testing high-volume deliverable downloads).

### 4.3 Missing Inputs & Inter-Team Dependencies
1. **Bank Feed Arrival Rail Documentation**:
   - *Owner*: Finance Lead.
   - *Required Input*: Direct access to live bank-feed records to document and verify how incoming client invoice payments clear today, closing Step 4 of the Finance reconciliation memo.
2. **Form Consent Copy Finalization**:
   - *Owner*: Marketing Lead & Operations Lead.
   - *Required Input*: Agreed legal consent wording for the first-time activation form, required before the 2026-10-31 beta release rather than waiting for the 2026-11-20 onboarding guide launch.
3. **Per-Client Accent Styling Palette**:
   - *Owner*: Delivery / Design Team.
   - *Required Input*: Confirmed single accent color code (HEX/RGB) for all 14 active clients, required before the build freeze on 2026-10-23.