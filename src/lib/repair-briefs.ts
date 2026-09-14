import { CallAttempt, RepairBrief } from "@/entities";
import { applianceLabel, type RepairJobRecord } from "@/lib/repair-jobs";

export const BRIEF_EVIDENCE_KEYS = [
  "appliance_identity",
  "symptoms",
  "timing",
  "error_code",
  "visit_logistics",
] as const;
export type EvidenceKey = (typeof BRIEF_EVIDENCE_KEYS)[number];
export type EvidenceStatus = "confirmed" | "missing" | "uncertain" | "unverified";
export type EvidenceSource = "coordinator" | "call_reported";
export const CALL_COMPLETION_STATUSES = [
  "not_started",
  "in_progress",
  "completed",
  "failed",
  "canceled",
  "no_answer",
  "declined",
  "voicemail",
  "busy",
  "expired",
  "unknown",
] as const;
export type CallCompletionStatus = (typeof CALL_COMPLETION_STATUSES)[number];
export type ReadinessStatus = "blocked" | "needs_follow_up" | "unknown" | "ready_for_technician_review";
export type HumanReviewState = "not_reviewed" | "reviewed" | "needs_follow_up";
export type FollowUpReviewStatus = "open" | "reviewed";

export interface EvidenceItem {
  key: EvidenceKey;
  label: string;
  status: EvidenceStatus;
  source: EvidenceSource | null;
  value: string | null;
  supporting_excerpt: string | null;
}
export interface BriefBlocker {
  value: string;
  source: EvidenceSource;
  supporting_excerpt: string | null;
}
export interface BriefFollowUp {
  key: string;
  value: string;
  source: "call_reported";
}
export interface FollowUpReview {
  key: string;
  value: string;
  status: FollowUpReviewStatus;
  note: string;
}
/** What actually happened on the visit, entered by the coordinator or technician after the fact.
 * Deliberately minimal -- this exists to compute first-time-fix, not to become a full work-order
 * system. */
export interface RepairOutcome {
  actual_diagnosis: string;
  part_used: string;
  repair_completed: boolean;
  second_visit_required: boolean;
  recorded_at: string;
}

export interface RepairBriefView {
  id?: string;
  repair_job_id: string;
  call_attempt_id: string;
  call_completion_status: CallCompletionStatus;
  readiness_status: ReadinessStatus;
  human_review_state: HumanReviewState;
  human_review_note: string;
  reviewed_at: string;
  evidence: EvidenceItem[];
  follow_ups: BriefFollowUp[];
  follow_up_reviews: FollowUpReview[];
  blockers: BriefBlocker[];
  outcome: RepairOutcome | null;
  safe_summary: string;
  share_token?: string | null;
  share_expires_at?: string | null;
  updated_at?: string;
  updated_date?: string;
}

