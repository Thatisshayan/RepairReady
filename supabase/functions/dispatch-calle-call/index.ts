import { corsHeaders, isAllowedOrigin } from "./_shared/cors.ts";
import { ownerIdFromRequest, serviceClient } from "./_shared/auth.ts";
import {
  RECIPIENT_RESULT_SCHEMA,
  RESULT_SCHEMA,
  bounded,
  buildTask,
  categoryForStatus,
  failureMessage,
  hasText,
  parseSnapshot,
  providerId,
  validId,
  type DispatchResponse,
  type SafeErrorCategory,
} from "./logic.ts";

// Enabled now that approve-calle-call exists to write the approval fields this function checks
// for (approval_state, approved_recipient_phone, approved_at, approval_expires_at, region,
// locale). Every check below still runs — this only removes the unconditional early return.
const DISPATCH_ENABLED = true;
const PROVIDER_URL = "https://api.heycall-e.com/v1/calls";
const CANONICAL_PHONE_RE = /^\+[1-9]\d{6,14}$/;
const REGION_RE = /^[A-Za-z]{2}$/;
const LOCALE_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;

function jsonResponse(body: DispatchResponse, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Cache-Control": "no-store", "Content-Type": "application/json" },
  });
}

function locked(message: string, origin: string | null, status = 423): Response {
  return jsonResponse({ status: "dispatch_locked", message }, status, origin);
}

