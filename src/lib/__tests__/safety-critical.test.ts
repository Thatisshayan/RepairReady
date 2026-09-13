import { describe, expect, it } from "vitest";
import { SAFE_DEFAULT_PHONE, normalizePhoneInput, validateJobInput, emptyJobInput, type RepairJobRecord } from "@/lib/repair-jobs";
import { guessRegionLocaleFromPhone, isCanonicalE164Phone } from "@/lib/call-attempts";
import {
  adaptiveQuestionsForJob,
  applianceSpecificQuestion,
  assessReadiness,
  hasSafetyHazard,
  isSafetyHazardText,
  isShareLinkActive,
  targetedFollowUpQuestions,
  type BriefFollowUp,
  type EvidenceItem,
} from "@/lib/repair-briefs";

/**
 * These tests cover the logic that decides whether a job is safe to hand a technician, and
 * whether a phone number is well-formed before it can ever reach the approval flow. Both are
 * safety-critical: a bug here either lies to a technician about readiness, or lets a malformed
 * number slip past validation.
 */

describe("phone validation", () => {
  it("accepts a canonical +countrycode number", () => {
    expect(isCanonicalE164Phone("+13058347598")).toBe(true);
  });

  it("rejects a number without a leading +", () => {
    expect(isCanonicalE164Phone("13058347598")).toBe(false);
  });

  it("rejects a number that is too short to be real", () => {
    expect(isCanonicalE164Phone("+1234")).toBe(false);
  });

  it("normalizes spaced/punctuated input into canonical form", () => {
    expect(normalizePhoneInput("+1 (305) 834-7598")).toBe("+13058347598");
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
    expect(guessRegionLocaleFromPhone("+13058347598")).toEqual({ region: "US", locale: "en-US" });
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
    // Regression guard: the cap must always be at least (base question count + 1), or the
    // appliance-specific question silently pushes the final safety-boundary question off the end.
    expect(withAppliance.length).toBe(without.length + 1);
    expect(withAppliance.at(-1)).toMatch(/final checklist and review-only boundary/i);
    expect(without.at(-1)).toMatch(/final checklist and review-only boundary/i);
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
