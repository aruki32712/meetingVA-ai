-- Reconcile the authenticated, user-owned project roadmap tracker.

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

create index if not exists project_progress_phases_owner_id_idx
on public.project_progress_phases(owner_id);

create index if not exists project_progress_checklist_items_phase_id_idx
on public.project_progress_checklist_items(phase_id);

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

comment on table public.project_progress_phases is
  'User-owned MeetingVA roadmap phases. Current defaults are seeded by the authenticated frontend.';
