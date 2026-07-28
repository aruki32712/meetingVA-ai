create table public.meeting_activity_events (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'meeting_created',
    'audio_uploaded',
    'transcription_queued',
    'transcription_started',
    'transcription_completed',
    'transcription_failed',
    'analysis_queued',
    'analysis_started',
    'analysis_completed',
    'analysis_failed',
    'speaker_detected',
    'speaker_uncertain',
    'speaker_renamed',
    'speakers_merged',
    'transcript_segment_reassigned',
    'transcript_edited',
    'search_performed',
    'export_created',
    'retry_started'
  )),
  actor_type text not null check (actor_type in ('system', 'owner', 'worker')),
  actor_label text not null,
  title text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index meeting_activity_events_meeting_id_created_at_idx
on public.meeting_activity_events(meeting_id, created_at desc, id desc);

create index meeting_activity_events_user_id_created_at_idx
on public.meeting_activity_events(user_id, created_at desc);

create index meeting_activity_events_event_type_created_at_idx
on public.meeting_activity_events(event_type, created_at desc);

alter table public.meeting_activity_events enable row level security;

create policy "Users read own meeting activity events"
on public.meeting_activity_events
for select
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.meetings
    where meetings.id = meeting_activity_events.meeting_id
      and meetings.owner_id = auth.uid()
  )
);

revoke all on public.meeting_activity_events from public, anon, authenticated;
grant select on public.meeting_activity_events to authenticated;

insert into public.meeting_activity_events (
  meeting_id,
  user_id,
  event_type,
  actor_type,
  actor_label,
  title,
  description,
  metadata,
  created_at
)
select
  meetings.id,
  meetings.owner_id,
  'meeting_created',
  'system',
  'MeetingVA AI',
  'Meeting created',
  'The meeting record was created.',
  jsonb_build_object('meeting_title', meetings.title),
  meetings.created_at
from public.meetings;

insert into public.meeting_activity_events (
  meeting_id,
  user_id,
  event_type,
  actor_type,
  actor_label,
  title,
  description,
  metadata,
  created_at
)
select
  meetings.id,
  meetings.owner_id,
  'audio_uploaded',
  'system',
  'MeetingVA AI',
  'Audio uploaded',
  'Audio was stored securely and attached to the meeting.',
  jsonb_build_object(
    'audio_storage_path', meetings.audio_storage_path,
    'duration_seconds', meetings.duration_seconds
  ),
  coalesce(meetings.updated_at, meetings.created_at, now())
from public.meetings
where meetings.audio_storage_path is not null;

insert into public.meeting_activity_events (
  meeting_id,
  user_id,
  event_type,
  actor_type,
  actor_label,
  title,
  description,
  metadata,
  created_at
)
select
  processing_jobs.meeting_id,
  meetings.owner_id,
  case processing_jobs.job_type
    when 'transcription' then 'transcription_queued'
    when 'analysis' then 'analysis_queued'
  end,
  'system',
  'MeetingVA AI',
  case processing_jobs.job_type
    when 'transcription' then 'Transcription queued'
    when 'analysis' then 'Analysis queued'
  end,
  case processing_jobs.job_type
    when 'transcription' then 'A transcription job was queued.'
    when 'analysis' then 'An analysis job was queued.'
  end,
  jsonb_build_object(
    'job_id', processing_jobs.id,
    'job_type', processing_jobs.job_type,
    'job_status', processing_jobs.status,
    'retry_count', processing_jobs.retry_count
  ),
  processing_jobs.created_at
from public.processing_jobs
join public.meetings on meetings.id = processing_jobs.meeting_id;

insert into public.meeting_activity_events (
  meeting_id,
  user_id,
  event_type,
  actor_type,
  actor_label,
  title,
  description,
  metadata,
  created_at
)
select
  processing_jobs.meeting_id,
  meetings.owner_id,
  case processing_jobs.job_type
    when 'transcription' then 'transcription_started'
    when 'analysis' then 'analysis_started'
  end,
  'worker',
  'MeetingVA worker',
  case processing_jobs.job_type
    when 'transcription' then 'Transcription started'
    when 'analysis' then 'Analysis started'
  end,
  case processing_jobs.job_type
    when 'transcription' then 'The worker started converting audio into a transcript.'
    when 'analysis' then 'The worker started generating meeting intelligence.'
  end,
  jsonb_build_object(
    'job_id', processing_jobs.id,
    'job_type', processing_jobs.job_type,
    'retry_count', processing_jobs.retry_count,
    'worker_version', processing_jobs.worker_version
  ),
  coalesce(processing_jobs.started_at, processing_jobs.updated_at, processing_jobs.created_at)
