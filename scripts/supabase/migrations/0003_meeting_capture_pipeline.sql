create type public.meeting_processing_status as enum (
  'draft',
  'uploaded',
  'processing',
  'completed',
  'failed'
);

alter table public.meetings
add column user_id uuid references auth.users(id) on delete cascade,
add column meeting_date date,
add column audio_storage_path text,
add column duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
add column processing_status public.meeting_processing_status not null default 'draft',
add column tags text[] not null default '{}';

update public.meetings
set
  user_id = owner_id,
  meeting_date = coalesce(scheduled_at::date, created_at::date)
where user_id is null;

alter table public.meetings
alter column user_id set not null,
alter column meeting_date set not null;

create index meetings_user_id_idx on public.meetings(user_id);
create index meetings_meeting_date_idx on public.meetings(meeting_date desc);
create index meetings_processing_status_idx on public.meetings(processing_status);

insert into storage.buckets (id, name, public)
values ('meeting-audio', 'meeting-audio', false)
on conflict (id) do nothing;

create policy "Users read own meeting audio objects"
on storage.objects
for select
using (
  bucket_id = 'meeting-audio'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users upload own meeting audio objects"
on storage.objects
for insert
with check (
  bucket_id = 'meeting-audio'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users update own meeting audio objects"
on storage.objects
for update
using (
  bucket_id = 'meeting-audio'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'meeting-audio'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users delete own meeting audio objects"
on storage.objects
for delete
using (
  bucket_id = 'meeting-audio'
  and (storage.foldername(name))[1] = auth.uid()::text
);
