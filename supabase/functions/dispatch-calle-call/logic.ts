const PROVIDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

export type SafeErrorCategory = "provider_auth" | "validation" | "rate_or_credit" | "network" | "unexpected";
export type DispatchResponse = {
  status: "dispatch_locked" | "submitted" | "uncertain_submit" | "error";
  message: string;
  safe_error_category?: SafeErrorCategory;
};
export type Snapshot = Record<string, unknown>;

export const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    appliance_brand: { type: "string" },
    appliance_model: { type: "string" },
    reported_symptoms: { type: "string" },
    symptom_timing: { type: "string" },
    error_code: { type: "string" },
    access_constraints: { type: "array", items: { type: "string" } },
    visit_blockers: { type: "array", items: { type: "string" } },
    completion_status: { type: "string", enum: ["complete", "incomplete", "uncertain"] },
  },
  required: [
    "appliance_brand",
    "appliance_model",
    "reported_symptoms",
    "symptom_timing",
    "error_code",
    "access_constraints",
    "visit_blockers",
    "completion_status",
  ],
} as const;

export const RECIPIENT_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    recipient_identity: { type: "string", enum: ["confirmed", "uncertain", "not_confirmed"] },
    preparation_consent: { type: "string", enum: ["confirmed", "uncertain", "not_confirmed"] },
    questions_answered: { type: "boolean" },
    participant_notes: { type: "array", items: { type: "string" } },
  },
  required: ["recipient_identity", "preparation_consent", "questions_answered", "participant_notes"],
} as const;

export const PREPARATION_TASK = [
  "Conduct a brief pre-visit preparation call for an appliance repair coordinator.",
  "Greet the participant using the saved recipient name in the context below and confirm you are speaking with them, or with someone else who can help with the appliance issue at this location. If neither is available, thank them and end politely.",
  "Early in the call, tell the participant this call may be recorded for quality and training purposes, and that the details they share may be used to prepare a preliminary, non-binding assessment for the technician to verify in person -- not a diagnosis, a repair commitment, or a scheduled appointment.",
  "Collect only factual preparation details: the exact appliance brand and model, reported symptoms and when they occur, any displayed error code, parking, access, pets, workspace constraints, and anything that could block the visit.",
  "If the customer does not know or cannot find the exact model number, do not treat this as a blocker: ask for the brand alone if known, one distinguishing detail such as color, size, or door style, and record that the model still needs on-site verification, then continue with the rest of the call.",
  "Do not diagnose, recommend repairs, sell, schedule, promise an outcome, or request alarm codes, entry codes, passwords, or other credentials.",
  "Mark unknown details as unknown and keep answers concise.",
].join(" ");

export function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 160;
}

export function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function bounded(value: unknown, max: number): string {
  return typeof value === "string"
  // eslint-disable-next-line no-control-regex -- deliberately stripping control characters from untrusted text before storage/display.
    ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, max)
    : "";
}

export function parseSnapshot(value: unknown): Snapshot | null {
  const raw = bounded(value, 8000);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Snapshot) : null;
  } catch {
    return null;
  }
}

export function providerId(value: unknown): string {
  const id = bounded(value, 160);
  return PROVIDER_ID_RE.test(id) ? id : "";
}

export function categoryForStatus(status: number): SafeErrorCategory {
  if (status === 401 || status === 403) return "provider_auth";
  if (status === 400 || status === 422) return "validation";
  if (status === 402 || status === 429) return "rate_or_credit";
  return "unexpected";
}

export function failureMessage(category: SafeErrorCategory): string {
  if (category === "provider_auth") return "CALL-E did not accept the saved provider authorization. No call status was created.";
  if (category === "validation") return "CALL-E rejected the prepared request. Review the saved preparation details before any future action.";
  if (category === "rate_or_credit") return "CALL-E could not accept the request because of a rate or account-credit limit. Review the provider account before any future action.";
  if (category === "network") return "The provider request outcome could not be confirmed. Do not retry automatically; review the private draft first.";
  return "CALL-E returned an unexpected provider response. Do not retry automatically; review the private draft first.";
}

export function snapshotValue(snapshot: Snapshot, key: string, max: number): string {
  return bounded(snapshot[key], max) || "Not recorded";
}

export function buildTask(snapshot: Snapshot, recipientName?: string): string {
  const name = bounded(recipientName, 80) || "the customer";
  return `${PREPARATION_TASK}\n\nSaved job context:\n- Recipient name: ${name}\n- Appliance: ${snapshotValue(snapshot, "appliance", 80)}\n- Brand: ${snapshotValue(snapshot, "brand", 80)}\n- Model: ${snapshotValue(snapshot, "model", 100)}\n- Reported problem: ${snapshotValue(snapshot, "reported_problem", 500)}\n- Symptom timing: ${snapshotValue(snapshot, "symptom_timing", 220)}\n- Error code: ${snapshotValue(snapshot, "error_code", 50)}\n- Visit note: ${snapshotValue(snapshot, "visit_note", 420)}\n- Access notes were entered: ${snapshot.access_notes_present === true ? "yes" : "no"}`.slice(0, 3000);
}
