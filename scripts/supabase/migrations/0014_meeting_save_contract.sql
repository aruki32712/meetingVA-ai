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

-- These are the columns read by the meetings list. Earlier migrations create
-- them; IF NOT EXISTS also repairs an environment that missed migration 0003.
alter table public.meetings
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists meeting_date date,
  add column if not exists duration_seconds integer
    check (duration_seconds is null or duration_seconds >= 0),
  add column if not exists processing_status public.meeting_processing_status
    not null default 'draft';

update public.meetings
set
  user_id = coalesce(user_id, owner_id),
  meeting_date = coalesce(meeting_date, scheduled_at::date, created_at::date)
where user_id is null or meeting_date is null;

alter table public.meetings
  alter column user_id set not null,
  alter column meeting_date set not null;

create index if not exists meetings_user_id_idx on public.meetings(user_id);
create index if not exists meetings_meeting_date_idx
on public.meetings(meeting_date desc);
create index if not exists meetings_processing_status_idx
on public.meetings(processing_status);

drop policy if exists "Users manage own meetings"
on public.meetings;

drop policy if exists "Users insert own meetings"
on public.meetings;

create policy "Users insert own meetings"
on public.meetings
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users select own meetings"
on public.meetings;

create policy "Users select own meetings"
on public.meetings
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users update own meetings"
on public.meetings;

create policy "Users update own meetings"
on public.meetings
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users delete own meetings"
on public.meetings;

create policy "Users delete own meetings"
on public.meetings
for delete
to authenticated
using (user_id = auth.uid());
