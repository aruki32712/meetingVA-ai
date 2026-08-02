-- Reconcile the complete multilingual schema used by transcription,
-- on-demand translation, Meeting Intelligence, and the meeting detail UI.

alter table public.meetings
  add column if not exists detected_language text,
  add column if not exists transcript_language text,
  add column if not exists translation_language text,
  add column if not exists translation_status text not null default 'not_requested',
  add column if not exists translate_to_english boolean not null default false,
  add column if not exists transcript_kind text not null default 'original',
  add column if not exists summary_translated text,
  add column if not exists brief_translated text;

alter table public.transcript_segments
  add column if not exists original_text text,
  add column if not exists translated_text text,
  add column if not exists transcript_kind text not null default 'original';

alter table public.action_items
  add column if not exists translated_title text,
  add column if not exists translated_description text;

alter table public.decisions
  add column if not exists translated_title text,
  add column if not exists translated_description text;

alter table public.questions
  add column if not exists translated_question text,
  add column if not exists translated_answer text;

-- ADD COLUMN IF NOT EXISTS does not retrofit defaults or nullability when a
-- partially deployed column already exists, so reconcile those attributes too.
update public.meetings
set translation_status = 'not_requested'
where translation_status is null;

update public.meetings
set translate_to_english = false
where translate_to_english is null;

update public.meetings
set transcript_kind = 'original'
where transcript_kind is null;

update public.transcript_segments
set transcript_kind = 'original'
where transcript_kind is null;

alter table public.meetings
  alter column translation_status set default 'not_requested',
  alter column translation_status set not null,
  alter column translate_to_english set default false,
  alter column translate_to_english set not null,
  alter column transcript_kind set default 'original',
  alter column transcript_kind set not null;

alter table public.transcript_segments
  alter column transcript_kind set default 'original',
  alter column transcript_kind set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.meetings'::regclass
      and conname = 'meetings_translation_status_check'
  ) then
    alter table public.meetings
      add constraint meetings_translation_status_check
      check (translation_status in ('not_requested', 'not_needed', 'translated', 'failed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.meetings'::regclass
      and conname = 'meetings_transcript_kind_check'
  ) then
    alter table public.meetings
      add constraint meetings_transcript_kind_check
      check (transcript_kind in ('original', 'translated', 'both'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.transcript_segments'::regclass
      and conname = 'transcript_segments_transcript_kind_check'
  ) then
    alter table public.transcript_segments
      add constraint transcript_segments_transcript_kind_check
      check (transcript_kind in ('original', 'translated', 'both'));
  end if;
end
$$;

create index if not exists meetings_detected_language_idx
  on public.meetings (detected_language);

create index if not exists meetings_transcript_language_idx
  on public.meetings (transcript_language);

NOTIFY pgrst, 'reload schema';
