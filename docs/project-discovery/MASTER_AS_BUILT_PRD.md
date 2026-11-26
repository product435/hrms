# JeeVijay HRMS — Master As-Built PRD

This is the index and executive summary for a complete, read-only code-level discovery of the JeeVijay HRMS project. Every document below was produced by directly inspecting the actual source code, Supabase migrations, and configuration — not by assuming a feature exists because its name or UI screen exists. No application code was modified, no SQL was executed, and nothing was committed, pushed, or deployed to produce this documentation.

## Document index

1. [`PROJECT_OVERVIEW.md`](./PROJECT_OVERVIEW.md) — what this is, who it's for, the business problem it solves, in plain language.
2. [`COMPLETE_MODULE_INVENTORY.md`](./COMPLETE_MODULE_INVENTORY.md) — every module and its status at a glance.
3. [`DETAILED_MODULE_PRD.md`](./DETAILED_MODULE_PRD.md) — feature-level detail, file paths, RPCs, tables, for every module.
4. [`ROLE_PERMISSION_MATRIX.md`](./ROLE_PERMISSION_MATRIX.md) — who can do what, verified at both frontend and database level wherever possible.
5. [`DATABASE_ARCHITECTURE.md`](./DATABASE_ARCHITECTURE.md) — tables, RLS, functions, triggers, storage, edge functions, migration status.
6. [`TECHNICAL_ARCHITECTURE.md`](./TECHNICAL_ARCHITECTURE.md) — stack, auth flow, service layer, integrations, config.
7. [`BUSINESS_WORKFLOWS.md`](./BUSINESS_WORKFLOWS.md) — end-to-end workflows as they actually run today.
8. [`SECURITY_AUDIT.md`](./SECURITY_AUDIT.md) — findings classified Critical/High/Medium/Low.
9. [`QA_AND_TEST_COVERAGE.md`](./QA_AND_TEST_COVERAGE.md) — what testing exists, what doesn't, what was and wasn't verified.
10. [`PENDING_WORK_AND_ROADMAP.md`](./PENDING_WORK_AND_ROADMAP.md) — the consolidated, prioritized backlog.

*(This file, `MASTER_AS_BUILT_PRD.md`, is the 11th deliverable — the index itself.)*

## How this documentation was produced

Given the scale of this project (38 routes, 117 database migrations, 22 service files, 6 edge functions), this discovery was performed as a series of focused, parallel research passes, one per module cluster (Identity/Org/Onboarding; Time & Work; Operations; Money & Reporting; Cross-cutting Technical/Auth/DB Architecture), each independently verifying its area directly against the source code before reporting findings — followed by a synthesis pass (this set of 11 documents) and two direct follow-up checks to close specific gaps the research passes themselves flagged (the exact live `handle_new_user()` signup-trigger behavior, and the exact storage bucket name). The CRM module was documented from this same session's own prior, hands-on implementation and testing work, not a separate research pass, since it was already verified in depth.

## A critical fact that applies to nearly every document in this set

Many database migration files in this project are **written and committed to the repository without being applied to the live database**. Each such file carries an explicit header comment stating this. This convention is real and consistently followed, but only for roughly the last few days of the project's migration history — for older files, its absence doesn't prove anything either way. **Every claim in this documentation set about "what the system currently does" distinguishes three separate facts**: what the code/migration file says, whether that specific file is confirmed applied or confirmed still a draft, and whether the actual live-database behavior has been independently verified by running something against it. See `DATABASE_ARCHITECTURE.md` for the full explanation and a table of currently-known unapplied drafts.

---

## Executive Summary

### 1. What exactly is this HRMS project?
A complete internal company system covering the full employee lifecycle (hire to exit), day-to-day HR operations (attendance, leave, daily work reports, goals, performance, payroll), back-office support (assets, expenses, helpdesk, documents, recruitment), and a separate Sales CRM — all sharing one login, one employee directory, and one role model. It runs on Supabase (Postgres) with most of the real business rules enforced inside the database itself, not just the website.

### 2. How many modules and submodules exist?
Roughly **26 distinct business modules** across 5 clusters (Identity/Org/Onboarding — 10 areas; Time & Work — 6; Operations — 6; Money & Reporting — 5; Sales CRM — 7 tabs within one module), plus the cross-cutting authentication/security/database layer underneath all of them.

