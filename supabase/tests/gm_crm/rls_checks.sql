\set ON_ERROR_STOP 0
-- Seed (as superuser)
insert into organizations (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Org A'),
  ('00000000-0000-0000-0000-0000000000a2', 'Org B');
insert into departments (id, organization_id, name) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'Sales'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', 'Engineering'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a2', 'Inside Sales');
select name, is_sales from departments order by name;  -- trigger/backfill check

insert into profiles (id, full_name, role) values
  ('10000000-0000-0000-0000-000000000001', 'Ada Admin', 'admin'),
  ('10000000-0000-0000-0000-000000000002', 'Gita GM', 'general_manager'),
  ('10000000-0000-0000-0000-000000000003', 'Hari HR', 'hr'),
  ('10000000-0000-0000-0000-000000000004', 'Sam SalesLead', 'team_lead'),
  ('10000000-0000-0000-0000-000000000005', 'Ravi Rep', 'employee'),
  ('10000000-0000-0000-0000-000000000006', 'Rina Rep', 'employee'),
  ('10000000-0000-0000-0000-000000000007', 'Eli Eng', 'employee'),
  ('10000000-0000-0000-0000-000000000008', 'Lea EngLead', 'team_lead'),
  ('10000000-0000-0000-0000-000000000009', 'Bo OtherOrgRep', 'employee');
insert into employees (id, organization_id, profile_id, department_id, manager_id, first_name, last_name) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', null, null, 'Ada', 'Admin'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000002', null, null, 'Gita', 'GM'),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000003', null, null, 'Hari', 'HR'),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000d1', null, 'Sam', 'Lead'),
  ('20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-000000000004', 'Ravi', 'Rep'),
  ('20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-000000000004', 'Rina', 'Rep'),
  ('20000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000d2', null, 'Lea', 'EngLead'),
  ('20000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000d2', '20000000-0000-0000-0000-000000000008', 'Eli', 'Eng'),
  ('20000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000d3', null, 'Bo', 'Other');
insert into daily_work_reports (organization_id, employee_id, report_date, status, total_hours, review_status, lead_rating) values
  ('00000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-000000000005', current_date - 1, 'submitted', 8, 'approved', 4),
  ('00000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-000000000007', current_date - 1, 'late', 7, 'pending', null),
  ('00000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-000000000007', current_date - 2, 'missed', 0, 'pending', null),
  ('00000000-0000-0000-0000-0000000000a2', '20000000-0000-0000-0000-000000000009', current_date - 1, 'submitted', 8, 'pending', null);
insert into employee_bank_accounts (employee_id) values ('20000000-0000-0000-0000-000000000007');
alter table employee_bank_accounts enable row level security;

\echo '==== GM (Gita): org-wide read, no manage, no personal records'
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', false);
select 'gm can_view eng' as t, can_view_employee('20000000-0000-0000-0000-000000000007') as expect_true;
select 'gm can_manage eng' as t, can_manage_employee('20000000-0000-0000-0000-000000000007') as expect_false;
select 'gm can_view other org' as t, can_view_employee('20000000-0000-0000-0000-000000000009') as expect_false;
select 'gm employees visible' as t, count(*) as expect_8 from employees;
select 'gm dwr visible' as t, count(*) as expect_3 from daily_work_reports;
select 'gm bank rows' as t, count(*) as expect_0 from employee_bank_accounts;
select employee_name, submitted_count, late_count, missed_count, approved_count, pending_review_count, avg_lead_rating, total_hours
  from org_work_report_rollup(current_date - 30, current_date) where submitted_count + late_count + missed_count > 0;
select 'gm crm access' as t, my_crm_access();
select 'gm crm insert (expect RLS error)' as t;
insert into crm_leads (first_name) values ('GM lead');
reset role;

\echo '==== Eng lead (Lea): unchanged team scope'
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000008', false);
select 'lead view own report' as t, can_view_employee('20000000-0000-0000-0000-000000000007') as expect_true,
       can_manage_employee('20000000-0000-0000-0000-000000000007') as manage_expect_true,
       can_view_employee('20000000-0000-0000-0000-000000000005') as sales_rep_expect_false;
