alter table public.meetings
add column if not exists expected_speaker_count smallint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'meetings_expected_speaker_count_check'
      and conrelid = 'public.meetings'::regclass
  ) then
    alter table public.meetings
    add constraint meetings_expected_speaker_count_check
    check (expected_speaker_count is null or expected_speaker_count between 1 and 20);
  end if;
end
$$;

comment on column public.meetings.expected_speaker_count is
'Optional user-provided count for diagnostics and future diarization providers; not sent to Deepgram.';

notify pgrst, 'reload schema';
