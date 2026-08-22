-- HR/Admin manage documents for any employee in their organisation, not just
-- their own. The existing employee_documents_* policies only ever matched
-- the caller's own employee_id against the storage path, so an admin/hr
-- upload for a colleague was rejected before the request even reached the
-- documents table. These are additive grants -- the existing self-service
-- policies are untouched.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'employee_documents_admin_hr_select'
  ) THEN
    CREATE POLICY employee_documents_admin_hr_select ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'documents'
        AND public.is_admin_or_hr()
        AND EXISTS (
          SELECT 1 FROM public.employees e
          WHERE e.id::text = split_part(name, '/', 1)
            AND e.organization_id = public.current_org_id()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'employee_documents_admin_hr_insert'
  ) THEN
    CREATE POLICY employee_documents_admin_hr_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'documents'
        AND public.is_admin_or_hr()
        AND EXISTS (
          SELECT 1 FROM public.employees e
          WHERE e.id::text = split_part(name, '/', 1)
            AND e.organization_id = public.current_org_id()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'employee_documents_admin_hr_delete'
  ) THEN
    CREATE POLICY employee_documents_admin_hr_delete ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'documents'
        AND public.is_admin_or_hr()
        AND EXISTS (
          SELECT 1 FROM public.employees e
          WHERE e.id::text = split_part(name, '/', 1)
            AND e.organization_id = public.current_org_id()
        )
      );
  END IF;
END $$;
