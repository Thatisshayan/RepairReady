import { CallAttempt, RepairBrief } from "@/entities";
import {
  newestPersistedCallAttemptsForQueue,
  type QueueCallAttemptSnapshot,
} from "@/lib/call-attempts";
import {
  BRIEF_EVIDENCE_KEYS,
  buildBriefPreview,
  completionLabel,
  hasSafetyHazard,
  humanReviewLabel,
  readinessDecisionFor,
  readinessMetricsFor,
  selectPersistedRepairBriefForQueue,
  type HumanReviewState,
  type ReadinessDecision,
  type ReadinessMetrics,
  type RepairBriefView,
} from "@/lib/repair-briefs";
import {
  applianceLabel,
  jobUpdatedAt,
  type RepairJobRecord,
} from "@/lib/repair-jobs";

export const READINESS_QUEUE_LIMIT = 200 as const;
const BRIEF_EVIDENCE_AREA_COUNT = BRIEF_EVIDENCE_KEYS.length;

const QUEUE_PHONE_RE = /(?:\+\d[\d\s().-]{6,}|\b\d(?:[\d\s().-]*\d){6,}\b)/g;
const QUEUE_EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const QUEUE_SENSITIVE_RE = /(?:alarm|security|door|entry|access|gate|building|lock)\s*(?:code|pin|password|passcode)|password|credential/i;

function queueText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex -- deliberately stripping control characters from untrusted text before storage/display.
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
  if (!normalized) return "";
  if (QUEUE_SENSITIVE_RE.test(normalized)) return "[sensitive detail omitted]";
  return normalized
    .replace(QUEUE_PHONE_RE, "[phone omitted]")
    .replace(QUEUE_EMAIL_RE, "[email omitted]");
}

export type ReadinessQueueBucket =
  | "blocked"
  | "needs_follow_up"
  | "ready_for_technician_review";

export type ReadinessQueueFilter =
  | "all"
  | "ready_for_technician_review"
  | "needs_follow_up"
  | "blocked"
  | "unreviewed";

export type ReadinessQueueJob = Pick<
  RepairJobRecord,
  | "id"
  | "customer_name"
  | "appliance_type"
  | "brand"
  | "model"
  | "reported_problem"
  | "created_at"
  | "updated_at"
  | "created_date"
  | "updated_date"
>;

export interface ReadinessQueueItem {
  job: ReadinessQueueJob;
  attempt: QueueCallAttemptSnapshot | null;
  brief: RepairBriefView;
  hasPersistedAttempt: boolean;
  hasPersistedBrief: boolean;
  readinessBucket: ReadinessQueueBucket;
  decision: ReadinessDecision;
  metrics: ReadinessMetrics;
  humanReviewState: HumanReviewState;
  humanReviewLabel: string;
  sourceLabel: "Saved brief" | "Preparation only";
  completionLabel: string;
  blockerCount: number;
  blockerText: string | null;
  hasSafetyHazard: boolean;
  latestActivity: string | null;
  nextAction: string;
}

export interface ReadinessQueueSummary {
  loadedJobCount: number;
  readyCount: number;
  needsFollowUpCount: number;
  blockedCount: number;
  unreviewedCount: number;
  /** Evidence areas confirmed by a call, summed across every loaded job (5 areas per job). */
  confirmedEvidenceCount: number;
  totalEvidenceAreaCount: number;
  limitedToNewestRecords: boolean;
  safetyHazardCount: number;
}

export interface ReadinessQueueSnapshot {
  items: ReadinessQueueItem[];
  summary: ReadinessQueueSummary;
  loadedAt: string;
  boundary: {
    jobs: number;
    attempts: number;
    briefs: number;
    limit: number;
  };
}

function asTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function latestTimestamp(values: Array<unknown>): string | null {
  const timestamps = values.map(asTimestamp).filter((value): value is string => Boolean(value));
  if (!timestamps.length) return null;
  return timestamps.sort((a, b) => b.localeCompare(a))[0] ?? null;
}

function briefActivity(brief: RepairBriefView): string | null {
  return latestTimestamp([brief.updated_at, brief.updated_date]);
}

function attemptActivity(attempt: QueueCallAttemptSnapshot | null): string | null {
  if (!attempt) return null;
  return latestTimestamp([
    attempt.updated_at,
    attempt.updated_date,
    attempt.completed_at,
    attempt.submitted_at,
    attempt.created_at,
    attempt.created_date,
  ]);
}

