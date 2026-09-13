import { CallAttempt } from "@/entities";
import { adaptiveQuestionsForJob, targetedFollowUpQuestions, type RepairBriefView } from "@/lib/repair-briefs";
import { applianceLabel, type RepairJobRecord } from "@/lib/repair-jobs";

export const AUTHORIZED_DEMO_MARKER = "repairready_authorized_demo" as const;
export const REMOTE_CALL_STATUSES = [
  "queued",
  "in_progress",
  "completed",
  "failed",
  "canceled",
  "no_answer",
  "declined",
  "voicemail",
  "busy",
  "expired",
] as const;

export type RemoteCallStatus = (typeof REMOTE_CALL_STATUSES)[number];
const NON_TERMINAL_REMOTE_STATUSES = ["queued", "in_progress"] as const;
/** True while a call is still in flight — used to decide whether to keep auto-polling status. */
export function isNonTerminalCallStatus(status: unknown): status is "queued" | "in_progress" {
  return typeof status === "string" && (NON_TERMINAL_REMOTE_STATUSES as readonly string[]).includes(status);
}
export type LocalCallAttemptStatus = "prepared" | "submitting";
export type CallAttemptLifecycleStatus = LocalCallAttemptStatus | RemoteCallStatus;
export type CallAttemptApprovalState = "not_approved" | "approved";
export type LocalApprovalState = "not_approved";
export type SafeErrorCategory = "provider_auth" | "validation" | "rate_or_credit" | "network" | "unexpected";

export interface CallAttemptDraft {
  id: string;
  demo_marker?: string | null;
  repair_job_id: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_region?: string | null;
  recipient_locale?: string | null;
  preparation_purpose: string;
  question_outline: string;
  request_snapshot: string;
  idempotency_key: string;
  lifecycle_status: CallAttemptLifecycleStatus;
  approval_state: CallAttemptApprovalState;
  approved_recipient_phone?: string | null;
  approved_at?: string | null;
  approval_expires_at?: string | null;
  provider_call_id?: string | null;
  provider_status?: RemoteCallStatus | null;
  submitted_at?: string | null;
  completed_at?: string | null;
  safe_error_category?: SafeErrorCategory | null;
  safe_result_summary?: string | null;
  review_note?: string | null;
  created_at?: string;
  updated_at?: string;
  created_date?: string;
  updated_date?: string;
  created_by?: string;
  /** True when the saved snapshot matches the current RepairJob values. */
  is_current?: boolean;
}

const LIMITS = {
  recipient_name: 80,
  purpose: 280,
  question_outline: 2400,
  request_snapshot: 8000,
  review_note: 280,
  idempotency_key: 255,
} as const;

const CANONICAL_PHONE_RE = /^\+[1-9]\d{6,14}$/;
const REVIEW_NOTE = "Prepared locally for review. It is not approved and has not been submitted.";

export function isCanonicalE164Phone(value: string | null | undefined): boolean {
  return typeof value === "string" && CANONICAL_PHONE_RE.test(value);
}

// Best-effort region/locale guess from an E.164 calling code, so the approval step starts from a
// sensible default instead of always defaulting to US/en-US regardless of the recipient's actual
// country. This is only ever a starting point -- the coordinator can freely edit both fields
// before approving, and CALL-E's own validation of the submitted region/locale is unaffected.
// Ordered longest-prefix-first so 3- and 2-digit codes are checked before shorter ones that could
// otherwise shadow them (e.g. "+1" vs "+1" NANP numbers aren't disambiguated further -- this is a
// convenience default, not authoritative geolocation).
const CALLING_CODE_REGIONS: ReadonlyArray<[string, string, string]> = [
  ["971", "AE", "ar-AE"], ["966", "SA", "ar-SA"], ["880", "BD", "bn-BD"], ["234", "NG", "en-NG"],
  ["86", "CN", "zh-CN"], ["81", "JP", "ja-JP"], ["82", "KR", "ko-KR"], ["91", "IN", "en-IN"],
  ["92", "PK", "ur-PK"], ["84", "VN", "vi-VN"], ["66", "TH", "th-TH"], ["65", "SG", "en-SG"],
  ["64", "NZ", "en-NZ"], ["63", "PH", "en-PH"], ["62", "ID", "id-ID"], ["61", "AU", "en-AU"],
  ["60", "MY", "ms-MY"], ["55", "BR", "pt-BR"], ["52", "MX", "es-MX"], ["49", "DE", "de-DE"],
  ["46", "SE", "sv-SE"], ["44", "GB", "en-GB"], ["41", "CH", "de-CH"], ["39", "IT", "it-IT"],
  ["34", "ES", "es-ES"], ["33", "FR", "fr-FR"], ["31", "NL", "nl-NL"], ["27", "ZA", "en-ZA"],
  ["20", "EG", "ar-EG"], ["1", "US", "en-US"],
];

