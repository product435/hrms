# Database Architecture

> Part of the As-Built Discovery documentation set. See `MASTER_AS_BUILT_PRD.md` for the full index.

## Overview

The entire backend is Postgres via Supabase. There is no separate custom API server — the frontend talks to Postgres directly through the Supabase JS client, with **Row-Level Security (RLS) policies and Postgres functions carrying most of the real business logic**, not just the frontend. 117 migration files exist, named `YYYYMMDDHHMMSS_description.sql`, strictly chronological, generally one logical change per file (standard Supabase CLI convention).

## The "written to disk only" convention — critical for reading this entire documentation set correctly

Many migration files are drafted and **committed to the repository without being applied to the live database**. Each such file carries an explicit header: *"This file is written to disk only. It is NOT executed, pushed, or applied... run it yourself after reviewing it."*

**Confirmed by direct sampling** (10 files spanning the full project timeline): **zero** of the 6 sampled files from `20260818` through `20261112` carry this marker; **all 4** sampled files from `20261125` onward do. This means:
- The convention is **real and consistently followed** — but only for roughly the last few days of this project's history.
- For a file older than ~`20261125`, the *absence* of the marker is simply because the convention didn't exist yet when it was written — it does **not** by itself prove the file is live; it means "this file predates the convention," and live-status for an old file has to be inferred by checking whether a *later* file redefines the same object without that marker.
- For any file from `20261125` onward, the marker's presence or absence is a direct, reliable statement of intent.

**There is no `schema_migrations`/`supabase_migrations` tracking table visible anywhere in these files** — that bookkeeping is handled by the Supabase CLI itself, outside the repository. This means **live-applied status for any specific migration genuinely cannot be determined by reading the repository alone** — it requires either the "written to disk only" marker (for recent files) or a direct query against the live database.

### Confirmed, currently-unapplied drafts (as of this documentation pass)

| Draft file | Would change | Live version instead |
|---|---|---|
| `20261126050000_attendance_fixed_10am_rules.sql` (+ two earlier attempts) | Fixed 10:00/10:15/18:30 IST attendance rule | Shift-relative grace (`20260928130001_shift_assignment.sql` + `20260926000003_attendance_rules.sql`) |
| `20261126070000_leave_decision_access_rules.sql` | GM-inclusive leave decision authority | `can_manage_employee()`-gated decide (`20260926120003_leave_integrity.sql`) |
| `20261124052022`, `20261125055945`, `20261126060000_dwr_today_only_8pm_rules.sql` | Today-only submission + 8PM late threshold for DWRs | Anti-AI-guard version (`20261003130000_dwr_anti_ai_guard.sql`) |
| `20261126080000_general_manager_keeps_team_lead_abilities.sql` | GM team-scoped KPI calculation, project creation, DWR review, employee-insert | Base rules without the GM branch (`20260926000005_kra_kpi.sql` for KPI) |
| `20261125110000_projects_team_department_visibility.sql` | Team/department-scoped project visibility for leads | Unscoped `is_lead()` (org-wide visibility for any lead) — live in `20261001110000_projects_module.sql` |
| `20261125120000_drop_legacy_leave_goals_update_policies.sql` | Removes a legacy direct-update bypass on `leave_requests`/`goals` | The legacy policy may still be live (unconfirmed without a direct DB check) |
| `crm_sales_targets` table migration | Sales target tracking for Forecasting | Feature shows "Not configured" everywhere |

This table is a snapshot from this documentation pass — always re-check the marker on the actual file before relying on this list for a decision.

## Storage

- **Confirmed bucket**: `documents` (private) — defined and policy-governed starting `20260821000003_employee_documents_storage.sql`, with further access-policy migrations layered on (`20260822000012_hr_documents_storage_access.sql`, `20260828000002_manager_documents_access.sql`). Used by both the Documents module and Payroll's payslip PDF storage.
- No other storage bucket was confirmed in this pass.

## Edge Functions (6, confirmed complete — matches `supabase/functions/` directory exactly)

| Function | Purpose |
|---|---|
| `admin-set-employee-password` | Lets a Super Admin set/create another employee's Supabase Auth password directly. |
| `analyze-dwr` | OpenAI GPT-based narrative analysis over daily work reports. |
| `exotel-call-token` | Mints a short-lived, per-user Exotel calling token server-side so raw account credentials never reach the browser. |
| `forecast-ai-insights` | Gemini-based Risk/Opportunity/Recommendation notes over an already-computed CRM forecast summary — never touches the database itself, confirmed from its own header comment and from direct testing earlier this session. |
| `whatsapp-send` | Sends a WhatsApp Business Cloud API message, records the result in `crm_whatsapp_messages`; the provider token never reaches the browser. |
| `whatsapp-webhook` | Receives Meta's inbound WhatsApp events/status updates — the one function with no signed-in user, since Meta calls it directly. |

