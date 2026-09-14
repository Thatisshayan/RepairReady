import { corsHeaders, isAllowedOrigin } from "./_shared/cors.ts";
import { ownerIdFromRequest, serviceClient } from "./_shared/auth.ts";
import {
  bounded, validId, providerId, providerStatus, safeValue, safeArray, safeFollowUps,
  objectValue, hasOwn, unknownValue, categoryForStatus, failureMessage, completionStatus,
  safeCompletedAt, structuredResult, recipientResult, consentState, evidenceItem, callEvidence,
  callBlockers, safeSummary, parseStored, priorCallEvidence, mergeEvidence, priorCallBlockers,
  priorCallFollowUps, normalizeReview, callTranscript,
  type ProviderStatus, type SafeErrorCategory, type RecordLike,
} from "./logic.ts";

const PROVIDER_URL = "https://api.heycall-e.com/v1/calls";
type StatusResponse = {
  status: "status" | "status_uncertain" | "error";
  message: string;
  repair_job_id?: string;
  call_attempt_id?: string;
  provider_status?: ProviderStatus;
  safe_result_summary?: string | null;
  safe_error_category?: SafeErrorCategory;
};

function jsonResponse(body: StatusResponse, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), "Cache-Control": "no-store", "Content-Type": "application/json" } });
}

