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

-- Bug reports — submitted from the "Report a bug" button (any signed-in user), reviewed from the
-- in-app admin list (lib/constants.js's ADMIN_EMAILS — keep the two in sync). No service-role key
-- or server route needed: RLS enforces the admin check at the database level regardless of what
-- the client claims, same pattern as user_data above.
create table if not exists public.bug_reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  user_email  text,        -- snapshot at submit time, so a report stays legible if the account is later deleted
  message     text not null,
  page        text,        -- which tab the report was submitted from (e.g. "acad", "week")
  app_version text,
  status      text not null default 'open' check (status in ('open','resolved')),
  created_at  timestamptz not null default now()
);

alter table public.bug_reports enable row level security;

drop policy if exists "insert own bug report" on public.bug_reports;
drop policy if exists "read own or admin bug reports" on public.bug_reports;
drop policy if exists "admin update bug reports" on public.bug_reports;

create policy "insert own bug report" on public.bug_reports
  for insert with check (auth.uid() = user_id);

-- A reporter can see their own reports; the admin (by email) can see everyone's.
-- KEEP IN SYNC with ADMIN_EMAILS in lib/constants.js.
create policy "read own or admin bug reports" on public.bug_reports
  for select using (
    auth.uid() = user_id
    or (auth.jwt() ->> 'email') in ('avishai_shmariahu@hotmail.com')
  );

create policy "admin update bug reports" on public.bug_reports
  for update using ((auth.jwt() ->> 'email') in ('avishai_shmariahu@hotmail.com'))
  with check ((auth.jwt() ->> 'email') in ('avishai_shmariahu@hotmail.com'));

-- Shared, cross-user cache for college-calendar lookups (term dates/holidays from
-- /api/college-calendar's real Anthropic web-search call) — real cost concern: without this,
-- every user's every lookup of the same school pays for a fresh AI call, even if someone else
-- already looked up that exact school recently. Deliberately NOT a bulk pre-fetch of every US
-- school (considered and rejected — this app's real users only ever touch a handful of schools,
-- and academic calendars are per-term so a bulk fetch goes stale almost immediately anyway); this
-- populates lazily, one row per school actually looked up, reused until that term's own end date
-- passes. Not sensitive data (public academic calendars), so RLS is deliberately permissive: any
-- signed-in user can read or write any row.
create table if not exists public.college_calendar_cache (
  school_name   text not null,
  after_date    text not null default '', -- '' = no anchor ("current or upcoming"); part of the key since a different anchor needs a different answer
  schedule_type text,
  term_name     text,
  term_start    text,
  term_end      text,
  holidays      jsonb,
  source_url    text,
  fetched_at    timestamptz not null default now(),
  primary key (school_name, after_date)
);

alter table public.college_calendar_cache enable row level security;

drop policy if exists "authenticated read calendar cache" on public.college_calendar_cache;
drop policy if exists "authenticated insert calendar cache" on public.college_calendar_cache;
drop policy if exists "authenticated update calendar cache" on public.college_calendar_cache;

create policy "authenticated read calendar cache" on public.college_calendar_cache
  for select using (auth.role() = 'authenticated');
create policy "authenticated insert calendar cache" on public.college_calendar_cache
  for insert with check (auth.role() = 'authenticated');
create policy "authenticated update calendar cache" on public.college_calendar_cache
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Invite codes — signup requires a valid code (cost/abuse control), and any signed-in user gets
-- their own shareable code (the actual "invite a friend" feature). Redeeming happens BEFORE the
-- auth account is created (no session yet), so it can't go through a normal RLS-gated table read
-- — anon would need SELECT on the whole table to check one code, which would let anyone list every
-- valid code. Instead, two SECURITY DEFINER functions do the only two things anyone's allowed to
-- do: redeem one code (atomically, so two people can't win a race past a code's use limit), or
-- create-or-fetch the caller's own code. Neither function ever returns another row's data.
create table if not exists public.invite_codes (
  code       text primary key,
  owner_id   uuid references auth.users(id) on delete set null, -- null = admin-seeded code, not tied to one user
  max_uses   int not null default 20,
  use_count  int not null default 0,
  created_at timestamptz not null default now()
);

-- Self-healing: an earlier version of get_or_create_my_invite_code() below had a race condition
-- (check-then-insert, not atomic) that could leave two rows for the same owner_id — caught via
-- React's dev-mode double-effect invocation. Clean up any such duplicates (keep the oldest) BEFORE
-- adding the constraint that now prevents it, so this file stays safe to re-run on an already-
-- affected database, not just a fresh one.
delete from public.invite_codes a using public.invite_codes b
  where a.owner_id is not null
    and a.owner_id = b.owner_id
    and a.created_at > b.created_at;

-- One code per owner. NULL owner_id (admin-seeded codes) is exempt — Postgres unique constraints
-- allow any number of NULLs — so multiple shared launch codes are still fine.
alter table public.invite_codes drop constraint if exists invite_codes_owner_id_key;
alter table public.invite_codes add constraint invite_codes_owner_id_key unique (owner_id);

alter table public.invite_codes enable row level security;

drop policy if exists "owner reads own invite code" on public.invite_codes;

-- The only direct table access anyone gets: a signed-in user reading their OWN code (to show/copy
-- it and see its use_count) — never anyone else's. Redeeming and creating go through the functions
-- below instead, since those need to work for a not-yet-authenticated signup and need atomicity.
create policy "owner reads own invite code" on public.invite_codes
  for select using (auth.uid() = owner_id);

create or replace function public.redeem_invite_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  update public.invite_codes
    set use_count = use_count + 1
    where code = upper(trim(p_code)) and use_count < max_uses
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

create or replace function public.get_or_create_my_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  -- Always attempt an insert; the unique owner_id constraint makes this atomic — if a concurrent
  -- call already created a row for this owner (two effect-invocations, two browser tabs, whatever),
  -- ON CONFLICT DO NOTHING silently skips ours and the SELECT below picks up the one that won,
  -- instead of the old check-then-insert race that could leave two rows for one owner.
  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  insert into public.invite_codes(code, owner_id) values (v_code, auth.uid())
    on conflict (owner_id) do nothing;
  select code into v_code from public.invite_codes where owner_id = auth.uid();
  return v_code;
end;
$$;

-- redeem_invite_code must be callable pre-auth (signup has no session yet); get_or_create only
-- makes sense once signed in.
grant execute on function public.redeem_invite_code(text) to anon, authenticated;
grant execute on function public.get_or_create_my_invite_code() to authenticated;

-- Seed at least one starting code for launch, e.g.:
--   insert into public.invite_codes(code, max_uses) values ('STUDYOS2026', 30);
