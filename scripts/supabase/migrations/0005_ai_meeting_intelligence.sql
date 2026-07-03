alter table public.meetings
add column if not exists summary text,
add column if not exists brief text;

alter type public.meeting_processing_status add value if not exists 'analyzing';
alter type public.meeting_processing_status add value if not exists 'analyzed';
alter type public.meeting_processing_status add value if not exists 'analysis_failed';
