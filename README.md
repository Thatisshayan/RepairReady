# RepairReady

RepairReady is a private pre-visit preparation desk for appliance repair coordinators. Before a
technician drives to a job, RepairReady places a real, automated [CALL-E](https://heycall-e.com)
phone call to the customer to confirm the appliance brand and model, symptoms, an error code (or
an explicit "none"), and access logistics — then turns the structured result into a technician
brief with a clear boundary between what the coordinator entered and what the call actually
confirmed.

## Why a phone call

Appliance repair visits routinely fail or get rescheduled because a coordinator is working from
an incomplete intake form: the wrong model number, an undescribed access requirement, an error
code nobody wrote down. A short, structured phone call closes those gaps before the technician
is on the road — and a call surfaces details a form doesn't, because a customer will *say*
"the noise happens right when the spin cycle starts" in a way they'd never type into a box.

## How it decides a job is ready

Every piece of evidence on a brief carries two things: a **source** (entered by the coordinator,
or confirmed by the call) and a **status** (confirmed, missing, uncertain, unverified).
Coordinator entries are always labeled unverified until the call independently confirms them.
A job is only marked ready for technician review when every required evidence area — appliance
identity, symptoms, timing, error code, and access — is confirmed by the call itself, with no
unresolved follow-up detail and no explicit visit blocker. Coordinator review of a brief is
tracked separately and never changes the underlying evidence or the readiness decision.

## Safety design: real calls always require a re-confirmed approval

RepairReady never dials a number just because it's saved on a job. Placing a real call requires:

1. Saving a private preparation draft (purpose, recipient, and a locally-built question outline)
   — this never contacts anyone.
2. **Approving** that exact draft by re-typing the recipient's phone number, plus a region and
   locale. The approval is valid for 15 minutes and does not place the call by itself.
3. Explicitly dispatching the approved call.

The approval step exists specifically so a phone number typed into a job by mistake can never
turn into a real call without a deliberate, separate confirmation. That check is enforced at the
database level (not just in application code) — an approval can only be written by a small set
of server actions, never by a direct client update or insert.

## Stack

- **Frontend:** React, TypeScript, Vite, Tailwind, shadcn/ui
- **Backend:** Supabase (Postgres with row-level security, Auth, Edge Functions)
- **Voice:** [CALL-E](https://heycall-e.com)
- **Hosting:** Vercel

## Local development

```bash
npm install
cp .env.example .env.local   # fill in your own Supabase project's URL and publishable key
npm run dev
```

The Supabase project needs the schema in `supabase/functions/` deployed as Edge Functions, and a
`CALLE_API_KEY` secret configured on the Supabase project for the CALL-E integration to work.

## Project structure

```
src/
  entities/       Supabase-backed data access (repair jobs, call attempts, briefs)
  functions/      Typed client for the Supabase Edge Functions below
  lib/            Business logic: validation, readiness decisions, evidence merging
  components/     UI
  pages/          App shell and routing
supabase/
  functions/      Edge Functions: connection check, approve, dispatch, and status-refresh
```
