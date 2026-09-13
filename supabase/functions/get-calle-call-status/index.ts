import { corsHeaders, isAllowedOrigin } from "./_shared/cors.ts";
import { ownerIdFromRequest, serviceClient } from "./_shared/auth.ts";

const PROVIDER_URL = "https://api.heycall-e.com/v1/calls";
const PROVIDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const REMOTE_STATUSES = ["queued", "in_progress", "completed", "failed", "canceled", "no_answer", "declined", "voicemail", "busy", "expired"] as const;
type ProviderStatus = (typeof REMOTE_STATUSES)[number];
type SafeErrorCategory = "provider_auth" | "validation" | "rate_or_credit" | "network" | "unexpected";
type RecordLike = Record<string, unknown>;
type StatusResponse = {
  status: "status" | "status_uncertain" | "error";
  message: string;
  repair_job_id?: string;
  call_attempt_id?: string;
  provider_status?: ProviderStatus;
  safe_result_summary?: string | null;
  safe_error_category?: SafeErrorCategory;
};

const LABELS = {
  appliance_identity: "Appliance brand and model",
  symptoms: "Symptoms in the customer's own words",
  timing: "When the symptom occurs",
  error_code: "Error code or explicit none",
  visit_logistics: "Access, parking, pets, and workspace",
} as const;
type EvidenceKey = keyof typeof LABELS;
const EVIDENCE_KEYS = Object.keys(LABELS) as EvidenceKey[];
const SENSITIVE_RE = /(?:alarm|security|entry|access|gate|building|lock)\s*(?:code|pin|password|passcode)|password|credential/i;
const PHONE_RE = /(?:\+\d[\d\s().-]{6,}|\b\d(?:[\d\s().-]*\d){6,}\b)/g;
const FOLLOW_UP_LIMIT = 8;
const FOLLOW_UP_MAX = 180;

