-- RepairReady — schema reproducibility snapshot
--
-- This file documents the schema as it exists on the live Supabase project
-- (introspected 2026-09-13). It is written so a clean project can be brought
-- up to the same state with `supabase db push` / `psql -f`. It intentionally
-- mirrors the live database rather than changing it — no destructive or
-- corrective statements live here.
--
-- Three tables, each owner-scoped by `created_by = auth.uid()` under RLS:
--   repair_jobs    coordinator-entered intake facts
--   call_attempts  the approve -> dispatch state machine for a CALL-E call
--   repair_briefs  the technician-facing evidence/readiness output

-- ---------------------------------------------------------------------------
-- repair_jobs
-- ---------------------------------------------------------------------------
create table if not exists public.repair_jobs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  demo_marker text,
  customer_name text not null default '',
  phone text not null default '',
  appliance_type text not null default '',
  brand text,
  model text,
  reported_problem text not null default '',
  symptom_timing text,
  error_code text,
  visit_note text,
  access_notes text,
  operator_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists repair_jobs_created_by_idx
  on public.repair_jobs using btree (created_by, updated_at desc);

alter table public.repair_jobs enable row level security;

create policy owner_select on public.repair_jobs
  for select using (created_by = auth.uid());
create policy owner_insert on public.repair_jobs
  for insert with check (created_by = auth.uid());
create policy owner_update on public.repair_jobs
  for update using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy owner_delete on public.repair_jobs
  for delete using (created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- call_attempts
-- ---------------------------------------------------------------------------
create table if not exists public.call_attempts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  demo_marker text,
  repair_job_id uuid not null references public.repair_jobs(id) on delete cascade,
  recipient_name text,
  recipient_phone text,
  recipient_region text,
  recipient_locale text,
  preparation_purpose text,
  question_outline text,
  request_snapshot text,
  idempotency_key text,
  lifecycle_status text not null default 'prepared',
  approval_state text not null default 'not_approved',
  approved_recipient_phone text,
  approved_at text,
  approval_expires_at text,
  provider_call_id text,
  provider_status text,
  submitted_at text,
  completed_at text,
  safe_error_category text,
  safe_result_summary text,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists call_attempts_created_by_idx
  on public.call_attempts using btree (created_by, updated_at desc);
create index if not exists call_attempts_job_idx
  on public.call_attempts using btree (repair_job_id, updated_at desc);

alter table public.call_attempts enable row level security;

create policy owner_select on public.call_attempts
  for select using (created_by = auth.uid());
create policy owner_insert on public.call_attempts
  for insert with check (created_by = auth.uid());
create policy owner_update on public.call_attempts
  for update using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy owner_delete on public.call_attempts
  for delete using (created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- repair_briefs
-- ---------------------------------------------------------------------------
create table if not exists public.repair_briefs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  repair_job_id uuid not null references public.repair_jobs(id) on delete cascade,
  call_attempt_id uuid references public.call_attempts(id) on delete set null,
  call_completion_status text not null default 'not_started',
  readiness_status text not null default 'unknown',
  human_review_state text not null default 'not_reviewed',
  human_review_note text,
  reviewed_at text,
  evidence_json text,
  blockers_json text,
  follow_up_json text,
  follow_up_review_json text,
  safe_summary text,
  share_token text unique,
  share_expires_at text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists repair_briefs_created_by_idx
  on public.repair_briefs using btree (created_by, updated_at desc);
create index if not exists repair_briefs_job_idx
  on public.repair_briefs using btree (repair_job_id, updated_at desc);
create index if not exists repair_briefs_share_token_idx
  on public.repair_briefs using btree (share_token) where (share_token is not null);

alter table public.repair_briefs enable row level security;

create policy owner_select on public.repair_briefs
  for select using (created_by = auth.uid());
create policy owner_insert on public.repair_briefs
  for insert with check (created_by = auth.uid());
create policy owner_update on public.repair_briefs
  for update using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy owner_delete on public.repair_briefs
  for delete using (created_by = auth.uid());
