import { describe, it, expect } from "vitest";
import {
  callPurposeForJob,
  parseQuestionOutline,
  buildCallRequestSnapshot,
  normalizePersistedCallAttemptForQueue,
  isRetryableCallStatus,
} from "@/lib/call-attempts";
import type { RepairJobRecord } from "@/lib/repair-jobs";

function makeJob(overrides: Partial<RepairJobRecord> = {}): RepairJobRecord {
  return {
    id: "job-test-1",
    customer_name: "Jane Doe",
    phone: "+15550199999",
    appliance_type: "washing_machine",
    reported_problem: "Won't drain",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// callPurposeForJob
// ---------------------------------------------------------------------------

describe("callPurposeForJob", () => {
  it("produces a purpose string that references the appliance label in lowercase", () => {
    const purpose = callPurposeForJob(makeJob({ appliance_type: "washing_machine" }));
    expect(purpose).toContain("washing machine");
  });

  it("lowercases the label even when the canonical label is mixed-case", () => {
    const purpose = callPurposeForJob(makeJob({ appliance_type: "oven_range" }));
    expect(purpose).toContain("oven / range");
    expect(purpose).not.toContain("Oven");
  });

  it("includes the standard safety and scope-limiting language", () => {
    const purpose = callPurposeForJob(makeJob({ appliance_type: "dryer" }));
    expect(purpose).toMatch(/confirm identity/i);
    expect(purpose).toMatch(/do not diagnose/i);
    expect(purpose).toMatch(/do not.*promise a repair/i);
  });

  it("uses the raw type string for unknown appliance types (falls through to applianceLabel)", () => {
    const purpose = callPurposeForJob(makeJob({ appliance_type: "custom_device" }));
    expect(purpose).toContain("custom_device");
  });

  it("always starts with 'Pre-visit preparation check'", () => {
    const purpose = callPurposeForJob(makeJob({ appliance_type: "dishwasher" }));
    expect(purpose).toMatch(/^Pre-visit preparation check/);
  });
});

// ---------------------------------------------------------------------------
// parseQuestionOutline
// ---------------------------------------------------------------------------

describe("parseQuestionOutline", () => {
  it("splits a newline-delimited string into trimmed lines", () => {
    const result = parseQuestionOutline("Question 1\nQuestion 2\nQuestion 3");
    expect(result).toEqual(["Question 1", "Question 2", "Question 3"]);
  });

  it("trims whitespace from each line and drops blank lines", () => {
    const result = parseQuestionOutline("  Q1  \n\n  \n  Q2  \n");
    expect(result).toEqual(["Q1", "Q2"]);
  });

  it("returns a single-element array for a string with no newlines", () => {
    const result = parseQuestionOutline("Just one question");
    expect(result).toEqual(["Just one question"]);
  });

  it("returns the default fallback when given null", () => {
    const result = parseQuestionOutline(null);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/confirm the appliance details/i);
  });

  it("returns the default fallback when given undefined", () => {
    const result = parseQuestionOutline(undefined);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/confirm the appliance details/i);
  });

  it("returns the default fallback when given an empty string", () => {
    const result = parseQuestionOutline("");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/confirm the appliance details/i);
  });

  it("returns the default fallback for a whitespace-only string", () => {
    const result = parseQuestionOutline("   \n  \n  ");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/confirm the appliance details/i);
  });

  it("delegates to adaptiveQuestionsForJob when outline is empty and a job is provided", () => {
    const job = makeJob({ appliance_type: "oven_range" });
    const result = parseQuestionOutline("", job);
    // adaptiveQuestionsForJob for oven_range includes a gas-smell question
    expect(result.length).toBeGreaterThan(1);
    expect(result.some((q) => /gas/i.test(q))).toBe(true);
  });

  it("uses the default fallback when outline is empty and no job is given", () => {
    const result = parseQuestionOutline("");
    expect(result).toEqual(["Confirm the appliance details, symptoms, timing, error code or explicit none, and visit logistics."]);
  });
});

// ---------------------------------------------------------------------------
// buildCallRequestSnapshot
// ---------------------------------------------------------------------------

