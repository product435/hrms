-- Employee document storage is private. Files are stored under <employee_id>/<uuid>-<filename>.
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'employee_documents_select'
  ) THEN
    CREATE POLICY employee_documents_select ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'documents'
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.employee_id::text = split_part(name, '/', 1)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'employee_documents_insert'
  ) THEN
    CREATE POLICY employee_documents_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'documents'
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.employee_id::text = split_part(name, '/', 1)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'employee_documents_delete'
  ) THEN
    CREATE POLICY employee_documents_delete ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'documents'
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.employee_id::text = split_part(name, '/', 1)
        )
      );
  END IF;
END $$;