const LABELS: Record<EvidenceKey, string> = {
  appliance_identity: "Appliance brand and model",
  symptoms: "Symptoms in the customer's own words",
  timing: "When the symptom occurs",
  error_code: "Error code or explicit none",
  visit_logistics: "Access, parking, pets, and workspace",
};
const LIMITS = { id: 160, evidence: 420, followUp: 180, followUps: 8, followUpJson: 4000, followUpReviewJson: 5000, followUpReviewNote: 240, excerpt: 280, note: 600, summary: 7000 } as const;
const SENSITIVE_RE = /(?:alarm|security|door|entry|access|gate|building|lock)\s*(?:code|pin|password|passcode)|password|credential/i;
const PHONE_RE = /(?:\+\d[\d\s().-]{6,}|\b\d(?:[\d\s().-]*\d){6,}\b)/g;
// Flags call-reported text that describes an immediate safety hazard rather than an ordinary
// access/logistics blocker, so it can be surfaced distinctly instead of blending in with
// "no elevator" or "pets present" style blockers. Deliberately narrow and literal (no attempt at
// diagnosis) -- this only ever changes how existing, already-reported blocker/symptom text is
// displayed and sorted. It never adds, removes, or infers evidence.
const SAFETY_HAZARD_RE =
  /\bgas\s*(leak|smell|odor)\b|\bsmells?\s*(of|like)\s*gas\b|\bcarbon\s*monoxide\b|\bco\s*(detector|alarm)\b|\bsmoke\b|\bfire\b|\bsparking\b|\bspark(s|ed)?\s*(from|out)\b|\bexposed\s*wir(e|ing)\b|\blive\s*wire\b|\belectric(al)?\s*shock\b|\belectrocut\w*\b|\bburning\s*smell\b|\bsmells?\s*(like\s*)?(it'?s\s*)?burning\b|\bflooding\b|\bwater\s*damage\b|\bstanding\s*water\b|\bmold\b/i;

export function isSafetyHazardText(value: string | null | undefined): boolean {
  return typeof value === "string" && SAFETY_HAZARD_RE.test(value);
}

/** True when any call-reported blocker or symptom text on this brief describes a safety hazard. */
export function hasSafetyHazard(brief: Pick<RepairBriefView, "blockers" | "evidence">): boolean {
  if (brief.blockers.some((blocker) => isSafetyHazardText(blocker.value))) return true;
  return brief.evidence.some((item) => item.key === "symptoms" && isSafetyHazardText(item.value));
}

// ---------------------------------------------------------------------------
// Diagnostic evidence model: safety flags, contradictions, and a bounded,
// rule-based diagnostic hypothesis. Everything here is derived on the fly from
// already-stored evidence and job fields -- nothing new is persisted, and
// nothing here ever asks CALL-E's live agent to diagnose anything (that
// boundary is intentional, see PREPARATION_TASK in dispatch-calle-call).
// ---------------------------------------------------------------------------

export type SafetyFlagCategory = "gas_or_carbon_monoxide" | "fire_or_electrical" | "flooding_or_water";
export interface SafetyFlag {
  category: SafetyFlagCategory;
  source: EvidenceSource;
  detail: string;
}
const SAFETY_CATEGORY_PATTERNS: Array<{ category: SafetyFlagCategory; re: RegExp }> = [
  { category: "gas_or_carbon_monoxide", re: /\bgas\s*(leak|smell|odor)\b|\bsmells?\s*(of|like)\s*gas\b|\bcarbon\s*monoxide\b|\bco\s*(detector|alarm)\b/i },
  { category: "fire_or_electrical", re: /\bsmoke\b|\bfire\b|\bsparking\b|\bspark(s|ed)?\s*(from|out)\b|\bexposed\s*wir(e|ing)\b|\blive\s*wire\b|\belectric(al)?\s*shock\b|\belectrocut\w*\b|\bburning\s*smell\b|\bsmells?\s*(like\s*)?(it'?s\s*)?burning\b/i },
  { category: "flooding_or_water", re: /\bflooding\b|\bwater\s*damage\b|\bstanding\s*water\b|\bmold\b/i },
];

/** Structures the same hazard language `hasSafetyHazard` already detects into distinct,
 * escalation-ready categories instead of one boolean. A single report can match more than one
 * category (e.g. "sparking near standing water"). */
export function deriveSafetyFlags(brief: Pick<RepairBriefView, "blockers" | "evidence">): SafetyFlag[] {
  const candidates: Array<{ value: string | null; source: EvidenceSource | null }> = [
    ...brief.blockers.map((b) => ({ value: b.value, source: b.source as EvidenceSource | null })),
    ...brief.evidence.filter((item) => item.key === "symptoms").map((item) => ({ value: item.value, source: item.source })),
  ];
  const flags: SafetyFlag[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.value || !candidate.source) continue;
    for (const { category, re } of SAFETY_CATEGORY_PATTERNS) {
      if (!re.test(candidate.value)) continue;
      const dedupeKey = `${category}:${candidate.source}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      flags.push({ category, source: candidate.source, detail: candidate.value });
    }
  }
  return flags;
}
export function safetyFlagLabel(category: SafetyFlagCategory): string {
  if (category === "gas_or_carbon_monoxide") return "Gas or carbon monoxide";
  if (category === "fire_or_electrical") return "Fire or electrical hazard";
  return "Flooding or water damage";
}

export interface Contradiction {
  key: EvidenceKey;
  label: string;
  coordinator_value: string;
  call_value: string;
}
function normalizeForCompare(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
/** True when neither string is a near-substring of the other -- a deliberately loose check so
 * paraphrasing or added detail ("LG washer" vs "LG WM3900") doesn't get flagged as a conflict,
 * while an actually different answer ("gas dryer" vs "electric dryer") does. */
function materiallyDifferent(a: string, b: string): boolean {
  const x = normalizeForCompare(a);
  const y = normalizeForCompare(b);
  if (!x || !y) return false;
  return !x.includes(y) && !y.includes(x);
}
const COORDINATOR_FIELD_FOR_KEY: Partial<Record<EvidenceKey, (job: RepairJobRecord) => string>> = {
  appliance_identity: (job) => [job.brand, job.model].filter(Boolean).join(" ").trim(),
  symptoms: (job) => (job.reported_problem ?? "").trim(),
  timing: (job) => (job.symptom_timing ?? "").trim(),
  error_code: (job) => (job.error_code ?? "").trim(),
  visit_logistics: (job) => (job.access_notes ?? "").trim(),
};

/** Flags an evidence area where the coordinator's original entry and the call-confirmed answer
 * materially disagree. This operationalizes the brief's core promise -- a coordinator guess that
 * turns out wrong should be visibly caught, not silently overwritten. Only fires against
 * `confirmed` call evidence; an `uncertain`/`unverified` call answer isn't a strong enough basis
 * to accuse the coordinator's entry of being wrong. */
export function deriveContradictions(job: RepairJobRecord, evidence: EvidenceItem[]): Contradiction[] {
  return evidence.flatMap((item) => {
    if (item.source !== "call_reported" || item.status !== "confirmed" || !item.value) return [];
    const coordinatorValue = COORDINATOR_FIELD_FOR_KEY[item.key]?.(job) ?? "";
    if (!coordinatorValue || !materiallyDifferent(coordinatorValue, item.value)) return [];
    return [{ key: item.key, label: LABELS[item.key], coordinator_value: coordinatorValue, call_value: item.value }];
  });
}

export type DiagnosticConfidence = "low" | "medium" | "high";
export interface CandidatePart {
  name: string;
  reason: string;
}
export interface DiagnosisHypothesis {
  likely_subsystem: string;
  confidence: DiagnosticConfidence;
  candidate_parts: CandidatePart[];
  evidence_refs: EvidenceKey[];
}
interface SymptomRule {
  test: RegExp;
  likely_subsystem: string;
  candidate_parts: CandidatePart[];
}
const SYMPTOM_RULES: Partial<Record<RepairJobRecord["appliance_type"], SymptomRule[]>> = {
  washing_machine: [
    { test: /not\s*drain|won'?t\s*drain|water\s*(stays|remains|left)/i, likely_subsystem: "Drain system", candidate_parts: [{ name: "Drain pump", reason: "Most common cause of a washer that fills but will not drain." }, { name: "Drain hose", reason: "A kinked or clogged hose produces the same symptom as a failed pump." }] },
    { test: /leak/i, likely_subsystem: "Door seal or hose connections", candidate_parts: [{ name: "Door boot seal", reason: "Front-load washer leaks are frequently a torn or dirty door seal." }, { name: "Inlet/drain hose connections", reason: "Loose or worn hose fittings are a common secondary leak source." }] },
    { test: /not\s*spin|won'?t\s*spin|stopped\s*spinning/i, likely_subsystem: "Drive system", candidate_parts: [{ name: "Lid or door switch", reason: "A failed switch prevents spin as a safety interlock, independent of the motor." }, { name: "Drive belt", reason: "A worn or broken belt is a common mechanical cause of no spin." }] },
  ],
  dryer: [
    { test: /(no|not|won'?t)\s*heat|not\s*heating|cold\s*air/i, likely_subsystem: "Heating circuit", candidate_parts: [{ name: "Heating element / heating assembly", reason: "Primary suspect for a dryer that tumbles but produces no heat." }, { name: "Thermal fuse", reason: "A tripped thermal fuse cuts heat while leaving the drum motor running." }] },
    { test: /not\s*(spin|turn|tumbl)/i, likely_subsystem: "Drive system", candidate_parts: [{ name: "Drive belt", reason: "A broken belt is the most common cause of a drum that won't turn." }] },
  ],
  dishwasher: [
    { test: /not\s*drain|won'?t\s*drain|standing\s*water/i, likely_subsystem: "Drain system", candidate_parts: [{ name: "Drain pump", reason: "Most common cause of standing water at the end of a cycle." }, { name: "Air gap / drain hose", reason: "A clogged air gap or hose produces the same symptom." }] },
    { test: /leak/i, likely_subsystem: "Door seal or spray arm", candidate_parts: [{ name: "Door gasket", reason: "A worn door gasket is the most common dishwasher leak source." }] },
  ],
  refrigerator: [
    { test: /not\s*cool|not\s*cold|warm(ing)?/i, likely_subsystem: "Cooling system", candidate_parts: [{ name: "Condenser coils", reason: "Dirty or blocked coils are the most common, cheapest-to-check cause of poor cooling." }, { name: "Evaporator fan", reason: "A failed fan prevents cold air from circulating even if cooling is otherwise working." }] },
  ],
  oven_range: [
    { test: /not\s*heat|won'?t\s*heat|not\s*(turning|getting)\s*(on|hot)/i, likely_subsystem: "Heating circuit", candidate_parts: [{ name: "Igniter (gas) or heating element (electric)", reason: "Primary suspect for an oven that will not heat, depending on fuel type." }] },
  ],
};

/** A bounded, deterministic hypothesis derived only from already call-confirmed evidence -- never
 * from an unverified coordinator guess, and never when a safety hazard is present (a safety hold
 * takes precedence over ordinary diagnostic reasoning). Returns null rather than force a guess
 * when there isn't a confident enough match: absence of a hypothesis is a valid, honest outcome,
 * not a bug. Always label results as a hypothesis for the technician to verify, never a diagnosis. */
export function deriveDiagnosisHypothesis(job: RepairJobRecord, brief: Pick<RepairBriefView, "blockers" | "evidence">): DiagnosisHypothesis | null {
  if (deriveSafetyFlags(brief).length > 0) return null;
  const symptomItem = brief.evidence.find((item) => item.key === "symptoms");
  if (!symptomItem || symptomItem.source !== "call_reported" || symptomItem.status !== "confirmed" || !symptomItem.value) return null;
  const rules = SYMPTOM_RULES[job.appliance_type as RepairJobRecord["appliance_type"]];
  const match = rules?.find((rule) => rule.test.test(symptomItem.value as string));
  if (!match) return null;

  const errorCodeItem = brief.evidence.find((item) => item.key === "error_code");
  const timingItem = brief.evidence.find((item) => item.key === "timing");
  const evidenceRefs: EvidenceKey[] = ["symptoms"];
  let confidence: DiagnosticConfidence = "medium";
  if (errorCodeItem?.source === "call_reported" && errorCodeItem.status === "confirmed" && errorCodeItem.value) {
    evidenceRefs.push("error_code");
    confidence = "high";
  }
  if (!timingItem || timingItem.status === "missing" || timingItem.status === "uncertain") {
    confidence = confidence === "high" ? "medium" : "low";
  } else {
    evidenceRefs.push("timing");
  }

  return { likely_subsystem: match.likely_subsystem, confidence, candidate_parts: match.candidate_parts, evidence_refs: evidenceRefs };
}
export function diagnosticConfidenceLabel(confidence: DiagnosticConfidence): string {
  return confidence === "high" ? "High" : confidence === "medium" ? "Medium" : "Low";
}

function text(value: unknown, max: number): string {
  // eslint-disable-next-line no-control-regex -- deliberately stripping control characters from untrusted text before storage/display.
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
}
function safeBriefText(value: unknown, max: number): string {
  const result = text(value, max);
  return SENSITIVE_RE.test(result) ? "" : result.replace(PHONE_RE, "[phone omitted]");
}
function safeExcerpt(value: unknown): string {
  return safeBriefText(value, LIMITS.excerpt).replace(PHONE_RE, "[phone omitted]");
}
export function sanitizeFollowUpReviewNote(value: unknown): string {
  return safeBriefText(value, LIMITS.followUpReviewNote);
}
function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
function followUpKey(value: string): string {
  const normalized = value.normalize("NFKC").toLowerCase().trim();
  return normalized.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "follow-up";
}

export function evidenceStatusLabel(status: EvidenceStatus): string {
  return status === "confirmed" ? "Confirmed" : status === "unverified" ? "Unverified" : status === "uncertain" ? "Uncertain" : "Missing";
}
export function evidenceSourceLabel(source: EvidenceSource | null): string {
  return source === "call_reported" ? "Call evidence" : source === "coordinator" ? "Coordinator entry" : "No source yet";
}
export function readinessLabel(status: ReadinessStatus): string {
  return status === "ready_for_technician_review" ? "Ready for technician review" : status === "needs_follow_up" ? "Needs follow-up" : status === "blocked" ? "Blocked" : "Unknown";
}
const COMPLETION_LABELS: Record<CallCompletionStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  failed: "Provider reported failure",
  canceled: "Canceled",
  no_answer: "No answer",
  declined: "Declined",
  voicemail: "Reached voicemail",
  busy: "Line busy",
  expired: "Attempt expired",
  unknown: "Unknown",
};
export function completionLabel(status: CallCompletionStatus): string {
  return COMPLETION_LABELS[status] ?? "Unknown";
}
export function humanReviewLabel(state: HumanReviewState): string {
  return state === "reviewed" ? "Reviewed" : state === "needs_follow_up" ? "Follow-up noted" : "Not reviewed";
}
export function followUpReviewLabel(status: FollowUpReviewStatus): string {
  return status === "reviewed" ? "Reviewed" : "Open";
}

export interface ReadinessMetrics {
  confirmedEvidenceAreas: number;
  followUpDetails: number;
  visitBlockers: number;
  callEvidenceAreas: number;
  incompleteEvidenceAreas: number;
}

export type ReadinessDecisionState =
  | "no_call_evidence"
  | "blocked"
  | "needs_follow_up"
  | "ready_for_technician_review"
  | "evidence_incomplete";
export type ReadinessDecisionTone = "good" | "attention" | "blocked" | "neutral";

export interface ReadinessDecision {
  state: ReadinessDecisionState;
  tone: ReadinessDecisionTone;
  title: string;
  explanation: string;
  nextAction: string;
  reviewPending: boolean;
  reviewMessage: string | null;
}

export function readinessMetricsFor(brief: Pick<RepairBriefView, "evidence" | "follow_ups" | "blockers">): ReadinessMetrics {
  return {
    confirmedEvidenceAreas: brief.evidence.filter((item) => item.status === "confirmed").length,
    followUpDetails: brief.follow_ups.length,
    visitBlockers: brief.blockers.length,
    callEvidenceAreas: brief.evidence.filter((item) => item.source === "call_reported").length,
    incompleteEvidenceAreas: brief.evidence.filter((item) => item.status === "missing" || item.status === "uncertain").length,
  };
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function readinessDecisionFor(brief: RepairBriefView): ReadinessDecision {
  const metrics = readinessMetricsFor(brief);
  const reviewPending = brief.human_review_state === "not_reviewed";
  const reviewMessage = reviewPending
    ? "Human review is still pending. Record a review state below to capture coordinator attention. This does not change call evidence or readiness."
    : null;

  if (metrics.visitBlockers > 0 || brief.readiness_status === "blocked") {
    const hasBlockerDetail = metrics.visitBlockers > 0;
    return {
      state: "blocked",
      tone: "blocked",
      title: "Blocked",
      explanation: hasBlockerDetail
        ? "An explicit visit blocker is recorded in this brief. The blocker stays separate from follow-up details and needs review before any next step."
        : "The saved brief is marked blocked, but no blocker detail is available to display.",
      nextAction: hasBlockerDetail
        ? "Resolve the explicit blocker and reassess the brief. Follow-up review does not confirm a customer answer."
        : "Review the saved brief and its source details before moving forward.",
      reviewPending,
      reviewMessage,
    };
  }

  if (metrics.callEvidenceAreas === 0) {
    const explanationByCompletion: Record<CallCompletionStatus, string> = {
      not_started: "The private brief contains coordinator entries for preparation, but no separately authorized call evidence has been received.",
      in_progress: "The call is still in progress, and no call-reported evidence is saved yet. Coordinator entries remain preparation only.",
      completed: "The call is marked complete, but no call-reported evidence is saved. Coordinator entries remain preparation only.",
      failed: "The provider reported a failed call, and no call-reported evidence is saved. Coordinator entries remain preparation only.",
      canceled: "The call was canceled, and no call-reported evidence is saved. Coordinator entries remain preparation only.",
      no_answer: "The participant did not answer, and no call-reported evidence is saved. Coordinator entries remain preparation only.",
      declined: "The participant declined the call, and no call-reported evidence is saved. Coordinator entries remain preparation only.",
      voicemail: "The call reached voicemail, and no call-reported evidence is saved. Coordinator entries remain preparation only.",
      busy: "The line was busy, and no call-reported evidence is saved. Coordinator entries remain preparation only.",
      expired: "The call attempt expired before connecting, and no call-reported evidence is saved. Coordinator entries remain preparation only.",
      unknown: "No call-reported evidence is saved, and the call outcome is unavailable. Coordinator entries remain preparation only.",
    };
    const nextActionByCompletion: Record<CallCompletionStatus, string> = {
      not_started: "Complete the consented call flow, then review the returned evidence.",
      in_progress: "Wait for a returned call result, then review the evidence and any follow-up details.",
      completed: "Review the saved call outcome. If evidence is missing, investigate the result before making a readiness decision.",
      failed: "Review the call outcome. Use the existing consent flow only if a new authorized attempt is appropriate.",
      canceled: "Review why the call was canceled. Use the existing consent flow only if a new authorized attempt is appropriate.",
      no_answer: "Confirm the number and timing, then approve a new attempt only if appropriate.",
      declined: "Respect the decline. Do not approve a new attempt to the same number without a clear reason to try again.",
      voicemail: "Decide whether to leave the follow-up to the coordinator, or approve a new attempt at a different time.",
      busy: "Approve a new attempt later if appropriate; the line was busy, not unreachable.",
      expired: "Review why the attempt expired, then approve a new attempt only if appropriate.",
      unknown: "Review the call attempt status before deciding whether the existing consent flow should be used.",
    };
    return {
      state: "no_call_evidence",
      tone: "attention",
      title: "No call evidence yet",
      explanation: explanationByCompletion[brief.call_completion_status],
      nextAction: nextActionByCompletion[brief.call_completion_status],
      reviewPending,
      reviewMessage,
    };
  }

  if (brief.readiness_status === "needs_follow_up" || metrics.followUpDetails > 0 || metrics.incompleteEvidenceAreas > 0) {
    const followUpSentence = metrics.followUpDetails > 0
      ? `${countLabel(metrics.followUpDetails, "follow-up detail")} ${metrics.followUpDetails === 1 ? "remains" : "remain"} open from the call.`
      : "No specific follow-up detail was recorded from the call.";
    const evidenceSentence = metrics.incompleteEvidenceAreas > 0
      ? `${countLabel(metrics.incompleteEvidenceAreas, "evidence area")} ${metrics.incompleteEvidenceAreas === 1 ? "is" : "are"} missing or uncertain.`
      : "The required evidence areas do not all support a ready decision yet.";
    return {
      state: "needs_follow_up",
      tone: "attention",
      title: "Needs follow-up",
      explanation: `Call evidence is present. ${followUpSentence} ${evidenceSentence} Keep these gaps visible until the underlying details are independently confirmed.`,
      nextAction: "Review each open detail and resolve missing or uncertain evidence before using the brief for technician review.",
      reviewPending,
      reviewMessage,
    };
  }

  if (brief.readiness_status === "ready_for_technician_review") {
    return {
      state: "ready_for_technician_review",
      tone: "good",
      title: "Ready for technician review",
      explanation: "Every required evidence area is confirmed by call evidence, and no explicit visit blocker is recorded. This is a review decision, not a booking, diagnosis, or guarantee that the visit can proceed.",
      nextAction: reviewPending
        ? "Complete the human review before handing this brief to the next person. No appointment is booked by this workspace."
        : "Use this brief for technician review. No appointment is booked by this workspace.",
      reviewPending,
      reviewMessage,
    };
  }

  return {
    state: "evidence_incomplete",
    tone: "neutral",
    title: "Evidence still incomplete",
    explanation: "Call evidence is present, but the brief has not reached a complete readiness state. Unknown or unverified areas remain visible for review.",
    nextAction: "Review call completion and each evidence area before deciding what to do next.",
    reviewPending,
    reviewMessage,
  };
}

export type DemoFlowStageKey = "preparation" | "call_evidence" | "readiness" | "human_review";
export type DemoFlowStageState = "complete" | "current" | "attention" | "blocked" | "pending";
export interface DemoFlowStage {
  key: DemoFlowStageKey;
  label: string;
  status: string;
  detail: string;
  state: DemoFlowStageState;
}

export function demoFlowFor(brief: RepairBriefView): DemoFlowStage[] {
  const metrics = readinessMetricsFor(brief);
  const decision = readinessDecisionFor(brief);
  const callEvidenceStage: DemoFlowStage = metrics.callEvidenceAreas > 0
    ? {
        key: "call_evidence",
        label: "Call evidence",
        status: "Received",
        detail: `Call evidence is saved for ${countLabel(metrics.callEvidenceAreas, "evidence area")}.`,
        state: "complete",
      }
    : {
        key: "call_evidence",
        label: "Call evidence",
        status: "Awaiting evidence",
        detail: brief.call_completion_status === "in_progress"
          ? "The call is in progress. No call evidence is saved yet."
          : "No call-reported evidence is saved yet.",
        state: brief.call_completion_status === "in_progress" ? "current" : "pending",
      };
  const readinessStage: DemoFlowStage = {
    key: "readiness",
    label: "Readiness decision",
    status: "Available",
    detail: `${decision.title} is calculated from the saved brief.`,
    state: decision.state === "blocked" ? "blocked" : decision.state === "ready_for_technician_review" ? "complete" : "current",
  };
  const reviewStage: DemoFlowStage = metrics.followUpDetails > 0 || brief.human_review_state === "needs_follow_up"
    ? {
        key: "human_review",
        label: "Human review",
        status: "Follow-up active",
        detail: metrics.followUpDetails > 0
          ? `${countLabel(metrics.followUpDetails, "reported detail")} ${metrics.followUpDetails === 1 ? "is" : "are"} in the review list.`
          : "Coordinator review marked follow-up.",
        state: "attention",
      }
    : brief.human_review_state === "reviewed"
      ? {
          key: "human_review",
          label: "Human review",
          status: "Review recorded",
          detail: "Coordinator review is saved without changing evidence or readiness.",
          state: "complete",
        }
      : {
          key: "human_review",
          label: "Human review",
          status: "Pending",
          detail: "Human review has not been saved yet.",
          state: "pending",
        };

  return [
    {
      key: "preparation",
      label: "Preparation",
      status: "Ready",
      detail: "The private brief is loaded.",
      state: "complete",
    },
    callEvidenceStage,
    readinessStage,
    reviewStage,
  ];
}

function emptyEvidence(key: EvidenceKey): EvidenceItem {
  return { key, label: LABELS[key], status: "missing", source: null, value: null, supporting_excerpt: null };
}
function sanitizeEvidenceItem(raw: unknown, key: EvidenceKey, forcedSource?: EvidenceSource): EvidenceItem {
  const item = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const source = forcedSource ?? (item.source === "call_reported" ? "call_reported" : "coordinator");
  const value = safeBriefText(item.value, LIMITS.evidence);
  const excerpt = safeExcerpt(item.supporting_excerpt) || null;
  if (source === "coordinator") {
    return { key, label: LABELS[key], status: value ? "unverified" : "missing", source: value ? "coordinator" : null, value: value || null, supporting_excerpt: null };
  }
  const supplied = normalizeEnum(item.status, ["confirmed", "missing", "uncertain", "unverified"] as const, "uncertain");
  return { key, label: LABELS[key], status: value ? supplied : "missing", source: "call_reported", value: value || null, supporting_excerpt: excerpt };
}
function parseStoredJson(value: unknown, max: number): unknown {
  const serialized = text(value, max);
  if (!serialized) return [];
  try { return JSON.parse(serialized); } catch { return []; }
}
/** Only explicit call-reported rows from the persisted brief cross the review-save boundary. */
function persistedCallReportedEvidence(raw: unknown): EvidenceItem[] {
  const byKey = new Map<EvidenceKey, unknown>();
  (Array.isArray(raw) ? raw : []).forEach((item) => {
    const row = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : null;
    const key = row?.key;
    if (row?.source === "call_reported" && typeof key === "string" && (BRIEF_EVIDENCE_KEYS as readonly string[]).includes(key)) byKey.set(key as EvidenceKey, item);
  });
  return BRIEF_EVIDENCE_KEYS.flatMap((key) => byKey.has(key) ? [sanitizeEvidenceItem(byKey.get(key), key, "call_reported")] : []);
}
function persistedCallReportedFollowUps(raw: unknown): BriefFollowUp[] {
  const seen = new Set<string>();
  return (Array.isArray(raw) ? raw : []).slice(0, LIMITS.followUps).flatMap((item) => {
    const row = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : null;
    if (row?.source !== "call_reported") return [];
    const value = safeBriefText(row.value, LIMITS.followUp);
    const key = value ? followUpKey(value) : "";
    if (!value || !key || seen.has(key)) return [];
    seen.add(key);
    return [{ key, value, source: "call_reported" as const }];
  });
}
function validatedFollowUpReviews(raw: unknown, followUps: BriefFollowUp[]): FollowUpReview[] {
  const current = new Map(followUps.map((item) => [item.key, item]));
  const seen = new Set<string>();
  return (Array.isArray(raw) ? raw : []).slice(0, LIMITS.followUps * 2).flatMap((item) => {
    const row = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : null;
    const key = text(row?.key, 80);
    const value = safeBriefText(row?.value, LIMITS.followUp);
    const matching = current.get(key);
    if (!matching || matching.value !== value || seen.has(key)) return [];
    seen.add(key);
    return [{ key, value: matching.value, status: normalizeEnum(row?.status, ["open", "reviewed"] as const, "open"), note: safeBriefText(row?.note, LIMITS.followUpReviewNote) }];
  });
}
function normalizeFollowUpReviews(raw: unknown, followUps: BriefFollowUp[]): FollowUpReview[] {
  const supplied = new Map(validatedFollowUpReviews(raw, followUps).map((item) => [item.key, item]));
  return followUps.map((item) => supplied.get(item.key) ?? { key: item.key, value: item.value, status: "open" as const, note: "" });
}
function mergeFollowUpReviews(followUps: BriefFollowUp[], existingRaw: unknown, requestedRaw: unknown): FollowUpReview[] {
  const merged = new Map(validatedFollowUpReviews(existingRaw, followUps).map((item) => [item.key, item]));
  validatedFollowUpReviews(requestedRaw, followUps).forEach((item) => merged.set(item.key, item));
  return normalizeFollowUpReviews(Array.from(merged.values()), followUps);
}
function localEvidence(job: RepairJobRecord): EvidenceItem[] {
  const val = (v: unknown) => safeBriefText(v, LIMITS.evidence);
  const values: Record<EvidenceKey, string> = {
    appliance_identity: [val(job.brand), val(job.model)].filter(Boolean).join(" · "),
    symptoms: val(job.reported_problem),
    timing: val(job.symptom_timing),
    error_code: val(job.error_code),
    visit_logistics: val(job.access_notes),
  };
  return BRIEF_EVIDENCE_KEYS.map((key) => sanitizeEvidenceItem({ key, source: "coordinator", value: values[key] }, key));
}
/** Future CALL-E result boundary. Only explicitly call-reported items may be confirmed. */
export function mergeCallReportedEvidence(base: EvidenceItem[], raw: unknown): EvidenceItem[] {
  const next = new Map(base.map((item) => [item.key, item]));
  const incoming = Array.isArray(raw) ? raw : [];
  incoming.forEach((item) => {
    const key = item && typeof item === "object" ? (item as Record<string, unknown>).key : null;
    if (typeof key === "string" && (BRIEF_EVIDENCE_KEYS as readonly string[]).includes(key)) next.set(key as EvidenceKey, sanitizeEvidenceItem(item, key as EvidenceKey, "call_reported"));
  });
  return BRIEF_EVIDENCE_KEYS.map((key) => next.get(key) ?? emptyEvidence(key));
}

function sanitizeBlockers(raw: unknown): BriefBlocker[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 8).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const value = safeBriefText(row.value, LIMITS.evidence);
    const source = row.source === "call_reported" || row.source === "coordinator" ? row.source : null;
    if (!value || !source) return [];
    return [{ value, source, supporting_excerpt: safeExcerpt(row.supporting_excerpt) || null }];
  });
}

/**
 * Builds a short, targeted question set for a follow-up call that asks only about what the
 * previous call left unresolved — not the full intake questionnaire again. Always opens with
 * the same identity/consent confirmation as a fresh call, since consent is never assumed to
 * carry over from a prior attempt.
 */
export function targetedFollowUpQuestions(brief: Pick<RepairBriefView, "follow_ups" | "evidence">): string[] {
  const questions: string[] = [
    "Confirm you are speaking with the intended customer and that they agree to a brief follow-up conversation about a few remaining details. Do not ask for passwords or access codes.",
  ];
  brief.follow_ups.forEach((item) => {
    questions.push(`Ask specifically about this previously unresolved detail: "${item.value}". Get a clear, explicit answer rather than accepting a vague one, and do not re-ask about anything already confirmed.`);
  });
  brief.evidence
    .filter((item) => item.status === "missing" || item.status === "uncertain")
    .forEach((item) => {
      questions.push(`Confirm ${item.label.toLowerCase()}, since this was not clearly established on the previous call.`);
    });
  questions.push(
    "Final check: verify every material answer in this follow-up is explicit before ending. Do not diagnose, recommend repairs, schedule, take payment, or request security codes, credentials, passwords, or other sensitive access information."
  );
  return questions.slice(0, 10);
}

export function assessReadiness(evidence: EvidenceItem[], blockers: BriefBlocker[], completion: CallCompletionStatus, followUps: BriefFollowUp[] = []): ReadinessStatus {
  if (blockers.length) return "blocked";
  if (followUps.length) return "needs_follow_up";
  if (evidence.some((item) => item.status === "missing" || item.status === "uncertain")) return "needs_follow_up";
  if (completion !== "completed") return "unknown";
  if (evidence.some((item) => item.status === "unverified")) return "unknown";
  if (evidence.every((item) => item.source === "call_reported" && item.status === "confirmed")) return "ready_for_technician_review";
  return "unknown";
}

export function callCompletionFromAttempt(attempt?: { provider_status?: string | null } | null): CallCompletionStatus {
  if (attempt?.provider_status === "queued") return "in_progress";
  return normalizeEnum(attempt?.provider_status, CALL_COMPLETION_STATUSES, "not_started");
}
const APPLIANCE_SPECIFIC_QUESTIONS: Partial<Record<RepairJobRecord["appliance_type"], string>> = {
  washing_machine: "Ask whether there is any visible water leak, and if so, whether it comes from the front, the back, or underneath the machine.",
  dryer: "Ask whether it is a gas or electric dryer, when the lint trap and vent were last cleaned, and whether there is any burning smell when it runs.",
  dishwasher: "Ask whether there is any visible water leak on the floor around the unit, and whether the drain hose has a high loop or air gap installed.",
  refrigerator: "Ask what temperature the fridge and freezer sections are currently reading, and whether any food has spoiled.",
  oven_range: "Ask whether it is gas or electric, and if gas, whether there has ever been a smell of gas near the appliance.",
};

/** One extra question specific to the appliance category, layered on top of the generic outline
 * below. Kept in a lookup rather than branching logic so adding another appliance type later is
 * a one-line addition, not a new code path. */
export function applianceSpecificQuestion(applianceType: RepairJobRecord["appliance_type"]): string | null {
  return APPLIANCE_SPECIFIC_QUESTIONS[applianceType] ?? null;
}

/**
 * Detailed enough that asking the granular access breakdown again would mostly re-confirm
 * rather than discover anything -- a coordinator who already wrote a real paragraph gets one
 * verification question instead of six granular ones. Deliberately conservative (a short note
 * like "3rd floor" still triggers the full breakdown) so nothing genuinely unknown gets skipped.
 */
function hasDetailedAccessNotes(job: RepairJobRecord): boolean {
  return (job.access_notes ?? "").trim().length >= 40;
}

/**
 * Ordered by diagnostic/safety priority, not interview convenience: if the call disconnects
 * partway through (hang-up, dropped line, voicemail cutoff), whatever ran first is what survives.
 * Safety-relevant and high-value questions are front-loaded; verification and access-logistics
 * detail come later since losing those costs a follow-up call, not a missed hazard.
 *
 * `skip` lets a question drop out entirely when the coordinator's intake already answered it in
 * enough detail that re-asking would only re-confirm, not discover -- the interview's stopping
 * criterion. Everything else is always asked, even when partially known, because CALL-E's live
 * confirmation is the thing that actually moves an evidence area from "coordinator-entered" to
 * "call-confirmed."
 */
function adaptiveQuestionPlan(job: RepairJobRecord): Array<{ safetyRelevant: boolean; skip?: boolean; text: string }> {
  const applianceQuestion = applianceSpecificQuestion(job.appliance_type);
  return [
    {
      safetyRelevant: false,
      text: "Confirm you are speaking with the intended customer and that they agree to a short preparation conversation. Do not ask for passwords or access codes.",
    },
    {
      safetyRelevant: false,
      text: job.brand?.trim() && job.model?.trim()
        ? "Read back the saved appliance brand and full model number, then ask the customer to correct either one if needed."
        : "Ask the customer to read the appliance brand and full model number exactly as shown on the appliance.",
    },
    // Appliance-specific probes (gas smell, burning smell, vent condition) are frequently the
    // single highest safety-relevance question in the whole outline -- asked right after identity
    // so it survives even a call that disconnects early.
    ...(applianceQuestion ? [{ safetyRelevant: true, text: applianceQuestion }] : []),
    {
      safetyRelevant: false,
      text: "Ask for the symptoms in the customer's own words. If the description is broad, ask one neutral follow-up for what the sound or sensation is like and what the appliance is doing when it starts. Preserve their words and do not suggest a cause or repair.",
    },
    {
      safetyRelevant: false,
      text: "Separate the trigger from the operating moment: ask whether it starts while loading or turning the appliance on, then whether it happens during fill, wash, drain, spin, or another clearly described moment, and how consistently.",
    },
    {
      safetyRelevant: false,
      text: job.error_code?.trim()
        ? "Read back the saved error code and ask the customer to confirm it or explicitly say that no code is displayed. Never infer none from silence."
        : "Ask whether an error code is displayed. If none is visible, record an explicit no-error-code answer rather than inferring one.",
    },
    {
      safetyRelevant: false,
      skip: hasDetailedAccessNotes(job),
      text: "Review or ask separately whether the building is a condo or apartment or another type. Capture a floor or unit only when appropriate for the private job, and never request a door, entry, alarm, security code, PIN, password, or credential.",
    },
    {
      safetyRelevant: false,
      skip: hasDetailedAccessNotes(job),
      text: "Ask separately whether an elevator or stairs are needed, whether any route is narrow or restricted, and whether the route to the appliance and the available workspace are clear.",
    },
    {
      safetyRelevant: false,
      skip: hasDetailedAccessNotes(job),
      text: "Ask about nearby parking or a loading zone, including rules, time limits, permits, or validation.",
    },
    {
      safetyRelevant: false,
      skip: hasDetailedAccessNotes(job),
      text: "Ask whether pets are present and what safe access plan the technician should follow.",
    },
    {
      safetyRelevant: false,
      skip: hasDetailedAccessNotes(job),
      text: "Ask for the exact days and hours when access is available and any blackout times. Treat this as an access window, not a scheduled appointment.",
    },
    {
      safetyRelevant: false,
      skip: hasDetailedAccessNotes(job),
      text: "Ask how concierge registration works, whether advance notice or lead time is required, and whether the technician must bring a business card or other non-sensitive business identification.",
    },
    // Read back only when the granular breakdown above was skipped -- otherwise this would just
    // duplicate the six questions it replaces.
    ...(hasDetailedAccessNotes(job)
      ? [{
          safetyRelevant: false,
          text: "Read back the saved access notes in full and ask the customer to confirm them or correct anything that has changed, covering building type, elevator or stairs, parking, pets, access hours, and any concierge or registration step.",
        }]
      : []),
    {
      safetyRelevant: false,
      text: "Ask whether the participant explicitly cannot provide access or whether an unresolved requirement would prevent the visit. Put ordinary requirements in access_constraints, unknown details as unknown or incomplete, and only explicit blockers in visit_blockers. If no blocker is explicitly stated, leave visit_blockers empty.",
    },
    {
      safetyRelevant: false,
      text: "Final checklist and review-only boundary: verify every material answer is explicit. Record each unresolved or vague material answer as a missing detail and mark the result incomplete or uncertain instead of silently treating it as complete. This outline does not place a call or edit call evidence. Never diagnose, give repair advice, schedule, take payment, or request codes, passwords, credentials, or other sensitive access information.",
    },
  ];
}

export function adaptiveQuestionsForJob(job: RepairJobRecord): string[] {
  return adaptiveQuestionPlan(job)
    .filter((item) => !item.skip)
    .map((item) => item.text);
}

function sanitizeOutcome(raw: unknown): RepairOutcome | null {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!row) return null;
  const recordedAt = text(row.recorded_at, 80);
  if (!recordedAt) return null;
  return {
    actual_diagnosis: safeBriefText(row.actual_diagnosis, 300),
    part_used: safeBriefText(row.part_used, 160),
    repair_completed: row.repair_completed === true,
    second_visit_required: row.second_visit_required === true,
    recorded_at: recordedAt,
  };
}

/** A repair is only "first-time-fix" if it was completed on this visit AND no second visit is
 * required for the same issue. Absence of a recorded outcome is not treated as either yes or no. */
export function isFirstTimeFix(outcome: RepairOutcome | null): boolean | null {
  if (!outcome) return null;
  return outcome.repair_completed && !outcome.second_visit_required;
}

export interface FirstTimeFixSummary {
  recorded: number;
  firstTimeFixes: number;
  rate: number;
}

/** Aggregate first-time-fix rate over a set of briefs. Only briefs with a recorded outcome count
 * toward the denominator -- jobs still in progress don't silently drag the rate down. Returns
 * null (not 0) when nothing has been recorded yet, so the UI can say "not enough data" instead of
 * a misleading 0%. */
export function firstTimeFixRate(briefs: Array<Pick<RepairBriefView, "outcome">>): FirstTimeFixSummary | null {
  const recorded = briefs.flatMap((b) => (b.outcome ? [b.outcome] : []));
  if (!recorded.length) return null;
  const firstTimeFixes = recorded.filter((o) => isFirstTimeFix(o) === true).length;
  return { recorded: recorded.length, firstTimeFixes, rate: firstTimeFixes / recorded.length };
}

export function buildBriefPreview(job: RepairJobRecord, attempt?: { id?: string; provider_status?: string | null } | null): RepairBriefView {
  const evidence = localEvidence(job);
  const completion = callCompletionFromAttempt(attempt);
  const view: RepairBriefView = { repair_job_id: job.id, call_attempt_id: text(attempt?.id, LIMITS.id), call_completion_status: completion, readiness_status: "unknown", human_review_state: "not_reviewed", human_review_note: "", reviewed_at: "", evidence, follow_ups: [], follow_up_reviews: [], blockers: [], outcome: null, safe_summary: "", share_token: null, share_expires_at: null };
  view.readiness_status = assessReadiness(evidence, [], completion, view.follow_ups);
  view.safe_summary = buildSafeBriefSummary(view, job);
  return view;
}
function normalizeReviewState(value: unknown): HumanReviewState {
  return normalizeEnum(value, ["not_reviewed", "reviewed", "needs_follow_up"] as const, "not_reviewed");
}
function normalizeCompletion(value: unknown, fallback: CallCompletionStatus): CallCompletionStatus {
  return normalizeEnum(value, CALL_COMPLETION_STATUSES, fallback);
}
function normalizeStored(raw: RepairBriefRecordLike, job: RepairJobRecord, attempt?: { id?: string; provider_status?: string | null } | null): RepairBriefView {
  const local = localEvidence(job);
  // Loading observes persisted call evidence and follow-ups only. Browser state never becomes evidence here.
  const evidence = mergeCallReportedEvidence(local, persistedCallReportedEvidence(parseStoredJson(raw.evidence_json, 14000)));
  const followUps = persistedCallReportedFollowUps(parseStoredJson(raw.follow_up_json, LIMITS.followUpJson));
  const followUpReviews = validatedFollowUpReviews(parseStoredJson(raw.follow_up_review_json, LIMITS.followUpReviewJson), followUps);
  const blockers = sanitizeBlockers(parseStoredJson(raw.blockers_json, 7000));
  const attemptCompletion = callCompletionFromAttempt(attempt);
  const hasAttemptStatus = typeof attempt?.provider_status === "string" && attempt.provider_status.trim().length > 0;
  const completion = hasAttemptStatus ? attemptCompletion : normalizeCompletion(raw.call_completion_status, attemptCompletion);
  const view: RepairBriefView = { id: text(raw.id, LIMITS.id) || undefined, repair_job_id: job.id, call_attempt_id: text(raw.call_attempt_id, LIMITS.id) || text(attempt?.id, LIMITS.id), call_completion_status: completion, readiness_status: "unknown", human_review_state: normalizeReviewState(raw.human_review_state), human_review_note: safeBriefText(raw.human_review_note, LIMITS.note), reviewed_at: text(raw.reviewed_at, 80), evidence, follow_ups: followUps, follow_up_reviews: followUpReviews, blockers, outcome: sanitizeOutcome(parseStoredJson(raw.outcome_json, 1200)), safe_summary: "", share_token: typeof raw.share_token === "string" && raw.share_token ? raw.share_token : null, share_expires_at: typeof raw.share_expires_at === "string" && raw.share_expires_at ? raw.share_expires_at : null, updated_at: raw.updated_at, updated_date: raw.updated_date };
  view.readiness_status = assessReadiness(evidence, view.blockers, completion, followUps);
  view.safe_summary = buildSafeBriefSummary(view, job);
  return view;
}
type RepairBriefRecordLike = Partial<RepairBriefView> & { evidence_json?: string; blockers_json?: string; follow_up_json?: string; follow_up_review_json?: string; outcome_json?: string; id?: string; call_attempt_id?: string; call_completion_status?: string; human_review_state?: string; human_review_note?: string; reviewed_at?: string };

/**
 * Selects and normalizes the newest saved brief for a queue item in one bulk read.
 * A brief tied to the newest attempt wins; otherwise the newest saved brief wins.
 */
export function selectPersistedRepairBriefForQueue(
  rawRows: unknown[],
  job: RepairJobRecord,
  attempt?: { id?: string; provider_status?: string | null } | null,
): RepairBriefView | null {
  const rows = rawRows.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const row = raw as RepairBriefRecordLike;
    const repairJobId = text(row.repair_job_id, LIMITS.id);
    const id = text(row.id, LIMITS.id);
    return repairJobId === job.id && id ? [row] : [];
  });
  if (!rows.length) return null;
  const attemptId = text(attempt?.id, LIMITS.id);
  const selected = (attemptId && rows.find((row) => text(row.call_attempt_id, LIMITS.id) === attemptId)) ?? rows[0];
  return selected ? normalizeStored(selected, job, attempt) : null;
}

async function listBriefs(jobId: string): Promise<RepairBriefRecordLike[]> {
  const rows = await RepairBrief.filter({ repair_job_id: jobId }, "-updated_date", 20);
  return (rows as RepairBriefRecordLike[]) ?? [];
}
export async function loadRepairBrief(job: RepairJobRecord, attempt?: { id?: string; provider_status?: string | null } | null): Promise<RepairBriefView> {
  const rows = await listBriefs(job.id);
  const attemptId = text(attempt?.id, LIMITS.id);
  const row = (attemptId && rows.find((candidate) => text(candidate.call_attempt_id, LIMITS.id) === attemptId)) ?? rows[0];
  return row ? normalizeStored(row, job, attempt) : buildBriefPreview(job, attempt);
}
export interface SaveBriefOptions {
  human_review_state: HumanReviewState;
  human_review_note: string;
  follow_up_reviews: FollowUpReview[];
  call_attempt_id?: string;
}
export async function saveRepairBrief(job: RepairJobRecord, current: RepairBriefView, options: SaveBriefOptions): Promise<RepairBriefView> {
  const rows = (await listBriefs(job.id)).filter((row) => text(row.id, LIMITS.id));
  const requestedAttemptId = text(options.call_attempt_id ?? current.call_attempt_id, LIMITS.id);
  const existing = (requestedAttemptId && rows.find((row) => text(row.call_attempt_id, LIMITS.id) === requestedAttemptId)) ?? rows[0];
  const persistedAttemptRows = requestedAttemptId ? await CallAttempt.filter({ id: requestedAttemptId }, "-updated_date", 1) : [];
  const persistedAttempt = (persistedAttemptRows as Array<{ id?: string; repair_job_id?: string; provider_status?: string | null }>)[0];
  // Review saves edit review fields only. Fresh coordinator data comes from the job;
  // persisted call evidence, follow-ups, blockers, and completion are the sole trusted review inputs.
  const evidence = mergeCallReportedEvidence(localEvidence(job), existing ? persistedCallReportedEvidence(parseStoredJson(existing.evidence_json, 14000)) : []);
  const followUps = existing ? persistedCallReportedFollowUps(parseStoredJson(existing.follow_up_json, LIMITS.followUpJson)) : [];
  const followUpReviews = existing ? mergeFollowUpReviews(followUps, parseStoredJson(existing.follow_up_review_json, LIMITS.followUpReviewJson), options.follow_up_reviews) : [];
  const blockers = existing ? sanitizeBlockers(parseStoredJson(existing.blockers_json, 7000)) : [];
  const attemptMatchesJob = persistedAttempt?.repair_job_id === job.id;
  const completion = attemptMatchesJob && persistedAttempt?.provider_status
    ? callCompletionFromAttempt(persistedAttempt)
    : existing
      ? normalizeCompletion(existing.call_completion_status, "not_started")
      : "not_started";
  const attemptId = text(existing?.call_attempt_id, LIMITS.id) || requestedAttemptId;
  const reviewState = normalizeReviewState(options.human_review_state);
  const reviewNote = safeBriefText(options.human_review_note, LIMITS.note);
  const reviewedAt = reviewState === "not_reviewed" ? "" : new Date().toISOString();
  const outcome = existing ? sanitizeOutcome(parseStoredJson(existing.outcome_json, 1200)) : null;
  const snapshot: RepairBriefView = { id: text(existing?.id, LIMITS.id) || undefined, repair_job_id: job.id, call_attempt_id: attemptId, call_completion_status: completion, readiness_status: assessReadiness(evidence, blockers, completion, followUps), human_review_state: reviewState, human_review_note: reviewNote, reviewed_at: reviewedAt, evidence, follow_ups: followUps, follow_up_reviews: followUpReviews, blockers, outcome, safe_summary: "" };
  snapshot.safe_summary = buildSafeBriefSummary(snapshot, job);
  const payload = { repair_job_id: job.id, call_attempt_id: attemptId, call_completion_status: completion, readiness_status: snapshot.readiness_status, human_review_state: reviewState, human_review_note: reviewNote, reviewed_at: reviewedAt, evidence_json: JSON.stringify(evidence), blockers_json: JSON.stringify(blockers), follow_up_json: JSON.stringify(followUps).slice(0, LIMITS.followUpJson), follow_up_review_json: JSON.stringify(followUpReviews).slice(0, LIMITS.followUpReviewJson), safe_summary: snapshot.safe_summary.slice(0, LIMITS.summary) };
  const saved = existing ? await RepairBrief.update(String(existing.id), payload) : await RepairBrief.create(payload);
  return normalizeStored({ ...(existing ?? {}), ...(saved as RepairBriefRecordLike), ...payload }, job, { id: attemptId });
}

/** Records (or replaces) the post-visit outcome on an already-saved brief. Separate from
 * saveRepairBrief because outcome capture is a distinct action from human review -- a coordinator
 * reviewing a brief shouldn't accidentally overwrite an outcome, and recording an outcome
 * shouldn't require re-submitting review state. */
export async function saveRepairOutcome(brief: RepairBriefView, input: Pick<RepairOutcome, "actual_diagnosis" | "part_used" | "repair_completed" | "second_visit_required">): Promise<RepairBriefView> {
  if (!brief.id) throw new Error("Save the brief before recording a visit outcome.");
  const outcome: RepairOutcome = {
    actual_diagnosis: safeBriefText(input.actual_diagnosis, 300),
    part_used: safeBriefText(input.part_used, 160),
    repair_completed: input.repair_completed === true,
    second_visit_required: input.second_visit_required === true,
    recorded_at: new Date().toISOString(),
  };
  await RepairBrief.update(brief.id, { outcome_json: JSON.stringify(outcome).slice(0, 1200) });
  return { ...brief, outcome };
}

export function buildSafeBriefSummary(brief: RepairBriefView, job?: RepairJobRecord): string {
  const lines = ["RepairReady technician brief", job ? `Job: ${safeBriefText(job.customer_name, 80) || "Unknown"}` : "", job ? `Appliance: ${applianceLabel(job.appliance_type)}` : "", `Call completion: ${completionLabel(brief.call_completion_status)}`, `Business readiness: ${readinessLabel(brief.readiness_status)}`, "", "Evidence"];
  brief.evidence.forEach((item) => { lines.push(`- ${item.label}: ${evidenceStatusLabel(item.status)} · ${evidenceSourceLabel(item.source)} · ${item.value || "Unknown"}`); if (item.supporting_excerpt) lines.push(`  Supporting excerpt: “${item.supporting_excerpt}”`); });
  lines.push("", "Follow-up details");
  const reviews = new Map(brief.follow_up_reviews.map((item) => [item.key, item]));
  const safeFollowUps = brief.follow_ups.flatMap((item) => { const value = safeBriefText(item.value, LIMITS.followUp); return value ? [{ ...item, value }] : []; });
  if (safeFollowUps.length) safeFollowUps.forEach((followUp) => { const review = reviews.get(followUp.key); const reviewLabel = review ? ` · ${followUpReviewLabel(review.status)}` : ""; lines.push(`- ${followUp.value} · ${evidenceSourceLabel(followUp.source)}${reviewLabel}`); const note = review ? safeBriefText(review.note, LIMITS.followUpReviewNote) : ""; if (note) lines.push(`  Coordinator note (unverified): ${note}`); }); else lines.push("- No specific follow-up details were recorded.");
  lines.push("", "Blockers");
  if (brief.blockers.length) brief.blockers.forEach((blocker) => lines.push(`- ${blocker.value} · ${evidenceSourceLabel(blocker.source)}${blocker.supporting_excerpt ? ` · “${blocker.supporting_excerpt}”` : ""}`)); else lines.push("- None explicitly recorded.");
  lines.push("", "Visit outcome");
  if (brief.outcome) {
    lines.push(`- Repair completed: ${brief.outcome.repair_completed ? "Yes" : "No"} · Second visit required: ${brief.outcome.second_visit_required ? "Yes" : "No"}`);
    if (brief.outcome.actual_diagnosis) lines.push(`- Actual diagnosis: ${brief.outcome.actual_diagnosis}`);
    if (brief.outcome.part_used) lines.push(`- Part used: ${brief.outcome.part_used}`);
  } else {
    lines.push("- Not recorded yet.");
  }
  lines.push("", `Human review: ${humanReviewLabel(brief.human_review_state)}`);
  if (brief.human_review_note) lines.push(`Review note: ${brief.human_review_note}`);
  lines.push("", "Coordinator entries are unverified. Follow-up review records human attention only; they do not confirm customer answers or change readiness.");
  return lines.filter((line, index) => line || (index > 0 && lines[index - 1])).join("\n").slice(0, LIMITS.summary);
}
const SHARE_LINK_WINDOW_MS = 48 * 60 * 60 * 1000;

function randomShareToken(): string {
  const uuid = (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID?.();
  return (uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`).replace(/-/g, "");
}

/** Creates (or replaces) a time-boxed, unauthenticated read-only link to this brief's safe summary. */
export async function createBriefShareLink(brief: RepairBriefView): Promise<RepairBriefView> {
  if (!brief.id) throw new Error("Save the brief before creating a share link.");
  const token = randomShareToken();
  const expiresAt = new Date(Date.now() + SHARE_LINK_WINDOW_MS).toISOString();
  await RepairBrief.update(brief.id, { share_token: token, share_expires_at: expiresAt });
  return { ...brief, share_token: token, share_expires_at: expiresAt };
}

/** Immediately invalidates any existing share link for this brief. */
export async function revokeBriefShareLink(brief: RepairBriefView): Promise<RepairBriefView> {
  if (!brief.id) throw new Error("This brief has not been saved yet.");
  await RepairBrief.update(brief.id, { share_token: null, share_expires_at: null });
  return { ...brief, share_token: null, share_expires_at: null };
}

export function isShareLinkActive(brief: Pick<RepairBriefView, "share_token" | "share_expires_at">): boolean {
  return Boolean(
    brief.share_token &&
      brief.share_expires_at &&
      Date.parse(brief.share_expires_at) > Date.now()
  );
}

export async function copyTextToClipboard(value: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this browser.");
  await navigator.clipboard.writeText(value);
}
