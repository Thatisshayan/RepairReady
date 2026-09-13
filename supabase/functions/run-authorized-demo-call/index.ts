import { corsHeaders, isAllowedOrigin } from "./_shared/cors.ts";
import { ownerIdFromRequest, serviceClient } from "./_shared/auth.ts";

const DEMO_ACTION = "run_authorized_demo_call";
const DEMO_MARKER = "repairready_authorized_demo";
const DEMO_PHONE = "+13058347598";
const DEMO_REGION = "US";
const DEMO_LOCALE = "en-US";
const DEMO_IDEMPOTENCY_KEY = "repairready-authorized-demo-v1";
const PROVIDER_URL = "https://api.heycall-e.com/v1/calls";
const PROVIDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const CANONICAL_PHONE_RE = /^\+[1-9]\d{6,14}$/;
type SafeErrorCategory = "provider_auth" | "validation" | "rate_or_credit" | "network" | "unexpected";
type DemoStatus = "submitted" | "already_started" | "uncertain_submit" | "blocked" | "error";
type DemoResponse = { status: DemoStatus; message: string; repair_job_id?: string; call_attempt_id?: string; safe_error_category?: SafeErrorCategory };
type RecordLike = Record<string, unknown>;

const RESULT_SCHEMA = {
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
const RECIPIENT_RESULT_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    recipient_identity: { type: "string", enum: ["confirmed", "uncertain", "not_confirmed"] },
    preparation_consent: { type: "string", enum: ["confirmed", "uncertain", "not_confirmed"] },
    questions_answered: { type: "boolean" }, participant_notes: { type: "array", items: { type: "string" } },
  },
  required: ["recipient_identity", "preparation_consent", "questions_answered", "participant_notes"],
} as const;

