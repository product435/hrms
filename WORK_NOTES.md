# Work Notes — My Reports fixes

## Changed files (this pass)

- `src/routes/work.tsx`
  - "What you did" is now a multi-line `Textarea` (was a single-line `Input`). Enter inserts a line break inside the field; only the "Submit report" button submits the form. Paste/drop-blocking handlers kept, re-typed for `HTMLTextAreaElement`.
  - Left-side Report Date picker: now locked to **today only** (`disabled={(date) => indiaDateKey(date) !== today}`). Past/future dates are no longer selectable there.
  - Right-side calendar (`RecentReportsCalendar`): converted from an always-open inline calendar to a closed-by-default popover with a calendar-icon trigger button (compact field, e.g. "25 Nov 2026"), matching the left picker's style. Status colour legend (Submitted/Late/Missed/Draft) kept inside the popover.
  - Right-side calendar + the "Recent reports" list rows: selecting **today** (including a same-day Draft) loads it into the editable form to continue/submit. Selecting a **past** date opens it **read-only** via the existing `WorkReportDetailDialog` instead of loading it into the editable form.
  - Subtitle/tooltip text updated to the new fixed 7:00 PM / 11:59 PM rule (`submissionTimingCopy()`, `REPORT_STATUS_HELP`), replacing the old "window opens 30 minutes before your shift ends" copy, which no longer matches current behaviour. Removed the now-dead `shiftBounds`/`submitPhase`/`phaseCopy` code path and its unused imports.
- `src/components/work/WorkReportDetail.tsx`
  - Added `whitespace-pre-wrap` to the line-item description display so saved line breaks actually render (a plain `<p>` was collapsing them).

## Kept exactly as-is (per instruction)

Save draft / Save changes (by report state), Submit report, Delete report + confirmation, "+ Add line", the per-line delete icon (and its earlier fix: enabled immediately, replaces the last line instead of going to 0), all status badges including "Pending", the eye/view icon, info-hint icons, rich-text toolbar (Day Summary), mandatory What-you-did/Day-summary validation, the 7:00 PM Submitted/Late boundary in `dwr_upsert_v2`, layout and theme.

## Pending — needs your approval before any SQL is written or run

**Missed timing.** Proposed in a NEW migration `supabase/migrations/20261125060000_dwr_missed_end_of_day.sql` (old migrations untouched):
1. `dwr_shift_bounds()`'s `late_until` → `((p_date + 1)::timestamp) at time zone 'Asia/Kolkata'` (end of the report's own calendar date), replacing "10:00 AM the following day." No longer depends on shift_end/overnight — confirmed overnight shifts have no impact on this cutoff.
2. `mark_missed_dwrs_daily` cron → `'35 18 * * *'` UTC (≈00:05 AM IST), same two-day catch-up (`- 1`, `- 2`), dates still derived from `timezone('Asia/Kolkata', now())::date` (already correct, not UTC `current_date`).

Confirmed: Submitted-up-to-7PM / Late-after-7PM is already correctly implemented in `dwr_upsert_v2` (DB) and `submissionTimingCopy()`/`REPORT_STATUS_HELP` (frontend) — no change needed there. This fix is what bounds "Late" by end-of-day in practice (via `mark_missed_dwrs` converting unsubmitted reports to `missed` at midnight instead of 10 AM next day). `mark_missed_dwrs()` itself and the old unused `dwr_upsert`/`save_dwr_draft`/`submit_dwr` functions are untouched — not on the live frontend path.

Not written to disk yet — awaiting explicit approval. No past records are rewritten by this change (only new cron runs and future `mark_missed_dwrs` calls are affected).

## Delete report error ("Could not find the function public.delete_dwr_report")

Root cause: `delete_dwr_report` IS already defined — in `supabase/migrations/20261125055945_dwr_date_mandatory_fields_late_threshold.sql:359-403`, written earlier this session — but that migration file has never been applied to your Supabase project. It is not a new bug and no duplicate function was written.

That existing function already does everything required:
- Ownership check: `v_row.employee_id is distinct from public.current_employee_id()` → raises `'You can only delete your own report.'`.
- Blocks deleting an approved report (same rule `reopen_dwr` already enforces).
- `revoke all ... from public, anon; grant execute ... to authenticated, service_role;`
- Deletes `dwr_items` then `daily_work_reports` inside one transaction. Checked all migrations for other foreign keys into these two tables — only `dwr_items.report_id → daily_work_reports(id) on delete cascade` exists; nothing else references either table.

