-- Preserve original-language meeting intelligence and cache optional translations.
alter table public.meetings
  add column if not exists summary_translated text,
  add column if not exists brief_translated text,
  add column if not exists detected_language text,
  add column if not exists transcript_language text,
  add column if not exists translation_language text,
  add column if not exists translation_status text not null default 'not_requested';

alter table public.action_items
  add column if not exists translated_title text,
  add column if not exists translated_description text;

alter table public.decisions
  add column if not exists translated_title text,
  add column if not exists translated_description text;

alter table public.questions
  add column if not exists translated_question text,
  add column if not exists translated_answer text;

notify pgrst, 'reload schema';
