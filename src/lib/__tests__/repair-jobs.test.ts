import { describe, it, expect } from "vitest";
import {
  emptyJobInput,
  jobToInput,
  validateJobInput,
  toPayload,
  preparationChecklist,
  hasMissingInfo,
  normalizePhoneInput,
  matchesSearch,
  friendlyError,
  formatTimestamp,
  applianceLabel,
  SAFE_DEFAULT_PHONE,
  type RepairJobInput,
  type RepairJobRecord,
  type ApplianceType,
} from "@/lib/repair-jobs";

/* -------------------------------------------------------------------------- */
/*  Helper: build a minimal valid RepairJobInput / RepairJobRecord            */
/* -------------------------------------------------------------------------- */

function validInput(overrides: Partial<RepairJobInput> = {}): RepairJobInput {
  return {
    customer_name: "Jane Doe",
    phone: "+15550199999",
    appliance_type: "refrigerator",
    brand: "Samsung",
    model: "RF28",
    reported_problem: "Not cooling properly, fridge section warm",
    symptom_timing: "Started 2 days ago",
    error_code: "E4",
    visit_note: "Bring thermometer",
    access_notes: "Side entrance, ring bell",
    operator_notes: "Customer is elderly",
    ...overrides,
  };
}

function jobRecord(overrides: Partial<RepairJobRecord> = {}): RepairJobRecord {
  return {
    id: "job-abc",
    customer_name: "Jane Doe",
    phone: "+15550199999",
    appliance_type: "refrigerator",
    brand: "Samsung",
    model: "RF28",
    reported_problem: "Not cooling properly",
    symptom_timing: "Started 2 days ago",
    error_code: "E4",
    visit_note: "Bring thermometer",
    access_notes: "Side entrance",
    operator_notes: "Customer is elderly",
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/*  1. emptyJobInput                                                          */
/* -------------------------------------------------------------------------- */

describe("emptyJobInput", () => {
  it("returns a blank form with all string fields set to empty", () => {
    const input = emptyJobInput();
    expect(input.customer_name).toBe("");
    expect(input.brand).toBe("");
    expect(input.model).toBe("");
    expect(input.reported_problem).toBe("");
    expect(input.symptom_timing).toBe("");
    expect(input.error_code).toBe("");
    expect(input.visit_note).toBe("");
    expect(input.access_notes).toBe("");
    expect(input.operator_notes).toBe("");
  });

  it("defaults appliance_type to washing_machine", () => {
    expect(emptyJobInput().appliance_type).toBe("washing_machine");
  });

  it("sets phone to SAFE_DEFAULT_PHONE (valid E.164 or empty)", () => {
    const phone = emptyJobInput().phone;
    if (phone) {
      expect(/^\+[1-9]\d{6,14}$/.test(phone)).toBe(true);
    } else {
      expect(phone).toBe("");
    }
  });

  it("returns a fresh object each time (no shared references)", () => {
    const a = emptyJobInput();
    const b = emptyJobInput();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

/* -------------------------------------------------------------------------- */
/*  2. jobToInput                                                             */
/* -------------------------------------------------------------------------- */

describe("jobToInput", () => {
  it("maps all fields from a RepairJobRecord to RepairJobInput", () => {
    const job = jobRecord();
    const input = jobToInput(job);
    expect(input.customer_name).toBe("Jane Doe");
    expect(input.phone).toBe("+15550199999");
    expect(input.appliance_type).toBe("refrigerator");
    expect(input.brand).toBe("Samsung");
    expect(input.model).toBe("RF28");
    expect(input.reported_problem).toBe("Not cooling properly");
    expect(input.symptom_timing).toBe("Started 2 days ago");
    expect(input.error_code).toBe("E4");
    expect(input.visit_note).toBe("Bring thermometer");
    expect(input.access_notes).toBe("Side entrance");
    expect(input.operator_notes).toBe("Customer is elderly");
  });

  it("converts null optional fields to empty strings", () => {
    const job = jobRecord({
      brand: null,
      model: null,
      symptom_timing: null,
      error_code: null,
      visit_note: null,
      access_notes: null,
      operator_notes: null,
    });
    const input = jobToInput(job);
    expect(input.brand).toBe("");
    expect(input.model).toBe("");
    expect(input.symptom_timing).toBe("");
    expect(input.error_code).toBe("");
    expect(input.visit_note).toBe("");
    expect(input.access_notes).toBe("");
    expect(input.operator_notes).toBe("");
  });

  it("converts undefined optional fields to empty strings", () => {
    const job = jobRecord({
      brand: undefined,
      model: undefined,
      symptom_timing: undefined,
      error_code: undefined,
    });
    const input = jobToInput(job);
    expect(input.brand).toBe("");
    expect(input.model).toBe("");
    expect(input.symptom_timing).toBe("");
    expect(input.error_code).toBe("");
  });

  it("defaults appliance_type to washing_machine when empty/falsy", () => {
    const job = jobRecord({ appliance_type: "" });
    expect(jobToInput(job).appliance_type).toBe("washing_machine");
  });

  it("preserves a valid appliance_type string", () => {
    const job = jobRecord({ appliance_type: "dishwasher" });
    expect(jobToInput(job).appliance_type).toBe("dishwasher");
  });
});

/* -------------------------------------------------------------------------- */
/*  3. validateJobInput                                                       */
/* -------------------------------------------------------------------------- */

describe("validateJobInput", () => {
  it("returns an empty object for a fully valid input", () => {
    const errors = validateJobInput(validInput());
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it("requires customer_name", () => {
    const errors = validateJobInput(validInput({ customer_name: "" }));
    expect(errors.customer_name).toBeTruthy();
  });

  it("requires phone", () => {
    const errors = validateJobInput(validInput({ phone: "" }));
    expect(errors.phone).toBeTruthy();
  });

  it("requires appliance_type to be one of the known types", () => {
    const errors = validateJobInput(validInput({ appliance_type: "toaster" as ApplianceType }));
    expect(errors.appliance_type).toBeTruthy();
  });

  it("requires reported_problem", () => {
    const errors = validateJobInput(validInput({ reported_problem: "" }));
    expect(errors.reported_problem).toBeTruthy();
  });

  it("rejects reported_problem shorter than 8 characters", () => {
    const errors = validateJobInput(validInput({ reported_problem: "broken" }));
    expect(errors.reported_problem).toBeTruthy();
  });

  it("rejects customer_name exceeding 80 characters", () => {
    const errors = validateJobInput(validInput({ customer_name: "A".repeat(81) }));
    expect(errors.customer_name).toBeTruthy();
  });

  it("accepts customer_name at exactly 80 characters", () => {
    const errors = validateJobInput(validInput({ customer_name: "A".repeat(80) }));
    expect(errors.customer_name).toBeUndefined();
  });

  it("rejects phone exceeding 32 characters", () => {
    const errors = validateJobInput(validInput({ phone: "+1" + "5".repeat(33) }));
    expect(errors.phone).toBeTruthy();
  });

  it("rejects a phone that does not match E.164 format", () => {
    const errors = validateJobInput(validInput({ phone: "555-0199" }));
    expect(errors.phone).toBeTruthy();
  });

  it("trims whitespace before validating required fields", () => {
    const errors = validateJobInput(
      validInput({ customer_name: "   ", reported_problem: "   " })
    );
    expect(errors.customer_name).toBeTruthy();
    expect(errors.reported_problem).toBeTruthy();
  });

  it("does not require optional fields (brand, model, etc.)", () => {
    const errors = validateJobInput(
      validInput({
        brand: "",
        model: "",
        symptom_timing: "",
        error_code: "",
        visit_note: "",
        access_notes: "",
        operator_notes: "",
      })
    );
    expect(errors.brand).toBeUndefined();
    expect(errors.model).toBeUndefined();
    expect(errors.symptom_timing).toBeUndefined();
    expect(errors.error_code).toBeUndefined();
    expect(errors.visit_note).toBeUndefined();
    expect(errors.access_notes).toBeUndefined();
    expect(errors.operator_notes).toBeUndefined();
  });

  it("rejects optional fields exceeding their individual character limits", () => {
    const errors = validateJobInput(
      validInput({
        brand: "B".repeat(61),
        model: "M".repeat(81),
        symptom_timing: "S".repeat(201),
        error_code: "E".repeat(41),
        visit_note: "V".repeat(401),
        access_notes: "A".repeat(401),
        operator_notes: "O".repeat(601),
      })
    );
    expect(errors.brand).toBeTruthy();
    expect(errors.model).toBeTruthy();
    expect(errors.symptom_timing).toBeTruthy();
    expect(errors.error_code).toBeTruthy();
    expect(errors.visit_note).toBeTruthy();
    expect(errors.access_notes).toBeTruthy();
    expect(errors.operator_notes).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/*  4. toPayload                                                              */
/* -------------------------------------------------------------------------- */

describe("toPayload", () => {
  it("trims whitespace from customer_name and reported_problem", () => {
    const payload = toPayload(
      validInput({ customer_name: "  Jane Doe  ", reported_problem: "  Not cooling  " })
    );
    expect(payload.customer_name).toBe("Jane Doe");
    expect(payload.reported_problem).toBe("Not cooling");
  });

  it("normalizes phone formatting into canonical E.164", () => {
    const payload = toPayload(validInput({ phone: "+1 (555) 019-9999" }));
    expect(payload.phone).toBe("+15550199999");
  });

  it("truncates customer_name to 80 characters", () => {
    const payload = toPayload(validInput({ customer_name: "A".repeat(100) }));
    expect(payload.customer_name).toHaveLength(80);
  });

  it("truncates reported_problem to 500 characters", () => {
    const payload = toPayload(validInput({ reported_problem: "X".repeat(600) }));
    expect(payload.reported_problem).toHaveLength(500);
  });

  it("returns null for empty optional fields (not empty string)", () => {
    const payload = toPayload(validInput({ brand: "", model: "", symptom_timing: "" }));
    expect(payload.brand).toBeNull();
    expect(payload.model).toBeNull();
    expect(payload.symptom_timing).toBeNull();
  });

  it("returns trimmed text for non-empty optional fields", () => {
    const payload = toPayload(validInput({ brand: "  Samsung  " }));
    expect(payload.brand).toBe("Samsung");
  });

  it("truncates optional fields to their individual limits", () => {
    const payload = toPayload(
      validInput({
        brand: "B".repeat(100),
        model: "M".repeat(100),
        error_code: "E".repeat(60),
        visit_note: "V".repeat(500),
        access_notes: "A".repeat(500),
        operator_notes: "O".repeat(700),
      })
    );
    expect(payload.brand).toHaveLength(60);
    expect(payload.model).toHaveLength(80);
    expect(payload.error_code).toHaveLength(40);
    expect(payload.visit_note).toHaveLength(400);
    expect(payload.access_notes).toHaveLength(400);
    expect(payload.operator_notes).toHaveLength(600);
  });

  it("passes through appliance_type unchanged", () => {
    const payload = toPayload(validInput({ appliance_type: "dryer" }));
    expect(payload.appliance_type).toBe("dryer");
  });
});

/* -------------------------------------------------------------------------- */
/*  5. preparationChecklist                                                   */
/* -------------------------------------------------------------------------- */

describe("preparationChecklist", () => {
  it("returns exactly 10 items", () => {
    const checklist = preparationChecklist(jobRecord());
    expect(checklist).toHaveLength(10);
  });

  it("marks all present fields as 'entered' with their values", () => {
    const job = jobRecord();
    const checklist = preparationChecklist(job);
    const entered = checklist.filter((i) => i.status === "entered");
    expect(entered.length).toBeGreaterThanOrEqual(8);
    for (const item of entered) {
      expect(item.value).toBeTruthy();
    }
  });

  it("marks missing optional fields as 'missing' with null value", () => {
    const job = jobRecord({ brand: null, model: null, visit_note: null });
    const checklist = preparationChecklist(job);
    const missing = checklist.filter((i) => i.status === "missing");
    expect(missing.length).toBeGreaterThanOrEqual(3);
    for (const item of missing) {
      expect(item.value).toBeNull();
    }
  });

  it("treats whitespace-only values as missing", () => {
    const job = jobRecord({ brand: "   ", model: "  " });
    const checklist = preparationChecklist(job);
    const brandItem = checklist.find((i) => i.key === "brand")!;
    const modelItem = checklist.find((i) => i.key === "model")!;
    expect(brandItem.status).toBe("missing");
    expect(modelItem.status).toBe("missing");
  });

  it("returns 'missing' for a completely empty job", () => {
    const empty: RepairJobRecord = {
      id: "",
      customer_name: "",
      phone: "",
      appliance_type: "",
      reported_problem: "",
    };
    const checklist = preparationChecklist(empty);
    expect(checklist.every((i) => i.status === "missing")).toBe(true);
  });

  it("each item has key, label, status, and value properties", () => {
    const checklist = preparationChecklist(jobRecord());
    for (const item of checklist) {
      expect(typeof item.key).toBe("string");
      expect(typeof item.label).toBe("string");
      expect(["entered", "missing"]).toContain(item.status);
      expect(item.value === null || typeof item.value === "string").toBe(true);
    }
  });

  it("includes the expected keys in order", () => {
    const checklist = preparationChecklist(jobRecord());
    const keys = checklist.map((i) => i.key);
    expect(keys).toEqual([
      "customer", "phone", "appliance", "brand", "model",
      "problem", "timing", "error", "visit", "access",
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/*  6. hasMissingInfo                                                         */
/* -------------------------------------------------------------------------- */

describe("hasMissingInfo", () => {
  it("returns false when all optional fields are filled", () => {
    expect(hasMissingInfo(jobRecord())).toBe(false);
  });

  it("returns true when brand is missing", () => {
    expect(hasMissingInfo(jobRecord({ brand: null }))).toBe(true);
  });

  it("returns true when model is missing", () => {
    expect(hasMissingInfo(jobRecord({ model: null }))).toBe(true);
  });

  it("returns true when symptom_timing is missing", () => {
    expect(hasMissingInfo(jobRecord({ symptom_timing: null }))).toBe(true);
  });

  it("returns true when error_code is missing", () => {
    expect(hasMissingInfo(jobRecord({ error_code: null }))).toBe(true);
  });

  it("returns true when visit_note is missing", () => {
    expect(hasMissingInfo(jobRecord({ visit_note: null }))).toBe(true);
  });

  it("returns true when access_notes is missing", () => {
    expect(hasMissingInfo(jobRecord({ access_notes: null }))).toBe(true);
  });

  it("does not flag missing customer_name, phone, appliance_type, or reported_problem", () => {
    const job = jobRecord({
      customer_name: "",
      phone: "",
      appliance_type: "",
      reported_problem: "",
    });
    expect(hasMissingInfo(job)).toBe(false);
  });

  it("returns true when multiple optional fields are missing", () => {
    const job = jobRecord({ brand: null, model: null, error_code: null });
    expect(hasMissingInfo(job)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*  7. normalizePhoneInput                                                    */
/* -------------------------------------------------------------------------- */

describe("normalizePhoneInput", () => {
  it("strips spaces from a valid formatted phone", () => {
    expect(normalizePhoneInput("+1 555 019 9999")).toBe("+15550199999");
  });

  it("strips parentheses", () => {
    expect(normalizePhoneInput("+1 (555) 019-9999")).toBe("+15550199999");
  });

  it("strips hyphens", () => {
    expect(normalizePhoneInput("+44-7911-123456")).toBe("+447911123456");
  });

  it("strips dots", () => {
    expect(normalizePhoneInput("+49.170.1234567")).toBe("+491701234567");
  });

  it("returns empty string for empty input", () => {
    expect(normalizePhoneInput("")).toBe("");
  });

  it("returns empty string for null/undefined (coerced via String)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally testing invalid input
    expect(normalizePhoneInput(null as any)).toBe("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally testing invalid input
    expect(normalizePhoneInput(undefined as any)).toBe("");
  });

  it("leaves letters untouched (not a valid phone format)", () => {
    expect(normalizePhoneInput("call me maybe")).toBe("call me maybe");
  });

  it("leaves a plain number without + prefix untouched", () => {
    expect(normalizePhoneInput("5550199999")).toBe("5550199999");
  });

  it("handles already-canonical input", () => {
    expect(normalizePhoneInput("+15550199999")).toBe("+15550199999");
  });

  it("handles mixed formatting characters", () => {
    expect(normalizePhoneInput("+1 (555) .019-9999")).toBe("+15550199999");
  });
});

/* -------------------------------------------------------------------------- */
/*  8. matchesSearch                                                          */
/* -------------------------------------------------------------------------- */

describe("matchesSearch", () => {
  const job = jobRecord({
    customer_name: "Jane Doe",
    phone: "+15550199999",
    brand: "Samsung",
    model: "RF28J",
    reported_problem: "Not cooling, fridge section warm",
    error_code: "E4",
    visit_note: "Ring doorbell",
    access_notes: "Back gate code 1234",
  });

  it("returns true for an empty query (matches everything)", () => {
    expect(matchesSearch(job, "")).toBe(true);
  });

  it("returns true for a whitespace-only query", () => {
    expect(matchesSearch(job, "   ")).toBe(true);
  });

  it("matches customer_name (case-insensitive)", () => {
    expect(matchesSearch(job, "jane")).toBe(true);
    expect(matchesSearch(job, "JANE")).toBe(true);
  });

  it("matches phone", () => {
    expect(matchesSearch(job, "555")).toBe(true);
  });

  it("matches brand", () => {
    expect(matchesSearch(job, "samsung")).toBe(true);
  });

  it("matches model", () => {
    expect(matchesSearch(job, "rf28")).toBe(true);
  });

  it("matches reported_problem", () => {
    expect(matchesSearch(job, "cooling")).toBe(true);
  });

  it("matches error_code", () => {
    expect(matchesSearch(job, "E4")).toBe(true);
  });

  it("matches visit_note", () => {
    expect(matchesSearch(job, "doorbell")).toBe(true);
  });

  it("matches access_notes", () => {
    expect(matchesSearch(job, "gate code")).toBe(true);
  });

  it("matches appliance_type label (e.g. 'Refrigerator')", () => {
    expect(matchesSearch(job, "refrigerator")).toBe(true);
  });

  it("matches appliance_type raw value", () => {
    expect(matchesSearch(job, "refrigerator")).toBe(true);
  });

  it("returns false when query does not match any field", () => {
    expect(matchesSearch(job, "xyznotfound")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(matchesSearch(job, "SAMSUNG")).toBe(true);
    expect(matchesSearch(job, "samsung")).toBe(true);
    expect(matchesSearch(job, "SamSuNg")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*  9. friendlyError                                                          */
/* -------------------------------------------------------------------------- */

describe("friendlyError", () => {
  const fallback = "Something went wrong. Please try again.";

  it("returns fallback for null/undefined", () => {
    expect(friendlyError(null, fallback)).toBe(fallback);
    expect(friendlyError(undefined, fallback)).toBe(fallback);
  });

  it("returns the string directly when error is a string", () => {
    expect(friendlyError("Network timeout", fallback)).toBe("Network timeout");
  });

  it("maps 401 to auth message", () => {
    const msg = friendlyError({ status: 401 }, fallback);
    expect(msg).toMatch(/signed in/i);
  });

  it("maps 403 to auth message", () => {
    const msg = friendlyError({ status: 403 }, fallback);
    expect(msg).toMatch(/signed in/i);
  });

  it("maps 404 to not-found message", () => {
    const msg = friendlyError({ status: 404 }, fallback);
    expect(msg).toMatch(/not found/i);
  });

  it("reads status from error.response.status", () => {
    const msg = friendlyError({ response: { status: 401 } }, fallback);
    expect(msg).toMatch(/signed in/i);
  });

  it("returns error.message when present and not a network/fetch error", () => {
    expect(friendlyError({ message: "Quota exceeded" }, fallback)).toBe("Quota exceeded");
  });

  it("returns fallback for network/fetch errors", () => {
    expect(friendlyError({ message: "Failed to fetch" }, fallback)).toBe(fallback);
    expect(friendlyError({ message: "Network error" }, fallback)).toBe(fallback);
  });

  it("returns fallback for unrecognized error objects without a message", () => {
    expect(friendlyError({ code: 500 }, fallback)).toBe(fallback);
  });

  it("returns fallback for non-object non-string errors", () => {
    expect(friendlyError(42, fallback)).toBe(fallback);
  });

  it("returns the error itself when it is a number (treated as non-string, non-object)", () => {
    // Numbers don't have .message or .status, so they fall through to fallback
    expect(friendlyError(500, fallback)).toBe(fallback);
  });
});

/* -------------------------------------------------------------------------- */
/*  10. formatTimestamp                                                       */
/* -------------------------------------------------------------------------- */

describe("formatTimestamp", () => {
  it("returns '—' for undefined", () => {
    expect(formatTimestamp(undefined)).toBe("—");
  });

  it("returns '—' for null", () => {
    expect(formatTimestamp(null)).toBe("—");
  });

  it("returns '—' for an invalid date string", () => {
    expect(formatTimestamp("not-a-date")).toBe("—");
  });

  it("returns a formatted string for a valid ISO timestamp", () => {
    const result = formatTimestamp("2025-03-15T14:30:00Z");
    expect(result).not.toBe("—");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("formats to include at least the date and time components", () => {
    const result = formatTimestamp("2025-12-25T09:00:00Z");
    // Intl.DateTimeFormat with dateStyle:medium, timeStyle:short always
    // produces a string containing some date and time representation
    expect(result).not.toBe("—");
    expect(result.length).toBeGreaterThan(5);
  });

  it("handles empty string as falsy input", () => {
    expect(formatTimestamp("")).toBe("—");
  });
});

/* -------------------------------------------------------------------------- */
/*  11. applianceLabel                                                        */
/* -------------------------------------------------------------------------- */

describe("applianceLabel", () => {
  it("maps washing_machine to 'Washing machine'", () => {
    expect(applianceLabel("washing_machine")).toBe("Washing machine");
  });

  it("maps dryer to 'Dryer'", () => {
    expect(applianceLabel("dryer")).toBe("Dryer");
  });

  it("maps dishwasher to 'Dishwasher'", () => {
    expect(applianceLabel("dishwasher")).toBe("Dishwasher");
  });

  it("maps refrigerator to 'Refrigerator'", () => {
    expect(applianceLabel("refrigerator")).toBe("Refrigerator");
  });

  it("maps oven_range to 'Oven / range'", () => {
    expect(applianceLabel("oven_range")).toBe("Oven / range");
  });

  it("maps other to 'Other'", () => {
    expect(applianceLabel("other")).toBe("Other");
  });

  it("returns the raw value for an unknown type", () => {
    expect(applianceLabel("toaster")).toBe("toaster");
  });

  it("returns the raw value for an empty string", () => {
    expect(applianceLabel("")).toBe("");
  });
});
