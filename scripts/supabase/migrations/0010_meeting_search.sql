create index if not exists meetings_search_idx
on public.meetings using gin (
  to_tsvector(
    'simple',
    coalesce(title, '') || ' ' ||
    coalesce(description, '') || ' ' ||
    coalesce(summary, '') || ' ' ||
    coalesce(brief, '')
  )
);

create index if not exists meetings_tags_gin_idx
on public.meetings using gin (tags);

create index if not exists transcript_segments_search_idx
on public.transcript_segments using gin (to_tsvector('simple', coalesce(text, '')));

create index if not exists action_items_search_idx
on public.action_items using gin (
  to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))
);

create index if not exists decisions_search_idx
on public.decisions using gin (
  to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))
);

create index if not exists questions_search_idx
on public.questions using gin (
  to_tsvector('simple', coalesce(question, '') || ' ' || coalesce(answer, ''))
);

create index if not exists participants_search_idx
on public.participants using gin (
  to_tsvector(
    'simple',
    coalesce(display_name, '') || ' ' ||
    coalesce(email, '') || ' ' ||
    coalesce(role, '')
  )
);

create index if not exists tags_search_idx
on public.tags using gin (to_tsvector('simple', coalesce(name, '')));

create or replace function public.search_meetings(
  search_query text default '',
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
  meeting_date date,
  processing_status text,
  matching_excerpt text,
  match_type text,
  rank real
)
language sql
stable
security invoker
set search_path = public
as $$
  with search_input as (
    select
      nullif(btrim(search_query), '') as query_text,
      case
        when nullif(btrim(search_query), '') is null then null
        else websearch_to_tsquery('simple', btrim(search_query))
      end as query
  ),
  eligible_meetings as (
    select
      m.*,
      latest_job.status::text as processing_status
    from public.meetings m
    left join lateral (
      select processing_jobs.status
      from public.processing_jobs
      where processing_jobs.meeting_id = m.id
      order by processing_jobs.created_at desc
      limit 1
    ) latest_job on true
    where auth.uid() is not null
      and m.owner_id = auth.uid()
      and (date_from is null or m.meeting_date >= date_from)
      and (date_to is null or m.meeting_date <= date_to)
      and (
        status_filter is null
        or status_filter = ''
        or latest_job.status::text = status_filter
      )
      and (
        participant_filter is null
        or participant_filter = ''
        or exists (
          select 1
          from public.participants p
          where p.meeting_id = m.id
            and p.display_name ilike '%' || participant_filter || '%'
        )
      )
      and (
        tag_filter is null
        or tag_filter = ''
        or exists (
          select 1
          from unnest(m.tags) meeting_tag
          where meeting_tag ilike tag_filter
        )
        or exists (
          select 1
          from public.meeting_tags mt
          join public.tags t on t.id = mt.tag_id
          where mt.meeting_id = m.id
            and t.name ilike tag_filter
        )
      )
  ),
  searchable_content as (
    select m.id, 'title'::text as content_type, m.title as content
    from eligible_meetings m
    union all
    select m.id, 'description', m.description
    from eligible_meetings m
    where m.description is not null
    union all
    select m.id, 'summary', m.summary
    from eligible_meetings m
    where m.summary is not null
    union all
    select m.id, 'brief', m.brief
    from eligible_meetings m
    where m.brief is not null
    union all
    select s.meeting_id, 'transcript', s.text
    from public.transcript_segments s
    join eligible_meetings m on m.id = s.meeting_id
    union all
    select a.meeting_id, 'action item', concat_ws(' — ', a.title, a.description)
    from public.action_items a
    join eligible_meetings m on m.id = a.meeting_id
    union all
    select d.meeting_id, 'decision', concat_ws(' — ', d.title, d.description)
    from public.decisions d
    join eligible_meetings m on m.id = d.meeting_id
    union all
    select q.meeting_id, 'question', concat_ws(' — ', q.question, q.answer)
    from public.questions q
    join eligible_meetings m on m.id = q.meeting_id
    union all
    select p.meeting_id, 'participant', concat_ws(' — ', p.display_name, p.email, p.role)
    from public.participants p
    join eligible_meetings m on m.id = p.meeting_id
    union all
    select m.id, 'tag', meeting_tag
    from eligible_meetings m
    cross join lateral unnest(m.tags) meeting_tag
    union all
    select mt.meeting_id, 'tag', t.name
    from public.meeting_tags mt
    join public.tags t on t.id = mt.tag_id
    join eligible_meetings m on m.id = mt.meeting_id
  ),
  matches as (
    select
      sc.meeting_id,
      sc.content_type,
      sc.content,
      case
        when si.query is null then 0::real
        else ts_rank_cd(to_tsvector('simple', coalesce(sc.content, '')), si.query)
      end as relevance,
      si.query
    from searchable_content sc
    cross join search_input si
    where si.query is null
      or to_tsvector('simple', coalesce(sc.content, '')) @@ si.query
  ),
  best_match as (
    select distinct on (matches.meeting_id)
      matches.meeting_id,
      matches.content_type,
      matches.content,
      matches.relevance,
      matches.query
    from matches
    order by matches.meeting_id, matches.relevance desc, matches.content_type
  )
  select
    m.id,
    m.title,
    m.meeting_date,
    m.processing_status,
    case
      when bm.query is null then left(coalesce(nullif(bm.content, ''), m.description, m.title), 240)
      else ts_headline(
        'simple',
        bm.content,
        bm.query,
        'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=12, ShortWord=3'
      )
    end,
    bm.content_type,
    bm.relevance
  from best_match bm
  join eligible_meetings m on m.id = bm.meeting_id
  order by bm.relevance desc, m.meeting_date desc, m.created_at desc
  limit least(greatest(result_limit, 1), 100);
$$;

revoke all on function public.search_meetings(text, date, date, text, text, text, integer)
from public;

grant execute on function public.search_meetings(text, date, date, text, text, text, integer)
to authenticated;