### 3. What does each module do?
See `COMPLETE_MODULE_INVENTORY.md` for the one-line summary of every module, and `DETAILED_MODULE_PRD.md` for the full detail.

### 4. Which features are fully implemented?
The large majority. Employee directory, onboarding, departments/roles, attendance, leave, daily work reports, goals, KRA/KPI, performance reviews, projects/tasks, assets, expenses, helpdesk, documents, recruitment, payroll (with one real gap, see below), reports, insights, announcements, notifications, and the entire Sales CRM are all genuinely built and working, verified by direct code reading (and, for the CRM module specifically, by actual execution testing).

### 5. Which features are partially implemented?
- **Payroll**: fully functional for salary structures, payroll runs, approval, and real PDF payslip generation — but **PF and Tax are hardcoded to zero**, with no statutory calculation anywhere in the system.
- **Audit logging**: the viewer works, but only about a third of the system's services actually write audit entries — most modules' real actions leave no trace in the Activity History screen today.
- **Sales Targets** (CRM Forecasting): the UI and logic exist, but the backing database table is only a drafted, unapplied migration — so it shows "Not configured" for everyone right now.
- Several **business-rule changes have been fully designed and written** (fixed-clock attendance rules, GM-inclusive leave decisions, 8PM DWR threshold, GM-scoped KPI calculation, project team/department visibility) but are sitting as reviewed, unapplied database migrations — the live system still runs the **older** version of each of these rules today.

### 6. Which features are broken or missing?
Nothing was found to be outright broken in normal use. The closest things to a real functional gap:
- A DWR-submission checkout gate (`assertCheckoutAllowed`) exists in the code but is **never actually called** from the check-out flow — it's dead code, so check-out is not gated by DWR status today, regardless of what any comment elsewhere claims.
- Any department head or team lead can currently see **every** project in the organization, not just their own team's — a scoped fix is already written and waiting for approval.
- Helpdesk ticket statuses have no database-level restriction on allowed values.

### 7. What is the current database and security status?
The database is substantial (117 migrations) and its access-control model (Row-Level Security plus a consistent set of "can this person view/manage this employee's records" functions) is genuinely well-structured and, in the Sales CRM module specifically, has been **directly verified by execution** to correctly isolate different users, roles, and organizations from each other. The single highest-risk item found is a **real, live, destructive full-data-reset tool** in Settings whose database-level authorization enforcement was not independently confirmed in this pass — see `SECURITY_AUDIT.md`, item C1, which should be checked first before anything else. A second structural risk is that several security-relevant database policies have been redefined multiple times across the project's history in a way that makes "which version is actually live" genuinely unknowable from the repository alone for anything older than the last few days of history.

### 8. What is pending before the HRMS is office-ready?
In rough order: (1) confirm the Beta reset tool's real authorization boundary; (2) establish a verified baseline of which database policies are actually live, since so much of the recent work exists only as unapplied drafts; (3) decide, module by module, whether to apply the already-written attendance/leave/DWR/KPI/projects/CRM-targets fixes; (4) decide whether real statutory payroll withholding (PF/Tax) is required before this goes live for actual paychecks; (5) close the audit-logging coverage gap if traceability across all modules matters to the business.

### 9. What are the top 10 priorities?
See `PENDING_WORK_AND_ROADMAP.md` for the full, evidence-backed, prioritized list (P0–P3). The top items are: confirm the Beta tool's real access control; establish the live-policy baseline; apply (or explicitly decide against) the attendance/leave/DWR/KPI rule drafts; fix the projects visibility gap; decide on PF/Tax calculation; close the audit-logging gap; enable CRM Sales Targets; resolve the duplicate onboarding-notification migrations; verify payroll/salary RLS independently; and wire the existing (currently unused) end-to-end test suite into an actual CI pipeline.

### 10. What should be developed or fixed next?
Start with the two P0 items — they're pure verification, not new development, and they de-risk every decision after them. Then work through the already-written, already-reviewed database migrations (the attendance, leave, DWR, KRA/KPI, projects-visibility, and CRM-targets drafts) one at a time, applying each only after confirming it still matches current intent. Only after that baseline is solid does it make sense to scope genuinely new work, such as real statutory payroll calculation or extending audit logging — both of which are real gaps, but neither of which should be built on top of an unverified foundation.
