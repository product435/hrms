# Complete Module Inventory

> Part of the As-Built Discovery documentation set. See `MASTER_AS_BUILT_PRD.md` for the full index. Feature-level status and workflow detail live in `DETAILED_MODULE_PRD.md` and `BUSINESS_WORKFLOWS.md` — this file is the map of what exists.

Legend for implementation status used throughout: **Implemented** (code-verified, working as designed) · **Partial** (real but incomplete/has a known gap) · **UI-only** (frontend exists, backend missing/stub) · **Stub** (minimal/placeholder) · **Cannot verify statically** (needs a live DB/runtime check).

## 1. Identity, Organization & Onboarding

| Module | Route(s) | Status | Notes |
|---|---|---|---|
| Employees | `src/routes/employees.index.tsx`, `employees.$employeeId.tsx` | Implemented | Directory + 8-tab detail page: Personal, Employment, Attendance, Leave, Assets, Documents, Performance, Complaints. No hard delete — exit is a status change. |
| Departments | `src/routes/departments.tsx` | Implemented (edit/delete path unverified) | Carries the `is_sales` flag the CRM module depends on. |
| Designations | `src/routes/designations.tsx` | Implemented (edit/delete path unverified) | |
| Roles (role/placement/dept-head assignment) | `src/routes/roles.tsx` | Implemented | One screen combines three RPCs (`set_employee_role`, `set_employee_placement`, `set_department_head`). |
| Onboarding review | `src/routes/onboarding.tsx` | Implemented | Approve / request-changes / reject against `onboarding_submissions`. |
| Complete Profile (self-service) | `src/routes/complete-profile.tsx` | Implemented | Not traced field-by-field. |
| Profile Status | `src/routes/profile-status.tsx` | Implemented | Shown when onboarding is rejected or pending. |
| Org Overview dashboard | `src/routes/org-overview.tsx` | Implemented | 3 tabs: People & KPIs, Departments, Work reports. |
| Settings | `src/routes/settings.tsx` | Implemented, one high-risk feature | 4 tabs incl. admin-only **Beta** tab — a real destructive full-data-reset tool. |
| Audit log viewer | `src/routes/audit.tsx` | Partial | Viewer works; **only 8 of ~22 services actually write audit entries** — most modules' actions are not logged. |

## 2. Time & Work

| Module | Route(s) | Status | Notes |
|---|---|---|---|
| Attendance | `src/routes/attendance.tsx` | Implemented, draft fix pending | Live rule is shift-relative grace, not the fixed-10AM rule drafted this session (unapplied). |
| Leave | `src/routes/leave.tsx` | Implemented, draft fix pending | Live decision check uses `can_manage_employee()`; a GM-inclusive replacement is drafted, unapplied. |
| Daily Work Reports (Work) | `src/routes/work.tsx` | Implemented, draft fix pending | Live submission rule differs from 3 newer, unapplied draft migrations. |
| Goals | `src/routes/goals.tsx` | Implemented | Self-edit + review RPCs confirmed real (`submit_goal_progress`, `update_own_goal`, `review_goal`). |
| KRA / KPI | `src/routes/kra.tsx` | Implemented, draft fix pending | `compute_kpi_scores()` GM-team-scoped branch is drafted, unapplied. |
| Performance Reviews | `src/routes/performance.tsx` | Implemented | Self + manager rating per review cycle; KRA shown as reference only, not auto-wired into the score. |

## 3. Operations

| Module | Route(s) | Status | Notes |
|---|---|---|---|
| Projects & Tasks | `src/routes/projects.index.tsx`, `projects.$projectId.tsx` | Implemented, one confirmed visibility gap | Any dept_head/team_lead sees every project org-wide today; a team/department-scoped fix is drafted, unapplied. Realtime project chat included. |
| Assets | `src/routes/assets.tsx` | Implemented | Two distinct flows: employee request vs. admin/HR physical-asset management. |
| Expenses | `src/routes/expenses.tsx` | Implemented | Status chain `pending → approved/rejected → reimbursed`. |
| Helpdesk | `src/routes/helpdesk.tsx` | Implemented, status vocabulary unconfirmed | No DB check-constraint found limiting ticket status values to a fixed set. |
| Documents | `src/routes/documents.tsx` | Implemented | Private storage bucket `documents`, signed URLs only, orphan-file cleanup on failed insert. |
| Recruitment | `src/routes/recruitment.tsx` | Implemented, non-trivial | 6-stage pipeline; a candidate's "stage" is derived from their latest job application, not a stored column. |

## 4. Money & Reporting

| Module | Route(s) | Status | Notes |
|---|---|---|---|
| Payroll | `src/routes/payroll.tsx` | Partial | Salary structures, runs, real PDF payslip generation all genuinely implemented — **but PF and Tax are hardcoded to 0, never calculated.** |
| Reports | `src/routes/reports.tsx` | Implemented | Aggregation dashboard, real CSV export; no PDF/Excel export. |
| Insights | (service: `insightsService.ts`) | Implemented | Real queries throughout — attrition, headcount trend, department distribution, leave mix; no mock data when configured. |
| Announcements | `src/routes/announcements.tsx` | Implemented | DB-enforced org/department/role targeting exclusivity; in-app only, no email/push. |
| Notifications | `src/routes/notifications.tsx` | Implemented | 17 real trigger sources confirmed across 9 migration files; in-app only. |

## 5. Sales CRM

| Module | Route(s) | Status | Notes |
|---|---|---|---|
| Leads | `src/routes/crm.tsx` (Leads tab) | Implemented | CRUD, search/filter, bulk actions, Hot/Warm/Cold quick-filter, two-mode Excel import (Initial / Update-Existing-Leads enrichment). |
| Deals | `src/routes/crm.tsx` (Deals tab) | Implemented | Board + list view, stage changes, lost-reason enforcement, probability auto-set server-side. |
| Accounts | `src/routes/crm.tsx` (Accounts tab) | Implemented | Duplicate-name warning on manual create. |
| Contacts | `src/routes/crm.tsx` (Contacts tab) | Implemented | Duplicate email/phone warning on manual create. |
| Activities | `src/routes/crm.tsx` (Activities tab) | Implemented | Call logging with real outcome-driven side effects (auto-unqualify on wrong number, auto-schedule follow-up), Today/Overdue/Upcoming buckets. |
| Overview dashboard | `src/routes/crm.tsx` (Overview tab) | Implemented | Date-range + salesperson filtered metrics. |
| Sales Forecasting | `src/routes/crm.tsx` (Forecasting tab) | Implemented | Monthly/quarterly/yearly periods, AI insights (Gemini) with honest fallback when unconfigured. Sales Targets feature exists in code but its backing table is an unapplied draft migration — not usable yet. |

## 6. Cross-Cutting / Platform

| Area | Status | Notes |
|---|---|---|
| Authentication (sign-in/up, forgot/reset password) | Implemented | Isomorphic (server + client) session resolution; route guards enforce onboarding-gate and role allowlists. |
| Role-based access control | Implemented, verify-each-fact | Six roles; every permission claim in this doc set is backed by either a frontend check or a DB policy/function citation — never both assumed from one. |
| Database (Postgres via Supabase) | Implemented | 117 migrations; RLS + triggers + Postgres functions carry most business logic, not just the frontend. |
| Edge Functions (6) | Implemented | `admin-set-employee-password`, `analyze-dwr`, `exotel-call-token`, `forecast-ai-insights`, `whatsapp-send`, `whatsapp-webhook`. |
| Testing | Partial | No unit tests; a real, substantial Playwright e2e suite exists but has no CI wiring and unconfirmed last-run status. |