What was missing: no `notify pgrst, 'reload schema';` anywhere near it, which can leave PostgREST's schema cache stale even after a function is created. Added a new, separate migration `supabase/migrations/20261125061500_reload_pgrst_schema_cache.sql` (just the notify) rather than editing the pending file.

**Action needed from you:** apply `20261125055945_dwr_date_mandatory_fields_late_threshold.sql` (still pending from earlier this session) and then `20261125061500_reload_pgrst_schema_cache.sql`, in that order. Neither has been run or pushed by me.

## Checks run

- `npx tsc --noEmit` — clean (only the same pre-existing, unrelated `goals.tsx` error).
- ESLint — clean (remaining hits are the same pre-existing CRLF/prettier noise on this file).
- `npm run build` — succeeded.

## My Leave module (new task)

### Changed files
- `src/components/common/DateRangeFilter.tsx` (rewritten per latest instruction) — two always-visible From/To date fields, each dd-mm-yyyy with a calendar icon, calendar closed until clicked (month/year selectable via `Calendar` `mode="single"` + `captionLayout="dropdown"`), plus Apply and Clear buttons. Picking a date only updates the field, never the list; the list only changes when the caller's `onApply(from, to)` fires. Clear empties both fields and calls `onClear()`. Shows an inline message ("From" cannot be later than "To") and disables Apply when From > To, instead of applying.
- `src/routes/leave.tsx` — `ledgerRange`/`recordsRange` now plain `{from, to}` strings (either can be empty) set only by Apply/Clear, not while picking. Filtering: only From set -> that date onwards; only To set -> up to that date; both inclusive. Ledger filters by `transaction date` (`createdAt`); records table filters by the request's own leave dates overlapping the range, combined with existing search/status (`visibleRequests`/`visibleLedger`, unchanged logic otherwise). The two filters are fully independent (separate state, separate `DateRangeFilter` instances). Reused the same popover+`Calendar` pattern already used in `work.tsx`'s date pickers — no new UI primitive. Nothing else changed: cards, Pending card, Apply-for-leave dialog, approve/reject/withdraw/cancel actions, columns, and theme untouched. No DB/SQL changes in this pass.

### Earned Leave showing 2 instead of 1 — root cause
`leave_types.annual_limit` is a live **data** column (no migration inserts/sets it — confirmed by grep across all migrations). The "Earned Leave" row's `annual_limit` is `2` in your data; every consumer (`leaveService.balance()`, and DB functions in `leave_integrity.sql`, `leave_cancel.sql`, `leave_monthly_cap.sql`, `relax_attendance_dwr_leave_rules.sql`) already reads `annual_limit` directly, so fixing this one value fixes the big number, the "X used of Y" hint, and apply-leave validation everywhere at once. Not hardcoded anywhere; no code change needed for this part.

**Not yet run** — proposed, scoped to every organization's Earned Leave row (per your choice):
```sql
update public.leave_types
set annual_limit = 1
where name = 'Earned Leave' and annual_limit <> 1;
```
Before applying, run this yourself to see exactly who is affected (any employee who has already used ≥1 Earned Leave day this year will show fewer/zero days remaining once the entitlement drops from 2 to 1 — no ledger rows are touched, only the computed `remaining`):
```sql
select e.id as employee_id, e.first_name, e.last_name, e.organization_id,
       lt.annual_limit,
       coalesce(sum(-ll.change_days), 0) as used_this_year
from public.leave_types lt
join public.leave_ledger ll on ll.leave_type_id = lt.id
join public.employees e on e.id = ll.employee_id
where lt.name = 'Earned Leave'
  and ll.created_at >= date_trunc('year', now())
group by e.id, e.first_name, e.last_name, e.organization_id, lt.annual_limit
having coalesce(sum(-ll.change_days), 0) >= 1;
```
Casual/Sick rows are untouched (the `where name = 'Earned Leave'` scopes it).

