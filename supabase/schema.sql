-- StudyOS — database schema (Phase C2)
--
-- HOW TO APPLY: open your Supabase project → SQL Editor → New query → paste this whole file →
-- Run. Safe to run more than once (everything is "if not exists" / "drop … if exists").
--
-- MODEL: one row per user, holding the entire app state as a single JSON blob — the exact same
-- shape the app used to keep in the browser's localStorage. This keeps the C2 change small:
-- load() = "fetch my row", save() = "upsert my row", and nothing else in the app changes.
-- We can normalise into real columns/tables later if querying ever needs it.

create table if not exists public.user_data (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Row-level security: a logged-in user can only ever see or change their own row. Without this,
-- the publishable/anon key would let any client read every row.
alter table public.user_data enable row level security;

drop policy if exists "read own row"   on public.user_data;
drop policy if exists "insert own row" on public.user_data;
drop policy if exists "update own row" on public.user_data;

create policy "read own row" on public.user_data
  for select using (auth.uid() = user_id);

create policy "insert own row" on public.user_data
  for insert with check (auth.uid() = user_id);

create policy "update own row" on public.user_data
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