from public.processing_jobs
join public.meetings on meetings.id = processing_jobs.meeting_id
where processing_jobs.started_at is not null
  and processing_jobs.status <> 'queued';

insert into public.meeting_activity_events (
  meeting_id,
  user_id,
  event_type,
  actor_type,
  actor_label,
  title,
  description,
  metadata,
  created_at
)
select
  processing_jobs.meeting_id,
  meetings.owner_id,
  case
    when processing_jobs.status = 'transcribed' then 'transcription_completed'
    when processing_jobs.status = 'analyzed' then 'analysis_completed'
    when processing_jobs.status = 'failed' and processing_jobs.job_type = 'transcription' then 'transcription_failed'
    when processing_jobs.status = 'failed' and processing_jobs.job_type = 'analysis' then 'analysis_failed'
  end,
  'worker',
  'MeetingVA worker',
  case
    when processing_jobs.status = 'transcribed' then 'Transcription completed'
    when processing_jobs.status = 'analyzed' then 'Analysis completed'
    when processing_jobs.status = 'failed' and processing_jobs.job_type = 'transcription' then 'Transcription failed'
    when processing_jobs.status = 'failed' and processing_jobs.job_type = 'analysis' then 'Analysis failed'
  end,
  case
    when processing_jobs.status = 'transcribed' then 'The transcript was generated successfully.'
    when processing_jobs.status = 'analyzed' then 'Meeting intelligence was generated successfully.'
    when processing_jobs.status = 'failed' and processing_jobs.job_type = 'transcription' then 'The transcription job failed.'
    when processing_jobs.status = 'failed' and processing_jobs.job_type = 'analysis' then 'The analysis job failed.'
  end,
  jsonb_build_object(
    'job_id', processing_jobs.id,
    'job_type', processing_jobs.job_type,
    'job_status', processing_jobs.status,
    'retry_count', processing_jobs.retry_count,
    'worker_version', processing_jobs.worker_version,
    'error_message', processing_jobs.error_message
  ),
  coalesce(processing_jobs.completed_at, processing_jobs.updated_at, processing_jobs.created_at)
from public.processing_jobs
join public.meetings on meetings.id = processing_jobs.meeting_id
where processing_jobs.status in ('transcribed', 'analyzed', 'failed');

insert into public.meeting_activity_events (
  meeting_id,
  user_id,
  event_type,
  actor_type,
  actor_label,
  title,
  description,
  metadata,
  created_at
)
select
  participants.meeting_id,
  meetings.owner_id,
  'speaker_detected',
  'worker',
  'MeetingVA worker',
  'Speaker detected',
  'A speaker label was detected from the transcript.',
  jsonb_build_object(
    'participant_id', participants.id,
    'original_label', participants.speaker_label,
    'new_label', participants.display_name,
    'confidence_score', participants.metadata -> 'confidence_score',
    'detection_method', coalesce(participants.metadata ->> 'detection_method', 'transcription_diarization')
  ),
  participants.created_at
from public.participants
join public.meetings on meetings.id = participants.meeting_id
where participants.speaker_label is not null
  and coalesce(participants.source, 'transcript') = 'transcript';

