-- Repair and document the database contract used by browser meeting capture.
-- The bucket remains private and every object policy requires the first path
-- segment to be the authenticated user's UUID.

insert into storage.buckets (id, name, public)
values ('meeting-audio', 'meeting-audio', false)
on conflict (id) do update set public = false;

drop policy if exists "Users read own meeting audio objects"
on storage.objects;

create policy "Users read own meeting audio objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'meeting-audio'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users upload own meeting audio objects"
on storage.objects;

create policy "Users upload own meeting audio objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'meeting-audio'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users update own meeting audio objects"
on storage.objects;

create policy "Users update own meeting audio objects"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'meeting-audio'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'meeting-audio'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users delete own meeting audio objects"
on storage.objects;

create policy "Users delete own meeting audio objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'meeting-audio'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users manage own meetings"
on public.meetings;

drop policy if exists "Users insert own meetings"
on public.meetings;

create policy "Users insert own meetings"
on public.meetings
for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists "Users select own meetings"
on public.meetings;

create policy "Users select own meetings"
on public.meetings
for select
to authenticated
using (owner_id = auth.uid());

drop policy if exists "Users update own meetings"
on public.meetings;

create policy "Users update own meetings"
on public.meetings
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "Users delete own meetings"
on public.meetings;

create policy "Users delete own meetings"
on public.meetings
for delete
to authenticated
using (owner_id = auth.uid());
