import { describe, expect, it } from "vitest";
import { SAFE_DEFAULT_PHONE, normalizePhoneInput, validateJobInput, emptyJobInput, type RepairJobRecord } from "@/lib/repair-jobs";
import { guessRegionLocaleFromPhone, isCanonicalE164Phone } from "@/lib/call-attempts";
import {
  adaptiveQuestionsForJob,
  applianceSpecificQuestion,
  assessReadiness,
  deriveContradictions,
  deriveDiagnosisHypothesis,
  deriveSafetyFlags,
  firstTimeFixRate,
  hasSafetyHazard,
  isFirstTimeFix,
  isSafetyHazardText,
  isShareLinkActive,
  targetedFollowUpQuestions,
  type BriefFollowUp,
  type EvidenceItem,
  type RepairOutcome,
} from "@/lib/repair-briefs";

/**
 * These tests cover the logic that decides whether a job is safe to hand a technician, and
 * whether a phone number is well-formed before it can ever reach the approval flow. Both are
 * safety-critical: a bug here either lies to a technician about readiness, or lets a malformed
 * number slip past validation.
 */

describe("phone validation", () => {
  it("accepts a canonical +countrycode number", () => {
    expect(isCanonicalE164Phone("+15550199999")).toBe(true);
  });

  it("rejects a number without a leading +", () => {
    expect(isCanonicalE164Phone("15550199999")).toBe(false);
  });

  it("rejects a number that is too short to be real", () => {
    expect(isCanonicalE164Phone("+1234")).toBe(false);
  });

  it("normalizes spaced/punctuated input into canonical form", () => {
    expect(normalizePhoneInput("+1 (555) 019-9999")).toBe("+15550199999");
  });

  it("leaves invalid formatting untouched so validation can explain the problem", () => {
    // Letters are never silently stripped into something that could be dialed.
    expect(normalizePhoneInput("call me maybe")).toBe("call me maybe");
  });

  it("the pre-filled safe default phone is itself a valid canonical number", () => {
    // Regression guard: if this ever stops being canonical, every new job would fail
    // validation the moment it's created.
    expect(isCanonicalE164Phone(SAFE_DEFAULT_PHONE)).toBe(true);
  });

  it("rejects a job with no phone entered", () => {
    const errors = validateJobInput({ ...emptyJobInput(), phone: "" });
    expect(errors.phone).toBeTruthy();
  });
});

describe("guessRegionLocaleFromPhone — approval default, never authoritative", () => {
  it("guesses GB/en-GB for a UK calling code", () => {
    expect(guessRegionLocaleFromPhone("+447911123456")).toEqual({ region: "GB", locale: "en-GB" });
  });

  it("guesses IN/en-IN for an Indian calling code", () => {
    expect(guessRegionLocaleFromPhone("+919876543210")).toEqual({ region: "IN", locale: "en-IN" });
  });

  it("does not let a longer overlapping-looking code shadow a shorter distinct one", () => {
    // +1 (US/NANP) must not be misread as the start of +971 (UAE) or vice versa.
    expect(guessRegionLocaleFromPhone("+15550199999")).toEqual({ region: "US", locale: "en-US" });
    expect(guessRegionLocaleFromPhone("+971501234567")).toEqual({ region: "AE", locale: "ar-AE" });
  });

  it("falls back to US/en-US for an unrecognized or missing calling code", () => {
    expect(guessRegionLocaleFromPhone("")).toEqual({ region: "US", locale: "en-US" });
    expect(guessRegionLocaleFromPhone(null)).toEqual({ region: "US", locale: "en-US" });
  });
});

const EVIDENCE_LABELS: Record<EvidenceItem["key"], string> = {
  appliance_identity: "Appliance brand and model",
  symptoms: "Symptoms in the customer's own words",
  timing: "When the symptom occurs",
  error_code: "Error code or explicit none",
  visit_logistics: "Access, parking, pets, and workspace",
};

function evidence(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  const key = overrides.key ?? "appliance_identity";
  return {
    key,
    label: EVIDENCE_LABELS[key],
    status: "confirmed",
    source: "call_reported",
    value: "LG WM3900",
    supporting_excerpt: null,
    ...overrides,
  };
}

const ALL_CONFIRMED: EvidenceItem[] = [
  evidence({ key: "appliance_identity" }),
  evidence({ key: "symptoms" }),
  evidence({ key: "timing" }),
  evidence({ key: "error_code" }),
  evidence({ key: "visit_logistics" }),
];

