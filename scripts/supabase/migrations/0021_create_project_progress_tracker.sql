-- Create and seed the user-owned MeetingVA roadmap contract consumed by the
-- Progress tab. Safe to rerun after either the original or reconciliation
-- progress-tracker migration.

create extension if not exists pgcrypto;

do $$
begin
  create type public.project_progress_status as enum (
    'not_started',
    'in_progress',
    'blocked',
    'complete'
  );
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.project_progress_phases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null,
  status public.project_progress_status not null default 'not_started',
  position integer not null check (position > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, title),
  unique (owner_id, position)
);

create table if not exists public.project_progress_checklist_items (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid not null references public.project_progress_phases(id) on delete cascade,
  label text not null,
  is_complete boolean not null default false,
  position integer not null check (position > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (phase_id, label),
  unique (phase_id, position)
);

create index if not exists project_progress_phases_owner_position_idx
on public.project_progress_phases(owner_id, position);

create index if not exists project_progress_checklist_phase_position_idx
on public.project_progress_checklist_items(phase_id, position);

drop trigger if exists set_project_progress_phases_updated_at
on public.project_progress_phases;
create trigger set_project_progress_phases_updated_at
before update on public.project_progress_phases
for each row execute function public.set_updated_at();

drop trigger if exists set_project_progress_checklist_items_updated_at
on public.project_progress_checklist_items;
create trigger set_project_progress_checklist_items_updated_at
before update on public.project_progress_checklist_items
for each row execute function public.set_updated_at();

alter table public.project_progress_phases enable row level security;
alter table public.project_progress_checklist_items enable row level security;

drop policy if exists "Users manage own project progress phases"
on public.project_progress_phases;
create policy "Users manage own project progress phases"
on public.project_progress_phases
for all
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "Users manage own project progress checklist items"
on public.project_progress_checklist_items;
create policy "Users manage own project progress checklist items"
on public.project_progress_checklist_items
for all
to authenticated
using (exists (
  select 1
  from public.project_progress_phases
  where project_progress_phases.id = project_progress_checklist_items.phase_id
    and project_progress_phases.owner_id = auth.uid()
))
with check (exists (
  select 1
  from public.project_progress_phases
  where project_progress_phases.id = project_progress_checklist_items.phase_id
    and project_progress_phases.owner_id = auth.uid()
));

grant select, insert, update, delete on public.project_progress_phases
to authenticated;
grant select, insert, update, delete on public.project_progress_checklist_items
to authenticated;

create or replace function public.seed_project_progress_for_user(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Move existing positions out of the seed range so the owner/position unique
  -- constraint cannot conflict while stale roadmap rows are reconciled.
  update public.project_progress_phases
  set position = position + 1000
  where owner_id = p_owner_id
    and position < 1000;

  insert into public.project_progress_phases (
    owner_id,
    title,
    description,
    status,
    position
  )
  values
    (p_owner_id, 'Platform Foundation', 'Secure account access and user-owned MeetingVA data.', 'complete', 1),
    (p_owner_id, 'Meeting Capture', 'Create, record, store, and safely remove meetings.', 'complete', 2),
    (p_owner_id, 'Transcription Pipeline', 'Automatically process uploaded audio into a transcript.', 'complete', 3),
    (p_owner_id, 'Meeting Intelligence', 'Generate structured insights from completed transcripts.', 'complete', 4),
    (p_owner_id, 'Speaker Experience', 'Present stable speaker turns without fabricated identities.', 'complete', 5),
    (p_owner_id, 'Product Experience', 'Polish the end-to-end MeetingVA user experience.', 'complete', 6)
  on conflict (owner_id, title) do update
  set description = excluded.description,
      status = excluded.status,
      position = excluded.position,
      updated_at = now();

  delete from public.project_progress_phases
  where owner_id = p_owner_id
    and title not in (
      'Platform Foundation',
      'Meeting Capture',
      'Transcription Pipeline',
      'Meeting Intelligence',
      'Speaker Experience',
      'Product Experience'
    );

  update public.project_progress_checklist_items as checklist
  set position = checklist.position + 1000
  from public.project_progress_phases as phase
  where checklist.phase_id = phase.id
    and phase.owner_id = p_owner_id
    and checklist.position < 1000;

  insert into public.project_progress_checklist_items (
    phase_id,
    label,
    is_complete,
    position
  )
  select phase.id, seed.label, true, seed.position
  from (
    values
      ('Platform Foundation', 'Authentication', 1),
      ('Meeting Capture', 'Meeting creation', 1),
      ('Meeting Capture', 'Audio upload', 2),
      ('Meeting Capture', 'Delete meeting', 3),
      ('Transcription Pipeline', 'Automatic transcription', 1),
      ('Transcription Pipeline', 'Processing timeline', 2),
      ('Transcription Pipeline', 'OpenAI transcription', 3),
      ('Meeting Intelligence', 'Analysis', 1),
      ('Meeting Intelligence', 'Executive summary', 2),
      ('Meeting Intelligence', 'Meeting brief', 3),
      ('Meeting Intelligence', 'Action items', 4),
      ('Meeting Intelligence', 'Decisions', 5),
      ('Meeting Intelligence', 'Questions', 6),
      ('Speaker Experience', 'Speaker handling', 1),
      ('Speaker Experience', 'Diarization', 2),
      ('Product Experience', 'UI polish', 1)
  ) as seed(phase_title, label, position)
  join public.project_progress_phases as phase
    on phase.owner_id = p_owner_id
   and phase.title = seed.phase_title
  on conflict (phase_id, label) do update
  set is_complete = excluded.is_complete,
      position = excluded.position,
      updated_at = now();

  delete from public.project_progress_checklist_items as checklist
  using public.project_progress_phases as phase
  where checklist.phase_id = phase.id
    and phase.owner_id = p_owner_id
    and not exists (
      select 1
      from (
        values
          ('Platform Foundation', 'Authentication'),
          ('Meeting Capture', 'Meeting creation'),
          ('Meeting Capture', 'Audio upload'),
          ('Meeting Capture', 'Delete meeting'),
          ('Transcription Pipeline', 'Automatic transcription'),
          ('Transcription Pipeline', 'Processing timeline'),
          ('Transcription Pipeline', 'OpenAI transcription'),
          ('Meeting Intelligence', 'Analysis'),
          ('Meeting Intelligence', 'Executive summary'),
          ('Meeting Intelligence', 'Meeting brief'),
          ('Meeting Intelligence', 'Action items'),
          ('Meeting Intelligence', 'Decisions'),
          ('Meeting Intelligence', 'Questions'),
          ('Speaker Experience', 'Speaker handling'),
          ('Speaker Experience', 'Diarization'),
          ('Product Experience', 'UI polish')
      ) as expected(phase_title, label)
      where expected.phase_title = phase.title
        and expected.label = checklist.label
    );
end;
$$;

revoke all on function public.seed_project_progress_for_user(uuid) from public;

do $$
declare
  progress_owner record;
begin
  for progress_owner in select id from auth.users loop
    perform public.seed_project_progress_for_user(progress_owner.id);
  end loop;
end
$$;

comment on table public.project_progress_phases is
  'User-owned MeetingVA roadmap phases queried by owner_id and ordered by position.';
comment on table public.project_progress_checklist_items is
  'Checklist rows used to calculate roadmap completion percentage.';

notify pgrst, 'reload schema';
