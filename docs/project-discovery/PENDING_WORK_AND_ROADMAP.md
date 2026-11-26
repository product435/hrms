# Pending Work and Roadmap

> Part of the As-Built Discovery documentation set. See `MASTER_AS_BUILT_PRD.md` for the full index. Priority: P0 = critical/security/data-loss/blocking, P1 = essential business workflows, P2 = important functional improvements, P3 = enhancements/optimization.

## P0 — Critical

### P0-1. Confirm the Beta destructive-reset tool's actual authorization enforcement
**Module**: Settings. **File**: `src/components/settings/BetaTab.tsx`. **Evidence**: `SECURITY_AUDIT.md` C1. **Impact**: if the underlying RPC doesn't independently enforce admin-only access (relying solely on the frontend tab being hidden), this is a path to total, irreversible data loss across nearly every module. **Dependency**: none — this should be checked first, before anything else on this list. **DB change required**: possibly, if the RPC needs a server-side role check added.

### P0-2. Establish a verified baseline of which RLS policies/RPCs are actually live
**Evidence**: `DATABASE_ARCHITECTURE.md`, `SECURITY_AUDIT.md` C2. **Impact**: without this, every future change to a multiply-redefined policy risks silently reverting a prior fix or duplicating dead logic. **Recommended action**: a one-time direct database introspection (`pg_policies`, `pg_get_functiondef`) recorded against this documentation set's table of "confirmed unapplied drafts." **DB change required**: no — this is read-only investigation, not a fix.

## P1 — Essential business workflows

### P1-1. Apply (or explicitly decide not to apply) the attendance, leave, DWR, and KPI rule-change drafts
**Evidence**: `DATABASE_ARCHITECTURE.md`'s unapplied-drafts table. **Affected modules**: Attendance, Leave, Work/DWR, KRA/KPI. **Impact**: the business rules currently described as "the intended design" in several places across the organization may not match what the live system actually enforces today. **Recommended action**: review each drafted migration (all already written, reviewed earlier this session, and waiting only for explicit approval to run) and decide whether to apply, revise, or discard each one. **DB change required**: yes, for each one approved.

### P1-2. Resolve the projects visibility gap
**Evidence**: `SECURITY_AUDIT.md` H4, `BUSINESS_WORKFLOWS.md` §11. **Impact**: any dept_head/team_lead currently sees every project in the organization, not just their own. A fix is already drafted (`20261125110000_projects_team_department_visibility.sql`). **DB change required**: yes (apply the existing draft).

### P1-3. Decide on PF/Tax calculation for Payroll
**Evidence**: `SECURITY_AUDIT.md` M2, `DETAILED_MODULE_PRD.md` Payroll section. **Impact**: every payslip generated to date has `pf: 0, tax: 0` hardcoded — no statutory withholding calculation exists. If this is required for actual compliance, it's a real, business-blocking gap, not a cosmetic one. **Recommended action**: confirm with the business owner whether real PF/ESI/professional-tax calculation is needed, and if so, scope it as new work (a formula does not currently exist anywhere in the codebase to extend). **DB change required**: likely yes (new columns/logic), plus payslip template changes.

### P1-4. Close the audit-logging coverage gap
**Evidence**: `SECURITY_AUDIT.md` H3. **Impact**: most modules' real actions leave no audit trail today. **Recommended action**: extend `logAudit()` calls to the currently-uncovered services, or confirm/document which tables already have equivalent DB-trigger logging instead. **DB change required**: possibly (if trigger-based logging is the chosen approach for some tables).

### P1-5. Enable CRM Sales Targets
**Evidence**: `DETAILED_MODULE_PRD.md` CRM section. **Impact**: the Forecasting UI's target-vs-actual comparison shows "Not configured" for everyone because its backing table (`crm_sales_targets`) is only a drafted migration. **DB change required**: yes (apply the existing draft).

## P2 — Important functional improvements