describe("assessReadiness — the technician-facing readiness decision", () => {
  it("is blocked whenever an explicit visit blocker exists, regardless of evidence", () => {
    const status = assessReadiness(ALL_CONFIRMED, [{ value: "no access", source: "call_reported", supporting_excerpt: null }], "completed");
    expect(status).toBe("blocked");
  });

  it("needs follow-up when there are open follow-up details, even with complete evidence", () => {
    const followUps: BriefFollowUp[] = [{ key: "noise", value: "unclear noise description", source: "call_reported" }];
    const status = assessReadiness(ALL_CONFIRMED, [], "completed", followUps);
    expect(status).toBe("needs_follow_up");
  });

  it("needs follow-up when any evidence area is missing or uncertain", () => {
    const partial = [...ALL_CONFIRMED.slice(0, 4), evidence({ key: "visit_logistics", status: "missing", value: null, source: null })];
    const status = assessReadiness(partial, [], "completed");
    expect(status).toBe("needs_follow_up");
  });

  it("is unknown while the call hasn't completed, even if evidence looks complete", () => {
    const status = assessReadiness(ALL_CONFIRMED, [], "in_progress");
    expect(status).toBe("unknown");
  });

  it("is unknown if any evidence is still coordinator-sourced and unverified", () => {
    const mixed = [...ALL_CONFIRMED.slice(0, 4), evidence({ key: "visit_logistics", source: "coordinator", status: "unverified" })];
    const status = assessReadiness(mixed, [], "completed");
    expect(status).toBe("unknown");
  });

  it("is only ready for technician review when every area is call-confirmed, complete, and unblocked", () => {
    const status = assessReadiness(ALL_CONFIRMED, [], "completed");
    expect(status).toBe("ready_for_technician_review");
  });

  it("never reports ready when the call outcome was a non-answer, even with stale confirmed evidence", () => {
    // Regression guard for the CALL-E terminal-status fix: no_answer/declined/voicemail/busy/
    // expired must never be treated as an implicit "completed" that could mark a job ready.
    const status = assessReadiness(ALL_CONFIRMED, [], "no_answer");
    expect(status).not.toBe("ready_for_technician_review");
  });
});

describe("isSafetyHazardText / hasSafetyHazard — flagging a reported hazard, not diagnosing one", () => {
  it("flags an explicit gas leak report", () => {
    expect(isSafetyHazardText("customer reported a gas leak near the stove")).toBe(true);
  });

  it("flags exposed wiring, electrical shock, and fire language", () => {
    expect(isSafetyHazardText("exposed wiring behind the dryer")).toBe(true);
    expect(isSafetyHazardText("got an electrical shock touching the panel")).toBe(true);
    expect(isSafetyHazardText("small fire near the outlet")).toBe(true);
  });

  it("does not flag ordinary access/logistics blockers", () => {
    expect(isSafetyHazardText("no elevator access, third floor walk-up")).toBe(false);
    expect(isSafetyHazardText("dog present, keep in the backyard")).toBe(false);
    expect(isSafetyHazardText("parking is street-only, no permit needed")).toBe(false);
  });

  it("is case-insensitive and matches within a longer sentence", () => {
    expect(isSafetyHazardText("Customer says it SMELLS LIKE BURNING when the dryer runs")).toBe(true);
  });

  it("hasSafetyHazard checks blockers and reported symptoms, not other evidence areas", () => {
    const withHazardBlocker = { blockers: [{ value: "gas smell near the unit", source: "call_reported" as const, supporting_excerpt: null }], evidence: ALL_CONFIRMED };
    expect(hasSafetyHazard(withHazardBlocker)).toBe(true);

    const withHazardSymptom = { blockers: [], evidence: [...ALL_CONFIRMED.slice(0, 4), evidence({ key: "symptoms", value: "sparking when plugged in" })] };
    expect(hasSafetyHazard(withHazardSymptom)).toBe(true);

    const withHazardInWrongField = { blockers: [], evidence: [...ALL_CONFIRMED.slice(0, 4), evidence({ key: "appliance_identity", value: "gas leak brand of washer" })] };
    expect(hasSafetyHazard(withHazardInWrongField)).toBe(false);

    expect(hasSafetyHazard({ blockers: [], evidence: ALL_CONFIRMED })).toBe(false);
  });
});

