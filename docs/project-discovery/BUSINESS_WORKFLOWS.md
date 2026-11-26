# Business Workflows

> Part of the As-Built Discovery documentation set. See `MASTER_AS_BUILT_PRD.md` for the full index. Each workflow below reflects what's **actually confirmed live**, with drafted-but-unapplied changes called out separately.

## 1. Signup → Active Employee (Onboarding)

```
User signs up (Supabase Auth)
  → handle_new_user() trigger fires
      → tries to match new.email against an existing, unlinked `employees` row (created ahead of time by HR)
          → MATCH: links employees.profile_id to the new auth user; if that employee's
            status needs review, seeds an `onboarding_submissions` row (status: draft)
          → NO MATCH: creates a brand-new `employees` row
            (employment_status: 'pending_approval'), seeds `onboarding_submissions`
  → User is redirected (by the route guard's onboarding gate) to /complete-profile
  → User fills in and submits their profile
  → HR reviews in /onboarding:
      → Approve  → RPC approve_employee_onboarding → employment_status becomes active,
                   full self-service access unlocked
      → Request changes → status becomes profile_changes_requested, with section-level
                   flags + remarks → user redirected back to /complete-profile
      → Reject   → (exact effect not independently traced; redirects to /profile-status)
```
**Actors**: the new user (self), HR (reviewer). **DB objects**: `handle_new_user()` trigger, `onboarding_submissions`, `onboarding_records`/`onboarding_tasks` (separate post-approval checklist), `approve_employee_onboarding()` RPC. **Confirmed live** — this is not a draft.

## 2. Attendance Check-in / Check-out

```
Employee clicks Check In
  → RPC punch_attendance(employee_id, 'check_in')
      → live rule: compares against the employee's ASSIGNED SHIFT start time + grace
        period (shift-relative) — NOT a fixed clock time
      → status becomes present or late accordingly
Employee clicks Check Out
  → RPC punch_attendance(employee_id, 'check_out')
      → recompute_attendance_hours() derives worked hours, half-day/WFH/overtime status
```
**Not gated by DWR submission** — a function (`assertCheckoutAllowed`/`checkout_allowed` RPC) exists to enforce "you must submit your daily work report before checking out," but it is confirmed dead code: it exists, is correctly implemented, but is never called from the actual check-out flow. Checkout proceeds regardless of DWR status today.

**Disputed**: an employee can request a correction (`request_attendance_regularization`), decided by their lead/HR/admin (`decide_attendance_correction`), capped at a configurable number of requests per month (default 3).

**Pending, not live**: a fixed 10:00 AM / 10:15 AM / 6:30 PM IST clock-time rule (with an explicit "reject check-in before 10 AM" behavior) is fully drafted across three successive migration attempts, all unapplied.

## 3. Leave: Apply → Decide

```
Employee applies (leaveService.apply)
  → leave_types looked up by fuzzy name match
  → total days computed as an inclusive day count
  → INSERT leave_requests (status: pending)
  → (a DB trigger writes a 'request'-type leave_ledger row, debiting the balance)
Lead / HR / Admin decides
  → RPC decide_leave_request(request_id, 'approved'|'rejected', reason)
      → live authorization: can_manage_employee(requesting_employee) — own team/dept
        scope, or admin/hr org-wide. A General-Manager-inclusive version of this check
        is drafted but NOT live.
      → rejection credits the balance back (a 'rejection'-type leave_ledger row)
Employee may cancel (RPC cancel_leave_request) while pending or approved.
```
**Statuses**: `pending → approved | rejected | cancelled`. A rejected request can never later be approved (enforced at the trigger level, not just the RPC).

## 4. Daily Work Report (DWR): Draft → Submit → Review

```
Employee writes today's report
  → saveDraft() → RPC save_dwr_draft_v2 (status: draft)
  → submitReport() → RPC submit_dwr_v2 (status: submitted — live rule includes an
    anti-AI-generated-text guard on description fields)
Lead reviews
  → RPC review_dwr(report_id, 'approved'|'needs-revision', rating, remarks)
      → authorization: can_manage_employee(report's employee) — own team/dept scope
  → needs-revision sends it back to the employee; approved finalizes lead_rating
Lead additionally writes their own team-level conclusion for the day
  → RPC save_team_daily_summary
```
**Pending, not live**: three stacked draft migrations would add a "today's date only" submission restriction and move the late threshold to 8:00 PM IST — none are applied; the live function does not enforce a submission-date restriction or an 8PM threshold the way these drafts describe.

## 5. Goals / KRA / KPI

```
Goal set (by self or assigned by a lead)
  → status: on-track, progress: 0
Employee updates progress → RPC submit_goal_progress (own goal only)
Employee may also edit their own goal's title/target/due-date → RPC update_own_goal
  (never progress or review fields through this path)
Reviewer (lead/HR/admin) reviews → RPC review_goal
  → marking complete always forces progress to 100 server-side

Separately, KRA templates define what's measured; KPI scores are computed
  → RPC compute_kpi_scores — pulls real attendance %, DWR submission rate, task
    on-time rate, lead ratings, PLUS any manually-entered KPI values
  → feeds an overall performance index shown in Org Overview / KRA screens
```
**Goal progress is explicitly NOT auto-wired into KPI scoring** — confirmed by an inline code comment; they are shown side-by-side as reference, not computed from each other.

