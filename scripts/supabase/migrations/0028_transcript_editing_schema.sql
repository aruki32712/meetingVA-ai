-- Consolidated, additive schema reconciliation for transcript editing,
-- speaker correction, multilingual content, analysis regeneration, exports,
-- and background processing. Safe to run after the initial schema and safe to
-- rerun. PostgreSQL does not support CREATE POLICY IF NOT EXISTS, so named
-- policies are replaced idempotently to guarantee their security predicates.
--
-- Inventory
-- Columns: meetings.audio_storage_path, duration_seconds,
-- expected_speaker_count, summary, brief, summary_translated,
-- brief_translated, detected_language, transcript_language,
-- translation_language, translate_to_english, transcript_kind,
-- translation_status, analysis_stale; participants.speaker_label, source,
-- voiceprint_ref, metadata, updated_at; transcript_segments.participant_id,
-- speaker_label, start_ms, end_ms, text, original_text, translated_text,
-- transcript_kind, confidence, segment_index, edit_metadata, created_at;
-- action_items.translated_title/translated_description;
-- decisions.translated_title/translated_description;
-- questions.translated_question/translated_answer.
-- Tables: processing_jobs, processing_events.
-- Enums: processing_job_type, processing_job_status.
-- Indexes: participants_speaker_label_idx,
-- transcript_segments_participant_id_idx, meetings_detected_language_idx,
-- meetings_transcript_language_idx,
-- processing_jobs_meeting_id_created_at_idx,
-- processing_jobs_status_created_at_idx,
-- processing_jobs_one_active_transcription_idx,
-- processing_events_meeting_id_created_at_idx,
-- processing_events_user_id_created_at_idx, processing_events_job_id_idx.
-- Functions: set_updated_at, record_meeting_processing_event,
-- record_job_processing_event, split_transcript_segment.
-- Triggers: set_participants_updated_at, set_processing_jobs_updated_at,
-- record_meeting_processing_event, record_job_processing_event.
-- Policies: four private meeting-audio object policies and owner-scoped read
-- policies for processing_jobs and processing_events.

create extension if not exists pgcrypto;

-- Audio is private and remains scoped to the authenticated user's first path
-- segment: {auth.uid()}/{meeting_id}/recording.webm.
insert into storage.buckets(id, name, public)
values ('meeting-audio', 'meeting-audio', false)
on conflict (id) do update set public = false;

