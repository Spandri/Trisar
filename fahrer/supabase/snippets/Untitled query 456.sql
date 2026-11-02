-- Alte Policies entfernen (falls schon angelegt)
drop policy if exists "avatars_upload_own" on storage.objects;
drop policy if exists "avatars_read_own" on storage.objects;
drop policy if exists "avatars_update_own" on storage.objects;
drop policy if exists "avatars_delete_own" on storage.objects;

-- Upload erlaubt für alle authenticated (in beliebige Pfade)
create policy "avatars_upload_all"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'avatars');

-- Lesen erlaubt für alle authenticated
create policy "avatars_read_all"
on storage.objects
for select
to authenticated
using (bucket_id = 'avatars');

-- Update erlaubt für alle authenticated
create policy "avatars_update_all"
on storage.objects
for update
to authenticated
using (bucket_id = 'avatars')
with check (bucket_id = 'avatars');

-- Löschen erlaubt für alle authenticated
create policy "avatars_delete_all"
on storage.objects
for delete
to authenticated
using (bucket_id = 'avatars');
