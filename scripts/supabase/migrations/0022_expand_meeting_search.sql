-- Replace the stale title/description search contract with an owner-scoped,
-- meeting-level search across the complete MeetingVA data model.

create extension if not exists pg_trgm;

create index if not exists meetings_title_search_trgm_idx
on public.meetings using gin (title gin_trgm_ops);
create index if not exists meetings_description_search_trgm_idx
on public.meetings using gin (description gin_trgm_ops);
create index if not exists meetings_summary_search_trgm_idx
on public.meetings using gin (summary gin_trgm_ops);
create index if not exists meetings_brief_search_trgm_idx
on public.meetings using gin (brief gin_trgm_ops);

create index if not exists transcript_segments_text_search_trgm_idx
on public.transcript_segments using gin (text gin_trgm_ops);
create index if not exists transcript_segments_original_search_trgm_idx
on public.transcript_segments using gin (original_text gin_trgm_ops);
create index if not exists transcript_segments_translated_search_trgm_idx
on public.transcript_segments using gin (translated_text gin_trgm_ops);
create index if not exists transcript_segments_speaker_search_trgm_idx
on public.transcript_segments using gin (speaker_label gin_trgm_ops);

create index if not exists participants_display_name_search_trgm_idx
on public.participants using gin (display_name gin_trgm_ops);
create index if not exists participants_speaker_label_search_trgm_idx
on public.participants using gin (speaker_label gin_trgm_ops);
create index if not exists participants_email_search_trgm_idx
on public.participants using gin (email gin_trgm_ops);

create index if not exists action_items_title_search_trgm_idx
on public.action_items using gin (title gin_trgm_ops);
create index if not exists action_items_description_search_trgm_idx
on public.action_items using gin (description gin_trgm_ops);
create index if not exists decisions_title_search_trgm_idx
on public.decisions using gin (title gin_trgm_ops);
create index if not exists decisions_description_search_trgm_idx
on public.decisions using gin (description gin_trgm_ops);
create index if not exists questions_question_search_trgm_idx
on public.questions using gin (question gin_trgm_ops);
create index if not exists questions_answer_search_trgm_idx
on public.questions using gin (answer gin_trgm_ops);
create index if not exists tags_name_search_trgm_idx
on public.tags using gin (name gin_trgm_ops);

drop function if exists public.search_meetings(text, date, date, text, text, text, integer);

