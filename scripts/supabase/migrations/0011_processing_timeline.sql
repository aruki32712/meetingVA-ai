create table public.processing_events (
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
  status text not null check (status in ('pending', 'current', 'completed', 'failed')),
  message text not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index processing_events_meeting_id_created_at_idx
on public.processing_events(meeting_id, created_at asc, event_order asc);

create index processing_events_user_id_created_at_idx
on public.processing_events(user_id, created_at desc);

create index processing_events_job_id_idx
on public.processing_events(job_id)
where job_id is not null;

alter table public.processing_events enable row level security;

create policy "Users read own processing events"
on public.processing_events
for select
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.meetings
    where meetings.id = processing_events.meeting_id
      and (meetings.owner_id = auth.uid() or meetings.user_id = auth.uid())
  )
);

revoke all on public.processing_events from public, anon, authenticated;
grant select on public.processing_events to authenticated;

insert into public.processing_events (
  meeting_id,
  user_id,
  event_type,
  status,
  message,
  created_at
)
select
  meetings.id,
  coalesce(meetings.owner_id, meetings.user_id),
  'meeting_created',
  'completed',
  'Meeting record created.',
  meetings.created_at
from public.meetings;

insert into public.processing_events (
  meeting_id,
  user_id,
  event_type,
  status,
  message,
  created_at
)
select
  meetings.id,
  coalesce(meetings.owner_id, meetings.user_id),
  'audio_uploaded',
  'completed',
  'Audio is securely stored and ready to process.',
  coalesce(meetings.updated_at, meetings.created_at, now())
from public.meetings
where meetings.audio_storage_path is not null;

insert into public.processing_events (
  meeting_id,
  user_id,
  job_id,
  job_type,
  event_type,
  status,
  message,
  created_at
)
select
  processing_jobs.meeting_id,
  coalesce(meetings.owner_id, meetings.user_id),
  processing_jobs.id,
  processing_jobs.job_type,
  'queued',
  case when processing_jobs.status = 'queued' then 'current' else 'completed' end,
  case processing_jobs.job_type
    when 'transcription' then 'Transcription job queued.'
    when 'analysis' then 'Analysis job queued.'
  end,
  processing_jobs.created_at
from public.processing_jobs
join public.meetings on meetings.id = processing_jobs.meeting_id;

insert into public.processing_events (
  meeting_id,
  user_id,
  job_id,
  job_type,
  event_type,
  status,
  message,
  created_at
)
select
  processing_jobs.meeting_id,
  coalesce(meetings.owner_id, meetings.user_id),
  processing_jobs.id,
  processing_jobs.job_type,
  case processing_jobs.job_type
    when 'transcription' then 'transcription_started'
    when 'analysis' then 'analysis_started'
  end,
  case
    when processing_jobs.status in ('transcribing', 'analyzing') then 'current'
    else 'completed'
  end,
  case processing_jobs.job_type
    when 'transcription' then 'Audio transcription started.'
    when 'analysis' then 'Meeting analysis started.'
  end,
  coalesce(processing_jobs.started_at, processing_jobs.updated_at, processing_jobs.created_at)
from public.processing_jobs
join public.meetings on meetings.id = processing_jobs.meeting_id
where processing_jobs.started_at is not null
  and processing_jobs.status <> 'queued';

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
select
  processing_jobs.meeting_id,
  coalesce(meetings.owner_id, meetings.user_id),
  processing_jobs.id,
  processing_jobs.job_type,
  case
    when processing_jobs.status = 'transcribed' then 'transcription_completed'
    when processing_jobs.status = 'analyzed' then 'analysis_completed'
    when processing_jobs.status = 'failed' and processing_jobs.job_type = 'transcription' then 'transcription_failed'
    when processing_jobs.status = 'failed' and processing_jobs.job_type = 'analysis' then 'analysis_failed'
  end,
  case when processing_jobs.status = 'failed' then 'failed' else 'completed' end,
  case
    when processing_jobs.status = 'transcribed' then 'Transcript generated successfully.'
    when processing_jobs.status = 'analyzed' then 'Meeting analysis completed successfully.'
    when processing_jobs.status = 'failed' and processing_jobs.job_type = 'transcription' then 'Transcription failed.'
    when processing_jobs.status = 'failed' and processing_jobs.job_type = 'analysis' then 'Meeting analysis failed.'
  end,
  case when processing_jobs.status = 'failed' then processing_jobs.error_message else null end,
  coalesce(processing_jobs.completed_at, processing_jobs.updated_at, processing_jobs.created_at)
from public.processing_jobs
join public.meetings on meetings.id = processing_jobs.meeting_id
where processing_jobs.status in ('transcribed', 'analyzed', 'failed');

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
      coalesce(new.owner_id, new.user_id),
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
        coalesce(new.owner_id, new.user_id),
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
      coalesce(new.owner_id, new.user_id),
      'audio_uploaded',
      'completed',
      'Audio is securely stored and ready to process.',
      coalesce(new.updated_at, now())
    );
  end if;

  return new;
end;
$$;

create trigger record_meeting_processing_event
after insert or update of audio_storage_path on public.meetings
for each row execute function public.record_meeting_processing_event();

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
  select coalesce(owner_id, user_id)
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
      when timeline_status in ('completed', 'failed') then coalesce(new.completed_at, now())
      when timeline_event_type in ('transcription_started', 'analysis_started') then coalesce(new.started_at, now())
      else new.created_at
    end
  );

  return new;
end;
$$;

create trigger record_job_processing_event
after insert or update of status on public.processing_jobs
for each row execute function public.record_job_processing_event();

revoke all on function public.record_meeting_processing_event() from public, anon, authenticated;
revoke all on function public.record_job_processing_event() from public, anon, authenticated;

comment on table public.processing_events is
  'Owner-scoped, append-only event history used by the meeting processing timeline. Events are written by trusted database triggers and readable only by the meeting owner.';
