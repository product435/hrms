# Security Audit

> Part of the As-Built Discovery documentation set. See `MASTER_AS_BUILT_PRD.md` for the full index. This is a read-only, code-level audit plus the results of actual execution testing performed earlier this session against a disposable local Postgres instance (not the live database) — each finding states which kind of verification backs it.

## Critical

### C1. Settings → Beta tab is a live, real, destructive full-data-reset tool
**File**: `src/routes/settings.tsx`, `src/components/settings/BetaTab.tsx`. Confirmed as a genuinely implemented capability (not a stub) that wipes attendance, DWRs/tasks, projects, leave, notifications, expenses/helpdesk/complaints, goals/performance/KPI/KRA, asset assignments, employee documents, and onboarding/recruitment/payslips/unapproved payroll. Gating confirmed only at the frontend level (admin-only tab, typed-confirmation text) — the actual RPC/RLS-level enforcement was **not independently traced to confirm the database itself also restricts who can invoke it**, versus relying entirely on the UI never exposing the action to anyone else. **Recommendation**: confirm the underlying RPC independently checks `is_admin()` (or equivalent) before executing, not just the frontend's role gate. If it does not, this is a path to accidental or malicious total data loss by anyone who can reach the RPC directly (e.g. via browser dev tools against the Supabase client).

### C2. Multiple role-escalation-adjacent RLS policies have been redefined several times, with unclear "which one is live" status
Confirmed across this entire documentation effort: `employees_manager_insert_team`, `documents_manager_view_team`, `approve_employee_onboarding()`, and others have 2-4 competing definitions across different migration files, with live-vs-draft status resolved by the "written to disk only" marker **only for the subset of files from `20261125` onward**. For older, competing redefinitions, which one actually won in the live database **cannot be determined from the repository alone**. This is a process risk, not a confirmed live vulnerability — but it means a well-intentioned fix could already have been silently superseded by an older file that re-ran later, or vice versa. **Recommendation**: a direct database introspection pass (e.g. `pg_policies`, `pg_get_functiondef`) to record the actual live definition of every security-relevant policy/function, as a one-time baseline, before trusting any further code-only reasoning about "which version is live."

## High

### H1. CRM: a plain sales rep can read every lead in their sales team, not just their own
**Verified by actual execution** (direct SQL queries against a disposable local Postgres with real RLS enabled, this session): `has_crm_access()` grants org-wide-within-sales-team **read** to any sales-department member regardless of role — only *write*/reassignment is owner-or-manage-all scoped. This may be entirely intentional (shared pipeline visibility is normal for sales teams) but is flagged because the task's own role language ("Sales Employee: access authorized assigned leads") could reasonably be read as "only their own." **Recommendation**: confirm with the business owner whether this is the intended design; if not, `has_crm_access()`'s read scope would need to become owner-or-manage-all too, which is a bigger, more disruptive change than anything already shipped this session.

### H2. Documents: a lead can view but not edit a team member's document metadata through RLS
**File/policy**: `documents_manager_view_team` is select-only; no corresponding manager-update policy was found. This is probably intentional (editing someone else's document record is unusual), but it's an asymmetry worth confirming deliberately rather than assuming.

### H3. Audit logging coverage gap — most modules' real actions are not recorded
**Confirmed by direct grep**: only 8 of roughly 22 service files call `logAudit()` — `api.ts, assetService.ts, authService.ts, employeeService.ts, leaveService.ts, payrollService.ts, talentService.ts, workplaceService.ts`. CRM, attendance, goals, KRA, projects, and others have no confirmed client-side audit call. If no database trigger independently logs these actions either (not separately checked for every table), then deleting a CRM lead, approving a KPI score, or changing a project's membership would leave **no audit trail at all**, which is a real traceability/forensics gap, not just a nice-to-have. **Recommendation**: either extend `logAudit()` calls to the uncovered services, or confirm (and document) which tables already have DB-trigger-based logging instead.

### H4. Projects: any dept_head/team_lead sees every project in the organization, not just their own team/department
**Confirmed live** (the fix is drafted but unapplied — see `DATABASE_ARCHITECTURE.md`). This is a real, currently-live over-broad-visibility issue, distinct from the CRM module's similar (and already-fixed-and-tested, in CRM's case) pattern. A plain employee's visibility is correctly scoped (own + member-of); only the lead-role branch is unscoped.

