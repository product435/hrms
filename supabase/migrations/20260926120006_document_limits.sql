-- Limit the private documents bucket to 10 MB and pdf/png/jpeg/webp.
-- Existing select, insert, and delete grants are unchanged, including the
-- lead block on kyc/bank object paths and Identity/Bank/KYC document rows.

update storage.buckets
set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
where id = 'documents';

do $$
begin
  if not exists (
    select 1
    from storage.buckets
    where id = 'documents'
      and public = false
      and file_size_limit = 10485760
      and allowed_mime_types @> array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
  ) then
    raise exception 'documents bucket limits were not applied';
  end if;
end $$;

drop policy if exists documents_upload_extension on storage.objects;
create policy documents_upload_extension on storage.objects
  as restrictive
  for insert
  to authenticated
  with check (
    bucket_id is distinct from 'documents'
    or lower(substring(name from '\.([^.]+)$')) in ('pdf', 'png', 'jpg', 'jpeg', 'webp')
  );