create function public.search_meetings(
  search_text text default '',
  date_from date default null,
  date_to date default null,
  status_filter text default null,
  participant_filter text default null,
  tag_filter text default null,
  result_limit integer default 50
)
returns table (
  meeting_id uuid,
  meeting_title text,
  scheduled_at timestamptz,
  meeting_status text,
  matching_excerpt text,
  match_type text,
  match_anchor text,
  rank real,
  additional_match_types text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_owner_id uuid := auth.uid();
begin
  if current_owner_id is null then
    raise exception 'Authentication is required to search meetings.'
      using errcode = '42501';
  end if;

  return query
  with search_input as (
    select
      btrim(coalesce(search_text, '')) as query_text,
      replace(
        replace(
          replace(btrim(coalesce(search_text, '')), E'\\', E'\\\\'),
          '%',
          E'\\%'
        ),
        '_',
        E'\\_'
      ) as escaped_query,
      replace(replace(replace(coalesce(participant_filter, ''), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') as participant_query,
      replace(replace(replace(coalesce(tag_filter, ''), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') as tag_query
  ),
  eligible_meetings as (
    select meeting.*
    from public.meetings as meeting
    cross join search_input as input
    where meeting.owner_id = current_owner_id
      and (date_from is null or meeting.scheduled_at::date >= date_from)
      and (date_to is null or meeting.scheduled_at::date <= date_to)
      and (
        status_filter is null
        or btrim(status_filter) = ''
        or meeting.status::text = status_filter
      )
      and (
        participant_filter is null
        or btrim(participant_filter) = ''
        or exists (
          select 1
          from public.participants as participant
          where participant.meeting_id = meeting.id
            and participant.display_name ilike '%' || input.participant_query || '%' escape E'\\'
        )
      )
      and (
        tag_filter is null
        or btrim(tag_filter) = ''
        or exists (
          select 1
          from public.meeting_tags as meeting_tag
          join public.tags as tag on tag.id = meeting_tag.tag_id
          where meeting_tag.meeting_id = meeting.id
            and tag.owner_id = current_owner_id
            and tag.name ilike '%' || input.tag_query || '%' escape E'\\'
        )
      )
  ),
  searchable_content as (
    select meeting.id as meeting_id, 'Title'::text as match_type,
      meeting.title as content, '#meeting-overview'::text as anchor, 1 as priority
    from eligible_meetings as meeting
    union all
    select meeting.id, 'Description', meeting.description, '#meeting-overview', 2
    from eligible_meetings as meeting where meeting.description is not null
    union all
    select meeting.id, 'Summary', meeting.summary, '#meeting-intelligence', 3
    from eligible_meetings as meeting where meeting.summary is not null
    union all
    select meeting.id, 'Meeting Brief', meeting.brief, '#meeting-intelligence', 4
    from eligible_meetings as meeting where meeting.brief is not null
    union all
    select segment.meeting_id, 'Transcript',
      concat_ws(' ', segment.text, segment.original_text, segment.translated_text, segment.speaker_label),
      '#transcript-segment-' || segment.id::text, 5
    from public.transcript_segments as segment
    join eligible_meetings as meeting on meeting.id = segment.meeting_id
    union all
    select item.meeting_id, 'Action Item',
      concat_ws(' ', item.title, item.description, assignee.display_name,
        assignee.speaker_label, assignee.email, item.status::text),
      '#action-item-' || item.id::text, 6
    from public.action_items as item
    join eligible_meetings as meeting on meeting.id = item.meeting_id
    left join public.participants as assignee on assignee.id = item.assignee_participant_id
    union all
    select decision.meeting_id, 'Decision',
      concat_ws(' ', decision.title, decision.description),
      '#decision-' || decision.id::text, 7
    from public.decisions as decision
    join eligible_meetings as meeting on meeting.id = decision.meeting_id
    union all
    select question.meeting_id, 'Question',
      concat_ws(' ', question.question, question.answer, question.status::text),
      '#question-' || question.id::text, 8
    from public.questions as question
    join eligible_meetings as meeting on meeting.id = question.meeting_id
    union all
    select participant.meeting_id, 'Participant',
      concat_ws(' ', participant.display_name, participant.speaker_label, participant.email),
      '#speaker-' || participant.id::text, 9
    from public.participants as participant
    join eligible_meetings as meeting on meeting.id = participant.meeting_id
    union all
    select meeting_tag.meeting_id, 'Tag', tag.name, '#meeting-overview', 10
    from public.meeting_tags as meeting_tag
    join public.tags as tag on tag.id = meeting_tag.tag_id
    join eligible_meetings as meeting on meeting.id = meeting_tag.meeting_id
    where tag.owner_id = current_owner_id
  ),
  matches as (
    select
      content.*,
      input.query_text,
      strpos(lower(content.content), lower(input.query_text)) as match_position
    from searchable_content as content
    cross join search_input as input
    where (
        input.query_text = ''
        or length(input.query_text) >= 2
      )
      and (
        input.query_text = ''
        or content.content ilike '%' || input.escaped_query || '%' escape E'\\'
      )
  ),
  ranked_matches as (
    select
      matches.*,
      row_number() over (
        partition by matches.meeting_id
        order by matches.priority, matches.match_position, matches.match_type
      ) as meeting_match_rank
    from matches
  ),
  match_categories as (
    select
      matches.meeting_id,
      array_agg(distinct matches.match_type order by matches.match_type) as all_match_types
    from matches
    group by matches.meeting_id
  )
  select
    meeting.id,
    meeting.title,
    meeting.scheduled_at,
    meeting.status::text,
    case
      when best.query_text = '' then left(best.content, 240)
      else concat(
        case when best.match_position > 80 then '...' else '' end,
        substring(best.content from greatest(best.match_position - 79, 1) for least(80, greatest(best.match_position - 1, 0))),
        '<mark>',
        substring(best.content from best.match_position for length(best.query_text)),
        '</mark>',
        substring(best.content from best.match_position + length(best.query_text) for 120),
        case when length(best.content) > best.match_position + length(best.query_text) + 119 then '...' else '' end
      )
    end,
    best.match_type,
    best.anchor,
    (100 - best.priority)::real,
    array_remove(categories.all_match_types, best.match_type)
  from ranked_matches as best
  join eligible_meetings as meeting on meeting.id = best.meeting_id
  join match_categories as categories on categories.meeting_id = best.meeting_id
  where best.meeting_match_rank = 1
  order by best.priority, meeting.scheduled_at desc nulls last, meeting.created_at desc
  limit least(greatest(coalesce(result_limit, 50), 1), 100);
end;
$$;

revoke all on function public.search_meetings(text, date, date, text, text, text, integer)
from public;
grant execute on function public.search_meetings(text, date, date, text, text, text, integer)
to authenticated;

comment on function public.search_meetings(text, date, date, text, text, text, integer)
is 'Returns one ranked meeting result per owned meeting across meeting, transcript, intelligence, participant, task, decision, question, and tag content.';

notify pgrst, 'reload schema';
