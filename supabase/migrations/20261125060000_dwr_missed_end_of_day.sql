-- Missed cutoff: a report is "missed" once its own calendar date has
-- ended in IST (00:00 IST the next day), not 10:00 AM the day after.
-- late_until no longer depends on shift_end/overnight status at all.
create or replace function public.dwr_shift_bounds(p_employee_id uuid, p_date date)
returns table(window_open timestamptz, shift_end timestamptz, late_until timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_start time;
  v_end time;
  v_overnight boolean;
  v_shift_end timestamptz;
begin
  select s.start_time, s.end_time, coalesce(s.is_overnight, false)
    into v_start, v_end, v_overnight
  from public.employees e
  left join public.shifts s on s.id = e.shift_id
  where e.id = p_employee_id;

  v_start := coalesce(v_start, time '09:30');
  v_end := coalesce(v_end, time '18:30');
  v_overnight := coalesce(v_overnight, false);

  if v_overnight then
    v_shift_end := ((p_date + 1) + v_end) at time zone 'Asia/Kolkata';
  else
    v_shift_end := (p_date + v_end) at time zone 'Asia/Kolkata';
  end if;

  window_open := v_shift_end - interval '30 minutes';
  shift_end := v_shift_end;
  late_until := ((p_date + 1)::timestamp) at time zone 'Asia/Kolkata';
  return next;
end;
$fn$;

-- Re-point the cron at end-of-day instead of 10 AM next day. Dates are
-- still derived from IST "now," not UTC current_date, same two-day
-- catch-up as before -- only the time-of-day and which date just ended
-- change.
do $$
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron is not installed. Call mark_missed_dwrs manually.';
    return;
  end if;

  begin
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'mark_missed_dwrs_daily';
  exception when others then
    raise notice 'Could not clear existing mark_missed_dwrs_daily cron job: %', sqlerrm;
  end;

  begin
    perform cron.schedule(
      'mark_missed_dwrs_daily',
      '35 18 * * *',
      $cmd$select public.mark_missed_dwrs((timezone('Asia/Kolkata', now()))::date - 1); select public.mark_missed_dwrs((timezone('Asia/Kolkata', now()))::date - 2);$cmd$
    );
  exception when others then
    raise notice 'Could not schedule mark_missed_dwrs_daily: %', sqlerrm;
  end;
end;
$$;
