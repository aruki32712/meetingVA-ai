alter type public.meeting_processing_status add value if not exists 'queued';
alter type public.meeting_processing_status add value if not exists 'cancelled';

create type public.processing_job_type as enum (
  'transcription',
  'analysis'
);

create type public.processing_job_status as enum (
  'queued',
  'transcribing',
  'transcribed',
  'analyzing',
  'analyzed',
  'failed',
  'cancelled'
);

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  job_type public.processing_job_type not null,
  status public.processing_job_status not null default 'queued',
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  retry_count integer not null default 0 check (retry_count >= 0),
  worker_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index processing_jobs_meeting_id_created_at_idx
on public.processing_jobs(meeting_id, created_at desc);

create index processing_jobs_status_created_at_idx
on public.processing_jobs(status, created_at desc);

create trigger set_processing_jobs_updated_at
before update on public.processing_jobs
for each row execute function public.set_updated_at();

alter table public.processing_jobs enable row level security;

create policy "Users read own processing jobs"
on public.processing_jobs
for select
using (exists (
  select 1 from public.meetings
  where meetings.id = processing_jobs.meeting_id
    and (meetings.owner_id = auth.uid() or meetings.user_id = auth.uid())
));

comment on table public.processing_jobs is
  'Durable job tracking for asynchronous MeetingVA AI transcription and analysis work. Backend and workers write with the service role; users may read only jobs for their own meetings.';
