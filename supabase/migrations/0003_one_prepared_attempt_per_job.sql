-- Closes a race where two call_attempts rows for the same job could both sit in "prepared" state
-- and both independently be approved and dispatched -- e.g. a coordinator preparing a regular
-- draft in one tab while a retry/follow-up/post-visit draft gets created in another, or a
-- double-submitted request. saveCallAttemptDraft() already reuses an existing prepared row
-- (update, not insert); this is the DB-level backstop for the other draft-creation paths
-- (saveRetryCallAttemptDraft, saveFollowUpCallAttemptDraft, savePostVisitCallAttemptDraft), which
-- always insert a new row and rely on UI-level gating alone today.
--
-- Scoped to 'prepared' only, not every non-terminal state: once a row moves to 'queued' or a
-- terminal status, a fresh 'prepared' draft for the same job (retry, follow-up, post-visit) is a
-- normal, expected next step, not a duplicate in progress.
--
-- NOT YET APPLIED to the live project -- table is currently empty (0 rows) so this is safe to
-- apply, but it changes a live constraint and is held for explicit go-ahead per project policy.

create unique index if not exists call_attempts_one_prepared_per_job
  on public.call_attempts (repair_job_id)
  where (lifecycle_status = 'prepared');