async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("Origin");
  // SECURITY: Reject requests from a missing or non-allowlisted Origin.
  if (!isAllowedOrigin(origin)) {
    return jsonResponse({ status: "error", message: "Origin header is required for security." }, 403, null);
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ status: "error", message: "Use the signed-in workspace for a private status check." }, 405, origin);

  const ownerId = await ownerIdFromRequest(req);
  if (!ownerId) return jsonResponse({ status: "error", message: "Your session could not be verified. Sign in again and retry." }, 401, origin);
  const db = serviceClient();

  let input: RecordLike = {};
  try { const body = await req.json(); input = body && typeof body === "object" && !Array.isArray(body) ? body as RecordLike : {}; } catch { return jsonResponse({ status: "error", message: "The private status request could not be read." }, 400, origin); }
  if (Object.keys(input).length !== 1 || !validId(input.call_attempt_id)) return jsonResponse({ status: "error", message: "Select the approved private demo record before checking status." }, 400, origin);
  const attemptId = input.call_attempt_id as string;

  async function persistSafeError(category: SafeErrorCategory): Promise<void> {
    try { await db.from("call_attempts").update({ safe_error_category: category }).eq("id", attemptId); } catch { console.warn("get-calle-call-status safe error persistence failed", category); }
  }

  let attempt: RecordLike | null = null;
  let job: RecordLike | null = null;
  try {
    const { data: attemptRow } = await db.from("call_attempts").select("*").eq("id", attemptId).eq("created_by", ownerId).maybeSingle();
    attempt = attemptRow ?? null;
    if (!attempt || !validId(attempt.repair_job_id)) return jsonResponse({ status: "error", message: "That private record is not available." }, 404, origin);
    const { data: jobRow } = await db.from("repair_jobs").select("*").eq("id", attempt.repair_job_id as string).eq("created_by", ownerId).maybeSingle();
    job = jobRow ?? null;
  } catch { return jsonResponse({ status: "error", message: "The private record could not be checked." }, 403, origin); }

  // Any owner-approved attempt qualifies here, not only the fixed demo — approval_state is the
  // real gate, and it's only ever set by run-authorized-demo-call or approve-calle-call.
  if (!attempt || !job || attempt.repair_job_id !== job.id || attempt.approval_state !== "approved") {
    return jsonResponse({ status: "error", message: "This status action is limited to an approved, owner-created call record." }, 403, origin);
  }
  const remoteId = providerId(attempt.provider_call_id);
  if (!remoteId) return jsonResponse({ status: "error", message: "No saved provider call identifier exists for this record." }, 422, origin);
  const calleKey = Deno.env.get("CALLE_API_KEY");
  if (!calleKey) return jsonResponse({ status: "error", message: "The provider status lookup is not configured. No request was made.", safe_error_category: "unexpected" }, 503, origin);
  let providerResponse: Response;
  try { providerResponse = await fetch(`${PROVIDER_URL}/${encodeURIComponent(remoteId)}`, { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${calleKey}` } }); } catch { await persistSafeError("network"); return jsonResponse({ status: "status_uncertain", message: failureMessage("network"), call_attempt_id: attemptId, repair_job_id: String(job.id), safe_error_category: "network" }, 502, origin); }
  if (!providerResponse.ok) { const category = categoryForStatus(providerResponse.status); await persistSafeError(category); return jsonResponse({ status: "error", message: failureMessage(category), call_attempt_id: attemptId, repair_job_id: String(job.id), safe_error_category: category }, 502, origin); }
  let providerBody: unknown = null;
  try { providerBody = await providerResponse.json(); } catch { providerBody = null; }
  const body = objectValue(providerBody);
  const status = providerStatus(body?.status);
  if (!body || !status) { await persistSafeError("unexpected"); return jsonResponse({ status: "status_uncertain", message: failureMessage("unexpected"), call_attempt_id: attemptId, repair_job_id: String(job.id), safe_error_category: "unexpected" }, 502, origin); }
  const result = structuredResult(body);
  const recipient = recipientResult(body, result);
  const consent = consentState(recipient);
  const incomingEvidence = callEvidence(result, consent);
  const incomingBlockers = callBlockers(result);
  const followUpsReported = Boolean(result && hasOwn(result, "missing_details") && Array.isArray(result.missing_details));
  const incomingFollowUps = followUpsReported ? safeFollowUps(result?.missing_details) : [];
  const summary = safeSummary(body, status, result, consent, incomingBlockers, incomingFollowUps);
  const completedAt = safeCompletedAt(body, status);
  const update: RecordLike = { provider_status: status, lifecycle_status: status, safe_error_category: "", safe_result_summary: summary };
  if (completedAt) update.completed_at = completedAt;
  try { await db.from("call_attempts").update(update).eq("id", attemptId); } catch { return jsonResponse({ status: "status_uncertain", message: "CALL-E returned a status, but the private status could not be saved. Review the record manually.", call_attempt_id: attemptId, repair_job_id: String(job.id), safe_error_category: "unexpected" }, 502, origin); }
  let briefUpdated = true;
  if (result) {
    try {
      const { data: rows } = await db.from("repair_briefs").select("*").eq("repair_job_id", String(job.id)).eq("created_by", ownerId);
      const existing = ((rows ?? []) as RecordLike[]).find((row) => row?.call_attempt_id === attemptId) ?? null;
      const evidence = mergeEvidence(priorCallEvidence(existing?.evidence_json), incomingEvidence);
      const blockers = incomingBlockers.length ? incomingBlockers : priorCallBlockers(existing?.blockers_json);
      const followUps = followUpsReported ? incomingFollowUps : priorCallFollowUps(existing?.follow_up_json);
      const transcript = callTranscript(body);
      const payload = { repair_job_id: String(job.id), call_attempt_id: attemptId, call_completion_status: completionStatus(status), readiness_status: "unknown", human_review_state: normalizeReview(existing?.human_review_state), human_review_note: safeValue(existing?.human_review_note, 600), reviewed_at: bounded(existing?.reviewed_at, 80), evidence_json: JSON.stringify(evidence).slice(0, 14000), blockers_json: JSON.stringify(blockers).slice(0, 7000), follow_up_json: JSON.stringify(followUps).slice(0, 4000), safe_summary: summary.slice(0, 7000), transcript_json: transcript.length ? JSON.stringify(transcript).slice(0, 20000) : bounded(existing?.transcript_json, 20000) };
      if (existing?.id) await db.from("repair_briefs").update(payload).eq("id", String(existing.id));
      else await db.from("repair_briefs").insert({ ...payload, created_by: ownerId });
    } catch { briefUpdated = false; }
  }
  if (!briefUpdated) return jsonResponse({ status: "status_uncertain", message: "CALL-E returned a status, but the technician evidence could not be saved privately. Review the record manually.", provider_status: status, safe_result_summary: summary || null, call_attempt_id: attemptId, repair_job_id: String(job.id), safe_error_category: "unexpected" }, 502, origin);
  return jsonResponse({ status: "status", message: "The approved private demo status was refreshed from CALL-E.", provider_status: status, safe_result_summary: summary || null, call_attempt_id: attemptId, repair_job_id: String(job.id) }, 200, origin);
}

if (import.meta.main) {
  Deno.serve(handler);
}
