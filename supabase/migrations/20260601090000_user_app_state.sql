-- Stores browser-local BankDash settings as per-user synced application state.

create table if not exists public.user_app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state_schema_version integer not null default 1,
  state jsonb not null default '{}'::jsonb,
  state_checksum text,
  client_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger user_app_state_set_updated_at
before update on public.user_app_state
for each row execute function public.set_updated_at();

alter table public.user_app_state enable row level security;

create policy "Users manage own synced app state"
on public.user_app_state for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