describe("applianceSpecificQuestion / adaptiveQuestionsForJob — per-appliance question coverage", () => {
  it("asks about gas smell specifically for a gas-capable oven/range", () => {
    expect(applianceSpecificQuestion("oven_range")).toMatch(/gas/i);
  });

  it("asks about the vent and burning smell specifically for a dryer", () => {
    expect(applianceSpecificQuestion("dryer")).toMatch(/vent|burning/i);
  });

  it("has no extra question for an unrecognized/other appliance type", () => {
    expect(applianceSpecificQuestion("other")).toBeNull();
  });

  function testJob(overrides: Partial<RepairJobRecord>): RepairJobRecord {
    return {
      id: "job-1",
      customer_name: "Test Customer",
      phone: SAFE_DEFAULT_PHONE,
      appliance_type: "other",
      reported_problem: "",
      ...overrides,
    };
  }

  it("folds the appliance-specific question into the full outline without dropping the trailing safety/review-boundary question", () => {
    const withAppliance = adaptiveQuestionsForJob(testJob({ appliance_type: "oven_range" }));
    const without = adaptiveQuestionsForJob(testJob({ appliance_type: "other" }));
    expect(withAppliance.some((q) => /gas/i.test(q))).toBe(true);
    // Regression guard: adding the appliance-specific question must never push the trailing
    // safety-boundary question off the end.
    expect(withAppliance.length).toBe(without.length + 1);
    expect(withAppliance.at(-1)).toMatch(/final checklist and review-only boundary/i);
    expect(without.at(-1)).toMatch(/final checklist and review-only boundary/i);
  });

  it("front-loads a safety-relevant appliance question ahead of the generic symptom questions", () => {
    // If the call disconnects partway through, whatever ran first is what survives -- a gas-smell
    // probe for a gas oven must not be the question that gets cut off.
    const questions = adaptiveQuestionsForJob(testJob({ appliance_type: "oven_range" }));
    const gasIndex = questions.findIndex((q) => /gas/i.test(q));
    const symptomIndex = questions.findIndex((q) => /symptoms in the customer's own words/i.test(q));
    expect(gasIndex).toBeGreaterThan(-1);
    expect(gasIndex).toBeLessThan(symptomIndex);
  });

  it("stops re-asking the granular access breakdown once the coordinator already wrote a detailed access note", () => {
    const detailed = testJob({
      access_notes: "Third-floor condo, working elevator, street parking with 2hr limit, friendly dog kept in the bedroom, access Mon-Fri 9-5.",
    });
    const questions = adaptiveQuestionsForJob(detailed);
    const joined = questions.join(" ").toLowerCase();
    // The granular breakdown questions are gone...
    expect(joined).not.toContain("ask about nearby parking or a loading zone");
    expect(joined).not.toContain("ask whether pets are present");
    // ...replaced by a single read-back/verification question.
    expect(questions.some((q) => /read back the saved access notes in full/i.test(q))).toBe(true);
    expect(questions.at(-1)).toMatch(/final checklist and review-only boundary/i);
  });

  it("still asks the full granular access breakdown when the access note is short or absent", () => {
    const sparse = testJob({ access_notes: "3rd floor" });
    const questions = adaptiveQuestionsForJob(sparse);
    const joined = questions.join(" ").toLowerCase();
    expect(joined).toContain("ask about nearby parking or a loading zone");
    expect(questions.some((q) => /read back the saved access notes in full/i.test(q))).toBe(false);
  });
});

describe("isShareLinkActive — gate on the public technician-facing link", () => {
  it("is inactive when there is no token", () => {
    expect(isShareLinkActive({ share_token: null, share_expires_at: null })).toBe(false);
  });

  it("is inactive once the expiry timestamp is in the past", () => {
    expect(
      isShareLinkActive({ share_token: "abc", share_expires_at: new Date(Date.now() - 1000).toISOString() })
    ).toBe(false);
  });

  it("is active with a token and a future expiry", () => {
    expect(
      isShareLinkActive({ share_token: "abc", share_expires_at: new Date(Date.now() + 1000 * 60).toISOString() })
    ).toBe(true);
  });
});

describe("deriveSafetyFlags — structuring hazard language into distinct escalation categories", () => {
  it("categorizes a gas leak report separately from an electrical hazard report", () => {
    const brief = { blockers: [{ value: "customer reports a gas leak near the dryer", source: "call_reported" as const, supporting_excerpt: null }], evidence: ALL_CONFIRMED };
    const flags = deriveSafetyFlags(brief);
    expect(flags).toHaveLength(1);
    expect(flags[0].category).toBe("gas_or_carbon_monoxide");
  });

  it("captures multiple distinct hazard categories from separate sources", () => {
    const brief = {
      blockers: [{ value: "sparking outlet near the washer", source: "call_reported" as const, supporting_excerpt: null }],
      evidence: [...ALL_CONFIRMED.slice(0, 4), evidence({ key: "symptoms", value: "standing water and flooding under the unit" })],
    };
    const flags = deriveSafetyFlags(brief);
    const categories = flags.map((f) => f.category).sort();
    expect(categories).toEqual(["fire_or_electrical", "flooding_or_water"]);
  });

  it("returns no flags for an ordinary access blocker or symptom", () => {
    const brief = { blockers: [{ value: "no elevator access", source: "call_reported" as const, supporting_excerpt: null }], evidence: ALL_CONFIRMED };
    expect(deriveSafetyFlags(brief)).toHaveLength(0);
  });
});

const testJobForDiagnosis = (overrides: Partial<RepairJobRecord> = {}): RepairJobRecord => ({
  id: "job-1",
  customer_name: "Test Customer",
  phone: SAFE_DEFAULT_PHONE,
  appliance_type: "dryer",
  reported_problem: "",
  ...overrides,
});

describe("deriveContradictions — coordinator entry vs. call-confirmed answer", () => {
  it("flags a materially different call-confirmed answer against the coordinator's entry", () => {
    const job = testJobForDiagnosis({ reported_problem: "Making a squeaking noise" });
    const contradictions = deriveContradictions(job, [evidence({ key: "symptoms", value: "Not heating at all, drum spins fine" })]);
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0].key).toBe("symptoms");
    expect(contradictions[0].coordinator_value).toContain("squeaking");
    expect(contradictions[0].call_value).toContain("heating");
  });

  it("does not flag a paraphrase or added detail as a contradiction", () => {
    const job = testJobForDiagnosis({ brand: "LG", model: "WM3900" });
    const contradictions = deriveContradictions(job, [evidence({ key: "appliance_identity", value: "LG WM3900" })]);
    expect(contradictions).toHaveLength(0);
  });

  it("does not flag anything when the call evidence is only uncertain, not confirmed", () => {
    const job = testJobForDiagnosis({ error_code: "E1" });
    const contradictions = deriveContradictions(job, [evidence({ key: "error_code", value: "E9", status: "uncertain" })]);
    expect(contradictions).toHaveLength(0);
  });

  it("does not flag anything when the coordinator never entered a value for that field", () => {
    const job = testJobForDiagnosis({});
    const contradictions = deriveContradictions(job, [evidence({ key: "timing", value: "Only during the spin cycle" })]);
    expect(contradictions).toHaveLength(0);
  });
});