## Medium

### M1. Payroll/salary RLS not independently confirmed at the database level
`requireAdminOrHr()` is a service-layer check (an RPC call checking the current role), confirmed real — but whether `payroll_records`/`salary_structures`/`payslips` also have their own RLS policies that would block a plain employee from reading another employee's salary data **by querying the tables directly, bypassing the service**, was not independently verified in this pass. Given these are among the most sensitive tables in the whole system, this should be the first thing directly checked.

### M2. PF/Tax fields are hardcoded to zero, not calculated
Not a security issue per se, but a **data-integrity and compliance risk**: `startRun()` writes `pf: 0, tax: 0` unconditionally. If any part of the business or a statutory authority expects accurate payslip withholding figures, every payslip generated by this system to date is incorrect by omission. See `PENDING_WORK_AND_ROADMAP.md`, P1.

### M3. Leave: a legacy direct-update bypass may still be live
The migration intended to remove it (`20261125120000_drop_legacy_leave_goals_update_policies.sql`) is itself unapplied. If the legacy policy it targets is still live, it may allow a leave/goals update path that bypasses `decide_leave_request()`'s extra business rules (rejection-reason requirement, rejected-can-never-become-approved). Needs a direct DB check.

### M4. Two competing onboarding-schema migrations with overlapping notification logic
Not a security issue, but a correctness one with user-visible impact: whichever of `20260926000002`/`20261003120000` is not actually live would mean certain onboarding-related notifications silently never fire. Not resolved in this pass.

## Low

### L1. `fail()` error-handling helper duplicated across at least 4 service files
Pure maintainability risk — a fix applied to one copy (e.g. to avoid leaking a raw database error message) would not automatically apply to the others.

### L2. Loose, non-standard migration files at the repository root
`final_fix.sql`, `final_fix_4.sql`, `final_fix_5.sql`, `final_fix_7.sql`, `fix_import_owner.sql`, `combined_import_migration.sql`, `cleanup_leads.sql` exist outside `supabase/migrations/`. Their execution history against production is unconfirmed. Not itself a vulnerability, but a process-hygiene concern — ad hoc SQL files outside the normal migration pipeline are easy to lose track of.

### L3. No automated test run (CI) for the existing Playwright RLS/role test suite
A real `supabase-rls.spec.ts` and `auth-roles.spec.ts` exist (404 and 302 lines respectively) that would directly exercise exactly the kind of role-boundary questions raised throughout this audit — but there's no confirmed evidence they're ever actually run. If they were run regularly, several of this audit's "cannot verify statically" items could instead be confirmed facts. See `QA_AND_TEST_COVERAGE.md`.

## What was verified by actual execution (not just code reading) this session

- CRM six-role RLS boundaries: direct-table-query tests proving a rep's write on another rep's lead affects 0 rows; a non-sales employee and HR get zero CRM access by direct query; cross-organization isolation holds (an admin of a different org sees/can-delete nothing).
- CRM import: the previously-live cross-uploader deletion bug (re-importing could delete a *different* rep's leads) was reproduced, confirmed, fixed, and the fix proven by execution (two reps importing sequentially, second rep's re-import leaves the first rep's data untouched).
- CRM lead-conversion duplicate-account/contact bug: reproduced, fixed, and proven by execution (two leads from the same company converting to one shared account, not two).
- The two-mode import's authorization check (a rep enriching a lead they don't own is rejected) was proven by execution, specifically because the enrichment RPC is `security definer` and would otherwise silently bypass the normal ownership rule — this was a real gap found and closed during implementation, not a pre-existing one found by audit.

Everything else in this document is a **code-level finding**, not independently re-verified by running it against a live or disposable database, unless explicitly stated otherwise above.