## Table-to-module mapping (confirmed tables, by module)

| Module | Core tables |
|---|---|
| Identity/Org | `profiles`, `employees`, `departments`, `designations`, `roles`, `organizations` |
| Onboarding | `onboarding_submissions`, `onboarding_records`, `onboarding_tasks` |
| Audit | `audit_logs` |
| Attendance | `attendance_records`, `attendance_corrections`, `shifts`, `employee_shifts`, `holidays` |
| Leave | `leave_requests`, `leave_types`, `leave_ledger` |
| Work/DWR | `daily_work_reports`, `dwr_items`, `team_daily_summaries`, `tasks` (shared with Projects) |
| Goals/KRA/KPI | `goals`, `kra_templates`, `kpi_definitions` (inferred name), `kpi_scores` (inferred name) |
| Performance | `performance_reviews` (inferred name), review-cycle tables |
| Projects | `projects`, `project_members`, `tasks`, `project_messages` |
| Assets | `assets`, `asset_assignments`, `asset_repairs`, `asset_requests` |
| Expenses | `expense_claims` |
| Helpdesk | `helpdesk_tickets` |
| Documents | `documents` + `documents` storage bucket |
| Recruitment | `job_openings`, `candidates`, `job_applications` |
| Payroll | `salary_structures`, `payroll_runs`, `payroll_records`, `payslips` |
| Announcements | `announcements`, `announcement_reads` |
| Notifications | `notifications` |
| CRM | `crm_leads`, `crm_accounts`, `crm_contacts`, `crm_deals`, `crm_activities`, `crm_import_batches`, `crm_call_logs`, `crm_whatsapp_conversations`, `crm_whatsapp_messages`, `crm_sales_targets` (table defined only in an unapplied draft) |

Table names marked "inferred" were not independently matched against their exact `create table` DDL in this documentation pass — treat as probable, not certain, until directly confirmed.

## Key cross-cutting Postgres functions

| Function | Role |
|---|---|
| `current_user_role()`, `current_employee_id()`, `current_org_id()` | Session-context primitives every RLS policy and business-logic function is built on. |
| `can_view_employee(emp_id)` / `can_manage_employee(emp_id)` | The general-purpose HR visibility/management scope check, reused across attendance, leave, goals, expenses, helpdesk, performance, documents. |
| `has_crm_access()` / `crm_can_write()` / `crm_can_manage_all()` / `is_sales_member()` | The CRM-specific equivalent, independent of the general HR scope functions. |
| `handle_new_user()` | Postgres trigger on `auth.users` insert; the real signup pipeline (see `BUSINESS_WORKFLOWS.md`). Redefined 7 times across the project's history; latest confirmed live version is `20260926120000_auth_security.sql`. |
| `log_audit_event()` | The audit-logging RPC; redefined at least twice. |
| `crm_before_write()` | A trigger (not a plain function) enforcing organization/owner consistency and deal-stage-derived field logic (probability, `closed_at`) on every CRM table write, regardless of what the client sends — confirmed by direct testing this session. |

## Known schema inconsistencies / technical debt (DB-level)

- **Multiple redefinitions of the same RLS policy name** (e.g. `employees_manager_insert_team`, `documents_manager_view_team`) across several migration files — the live definition is always whichever one actually applied *last*, but that is not always the most recent file in the repository if a later file is itself an unapplied draft. Several such cases are flagged throughout this documentation set rather than resolved blindly.
- **Two competing onboarding-schema migrations** (`20260926000002` and `20261003120000`) both define overlapping notification-trigger logic for the same conceptual events — which one is actually live was not resolved in this pass.
- **No shared `fail()` error-handling helper** — at least 4 service files (`crmService.ts`, `kraService.ts`, `onboardingService.ts`, `roleService.ts`) each define their own near-identical local `fail(error)` function rather than importing one from a shared module.
- **`helpdesk_tickets.status`** has no confirmed database check-constraint limiting it to a fixed set of values.
- A handful of migration files outside the `supabase/migrations/` convention exist at the repository root (`final_fix.sql`, `final_fix_4.sql`, `final_fix_5.sql`, `final_fix_7.sql`, `fix_import_owner.sql`, `combined_import_migration.sql`, `cleanup_leads.sql`) — their naming pattern suggests ad hoc hot-patching outside the normal migration convention at some point in the project's history. Whether any of these were actually run against production is unconfirmed and should be asked about directly rather than assumed either way.
