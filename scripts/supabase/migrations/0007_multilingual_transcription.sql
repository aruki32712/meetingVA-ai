alter table public.meetings
add column if not exists detected_language text,
add column if not exists transcript_language text,
add column if not exists translation_language text,
add column if not exists translate_to_english boolean not null default false,
add column if not exists transcript_kind text not null default 'original'
  check (transcript_kind in ('original', 'translated', 'both'));

alter table public.transcript_segments
add column if not exists original_text text,
add column if not exists translated_text text,
add column if not exists transcript_kind text not null default 'original'
  check (transcript_kind in ('original', 'translated', 'both'));

create index if not exists meetings_detected_language_idx
on public.meetings(detected_language);

create index if not exists meetings_transcript_language_idx
on public.meetings(transcript_language);
