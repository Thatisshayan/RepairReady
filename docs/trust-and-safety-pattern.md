# Retype-to-approve: a reusable trust & safety pattern for agents that place real phone calls

This document describes a small, generalizable pattern used throughout RepairReady's call
pipeline, extracted here so it can be proposed as a standalone contribution to
`awesome-phone-call-agents` — independent of the rest of the app. It is not itself a CALL-E
integration; it's a design pattern for the approval boundary that should sit in front of any
agent that places a real, consequential phone call on a human's behalf.

## The problem

An agent wired up to place real phone calls is one bug, one bad prompt, or one race condition
away from calling the wrong number, calling twice, or calling before a human actually meant to
approve it. "The agent decided to call" and "a human approved this specific call" need to be two
different, auditable facts — not the same code path.

## The pattern

1. **Separate "prepared" from "approved" from "dispatched."** A call attempt is a row/record with
   an explicit lifecycle: `prepared → approved → submitting → <terminal provider status>`. Nothing
   before `approved` can ever reach the provider. Nothing after `submitting` can be re-approved.

2. **Approval requires re-entering the exact target, not just clicking "yes."** The approval step
   asks the human to retype the phone number (or equivalent irreversible target) that's already
   saved on the record, and rejects the approval if it doesn't match exactly. This catches the
   single most common and most damaging failure mode — approving the right *action* against the
   wrong *target* — in a way a checkbox or a confirmation modal does not.

3. **Approval is time-boxed.** A short expiry window (RepairReady uses 15 minutes) means a stale
   approval can't be dispatched hours or days later against a target that may have since changed.

4. **Server-reserved fields, never client-writable.** Fields like `approved_at`,
   `approval_expires_at`, `provider_call_id`, and `provider_status` are only ever written by
   server-side approval/dispatch/status-check logic — never accepted from a client request body.
   A local "save my draft" action must explicitly refuse to touch a record that already has any of
   these fields populated, rather than silently overwriting real provider state.

5. **The approval write is atomic and conditional, not check-then-write.** The approval update
   itself re-asserts every precondition (owner, expected prior state) directly in the write's
   `WHERE` clause and requires an affected-row count back, rather than trusting a separate `SELECT`
   made moments earlier. Two concurrent approval attempts should produce one success and one clean
   rejection, never a silent double-approval.

6. **Dispatch re-verifies everything approval already checked.** Approval state, expiry, and that
   the approved target still exactly matches the saved target are all re-checked immediately
   before the provider call is placed — approval and dispatch are two independent gates, not one
   gate with two names.

## Minimal reference shape

```text
call_attempt:
  id
  recipient_target          # e.g. phone number, saved once
  lifecycle_status          # "prepared" | "approved" | "submitting" | <provider terminal states>
  approval_state            # "not_approved" | "approved"
  approved_target           # only set by the approval step; must equal recipient_target
  approved_at               # server-set timestamp
  approval_expires_at       # server-set timestamp, short window
  provider_call_id          # server-set only after a real dispatch
  provider_status           # server-set only from an authenticated provider status check
```

```text
approve(attempt_id, retyped_target):
  if retyped_target != saved(attempt_id).recipient_target: reject
  if saved(attempt_id).lifecycle_status != "prepared": reject
  if any server-reserved field already set: reject
  atomically UPDATE ... WHERE id = attempt_id AND lifecycle_status = 'prepared'
    SET approval_state = 'approved', approved_target = retyped_target,
        approved_at = now(), approval_expires_at = now() + 15m
  require 1 affected row, else reject as "changed underneath you, retry"

dispatch(attempt_id):
  reject unless approval_state == 'approved'
  reject unless approval_expires_at > now()
  reject unless approved_target == recipient_target   # re-check, don't trust the earlier approval alone
  reject if any provider-reserved field already set    # never double-dispatch
  place the real call; then and only then set provider_call_id
```

## Where this is implemented in RepairReady

- `supabase/functions/approve-calle-call/index.ts` — the retype-and-approve gate, including the
  atomic conditional update described in step 5.
- `supabase/functions/dispatch-calle-call/index.ts` — the independent re-check before a real call
  is placed.
- `src/lib/call-attempts.ts` (`hasReservedState`) — the client-side guard that refuses to let a
  local draft save silently clobber server-reserved fields.

## Scope note

This pattern is intentionally agent/framework-agnostic — it doesn't depend on CALL-E's SDK, API
shape, or any RepairReady-specific business logic. It is meant to be proposed as a standalone
"reusable contribution" (design pattern + reference implementation notes), separate from
RepairReady's own application-specific PR, since the submission guidelines explicitly allow a
reusable contribution as its own entry rather than requiring a full end-user app.

**Not yet submitted.** This file is a local draft. Opening an actual pull request against
`CALLE-AI/awesome-phone-call-agents` is a separate, explicit step — a public action on a
third-party repository — and should only happen once a human reviews this write-up and says so.
