-- Minimal database schema for the Vercel Hobby studio edition.
-- Run this entire file once in Supabase Dashboard > SQL Editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  role text not null default 'user' check (role in ('user', 'super_admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.case_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  case_id integer not null check (case_id > 0),
  created_at timestamptz not null default now(),
  unique (user_id, case_id)
);

create table if not exists public.generation_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  case_id integer not null,
  prompt text not null,
  status text not null check (status in ('succeeded', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists case_favorites_user_created_idx on public.case_favorites (user_id, created_at desc);
create index if not exists generation_records_user_created_idx on public.generation_records (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.case_favorites enable row level security;
alter table public.generation_records enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile" on public.profiles for select using ((select auth.uid()) = id);
drop policy if exists "Users can read own case favorites" on public.case_favorites;
create policy "Users can read own case favorites" on public.case_favorites for select using ((select auth.uid()) = user_id);
drop policy if exists "Users can create own case favorites" on public.case_favorites;
create policy "Users can create own case favorites" on public.case_favorites for insert with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete own case favorites" on public.case_favorites;
create policy "Users can delete own case favorites" on public.case_favorites for delete using ((select auth.uid()) = user_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
