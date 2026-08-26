-- Manager is already listed in ROUTE_ROLES for /documents, and every other
-- team-scoped module (attendance, leave, goals, performance) grants Manager
-- self + direct-reports read access -- Documents was the one inconsistency:
-- the route allowed a Manager in, but neither the documents table nor the
-- storage bucket ever granted them anything, so the page silently rendered
-- zero rows. This makes Manager's access match the established pattern
-- everywhere else: read-only, team-scoped, no upload-for-others (uploading
-- on someone else's behalf stays an admin/hr-only action, unchanged).
create policy documents_manager_view_team on public.documents for select
  using (is_manager() and is_my_direct_report(employee_id));

-- Same split_part/text-compare idiom as employee_documents_admin_hr_select,
-- so a malformed object path fails the comparison instead of erroring on a
-- uuid cast.
create policy employee_documents_manager_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and is_manager()
    and exists (
      select 1 from public.employees e
      where e.id::text = split_part(name, '/', 1)
        and e.manager_id = current_employee_id()
    )
  );
