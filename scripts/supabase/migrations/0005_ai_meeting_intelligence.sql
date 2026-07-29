alter table public.meetings
add column if not exists summary text,
add column if not exists brief text;
