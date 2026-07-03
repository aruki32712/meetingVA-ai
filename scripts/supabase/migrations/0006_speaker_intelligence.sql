alter table public.participants
add column if not exists source text not null default 'transcript',
add column if not exists voiceprint_ref text,
add column if not exists metadata jsonb not null default '{}'::jsonb,
add column if not exists updated_at timestamptz not null default now();

create index if not exists participants_speaker_label_idx
on public.participants(meeting_id, speaker_label);

create index if not exists transcript_segments_participant_id_idx
on public.transcript_segments(participant_id);

drop trigger if exists set_participants_updated_at on public.participants;

create trigger set_participants_updated_at
before update on public.participants
for each row execute function public.set_updated_at();
