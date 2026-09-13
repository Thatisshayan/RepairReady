import { corsHeaders, isAllowedOrigin } from "./_shared/cors.ts";
import { ownerIdFromRequest, serviceClient } from "./_shared/auth.ts";

// Enabled now that approve-calle-call exists to write the approval fields this function checks
// for (approval_state, approved_recipient_phone, approved_at, approval_expires_at, region,
// locale). Every check below still runs — this only removes the unconditional early return.
const DISPATCH_ENABLED = true;
const PROVIDER_URL = "https://api.heycall-e.com/v1/calls";
const CANONICAL_PHONE_RE = /^\+[1-9]\d{6,14}$/;
const PROVIDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const REGION_RE = /^[A-Za-z]{2}$/;
const LOCALE_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;

type SafeErrorCategory = "provider_auth" | "validation" | "rate_or_credit" | "network" | "unexpected";
type DispatchResponse = {
  status: "dispatch_locked" | "submitted" | "uncertain_submit" | "error";
  message: string;
  safe_error_category?: SafeErrorCategory;
};
type Snapshot = Record<string, unknown>;

const RESULT_SCHEMA = {
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

const RECIPIENT_RESULT_SCHEMA = {
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

const PREPARATION_TASK = [
  "Conduct a brief pre-visit preparation call for an appliance repair coordinator.",
  "Collect only factual preparation details: the exact appliance brand and model, reported symptoms and when they occur, any displayed error code, parking, access, pets, workspace constraints, and anything that could block the visit.",
  "Do not diagnose, recommend repairs, sell, schedule, promise an outcome, or request alarm codes, entry codes, passwords, or other credentials.",
  "Mark unknown details as unknown and keep answers concise.",
].join(" ");

function jsonResponse(body: DispatchResponse, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Cache-Control": "no-store", "Content-Type": "application/json" },
  });
}

function locked(message: string, origin: string | null, status = 423): Response {
  return jsonResponse({ status: "dispatch_locked", message }, status, origin);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 160;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function bounded(value: unknown, max: number): string {
  return typeof value === "string"
  // eslint-disable-next-line no-control-regex -- deliberately stripping control characters from untrusted text before storage/display.
    ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, max)
    : "";
}

function parseSnapshot(value: unknown): Snapshot | null {
  const raw = bounded(value, 8000);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Snapshot) : null;
  } catch {
    return null;
  }
}

function providerId(value: unknown): string {
  const id = bounded(value, 160);
  return PROVIDER_ID_RE.test(id) ? id : "";
}

function categoryForStatus(status: number): SafeErrorCategory {
  if (status === 401 || status === 403) return "provider_auth";
  if (status === 400 || status === 422) return "validation";
  if (status === 402 || status === 429) return "rate_or_credit";
  return "unexpected";
}

function failureMessage(category: SafeErrorCategory): string {
  if (category === "provider_auth") return "CALL-E did not accept the saved provider authorization. No call status was created.";
  if (category === "validation") return "CALL-E rejected the prepared request. Review the saved preparation details before any future action.";
  if (category === "rate_or_credit") return "CALL-E could not accept the request because of a rate or account-credit limit. Review the provider account before any future action.";
  if (category === "network") return "The provider request outcome could not be confirmed. Do not retry automatically; review the private draft first.";
  return "CALL-E returned an unexpected provider response. Do not retry automatically; review the private draft first.";
}

function snapshotValue(snapshot: Snapshot, key: string, max: number): string {
  return bounded(snapshot[key], max) || "Not recorded";
}

function buildTask(snapshot: Snapshot): string {
  return `${PREPARATION_TASK}\n\nSaved job context:\n- Appliance: ${snapshotValue(snapshot, "appliance", 80)}\n- Brand: ${snapshotValue(snapshot, "brand", 80)}\n- Model: ${snapshotValue(snapshot, "model", 100)}\n- Reported problem: ${snapshotValue(snapshot, "reported_problem", 500)}\n- Symptom timing: ${snapshotValue(snapshot, "symptom_timing", 220)}\n- Error code: ${snapshotValue(snapshot, "error_code", 50)}\n- Visit note: ${snapshotValue(snapshot, "visit_note", 420)}\n- Access notes were entered: ${snapshot.access_notes_present === true ? "yes" : "no"}`.slice(0, 3000);
}

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
    task: buildTask(snapshot),
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