if (import.meta.main) {
Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  // SECURITY: Reject requests from a missing or non-allowlisted Origin.
  if (!isAllowedOrigin(origin)) {
    return jsonResponse({ status: "error", message: "Origin header is required for security." }, 403, null);
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") {
    return jsonResponse({ status: "error", message: "Use the signed-in workspace to review this action." }, 405, origin);
  }

  const ownerId = await ownerIdFromRequest(req);
  if (!ownerId) {
    console.warn("dispatch-calle-call rejected request", "unauthenticated");
    return jsonResponse({ status: "error", message: "Your session could not be verified. Sign in again and retry." }, 401, origin);
  }
  const db = serviceClient();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ status: "error", message: "The preparation request could not be read." }, 400, origin);
  }
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const repairJobId = input.repair_job_id;
  const callAttemptId = input.call_attempt_id;
  if (!validId(repairJobId) || !validId(callAttemptId)) {
    return jsonResponse({ status: "error", message: "Select a repair job and its private preparation draft." }, 400, origin);
  }

  let job: Record<string, unknown> | null = null;
  let attempt: Record<string, unknown> | null = null;
  try {
    const { data: jobRow } = await db.from("repair_jobs").select("*").eq("id", repairJobId).eq("created_by", ownerId).maybeSingle();
    if (!jobRow) {
      return jsonResponse({ status: "error", message: "That job or preparation draft is not available." }, 404, origin);
    }
    const { data: attemptRow } = await db.from("call_attempts").select("*").eq("id", callAttemptId).eq("created_by", ownerId).maybeSingle();
    if (!attemptRow) {
      return jsonResponse({ status: "error", message: "That job or preparation draft is not available." }, 404, origin);
    }
    job = jobRow;
    attempt = attemptRow;
  } catch {
    console.error("dispatch-calle-call owner lookup failed", "private_scope_error");
    return jsonResponse({ status: "error", message: "The private preparation records could not be checked." }, 403, origin);
  }

  if (!job || !attempt || attempt.repair_job_id !== job.id) {
    return jsonResponse({ status: "error", message: "That preparation draft does not belong to the selected job." }, 403, origin);
  }

  async function persistSafeError(category: SafeErrorCategory): Promise<void> {
    try {
      await db.from("call_attempts").update({ safe_error_category: category, safe_result_summary: "" }).eq("id", callAttemptId as string);
    } catch {
      console.warn("dispatch-calle-call safe error persistence failed", category);
    }
  }

  const recipientPhone = bounded(attempt.recipient_phone, 32);
  const savedJobPhone = bounded(job.phone, 32);
  const approvedPhone = bounded(attempt.approved_recipient_phone, 32);
  if (!hasText(attempt.recipient_name) || !CANONICAL_PHONE_RE.test(recipientPhone) || recipientPhone !== savedJobPhone) {
    return locked("The saved recipient details need review before any future provider submission. No provider request was made.", origin, 422);
  }
  if (attempt.lifecycle_status !== "prepared") {
    return locked("This preparation draft is not ready for review. No provider request was made.", origin, 409);
  }
  if (attempt.approval_state !== "approved") {
    return locked("Explicit approval for a specific test call is still required. No provider request was made.", origin);
  }
  if (!CANONICAL_PHONE_RE.test(approvedPhone) || approvedPhone !== recipientPhone) {
    return locked("The approved recipient does not exactly match the saved recipient. No provider request was made.", origin, 422);
  }
  const approvedAt = bounded(attempt.approved_at, 80);
  const approvalExpiresAt = bounded(attempt.approval_expires_at, 80);
  if (!approvedAt || Number.isNaN(Date.parse(approvedAt)) || !approvalExpiresAt || Number.isNaN(Date.parse(approvalExpiresAt)) || Date.parse(approvalExpiresAt) <= Date.now()) {
    return locked("The explicit approval is missing or expired. No provider request was made.", origin, 422);
  }
  if (hasText(attempt.provider_call_id) || hasText(attempt.provider_status) || hasText(attempt.submitted_at) || hasText(attempt.completed_at)) {
    return locked("Reserved provider state needs review before any future submission. No provider request was made.", origin, 409);
  }
  if (hasText(attempt.safe_error_category) || hasText(attempt.safe_result_summary)) {
    return locked("This preparation record has a saved provider review state. Do not retry it automatically.", origin, 409);
  }

  const region = bounded(attempt.recipient_region, 12);
  const locale = bounded(attempt.recipient_locale, 24);
  if (!REGION_RE.test(region) || !LOCALE_RE.test(locale)) {
    return locked("A saved recipient region and locale are required. No region or locale was guessed.", origin, 422);
  }
  const idempotencyKey = bounded(attempt.idempotency_key, 255);
  if (!/^[\x20-\x7E]{1,255}$/.test(idempotencyKey)) {
    return locked("This preparation draft has no valid durable request key. No provider request was made.", origin, 422);
  }
  const snapshot = parseSnapshot(attempt.request_snapshot);
  if (!snapshot) return locked("The saved preparation snapshot needs review. No provider request was made.", origin, 422);

  // Keep this branch before any provider request or submission-implying write.
  if (!DISPATCH_ENABLED) {
    return locked("Provider submission locked. Saving a preparation draft does not contact anyone.", origin);
  }

  const calleKey = Deno.env.get("CALLE_API_KEY");
  if (!calleKey) {
    console.error("dispatch-calle-call configuration error", "missing_provider_key");
    return jsonResponse({ status: "error", message: "The provider submission is not configured. No call was placed.", safe_error_category: "unexpected" }, 503, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const payload = {
    task: buildTask(snapshot, bounded(attempt.recipient_name, 80)),
    recipients: [{ phones: [recipientPhone], region, locale }],
    result_schema: RESULT_SCHEMA,
    recipient_result_schema: RECIPIENT_RESULT_SCHEMA,
    metadata: { source: "repairready", workflow: "pre_visit_preparation", schema_version: "1" },
    // Lets CALL-E push a status change the moment it happens instead of only being caught by the
    // next poll. The receiver never trusts this event's body -- see calle-webhook/index.ts -- so
    // this is purely a latency optimization, not a new trust boundary.
    ...(supabaseUrl ? { webhook_url: `${supabaseUrl}/functions/v1/calle-webhook` } : {}),
  };

  let providerResponse: Response;
  try {
    providerResponse = await fetch(PROVIDER_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${calleKey}`, "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload),
    });
  } catch {
    console.error("dispatch-calle-call provider request", "network");
    await persistSafeError("network");
    return jsonResponse({ status: "uncertain_submit", message: failureMessage("network"), safe_error_category: "network" }, 502, origin);
  }

  if (providerResponse.status !== 201) {
    const category = categoryForStatus(providerResponse.status);
    console.warn("dispatch-calle-call provider response", providerResponse.status, category);
    await persistSafeError(category);
    return jsonResponse({ status: "error", message: failureMessage(category), safe_error_category: category }, 502, origin);
  }

  let providerBody: unknown = null;
  try {
    providerBody = await providerResponse.json();
  } catch {
    providerBody = null;
  }
  const remoteId = providerId((providerBody as Record<string, unknown> | null)?.id);
  if (!remoteId) {
    console.error("dispatch-calle-call provider response", "201_missing_provider_id");
    await persistSafeError("unexpected");
    return jsonResponse({ status: "uncertain_submit", message: "CALL-E accepted the request response, but no provider call identifier was returned. Do not retry automatically; review the private draft.", safe_error_category: "unexpected" }, 502, origin);
  }

  try {
    await db.from("call_attempts").update({
      provider_call_id: remoteId,
      provider_status: "queued",
      lifecycle_status: "queued",
      submitted_at: new Date().toISOString(),
      safe_error_category: "",
      safe_result_summary: "",
    }).eq("id", callAttemptId as string);
  } catch {
    console.error("dispatch-calle-call accepted state persistence failed", "uncertain_submit");
    return jsonResponse({ status: "uncertain_submit", message: "CALL-E may have accepted the request, but the private status could not be saved. Do not retry automatically; review the private draft.", safe_error_category: "unexpected" }, 502, origin);
  }

  return jsonResponse({ status: "submitted", message: "CALL-E accepted the preparation request and the private attempt is queued. No automatic status refresh is active." }, 200, origin);
});
}