create or replace function public.record_meeting_activity_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_owner uuid;
begin
  event_owner := new.owner_id;

  if event_owner is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    insert into public.meeting_activity_events (
      meeting_id, user_id, event_type, actor_type, actor_label, title, description, metadata, created_at
    )
    values (
      new.id,
      event_owner,
      'meeting_created',
      'system',
      'MeetingVA AI',
      'Meeting created',
      'The meeting record was created.',
      jsonb_build_object('meeting_title', new.title),
      new.created_at
    );

    if new.audio_storage_path is not null then
      insert into public.meeting_activity_events (
        meeting_id, user_id, event_type, actor_type, actor_label, title, description, metadata, created_at
      )
      values (
        new.id,
        event_owner,
        'audio_uploaded',
        'system',
        'MeetingVA AI',
        'Audio uploaded',
        'Audio was stored securely and attached to the meeting.',
        jsonb_build_object(
          'audio_storage_path', new.audio_storage_path,
          'duration_seconds', new.duration_seconds
        ),
        coalesce(new.updated_at, new.created_at, now())
      );
    end if;
  elsif old.audio_storage_path is null and new.audio_storage_path is not null then
    insert into public.meeting_activity_events (
      meeting_id, user_id, event_type, actor_type, actor_label, title, description, metadata, created_at
    )
    values (
      new.id,
      event_owner,
      'audio_uploaded',
      'system',
      'MeetingVA AI',
      'Audio uploaded',
      'Audio was stored securely and attached to the meeting.',
      jsonb_build_object(
        'audio_storage_path', new.audio_storage_path,
        'duration_seconds', new.duration_seconds
      ),
      coalesce(new.updated_at, now())
    );
  end if;

  return new;
end;
$$;

create trigger record_meeting_activity_event
after insert or update of audio_storage_path on public.meetings
for each row execute function public.record_meeting_activity_event();

create or replace function public.record_processing_job_activity_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_owner uuid;
  activity_event_type text;
  activity_actor_type text;
  activity_actor_label text;
  activity_title text;
  activity_description text;
  activity_created_at timestamptz;
begin
  select owner_id
  into event_owner
  from public.meetings
  where id = new.meeting_id;

  if event_owner is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.retry_count > old.retry_count
    and new.retry_count > 0 then
    insert into public.meeting_activity_events (
      meeting_id, user_id, event_type, actor_type, actor_label, title, description, metadata, created_at
    )
    values (
      new.meeting_id,
      event_owner,
      'retry_started',
      'worker',
      'MeetingVA worker',
      'Retry started',
      'The worker started retrying a processing job.',
      jsonb_build_object(
        'job_id', new.id,
        'job_type', new.job_type,
        'retry_count', new.retry_count,
        'worker_version', new.worker_version
      ),
      coalesce(new.started_at, now())
    );
  end if;

  if tg_op = 'INSERT' and new.status = 'queued' then
    activity_event_type := case new.job_type
      when 'transcription' then 'transcription_queued'
      when 'analysis' then 'analysis_queued'
    end;
    activity_actor_type := 'system';
    activity_actor_label := 'MeetingVA AI';
    activity_title := case new.job_type
      when 'transcription' then 'Transcription queued'
      when 'analysis' then 'Analysis queued'
    end;
    activity_description := case new.job_type
      when 'transcription' then 'A transcription job was queued.'
      when 'analysis' then 'An analysis job was queued.'
    end;
    activity_created_at := new.created_at;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    case new.status
      when 'transcribing' then
        if new.job_type <> 'transcription' then
          return new;
        end if;
        activity_event_type := 'transcription_started';
        activity_actor_type := 'worker';
        activity_actor_label := 'MeetingVA worker';
        activity_title := 'Transcription started';
        activity_description := 'The worker started converting audio into a transcript.';
        activity_created_at := coalesce(new.started_at, now());
      when 'transcribed' then
        if new.job_type <> 'transcription' then
          return new;
        end if;
        activity_event_type := 'transcription_completed';
        activity_actor_type := 'worker';
        activity_actor_label := 'MeetingVA worker';
        activity_title := 'Transcription completed';
        activity_description := 'The transcript was generated successfully.';
        activity_created_at := coalesce(new.completed_at, now());
      when 'analyzing' then
        if new.job_type <> 'analysis' then
          return new;
        end if;
        activity_event_type := 'analysis_started';
        activity_actor_type := 'worker';
        activity_actor_label := 'MeetingVA worker';
        activity_title := 'Analysis started';
        activity_description := 'The worker started generating meeting intelligence.';
        activity_created_at := coalesce(new.started_at, now());
      when 'analyzed' then
        if new.job_type <> 'analysis' then
          return new;
        end if;
        activity_event_type := 'analysis_completed';
        activity_actor_type := 'worker';
        activity_actor_label := 'MeetingVA worker';
        activity_title := 'Analysis completed';
        activity_description := 'Meeting intelligence was generated successfully.';
        activity_created_at := coalesce(new.completed_at, now());
      when 'failed' then
        activity_event_type := case new.job_type
          when 'transcription' then 'transcription_failed'
          when 'analysis' then 'analysis_failed'
        end;
        activity_actor_type := 'worker';
        activity_actor_label := 'MeetingVA worker';
        activity_title := case new.job_type
          when 'transcription' then 'Transcription failed'
          when 'analysis' then 'Analysis failed'
        end;
        activity_description := case new.job_type
          when 'transcription' then 'The transcription job failed.'
          when 'analysis' then 'The analysis job failed.'
        end;
        activity_created_at := coalesce(new.completed_at, now());
      else
        return new;
    end case;
  else
    return new;
  end if;

  if activity_event_type is null or activity_title is null then
    return new;
  end if;

  insert into public.meeting_activity_events (
    meeting_id,
    user_id,
    event_type,
    actor_type,
    actor_label,
    title,
    description,
    metadata,
    created_at
  )
  values (
    new.meeting_id,
    event_owner,
    activity_event_type,
    activity_actor_type,
    activity_actor_label,
    activity_title,
    activity_description,
    jsonb_build_object(
      'job_id', new.id,
      'job_type', new.job_type,
      'job_status', new.status,
      'retry_count', new.retry_count,
      'worker_version', new.worker_version,
      'error_message', new.error_message
    ),
    activity_created_at
  );

  return new;