### Checks run
- `npx tsc --noEmit` — clean (only the pre-existing unrelated `goals.tsx` error).
- ESLint — `DateRangeFilter.tsx` clean; `leave.tsx` shows the same pre-existing CRLF/prettier noise on every line, not from this change.
- `npm run build` — succeeded.

### Pending tests (browser — user will verify)
- Ledger: set only From -> entries from that date onward show; set only To -> entries up to that date show; set both -> entries in range show; list does not change until Apply is clicked; Clear empties both fields and restores the full list.
- Records table: same From/To behavior on leave dates, combined correctly with an active search term and a non-"all" status filter at the same time.
- From later than To -> inline message shown, Apply disabled, list unchanged.
- Ledger and records filters don't affect each other.
- After Earned Leave SQL is applied: balance card shows big number 1 and "X used of 1"; apply-leave rejects a request that would exceed 1 remaining day.

## Add employee / Edit profile shared fields (corrected)

### Correction applied
No separate "Edit employee" button/dialog. The single existing "Edit profile" button now opens the new 15-field popup (titled "Edit profile") for both admin and an employee viewing their own profile. Admin sees every field editable (Work email still read-only -- login is tied to it). An employee on their own profile sees all 15 fields, prefilled, but only the ones the database already allowed them to change stay editable; the rest render disabled/read-only, consistent with what the backend actually accepts.

### Fields an employee can edit on their own profile
First name, Last name, Phone, Date of birth, Gender, Blood group, Marital status, Location.
Read-only for an employee (admin-only): Work email, Employee code, Joining date, Department, Designation, Employment type, Status (+ exit date).
This list was taken directly from `employees_guard_self_assignment()` (`20261003120000_employee_onboarding.sql`), which already reverts a self-update of every one of those read-only fields back to its old value -- the UI now matches that exactly, it does not invent a separate rule.

### Changed files
- `src/components/employees/EmployeeFormFields.tsx` — added an `editableFields` prop: when given, every field NOT in that list renders disabled/read-only with a "Managed by HR/Admin." note; omitted (admin case), every field stays editable as before. Same field set/order/layout either way.
- `src/routes/employees.$employeeId.tsx` — removed the separate admin-only dialog and its "Edit employee" button entirely (dead code from the previous turn). The one remaining "Edit profile" dialog now renders the full `EmployeeFormFields`, passing `editableFields={canEditHrFields ? undefined : SELF_EDITABLE_FIELDS}`. Required-field validation only checks fields the current role can actually edit, so an employee is never blocked by an empty Department/Employee code/Joining date left over on an old record -- those are skipped for a self-editor. Admin keeps the same status-change confirmation flow (suspend/terminate/reinstate/activate) as before, now reached from this one dialog. Removed now-dead code: the old inline `ChoiceField` component, `keptOrListed`, `keptOrMobile`, `selectClass`, and their now-unused imports (`MobileInput`, `BLOOD_GROUPS`, `GENDERS`, `MARITAL_STATUSES`, `isIndianMobile`, `indiaDateKey`).
- `src/routes/employees.index.tsx` — unchanged this pass ("Add employee" stays as it was left last turn).
- `src/services/employeeService.ts`, `src/types/index.ts` — unchanged this pass.

### DB/RLS — still proposed, NOT applied
Same proposal as last turn, unchanged: `supabase/migrations/20261125070000_employee_edit_dialogs_rls.sql` adds one line (`new.email := old.email;`) to `employees_guard_self_assignment()` so Work email is truly read-only for a self-edit at the database level, not just in the UI. Not run or pushed.

### Checks run
- `npx tsc --noEmit` — clean (only the pre-existing unrelated `goals.tsx` error).
- ESLint — changed files clean (only pre-existing CRLF noise and one pre-existing fast-refresh warning, neither from this change).
- `npm run build` — succeeded.

### Pending tests (browser — user will verify)
- Admin edits their own employee's profile: all 15 fields editable (Work email still read-only), save persists everything.
- Employee opens their own "Edit profile": sees all 15 fields; only the 8 listed above are enterable, the rest show disabled with the "Managed by HR/Admin." note.
- An employee whose record has an empty read-only field (e.g. no department) can still save successfully -- not blocked.
- Employee code uniqueness error still shows inline when an admin changes it to one already in use.
- Status-change flow (suspend/terminate/reinstate/activate) still works exactly as before from this same dialog.