function jsonResponse(body: StatusResponse, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), "Cache-Control": "no-store", "Content-Type": "application/json" } });
}
function bounded(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, max) : ""; // eslint-disable-line no-control-regex
}
function validId(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 160; }
function providerId(value: unknown): string { const id = bounded(value, 160); return PROVIDER_ID_RE.test(id) ? id : ""; }
function providerStatus(value: unknown): ProviderStatus | null {
  if (typeof value !== "string") return null;
  // Defensive normalization: this repo has only ever observed lowercase snake_case statuses
  // ("queued", "completed", ...) from the live API, but CALL-E's own docs list some terminal
  // outcomes in uppercase with a "cancelled" (double L) spelling — normalize rather than assume.
  const normalized = value.trim().toLowerCase().replace(/^cancelled$/, "canceled");
  return (REMOTE_STATUSES as readonly string[]).includes(normalized) ? (normalized as ProviderStatus) : null;
}
function safeValue(value: unknown, max = 420): string {
  const text = bounded(value, max);
  if (!text || SENSITIVE_RE.test(text)) return "";
  return text.replace(PHONE_RE, "[phone omitted]").slice(0, max);
}
function safeArray(value: unknown): string[] {
  return Array.isArray(value) ? value.slice(0, 8).map((item) => safeValue(item, 180)).filter(Boolean) : [];
}
function safeFollowUps(value: unknown): RecordLike[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, FOLLOW_UP_LIMIT).map((item) => safeValue(item, FOLLOW_UP_MAX)).filter(Boolean).map((item) => ({ value: item, source: "call_reported" }));
}
function objectValue(value: unknown): RecordLike | null { return value && typeof value === "object" && !Array.isArray(value) ? value as RecordLike : null; }
function hasOwn(value: RecordLike, key: string): boolean { return Object.prototype.hasOwnProperty.call(value, key); }
function unknownValue(value: string): boolean { return /^(unknown|unclear|uncertain|not recorded|not provided|n\/a|none given)$/i.test(value.trim()); }
function categoryForStatus(status: number): SafeErrorCategory {
  if (status === 401 || status === 403) return "provider_auth";
  if (status === 400 || status === 422) return "validation";
  if (status === 402 || status === 429) return "rate_or_credit";
  return "unexpected";
}
function failureMessage(category: SafeErrorCategory): string {
  if (category === "provider_auth") return "CALL-E did not accept the saved provider authorization. No private status was changed.";
  if (category === "validation") return "CALL-E rejected the status request. No private status was changed.";
  if (category === "rate_or_credit") return "CALL-E could not return status because of a rate or account limit. No private status was changed.";
  if (category === "network") return "The provider status could not be confirmed. No private status was changed.";
  return "CALL-E returned an unexpected status response. No private status was changed.";
}
function completionStatus(status: ProviderStatus): string {
  return status === "queued" || status === "in_progress" ? "in_progress" : status;
}
function safeCompletedAt(body: RecordLike, status: ProviderStatus): string | null {
  if (!["completed", "failed", "canceled", "no_answer", "declined", "voicemail", "busy", "expired"].includes(status)) return null;
  const raw = bounded(body.completed_at, 80);
  const parsed = Date.parse(raw);
  return raw && !Number.isNaN(parsed) ? new Date(parsed).toISOString() : null;
}
function structuredResult(body: RecordLike): RecordLike | null {
  const direct = objectValue(body.structured_result);
  if (direct) return direct;
  const recipients = Array.isArray(body.recipients) ? body.recipients : [];
  for (const recipient of recipients) {
    const result = objectValue(objectValue(recipient)?.structured_result);
    if (result) return result;
  }
  return null;
}
function recipientResult(body: RecordLike, main: RecordLike | null): RecordLike | null {
  const direct = objectValue(body.recipient_result) ?? objectValue(body.recipient_structured_result);
  if (direct) return direct;
  const recipients = Array.isArray(body.recipients) ? body.recipients : [];
  for (const recipient of recipients) {
    const result = objectValue(objectValue(recipient)?.structured_result);
    if (result && (hasOwn(result, "preparation_consent") || hasOwn(result, "recipient_identity"))) return result;
  }
  return main && (hasOwn(main, "preparation_consent") || hasOwn(main, "recipient_identity")) ? main : null;
}
function consentState(result: RecordLike | null): "confirmed" | "uncertain" | "not_confirmed" {
  const raw = result?.preparation_consent;
  return raw === "confirmed" || raw === "not_confirmed" || raw === "uncertain" ? raw : "uncertain";
}
function evidenceItem(key: EvidenceKey, value: unknown, present: boolean, consent: string): RecordLike | null {
  if (!present) return null;
  const text = safeValue(value);
  const status = text && !unknownValue(text) ? consent === "confirmed" ? "confirmed" : "uncertain" : "missing";
  return { key, label: LABELS[key], status, source: "call_reported", value: text && !unknownValue(text) ? text : null, supporting_excerpt: null };
}
function callEvidence(result: RecordLike | null, consent: string): RecordLike[] {
  if (!result) return [];
  const brand = safeValue(result.appliance_brand, 120);
  const model = safeValue(result.appliance_model, 160);
  const access = safeArray(result.access_constraints).join("; ");
  const values: Record<EvidenceKey, { value: unknown; present: boolean }> = {
    appliance_identity: { value: [brand, model].filter(Boolean).join(" · "), present: hasOwn(result, "appliance_brand") || hasOwn(result, "appliance_model") },
    symptoms: { value: result.reported_symptoms, present: hasOwn(result, "reported_symptoms") },
    timing: { value: result.symptom_timing, present: hasOwn(result, "symptom_timing") },
    error_code: { value: result.error_code, present: hasOwn(result, "error_code") },
    visit_logistics: { value: access, present: hasOwn(result, "access_constraints") },
  };
  return EVIDENCE_KEYS.flatMap((key) => { const item = evidenceItem(key, values[key].value, values[key].present, consent); return item ? [item] : []; });
}
function callBlockers(result: RecordLike | null): RecordLike[] {
  return safeArray(result?.visit_blockers).map((value) => ({ value, source: "call_reported", supporting_excerpt: null }));
}
function safeSummary(body: RecordLike, status: ProviderStatus, result: RecordLike | null, consent: string, blockers: RecordLike[], followUps: RecordLike[]): string {
  const parts: string[] = [`Provider status: ${status}.`];
  if (result) parts.push(`Structured preparation fields received: ${callEvidence(result, consent).length} of ${EVIDENCE_KEYS.length}.`);
  else parts.push("No structured preparation result was returned.");
  if (consent === "confirmed") parts.push("Participant consent was reported as confirmed.");
  else if (consent === "not_confirmed") parts.push("Participant consent was reported as not confirmed.");
  else parts.push("Participant consent was not confirmed in the structured result.");
  if (blockers.length) parts.push(`Explicit visit blockers reported: ${blockers.length}.`);
  if (result && Array.isArray(result.missing_details)) {
    const items = followUps.map((item) => safeValue(item.value, FOLLOW_UP_MAX)).filter(Boolean).slice(0, 4);
    parts.push(items.length ? `Follow-up details reported: ${followUps.length}. Items: ${items.join("; ")}.` : `Follow-up details reported: ${followUps.length}.`);
  }
  const confidence = objectValue(body.completion_confidence);
  const label = safeValue(confidence?.label, 24);
  if (["high", "medium", "low", "unknown"].includes(label)) parts.push(`Completion confidence: ${label}.`);
  if (status === "failed") parts.push("The provider marked the call failed; no cause was inferred locally.");
  if (status === "canceled") parts.push("The provider marked the call canceled.");
  return parts.join(" ").slice(0, 900);
}
function parseStored(value: unknown, max: number): unknown[] {
  const raw = bounded(value, max);
  if (!raw) return [];
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
function priorCallEvidence(raw: unknown): RecordLike[] {
  return parseStored(raw, 14000).flatMap((item) => {
    const row = objectValue(item);
    const key = row?.key;
    if (row?.source !== "call_reported" || typeof key !== "string" || !EVIDENCE_KEYS.includes(key as EvidenceKey)) return [];
    const value = safeValue(row.value);
    const status = ["confirmed", "missing", "uncertain", "unverified"].includes(String(row.status))
      ? String(row.status)
      : value ? "uncertain" : "missing";
    return [{ key, label: LABELS[key as EvidenceKey], status, source: "call_reported", value: value || null, supporting_excerpt: safeValue(row.supporting_excerpt, 280) || null }];
  }).slice(0, 5) as RecordLike[];
}
function mergeEvidence(previous: RecordLike[], incoming: RecordLike[]): RecordLike[] {
  const map = new Map<string, RecordLike>();
  for (const item of previous) { const key = bounded(item.key, 40); if (EVIDENCE_KEYS.includes(key as EvidenceKey)) map.set(key, item); }
  for (const item of incoming) { const key = bounded(item.key, 40); if (EVIDENCE_KEYS.includes(key as EvidenceKey)) map.set(key, item); }
  return EVIDENCE_KEYS.flatMap((key) => map.has(key) ? [map.get(key)!] : []);
}
function priorCallBlockers(raw: unknown): RecordLike[] {
  return parseStored(raw, 7000).flatMap((item) => {
    const row = objectValue(item);
    const value = safeValue(row?.value);
    return row?.source === "call_reported" && value ? [{ value, source: "call_reported", supporting_excerpt: safeValue(row.supporting_excerpt, 280) || null }] : [];
  }).slice(0, 8) as RecordLike[];
}
function priorCallFollowUps(raw: unknown): RecordLike[] {
  return parseStored(raw, 4000).flatMap((item) => {
    const row = objectValue(item);
    const value = safeValue(row?.value, FOLLOW_UP_MAX);
    return row?.source === "call_reported" && value ? [{ value, source: "call_reported" }] : [];
  }).slice(0, FOLLOW_UP_LIMIT) as RecordLike[];
}
function normalizeReview(value: unknown): string { return ["not_reviewed", "reviewed", "needs_follow_up"].includes(String(value)) ? String(value) : "not_reviewed"; }

Deno.serve(async (req) => {
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
      const payload = { repair_job_id: String(job.id), call_attempt_id: attemptId, call_completion_status: completionStatus(status), readiness_status: "unknown", human_review_state: normalizeReview(existing?.human_review_state), human_review_note: safeValue(existing?.human_review_note, 600), reviewed_at: bounded(existing?.reviewed_at, 80), evidence_json: JSON.stringify(evidence).slice(0, 14000), blockers_json: JSON.stringify(blockers).slice(0, 7000), follow_up_json: JSON.stringify(followUps).slice(0, 4000), safe_summary: summary.slice(0, 7000) };
      if (existing?.id) await db.from("repair_briefs").update(payload).eq("id", String(existing.id));
      else await db.from("repair_briefs").insert({ ...payload, created_by: ownerId });
    } catch { briefUpdated = false; }
  }
  if (!briefUpdated) return jsonResponse({ status: "status_uncertain", message: "CALL-E returned a status, but the technician evidence could not be saved privately. Review the record manually.", provider_status: status, safe_result_summary: summary || null, call_attempt_id: attemptId, repair_job_id: String(job.id), safe_error_category: "unexpected" }, 502, origin);
  return jsonResponse({ status: "status", message: "The approved private demo status was refreshed from CALL-E.", provider_status: status, safe_result_summary: summary || null, call_attempt_id: attemptId, repair_job_id: String(job.id) }, 200, origin);
});
