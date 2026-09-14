const PROVIDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

export const DEMO_ACTION = "run_authorized_demo_call";
export const DEMO_MARKER = "repairready_authorized_demo";
// The actual number lives only in the CALLE_DEMO_PHONE Supabase secret (read in index.ts), never
// in source -- a real, already-consented phone number has no business sitting in public git
// history.
export const DEMO_REGION = "US";
export const DEMO_LOCALE = "en-US";
// One fixed key here would make CALL-E treat every authorized-demo call, from every account,
// forever, as a retry of the very first one ever placed -- idempotency keys tell a provider
// "this is the same logical request, hand back the original result instead of doing it again."
// Each attempt needs its own key so each demo call is actually placed.
export const DEMO_IDEMPOTENCY_PREFIX = "repairready-authorized-demo-";
export function demoIdempotencyKey(): string {
  return `${DEMO_IDEMPOTENCY_PREFIX}${crypto.randomUUID()}`;
}

export type SafeErrorCategory = "provider_auth" | "validation" | "rate_or_credit" | "network" | "unexpected";
export type DemoStatus = "submitted" | "already_started" | "uncertain_submit" | "blocked" | "error";
export type DemoResponse = { status: DemoStatus; message: string; repair_job_id?: string; call_attempt_id?: string; safe_error_category?: SafeErrorCategory };
export type RecordLike = Record<string, unknown>;

export const RESULT_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    appliance_brand: { type: "string", description: "Brand exactly as the participant confirms it." },
    appliance_model: { type: "string", description: "Full model number exactly as the participant confirms it." },
    reported_symptoms: { type: "string", description: "The participant's own words. If broad, preserve them and ask one neutral follow-up for the sound or sensation and what the appliance is doing. Do not infer a cause." },
    symptom_timing: { type: "string", description: "Separate the trigger from the operating moment, including loading or turning on, fill, wash, drain, spin, another described moment, and how consistently it occurs." },
    error_code: { type: "string", description: "The displayed error code or an explicit statement that no code is displayed. Never infer none from silence." },
    access_constraints: { type: "array", description: "Separate access facts, ordinary requirements, and clearly stated unknowns. Keep requirements and unknowns out of visit_blockers.", items: { type: "string" } },
    missing_details: { type: "array", description: "A bounded list of concise unresolved or vague material details, such as exact noise description, cycle stage, elevator or stairs, concierge lead time, or pet status. Use an empty array only when all material details are explicit. Keep ordinary access requirements separate from true blockers.", maxItems: 8, items: { type: "string", maxLength: 180 } },
    visit_blockers: { type: "array", description: "Only explicit access impossibility or an unresolved requirement the participant says prevents the visit. Leave empty when no blocker is explicitly stated.", items: { type: "string" } },
    completion_status: { type: "string", description: "Use complete only when material details are clear. Use incomplete or uncertain when material details remain unknown, vague, or contradictory.", enum: ["complete", "incomplete", "uncertain"] },
  },
  required: ["appliance_brand", "appliance_model", "reported_symptoms", "symptom_timing", "error_code", "access_constraints", "missing_details", "visit_blockers", "completion_status"],
} as const;
export const RECIPIENT_RESULT_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    recipient_identity: { type: "string", enum: ["confirmed", "uncertain", "not_confirmed"] },
    preparation_consent: { type: "string", enum: ["confirmed", "uncertain", "not_confirmed"] },
    questions_answered: { type: "boolean" }, participant_notes: { type: "array", items: { type: "string" } },
  },
  required: ["recipient_identity", "preparation_consent", "questions_answered", "participant_notes"],
} as const;