## My Goals — self-edit, due-date filter (new task)

### Scope confirmation
`src/routes/goals.tsx` is one shared route for both "My goals" (`isSelfService`) and admin "Goals & OKRs". Every new control (edit icon, Edit goal dialog, due-date filter) is gated on `isSelfService` only -- nothing changes on the admin view (search/status `FilterBar`, Review dialog, `canReview` flow are all untouched).

### "Self-created" vs "assigned by someone else"
Checked: `goals` has no `created_by`/`assigned_by` column, and no UI anywhere lets anyone assign a goal to a different employee -- every existing goal row was inserted by the employee it belongs to, via this same "Add goal" form (`employee_id = user.employeeId` on insert, always). So right now "belongs to me" and "self-created" are the same set. Per your confirmation, the edit icon uses the existing `isOwnGoal`/`canEditGoal` check (`employee_id === me`) -- no new column added.

### Changed files
- `src/routes/goals.tsx` — added an edit (pencil) icon next to each own goal's title, **shown only when `isSelfService`**. Opens the same "Add goal" dialog, retitled "Edit goal" when editing, prefilled with Title/Description/Target/Link to KRA/Due date/Weight from the row. Saving calls the new `talentService.updateOwnGoal()` instead of `createGoal()`, keyed by `editingGoalId`. Added a due-date `DateRangeFilter` (reusing the component as-is: From/To/Apply/Clear) in place of the admin `FilterBar` on the self-service view only; filters by `dueDate` falling in the picked range (either side can be left open-ended). "Set %", "Update", remarks, and "Add goal" markup/behavior are otherwise unchanged.
- `src/services/talentService.ts` — added `updateOwnGoal()`, calling a new RPC `update_own_goal`. `submitGoalProgress`/`reviewGoal`/`createGoal`/`goals()`/`goalsOf()` untouched.

### DB change — proposed, NOT applied, shown here for approval
New migration `supabase/migrations/20261125080000_goal_self_edit.sql`: a new RPC `update_own_goal(p_goal_id, p_title, p_description, p_target, p_due_date, p_weight, p_kra_id)`.

