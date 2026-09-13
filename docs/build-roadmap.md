# RepairReady — Build Roadmap (CALL-E hackathon, pre-submission dev push)

Condensed from `ShayanSep13Output.md` Section 33 (19-phase handoff spec) into 10 execution
phases. This file is the drift-check: update status inline as phases complete. Submission
logistics (PR, demo video, Devpost form) are deliberately last and gated on the user's explicit
go-ahead — do not open the PR or record the final video until told to.

Deadline: 2026-09-14, 11:45pm SGT — hard cutoff, no grace period.

## Status legend
`[ ]` not started · `[~]` in progress · `[x]` done

---

## Phase 1 — Reconnaissance + DB reproducibility
- [x] Inspect actual repo structure, stack, existing tests/CI/security posture
- [x] Introspect live Supabase schema (tables, RLS policies, indexes, FKs)
- [x] Write `supabase/migrations/0001_init_snapshot.sql` (schema reproducibility snapshot)
- [x] Write `supabase/migrations/0002_diagnosis_evidence.sql` (additive `diagnosis_json` column)
- [ ] User go-ahead to actually apply migrations 0001/0002 live (currently drafted, not applied)

## Phase 2 — Adaptive diagnostic interview engine [x]
- [x] Replace static `adaptiveQuestionsForJob` ordering with real branching: safety-relevant and
      appliance-specific questions front-loaded; granular access questions collapse to one
      verification question when the coordinator already wrote a detailed access note
- [x] Explicit stopping criteria: `hasDetailedAccessNotes` skip logic — don't re-ask what's
      already been answered in enough detail
- [x] Preserved existing safety/consent/no-diagnosis boundary language in every question
- Tests: 4 new (front-loading order, consolidation, non-consolidation fallback)

## Phase 3 — Diagnostic evidence model + evidence traceability [x]
- [x] `contradictions[]`, `safety_flags[]`, `candidate_parts[]`, `likely_subsystem`,
      `diagnostic_confidence` — implemented as **pure derivations** from already-stored evidence/
      job fields (`deriveContradictions`, `deriveSafetyFlags`, `deriveDiagnosisHypothesis` in
      `src/lib/repair-briefs.ts`), not persisted separately — no schema change needed
- [x] Every hypothesis carries `evidence_refs` back to the confirming answer(s)
- [x] Uncertainty handled by returning `null` (abstain) rather than forcing a guess when evidence
      is insufficient or a safety flag is present (SAFETY_HOLD takes precedence over reasoning)
- Tests: 12 new (safety flag categorization, contradiction detection, hypothesis gating/confidence)

## Phase 4 — Bounded diagnostic reasoning + safety gates [x]
- [x] Hypotheses always framed as "likely, verify before acting" (UI copy + `DiagnosisHypothesis`
      shape has no "confirmed"/fact state, only `confidence: low|medium|high`)
- [x] `deriveDiagnosisHypothesis` refuses to run at all when `deriveSafetyFlags` finds anything —
      the safety hold, enforced at the point where "normal diagnosis" would otherwise happen

