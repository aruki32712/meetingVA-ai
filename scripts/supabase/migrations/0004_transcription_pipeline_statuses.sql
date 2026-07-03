alter type public.meeting_processing_status add value if not exists 'transcribing';
alter type public.meeting_processing_status add value if not exists 'transcribed';
alter type public.meeting_processing_status add value if not exists 'transcription_failed';