describe("deriveDiagnosisHypothesis — bounded, evidence-gated diagnostic reasoning", () => {
  it("proposes a hypothesis when a symptom is confirmed by the call and matches a known pattern", () => {
    const job = testJobForDiagnosis({ appliance_type: "dryer" });
    const brief = {
      blockers: [],
      evidence: [
        evidence({ key: "symptoms", value: "The dryer runs but produces no heat at all" }),
        evidence({ key: "timing", value: "Every cycle" }),
      ],
    };
    const hypothesis = deriveDiagnosisHypothesis(job, brief);
    expect(hypothesis).not.toBeNull();
    expect(hypothesis?.likely_subsystem).toBe("Heating circuit");
    expect(hypothesis?.candidate_parts.length).toBeGreaterThan(0);
    expect(hypothesis?.evidence_refs).toContain("symptoms");
  });

  it("never proposes a hypothesis when a safety hazard is present -- safety hold takes precedence", () => {
    const job = testJobForDiagnosis({ appliance_type: "dryer" });
    const brief = {
      blockers: [{ value: "burning smell when it runs", source: "call_reported" as const, supporting_excerpt: null }],
      evidence: [evidence({ key: "symptoms", value: "The dryer runs but produces no heat at all" })],
    };
    expect(deriveDiagnosisHypothesis(job, brief)).toBeNull();
  });

  it("abstains (returns null) rather than guessing when the symptom isn't call-confirmed", () => {
    const job = testJobForDiagnosis({ appliance_type: "dryer" });
    const brief = { blockers: [], evidence: [evidence({ key: "symptoms", value: "no heat", source: "coordinator", status: "unverified" })] };
    expect(deriveDiagnosisHypothesis(job, brief)).toBeNull();
  });

  it("abstains when the confirmed symptom doesn't match any known pattern for the appliance", () => {
    const job = testJobForDiagnosis({ appliance_type: "dryer" });
    const brief = { blockers: [], evidence: [evidence({ key: "symptoms", value: "it makes a strange smell I can't describe" })] };
    expect(deriveDiagnosisHypothesis(job, brief)).toBeNull();
  });

  it("raises confidence to high when the error code is also call-confirmed, and lowers it when timing is missing", () => {
    const job = testJobForDiagnosis({ appliance_type: "washing_machine" });
    const withErrorCode = deriveDiagnosisHypothesis(job, {
      blockers: [],
      evidence: [
        evidence({ key: "symptoms", value: "Washer won't drain, water stays in the drum" }),
        evidence({ key: "error_code", value: "E3" }),
        evidence({ key: "timing", value: "Every wash" }),
      ],
    });
    expect(withErrorCode?.confidence).toBe("high");

    const withoutTiming = deriveDiagnosisHypothesis(job, {
      blockers: [],
      evidence: [
        evidence({ key: "symptoms", value: "Washer won't drain, water stays in the drum" }),
        evidence({ key: "timing", status: "missing", value: null, source: null }),
      ],
    });
    expect(withoutTiming?.confidence).toBe("low");
  });
});

