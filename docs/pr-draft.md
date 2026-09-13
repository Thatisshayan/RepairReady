# Draft PR description — awesome-phone-call-agents

**Status: draft only.** This is prepared text for the PR to
`CALLE-AI/awesome-phone-call-agents`. Opening that PR is a separate, explicit,
public action on a third-party repository and has not been done — this file exists so the text
is ready the moment a human decides to submit.

---

## Title

RepairReady — pre-visit appliance-repair prep calls with a hard trust-and-safety boundary

## Summary

A truck roll that fails halfway through — wrong model number, an access requirement nobody
mentioned, an error code nobody wrote down — costs a repair business a technician's whole visit.
RepairReady places a real, structured CALL-E phone call to the customer before the technician
leaves, and turns the result into a technician brief that draws a hard line between what a
coordinator typed into a form (unverified) and what the call itself confirmed. A job is only
marked ready when every required fact — appliance identity, symptoms, timing, error code, access
— is independently confirmed by the call.

Beyond the initial call, the tool follows the whole job lifecycle: automatic detection of
no-answer/voicemail/busy outcomes with a one-click retry, targeted follow-up calls that ask only
about what a prior call left unresolved, a post-visit check-in call to confirm the repair actually
fixed the problem, and automatic flagging of reported safety hazards (gas smell, exposed wiring,
burning smell) that get pinned above everything else in the coordinator's queue.

## How this maps to the judging criteria

- **Real World Impact** — a specific, common failure mode (the incomplete-intake truck roll) with
  a mechanism that directly prevents it: no job reaches "ready for technician review" without an
  independently call-confirmed fact set. The readiness queue surfaces a concrete number ("N jobs
  had an issue caught by a call before a technician would have been dispatched") rather than a
  claim.
- **Quality of the Idea** — the trust-and-safety design itself (retype-to-approve, time-boxed,
  server-reserved fields, atomic conditional approval writes, an untrusted-by-default webhook) is
  the differentiator, not just "an app that calls people." It's written up as a standalone,
  reusable pattern in [`docs/trust-and-safety-pattern.md`](../docs/trust-and-safety-pattern.md),
  independent of this specific app.
- **Technical Implementation** — genuine, non-trivial use of CALL-E: `result_schema` /
  `recipient_result_schema` for structured extraction instead of transcript parsing, `webhook_url`
  for event-driven status updates alongside the documented polling pattern, idempotency keys on
  every provider request, and per-call region/locale rather than a hardcoded default. 34
  automated tests cover the safety-critical logic specifically (phone validation, the readiness
  decision matrix, the safety-hazard detector, share-link gating, question generation).
- **Product Experience & Demo** — a complete, coherent coordinator workflow: create a job, prepare
  a call, approve it (retyping the number), watch status update live via webhook or polling,
  review the resulting brief, share a time-boxed read-only link with a technician, and follow up
  or retry as needed — all from one screen.

## What's in this contribution

- The RepairReady application (React/TypeScript frontend, Supabase Postgres + Edge Functions
  backend).
- A standalone write-up of the retype-to-approve trust-and-safety pattern
  (`docs/trust-and-safety-pattern.md`), intended to be usable by any agent that places a real,
  consequential phone call — not specific to appliance repair or to this codebase.

## Live app

https://repairready.vercel.app

---

*Fill in before opening: confirm the live app reflects the latest deploy, attach the demo video
link, and confirm the CALL-E account email being submitted matches the one used for testing.*
