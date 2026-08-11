-- Complete, idempotent schema contract for revision-aware transcript editing.
-- Behavioral RPCs remain defined in 0029_transcript_revision_analysis.sql.

alter table public.meetings
  add column if not exists analysis_stale boolean not null default false,
  add column if not exists transcript_revision integer not null default 1,
  add column if not exists analysis_revision integer;

alter table public.processing_jobs
  add column if not exists transcript_revision integer;

-- Reconcile partially deployed columns before enforcing the live contract.
update public.meetings
set analysis_stale = false
where analysis_stale is null;

update public.meetings
set transcript_revision = 1
where transcript_revision is null or transcript_revision < 1;

update public.meetings
set analysis_revision = null
where analysis_revision is not null
  and (analysis_revision < 1 or analysis_revision > transcript_revision);

update public.processing_jobs
set transcript_revision = null
where transcript_revision is not null and transcript_revision < 1;

alter table public.meetings
  alter column analysis_stale set default false,
  alter column analysis_stale set not null,
  alter column transcript_revision set default 1,
  alter column transcript_revision set not null;

alter table public.meetings
  drop constraint if exists meetings_transcript_revision_check,
  drop constraint if exists meetings_analysis_revision_check;

alter table public.meetings
  add constraint meetings_transcript_revision_check
    check (transcript_revision >= 1),
  add constraint meetings_analysis_revision_check
    check (
      analysis_revision is null
      or (analysis_revision >= 1 and analysis_revision <= transcript_revision)
    );

alter table public.processing_jobs
  drop constraint if exists processing_jobs_transcript_revision_check;

alter table public.processing_jobs
  add constraint processing_jobs_transcript_revision_check
    check (transcript_revision is null or transcript_revision >= 1);

create unique index if not exists processing_jobs_one_active_analysis_idx
  on public.processing_jobs(meeting_id)
  where job_type = 'analysis' and status in ('queued', 'analyzing');

notify pgrst, 'reload schema';
