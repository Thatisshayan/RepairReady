-- CALL-E's own API returns structured transcript turns per call attempt
-- (recipients[].attempts[].transcript_turns) -- real evidence of what was actually said on the
-- call, not a narrated summary. get-calle-call-status now captures it (sanitized through the same
-- safeValue phone/sensitive-term scrubbing as every other call-reported field) alongside the rest
-- of the brief.

alter table public.repair_briefs
  add column if not exists transcript_json text not null default '[]';
