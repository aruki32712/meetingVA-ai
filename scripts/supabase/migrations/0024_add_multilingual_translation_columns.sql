-- Add the complete translated-content contract used by the multilingual UI
-- and translation endpoint. These content fields are neither filtered nor
-- ordered by the application, so no additional indexes are required.

alter table public.meetings
  add column if not exists summary_translated text,
  add column if not exists brief_translated text;

alter table public.transcript_segments
  add column if not exists translated_text text;

alter table public.action_items
  add column if not exists translated_title text,
  add column if not exists translated_description text;

alter table public.decisions
  add column if not exists translated_title text,
  add column if not exists translated_description text;

alter table public.questions
  add column if not exists translated_question text,
  add column if not exists translated_answer text;

NOTIFY pgrst, 'reload schema';