drop policy if exists "Users read own meeting audio objects" on storage.objects;
create policy "Users read own meeting audio objects" on storage.objects
  for select to authenticated using (
    bucket_id = 'meeting-audio' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "Users upload own meeting audio objects" on storage.objects;
create policy "Users upload own meeting audio objects" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'meeting-audio' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "Users update own meeting audio objects" on storage.objects;
create policy "Users update own meeting audio objects" on storage.objects
  for update to authenticated
  using (bucket_id = 'meeting-audio' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'meeting-audio' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users delete own meeting audio objects" on storage.objects;
create policy "Users delete own meeting audio objects" on storage.objects
  for delete to authenticated using (
    bucket_id = 'meeting-audio' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Meeting workflow, intelligence, translation, and edit invalidation.
alter table public.meetings
  add column if not exists audio_storage_path text,
  add column if not exists duration_seconds integer,
  add column if not exists expected_speaker_count smallint,
  add column if not exists summary text,
  add column if not exists brief text,
  add column if not exists summary_translated text,
  add column if not exists brief_translated text,
  add column if not exists detected_language text,
  add column if not exists transcript_language text,
  add column if not exists translation_language text,
  add column if not exists translate_to_english boolean not null default false,
  add column if not exists transcript_kind text not null default 'original',
  add column if not exists translation_status text not null default 'not_requested',
  add column if not exists analysis_stale boolean not null default false;

-- Participant identity remains separate from transcript row order.
alter table public.participants
  add column if not exists speaker_label text,
  add column if not exists source text not null default 'transcript',
  add column if not exists voiceprint_ref text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

-- Editable transcript contract, including original/translated representations.
alter table public.transcript_segments
  add column if not exists participant_id uuid references public.participants(id) on delete set null,
  add column if not exists speaker_label text,
  add column if not exists start_ms integer,
  add column if not exists end_ms integer,
  add column if not exists text text,
  add column if not exists original_text text,
  add column if not exists translated_text text,
  add column if not exists transcript_kind text not null default 'original',
  add column if not exists confidence numeric(5, 4),
  add column if not exists segment_index integer,
  add column if not exists edit_metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

alter table public.action_items
  add column if not exists translated_title text,
  add column if not exists translated_description text;

alter table public.decisions
  add column if not exists translated_title text,
  add column if not exists translated_description text;

alter table public.questions
  add column if not exists translated_question text,
  add column if not exists translated_answer text;

-- Retrofit defaults when columns came from a partial deployment.
update public.meetings set translate_to_english = false where translate_to_english is null;
update public.meetings set transcript_kind = 'original' where transcript_kind is null;
update public.meetings set translation_status = 'not_requested' where translation_status is null;
update public.meetings set analysis_stale = false where analysis_stale is null;
update public.participants set source = 'transcript' where source is null;
update public.participants set metadata = '{}'::jsonb where metadata is null;
update public.transcript_segments set transcript_kind = 'original' where transcript_kind is null;
update public.transcript_segments set edit_metadata = '{}'::jsonb where edit_metadata is null;

alter table public.meetings
  alter column translate_to_english set default false,
  alter column translate_to_english set not null,
  alter column transcript_kind set default 'original',
  alter column transcript_kind set not null,
  alter column translation_status set default 'not_requested',
  alter column translation_status set not null,
  alter column analysis_stale set default false,
  alter column analysis_stale set not null;

alter table public.participants
  alter column source set default 'transcript',
  alter column source set not null,
  alter column metadata set default '{}'::jsonb,
  alter column metadata set not null;

alter table public.transcript_segments
  alter column transcript_kind set default 'original',
  alter column transcript_kind set not null,
  alter column edit_metadata set default '{}'::jsonb,
  alter column edit_metadata set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.meetings'::regclass and conname = 'meetings_duration_seconds_check') then
    alter table public.meetings add constraint meetings_duration_seconds_check
      check (duration_seconds is null or duration_seconds >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.meetings'::regclass and conname = 'meetings_expected_speaker_count_check') then
    alter table public.meetings add constraint meetings_expected_speaker_count_check
      check (expected_speaker_count is null or expected_speaker_count between 1 and 20);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.meetings'::regclass and conname = 'meetings_transcript_kind_check') then
    alter table public.meetings add constraint meetings_transcript_kind_check
      check (transcript_kind in ('original', 'translated', 'both'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.meetings'::regclass and conname = 'meetings_translation_status_check') then
    alter table public.meetings add constraint meetings_translation_status_check
      check (translation_status in ('not_requested', 'not_needed', 'translated', 'failed'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.transcript_segments'::regclass and conname = 'transcript_segments_transcript_kind_check') then
    alter table public.transcript_segments add constraint transcript_segments_transcript_kind_check
      check (transcript_kind in ('original', 'translated', 'both'));
  end if;
end
$$;

create index if not exists participants_speaker_label_idx
  on public.participants(meeting_id, speaker_label);
create index if not exists transcript_segments_participant_id_idx
  on public.transcript_segments(participant_id);
create index if not exists meetings_detected_language_idx
  on public.meetings(detected_language);
create index if not exists meetings_transcript_language_idx
  on public.meetings(transcript_language);

-- Background processing types. Add all code-proven values to partially
-- deployed enums instead of replacing enum types or existing data.
do $$
begin
  create type public.processing_job_type as enum ('transcription', 'analysis');
exception when duplicate_object then null;
end
$$;
alter type public.processing_job_type add value if not exists 'transcription';
alter type public.processing_job_type add value if not exists 'analysis';

do $$
begin
  create type public.processing_job_status as enum (
    'queued', 'transcribing', 'transcribed', 'analyzing', 'analyzed', 'failed', 'cancelled'
  );
exception when duplicate_object then null;
end
$$;
alter type public.processing_job_status add value if not exists 'queued';
alter type public.processing_job_status add value if not exists 'transcribing';
alter type public.processing_job_status add value if not exists 'transcribed';
alter type public.processing_job_status add value if not exists 'analyzing';
alter type public.processing_job_status add value if not exists 'analyzed';
alter type public.processing_job_status add value if not exists 'failed';
alter type public.processing_job_status add value if not exists 'cancelled';

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
  add column if not exists meeting_id uuid references public.meetings(id) on delete cascade,
  add column if not exists job_type public.processing_job_type,
  add column if not exists status public.processing_job_status not null default 'queued',
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists error_message text,
  add column if not exists retry_count integer not null default 0,
  add column if not exists worker_version text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.processing_events (
  id uuid primary key default gen_random_uuid(),
  event_order bigint generated always as identity,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.processing_jobs(id) on delete set null,
  job_type public.processing_job_type,
  event_type text not null,
  status text not null,
  message text not null,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.processing_events
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists event_order bigint generated always as identity,
  add column if not exists meeting_id uuid references public.meetings(id) on delete cascade,
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists job_id uuid references public.processing_jobs(id) on delete set null,
  add column if not exists job_type public.processing_job_type,
  add column if not exists event_type text,
  add column if not exists status text,
  add column if not exists message text,
  add column if not exists error_message text,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.processing_jobs'::regclass and contype = 'p') then
    alter table public.processing_jobs add constraint processing_jobs_pkey primary key (id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.processing_events'::regclass and contype = 'p') then
    alter table public.processing_events add constraint processing_events_pkey primary key (id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.processing_jobs'::regclass and conname = 'processing_jobs_retry_count_check') then
    alter table public.processing_jobs add constraint processing_jobs_retry_count_check
      check (retry_count >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.processing_events'::regclass and conname = 'processing_events_event_type_check') then
    alter table public.processing_events add constraint processing_events_event_type_check
      check (event_type in (
        'meeting_created', 'audio_uploaded', 'queued',
        'transcription_started', 'transcription_completed', 'transcription_failed',
        'analysis_started', 'analysis_completed', 'analysis_failed'
      ));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.processing_events'::regclass and conname = 'processing_events_status_check') then
    alter table public.processing_events add constraint processing_events_status_check
      check (status in ('pending', 'current', 'completed', 'failed'));
  end if;
end
$$;

create index if not exists processing_jobs_meeting_id_created_at_idx
  on public.processing_jobs(meeting_id, created_at desc);
create index if not exists processing_jobs_status_created_at_idx
  on public.processing_jobs(status, created_at desc);
create unique index if not exists processing_jobs_one_active_transcription_idx
  on public.processing_jobs(meeting_id)
  where job_type = 'transcription' and status in ('queued', 'transcribing');
create index if not exists processing_events_meeting_id_created_at_idx
  on public.processing_events(meeting_id, created_at asc, event_order asc);
create index if not exists processing_events_user_id_created_at_idx
  on public.processing_events(user_id, created_at desc);
create index if not exists processing_events_job_id_idx
  on public.processing_events(job_id) where job_id is not null;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_participants_updated_at on public.participants;
create trigger set_participants_updated_at before update on public.participants
  for each row execute function public.set_updated_at();
drop trigger if exists set_processing_jobs_updated_at on public.processing_jobs;
create trigger set_processing_jobs_updated_at before update on public.processing_jobs
  for each row execute function public.set_updated_at();

alter table public.processing_jobs enable row level security;
alter table public.processing_events enable row level security;

drop policy if exists "Users read own processing jobs" on public.processing_jobs;
create policy "Users read own processing jobs" on public.processing_jobs
  for select to authenticated using (
    exists (select 1 from public.meetings m where m.id = processing_jobs.meeting_id and m.owner_id = auth.uid())
  );
drop policy if exists "Users read own processing events" on public.processing_events;
create policy "Users read own processing events" on public.processing_events
  for select to authenticated using (
    user_id = auth.uid() and exists (
      select 1 from public.meetings m where m.id = processing_events.meeting_id and m.owner_id = auth.uid()
    )
  );

revoke all on public.processing_jobs from public, anon, authenticated;
grant select on public.processing_jobs to authenticated;
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
    insert into public.processing_events(meeting_id, user_id, event_type, status, message, created_at)
    values (new.id, new.owner_id, 'meeting_created', 'completed', 'Meeting record created.', new.created_at);
    if new.audio_storage_path is not null then
      insert into public.processing_events(meeting_id, user_id, event_type, status, message, created_at)
      values (new.id, new.owner_id, 'audio_uploaded', 'completed', 'Audio is securely stored and ready to process.', coalesce(new.updated_at, new.created_at, now()));
    end if;
  elsif old.audio_storage_path is null and new.audio_storage_path is not null then
    insert into public.processing_events(meeting_id, user_id, event_type, status, message, created_at)
    values (new.id, new.owner_id, 'audio_uploaded', 'completed', 'Audio is securely stored and ready to process.', coalesce(new.updated_at, now()));
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
  select owner_id into event_owner from public.meetings where id = new.meeting_id;
  if event_owner is null then return new; end if;

  if tg_op = 'INSERT' and new.status = 'queued' then
    timeline_event_type := 'queued';
    timeline_status := 'current';
    timeline_message := case new.job_type when 'transcription' then 'Transcription job queued.' when 'analysis' then 'Analysis job queued.' end;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    case new.status
      when 'transcribing' then
        if new.job_type <> 'transcription' then return new; end if;
        timeline_event_type := 'transcription_started'; timeline_status := 'current'; timeline_message := 'Audio transcription started.';
      when 'transcribed' then
        if new.job_type <> 'transcription' then return new; end if;
        timeline_event_type := 'transcription_completed'; timeline_status := 'completed'; timeline_message := 'Transcript generated successfully.';
      when 'analyzing' then
        if new.job_type <> 'analysis' then return new; end if;
        timeline_event_type := 'analysis_started'; timeline_status := 'current'; timeline_message := 'Meeting analysis started.';
      when 'analyzed' then
        if new.job_type <> 'analysis' then return new; end if;
        timeline_event_type := 'analysis_completed'; timeline_status := 'completed'; timeline_message := 'Meeting analysis completed successfully.';
      when 'failed' then
        timeline_event_type := case new.job_type when 'transcription' then 'transcription_failed' when 'analysis' then 'analysis_failed' end;
        timeline_status := 'failed';
        timeline_message := case new.job_type when 'transcription' then 'Transcription failed.' when 'analysis' then 'Meeting analysis failed.' end;
      else return new;
    end case;
  else
    return new;
  end if;

  if timeline_event_type is null or timeline_message is null then return new; end if;
  insert into public.processing_events(meeting_id, user_id, job_id, job_type, event_type, status, message, error_message, created_at)
  values (
    new.meeting_id, event_owner, new.id, new.job_type, timeline_event_type,
    timeline_status, timeline_message,
    case when timeline_status = 'failed' then new.error_message end,
    case
      when timeline_status in ('completed', 'failed') then coalesce(new.completed_at, now())
      when timeline_event_type in ('transcription_started', 'analysis_started') then coalesce(new.started_at, now())
      else new.created_at
    end
  );
  return new;
end;
$$;

drop trigger if exists record_meeting_processing_event on public.meetings;
create trigger record_meeting_processing_event after insert or update of audio_storage_path on public.meetings
  for each row execute function public.record_meeting_processing_event();
drop trigger if exists record_job_processing_event on public.processing_jobs;
create trigger record_job_processing_event after insert or update of status on public.processing_jobs
  for each row execute function public.record_job_processing_event();

revoke all on function public.record_meeting_processing_event() from public, anon, authenticated;
revoke all on function public.record_job_processing_event() from public, anon, authenticated;

-- Atomic transcript word-boundary splitting. The service-role-only RPC checks
-- ownership, validates same-meeting speakers, preserves order and timestamps,
-- and invalidates analysis in the same transaction.
create or replace function public.split_transcript_segment(
  p_meeting_id uuid,
  p_segment_id uuid,
  p_owner_id uuid,
  p_parts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  original public.transcript_segments%rowtype;
  part jsonb;
  part_text text;
  combined_text text := '';
  normalized_original text;
  normalized_combined text;
  part_count integer;
  part_number integer := 0;
  total_weight integer := 0;
  cumulative_weight integer := 0;
  part_weight integer;
  part_start integer;
  part_end integer;
  selected_participant_id uuid;
  participant_row public.participants%rowtype;
  new_segment public.transcript_segments%rowtype;
  created_segments jsonb := '[]'::jsonb;
  created_participants jsonb := '[]'::jsonb;
  translation_requires_regeneration boolean;
  original_alignment_unavailable boolean;
begin
  if not exists (select 1 from public.meetings where id = p_meeting_id and owner_id = p_owner_id) then
    raise exception 'Meeting was not found.' using errcode = 'P0002';
  end if;
  select * into original from public.transcript_segments
    where id = p_segment_id and meeting_id = p_meeting_id for update;
  if not found then raise exception 'Transcript segment was not found.' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) < 2 then
    raise exception 'At least two non-empty parts are required.' using errcode = '22023';
  end if;
  part_count := jsonb_array_length(p_parts);

  for part in select value from jsonb_array_elements(p_parts) loop
    part_text := btrim(coalesce(part->>'text', ''));
    if part_text = '' then raise exception 'Split parts cannot be empty.' using errcode = '22023'; end if;
    combined_text := concat_ws(' ', nullif(combined_text, ''), part_text);
    total_weight := total_weight + greatest(length(part_text), 1);
  end loop;
  normalized_original := regexp_replace(btrim(original.text), '\s+', ' ', 'g');
  normalized_combined := regexp_replace(btrim(combined_text), '\s+', ' ', 'g');
  if normalized_original <> normalized_combined then
    raise exception 'Split parts must reconstruct the original transcript text.' using errcode = '22023';
  end if;

  update public.transcript_segments set segment_index = -segment_index - 1000000
    where meeting_id = p_meeting_id and segment_index > original.segment_index;
  delete from public.transcript_segments where id = original.id;

  for part in select value from jsonb_array_elements(p_parts) loop
    part_number := part_number + 1;
    part_text := btrim(part->>'text');
    selected_participant_id := null;
    if nullif(btrim(coalesce(part->>'participant_id', '')), '') is not null then
      selected_participant_id := (part->>'participant_id')::uuid;
      select * into participant_row from public.participants
        where id = selected_participant_id and meeting_id = p_meeting_id;
      if not found then raise exception 'A selected participant was not found in this meeting.' using errcode = 'P0002'; end if;
    elsif nullif(btrim(coalesce(part->>'display_name', '')), '') is not null then
      insert into public.participants(meeting_id, display_name, speaker_label, source, metadata)
      values (
        p_meeting_id, btrim(part->>'display_name'), btrim(part->>'display_name'), 'owner',
        jsonb_build_object('detection_method', 'owner_correction', 'speaker_label_source', 'user_assigned')
      ) returning * into participant_row;
      selected_participant_id := participant_row.id;
      created_participants := created_participants || to_jsonb(participant_row);
    else
      raise exception 'Every split part requires a speaker assignment.' using errcode = '22023';
    end if;

    part_weight := greatest(length(part_text), 1);
    part_start := original.start_ms + floor((original.end_ms - original.start_ms)::numeric * cumulative_weight / greatest(total_weight, 1))::integer;
    cumulative_weight := cumulative_weight + part_weight;
    part_end := case when part_number = part_count then original.end_ms
      else original.start_ms + floor((original.end_ms - original.start_ms)::numeric * cumulative_weight / greatest(total_weight, 1))::integer end;
    part_end := greatest(part_start, part_end);
    original_alignment_unavailable := original.original_text is not null
      and regexp_replace(btrim(original.original_text), '\s+', ' ', 'g') <> normalized_original;
    translation_requires_regeneration := original.translated_text is not null
      and regexp_replace(btrim(original.translated_text), '\s+', ' ', 'g') <> normalized_original;

    insert into public.transcript_segments(
      meeting_id, participant_id, speaker_label, start_ms, end_ms, text,
      original_text, translated_text, transcript_kind, confidence, segment_index, edit_metadata
    ) values (
      p_meeting_id, selected_participant_id,
      coalesce(participant_row.speaker_label, participant_row.display_name),
      part_start, part_end, part_text,
      case when original.original_text is null or original_alignment_unavailable then null else part_text end,
      case when original.translated_text is null or translation_requires_regeneration then null else part_text end,
      original.transcript_kind, original.confidence, original.segment_index + part_number - 1,
      coalesce(original.edit_metadata, '{}'::jsonb) || jsonb_build_object(
        'split_from_segment_id', original.id,
        'timestamp_estimated', true,
        'original_alignment_unavailable', original_alignment_unavailable,
        'translation_requires_regeneration', translation_requires_regeneration
      )
    ) returning * into new_segment;
    created_segments := created_segments || to_jsonb(new_segment);
  end loop;

  update public.transcript_segments
    set segment_index = (-segment_index - 1000000) + part_count - 1
    where meeting_id = p_meeting_id and segment_index < -999999;
  update public.meetings set analysis_stale = true, updated_at = now()
    where id = p_meeting_id and owner_id = p_owner_id;
  return jsonb_build_object('segments', created_segments, 'participants', created_participants, 'analysis_stale', true);
end;
$$;

revoke all on function public.split_transcript_segment(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.split_transcript_segment(uuid, uuid, uuid, jsonb)
  to service_role;

comment on column public.meetings.expected_speaker_count is
  'Optional user-provided diagnostic count; it is not used to fabricate speaker identities.';
comment on column public.transcript_segments.edit_metadata is
  'Non-provider edit provenance, including split lineage and translation regeneration requirements.';

notify pgrst, 'reload schema';
