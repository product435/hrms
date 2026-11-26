# Detailed Module PRD

> Part of the As-Built Discovery documentation set. See `MASTER_AS_BUILT_PRD.md` for the full index. Status legend: see `COMPLETE_MODULE_INVENTORY.md`.

## Identity, Organization & Onboarding

### Employees
**Files**: `src/routes/employees.index.tsx` (directory), `src/routes/employees.$employeeId.tsx` (884 lines, 8-tab detail page: Personal, Employment, Attendance, Leave, Assets, Documents, Performance, Complaints), `src/services/employeeService.ts` (574 lines).
- **CRUD**: `create()` / `update()` confirmed; **no `delete()`** — termination/suspension/resignation is a status change on `employment_status`, never a row delete.
- **Validation on create**: email domain check, employee code must match `^JV-[0-9]+$`, department required, employment type in `{full-time, part-time, contract, intern}`, duplicate email/code pre-checked client-side plus a server-side unique-constraint catch (Postgres error `23505`).
- **Lifecycle statuses** observed in filters: `active, probation, notice, on-leave, resigned, suspended, terminated, pending_approval`. `resolveEmploymentExitDate()` encodes the real exit-date rule: terminate/suspend default to today (IST) if no date given; resign only sets an exit date if one is explicitly provided; reactivating from suspended clears the exit date.
- Admin-created employees start `active` immediately; `pending_approval` is reserved for self-signup via `handle_new_user()`.
- **Edit permission**: `canEditHrFields = isSuperAdmin || isHr`; self-edit via `isOwnProfile`; `canChangeEmploymentStatus = canEditHrFields && !isOwnProfile` — **nobody, including an admin, can change their own employment status**.
- `teamOf(managerId)` — direct-reports-only query, same "My Team" pattern used by the CRM module.
- Departments are de-duplicated client-side by normalized name — a documented workaround for duplicate/case-variant rows in the data, not a schema fix.
- **RLS**: `employees_admin_hr_all`, `employees_self_select`/`_self_update`, `employees_manager_view_team` + `employees_manager_insert_team` — the latter two redefined across several migrations including this session's own GM-abilities work. Which exact definition is currently live cannot be confirmed without a direct database check.

### Departments / Designations
**Files**: `src/routes/departments.tsx`, `src/routes/designations.tsx`.
- `createDepartment()` / `createDesignation()` confirmed; **no update/delete found in the service layer** for either — not independently confirmed absent at the UI level (routes not read line-by-line).
- `is_sales` flag on departments is the exact flag the CRM module's `is_sales_member()` depends on; the employee-directory department list silently omits it if the column doesn't exist yet on a given database (defensive against the sales-CRM migration not being applied).
- **RLS**: simple and permissive for reads — `departments_read_all`/`designations_read_all` (any authenticated user, org-wide, no team restriction); writes are `_write_admin_hr` (admin/HR only).

### Roles
**File**: `src/routes/roles.tsx` (378 lines), `src/services/roleService.ts`.
- One Super-Admin screen conditionally calls up to three RPCs per save: `set_employee_role` (role change), `set_employee_placement` (department + manager reassignment), `set_department_head`.
- Demotion confirmation dialog is a client-side UX guard only; the actual last-admin/self-demotion protection lives inside `set_employee_role` itself (confirmed in a prior pass of this session, not re-verified here).
- `gmRoleUnavailableMessage()` — a special-cased error translator specifically for assigning `general_manager`, implying some deployed databases may not yet have that role's constraint/column.

