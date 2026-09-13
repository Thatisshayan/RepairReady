-- Adds post-visit outcome capture to repair_briefs: what the technician actually found, whether
-- the repair was completed on this visit, and whether a second visit is required. This is the
-- data the first-time-fix metric is computed from (see isFirstTimeFix in repair-briefs.ts).
--
-- Additive only, nullable, no backfill needed -- every existing row simply has no outcome yet.
-- NOT YET APPLIED to the live project; drafted alongside the app code that depends on it and
-- held for explicit go-ahead per project policy on live schema changes.

alter table public.repair_briefs
  add column if not exists outcome_json text;