describe("buildCallRequestSnapshot", () => {
  it("returns a valid JSON string", () => {
    const snapshot = buildCallRequestSnapshot(makeJob());
    expect(() => JSON.parse(snapshot)).not.toThrow();
  });

  it("includes all standard job fields in the parsed object", () => {
    const job = makeJob({
      appliance_type: "dryer",
      brand: "Samsung",
      model: "DV45H7000EW",
      reported_problem: "No heat",
      symptom_timing: "Every cycle",
      error_code: "E3",
      visit_note: "Ring doorbell twice",
      access_notes: "Side gate code 1234",
    });
    const parsed = JSON.parse(buildCallRequestSnapshot(job));

    expect(parsed.appliance_type).toBe("dryer");
    expect(parsed.appliance).toBe("Dryer");
    expect(parsed.brand).toBe("Samsung");
    expect(parsed.model).toBe("DV45H7000EW");
    expect(parsed.reported_problem).toBe("No heat");
    expect(parsed.symptom_timing).toBe("Every cycle");
    expect(parsed.error_code).toBe("E3");
    expect(parsed.visit_note).toBe("Ring doorbell twice");
    expect(parsed.access_notes_present).toBe(true);
  });

  it("sets access_notes_present to false when access_notes is empty", () => {
    const parsed = JSON.parse(buildCallRequestSnapshot(makeJob({ access_notes: "" })));
    expect(parsed.access_notes_present).toBe(false);
  });

  it("sets access_notes_present to false when access_notes is undefined", () => {
    const parsed = JSON.parse(buildCallRequestSnapshot(makeJob({ access_notes: undefined })));
    expect(parsed.access_notes_present).toBe(false);
  });

  it("uses the default purpose from callPurposeForJob when no overrides are given", () => {
    const parsed = JSON.parse(buildCallRequestSnapshot(makeJob({ appliance_type: "dishwasher" })));
    expect(parsed.purpose).toContain("dishwasher");
    expect(parsed.purpose).toMatch(/pre-visit preparation check/i);
  });

  it("uses override.purpose when provided", () => {
    const parsed = JSON.parse(
      buildCallRequestSnapshot(makeJob(), { purpose: "Custom purpose text" })
    );
    expect(parsed.purpose).toBe("Custom purpose text");
  });

  it("uses override.questions when provided", () => {
    const customQuestions = ["Q1", "Q2", "Q3"];
    const parsed = JSON.parse(
      buildCallRequestSnapshot(makeJob(), { questions: customQuestions })
    );
    expect(parsed.questions).toEqual(customQuestions);
  });

  it("truncates long field values to their respective limits", () => {
    const longBrand = "X".repeat(200);
    const parsed = JSON.parse(
      buildCallRequestSnapshot(makeJob({ brand: longBrand }))
    );
    expect(parsed.brand.length).toBeLessThanOrEqual(60);
  });

  it("truncates reported_problem to 500 chars", () => {
    const longProblem = "A".repeat(600);
    const parsed = JSON.parse(
      buildCallRequestSnapshot(makeJob({ reported_problem: longProblem }))
    );
    expect(parsed.reported_problem.length).toBeLessThanOrEqual(500);
  });

  it("handles nullish optional fields gracefully", () => {
    const job = makeJob({
      brand: null,
      model: null,
      symptom_timing: null,
      error_code: null,
      visit_note: null,
      access_notes: null,
    });
    const parsed = JSON.parse(buildCallRequestSnapshot(job));
    expect(parsed.brand).toBe("");
    expect(parsed.model).toBe("");
    expect(parsed.symptom_timing).toBe("");
    expect(parsed.error_code).toBe("");
    expect(parsed.visit_note).toBe("");
    expect(parsed.access_notes_present).toBe(false);
  });

  it("always includes the appliance label from applianceLabel regardless of override", () => {
    const parsed = JSON.parse(
      buildCallRequestSnapshot(makeJob({ appliance_type: "refrigerator" }), {
        purpose: "override",
      })
    );
    expect(parsed.appliance).toBe("Refrigerator");
  });
});

// ---------------------------------------------------------------------------
// normalizePersistedCallAttemptForQueue
// ---------------------------------------------------------------------------