Why a new RPC instead of an RLS policy: `goals` has **no `goals_self_update` policy at all** today (confirmed by reading `20260831000001_reconcile_tracked_schema_with_live.sql` -- only `goals_self_select`/`goals_self_insert` exist for an employee's own row; the only existing self-edit path is `submit_goal_progress`, which only ever touches `progress`/`progress_remarks`). Adding a plain RLS update policy would let an employee change ANY column on their own goal -- including `progress`, `status`, `manager_review_reason`, `reviewed_by`, `reviewed_at` -- exactly what "must not reset progress or history" forbids. The RPC updates only the six requested columns, explicitly, and checks ownership itself the same way `submit_goal_progress` already does.

### Your question 7, answered
- **A goal already reviewed by a manager** (`reviewedAt` set, `managerReviewReason` present) but not marked `completed`: **can still be edited** by this new RPC, same as `submit_goal_progress` already allows for progress updates today -- review history (`reviewed_at`/`manager_review_reason`) is never touched or cleared by this edit.
- **A goal marked `completed` by a reviewer**: editing is **blocked**, with the same message `submit_goal_progress` already uses ("This goal has been marked completed by a reviewer... Ask your reviewer to reopen it."). This is not a new rule -- it's the existing self-edit protection, applied consistently to this new RPC too, so completed goals aren't easier to tamper with through the new path than the old one.
- **"Overdue" when the due date is moved**: "Overdue" is a pure frontend display label (`status !== 'completed' && dueDate < today`, computed in `isOverdue()` in `goals.tsx`) -- it is **never stored**. Moving the due date to a future date simply stops the label showing on next render; nothing else changes, and no other behavior was altered.

I did not change either of these without asking, per your instruction -- both are existing precedent, applied consistently, not new decisions. Tell me if you want different behavior for either case.

Not run or pushed.

### Checks run
- `npx tsc --noEmit` — clean (only the pre-existing unrelated `goals.tsx` TS2379 error, same one present before this change, on an unrelated line).
- ESLint — changed lines clean; remaining hits are pre-existing CRLF noise on lines this task never touched.
- `npm run build` — succeeded.

### Pending tests (browser — user will verify)
- Edit icon shows only on a self-created goal in My Goals, not on the admin Goals & OKRs page, and not on a goal with no `employeeId` match.
- Edit goal opens prefilled, saves into the same row (same id, progress/remarks/status untouched), list reflects changes without a new row appearing.
- Weight validation (0-100) and Set % validation are unchanged.
- Due-date filter: From-only, To-only, and both set; Clear restores the full list; filtering doesn't affect the admin page.
- A completed goal shows no edit icon's save succeeding -- confirm the "ask your reviewer to reopen it" message appears instead (requires the migration applied first).

## CRM role-based visibility — PLAN ONLY, nothing changed yet

Per your "plan first" instruction, this turn is investigation + proposed SQL only. No frontend code was changed, no data was touched, nothing was run.

### 1. Current RLS (read from `20261102110000_sales_crm.sql`)
- **SELECT**: `organization_id = current_org_id() AND has_crm_access()` -- **no owner/team scoping at all.** This is the real bug: every sales member already sees every CRM row org-wide today.
- **INSERT**: `crm_can_write()` -- any sales member, no team restriction. Unaffected by this task.
- **UPDATE/DELETE**: `organization_id = current_org_id() AND crm_can_write() AND (owner_id = me OR crm_can_manage_all())` -- already correctly scoped. Not touched.

### 2. How team lead / team are determined
- `is_team_lead()` = role is `team_lead` or `manager` (pure role check).
- "Team" = `employees.manager_id = current_employee_id()`, direct reports only -- same definition already used by `is_my_direct_report()`/`employees_manager_view_team` elsewhere in this app, not a new concept.
- `crm_can_manage_all()` (gates writes/reassignment) treats `dept_head` OR `team_lead` as full org-wide access -- **confirmed with you**: this stays unchanged; only SELECT is newly scoped.
- `dept_head` is **not** included in the new team-scoped SELECT rule, **confirmed with you**: dept_head keeps seeing everyone, matching how it already works department-wide elsewhere in this app.

### 3. Records with no owner
None can exist: `owner_id` is `not null` on every CRM table, and `crm_before_write()` defaults it to the creator on insert. "No records for this person" only ever means zero rows for that owner, never a row with a missing owner.

### 4. Root cause of "only Archna Sen appears"
`ownerFilterOptions(rows)` in `crm.tsx` builds every filter dropdown from whichever rows (`leads`/`deals`/`activities`) are already loaded on screen, not from an employee roster -- whoever has zero records never appears. A correct roster already exists and is already fetched today: `crmService.owners()` -> RPC `crm_owner_directory()` -- but it is currently only wired into the assign/reassign dropdowns, never into the filter dropdowns. Fixing this is reusing an existing, correct source, not building a new one.

### 5. Other dropdowns with the same problem (flagged per your instruction)
- Overview's "All salespeople" and Forecasting's "Salesperson" filter: same `ownerFilterOptions(rows)` bug.
- Leads and Deals tabs' "Owner" filter: same bug, **and currently shown unconditionally to every role, including a plain rep** -- no `showTeam`-style gating exists on these two today (Forecasting/Activities already gate correctly via `showTeam`).
- Accounts and Contacts tabs have **no owner filter at all today** -- your task lists them, so adding one there is new UI, not a fix.
- `crm_owner_directory()` itself returns the whole org's sales roster regardless of caller role -- updated in the proposed SQL below to scope to the caller's own team when the caller is a team lead.

### 6. Effect on duplicate-lead checks and lead conversion
**None.** Checked both directly: `crm_import_leads_rpc`'s duplicate lookup and `convert_crm_lead()` both run as `security definer` PL/pgSQL querying tables directly -- neither goes through the client-facing SELECT RLS policy being changed here. Confirmed no impact.

### Proposed SQL — NOT applied, shown for approval
New migration `supabase/migrations/20261125090000_crm_role_visibility.sql`:
1. New function `crm_team_member_ids()` -- the caller's own id plus their direct reports' ids (same `manager_id` definition used elsewhere).
2. Rewrites the `_select` RLS policy on all 5 CRM tables (`crm_accounts`, `crm_contacts`, `crm_leads`, `crm_deals`, `crm_activities`): admin/general_manager/dept_head still see everyone; a `team_lead`/`manager` sees only rows owned by themselves or their team; everyone else sees only their own rows.
3. Updates `crm_owner_directory()` to scope the roster to the caller's own team when the caller is a team lead; admin/dept_head/GM still get the full active sales roster.

Full SQL is in the migration file -- not run or pushed.

### Revision 2 — corrected scope (not yet approved)

You changed the scope from the first draft: writes/reassignment ARE now being narrowed (not left as-is), HR is being added to full CRM access (a brand-new grant -- HR has zero CRM access today), and dept_head is being removed from `crm_can_manage_all()` entirely (not just left out of the new team-scoped visibility rule). `supabase/migrations/20261125090000_crm_role_visibility.sql` was rewritten in place (it was never applied, so replacing it outright is safe) to implement exactly this:

- `crm_can_manage_all()`: now `admin`/`hr`, OR a sales-department `team_lead`. `dept_head` removed entirely -- point 4.
- `has_crm_access()`: now `admin`/`hr`/`general_manager`, OR any sales-department member. **HR access is new** -- point 2.
- SELECT/UPDATE/DELETE on all 5 CRM tables rewritten: own record always allowed; a `team_lead` additionally gets own-team (`crm_team_member_ids()`); `admin`/`hr` get everyone. A plain rep gets own-only on all three operations, including `crm_leads` -- point 1.
- `crm_before_write()`'s reassignment check rewritten: a `team_lead` may now only reassign a record to/from someone in their own team (both the old and new owner must be a team member); `admin`/`hr` remain unrestricted -- point 3. Everything else in this trigger is unchanged, byte-for-byte.
- `crm_owner_directory()` updated to match: `admin`/`hr` see the full sales roster, `team_lead` sees only their own team.

### Revision 3 — final (this turn), all 4 follow-up points addressed

`supabase/migrations/20261125090000_crm_role_visibility.sql` was rewritten again (still never applied, so replacing outright stays safe). Same scope as Revision 2, plus:

**Point 1 fix -- `import_crm_leads()` batch-delete scoped to the caller.** Rewrote the function (full body now in the migration, byte-for-byte unchanged apart from the two spots noted):
- The "previous batch" lookup now finds only a batch `crm_import_batches.uploaded_by = the caller`, never the org's most recent batch regardless of uploader.
- The delete of that batch's leads (and their WhatsApp conversations/messages and call logs) now also requires `crm_leads.owner_id = the caller` -- a lead still tagged with the caller's old batch id but since reassigned to someone else is excluded and survives, exactly as you asked.
- Everything else in the function (duplicate lookup against the whole org, row-by-row insert, listing_rating parsing) is untouched.

**Point 2 -- same own/team/all SELECT scoping extended to the other 5 tables:**
- `crm_sales_targets`: a plain rep sees their own target row (`owner_id = me`) and the organisation-wide target (`owner_id is null`), never another rep's individual target. A `team_lead` additionally sees their team's targets. `admin`/`hr`/`general_manager` see all. **Write rules (insert/update/delete) are completely untouched** -- they already required `crm_can_manage_all()` directly, so a plain rep could not set a target before this and still cannot (your "unless they can today" condition is satisfied by not touching those policies at all).
- `crm_call_logs`, `crm_whatsapp_conversations`, `crm_import_batches`: same own/team/all SELECT pattern, keyed off their own `owner_id` column. Write rules (already owner-or-`crm_can_manage_all()` for update/delete, `crm_can_write()` for insert) untouched.
- `crm_whatsapp_messages` has no `owner_id` column of its own -- its SELECT is now scoped through its parent conversation's `owner_id` (own/team/all, same rule), matching how its existing insert/delete policies already check the parent conversation's ownership.

**Point 3 -- incoming call/WhatsApp, and who sees ownerless records:**
- `whatsapp-webhook` (the Edge Function that receives incoming WhatsApp messages) uses the **service-role key**, not a user session -- confirmed by reading `supabase/functions/whatsapp-webhook/index.ts`. It bypasses RLS entirely by design (an external webhook has no logged-in user). **Completely unaffected** by this migration.
- `exotel-call-token` (the call-token Edge Function) uses the caller's own session, but only ever queries the `employees` table, never any CRM table -- confirmed by reading it. **Unaffected**.
- **Who sees a record with no owner**: nobody needs to -- confirmed again this turn, every CRM table's `owner_id` is `not null`, so no CRM record (lead, deal, account, contact, activity, call log, WhatsApp conversation, import batch) can exist without one. `crm_whatsapp_messages` is the only table with no `owner_id` column at all, and its visibility is derived from its parent conversation's owner (which is itself `not null`) -- so there is no ownerless row anywhere in this module, and this question has no one to answer for.

**Point 4 -- read-only query for affected users** (no DB connection on my end, so you run this yourself; it changes nothing):
```sql
select
  e.id,
  e.first_name,
  e.last_name,
  p.role,
  d.name as department,
  d.is_sales,
  case
    when p.role in ('admin', 'hr') then 'sees/manages everyone (hr is a NEW grant)'
    when p.role = 'general_manager' then 'sees everyone, read-only (unchanged)'
    when p.role = 'team_lead' and (d.is_sales or exists (
      select 1 from public.departments h
      where h.manager_id = e.id and h.is_sales and h.organization_id = e.organization_id
    )) then 'own + own team only (was: everyone -- now narrower)'
    when p.role = 'dept_head' then 'NO CRM access unless personally in a sales department (was: everyone -- now narrower or none)'
    when d.is_sales or exists (
      select 1 from public.departments h
      where h.manager_id = e.id and h.is_sales and h.organization_id = e.organization_id
    ) then 'own records only (unchanged)'
    else 'no CRM access (unchanged)'
  end as crm_visibility_after_this_change
from public.employees e
join public.profiles p on p.id = e.profile_id
left join public.departments d on d.id = e.department_id
where lower(coalesce(e.employment_status, 'active')) = 'active'
order by p.role, d.name;
```
Run this against your live data to get actual names before approving -- I cannot connect to Supabase myself.

### Revision 4 — final fixes this turn (not yet approved)

Two gaps you caught, both fixed in `20261125090000_crm_role_visibility.sql`:

1. **`crm_can_write()` now includes `hr`.** It previously stayed `admin OR is_sales_member()` -- unchanged from the original schema -- which silently blocked HR from creating or editing ANY CRM record, even though `has_crm_access()`/`crm_can_manage_all()` already treated HR as a full manager. New function added: `admin OR hr OR is_sales_member()`.
2. **Team-lead write/reassign scope closed on every remaining table and function that used `crm_can_manage_all()` as a plain yes/no gate:**
   - `crm_new_tables_before_write()` (covers `crm_call_logs`, `crm_whatsapp_conversations`, `crm_whatsapp_messages`, `crm_import_batches`) rewritten with the same team-membership check already added to `crm_before_write()`: a `team_lead` may now only assign/write one of these records to or from a member of their own team; `admin`/`hr` stay unrestricted. For `crm_whatsapp_messages` specifically (ownership comes from its parent conversation, not its own column), a `team_lead` may now write to a conversation only if that conversation's owner is in their own team.
   - `crm_sales_targets_before_write()` rewritten: a `team_lead` may now set/edit a target only for themselves or a member of their own team -- and explicitly **never** the company-wide target (`owner_id is null`), which only `admin`/`hr` may set. This directly matches "Only admin and hr may change the company-wide target."

Nothing else in this migration changed from the previous turn's version (same SELECT scoping on all tables, same `import_crm_leads()` fix, same `crm_owner_directory()`). The RLS UPDATE/DELETE policies on the 4 newer tables (`owner_id = me OR crm_can_manage_all()`) are left as-is, same as the 5 original tables -- the team-scoping for a lead's reassignment is enforced in the before-write triggers (which run before RLS is even checked), not duplicated into the policies themselves.

Not run or pushed. Full SQL is in the migration file.

## Pending tests (not yet run — need a browser + real session)

- Enter inside "What you did" inserts a line break, never submits.
- Save draft, reopen the same day, fields reload correctly.
- Save changes on an already-submitted report (status unchanged).
- Delete report with confirmation.
- Submit before 7:00 PM → Submitted; submit after 7:00 PM (and by 11:59 PM) → Late.
- A day left unsubmitted becomes Missed the next day (unchanged existing cron behaviour, pending the approval above if you want it to fire sooner).
