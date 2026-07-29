-- Reassert the authenticated-user policies required by browser meeting capture.
-- This migration is idempotent so it can repair production projects where the
-- meeting-audio bucket exists but the original RLS policies were not applied.

insert into storage.buckets (id, name, public)
values ('meeting-audio', 'meeting-audio', false)
on conflict (id) do update set public = false;

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

drop policy if exists "Users insert own meetings"
on public.meetings;

create policy "Users insert own meetings"
on public.meetings
for insert
to authenticated
with check (
  owner_id = auth.uid()
);

drop policy if exists "Users insert attachments for own meetings"
on public.attachments;

create policy "Users insert attachments for own meetings"
on public.attachments
for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and exists (
    select 1
    from public.meetings
    where meetings.id = attachments.meeting_id
      and meetings.owner_id = auth.uid()
  )
);