## Phase 5 — Technician Readiness Brief UI [x]
- [x] Added Diagnostic hypothesis (LIKELY/BRING/START HERE), Contradictions (DON'T ASSUME), and a
      structured Safety flags banner to the existing `TechnicianBrief.tsx` — extended the proven
      component rather than rewriting it
- [x] Kept existing visual system (Radix/Tailwind), same section-card pattern as the rest of the brief

## Phase 6 — Parts readiness + human approval [x]
- [x] `candidate_parts[]` derived only from confirmed evidence, explicitly labeled non-authoritative
- [x] No action needed here beyond display — the app has no autonomous ordering/staging action to
      gate, so "human approval before ordering" is satisfied by candidate_parts being read-only

## Phase 7 — Technician outcome loop + first-time-fix metric [x]
- [x] `RepairOutcome` type + `saveRepairOutcome` (actual diagnosis, part used, repair completed,
      second visit required), UI form in `TechnicianBrief.tsx` (shown once a call completes)
- [x] `isFirstTimeFix` / `firstTimeFixRate` — real measured data only, returns `null` (not 0/fake %)
      when nothing has been recorded yet
- [x] Migration `supabase/migrations/0002_repair_outcome.sql` (additive `outcome_json` column) —
      **drafted, not applied live yet** — this feature will error against the live DB until the
      migration is applied; needs explicit go-ahead per Phase 1
- Tests: 4 new (metric null-safety, rate calculation)

## Phase 8 — CALL-E integration hardening [mostly done]
- [x] DB-level guard: `supabase/migrations/0003_one_prepared_attempt_per_job.sql` — partial unique
      index, one `prepared` (not-yet-approved) `call_attempts` row per job — **drafted, not
      applied live yet**, needs explicit go-ahead
- [x] App-level backstop: `hasExistingPreparedAttempt` guard added to the three always-insert
      draft paths (retry/follow-up/post-visit) in `call-attempts.ts`, so the common case fails
      with a clear message instead of a raw DB constraint error; the migration remains the
      authoritative race-proof backstop
- [x] Confirmed one full real CALL-E call end-to-end (2026-09-13, user go-ahead given) via the
      built-in "Run authorized demo call" path, dialing the pre-authorized test number. **Real
      result:** CALL-E genuinely called and the user personally answered; audio started cutting
      off word-by-word after the elevator question and the call auto-hung-up (a CALL-E-platform
      audio issue, not a RepairReady bug). The webhook correctly flagged the call `completed`
      (`provider_call_id: call_WJByjTySqeE77-_O0LmI4A`), and manually invoking
      `get-calle-call-status` pulled a real structured result: all 5 evidence areas confirmed
      (LG WMT400CW, "It's making noise... sometimes leaking water underneath", condo/penthouse
      access), 8 honest follow-up items for what the degraded call left unresolved instead of
      guessing, consent confirmed, completion confidence "high". Verified the new diagnosis engine
      against this real data: correctly proposed "Door seal or hose connections" (high confidence,
      2 candidate parts) from the real "leaking" symptom text, with zero false contradictions/
      safety-flags. **Real bug found and reproduced (not yet fixed):** on a fresh page load, the
      Technician Brief panel intermittently renders the stale/empty `buildBriefPreview` fallback
      instead of the saved evidence, even though the readiness queue (a separate data path)
      correctly shows "5 of 5 confirmed." Root-caused to `src/pages/Index.tsx`'s `callDraft`/
      `brief`-loading `useEffect` pair (~lines 284-348): both depend on `selected`, which is
      re-memoized on every `jobs` state change, and the two effects' async resolutions can settle
      out of order, letting a stale `loadRepairBrief(selected, null)` call win over the correct
      one. Confirmed via targeted console logging (added, used, then reverted — see commit
      `059762c`) that this is a real race, not a test-harness artifact. **Not fixed yet** — flagged
      here rather than either ignored or blind-patched under time pressure; a proper fix needs a
      request-generation-counter or AbortController pattern instead of the current boolean `active`
      flag, since React's cleanup-based guard isn't sufficient when two *different* effects (not
      just two runs of the same effect) can both resolve into the same `brief` state.
      Test job/data cleaned up afterward (repair_jobs cascade-deleted call_attempts/repair_briefs
      back to 0 rows; both disposable test auth accounts deleted).

## Phase 9 — CI + testing [mostly done]
- [x] `.github/workflows/ci.yml`: install, lint, test, build on push/PR to master — confirmed
      actually green on GitHub Actions (not just "should work locally"), after fixing two real CI-
      only failures: an npm-version lockfile mismatch (npm 10 on the runner vs npm 11 that
      generated the lockfile) and missing public `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`
      env vars that `src/lib/supabase/client.ts` requires at import time
- [x] Fixed pre-existing broken lint tooling (`typescript-eslint` 8.11.0 → 8.70.0, a devDependency-
      only bump) that was crashing before this work — lint went from "crashes on every run" to
      0 errors, 7 pre-existing/cosmetic warnings
- [x] Fixed the 8 real pre-existing lint errors it uncovered (control-char regex false positives
      in 5 files, 2 shadcn empty-interface patterns, 1 `require()` in tailwind.config.ts) so CI
      starts green, not red, on its first run
- [x] Adversarial tests added: contradictory coordinator-vs-call answers, safety-hazard phrasing
      across categories, symptom not call-confirmed (abstention), unmatched symptom (abstention)
- [ ] **Known gap, not done:** edge-function-level adversarial tests (expired approval, duplicate
      dispatch, malformed CALL-E result, prompt-injection-style customer text at the Deno function
      layer) — the 7 Supabase Edge Functions have zero test coverage of any kind today (confirmed
      in both the 2026-09-12 audit and this session's recon) and there's no Deno test harness
      wired up. This is a real, non-trivial addition, not a quick fix — flagging honestly rather
      than skipping silently or claiming it's covered.
- [ ] Pre-existing TypeScript errors found in `call-attempts.ts`, `repair-jobs.ts`,
      `functions/index.ts` (unrelated to this session's changes, predate it) — no `typecheck`
      script exists and none is wired into CI yet, so these are currently invisible. Left
      unfixed and out of CI deliberately to avoid scope creep this close to the deadline; flagging
      so it isn't mistaken for "everything type-checks."

## Phase 10 — Demo mode, CALL-E contribution, submission (GATED — do not start without explicit go-ahead)
- [ ] Deterministic no-call demo path, clearly labeled SIMULATION vs LIVE
- [ ] Package reusable CALL-E contribution (trust-and-safety pattern doc or skill)
- [ ] Record ≤3 min demo video
- [ ] Open PR to `CALLE-AI/awesome-phone-call-agents`
- [ ] Submit Devpost form (email, PR URL, video, optional live URL) — **only when user says go**
