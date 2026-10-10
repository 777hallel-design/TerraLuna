-- TerraLuna: sync of the garden journal, settings and Maria Thun times.
-- Run once in Supabase → SQL Editor → New query → Run.
-- Row Level Security makes every row visible only to the person who owns it.

create table if not exists public.journal_entries (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  text text not null default '',            -- '' marks a deleted entry
  client_updated bigint not null,            -- ms since 1970 on the device that wrote it; newest wins
  server_updated timestamptz not null default now(),
  primary key (user_id, day)
);
create index if not exists journal_entries_changes on public.journal_entries (user_id, server_updated);

create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  settings jsonb,
  settings_updated bigint not null default 0,
  thun jsonb,
  thun_updated bigint not null default 0,
  server_updated timestamptz not null default now()
);

create or replace function public.terraluna_touch() returns trigger
language plpgsql as $$
begin
  new.server_updated := now();
  return new;
end $$;

drop trigger if exists journal_entries_touch on public.journal_entries;
create trigger journal_entries_touch before insert or update on public.journal_entries
  for each row execute function public.terraluna_touch();
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before insert or update on public.profiles
  for each row execute function public.terraluna_touch();

alter table public.journal_entries enable row level security;
alter table public.profiles enable row level security;

drop policy if exists "own journal" on public.journal_entries;
create policy "own journal" on public.journal_entries for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
