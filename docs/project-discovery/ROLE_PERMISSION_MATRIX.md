# Role & Permission Matrix

> Part of the As-Built Discovery documentation set. See `MASTER_AS_BUILT_PRD.md` for the full index.

## The role model

Six roles, stored as a single `profiles.role` text column (normalized by `normalizeRole()` in `src/lib/roles.ts`, which also maps the legacy value `"manager"` to `"team_lead"` — confirming a past rename that the normalization function still has to account for): `admin` (Super Admin), `general_manager`, `hr`, `dept_head`, `team_lead`, `employee`.

There is **no separate "Sales Head" role** — any role that is also a member of (or heads) a sales-flagged department gets CRM access; the business concept of "Sales Head" maps onto `dept_head`/`team_lead` plus sales-department membership, not a distinct role value.

Every row below cites either a frontend check (convenience, not security) or a database function/policy (actual enforcement) — never one assumed from the other. Where only a frontend check could be confirmed in this pass, it is marked **(frontend-only confirmed)**.

## Core access-scoping functions (the ones everything else is built on)

| Function | Definition (confirmed live, i.e. no "written to disk only" marker on its defining file, unless noted) | What it means |
|---|---|---|
| `current_user_role()` | reads `profiles.role` | the raw role string |
| `is_admin()` | `role = 'admin'` | |
| `is_admin_or_hr()` | `role in ('admin','hr')` | |
| `can_view_employee(emp_id)` | self, OR admin/hr (org-wide), OR the caller heads that employee's department, OR the caller is that employee's direct manager, OR (per `20261102100000_general_manager_role.sql`) the caller is `general_manager` (org-wide read) | who can **see** a given employee's records across most HR tables (attendance, leave, goals, expenses, helpdesk, performance, documents) |
| `can_manage_employee(emp_id)` | same as `can_view_employee`'s scoped (non-GM) branch, minus self, minus HR-over-admin/GM | who can **approve/edit** a given employee's records — **general_manager is deliberately excluded from org-wide write here**, confirmed by that migration's own header comment |
| `has_crm_access()` | `role in ('admin','general_manager')` OR `is_sales_member()` | CRM module read access |
| `crm_can_write()` | `role = 'admin'` OR `is_sales_member()` | CRM write access |
| `crm_can_manage_all()` | `admin`, OR (`is_sales_member()` AND role in `dept_head`/`team_lead`), OR heads a sales department | CRM team-wide manage (reassign/approve) |
| `is_sales_member()` | employee's own department has `is_sales = true`, OR the employee heads a department with `is_sales = true` | the actual CRM membership test — **role-independent** |

## Permission matrix by module

Legend: ✅ full · 🟡 own/team-scoped · ⚠️ confirmed gap/draft-only · ❌ none.