export function guessRegionLocaleFromPhone(phone: string | null | undefined): { region: string; locale: string } {
  const digits = typeof phone === "string" ? phone.replace(/^\+/, "") : "";
  const match = CALLING_CODE_REGIONS.find(([code]) => digits.startsWith(code));
  return match ? { region: match[1], locale: match[2] } : { region: "US", locale: "en-US" };
}

export function isRemoteCallStatus(value: unknown): value is RemoteCallStatus {
  return typeof value === "string" && (REMOTE_CALL_STATUSES as readonly string[]).includes(value);
}

export function isAuthorizedDemoAttempt(value: Pick<CallAttemptDraft, "demo_marker"> | null | undefined): boolean {
  return value?.demo_marker === AUTHORIZED_DEMO_MARKER;
}

export function callPurposeForJob(job: RepairJobRecord): string {
  return `Pre-visit preparation check for a ${applianceLabel(job.appliance_type).toLowerCase()} job. Confirm identity, appliance details, symptoms, and access. Gather facts for a technician brief. Do not diagnose or promise a repair.`;
}

export function questionOutlineText(job: RepairJobRecord): string {
  return adaptiveQuestionsForJob(job).join("\n");
}

export function parseQuestionOutline(outline: string | null | undefined, job?: RepairJobRecord): string[] {
  const lines = String(outline ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length
    ? lines
    : job
      ? adaptiveQuestionsForJob(job)
      : ["Confirm the appliance details, symptoms, timing, error code or explicit none, and visit logistics."];
}

function safeText(value: string | null | undefined, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

/** Keeps only the operator-entered context needed to reconstruct the local review. */
export function buildCallRequestSnapshot(
  job: RepairJobRecord,
  overrides?: { purpose?: string; questions?: string[] }
): string {
  return JSON.stringify({
    appliance_type: safeText(job.appliance_type, 60),
    appliance: applianceLabel(job.appliance_type),
    brand: safeText(job.brand, 60),
    model: safeText(job.model, 80),
    reported_problem: safeText(job.reported_problem, 500),
    symptom_timing: safeText(job.symptom_timing, 200),
    error_code: safeText(job.error_code, 40),
    visit_note: safeText(job.visit_note, 400),
    access_notes_present: Boolean(safeText(job.access_notes, 400)),
    purpose: overrides?.purpose ?? callPurposeForJob(job),
    questions: overrides?.questions ?? adaptiveQuestionsForJob(job),
  });
}

function createIdempotencyKey(): string {
  const uuid = (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID?.();
  return `repairready-${uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`}`.slice(
    0,
    LIMITS.idempotency_key,
  );
}

async function listDrafts(jobId: string): Promise<CallAttemptDraft[]> {
  const rows = await CallAttempt.filter({ repair_job_id: jobId }, "-updated_date", 20);
  return ((rows as CallAttemptDraft[]) ?? []).filter((row) => Boolean(row?.id));
}

function asDraft(row: CallAttemptDraft, isCurrent: boolean): CallAttemptDraft {
  const providerStatus = isRemoteCallStatus(row.provider_status) ? row.provider_status : null;
  const lifecycleStatus = row.lifecycle_status === "submitting"
    ? "submitting"
    : isRemoteCallStatus(row.lifecycle_status)
      ? row.lifecycle_status
      : "prepared";
  const safeError = ["provider_auth", "validation", "rate_or_credit", "network", "unexpected"].includes(
    String(row.safe_error_category),
  )
    ? (row.safe_error_category as SafeErrorCategory)
    : null;
  return {
    ...row,
    lifecycle_status: lifecycleStatus,
    approval_state: row.approval_state === "approved" ? "approved" : "not_approved",
    provider_call_id: row.provider_call_id ?? null,
    provider_status: providerStatus,
    recipient_region: row.recipient_region ?? null,
    recipient_locale: row.recipient_locale ?? null,
    approved_recipient_phone: row.approved_recipient_phone ?? null,
    approved_at: row.approved_at ?? null,
    approval_expires_at: row.approval_expires_at ?? null,
    submitted_at: row.submitted_at ?? null,
    completed_at: row.completed_at ?? null,
    safe_error_category: safeError,
    safe_result_summary: row.safe_result_summary ?? null,
    review_note: row.review_note ?? null,
    is_current: isCurrent,
  };
}

export interface QueueCallAttemptSnapshot {
  id: string;
  repair_job_id: string;
  lifecycle_status: CallAttemptLifecycleStatus;
  provider_status: RemoteCallStatus | null;
  submitted_at?: string | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
  created_date?: string;
  updated_date?: string;
}

/**
 * Returns only the bounded lifecycle fields needed by the saved-data readiness queue.
 * Recipient details, request snapshots, keys, provider identifiers, and raw results stay out.
 */
export function normalizePersistedCallAttemptForQueue(raw: unknown): QueueCallAttemptSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const repairJobId = typeof row.repair_job_id === "string" ? row.repair_job_id.trim() : "";
  if (!id || !repairJobId) return null;
  const lifecycleStatus = row.lifecycle_status === "submitting"
    ? "submitting"
    : isRemoteCallStatus(row.lifecycle_status)
      ? row.lifecycle_status
      : "prepared";
  return {
    id,
    repair_job_id: repairJobId,
    lifecycle_status: lifecycleStatus,
    provider_status: isRemoteCallStatus(row.provider_status) ? row.provider_status : null,
    submitted_at: typeof row.submitted_at === "string" ? row.submitted_at : null,
    completed_at: typeof row.completed_at === "string" ? row.completed_at : null,
    created_at: typeof row.created_at === "string" ? row.created_at : undefined,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : undefined,
    created_date: typeof row.created_date === "string" ? row.created_date : undefined,
    updated_date: typeof row.updated_date === "string" ? row.updated_date : undefined,
  };
}

function queueAttemptTimestamp(snapshot: QueueCallAttemptSnapshot): number {
  const values = [
    snapshot.updated_at,
    snapshot.updated_date,
    snapshot.completed_at,
    snapshot.submitted_at,
    snapshot.created_at,
    snapshot.created_date,
  ].filter(Boolean) as string[];
  return values.reduce((latest, value) => {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? latest : Math.max(latest, parsed);
  }, 0);
}

/** Selects the newest saved attempt per job from one bulk entity read. */
export function newestPersistedCallAttemptsForQueue(rows: unknown[]): Map<string, QueueCallAttemptSnapshot> {
  const byJob = new Map<string, QueueCallAttemptSnapshot>();
  rows.forEach((row) => {
    const snapshot = normalizePersistedCallAttemptForQueue(row);
    if (!snapshot) return;
    const existing = byJob.get(snapshot.repair_job_id);
    if (!existing || queueAttemptTimestamp(snapshot) > queueAttemptTimestamp(existing)) {
      byJob.set(snapshot.repair_job_id, snapshot);
    }
  });
  return byJob;
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** True when a still-editable, not-yet-approved draft already exists for the job. Guards the
 * always-insert draft paths (retry/follow-up/post-visit) against creating a second "prepared"
 * row that could independently be approved and dispatched alongside the first -- the DB also
 * enforces this via a partial unique index (call_attempts_one_prepared_per_job) as the
 * authoritative backstop against a race; this check exists to fail with a clear message instead
 * of a raw constraint-violation error in the common, non-racing case. */
function hasExistingPreparedAttempt(rows: CallAttemptDraft[]): boolean {
  return rows.some((row) => String(row.lifecycle_status ?? "").trim() === "prepared");
}

/** Prevents local draft saving from clearing or replacing server-reserved state. */
function hasReservedState(row: CallAttemptDraft): boolean {
  const approvalState = String(row.approval_state ?? "").trim();
  const lifecycleStatus = String(row.lifecycle_status ?? "").trim();
  return (
    row.demo_marker === AUTHORIZED_DEMO_MARKER ||
    (approvalState.length > 0 && approvalState !== "not_approved") ||
    (lifecycleStatus.length > 0 && lifecycleStatus !== "prepared") ||
    hasText(row.approved_recipient_phone) ||
    hasText(row.approved_at) ||
    hasText(row.approval_expires_at) ||
    hasText(row.provider_call_id) ||
    hasText(row.provider_status) ||
    hasText(row.submitted_at) ||
    hasText(row.completed_at) ||
    hasText(row.safe_error_category) ||
    hasText(row.safe_result_summary)
  );
}

/** Reads the latest private draft for the selected owner-created job. */
export async function loadCallAttemptDraft(job: RepairJobRecord): Promise<CallAttemptDraft | null> {
  const rows = await listDrafts(job.id);
  const row = rows[0];
  if (!row) return null;
  return asDraft(row, row.request_snapshot === buildCallRequestSnapshot(job));
}

/** Saves one local draft per job and preserves its durable key on later local saves. */
export async function saveCallAttemptDraft(job: RepairJobRecord): Promise<CallAttemptDraft> {
  if (!job.id) throw new Error("Select a saved repair job before preparing a call draft.");
  if (!safeText(job.customer_name, LIMITS.recipient_name)) {
    throw new Error("Add a recipient name to the job before preparing a call draft.");
  }
  if (!isCanonicalE164Phone(job.phone)) {
    throw new Error("Save the job with a canonical +countrycode phone before preparing a call draft.");
  }

  const snapshot = buildCallRequestSnapshot(job);
  const rows = await listDrafts(job.id);
  const existingRow = rows[0] ?? null;
  const existing = existingRow ? asDraft(existingRow, false) : null;
  if (existingRow && hasReservedState(existingRow)) {
    throw new Error("This preparation record has server-reserved provider state and needs review.");
  }
  const existingKey = existing?.idempotency_key?.trim();
  if (existingKey && existingKey.length > LIMITS.idempotency_key) {
    throw new Error("This private draft has an invalid request key and needs review.");
  }
  const idempotencyKey = existingKey || createIdempotencyKey();

  const payload = {
    repair_job_id: job.id,
    recipient_name: safeText(job.customer_name, LIMITS.recipient_name),
    recipient_phone: job.phone.trim(),
    recipient_region: "",
    recipient_locale: "",
    preparation_purpose: safeText(callPurposeForJob(job), LIMITS.purpose),
    question_outline: questionOutlineText(job).slice(0, LIMITS.question_outline),
    request_snapshot: snapshot.slice(0, LIMITS.request_snapshot),
    idempotency_key: idempotencyKey,
    lifecycle_status: "prepared" as const,
    approval_state: "not_approved" as const,
    approved_recipient_phone: "",
    approved_at: "",
    approval_expires_at: "",
    provider_call_id: "",
    provider_status: "",
    submitted_at: "",
    completed_at: "",
    safe_error_category: "",
    safe_result_summary: "",
    review_note: REVIEW_NOTE.slice(0, LIMITS.review_note),
  };

  const saved = existing
    ? await CallAttempt.update(existing.id, payload)
    : await CallAttempt.create(payload);
  const savedRecord = existing
    ? ({ ...existing, ...(saved as CallAttemptDraft) } as CallAttemptDraft)
    : (saved as CallAttemptDraft);
  return asDraft(savedRecord, true);
}

/** Terminal outcomes where the call never actually connected/completed, so redialing the same
 * questions (rather than asking a targeted follow-up) is the right next step. */
export const RETRYABLE_CALL_STATUSES = ["no_answer", "voicemail", "busy"] as const;
export function isRetryableCallStatus(value: unknown): boolean {
  return typeof value === "string" && (RETRYABLE_CALL_STATUSES as readonly string[]).includes(value);
}

/**
 * Always creates a fresh call_attempts row rather than reusing the prior one, since the prior
 * attempt already has server-reserved provider state (a terminal no-answer/voicemail/busy result)
 * and must stay untouched as history. The new draft asks the same original questions — the call
 * never connected, so there is nothing new to follow up on yet. Approval is deliberately NOT
 * carried over: the coordinator still re-types and re-confirms the number for the new attempt,
 * same as any other call. This only saves them from re-entering the purpose/questions from scratch.
 */
export async function saveRetryCallAttemptDraft(job: RepairJobRecord): Promise<CallAttemptDraft> {
  if (!job.id) throw new Error("Select a saved repair job before retrying a call.");
  if (!safeText(job.customer_name, LIMITS.recipient_name)) {
    throw new Error("Add a recipient name to the job before retrying a call.");
  }
  if (!isCanonicalE164Phone(job.phone)) {
    throw new Error("Save the job with a canonical +countrycode phone before retrying a call.");
  }
  if (hasExistingPreparedAttempt(await listDrafts(job.id))) {
    throw new Error("A prepared draft already exists for this job. Approve, dispatch, or otherwise resolve it before preparing a retry.");
  }

  const snapshot = buildCallRequestSnapshot(job);
  const payload = {
    repair_job_id: job.id,
    recipient_name: safeText(job.customer_name, LIMITS.recipient_name),
    recipient_phone: job.phone.trim(),
    recipient_region: "",
    recipient_locale: "",
    preparation_purpose: safeText(callPurposeForJob(job), LIMITS.purpose),
    question_outline: questionOutlineText(job).slice(0, LIMITS.question_outline),
    request_snapshot: snapshot.slice(0, LIMITS.request_snapshot),
    idempotency_key: createIdempotencyKey(),
    lifecycle_status: "prepared" as const,
    approval_state: "not_approved" as const,
    approved_recipient_phone: "",
    approved_at: "",
    approval_expires_at: "",
    provider_call_id: "",
    provider_status: "",
    submitted_at: "",
    completed_at: "",
    safe_error_category: "",
    safe_result_summary: "",
    review_note: "Prepared locally as a retry after the previous call did not connect. It is not approved and has not been submitted.".slice(0, LIMITS.review_note),
  };

  const created = await CallAttempt.create(payload);
  return asDraft(created as CallAttemptDraft, true);
}

export function followUpPurposeForJob(job: RepairJobRecord): string {
  return `Targeted follow-up call for a ${applianceLabel(job.appliance_type).toLowerCase()} job. Resolve only the specific details left unclear from the previous call. Do not diagnose or promise a repair.`;
}

/**
 * Always creates a fresh call_attempts row rather than reusing the prior one, since the prior
 * attempt already has server-reserved provider state (it completed) and must stay untouched as
 * history. The new draft asks only about what the previous call left unresolved.
 */
export async function saveFollowUpCallAttemptDraft(
  job: RepairJobRecord,
  brief: Pick<RepairBriefView, "follow_ups" | "evidence">
): Promise<CallAttemptDraft> {
  if (!job.id) throw new Error("Select a saved repair job before preparing a follow-up call.");
  if (!isCanonicalE164Phone(job.phone)) {
    throw new Error("Save the job with a canonical +countrycode phone before preparing a follow-up call.");
  }
  const questions = targetedFollowUpQuestions(brief);
  if (questions.length <= 2) {
    throw new Error("There are no unresolved follow-up details to prepare a targeted call about.");
  }
  if (hasExistingPreparedAttempt(await listDrafts(job.id))) {
    throw new Error("A prepared draft already exists for this job. Approve, dispatch, or otherwise resolve it before preparing a follow-up call.");
  }

  const purpose = followUpPurposeForJob(job);
  const snapshot = buildCallRequestSnapshot(job, { purpose, questions });
  const payload = {
    repair_job_id: job.id,
    recipient_name: safeText(job.customer_name, LIMITS.recipient_name),
    recipient_phone: job.phone.trim(),
    recipient_region: "",
    recipient_locale: "",
    preparation_purpose: safeText(purpose, LIMITS.purpose),
    question_outline: questions.join("\n").slice(0, LIMITS.question_outline),
    request_snapshot: snapshot.slice(0, LIMITS.request_snapshot),
    idempotency_key: createIdempotencyKey(),
    lifecycle_status: "prepared" as const,
    approval_state: "not_approved" as const,
    approved_recipient_phone: "",
    approved_at: "",
    approval_expires_at: "",
    provider_call_id: "",
    provider_status: "",
    submitted_at: "",
    completed_at: "",
    safe_error_category: "",
    safe_result_summary: "",
    review_note: "Prepared locally as a targeted follow-up call. It is not approved and has not been submitted.".slice(0, LIMITS.review_note),
  };

  const created = await CallAttempt.create(payload);
  return asDraft(created as CallAttemptDraft, true);
}

export function postVisitPurposeForJob(job: RepairJobRecord): string {
  return `Post-visit check-in call for a ${applianceLabel(job.appliance_type).toLowerCase()} job. Confirm whether the reported problem is resolved and note anything new. Do not diagnose or promise further work.`;
}

const POST_VISIT_QUESTIONS = [
  "Ask whether the originally reported problem is fully resolved.",
  "Ask if the appliance is working normally since the visit.",
  "Ask about any new or different issue that has come up since the visit.",
  "Ask if the work area and access points (doors, water, power) were left as expected.",
  "Thank the customer and close the call. Do not diagnose or promise further work.",
];

/**
 * Always creates a fresh call_attempts row, same as a targeted follow-up. Unlike a follow-up,
 * this isn't about resolving something the pre-visit call left unclear -- it's a separate,
 * later touchpoint after the technician has already been out, so it's gated on the pre-visit
 * call having completed rather than on any specific unresolved detail.
 */
export async function savePostVisitCallAttemptDraft(job: RepairJobRecord): Promise<CallAttemptDraft> {
  if (!job.id) throw new Error("Select a saved repair job before preparing a post-visit call.");
  if (!isCanonicalE164Phone(job.phone)) {
    throw new Error("Save the job with a canonical +countrycode phone before preparing a post-visit call.");
  }
  if (hasExistingPreparedAttempt(await listDrafts(job.id))) {
    throw new Error("A prepared draft already exists for this job. Approve, dispatch, or otherwise resolve it before preparing a post-visit call.");
  }

  const purpose = postVisitPurposeForJob(job);
  const snapshot = buildCallRequestSnapshot(job, { purpose, questions: POST_VISIT_QUESTIONS });
  const payload = {
    repair_job_id: job.id,
    recipient_name: safeText(job.customer_name, LIMITS.recipient_name),
    recipient_phone: job.phone.trim(),
    recipient_region: "",
    recipient_locale: "",
    preparation_purpose: safeText(purpose, LIMITS.purpose),
    question_outline: POST_VISIT_QUESTIONS.join("\n").slice(0, LIMITS.question_outline),
    request_snapshot: snapshot.slice(0, LIMITS.request_snapshot),
    idempotency_key: createIdempotencyKey(),
    lifecycle_status: "prepared" as const,
    approval_state: "not_approved" as const,
    approved_recipient_phone: "",
    approved_at: "",
    approval_expires_at: "",
    provider_call_id: "",
    provider_status: "",
    submitted_at: "",
    completed_at: "",
    safe_error_category: "",
    safe_result_summary: "",
    review_note: "Prepared locally as a post-visit check-in call. It is not approved and has not been submitted.".slice(0, LIMITS.review_note),
  };

  const created = await CallAttempt.create(payload);
  return asDraft(created as CallAttemptDraft, true);
}