const DEMO_PURPOSE = "Pre-visit preparation check for a washing machine job. Confirm identity, appliance details, symptoms, and access. Gather facts for a technician brief. Do not diagnose or promise a repair.";
const DEMO_QUESTIONS = [
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
const DEMO_TASK = [
  "Start by saying: Hi, this is an AI assistant calling as part of an authorized RepairReady demonstration. This is not a service booking or a diagnosis. Do you agree to continue with a short preparation conversation?",
  "If the participant does not clearly agree, thank them, end politely, and record preparation_consent as not_confirmed. Do not ask any further questions.",
  "If they agree, ask only for the appliance brand and model, the participant's symptoms in their own words, the exact operating moment and consistency, an error code or an explicit statement that there is none, and access facts collected separately: building type, appropriate floor or unit, elevator or stairs, narrow routes, route and workspace readiness, parking or loading rules, pets and the safe access plan, exact access window and blackout times, concierge process and lead time, and any required business card or other non-sensitive business identification.",
  "Use neutral follow-ups. Verify every material slot before ending. If symptoms remain broad or a material timing or access detail remains vague, preserve the participant's words, add a concise item to missing_details, and set completion_status to incomplete or uncertain instead of treating the answer as complete. Include examples such as exact noise description, cycle stage, elevator or stairs, concierge lead time, or pet status when those details remain unresolved. Use an empty missing_details array only when all material details are explicit. Put ordinary access requirements in access_constraints and unknown details there as unknown or incomplete. Put only an explicit statement that access cannot happen or that an unresolved requirement prevents the visit in visit_blockers. If no explicit blocker is reported, leave visit_blockers empty. A broad availability window is not a scheduled appointment.",
  "Do not diagnose, recommend repairs, provide repair advice, schedule or reschedule, make promises, discuss payment, or request security codes, credentials, passwords, entry codes, alarm codes, PINs, or other sensitive access information. Keep the result bounded and factual, and never invent an access fact or blocker.",
].join(" ");

function jsonResponse(body: DemoResponse, status: number, origin: string | null): Response { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), "Cache-Control": "no-store", "Content-Type": "application/json" } }); }
function bounded(value: unknown, max: number): string { return typeof value === "string" ? value.replace(/[ -]/g, " ").trim().slice(0, max) : ""; }
function hasText(value: unknown): boolean { return typeof value === "string" && value.trim().length > 0; }
function validId(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 160; }
function providerId(value: unknown): string { const id = bounded(value, 160); return PROVIDER_ID_RE.test(id) ? id : ""; }
function categoryForStatus(status: number): SafeErrorCategory { if (status === 401 || status === 403) return "provider_auth"; if (status === 400 || status === 422) return "validation"; if (status === 402 || status === 429) return "rate_or_credit"; return "unexpected"; }
function failureMessage(category: SafeErrorCategory): string {
  if (category === "provider_auth") return "The saved provider authorization was not accepted. No demo call status was created.";
  if (category === "validation") return "The provider rejected the prepared demo request. No automatic retry was made.";
  if (category === "rate_or_credit") return "The provider could not accept the demo request because of a rate or account limit. No automatic retry was made.";
  if (category === "network") return "The provider request outcome could not be confirmed. Review the private demo record and do not retry automatically.";
  return "The provider returned an unexpected response. Review the private demo record and do not retry automatically.";
}
function demoSnapshot(): string {
  return JSON.stringify({ appliance_type: "washing_machine", appliance: "Washing machine", brand: "Unknown", model: "To be confirmed", reported_problem: "Authorized RepairReady demonstration. Participant will describe the washing-machine symptoms in their own words.", symptom_timing: "To be confirmed by the authorized demo participant", error_code: "Not recorded yet", visit_note: "Authorized RepairReady demonstration only. This is not a service booking.", access_notes_present: true, purpose: DEMO_PURPOSE, questions: DEMO_QUESTIONS });
}
function buildTask(): string { return `${DEMO_TASK}\n\nSaved context for this demonstration: washing machine; brand unknown; model to be confirmed; no diagnosis or service booking is being requested.`.slice(0, 3000); }
function hasProviderState(attempt: RecordLike): boolean { return hasText(attempt.provider_call_id) || hasText(attempt.provider_status) || hasText(attempt.submitted_at) || hasText(attempt.completed_at); }
function hasUncertainSubmission(attempt: RecordLike): boolean { return attempt.lifecycle_status === "submitting" && !hasProviderState(attempt); }

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  // SECURITY: Reject requests from a missing or non-allowlisted Origin.
  if (!isAllowedOrigin(origin)) {
    return jsonResponse({ status: "error", message: "Origin header is required for security." }, 403, null);
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ status: "error", message: "Use the signed-in workspace for the authorized demo action." }, 405, origin);

  const ownerId = await ownerIdFromRequest(req);
  if (!ownerId) return jsonResponse({ status: "error", message: "Your session could not be verified. Sign in again and retry." }, 401, origin);
  const db = serviceClient();

  let input: RecordLike = {};
  try { const body = await req.json(); input = body && typeof body === "object" && !Array.isArray(body) ? body as RecordLike : {}; } catch { return jsonResponse({ status: "error", message: "The authorized demo request could not be read." }, 400, origin); }
  if (Object.keys(input).length !== 1 || input.action !== DEMO_ACTION) return jsonResponse({ status: "blocked", message: "Only the fixed authorized RepairReady demo action is accepted. No call was placed." }, 400, origin);

  async function persistSafeError(id: string, category: SafeErrorCategory): Promise<void> {
    try { await db.from("call_attempts").update({ safe_error_category: category, safe_result_summary: "", review_note: "Provider submission needs manual review. No automatic retry was made." }).eq("id", id); } catch { console.warn("run-authorized-demo-call safe error persistence failed", category); }
  }

  let job: RecordLike | null = null;
  let attempt: RecordLike | null = null;
  try {
    const { data: jobs } = await db.from("repair_jobs").select("*").eq("created_by", ownerId).eq("demo_marker", DEMO_MARKER).order("updated_at", { ascending: false }).limit(20);
    job = (jobs as RecordLike[] | null)?.[0] ?? null;
    const { data: attempts } = await db.from("call_attempts").select("*").eq("created_by", ownerId).eq("demo_marker", DEMO_MARKER).order("updated_at", { ascending: false }).limit(20);
    attempt = (attempts as RecordLike[] | null)?.[0] ?? null;
    if (!job && attempt?.repair_job_id && validId(attempt.repair_job_id)) {
      const { data: relatedJob } = await db.from("repair_jobs").select("*").eq("id", attempt.repair_job_id as string).eq("created_by", ownerId).maybeSingle();
      job = relatedJob ?? null;
    }
  } catch { console.error("run-authorized-demo-call owner lookup failed", "private_scope_error"); return jsonResponse({ status: "error", message: "The private demo records could not be checked." }, 403, origin); }

  if (job && job.demo_marker !== DEMO_MARKER) job = null;
  if (attempt && attempt.demo_marker !== DEMO_MARKER) attempt = null;
  if (attempt && job && attempt.repair_job_id !== job.id) return jsonResponse({ status: "blocked", message: "A private demo record needs manual review. No additional call was placed.", repair_job_id: validId(job.id) ? job.id : undefined, call_attempt_id: validId(attempt.id) ? attempt.id : undefined }, 200, origin);
  if (attempt && (!job || !validId(job.id))) return jsonResponse({ status: "blocked", message: "The private demo record is incomplete and needs manual review. No additional call was placed.", call_attempt_id: validId(attempt.id) ? attempt.id : undefined }, 200, origin);

  if (attempt) {
    const ids = { repair_job_id: validId(job?.id) ? job?.id : undefined, call_attempt_id: validId(attempt.id) ? attempt.id : undefined };
    if (hasProviderState(attempt)) return jsonResponse({ status: "already_started", message: "The authorized demo call already has saved provider state. No second submission was made.", ...ids }, 200, origin);
    if (hasText(attempt.safe_error_category)) {
      const category = bounded(attempt.safe_error_category, 32) as SafeErrorCategory;
      const uncertain = category === "network" || category === "unexpected";
      return jsonResponse({ status: uncertain ? "uncertain_submit" : "blocked", message: uncertain ? "The earlier demo submission outcome needs manual review. No retry was made." : "The earlier demo submission needs manual review. No retry was made.", safe_error_category: category, ...ids }, 200, origin);
    }
    if (hasUncertainSubmission(attempt)) return jsonResponse({ status: "uncertain_submit", message: "An earlier demo submission may be in progress or needs manual review. No retry was made.", ...ids }, 200, origin);
    if (hasText(attempt.lifecycle_status) && attempt.lifecycle_status !== "prepared") return jsonResponse({ status: "blocked", message: "An authorized demo record already exists and needs review. No additional call was placed.", ...ids }, 200, origin);
    return jsonResponse({ status: "blocked", message: "An authorized demo record already exists and needs review. No additional call was placed.", ...ids }, 200, origin);
  }
  if (job) return jsonResponse({ status: "blocked", message: "The private demo job exists without a complete call record. No call was placed.", repair_job_id: validId(job.id) ? job.id : undefined }, 200, origin);

  const jobPayload = { created_by: ownerId, demo_marker: DEMO_MARKER, customer_name: "RepairReady authorized demo participant", phone: DEMO_PHONE, appliance_type: "washing_machine", brand: "Unknown", model: "To be confirmed", reported_problem: "Authorized RepairReady demonstration. Participant will describe the washing-machine symptoms in their own words.", symptom_timing: "To be confirmed by the authorized demo participant", error_code: "Not recorded yet", visit_note: "Authorized RepairReady demonstration only. This is not a service booking.", access_notes: "Ask about parking, the route to the appliance, pets, and available workspace. Do not request codes or credentials.", operator_notes: "DEMO: One authorized RepairReady test call. No service commitment, diagnosis, scheduling, repair advice, or payment." };
  try { const { data, error } = await db.from("repair_jobs").insert(jobPayload).select().single(); if (error) throw error; job = data; } catch { console.error("run-authorized-demo-call job creation failed", "private_create_error"); return jsonResponse({ status: "error", message: "The private demo job could not be created. No call was placed." }, 200, origin); }
  const jobId = validId(job.id) ? job.id : "";
  if (!jobId) return jsonResponse({ status: "error", message: "The private demo job was created without a usable identifier. No call was placed." }, 200, origin);

  const now = new Date();
  const expires = new Date(now.getTime() + 15 * 60 * 1000);
  const attemptPayload = { created_by: ownerId, demo_marker: DEMO_MARKER, repair_job_id: jobId, recipient_name: "Authorized demo participant", recipient_phone: DEMO_PHONE, recipient_region: DEMO_REGION, recipient_locale: DEMO_LOCALE, preparation_purpose: DEMO_PURPOSE, question_outline: DEMO_QUESTIONS.join("\n"), request_snapshot: demoSnapshot(), idempotency_key: DEMO_IDEMPOTENCY_KEY, lifecycle_status: "prepared", approval_state: "approved", approved_recipient_phone: DEMO_PHONE, approved_at: now.toISOString(), approval_expires_at: expires.toISOString(), provider_call_id: "", provider_status: "", submitted_at: "", completed_at: "", safe_error_category: "", safe_result_summary: "", review_note: "Created for one authorized RepairReady demonstration. No service booking or customer commitment." };
  try { const { data, error } = await db.from("call_attempts").insert(attemptPayload).select().single(); if (error) throw error; attempt = data; } catch { console.error("run-authorized-demo-call attempt creation failed", "private_create_error"); return jsonResponse({ status: "error", message: "The private demo job was saved, but its call record could not be created. No call was placed.", repair_job_id: jobId }, 200, origin); }
  const attemptId = validId(attempt.id) ? attempt.id : "";
  if (!attemptId) return jsonResponse({ status: "error", message: "The private demo call record was created without a usable identifier. No call was placed.", repair_job_id: jobId }, 200, origin);

  if (job.demo_marker !== DEMO_MARKER || attempt.demo_marker !== DEMO_MARKER || job.phone !== DEMO_PHONE || attempt.repair_job_id !== jobId || attempt.recipient_phone !== DEMO_PHONE || attempt.approved_recipient_phone !== DEMO_PHONE || attempt.recipient_region !== DEMO_REGION || attempt.recipient_locale !== DEMO_LOCALE || attempt.approval_state !== "approved" || attempt.lifecycle_status !== "prepared" || attempt.idempotency_key !== DEMO_IDEMPOTENCY_KEY || Date.parse(String(attempt.approval_expires_at)) <= Date.now() || !CANONICAL_PHONE_RE.test(DEMO_PHONE)) {
    await persistSafeError(attemptId, "validation");
    return jsonResponse({ status: "blocked", message: "The private demo authorization checks did not pass. No provider request was made.", repair_job_id: jobId, call_attempt_id: attemptId, safe_error_category: "validation" }, 200, origin);
  }

  const calleKey = Deno.env.get("CALLE_API_KEY");
  if (!calleKey) { await persistSafeError(attemptId, "unexpected"); return jsonResponse({ status: "error", message: "The provider submission is not configured. No call was placed.", repair_job_id: jobId, call_attempt_id: attemptId, safe_error_category: "unexpected" }, 200, origin); }
  try {
    await db.from("call_attempts").update({ lifecycle_status: "submitting" }).eq("id", attemptId);
  } catch {
    console.error("run-authorized-demo-call submission boundary failed", "no_provider_request");
    return jsonResponse({ status: "error", message: "The private demo submission boundary could not be saved. No call was placed.", repair_job_id: jobId, call_attempt_id: attemptId, safe_error_category: "unexpected" }, 200, origin);
  }
  let providerResponse: Response;
  try { providerResponse = await fetch(PROVIDER_URL, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${calleKey}`, "Idempotency-Key": DEMO_IDEMPOTENCY_KEY }, body: JSON.stringify({ task: buildTask(), recipients: [{ phones: [DEMO_PHONE], region: DEMO_REGION, locale: DEMO_LOCALE }], result_schema: RESULT_SCHEMA, recipient_result_schema: RECIPIENT_RESULT_SCHEMA, metadata: { source: "repairready", workflow: "authorized_demo", demo_marker: DEMO_MARKER, schema_version: "1" }, ...(Deno.env.get("SUPABASE_URL") ? { webhook_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/calle-webhook` } : {}) }) }); } catch { await persistSafeError(attemptId, "network"); return jsonResponse({ status: "uncertain_submit", message: failureMessage("network"), repair_job_id: jobId, call_attempt_id: attemptId, safe_error_category: "network" }, 200, origin); }
  if (providerResponse.status !== 201) { const category = categoryForStatus(providerResponse.status); await persistSafeError(attemptId, category); const uncertain = category === "unexpected"; return jsonResponse({ status: uncertain ? "uncertain_submit" : "error", message: failureMessage(category), repair_job_id: jobId, call_attempt_id: attemptId, safe_error_category: category }, 200, origin); }

  let providerBody: unknown = null;
  try { providerBody = await providerResponse.json(); } catch { providerBody = null; }
  const remoteId = providerId((providerBody as RecordLike | null)?.id);
  if (!remoteId) { await persistSafeError(attemptId, "unexpected"); return jsonResponse({ status: "uncertain_submit", message: "The provider accepted a response without a usable call identifier. Review the private demo record and do not retry.", repair_job_id: jobId, call_attempt_id: attemptId, safe_error_category: "unexpected" }, 200, origin); }
  try { await db.from("call_attempts").update({ provider_call_id: remoteId, provider_status: "queued", lifecycle_status: "queued", submitted_at: new Date().toISOString(), safe_error_category: "", safe_result_summary: "" }).eq("id", attemptId); } catch { console.error("run-authorized-demo-call accepted state persistence failed", "uncertain_submit"); return jsonResponse({ status: "uncertain_submit", message: "The provider may have accepted the demo request, but its private status could not be saved. Review the record and do not retry.", repair_job_id: jobId, call_attempt_id: attemptId, safe_error_category: "unexpected" }, 200, origin); }
  return jsonResponse({ status: "submitted", message: "The authorized RepairReady demo call was accepted and is queued. Refresh its status manually when you are ready to review the result.", repair_job_id: jobId, call_attempt_id: attemptId }, 200, origin);
});
