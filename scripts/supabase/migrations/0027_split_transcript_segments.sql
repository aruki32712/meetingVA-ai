alter table public.transcript_segments
  add column if not exists edit_metadata jsonb not null default '{}'::jsonb;

alter table public.meetings
  add column if not exists analysis_stale boolean not null default false;

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
  participant_id uuid;
  participant_row public.participants%rowtype;
  new_segment public.transcript_segments%rowtype;
  created_segments jsonb := '[]'::jsonb;
  created_participants jsonb := '[]'::jsonb;
  translation_requires_regeneration boolean;
  original_alignment_unavailable boolean;
begin
  if not exists (
    select 1 from public.meetings
    where id = p_meeting_id and owner_id = p_owner_id
  ) then
    raise exception 'Meeting was not found.' using errcode = 'P0002';
  end if;

  select * into original
  from public.transcript_segments
  where id = p_segment_id and meeting_id = p_meeting_id
  for update;

  if not found then
    raise exception 'Transcript segment was not found.' using errcode = 'P0002';
  end if;

  if jsonb_typeof(p_parts) <> 'array' then
    raise exception 'Split parts must be an array.' using errcode = '22023';
  end if;
  part_count := jsonb_array_length(p_parts);
  if part_count < 2 then
    raise exception 'At least two non-empty parts are required.' using errcode = '22023';
  end if;

  for part in select value from jsonb_array_elements(p_parts)
  loop
    part_text := btrim(coalesce(part->>'text', ''));
    if part_text = '' then
      raise exception 'Split parts cannot be empty.' using errcode = '22023';
    end if;
    combined_text := concat_ws(' ', nullif(combined_text, ''), part_text);
    total_weight := total_weight + greatest(length(part_text), 1);
  end loop;

  normalized_original := regexp_replace(btrim(original.text), '\s+', ' ', 'g');
  normalized_combined := regexp_replace(btrim(combined_text), '\s+', ' ', 'g');
  if normalized_original <> normalized_combined then
    raise exception 'Split parts must reconstruct the original transcript text.'
      using errcode = '22023';
  end if;

  -- Move later indexes out of the unique-key range until replacement completes.
  update public.transcript_segments
  set segment_index = -segment_index - 1000000
  where meeting_id = p_meeting_id and segment_index > original.segment_index;

  delete from public.transcript_segments where id = original.id;

  for part in select value from jsonb_array_elements(p_parts)
  loop
    part_number := part_number + 1;
    part_text := btrim(part->>'text');
    participant_id := null;

    if nullif(btrim(coalesce(part->>'participant_id', '')), '') is not null then
      participant_id := (part->>'participant_id')::uuid;
      select * into participant_row
      from public.participants
      where id = participant_id and meeting_id = p_meeting_id;
      if not found then
        raise exception 'A selected participant was not found in this meeting.'
          using errcode = 'P0002';
      end if;
    elsif nullif(btrim(coalesce(part->>'display_name', '')), '') is not null then
      insert into public.participants (
        meeting_id, display_name, speaker_label, source, metadata
      ) values (
        p_meeting_id,
        btrim(part->>'display_name'),
        btrim(part->>'display_name'),
        'owner',
        jsonb_build_object(
          'detection_method', 'owner_correction',
          'speaker_label_source', 'user_assigned'
        )
      ) returning * into participant_row;
      participant_id := participant_row.id;
      created_participants := created_participants || to_jsonb(participant_row);
    else
      raise exception 'Every split part requires a speaker assignment.'
        using errcode = '22023';
    end if;

    part_weight := greatest(length(part_text), 1);
    part_start := original.start_ms + floor(
      (original.end_ms - original.start_ms)::numeric
      * cumulative_weight / greatest(total_weight, 1)
    )::integer;
    cumulative_weight := cumulative_weight + part_weight;
    part_end := case
      when part_number = part_count then original.end_ms
      else original.start_ms + floor(
        (original.end_ms - original.start_ms)::numeric
        * cumulative_weight / greatest(total_weight, 1)
      )::integer
    end;
    part_end := greatest(part_start, part_end);

    original_alignment_unavailable := original.original_text is not null
      and regexp_replace(btrim(original.original_text), '\s+', ' ', 'g')
        <> normalized_original;
    translation_requires_regeneration := original.translated_text is not null
      and regexp_replace(btrim(original.translated_text), '\s+', ' ', 'g')
        <> normalized_original;

    insert into public.transcript_segments (
      meeting_id, participant_id, speaker_label, start_ms, end_ms, text,
      original_text, translated_text, transcript_kind, confidence,
      segment_index, edit_metadata
    ) values (
      p_meeting_id,
      participant_id,
      coalesce(participant_row.speaker_label, participant_row.display_name),
      part_start,
      part_end,
      part_text,
      case
        when original.original_text is null then null
        when original_alignment_unavailable then null
        else part_text
      end,
      case when translation_requires_regeneration then null else
        case when original.translated_text is null then null else part_text end
      end,
      original.transcript_kind,
      original.confidence,
      original.segment_index + part_number - 1,
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

  update public.meetings
  set analysis_stale = true, updated_at = now()
  where id = p_meeting_id and owner_id = p_owner_id;

  return jsonb_build_object(
    'segments', created_segments,
    'participants', created_participants,
    'analysis_stale', true
  );
end;
$$;

revoke all on function public.split_transcript_segment(uuid, uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.split_transcript_segment(uuid, uuid, uuid, jsonb)
to service_role;

notify pgrst, 'reload schema';
