-- Data-quality fixes to unblock UI/display synchronisation issues.
-- No schema/table changes here except the attendance uniqueness guard.

-- 1) Attendance: collapse duplicate rows for employee_id+attendance_date left
--    over from earlier testing (each punch should be one row per day), then
--    guard against it recurring.
update public.attendance_records ar
set check_in = merged.best_check_in,
    check_out = merged.best_check_out
from (
  select employee_id, attendance_date,
         (array_agg(id order by id))[1] as keep_id,
         (array_agg(check_in order by (check_in is null) asc, check_in asc))[1] as best_check_in,
         (array_agg(check_out order by (check_out is null) asc, check_out desc))[1] as best_check_out
  from public.attendance_records
  group by employee_id, attendance_date
) merged
where ar.id = merged.keep_id;

delete from public.attendance_records ar
using (
  select employee_id, attendance_date,
         (array_agg(id order by id))[1] as keep_id
  from public.attendance_records
  group by employee_id, attendance_date
) merged
where ar.employee_id = merged.employee_id
  and ar.attendance_date = merged.attendance_date
  and ar.id <> merged.keep_id;

alter table public.attendance_records
  add constraint attendance_records_employee_date_unique unique (employee_id, attendance_date);

-- 2) Normalise stray status spellings left over from manual testing so
--    every status filter/card (which match the app's canonical hyphenated
--    vocabulary, same as StatusBadge) picks these rows up correctly.
update public.goals set status = 'on-track' where status in ('on_track', 'in_progress');
update public.goals set status = 'at-risk' where status = 'at_risk';
update public.performance_reviews set status = 'in-progress' where status = 'Inprogress';

-- 3) AST001 was seeded with status='assigned' but no linking assignment row,
--    so "Assigned to" and asset history could never show who holds it.
insert into public.asset_assignments (asset_id, employee_id, assigned_at, condition_on_assignment)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '88888888-8888-8888-8888-888888888881', '2026-06-01', 'good'
where not exists (
  select 1 from public.asset_assignments where asset_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' and returned_at is null
);

-- 4) Minimal realistic attendance rows so every status filter/card
--    (late, wfh, half-day, absent, leave) has real data to display --
--    there is no UI flow to record anything but present/absent via
--    check-in/out, so this is seeded directly like the rest of the demo data.
insert into public.attendance_records (employee_id, attendance_date, check_in, check_out, status, worked_hours, source)
values
  ('88888888-8888-8888-8888-888888888881', '2026-08-18', '2026-08-18T10:35:00+00:00', '2026-08-18T18:30:00+00:00', 'late', 7.9, 'web'),
  ('88888888-8888-8888-8888-888888888882', '2026-08-18', '2026-08-18T09:30:00+00:00', '2026-08-18T18:00:00+00:00', 'wfh', 8.5, 'web'),
  ('88888888-8888-8888-8888-888888888883', '2026-08-18', '2026-08-18T09:30:00+00:00', '2026-08-18T13:30:00+00:00', 'half-day', 4, 'web'),
  ('88888888-8888-8888-8888-888888888884', '2026-08-18', null, null, 'absent', 0, 'web'),
  ('88888888-8888-8888-8888-888888888881', '2026-08-19', null, null, 'leave', 0, 'web')
on conflict (employee_id, attendance_date) do nothing;

-- 5) Minimal realistic recruitment records so every pipeline stage
--    (applied, offer, hired, rejected -- screening/interview already exist)
--    has real data to verify against; there is no candidate-creation UI in
--    this app, so this is seeded directly like the rest of the demo data.
insert into public.candidates (id, name, email, phone, experience_years, source, current_company, expected_salary)
values
  ('cccccccc-cccc-cccc-cccc-ccccccccccc3', 'Ananya Iyer', 'ananya.iyer@sample-candidates.test', '9876543212', 2.5, 'Naukri', 'BrightWorks', 650000),
  ('cccccccc-cccc-cccc-cccc-ccccccccccc4', 'Karan Mehta', 'karan.mehta@sample-candidates.test', '9876543213', 6, 'Referral', 'CloudNine', 1100000),
  ('cccccccc-cccc-cccc-cccc-ccccccccccc5', 'Divya Nair', 'divya.nair@sample-candidates.test', '9876543214', 4, 'LinkedIn', 'PixelWorks', 850000),
  ('cccccccc-cccc-cccc-cccc-ccccccccccc6', 'Rohit Malhotra', 'rohit.malhotra@sample-candidates.test', '9876543215', 3, 'Naukri', 'DevSpark', 700000)
on conflict (id) do nothing;

insert into public.job_applications (job_id, candidate_id, stage, status, applied_at)
values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'cccccccc-cccc-cccc-cccc-ccccccccccc3', 'applied', 'in_progress', '2026-08-20T04:00:00+00:00'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'cccccccc-cccc-cccc-cccc-ccccccccccc4', 'offer', 'in_progress', '2026-08-05T04:00:00+00:00'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'cccccccc-cccc-cccc-cccc-ccccccccccc5', 'hired', 'closed', '2026-07-20T04:00:00+00:00'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'cccccccc-cccc-cccc-cccc-ccccccccccc6', 'rejected', 'closed', '2026-08-10T04:00:00+00:00')
on conflict do nothing;
