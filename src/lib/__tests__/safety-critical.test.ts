import { describe, expect, it } from "vitest";
import { SAFE_DEFAULT_PHONE, normalizePhoneInput, validateJobInput, emptyJobInput } from "@/lib/repair-jobs";
import { isCanonicalE164Phone } from "@/lib/call-attempts";
import { assessReadiness, type BriefFollowUp, type EvidenceItem } from "@/lib/repair-briefs";

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

function evidence(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    key: "appliance_identity",
    label: "Appliance brand and model",
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