describe("normalizePersistedCallAttemptForQueue", () => {
  it("returns null for null input", () => {
    expect(normalizePersistedCallAttemptForQueue(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(normalizePersistedCallAttemptForQueue(undefined)).toBeNull();
  });

  it("returns null for a primitive string", () => {
    expect(normalizePersistedCallAttemptForQueue("not an object")).toBeNull();
  });

  it("returns null for a primitive number", () => {
    expect(normalizePersistedCallAttemptForQueue(42)).toBeNull();
  });

  it("returns null for an array", () => {
    expect(normalizePersistedCallAttemptForQueue([{ id: "x", repair_job_id: "y" }])).toBeNull();
  });

  it("returns null when id is missing", () => {
    expect(
      normalizePersistedCallAttemptForQueue({ repair_job_id: "rj-1", lifecycle_status: "prepared" })
    ).toBeNull();
  });

  it("returns null when repair_job_id is missing", () => {
    expect(
      normalizePersistedCallAttemptForQueue({ id: "at-1", lifecycle_status: "prepared" })
    ).toBeNull();
  });

  it("returns null when id is an empty string", () => {
    expect(
      normalizePersistedCallAttemptForQueue({ id: "", repair_job_id: "rj-1" })
    ).toBeNull();
  });

  it("returns null when repair_job_id is an empty string", () => {
    expect(
      normalizePersistedCallAttemptForQueue({ id: "at-1", repair_job_id: "" })
    ).toBeNull();
  });

  it("returns null when id is whitespace-only", () => {
    expect(
      normalizePersistedCallAttemptForQueue({ id: "   ", repair_job_id: "rj-1" })
    ).toBeNull();
  });

  it("trims id and repair_job_id from surrounding whitespace", () => {
    const result = normalizePersistedCallAttemptForQueue({
      id: "  at-1  ",
      repair_job_id: "  rj-1  ",
      lifecycle_status: "prepared",
    });
    expect(result).not.toBeNull();
    expect(result!.id).toBe("at-1");
    expect(result!.repair_job_id).toBe("rj-1");
  });

  it("normalizes a valid minimal record to 'prepared' when lifecycle_status is unrecognized", () => {
    const result = normalizePersistedCallAttemptForQueue({
      id: "at-1",
      repair_job_id: "rj-1",
      lifecycle_status: "bogus_status",
    });
    expect(result!.lifecycle_status).toBe("prepared");
  });

  it("preserves 'submitting' as-is without reclassifying", () => {
    const result = normalizePersistedCallAttemptForQueue({
      id: "at-1",
      repair_job_id: "rj-1",
      lifecycle_status: "submitting",
    });
    expect(result!.lifecycle_status).toBe("submitting");
  });

  it("preserves valid remote lifecycle statuses", () => {
    for (const status of ["queued", "in_progress", "completed", "no_answer", "failed"] as const) {
      const result = normalizePersistedCallAttemptForQueue({
        id: "at-1",
        repair_job_id: "rj-1",
        lifecycle_status: status,
      });
      expect(result!.lifecycle_status).toBe(status);
    }
  });

  it("returns null provider_status for an invalid provider_status value", () => {
    const result = normalizePersistedCallAttemptForQueue({
      id: "at-1",
      repair_job_id: "rj-1",
      lifecycle_status: "completed",
      provider_status: "not_a_real_status",
    });
    expect(result!.provider_status).toBeNull();
  });

  it("preserves a valid provider_status", () => {
    const result = normalizePersistedCallAttemptForQueue({
      id: "at-1",
      repair_job_id: "rj-1",
      lifecycle_status: "completed",
      provider_status: "no_answer",
    });
    expect(result!.provider_status).toBe("no_answer");
  });

  it("returns null submitted_at and completed_at for non-string values", () => {
    const result = normalizePersistedCallAttemptForQueue({
      id: "at-1",
      repair_job_id: "rj-1",
      submitted_at: 12345,
      completed_at: true,
    });
    expect(result!.submitted_at).toBeNull();
    expect(result!.completed_at).toBeNull();
  });

  it("returns null for empty id after trimming", () => {
    const result = normalizePersistedCallAttemptForQueue({
      id: "  ",
      repair_job_id: "rj-1",
    });
    expect(result).toBeNull();
  });

  it("includes timestamp fields when they are valid strings", () => {
    const result = normalizePersistedCallAttemptForQueue({
      id: "at-1",
      repair_job_id: "rj-1",
      created_at: "2025-01-15T10:00:00Z",
      updated_at: "2025-01-15T11:00:00Z",
      created_date: "2025-01-15",
      updated_date: "2025-01-16",
    });
    expect(result!.created_at).toBe("2025-01-15T10:00:00Z");
    expect(result!.updated_at).toBe("2025-01-15T11:00:00Z");
    expect(result!.created_date).toBe("2025-01-15");
    expect(result!.updated_date).toBe("2025-01-16");
  });

  it("omits timestamp fields when they are non-string (returns undefined)", () => {
    const result = normalizePersistedCallAttemptForQueue({
      id: "at-1",
      repair_job_id: "rj-1",
    });
    expect(result!.created_at).toBeUndefined();
    expect(result!.updated_at).toBeUndefined();
    expect(result!.created_date).toBeUndefined();
    expect(result!.updated_date).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isRetryableCallStatus
// ---------------------------------------------------------------------------

describe("isRetryableCallStatus", () => {
  it("returns true for 'no_answer'", () => {
    expect(isRetryableCallStatus("no_answer")).toBe(true);
  });

  it("returns true for 'voicemail'", () => {
    expect(isRetryableCallStatus("voicemail")).toBe(true);
  });

  it("returns true for 'busy'", () => {
    expect(isRetryableCallStatus("busy")).toBe(true);
  });

  it("returns false for 'completed'", () => {
    expect(isRetryableCallStatus("completed")).toBe(false);
  });

  it("returns false for 'failed'", () => {
    expect(isRetryableCallStatus("failed")).toBe(false);
  });

  it("returns false for 'declined'", () => {
    expect(isRetryableCallStatus("declined")).toBe(false);
  });

  it("returns false for 'expired'", () => {
    expect(isRetryableCallStatus("expired")).toBe(false);
  });

  it("returns false for 'canceled'", () => {
    expect(isRetryableCallStatus("canceled")).toBe(false);
  });

  it("returns false for 'queued'", () => {
    expect(isRetryableCallStatus("queued")).toBe(false);
  });

  it("returns false for 'in_progress'", () => {
    expect(isRetryableCallStatus("in_progress")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isRetryableCallStatus(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isRetryableCallStatus(undefined)).toBe(false);
  });

  it("returns false for a number", () => {
    expect(isRetryableCallStatus(42)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isRetryableCallStatus("")).toBe(false);
  });

  it("returns false for a typo/case variation", () => {
    expect(isRetryableCallStatus("No_Answer")).toBe(false);
    expect(isRetryableCallStatus("NO_ANSWER")).toBe(false);
  });

  it("returns false for an object", () => {
    expect(isRetryableCallStatus({ status: "no_answer" })).toBe(false);
  });
});
