-- Reconcile the complete background-processing schema derived from the
-- application. processing_jobs must exist before processing_events.

do $$
begin
  create type public.processing_job_type as enum (
    'transcription',
    'analysis'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  if exists (
    select 1
    from unnest(array['transcription', 'analysis']) as expected(value)
    where not exists (
      select 1
      from pg_enum
      join pg_type on pg_type.oid = pg_enum.enumtypid
      join pg_namespace on pg_namespace.oid = pg_type.typnamespace
      where pg_namespace.nspname = 'public'
        and pg_type.typname = 'processing_job_type'
        and pg_enum.enumlabel = expected.value
    )
  ) then
    raise exception 'processing_job_type is missing an application-required value';
  end if;
end
$$;

do $$
begin
  create type public.processing_job_status as enum (
    'queued',
    'transcribing',
    'transcribed',
    'analyzing',
    'analyzed',
    'failed',
    'cancelled'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  if exists (
    select 1
    from unnest(array[
      'queued',
      'transcribing',
      'transcribed',
      'analyzing',
      'analyzed',
      'failed',
      'cancelled'
    ]) as expected(value)
    where not exists (
      select 1
      from pg_enum
      join pg_type on pg_type.oid = pg_enum.enumtypid
      join pg_namespace on pg_namespace.oid = pg_type.typnamespace
      where pg_namespace.nspname = 'public'
        and pg_type.typname = 'processing_job_status'
        and pg_enum.enumlabel = expected.value
    )
  ) then
    raise exception 'processing_job_status is missing an application-required value';
  end if;
end
$$;

create table if not exists public.processing_jobs (
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

alter table public.processing_jobs
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists meeting_id uuid
    references public.meetings(id) on delete cascade,
  add column if not exists job_type public.processing_job_type,
  add column if not exists status public.processing_job_status
    not null default 'queued',
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists error_message text,
  add column if not exists retry_count integer not null default 0
    check (retry_count >= 0),
  add column if not exists worker_version text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists processing_jobs_meeting_id_created_at_idx
on public.processing_jobs(meeting_id, created_at desc);

create index if not exists processing_jobs_status_created_at_idx
on public.processing_jobs(status, created_at desc);

alter table public.processing_jobs enable row level security;

drop policy if exists "Users read own processing jobs"
on public.processing_jobs;

create policy "Users read own processing jobs"
on public.processing_jobs
for select
to authenticated
using (
  exists (
    select 1
    from public.meetings
    where meetings.id = processing_jobs.meeting_id
      and meetings.owner_id = auth.uid()
  )
);

revoke all on public.processing_jobs from public, anon, authenticated;
grant select on public.processing_jobs to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_processing_jobs_updated_at
on public.processing_jobs;

create trigger set_processing_jobs_updated_at
before update on public.processing_jobs
for each row execute function public.set_updated_at();

create table if not exists public.processing_events (
  id uuid primary key default gen_random_uuid(),
  event_order bigint generated always as identity,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.processing_jobs(id) on delete set null,
  job_type public.processing_job_type,
  event_type text not null check (event_type in (
    'meeting_created',
    'audio_uploaded',
    'queued',
    'transcription_started',
    'transcription_completed',
    'transcription_failed',
    'analysis_started',
    'analysis_completed',
    'analysis_failed'
  )),
  status text not null check (
    status in ('pending', 'current', 'completed', 'failed')
  ),
  message text not null,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.processing_events
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists event_order bigint generated always as identity,
  add column if not exists meeting_id uuid
    references public.meetings(id) on delete cascade,
  add column if not exists user_id uuid
    references auth.users(id) on delete cascade,
  add column if not exists job_id uuid
    references public.processing_jobs(id) on delete set null,
  add column if not exists job_type public.processing_job_type,
  add column if not exists event_type text,
  add column if not exists status text,
  add column if not exists message text,
  add column if not exists error_message text,
  add column if not exists created_at timestamptz not null default now();

create index if not exists processing_events_meeting_id_created_at_idx
on public.processing_events(meeting_id, created_at asc, event_order asc);

create index if not exists processing_events_user_id_created_at_idx
on public.processing_events(user_id, created_at desc);

create index if not exists processing_events_job_id_idx
on public.processing_events(job_id)
where job_id is not null;

alter table public.processing_events enable row level security;

drop policy if exists "Users read own processing events"
on public.processing_events;

create policy "Users read own processing events"
on public.processing_events
for select
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.meetings
    where meetings.id = processing_events.meeting_id
      and meetings.owner_id = auth.uid()
  )
);

revoke all on public.processing_events from public, anon, authenticated;
grant select on public.processing_events to authenticated;

create or replace function public.record_meeting_processing_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.processing_events (
      meeting_id, user_id, event_type, status, message, created_at
    )
    values (
      new.id,
      new.owner_id,
      'meeting_created',
      'completed',
      'Meeting record created.',
      new.created_at
    );

    if new.audio_storage_path is not null then
      insert into public.processing_events (
        meeting_id, user_id, event_type, status, message, created_at
      )
      values (
        new.id,
        new.owner_id,
        'audio_uploaded',
        'completed',
        'Audio is securely stored and ready to process.',
        coalesce(new.updated_at, new.created_at, now())
      );
    end if;
  elsif old.audio_storage_path is null and new.audio_storage_path is not null then
    insert into public.processing_events (
      meeting_id, user_id, event_type, status, message, created_at
    )
    values (
      new.id,
      new.owner_id,
      'audio_uploaded',
      'completed',
      'Audio is securely stored and ready to process.',
      coalesce(new.updated_at, now())
    );
  end if;

  return new;
end;
$$;

create or replace function public.record_job_processing_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_owner uuid;
  timeline_event_type text;
  timeline_status text;
  timeline_message text;
begin
  select owner_id
  into event_owner
  from public.meetings
  where id = new.meeting_id;

  if event_owner is null then
    return new;
  end if;

  if tg_op = 'INSERT' and new.status = 'queued' then
    timeline_event_type := 'queued';
    timeline_status := 'current';
    timeline_message := case new.job_type
      when 'transcription' then 'Transcription job queued.'
      when 'analysis' then 'Analysis job queued.'
      else null
    end;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    case new.status
      when 'transcribing' then
        if new.job_type <> 'transcription' then
          return new;
        end if;
        timeline_event_type := 'transcription_started';
        timeline_status := 'current';
        timeline_message := 'Audio transcription started.';
      when 'transcribed' then
        if new.job_type <> 'transcription' then
          return new;
        end if;
        timeline_event_type := 'transcription_completed';
        timeline_status := 'completed';
        timeline_message := 'Transcript generated successfully.';
      when 'analyzing' then
        if new.job_type <> 'analysis' then
          return new;
        end if;
        timeline_event_type := 'analysis_started';
        timeline_status := 'current';
        timeline_message := 'Meeting analysis started.';
      when 'analyzed' then
        if new.job_type <> 'analysis' then
          return new;
        end if;
        timeline_event_type := 'analysis_completed';
        timeline_status := 'completed';
        timeline_message := 'Meeting analysis completed successfully.';
      when 'failed' then
        timeline_event_type := case new.job_type
          when 'transcription' then 'transcription_failed'
          when 'analysis' then 'analysis_failed'
          else null
        end;
        timeline_status := 'failed';
        timeline_message := case new.job_type
          when 'transcription' then 'Transcription failed.'
          when 'analysis' then 'Meeting analysis failed.'
          else null
        end;
      else
        return new;
    end case;
  else
    return new;
  end if;

  if timeline_event_type is null or timeline_message is null then
    return new;
  end if;

  insert into public.processing_events (
    meeting_id,
    user_id,
    job_id,
    job_type,
    event_type,
    status,
    message,
    error_message,
    created_at
  )
  values (
    new.meeting_id,
    event_owner,
    new.id,
    new.job_type,
    timeline_event_type,
    timeline_status,
    timeline_message,
    case when timeline_status = 'failed' then new.error_message else null end,
    case
      when timeline_status in ('completed', 'failed')
        then coalesce(new.completed_at, now())
      when timeline_event_type in ('transcription_started', 'analysis_started')
        then coalesce(new.started_at, now())
      else new.created_at
    end
  );

  return new;
end;
$$;

drop trigger if exists record_meeting_processing_event on public.meetings;

create trigger record_meeting_processing_event
after insert or update of audio_storage_path on public.meetings
for each row execute function public.record_meeting_processing_event();

drop trigger if exists record_job_processing_event on public.processing_jobs;

create trigger record_job_processing_event
after insert or update of status on public.processing_jobs
for each row execute function public.record_job_processing_event();

revoke all on function public.record_meeting_processing_event()
from public, anon, authenticated;

revoke all on function public.record_job_processing_event()
from public, anon, authenticated;
