create type public.project_progress_status as enum (
  'not_started',
  'in_progress',
  'blocked',
  'complete'
);

create table public.project_progress_phases (
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

create table public.project_progress_checklist_items (
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

create index project_progress_phases_owner_id_idx
on public.project_progress_phases(owner_id);

create index project_progress_checklist_items_phase_id_idx
on public.project_progress_checklist_items(phase_id);

create trigger set_project_progress_phases_updated_at
before update on public.project_progress_phases
for each row execute function public.set_updated_at();

create trigger set_project_progress_checklist_items_updated_at
before update on public.project_progress_checklist_items
for each row execute function public.set_updated_at();

alter table public.project_progress_phases enable row level security;
alter table public.project_progress_checklist_items enable row level security;

create policy "Users manage own project progress phases"
on public.project_progress_phases
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "Users manage own project progress checklist items"
on public.project_progress_checklist_items
for all
using (exists (
  select 1 from public.project_progress_phases
  where project_progress_phases.id = project_progress_checklist_items.phase_id
    and project_progress_phases.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.project_progress_phases
  where project_progress_phases.id = project_progress_checklist_items.phase_id
    and project_progress_phases.owner_id = auth.uid()
));
