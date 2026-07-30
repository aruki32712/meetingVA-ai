-- Prevent concurrent idempotent enqueue requests from creating more than one
-- active transcription job for the same meeting.

create unique index if not exists processing_jobs_one_active_transcription_idx
on public.processing_jobs (meeting_id)
where job_type = 'transcription'
  and status in ('queued', 'transcribing');
