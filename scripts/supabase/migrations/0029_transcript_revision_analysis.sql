-- Protect Meeting Intelligence from results generated for an older manual transcript edit.
alter table public.meetings
  add column if not exists transcript_revision integer not null default 1,
  add column if not exists analysis_revision integer;

alter table public.processing_jobs
  add column if not exists transcript_revision integer;

create unique index if not exists processing_jobs_one_active_analysis_idx
  on public.processing_jobs(meeting_id)
  where job_type = 'analysis' and status in ('queued', 'analyzing');

alter table public.processing_events drop constraint if exists processing_events_event_type_check;
alter table public.processing_events add constraint processing_events_event_type_check
  check (event_type in (
    'meeting_created', 'audio_uploaded', 'queued', 'transcript_updated',
    'transcription_started', 'transcription_completed', 'transcription_failed',
    'analysis_started', 'analysis_completed', 'analysis_failed'
  ));

create or replace function public.mark_transcript_manually_edited(
  p_meeting_id uuid,
  p_owner_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare new_revision integer;
begin
  update public.processing_jobs
  set status = 'cancelled', completed_at = now(),
      error_message = 'Superseded by a newer transcript revision.', updated_at = now()
  where meeting_id = p_meeting_id and job_type = 'analysis'
    and status in ('queued', 'analyzing');
  update public.meetings
  set transcript_revision = transcript_revision + 1,
      analysis_stale = true,
      updated_at = now()
  where id = p_meeting_id and owner_id = p_owner_id
  returning transcript_revision into new_revision;
  if new_revision is null then raise exception 'Meeting was not found.'; end if;
  insert into public.processing_events(
    meeting_id, user_id, job_type, event_type, status, message, created_at
  ) values (
    p_meeting_id, p_owner_id, null, 'transcript_updated', 'completed',
    'Transcript updated manually.', now()
  );
  return new_revision;
end;
$$;

revoke all on function public.mark_transcript_manually_edited(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.mark_transcript_manually_edited(uuid, uuid)
  to service_role;

-- Analysis writes are committed in one transaction only when the transcript
-- revision still matches the revision captured by the job.
create or replace function public.commit_meeting_analysis(
  p_meeting_id uuid,
  p_transcript_revision integer,
  p_summary text,
  p_brief text,
  p_action_items jsonb,
  p_decisions jsonb,
  p_questions jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.meetings
    where id = p_meeting_id and transcript_revision = p_transcript_revision
    for update
  ) then
    return false;
  end if;

  delete from public.action_items where meeting_id = p_meeting_id;
  insert into public.action_items(meeting_id, title, description, status, due_at)
    select p_meeting_id, value->>'title', value->>'description',
      coalesce(value->>'status', 'open'), nullif(value->>'due_at', '')::timestamptz
    from jsonb_array_elements(coalesce(p_action_items, '[]'::jsonb));
  delete from public.decisions where meeting_id = p_meeting_id;
  insert into public.decisions(meeting_id, title, description)
    select p_meeting_id, value->>'title', value->>'description'
    from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb));
  delete from public.questions where meeting_id = p_meeting_id;
  insert into public.questions(meeting_id, question, answer, status)
    select p_meeting_id, value->>'question', value->>'answer',
      coalesce(value->>'status', 'open')
    from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb));

  update public.meetings
  set summary = p_summary, brief = p_brief, analysis_stale = false,
      analysis_revision = p_transcript_revision, updated_at = now()
  where id = p_meeting_id and transcript_revision = p_transcript_revision;
  return true;
end;
$$;

revoke all on function public.commit_meeting_analysis(uuid, integer, text, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_meeting_analysis(uuid, integer, text, text, jsonb, jsonb, jsonb)
  to service_role;

-- Wrap the existing atomic split and increment the revision in the same outer
-- transaction. Any exception rolls both operations back.
create or replace function public.split_transcript_segment_revisioned(
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
  split_result jsonb;
  new_revision integer;
begin
  split_result := public.split_transcript_segment(
    p_meeting_id, p_segment_id, p_owner_id, p_parts
  );
  new_revision := public.mark_transcript_manually_edited(p_meeting_id, p_owner_id);
  return split_result || jsonb_build_object(
    'analysis_stale', true,
    'transcript_revision', new_revision
  );
end;
$$;

revoke all on function public.split_transcript_segment_revisioned(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.split_transcript_segment_revisioned(uuid, uuid, uuid, jsonb)
  to service_role;

-- The application verifies this migration and 0028 is updated in lockstep.
notify pgrst, 'reload schema';