### Onboarding pipeline
**Files**: `src/routes/onboarding.tsx` (809 lines), `src/routes/complete-profile.tsx` (1039 lines), `src/routes/profile-status.tsx` (428 lines), `src/services/onboardingService.ts`, `src/services/talentService.ts`.
- Two-table model: `onboarding_submissions` (review-stage tracking: status, `section_flags` jsonb, remarks) is separate from `onboarding_records` + `onboarding_tasks` (a post-approval checklist with `completed_at` per task).
- **Confirmed trigger mechanism** (direct read of `20260926120000_auth_security.sql:111-249`, the latest redefinition of `handle_new_user()`): on signup, it first tries to **link** the new auth user to a pre-existing, HR-created `employees` row by matching email (and seeds `onboarding_submissions` if that employee's status needs review). If no such row exists, it **creates a brand-new `employees` row** with `employment_status = 'pending_approval'` and seeds an `onboarding_submissions` row for it. Both paths converge on the same review pipeline.
- Review actions: `approve` → RPC `approve_employee_onboarding`; `requestChanges` → sets `profile_changes_requested` with section-level flags and remarks; `reject` — exact RPC/table effect not independently traced.
- `approve_employee_onboarding` has been redefined 3 times across the project's history; by filename-timestamp order the latest (`20261102100000_general_manager_role.sql`) would be authoritative if all three were ever applied in sequence — this is an inference from file order, not an independently confirmed live-database fact.

### Org Overview
**File**: `src/routes/org-overview.tsx` (956 lines). Three tabs — People & KPIs, Departments, Work reports — combining `roleService.performanceBoard()` (RPC `org_performance_board`), `kraService.scoreGrid()`/`trend()`, and `workService.listReportsBetween()` into one cross-module dashboard. Exact role gate not independently confirmed in this pass.

### Settings
**File**: `src/routes/settings.tsx` (201 lines). Four tabs: Organisation, Access, Notifications, and an admin-only **Beta** tab (`src/components/settings/BetaTab.tsx`) that is a **real, live destructive data-reset tool** — wipes attendance, DWRs/tasks, projects, leave, notifications, expenses/helpdesk/complaints, goals/performance/KPI/KRA, asset assignments, employee documents, and onboarding/recruitment/payslips/unapproved payroll, while explicitly preserving org/settings/profiles/employees, departments/designations/roles, shifts/holidays/leave-types, salary structures/KRA templates/KPI definitions, assets/job-openings, and audit logs/approved payroll. Gated by typed-confirmation text at the UI level; its actual RPC/RLS-level enforcement was not independently traced. **See `SECURITY_AUDIT.md` — flagged Critical.**

### Audit log
**File**: `src/routes/audit.tsx` (93 lines, simple read-only viewer). Table `audit_logs` (defined `20260818000000_kinetix_hrms.sql`), RPC `log_audit_event()` (redefined at least twice, latest confirmed candidate `20260926120007_audit_integrity.sql`, live status not independently re-verified here). **Confirmed coverage gap**: only 8 of roughly 22 service files call `logAudit()` — `api.ts, assetService.ts, authService.ts, employeeService.ts, leaveService.ts, payrollService.ts, talentService.ts, workplaceService.ts`. CRM, attendance, goals, KRA, projects, and others have no confirmed client-side audit call — meaning many real actions (deleting a CRM lead, approving a KPI score) would not appear in the Activity History screen unless logged by a database trigger instead (not separately checked for every table in this pass).

---

## Time & Work

### Attendance
**Files**: `src/routes/attendance.tsx`, `src/services/attendanceService.ts`.
- Check-in/out via RPC `punch_attendance(p_employee_id, p_action)`. Frontend recognizes an `EARLY_CHECK_IN:`-prefixed error message and throws a typed `EarlyCheckInError` → shown as a plain toast, not an error toast.
- **Live rule** (confirmed no "written to disk only" marker on its defining files): `punch_attendance()` from `20260928130001_shift_assignment.sql` + `recompute_attendance_hours()` from `20260926000003_attendance_rules.sql` — **shift-relative** grace period (`shift_start + grace_minutes`), evaluated per employee's assigned shift.
- **Three successive draft attempts to change this to a fixed clock-time rule** (`20261123105954`, `20261125050300`, `20261126050000_attendance_fixed_10am_rules.sql`) **all** carry the "written to disk only" marker — **none are live**. The fixed-10:00/10:15/18:30-IST rule, and the `EarlyCheckInError` scenario it's designed to produce, exist only in frontend error-handling code (dormant until/unless that migration is applied) and in the unapplied SQL.
- Regularization: `requestCorrection()` → RPC `request_attendance_regularization`; approve/reject → RPC `decide_attendance_correction` (defined `20260929140000`, no marker found — appears live). Monthly correction-request limit (default 3, org-configurable via `organization_settings`).
- WFH: `requestWfh()` → RPC `request_work_from_home`.
- Shifts: direct table operations on `shifts`/`employee_shifts`; `assign_employee_shift` RPC for assignment.
- **Frontend role gates** (not independently matched against DB RLS in this pass): `canReview = (isLead||isHr||isSuperAdmin) && !isEmployee`; `canExport = isHr||isSuperAdmin`.
- **Real, non-obvious bug found and confirmed dead** (see also `BUSINESS_WORKFLOWS.md`): `attendanceService.ts` exports `assertCheckoutAllowed()`, which calls `workService.checkoutAllowed()` (a real DWR-gate RPC, `checkout_allowed`). Grepping the entire codebase for `assertCheckoutAllowed` finds exactly one hit — its own definition. **It is never called anywhere.** The live check-out flow (`attendance.tsx` → `attendanceService.checkOut()` → `punch()`) bypasses it entirely. A draft migration's comment claims this gate was "already removed from the check-out flow," which is literally false (the function and its RPC still exist, fully defined) but functionally irrelevant (it was never wired in, so checkout is not actually gated by DWR submission status today).

### Leave
**Files**: `src/routes/leave.tsx`, `src/services/leaveService.ts`.
- `apply(payload)`: resolves `leave_types.id` via fuzzy name match, computes `totalDays = round((to-from)/86400000)+1` (inclusive), inserts `leave_requests` with `status: "pending"`.
- `decide(id, decision, rejectionReason)` → RPC `decide_leave_request`, `decision` is `"approved"|"rejected"`.
- `cancel(id)` → RPC `cancel_leave_request`.
- **Live authorization**: the live `decide_leave_request` (confirmed in `20260926120003_leave_integrity.sql`, no marker) gates on `can_manage_employee()`. A replacement adding a dedicated `can_decide_leave_request()` (so a `general_manager` can decide leave across departments, per an explicit business requirement from earlier this session) is drafted in `20261126070000_leave_decision_access_rules.sql` — **confirmed carrying the "written to disk only" marker, not live**.
- `appliedOn` display value is derived from the `leave_ledger` row where `transaction_type = "request"` (written by a DB trigger at insert time) — `leave_requests` itself has no `created_at` column for this purpose.
- `balance(employeeId)`: sums `leave_ledger.change_days` per leave type within the Asia/Kolkata calendar year; `remaining = max(allocated - used, 0)`.
- Status values: `pending, approved, rejected, cancelled`.
- `20261003120300_leave_monthly_cap.sql` and the cancellation logic in `20260926120010_leave_cancel.sql` — confirmed no "written to disk only" marker, treated as live.
- **Flag**: `20261125120000_drop_legacy_leave_goals_update_policies.sql` is itself unapplied — implies a legacy direct-update RLS policy on `leave_requests`/`goals` (bypassing `decide_leave_request`'s extra checks) may still be live today. Needs a direct DB check before assuming it's gone.

### Daily Work Reports (Work)
**Files**: `src/routes/work.tsx`, `src/services/workService.ts`.
- Reads are plain SELECTs; **every mutation is an RPC**: `saveDraft → save_dwr_draft_v2`, `submitReport → submit_dwr_v2`, `deleteReport → delete_dwr_report`, `reviewReport → review_dwr` (decision `"approved"|"needs-revision"`), `reopenReport → reopen_dwr`, `waiveMissed → waive_missed_dwr`. Both save/submit RPCs call the same underlying `dwr_upsert_v2()` function.
- **Live version**: `20261003130000_dwr_anti_ai_guard.sql` (no marker) — includes AI-generated-text detection on description fields.
- **Three successive unapplied drafts** stacked on top of this: `20261124052022` (removes the submission-window check), `20261125055945` (adds mandatory fields + a 19:00 late threshold), `20261126060000_dwr_today_only_8pm_rules.sql` (today-only submission + 8PM threshold, from this session's own earlier work) — **all three confirmed carrying the "written to disk only" marker**. None of these newer rules are live; the anti-AI-guard version governs DWR submission today.
- `checkoutAllowed(employeeId, date)` exists and is correct/live code, but (see Attendance above) is never actually called from the checkout flow.
- `saveSummary()` → RPC `save_team_daily_summary` (the lead's own end-of-day team conclusion, separate from individual DWRs).
- Field names: `report_date, blockers, plan_for_tomorrow, summary_html, review_status, lead_rating, lead_remarks, reviewed_by, reviewed_at, escalated, reopen_reason, waiver_reason`. Status defaults to `draft`; submitted status is set server-side by the RPC.

### Goals
**File**: `src/routes/goals.tsx`, service: `src/services/talentService.ts`.
- Plain CRUD: `goals()`/`goalsOf(employeeId)` SELECT; `createGoal()` INSERT with `status: "on-track"`, `progress: 0`.
- **RPCs confirmed by direct read** (not inferred from filenames): `submit_goal_progress(p_goal_id, p_progress, p_remarks)` — employee's own progress/remarks only, enforced server-side since there's deliberately no self-update RLS policy on `goals`; `update_own_goal(goalId, {...})` — lets the employee edit title/description/target/KRA link/due date/weight on a self-created goal, never progress or review fields; `review_goal(p_goal_id, p_status, p_reason, p_description, p_target, p_due_date, p_progress)` — reviewer-only; marking a goal complete always forces `progress = 100` server-side.
- "Overdue" status shown in the UI is computed client-side and never written back to the stored `status` column — a deliberate display-only convenience, confirmed by an inline code comment.

### KRA / KPI
**File**: `src/routes/kra.tsx`, service: `src/services/kraService.ts` (not independently opened; referenced via `kra.tsx`'s calls).
- Template-set weightage must sum to exactly 100 before saving is allowed — a client-side-only validation.
- Manual KPI entry is only editable when the row's source is `"manual"` **and** the target employee is not the current viewer, even for admins — self-entry is blocked.
- `compute_kpi_scores()` — **live version**: `20260926000005_kra_kpi.sql` (no marker). A general_manager team-scoped calculation branch (so GM calculates only for their own team, not org-wide) is drafted in `20261126080000_general_manager_keeps_team_lead_abilities.sql` — **confirmed carrying the marker, not live**.
- Linked-goals panel is explicitly documented as informational only: "Goal progress does not automatically become a KPI score."

### Performance Reviews
**File**: `src/routes/performance.tsx`, service: `talentService.ts`.
- `createReviewCycle()` → RPC `create_review_cycle(p_cycle_name, p_employee_ids, p_designation_id, p_period_start, p_period_end)` — resolves each employee's manager as reviewer server-side.
- `submitSelfReview()` → RPC `submit_self_review`; `submitManagerReview()` → RPC `submit_manager_review` (defined `20260827000004_performance_review_submit_rpcs.sql`, confirmed no marker, live).
- Score validation: `0 ≤ score ≤ 5` (step 0.1), client-side only.
- A manager reviewing their own row still only gets the self-score action — never the manager-score action on themselves, even if they technically could.
- KRA data shown alongside each review row is explicitly a read-only "manager reference," not wired into the computed rating.

---

## Operations

### Projects & Tasks
**Files**: `src/routes/projects.index.tsx`, `src/routes/projects.$projectId.tsx`, `src/services/projectService.ts`. Tables: `projects`, `project_members`, `tasks`, `project_messages` (`20261001110000_projects_module.sql`); `project_member_directory` RPC; `project_delivery_metrics()` RPC (not used by these two routes directly — consumed by `deliveryInsightsService.ts`, surfaced elsewhere).
- Full CRUD on projects/tasks/members; realtime project chat via Supabase Realtime with a 15-second polling fallback.
- **Creation gate** (frontend): `admin|hr|dept_head|team_lead|general_manager`.
- **Manage gate** (frontend, project-level): owner, admin/hr, or a member whose `role_in_project` is `owner`/`manager`.
- **Task-completion gate** (DB-enforced, not just frontend): only the assignee or a manager can mark a task done — RLS raises `'You can only update the status of a task assigned to you.'`
- **Member-removal guard (DB)**: blocked while that member has open tasks; the `owner` role itself can't be removed/changed without transferring ownership first.
- **Confirmed, still-live visibility gap**: `projects_select`/`project_members_select` use `is_lead()` — **any** dept_head/team_lead sees every project in the organization, not scoped to their own team or department. A team/department-scoped fix exists in `20261125110000_projects_team_department_visibility.sql`, confirmed carrying the "written to disk only" marker — **drafted, not applied**. This is the exact same `is_lead()`-is-unscoped pattern independently confirmed and partly fixed elsewhere for CRM this session.

### Assets
**Files**: `src/routes/assets.tsx`, `src/services/assetService.ts`. Tables: `assets`, `asset_assignments`, `asset_repairs`, `asset_requests`.
- Two deliberately separate flows: (1) employee-initiated **request** (`requestAsset` → `asset_requests`, decided via `decideAssetRequest`); (2) admin/HR **physical asset management** (`assign`/`markReturned`/`sendForRepair`, the latter two via RPCs `return_asset`/`request_asset_repair`).
- Status chains: request `pending → approved/rejected`; physical asset implied `available → assigned → (in-repair | returned/available)`.
- `myAssetRequests()` (own) vs. `listAssetRequests()` (admin/HR-only, per the code's own comment) — the frontend trusts RLS for the latter; the actual policy text was not independently read in this pass.
- Real audit logging confirmed on assign/return/repair/decide actions.

### Expenses
**Files**: `src/routes/expenses.tsx`, `src/services/workplaceService.ts:283-362`. Table: `expense_claims`.
- `createExpenseClaim` (always starts `pending`), `decideExpenseClaim` (approved/rejected + reason), `markExpenseReimbursed`.
- Status chain: `pending → approved/rejected`, then optionally `approved → reimbursed`.
- **Notable, explicitly documented history**: the `reimbursed` action was added specifically because the UI already promised it ("review, approve and reimburse" copy, a "Reimbursed" filter) before any backend function implemented it — a confirmed, since-closed UI-ahead-of-backend gap. No separate payment-date/reference column exists; `reimbursed` is just another value of the same free-text `status`.
- Frontend gate: `canManage = admin|hr`. DB-level: self-select/insert, team-scoped manager view/update (`can_view_employee`/`can_manage_employee`), admin/hr-all — last redefined `20260926000001_role_hierarchy_access_scope.sql`, no marker found.

### Helpdesk
**Files**: `src/routes/helpdesk.tsx`, `src/services/workplaceService.ts:363-424`. Table: `helpdesk_tickets`.
- `createTicket` (starts `open`), `updateTicketStatus` (auto-stamps `resolved_at` only for `resolved`/`closed`), `updateTicketAssignee`.
- **No DB check-constraint confirmed** limiting status to a fixed vocabulary — the allowed statuses are effectively whatever the frontend's dropdown offers, not independently DB-enforced as far as this pass could confirm.
- Assignee list (`supportStaff()`) deliberately reads `profiles` directly (filtered to `role in (admin, hr)`) rather than `employeeService`, because `helpdesk_tickets.assigned_to` references `profiles.id`, not `employees.id` — a confirmed intentional schema detail, not an oversight.
- Frontend gate: `canManage = admin|hr`. DB: self-select/insert, team-scoped lead-select/update, admin/hr-all.

### Documents
**Files**: `src/routes/documents.tsx`, `src/services/workplaceService.ts:43-282`. Table: `documents`; storage bucket: **`documents`** (private, confirmed by direct read of `20260821000003_employee_documents_storage.sql`).
- Client-side upload validation: PDF/PNG/JPEG/WebP only, cross-checked by extension and declared MIME type, 10MB max.
- Signed URLs only (120-second expiry) — never a stored public link. Correct, deliberate security pattern.
- Orphan-file cleanup: if the `documents` metadata insert fails after a successful storage upload, the uploaded object is explicitly removed.
- **Asymmetric RLS confirmed**: `documents_self_select`/`_self_insert`, `documents_manager_view_team` (**select only — no manager-update policy found**, so a lead can view but not edit a team member's document metadata through RLS directly), `documents_admin_hr_all`. Redefined across 4 migrations; which is final/live not independently confirmed beyond none of the four carrying an explicit marker in the lines checked.

### Recruitment
**Files**: `src/routes/recruitment.tsx`, `src/services/talentService.ts`. Tables (inferred from service code, not independently matched against DDL): `job_openings`, `candidates`, `job_applications`.
- **Confirmed real, non-trivial implementation**, not a stub. 6-stage pipeline: `applied → screening → interview → offer → hired`, plus terminal `rejected`.
- A candidate's displayed "stage" is **derived** from their most recent `job_applications` row, not stored on `candidates` directly — one candidate can have multiple applications to different openings, each with its own stage. The stage filter is applied client-side after fetching every candidate with embedded applications (a scalability note for large candidate counts, not a correctness bug).
- `moveCandidateStage()` and `addCandidateApplication()` (the latter validated client-side via shared `emailHasDomain`/`isIndianMobile` checks, reused from the onboarding module's own schema file) confirmed as real mutations.
- Job openings start `status: "open"`, closed via a separate function setting `status: "closed"` + `closed_at`.
- Not verified: RLS on these three tables; interview-scheduling or offer-letter sub-features beyond the stage field.

---

## Money & Reporting

### Payroll
**Files**: `src/routes/payroll.tsx` (746 lines), `src/services/payrollService.ts` (696 lines, fully read).
- **Salary structures**: `salary_structures`, one effective-dated row per change. `gross_salary` computed client-side (`basic+hra+allowances+bonus`), stored denormalized. Write gated by `requireAdminOrHr()` — a service-layer check calling the `current_user_role` RPC, not independently confirmed as a DB RLS policy.
- **Payroll run lifecycle**: `draft → processed → approved`, with a `processed → draft` reject path. No terminal "rejected" state. `startRun()` upserts one `payroll_runs` row per `(organization_id, year, month)` and generates one `payroll_records` row per active employee, snapshotting whichever salary structure was effective as of the run's period-end — **not a live join**, so a later salary edit never rewrites a past payslip (confirmed deliberate). Re-running an already-processed/approved period is a no-op.
- **PF/Tax — confirmed NOT calculated.** `startRun()` hardcodes `pf: 0, tax: 0` on every generated record. No statutory PF/ESI/professional-tax formula exists anywhere in this file. `total_deductions` comes straight from the salary structure's manually-entered `deductions` field.
- **Approval → payslip generation**: `approveRun()` (processed-only) marks records `paid`, generates one real single-page PDF per employee client-side via `pdf-lib` (genuine PDF bytes, not a placeholder), uploads to the `documents` bucket, inserts one `payslips` row per upload. Idempotent — skips records that already have a payslip.
- **Download**: prefers a signed URL to the real stored PDF; falls back to regenerating the PDF on the fly if the stored path looks invalid (handles legacy rows).
- **Not independently verified**: RLS on `payroll_records`/`salary_structures`/`payslips` — only the service-layer `requireAdminOrHr()` check was confirmed; whether a plain employee querying these tables directly (bypassing the service) would be blocked needs a direct policy check.

### Reports
**File**: `src/routes/reports.tsx` (432 lines). No own tables — reuses `insightsService` functions and `roleService.performanceBoard()`. Real client-side CSV export via `src/lib/report-export.ts`; no PDF/Excel export. Gated by a `canExport` flag whose exact role-source wasn't traced in this pass.

### Insights
**File**: `src/services/insightsService.ts` (324 lines, fully read).
- `companySummary()`, `attendanceTrend()`, `headcountTrend()`, `departmentDistribution()`, `leaveMix()` — all real queries against `employees`, `attendance_records`, `leave_requests`, `job_openings`, `payroll_runs`/`records`, `assets`, `helpdesk_tickets`. No mock data when Supabase is configured; falls back to static fixtures only in offline/unconfigured dev mode.
- `headcountTrend()` specifically back-fills zero-activity months so the series never skips — a genuinely careful implementation.

### Announcements
**Files**: `src/routes/announcements.tsx` (388 lines), `src/services/workplaceService.ts:425-521`.
- Full CRUD, gated by the `announcements_write_admin_hr` RLS policy (not just a service-layer check) — matches the frontend's `canManage = admin|hr` gate.
- **DB-enforced three-way targeting exclusivity** via the `announcements_target_shape_check` constraint: organization-wide (no department/role), department-scoped (no role), or role-scoped (no department) — genuinely mutually exclusive at the database level, not just a UI convention.
- Read receipts: separate `announcement_reads` table, self-only RLS, idempotent insert (duplicate-key errors swallowed).
- **No email or push delivery** — confirmed by grep across services/edge functions for any mail-sending pattern; purely in-app.

### Notifications
**Files**: `src/routes/notifications.tsx` (181 lines), `src/services/workplaceService.ts:595-664`.
- Read model scoped to the caller's own rows, enforced by the `notifications_self_all` RLS policy (not an explicit `user_id` filter in the query itself).
- **17 real trigger sources confirmed** across 9 migration files via direct grep for `insert into public.notifications`: onboarding status changes, task/DWR events, the KRA manual-score-missing reminder, auth/security events, announcement publishing, admin-initiated password resets, employee complaints, and the general-manager-role migration.
- One unresolved ambiguity: two competing onboarding-schema migrations (`20260926000002` vs `20261003120000`) both insert notifications for the same conceptual events — which one is actually live determines whether those specific triggers fire today; not independently resolved in this pass.
- No email/push delivery here either — purely in-app, same as Announcements.

---

## Sales CRM

Covered in full depth earlier in this session's own direct work (not re-derived from a research fork — this session performed the actual implementation, fixes, and local-database testing for this module). Summary:
- **Leads**: full CRUD, bulk owner/temperature/status/follow-up actions, Hot/Warm/Cold quick-filter with live counts, two-mode Excel import (Initial Import for Day-1 fresh leads; Update Existing Leads for Day-2 enrichment matched by phone-then-email, never by name, never deleting a previous import). `crm_leads` table, `import_crm_leads()`/`preview_import_crm_leads()` RPCs.
- **Deals**: board + list views, stage changes with server-side-enforced probability/closing-date logic (the `crm_before_write()` trigger forces this regardless of client input), lost-reason requirement.
- **Accounts/Contacts**: CRUD with duplicate warnings (name for accounts, email/phone for contacts) on manual creation; `convert_crm_lead()` RPC supports reusing an existing account/contact instead of always creating new ones (the frontend surfaces this as a match-and-choose UI).
- **Activities**: call/meeting/email/follow-up logging; call outcomes have real server-side side effects (e.g. `wrong_number` auto-sets the lead to `unqualified`; certain outcomes auto-schedule a follow-up date); Today/Overdue/Upcoming quick-filter buckets.
- **Overview/Forecasting**: date-range + salesperson-filtered metrics, verified internally consistent (a prior bug where "Won this month"'s displayed count and win-rate percentage disagreed was found and fixed this session); AI forecast insights via Gemini, honestly falling back to data-only insights when unconfigured, never fabricating a result.
- **Role model**: `has_crm_access()` = admin/general_manager (by role) or sales-department membership; `crm_can_manage_all()` = admin, or a sales-member dept_head/team_lead, or whoever heads a sales department. HR has zero CRM access by default. Verified by direct-table-query testing against a local Postgres instance this session — not merely read from policy text.
- **Known pending item**: a Sales Targets feature exists in the forecasting UI but its backing table (`crm_sales_targets`) is defined only in an unapplied draft migration — not usable until that migration runs.

See `BUSINESS_WORKFLOWS.md` for the full lead-to-deal lifecycle diagram and `SECURITY_AUDIT.md`/`ROLE_PERMISSION_MATRIX.md` for the CRM permission detail.