### P2-1. Resolve which onboarding-schema migration is actually live
**Evidence**: `DETAILED_MODULE_PRD.md` Notifications section, `SECURITY_AUDIT.md` M4. **Impact**: whichever of `20260926000002`/`20261003120000` is not live means some onboarding-related notifications silently never fire. **DB change required**: no, just investigation — then possibly reconciling the two files into one clear source of truth.

### P2-2. Confirm/close the legacy leave/goals direct-update RLS bypass
**Evidence**: `SECURITY_AUDIT.md` M3. **Impact**: if still live, it may let a write bypass `decide_leave_request()`'s and `review_goal()`'s extra business rules (rejection reason required, rejected-can-never-become-approved, forced progress=100 on completion). **DB change required**: yes (apply the existing draft, `20261125120000_drop_legacy_leave_goals_update_policies.sql`, after confirming it's safe to do so).

### P2-3. Verify payroll/salary table RLS independently of the service-layer check
**Evidence**: `SECURITY_AUDIT.md` M1. **Impact**: `requireAdminOrHr()` is confirmed as a real service-layer gate, but whether the database itself would block a plain employee from reading another employee's salary directly (bypassing the app) is unconfirmed. **DB change required**: possibly, if a gap is found.

### P2-4. Add a manager-update RLS policy for Documents, or confirm the view-only asymmetry is intentional
**Evidence**: `SECURITY_AUDIT.md` H2. **DB change required**: possibly.

### P2-5. Add a DB-level check constraint for Helpdesk ticket status values
**Evidence**: `DETAILED_MODULE_PRD.md` Helpdesk section. **Impact**: low on its own, but any future bug in a dropdown's options list could introduce an unintended status value with no database-level objection. **DB change required**: yes, a new constraint.

## P3 — Enhancements and technical debt

### P3-1. Consolidate the duplicated `fail()` error-handling helper
**Evidence**: `TECHNICAL_ARCHITECTURE.md`, `SECURITY_AUDIT.md` L1. **Impact**: a fix to one copy (e.g. to avoid leaking a raw error message) doesn't automatically propagate to the others. **DB change required**: no.

### P3-2. Reconcile or remove the loose root-level SQL files
**Evidence**: `DATABASE_ARCHITECTURE.md`, `SECURITY_AUDIT.md` L2. Files: `final_fix.sql`, `final_fix_4.sql`, `final_fix_5.sql`, `final_fix_7.sql`, `fix_import_owner.sql`, `combined_import_migration.sql`, `cleanup_leads.sql`. **Impact**: process hygiene; unclear execution history against production. **DB change required**: no, just investigation and cleanup.

### P3-3. Wire the existing Playwright e2e suite into CI
**Evidence**: `QA_AND_TEST_COVERAGE.md`. **Impact**: would convert a large fraction of this entire documentation set's "cannot verify statically" items into confirmed, continuously-checked facts. **DB change required**: no.

### P3-4. Decide whether a CRM sales rep's org-wide-within-team read access matches the intended design
**Evidence**: `SECURITY_AUDIT.md` H1. **Impact**: not necessarily a bug, but worth a deliberate business decision rather than leaving it as an unexamined default. **DB change required**: possibly, if the answer is "no, it should be owner-scoped."

### P3-5. Add real PF/ESI/professional-tax calculation
See P1-3 — included here too since, if the answer to "is this required" is "not yet, but eventually," this is the long-term tracking item for it.

## Dependencies between items

- P1-1 (apply attendance/leave/DWR/KPI drafts) should happen **after** P0-2 (the live-policy baseline), so the team knows exactly what each draft would actually change relative to the true current state, not just relative to what the repository's file order suggests.
- P1-2 and P1-5 are standalone, already-reviewed drafts — no blocking dependency, can be applied independently once approved.
- P2-1 and P2-2 both benefit from P0-2's baseline for the same reason as P1-1.
