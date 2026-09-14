-- A small DB-backed rate limiter for the two Edge Functions that are public and unauthenticated
-- by design (get-shared-brief, calle-webhook): each request is recorded here keyed by a bucket
-- (function name + client IP), and the function rejects with 429 once too many hits land inside
-- a short rolling window. An in-memory counter inside the function would reset on every cold
-- start and wouldn't share state across concurrent instances/regions -- this table is the
-- straightforward fix, cheap at this scale, and each function opportunistically deletes its own
-- stale rows on every hit rather than needing a separate cleanup job.
--
-- RLS is enabled with no policies: only the service-role client (used exclusively by these Edge
-- Functions) can read or write this table. No authenticated app user ever touches it directly.

create table if not exists public.rate_limit_hits (
  id uuid primary key default gen_random_uuid(),
  bucket_key text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_hits_bucket_created_idx
  on public.rate_limit_hits (bucket_key, created_at);

alter table public.rate_limit_hits enable row level security;