function outcome(overrides: Partial<RepairOutcome> = {}): RepairOutcome {
  return { actual_diagnosis: "Failed thermal fuse", part_used: "Thermal fuse", repair_completed: true, second_visit_required: false, recorded_at: new Date().toISOString(), ...overrides };
}

describe("isFirstTimeFix / firstTimeFixRate — the outcome metric", () => {
  it("is null when there is no recorded outcome, never a false negative", () => {
    expect(isFirstTimeFix(null)).toBeNull();
  });

  it("is true only when the repair was completed and no second visit is required", () => {
    expect(isFirstTimeFix(outcome())).toBe(true);
    expect(isFirstTimeFix(outcome({ second_visit_required: true }))).toBe(false);
    expect(isFirstTimeFix(outcome({ repair_completed: false }))).toBe(false);
  });

  it("firstTimeFixRate returns null (not 0) when nothing has been recorded yet", () => {
    expect(firstTimeFixRate([{ outcome: null }, { outcome: null }])).toBeNull();
  });

  it("only counts briefs with a recorded outcome toward the rate", () => {
    const result = firstTimeFixRate([
      { outcome: outcome() },
      { outcome: outcome({ second_visit_required: true }) },
      { outcome: null },
    ]);
    expect(result).toEqual({ recorded: 2, firstTimeFixes: 1, rate: 0.5 });
  });
});

describe("targetedFollowUpQuestions — the smart follow-up call's question set", () => {
  it("always re-confirms identity and consent, even with nothing else unresolved", () => {
    const questions = targetedFollowUpQuestions({ follow_ups: [], evidence: ALL_CONFIRMED });
    expect(questions[0]).toMatch(/confirm you are speaking with the intended customer/i);
  });

  it("asks specifically about each open follow-up detail from the prior call", () => {
    const followUps: BriefFollowUp[] = [{ key: "noise", value: "unclear grinding noise", source: "call_reported" }];
    const questions = targetedFollowUpQuestions({ follow_ups: followUps, evidence: ALL_CONFIRMED });
    expect(questions.some((q) => q.includes("unclear grinding noise"))).toBe(true);
  });

  it("asks about evidence areas still missing or uncertain, not ones already confirmed", () => {
    const partial = [...ALL_CONFIRMED.slice(0, 4), evidence({ key: "visit_logistics", status: "missing", value: null, source: null })];
    const questions = targetedFollowUpQuestions({ follow_ups: [], evidence: partial });
    const joined = questions.join(" ").toLowerCase();
    expect(joined).toContain("access, parking, pets, and workspace".toLowerCase());
    expect(joined).not.toContain("appliance brand and model");
  });

  it("never grows unbounded no matter how many unresolved items exist", () => {
    const manyFollowUps: BriefFollowUp[] = Array.from({ length: 20 }, (_, i) => ({
      key: `item-${i}`,
      value: `unresolved detail ${i}`,
      source: "call_reported",
    }));
    const questions = targetedFollowUpQuestions({ follow_ups: manyFollowUps, evidence: ALL_CONFIRMED });
    expect(questions.length).toBeLessThanOrEqual(10);
  });
});