## 6. Payroll: Structure → Run → Approve → Payslip

```
HR/Admin defines a salary structure per employee (effective-dated)
HR/Admin starts a monthly run
  → upserts payroll_runs for (org, year, month)
  → generates one payroll_records row per active employee, snapshotting whichever
    salary structure was effective as of the run's period-end (a point-in-time
    snapshot, never a live join — later salary edits never retroactively change a
    past payslip)
  → PF and Tax are hardcoded to 0 — no statutory calculation exists
Run status: draft → processed → approved (with a processed → draft reject path;
  no terminal "rejected" state)
On approval
  → every record is marked 'paid'
  → a real PDF payslip is generated client-side (pdf-lib, genuine PDF bytes) per
    employee and uploaded to the private `documents` storage bucket
  → idempotent: records that already have a payslip are skipped on re-approval
Employee downloads their payslip
  → a signed URL to the real stored PDF, or a regenerated PDF on the fly if the
    stored reference looks invalid (handles legacy rows)
```

## 7. Expense Claim: Submit → Approve → Reimburse

```
Employee submits (status: pending)
Lead/HR/Admin decides → approved or rejected (+ reason)
Admin/HR marks an approved claim reimbursed
```
`reimbursed` is just another value of the same status column — no separate payment-date/reference field exists.

## 8. Helpdesk Ticket

```
Employee creates a ticket (status: open)
Admin/HR assigns it to support staff (drawn from profiles where role in admin/hr)
Status updated along the way; resolved_at is auto-stamped only when status becomes
  resolved or closed
```
No confirmed database-level restriction on which status strings are allowed — the vocabulary is effectively whatever the frontend's dropdown offers.

## 9. Asset Request vs. Asset Management (two separate flows)

```
Flow A — employee request:
  Employee requests an asset → asset_requests (status: pending)
  → decided by admin/HR (approved/rejected + reason)

Flow B — physical asset lifecycle (admin/HR only):
  assign → (in use) → markReturned, or sendForRepair (RPC request_asset_repair)
  → return_asset RPC marks it available again
```
These two flows are deliberately separate — approving a *request* does not by itself perform the physical *assignment*; that's a distinct admin/HR action.

## 10. Recruitment: Candidate Pipeline

```
Job opening created (status: open)
Candidate added, with one or more job_applications (each application has its own stage)
Stage progression per application: applied → screening → interview → offer → hired
  (or rejected, a terminal state, at any point)
A candidate's displayed "stage" = their most recent application's stage (derived,
  not a stored column on `candidates` itself)
Job opening closed → status: closed, closed_at stamped
```

## 11. Project & Task Lifecycle

```
Project created (by admin/hr/dept_head/team_lead/general_manager)
Members added with a role_in_project (owner/manager/member)
Tasks created and assigned
  → only the assignee or a project manager/owner can mark a task done
    (DB-enforced, not just a frontend check)
Member removal is blocked while that member has open tasks
Project team chat via Supabase Realtime (polling fallback if the realtime
  channel errors)
```
**Confirmed live gap**: any dept_head or team_lead can see every project in the organization today (an unscoped `is_lead()` check), not just their own team's or department's — a scoped fix is drafted but not applied.

## 12. CRM: Lead → Account/Contact/Deal

```
Lead created (manually, or via Excel import — two modes):
  Initial Import (Day 1): new leads inserted; a phone/email match against an
    existing lead is skipped as a duplicate, never silently overwritten.
  Update Existing Leads (Day 2, enrichment): every row MUST match exactly one
    existing lead by phone (first) or email (second) — matched rows get only their
    mapped, NON-EMPTY fields updated (company, job title, estimated value, listing
    rating, notes). Owner, status, and Hot/Warm/Cold temperature are NEVER touched
    by import in either mode. Unmatched or ambiguous (matches more than one lead)
    rows are skipped and reported for manual review — never guessed by name.
  Neither mode ever deletes a previous import batch (a prior cross-uploader
    deletion bug was found and fixed this session).

Sales rep calls the lead, updates:
  Hot/Warm/Cold rating, status (new → contacted → qualified → ...), logs an
    activity (call/meeting/email) — call outcomes have real server-side effects:
    e.g. "wrong number" auto-sets the lead to unqualified; certain outcomes
    auto-schedule a follow-up date on the lead.

Lead converted → RPC convert_crm_lead
  → creates (or reuses, if the user picks an existing match) an account and a
    contact, optionally a deal
  → lead status becomes converted, with converted_account_id/contact_id/deal_id
    recorded for traceability

Deal moves through stages: prospecting → qualification → proposal → negotiation
  → won | lost
  → probability and closed_at are forced server-side by a database trigger based
    on the stage, regardless of what the client sends
  → moving to "lost" requires a reason (enforced client-side, routed through the
    full edit dialog even from the quick board-view stage selector)
```
Verified end-to-end (create → assign → temperature → contact → follow-up → qualify → convert → deal stages → won) by actual execution against a disposable local Postgres database earlier this session — not just read from code.
