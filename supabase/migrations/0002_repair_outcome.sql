-- Adds post-visit outcome capture to repair_briefs: what the technician actually found, whether
-- the repair was completed on this visit, and whether a second visit is required. This is the
-- data the first-time-fix metric is computed from (see isFirstTimeFix in repair-briefs.ts).
--
-- Additive only, nullable, no backfill needed -- every existing row simply has no outcome yet.
-- Applied live 2026-09-13 with user go-ahead; confirmed present via live schema introspection.

alter table public.repair_briefs
  add column if not exists outcome_json text;