function queueBucketFor(decision: ReadinessDecision): ReadinessQueueBucket {
  if (decision.state === "blocked") return "blocked";
  if (decision.state === "ready_for_technician_review") return "ready_for_technician_review";
  return "needs_follow_up";
}

function queueJobFor(job: RepairJobRecord): ReadinessQueueJob {
  return {
    id: job.id,
    customer_name: queueText(job.customer_name, 80),
    appliance_type: queueText(job.appliance_type, 60),
    brand: queueText(job.brand, 60) || null,
    model: queueText(job.model, 80) || null,
    reported_problem: queueText(job.reported_problem, 500),
    created_at: job.created_at,
    updated_at: job.updated_at,
    created_date: job.created_date,
    updated_date: job.updated_date,
  };
}

function buildItem(
  job: RepairJobRecord,
  attempt: QueueCallAttemptSnapshot | null,
  briefRows: unknown[],
): ReadinessQueueItem {
  const persistedBrief = selectPersistedRepairBriefForQueue(briefRows, job, attempt);
  const brief = persistedBrief ?? buildBriefPreview(job, attempt);
  const decision = readinessDecisionFor(brief);
  const metrics = readinessMetricsFor(brief);
  const latestActivity = latestTimestamp([
    jobUpdatedAt(job),
    attemptActivity(attempt),
    briefActivity(brief),
  ]);
  const firstBlocker = queueText(brief.blockers[0]?.value, 420) || null;

  return {
    job: queueJobFor(job),
    attempt,
    brief,
    hasPersistedAttempt: Boolean(attempt),
    hasPersistedBrief: Boolean(persistedBrief),
    readinessBucket: queueBucketFor(decision),
    decision,
    metrics,
    humanReviewState: brief.human_review_state,
    humanReviewLabel: humanReviewLabel(brief.human_review_state),
    sourceLabel: persistedBrief ? "Saved brief" : "Preparation only",
    completionLabel: completionLabel(brief.call_completion_status),
    blockerCount: metrics.visitBlockers,
    blockerText: firstBlocker,
    hasSafetyHazard: hasSafetyHazard(brief),
    latestActivity,
    nextAction: decision.nextAction,
  };
}

function compareLatestActivity(a: ReadinessQueueItem, b: ReadinessQueueItem): number {
  const aTime = a.latestActivity ? Date.parse(a.latestActivity) : 0;
  const bTime = b.latestActivity ? Date.parse(b.latestActivity) : 0;
  if (aTime !== bTime) return bTime - aTime;
  return a.job.customer_name.localeCompare(b.job.customer_name);
}

function compareActionableState(a: ReadinessQueueItem, b: ReadinessQueueItem): number {
  const rank: Record<ReadinessQueueItem["decision"]["state"], number> = {
    blocked: 0,
    no_call_evidence: 1,
    needs_follow_up: 2,
    evidence_incomplete: 3,
    ready_for_technician_review: 4,
  };
  return (rank[a.decision.state] ?? 9) - (rank[b.decision.state] ?? 9);
}

function sortQueueItems(items: ReadinessQueueItem[]): ReadinessQueueItem[] {
  const groups: ReadinessQueueBucket[] = [
    "blocked",
    "needs_follow_up",
    "ready_for_technician_review",
  ];
  const bucketed = groups.flatMap((group) =>
    items
      .filter((item) => item.readinessBucket === group)
      .sort((a, b) => compareActionableState(a, b) || compareLatestActivity(a, b)),
  );
  // A reported safety hazard outranks every other signal, including its own readiness bucket --
  // it needs a human's attention before anything else on the queue, regardless of how complete
  // the rest of the preparation is.
  const hazards = bucketed.filter((item) => item.hasSafetyHazard);
  const rest = bucketed.filter((item) => !item.hasSafetyHazard);
  return [...hazards, ...rest];
}

function emptySummary(jobs: RepairJobRecord[]): ReadinessQueueSummary {
  return {
    loadedJobCount: jobs.length,
    readyCount: 0,
    needsFollowUpCount: 0,
    blockedCount: 0,
    unreviewedCount: 0,
    confirmedEvidenceCount: 0,
    totalEvidenceAreaCount: jobs.length * BRIEF_EVIDENCE_AREA_COUNT,
    limitedToNewestRecords: jobs.length >= READINESS_QUEUE_LIMIT,
    safetyHazardCount: 0,
  };
}