select 'lead bank rows' as t, count(*) as expect_1 from employee_bank_accounts;
select 'lead crm' as t, my_crm_access();
reset role;

\echo '==== HR (Hari): cannot manage GM; cannot assign GM role'
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', false);
select 'hr manage gm' as t, can_manage_employee('20000000-0000-0000-0000-000000000002') as expect_false,
       can_manage_employee('20000000-0000-0000-0000-000000000007') as eng_expect_true;
select 'hr assign GM (expect error)' as t;
select set_employee_role('20000000-0000-0000-0000-000000000007', 'general_manager');
reset role;

\echo '==== Rep Ravi: creates, cannot hand to others'
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', false);
select 'rep crm' as t, my_crm_access();
insert into crm_leads (id, first_name, company, estimated_value) values
  ('30000000-0000-0000-0000-000000000001', 'Meera', 'Acme Pvt Ltd', 250000);
select 'rep lead owner = self' as t, owner_id = '20000000-0000-0000-0000-000000000005' as expect_true, organization_id from crm_leads;
select 'rep assign to Rina (expect error)' as t;
insert into crm_leads (first_name, owner_id) values ('X', '20000000-0000-0000-0000-000000000006');
reset role;

\echo '==== Rep Rina: sees Ravi lead, cannot edit it'
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000006', false);
select 'rina sees leads' as t, count(*) as expect_1 from crm_leads;
with u as (update crm_leads set notes = 'hijack' returning 1) select 'rina update rows' as t, count(*) as expect_0 from u;
with d as (delete from crm_leads returning 1) select 'rina delete rows' as t, count(*) as expect_0 from d;
reset role;

\echo '==== Sales lead Sam: can edit and reassign'
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', false);
select 'sam crm' as t, my_crm_access();
with u as (update crm_leads set status = 'qualified', owner_id = '20000000-0000-0000-0000-000000000006' returning 1) select 'sam update rows' as t, count(*) as expect_1 from u;
select 'owner directory' as t, string_agg(full_name, ', ' order by full_name) from crm_owner_directory();
reset role;

\echo '==== Rina converts the (now hers) lead'
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000006', false);
select 'convert' as t, convert_crm_lead('30000000-0000-0000-0000-000000000001', true, null, null, null) ? 'deal_id' as expect_true;
select status, converted_at is not null as converted from crm_leads;
select name, amount, stage, probability from crm_deals;
update crm_deals set stage = 'won';
select 'won deal' as t, probability as expect_100, closed_at is not null as closed from crm_deals;
insert into crm_activities (activity_type, subject, status, deal_id) select 'call', 'Kickoff call', 'done', id from crm_deals;
select 'activity completed_at set' as t, completed_at is not null as expect_true from crm_activities;
select 'convert again (expect error)' as t;
select convert_crm_lead('30000000-0000-0000-0000-000000000001');
reset role;

\echo '==== Engineer Eli: no CRM'
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000007', false);
select 'eng crm' as t, my_crm_access();
select 'eng sees leads' as t, count(*) as expect_0 from crm_leads;
select 'eng insert (expect RLS error)' as t;
insert into crm_accounts (name) values ('Nope');
select 'eng owner directory' as t, count(*) as expect_0 from crm_owner_directory();
reset role;

\echo '==== Other-org rep Bo: isolation'
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000009', false);
select 'bo crm' as t, (my_crm_access()->>'has_access') as expect_true;
select 'bo sees org A crm' as t, (select count(*) from crm_leads) + (select count(*) from crm_deals) + (select count(*) from crm_accounts) as expect_0;
reset role;

\echo '==== GM sees CRM read-only, Admin manages'
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', false);
select 'gm sees deals' as t, count(*) as expect_1 from crm_deals;
with u as (update crm_deals set notes = 'x' returning 1) select 'gm update rows' as t, count(*) as expect_0 from u;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
select 'admin crm' as t, my_crm_access();
with u as (update crm_deals set notes = 'admin note' returning 1) select 'admin update rows' as t, count(*) as expect_1 from u;
select 'admin set flag on Engineering' as t;
select set_department_sales_flag('00000000-0000-0000-0000-0000000000d2', true);
reset role;
select name, is_sales from departments order by name;
