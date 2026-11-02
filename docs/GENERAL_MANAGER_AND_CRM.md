# General Manager role & Sales CRM

Two additions on top of the existing five roles (Super Admin, HR, Department Head, Team Lead, Employee):

1. **General Manager** (`profiles.role = 'general_manager'`): a leadership account that reads everyone's work reports and KPIs across the organisation.
2. **Sales CRM**: leads, deals pipeline, accounts, contacts and activities. It is shown only to people in a sales department, plus Super Admin and General Manager.

## Rolling it out

1. **Apply the migrations** to the Supabase project, in order:
   - `supabase/migrations/20261102100000_general_manager_role.sql`
   - `supabase/migrations/20261102110000_sales_crm.sql`

   Both are idempotent and safe to re-run. The app keeps working before they are applied: the CRM simply stays hidden, and nobody can hold the new role yet.
2. **Make someone a General Manager**: Super Admin → *Role management* → change the person's role to *General Manager*. HR cannot grant or change this role. Neither can approval of onboarding by HR.
3. **Mark sales departments**: departments whose name contains the word "sales" are flagged automatically, both existing ones and new ones. Super Admin or HR can switch any department on or off from *Departments* → *Sales team · CRM access*. Members see the CRM after their next page load.

## General Manager

| Area | General Manager can | Notes |
|---|---|---|
| Daily work reports + items, team conclusions, AI DWR analyses | Read, whole organisation | No review, reopen or waive. Those stay with the reporting lead, HR and Super Admin |
| KRA assignments, KPI scores, performance index, org performance board | Read, whole organisation | Cannot author templates, assign KRAs or recompute scores |
| Tasks, projects and project members | Read, whole organisation | Can comment on tasks; cannot assign or edit them |
| Attendance, leave, goals, performance reviews | Read, whole organisation | No approvals, except for people who actually report to the GM |
| Employee directory | Read, whole organisation | |
| Payroll, salary, payslips | **No** | Unchanged: admin + HR + self |
| Documents, bank, address, family, education, experience, identity, emergency contacts | **No** | Personal records stay with admin/HR/lead scope |
| Expense claims, helpdesk tickets | **No** (outside own lead scope) | |
| Sales CRM | Read-only, everything | |

How it is enforced (in `20261102100000_general_manager_role.sql`):

- `can_view_employee(emp)` is now `can_view_employee_scoped(emp)` (the original admin/HR/lead rule) **or** "caller is a General Manager and the employee is in the same organisation". Every work, KPI and performance policy and RPC already went through `can_view_employee`, so they all pick this up.
- `can_manage_employee(emp)` uses the scoped rule only. Org-wide read never turns into org-wide approve or edit. A GM still manages anyone with `manager_id = GM` or in a department the GM heads, like any lead.
- Personal-record policies (documents and their storage objects, bank, address, family, education, experience, emergency contacts, helpdesk, expenses) were switched to `can_view_employee_scoped`, so they do not widen.
- `org_employee_metrics` (behind the org performance board) admits the GM. Projects, project members and team summaries list the GM next to admin/HR.
- `set_employee_role` / `approve_employee_onboarding` accept the role. Only a Super Admin may grant or remove it, and HR cannot manage a GM's records.

### Org Overview page (`/org-overview`)

Visible to General Manager, Super Admin and HR. It has a month picker and three tabs:

- **People & KPIs**: one row per active employee with performance index and band, attendance %, tasks done %, reports filed (on-time + late vs missed), average lead rating, last report. Filter by department or band. Click a person for a side panel with their KPI breakdown (target, actual, score), a 6-month performance trend, and every daily report that month (opens read-only).
- **Departments**: department comparison, top performers, needs attention.
- **Work reports**: an org-wide feed of daily reports for any date range, filterable by status, with blockers shown inline.

Data comes from the existing `org_performance_board` plus a new `org_work_report_rollup(p_from, p_to)`. That function is `SECURITY INVOKER`, so RLS decides what each caller aggregates.

The GM's dashboard swaps payroll and leave-approval cards for open positions and a "Needs attention" list. *Work → Team Reports* shows every report read-only.

## Sales CRM (`/crm`)

The page has six tabs: **Overview** (open pipeline, weighted forecast, won this month, win rate, open/hot leads, overdue follow-ups, pipeline by stage, upcoming follow-ups, team leaderboard), **Leads**, **Deals** (board by stage with move-to-stage, or a list), **Accounts** (with open/won value and contact count), **Contacts** and **Activities** (calls, meetings, emails, tasks, notes with IST due times; mark done).

**Lead conversion** (`convert_crm_lead`) creates an account and a contact, optionally an open deal, and moves the lead's activities onto them. A converted lead cannot be converted again.

| Who | Sees | Creates | Edits / deletes | Reassigns owner |
|---|---|---|---|---|
| Sales rep (member of a sales department) | All CRM records in the org | Yes (owned by self) | Own records | No |
| Sales lead (Dept Head / Team Lead in a sales dept, or head of a sales dept) | All | Yes | Anyone's | Yes |
| Super Admin | All | Yes | Anyone's | Yes |
| General Manager | All | No | No | No |
| Everyone else | Nothing (no menu; `/crm` redirects to *Unauthorized*) | — | — | — |

Enforcement lives in `20261102110000_sales_crm.sql`: RLS on every `crm_*` table (`has_crm_access`, `crm_can_write`, `crm_can_manage_all`), plus a `crm_before_write` trigger. The trigger stamps the organisation, creator and timestamps; refuses cross-organisation links; and blocks handing records to others unless the caller is a sales lead or admin. It also keeps deal probability and closing dates consistent with the stage (won = 100%, lost = 0% and a reason is required). The app reads `my_crm_access()` once per session to decide whether to show the menu.

## Verification

- `supabase/tests/gm_crm/run.sh`: builds a throwaway Postgres database from a minimal stand-in of the live schema, applies both migrations, and runs RLS checks as GM, HR, a team lead, sales reps, a sales lead, a non-sales employee and a user from another organisation. Use a disposable local Postgres, never production.
- `npx tsc --noEmit`, `npm run build` and ESLint (no new findings) all pass.