/**
 * Enriches the already loaded owner-scoped jobs with one newest-record read for each saved entity.
 * This function only reads persisted entities. It never calls a provider or changes saved data.
 */
export async function loadReadinessQueue(
  jobs: RepairJobRecord[],
): Promise<ReadinessQueueSnapshot> {
  const normalizedJobs = jobs.filter((job): job is RepairJobRecord => Boolean(job?.id));
  if (!normalizedJobs.length) {
    return {
      items: [],
      summary: emptySummary(normalizedJobs),
      loadedAt: new Date().toISOString(),
      boundary: { jobs: 0, attempts: 0, briefs: 0, limit: READINESS_QUEUE_LIMIT },
    };
  }

  const [attemptRows, briefRows] = await Promise.all([
    CallAttempt.list("-updated_date", READINESS_QUEUE_LIMIT),
    RepairBrief.list("-updated_date", READINESS_QUEUE_LIMIT),
  ]);
  const persistedAttempts = newestPersistedCallAttemptsForQueue(attemptRows as unknown[]);
  const briefRowsByJob = new Map<string, unknown[]>();

  (briefRows as unknown[]).forEach((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return;
    const repairJobId = String((row as Record<string, unknown>).repair_job_id ?? "").trim();
    if (!repairJobId) return;
    const current = briefRowsByJob.get(repairJobId) ?? [];
    current.push(row);
    briefRowsByJob.set(repairJobId, current);
  });

  const items = sortQueueItems(
    normalizedJobs.map((job) =>
      buildItem(job, persistedAttempts.get(job.id) ?? null, briefRowsByJob.get(job.id) ?? []),
    ),
  );
  const summary: ReadinessQueueSummary = {
    loadedJobCount: normalizedJobs.length,
    readyCount: items.filter((item) => item.readinessBucket === "ready_for_technician_review").length,
    needsFollowUpCount: items.filter((item) => item.readinessBucket === "needs_follow_up").length,
    blockedCount: items.filter((item) => item.readinessBucket === "blocked").length,
    unreviewedCount: items.filter((item) => item.humanReviewState === "not_reviewed").length,
    confirmedEvidenceCount: items.reduce((sum, item) => sum + item.metrics.confirmedEvidenceAreas, 0),
    totalEvidenceAreaCount: normalizedJobs.length * BRIEF_EVIDENCE_AREA_COUNT,
    limitedToNewestRecords:
      normalizedJobs.length >= READINESS_QUEUE_LIMIT ||
      (attemptRows as unknown[]).length >= READINESS_QUEUE_LIMIT ||
      (briefRows as unknown[]).length >= READINESS_QUEUE_LIMIT,
    safetyHazardCount: items.filter((item) => item.hasSafetyHazard).length,
  };

  return {
    items,
    summary,
    loadedAt: new Date().toISOString(),
    boundary: {
      jobs: normalizedJobs.length,
      attempts: (attemptRows as unknown[]).length,
      briefs: (briefRows as unknown[]).length,
      limit: READINESS_QUEUE_LIMIT,
    },
  };
}

export function queueMatchesSearch(item: ReadinessQueueItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const job = item.job;
  return [
    job.customer_name,
    applianceLabel(job.appliance_type),
    job.appliance_type,
    job.brand,
    job.model,
    job.reported_problem,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export function queueItemsForFilter(
  items: ReadinessQueueItem[],
  query: string,
  filter: ReadinessQueueFilter,
): ReadinessQueueItem[] {
  return items.filter((item) => {
    if (!queueMatchesSearch(item, query)) return false;
    if (filter === "unreviewed") return item.humanReviewState === "not_reviewed";
    if (filter === "all") return true;
    return item.readinessBucket === filter;
  });
}

export function queueEvidenceLabel(item: ReadinessQueueItem): string {
  return `${item.metrics.confirmedEvidenceAreas}/5 confirmed · ${item.metrics.callEvidenceAreas}/5 from call`;
}

export function queueCompletionLabel(item: ReadinessQueueItem): string {
  return item.completionLabel;
}

export function queueHasSavedCallEvidence(item: ReadinessQueueItem): boolean {
  return item.metrics.callEvidenceAreas > 0;
}

export function queueSourceDetail(item: ReadinessQueueItem): string {
  return item.hasPersistedBrief
    ? "Saved brief is the persisted review snapshot."
    : "Coordinator entries are preparation only until saved call evidence exists.";
}