end;
$$;

create trigger record_processing_job_activity_event
after insert or update of status, retry_count on public.processing_jobs
for each row execute function public.record_processing_job_activity_event();

create or replace function public.record_speaker_detected_activity_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_owner uuid;
  confidence numeric;
begin
  select owner_id
  into event_owner
  from public.meetings
  where id = new.meeting_id;

  if event_owner is null
    or new.speaker_label is null
    or coalesce(new.source, 'transcript') <> 'transcript' then
    return new;
  end if;

  confidence := nullif(new.metadata ->> 'confidence_score', '')::numeric;

  insert into public.meeting_activity_events (
    meeting_id, user_id, event_type, actor_type, actor_label, title, description, metadata, created_at
  )
  values (
    new.meeting_id,
    event_owner,
    case when confidence is not null and confidence < 0.7 then 'speaker_uncertain' else 'speaker_detected' end,
    'worker',
    'MeetingVA worker',
    case when confidence is not null and confidence < 0.7 then 'Speaker needs review' else 'Speaker detected' end,
    case when confidence is not null and confidence < 0.7
      then 'A speaker label was detected with low confidence and may need owner correction.'
      else 'A speaker label was detected from the transcript.'
    end,
    jsonb_build_object(
      'participant_id', new.id,
      'confidence_score', new.metadata -> 'confidence_score',
      'original_label', new.speaker_label,
      'new_label', new.display_name,
      'affected_segment_count', null,
      'detection_method', coalesce(new.metadata ->> 'detection_method', 'transcription_diarization')
    ),
    new.created_at
  );

  return new;
exception
  when invalid_text_representation then
    confidence := null;
    insert into public.meeting_activity_events (
      meeting_id, user_id, event_type, actor_type, actor_label, title, description, metadata, created_at
    )
    values (
      new.meeting_id,
      event_owner,
      'speaker_detected',
      'worker',
      'MeetingVA worker',
      'Speaker detected',
      'A speaker label was detected from the transcript.',
      jsonb_build_object(
        'participant_id', new.id,
        'confidence_score', new.metadata -> 'confidence_score',
        'original_label', new.speaker_label,
        'new_label', new.display_name,
        'affected_segment_count', null,
        'detection_method', coalesce(new.metadata ->> 'detection_method', 'transcription_diarization')
      ),
      new.created_at
    );

    return new;
end;
$$;

create trigger record_speaker_detected_activity_event
after insert on public.participants
for each row execute function public.record_speaker_detected_activity_event();

revoke all on function public.record_meeting_activity_event() from public, anon, authenticated;
revoke all on function public.record_processing_job_activity_event() from public, anon, authenticated;
revoke all on function public.record_speaker_detected_activity_event() from public, anon, authenticated;

comment on table public.meeting_activity_events is
  'Permanent owner-scoped meeting history feed. System and worker events are written by trusted triggers or service-role backend paths; owner correction events are written by backend endpoints after meeting ownership checks.';