| Module | Admin | General Manager | HR | Dept Head | Team Lead | Employee |
|---|---|---|---|---|---|---|
| **Employees** (view) | ✅ org-wide | ✅ org-wide (`can_view_employee`) | ✅ org-wide | 🟡 own dept | 🟡 own reports | 🟡 self only |
| **Employees** (edit HR fields) | ✅ | ❌ (not in `canEditHrFields`, frontend-only confirmed) | ✅ | ❌ | ❌ | ❌ |
| **Employees** (change own employment status) | ❌ (blocked even for self) | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Departments/Designations** (read) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (org-wide, any authenticated user) |
| **Departments/Designations** (write) | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Role assignment** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Onboarding approval** | ✅ (frontend-only confirmed) | ❌ | ✅ | ❌ | ❌ | n/a (self-submits only) |
| **Attendance** (view) | ✅ | 🟡/✅ depends on `can_view_employee` reach | ✅ | 🟡 own dept | 🟡 own reports | 🟡 self |
| **Attendance** (approve corrections) | ✅ (frontend-only: `canReview`) | ❌ (not in `canReview` list, frontend-only confirmed) | ✅ | ✅ (via `isLead`) | ✅ (via `isLead`) | ❌ |
| **Leave** (decide) | ✅ (`can_manage_employee`) | ⚠️ **draft only, not live** — a GM-inclusive decision function exists but is unapplied; today GM's leave-decide rights are whatever `can_manage_employee` grants, which excludes org-wide GM write | ✅ | 🟡 own dept | 🟡 own reports | ❌ (never own request) |
| **Daily Work Reports** (review) | ✅ | 🟡/✅ via `can_manage_employee` reach | ✅ | 🟡 own dept | 🟡 own reports | ❌ |
| **Goals** (review) | ✅ | 🟡/✅ | ✅ | 🟡 own dept | 🟡 own reports | 🟡 self (progress/edit own goal only) |
| **KPI calculation** | ✅ org-wide | ⚠️ **draft only** — a team-scoped GM branch exists but is unapplied; live behavior for GM calculation not independently confirmed | ✅ org-wide | 🟡 | 🟡 | ❌ |
| **Performance reviews** | ✅ | 🟡/✅ | ✅ | 🟡 (as reviewer) | 🟡 (as reviewer) | 🟡 self-rating only |
| **Projects** (visibility) | ✅ org-wide | ✅ org-wide | ✅ org-wide | ⚠️ **confirmed live gap**: sees every project org-wide today via unscoped `is_lead()`, not just own dept | ⚠️ same gap, sees every project org-wide | 🟡 own + member-of |
| **Projects** (create) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Project tasks** (mark done) | ✅ (as manager) | ✅ (as manager) | ✅ (as manager) | ✅ (assignee or manager) | ✅ (assignee or manager) | 🟡 own assigned task only (DB-enforced) |
| **Assets** (request) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ self |
| **Assets** (manage/approve) | ✅ | ❌ (not independently confirmed as granted) | ✅ | ❌ (not independently confirmed) | ❌ (not independently confirmed) | ❌ |
| **Expenses** (approve) | ✅ | 🟡/✅ via `can_manage_employee` | ✅ | 🟡 own dept | 🟡 own reports | ❌ (never own) |
| **Helpdesk** (manage/assign) | ✅ (frontend: `canManage`) | ❌ (not in `canManage`, frontend-only confirmed) | ✅ | 🟡 own dept (via lead-select/update RLS) | 🟡 own reports | ❌ |
| **Documents** (view team's) | ✅ | 🟡/✅ via `can_view_employee` | ✅ | 🟡 view only — **no manager-update RLS confirmed**, so a lead cannot edit a team member's document metadata through RLS even though they can view it | 🟡 view only, same limitation | 🟡 self only |
| **Payroll** (manage) | ✅ (`requireAdminOrHr`) | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Payroll** (view own payslip) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Announcements** (post) | ✅ (DB-enforced `announcements_write_admin_hr`) | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Settings → Beta destructive reset** | ✅ (frontend-only confirmed — see `SECURITY_AUDIT.md`, Critical) | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Audit log viewer** | ✅ (assumed, not independently re-confirmed this pass) | — | ✅ (assumed) | — | — | — |
| **CRM — read** | ✅ org-wide (by role) | ✅ org-wide (by role, `has_crm_access`) | ❌ **zero access by default**, unless personally a sales-dept member | 🟡 only if sales-dept member | 🟡 only if sales-dept member | 🟡 only if sales-dept member (then org-wide-within-sales-team read, not owner-scoped — verified by direct-table-query testing) |
| **CRM — write/reassign** | ✅ org-wide | 🟡 only if personally a sales member (not via the `general_manager` role branch — `crm_can_manage_all()` explicitly excludes GM unless they separately qualify) | ❌ unless sales member | 🟡 if sales member (manage-all within team) | 🟡 if sales member (manage-all within team) | 🟡 own records only (verified: a rep's write attempt on another rep's record affects 0 rows, confirmed by direct RLS testing) |
| **CRM — import leads** | ✅ | 🟡 if sales member | ❌ unless sales member | 🟡 if sales member | 🟡 if sales member | 🟡 if sales member |

## Notes on verification depth

- Rows marked **"frontend-only confirmed"** mean a UI-level role check was read directly, but the corresponding database RLS policy or security-definer function was not independently re-verified in this pass to confirm it enforces the identical boundary. Per this project's own established pattern (confirmed repeatedly elsewhere, e.g. CRM), a frontend gate and a DB policy can and sometimes do diverge — never assume one from the other without checking both.
- The CRM row is the one section of this matrix **verified by actual execution** (direct SQL queries against a disposable local Postgres instance with real RLS enabled, run earlier this session), not just by reading policy text — see `SECURITY_AUDIT.md` for the specific test results.
- Several draft-only items (GM leave-decide, GM KPI-calculation scoping, project team/department visibility) have real, reviewed fix migrations already written and waiting for approval — see `PENDING_WORK_AND_ROADMAP.md`.