export const DEMO_PURPOSE = "Pre-visit preparation check for a washing machine job. Confirm identity, appliance details, symptoms, and access. Gather facts for a technician brief. Do not diagnose or promise a repair.";
export const DEMO_QUESTIONS = [
  "Confirm you are speaking with the intended customer and that they agree to a short preparation conversation. Do not ask for passwords or access codes.",
  "Read back the saved appliance brand and full model number, then ask the customer to correct either one if needed.",
  "Ask for the symptoms in the customer's own words. If the answer is broad, such as 'making noises,' ask one neutral follow-up for what the sound is like in their own words and what the appliance is doing when it starts. Do not suggest a cause or repair.",
  "Separate the trigger from the operating moment. Ask whether it starts while loading or turning the appliance on, then whether it occurs during fill, wash, drain, spin, or another clearly described moment, and how consistently. Do not interpret the cause.",
  "Read back the saved error code and ask the customer to confirm it or explicitly say that no code is displayed. Never infer that there is no code from silence.",
  "Ask whether the building is a condo or apartment or another type. Capture a floor or unit only when appropriate for this private job. Never ask for a door, entry, alarm, security code, PIN, password, or credential.",
  "Ask separately whether an elevator or stairs are needed, whether any route is narrow or restricted, and whether the route to the appliance and the available workspace are clear.",
  "Ask about nearby parking or a loading zone, including rules, time limits, permits, or validation.",
  "Ask whether pets are present and what safe access plan the technician should follow.",
  "Ask for the exact days and hours when access is available and any blackout times. Treat this as an access window, not a scheduled appointment.",
  "Ask how concierge registration works, whether advance notice or lead time is required, and whether the technician must bring a business card or other non-sensitive business identification.",
  "Ask whether the participant explicitly cannot provide access or whether an unresolved requirement would prevent the visit. Record ordinary requirements in access_constraints, unknown details as unknown or incomplete, and only explicit blockers in visit_blockers. If no blocker is explicitly stated, leave visit_blockers empty.",
];
export const DEMO_RECIPIENT_NAME = "Authorized demo participant";
export const DEMO_TASK = [
  "Start by greeting the participant using the saved recipient name in the context below, then say: this is an AI assistant calling as part of an authorized RepairReady demonstration. This is not a service booking or a diagnosis. This call may be recorded for quality and training purposes, and the details shared may be used to prepare a preliminary, non-binding assessment for a technician to verify in person. Do you agree to continue with a short preparation conversation?",
  "If the participant does not clearly agree, thank them, end politely, and record preparation_consent as not_confirmed. Do not ask any further questions.",
  "If they agree, ask only for the appliance brand and model, the participant's symptoms in their own words, the exact operating moment and consistency, an error code or an explicit statement that there is none, and access facts collected separately: building type, appropriate floor or unit, elevator or stairs, narrow routes, route and workspace readiness, parking or loading rules, pets and the safe access plan, exact access window and blackout times, concierge process and lead time, and any required business card or other non-sensitive business identification.",
  "Use neutral follow-ups. Verify every material slot before ending. If symptoms remain broad or a material timing or access detail remains vague, preserve the participant's words, add a concise item to missing_details, and set completion_status to incomplete or uncertain instead of treating the answer as complete. Include examples such as exact noise description, cycle stage, elevator or stairs, concierge lead time, or pet status when those details remain unresolved. Use an empty missing_details array only when all material details are explicit. Put ordinary access requirements in access_constraints and unknown details there as unknown or incomplete. Put only an explicit statement that access cannot happen or that an unresolved requirement prevents the visit in visit_blockers. If no explicit blocker is reported, leave visit_blockers empty. A broad availability window is not a scheduled appointment.",
  "Do not diagnose, recommend repairs, provide repair advice, schedule or reschedule, make promises, discuss payment, or request security codes, credentials, passwords, entry codes, alarm codes, PINs, or other sensitive access information. Keep the result bounded and factual, and never invent an access fact or blocker.",
].join(" ");

export function bounded(value: unknown, max: number): string { return typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, max) : ""; } // eslint-disable-line no-control-regex
export function hasText(value: unknown): boolean { return typeof value === "string" && value.trim().length > 0; }
export function validId(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 160; }
export function providerId(value: unknown): string { const id = bounded(value, 160); return PROVIDER_ID_RE.test(id) ? id : ""; }
export function categoryForStatus(status: number): SafeErrorCategory { if (status === 401 || status === 403) return "provider_auth"; if (status === 400 || status === 422) return "validation"; if (status === 402 || status === 429) return "rate_or_credit"; return "unexpected"; }
export function failureMessage(category: SafeErrorCategory): string {
  if (category === "provider_auth") return "The saved provider authorization was not accepted. No demo call status was created.";
  if (category === "validation") return "The provider rejected the prepared demo request. No automatic retry was made.";
  if (category === "rate_or_credit") return "The provider could not accept the demo request because of a rate or account limit. No automatic retry was made.";
  if (category === "network") return "The provider request outcome could not be confirmed. Review the private demo record and do not retry automatically.";
  return "The provider returned an unexpected response. Review the private demo record and do not retry automatically.";
}
export function demoSnapshot(): string {
  return JSON.stringify({ appliance_type: "washing_machine", appliance: "Washing machine", brand: "Unknown", model: "To be confirmed", reported_problem: "Authorized RepairReady demonstration. Participant will describe the washing-machine symptoms in their own words.", symptom_timing: "To be confirmed by the authorized demo participant", error_code: "Not recorded yet", visit_note: "Authorized RepairReady demonstration only. This is not a service booking.", access_notes_present: true, purpose: DEMO_PURPOSE, questions: DEMO_QUESTIONS });
}
export function buildTask(): string { return `${DEMO_TASK}\n\nSaved recipient name: ${DEMO_RECIPIENT_NAME}\n\nSaved context for this demonstration: washing machine; brand unknown; model to be confirmed; no diagnosis or service booking is being requested.`.slice(0, 3000); }
export function hasProviderState(attempt: RecordLike): boolean { return hasText(attempt.provider_call_id) || hasText(attempt.provider_status) || hasText(attempt.submitted_at) || hasText(attempt.completed_at); }
export function hasUncertainSubmission(attempt: RecordLike): boolean { return attempt.lifecycle_status === "submitting" && !hasProviderState(attempt); }
