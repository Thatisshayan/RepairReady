import { corsHeaders, isAllowedOrigin } from "./_shared/cors.ts";
import { ownerIdFromRequest, serviceClient } from "./_shared/auth.ts";
import {
  DEMO_ACTION,
  DEMO_IDEMPOTENCY_KEY,
  DEMO_LOCALE,
  DEMO_MARKER,
  DEMO_PHONE,
  DEMO_PURPOSE,
  DEMO_QUESTIONS,
  DEMO_REGION,
  RECIPIENT_RESULT_SCHEMA,
  RESULT_SCHEMA,
  bounded,
  buildTask,
  categoryForStatus,
  demoSnapshot,
  failureMessage,
  hasProviderState,
  hasText,
  hasUncertainSubmission,
  providerId,
  validId,
  type DemoResponse,
  type RecordLike,
  type SafeErrorCategory,
} from "./logic.ts";

const PROVIDER_URL = "https://api.heycall-e.com/v1/calls";
const CANONICAL_PHONE_RE = /^\+[1-9]\d{6,14}$/;

function jsonResponse(body: DemoResponse, status: number, origin: string | null): Response { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), "Cache-Control": "no-store", "Content-Type": "application/json" } }); }

if (import.meta.main) {
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
}
