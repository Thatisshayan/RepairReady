import { CallAttempt } from "@/entities";
import { adaptiveQuestionsForJob } from "@/lib/repair-briefs";
import { applianceLabel, type RepairJobRecord } from "@/lib/repair-jobs";

export const AUTHORIZED_DEMO_MARKER = "repairready_authorized_demo" as const;
export const REMOTE_CALL_STATUSES = [
  "queued",
  "in_progress",
  "completed",
  "failed",
  "canceled",
] as const;

export type RemoteCallStatus = (typeof REMOTE_CALL_STATUSES)[number];
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
export function buildCallRequestSnapshot(job: RepairJobRecord): string {
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
    purpose: callPurposeForJob(job),
    questions: adaptiveQuestionsForJob(job),
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
