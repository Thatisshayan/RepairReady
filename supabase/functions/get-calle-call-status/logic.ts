// Pure, side-effect-free logic extracted from index.ts so it can be unit tested without
// starting a real Deno.serve() HTTP listener. No Deno.env, no fetch, no DB access here --
// zero behavior change versus the original inline definitions.

export const PROVIDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
export const REMOTE_STATUSES = ["queued", "in_progress", "completed", "failed", "canceled", "no_answer", "declined", "voicemail", "busy", "expired"] as const;
export type ProviderStatus = (typeof REMOTE_STATUSES)[number];
export type SafeErrorCategory = "provider_auth" | "validation" | "rate_or_credit" | "network" | "unexpected";
export type RecordLike = Record<string, unknown>;

export const LABELS = {
  appliance_identity: "Appliance brand and model",
  symptoms: "Symptoms in the customer's own words",
  timing: "When the symptom occurs",
  error_code: "Error code or explicit none",
  visit_logistics: "Access, parking, pets, and workspace",
} as const;
export type EvidenceKey = keyof typeof LABELS;
export const EVIDENCE_KEYS = Object.keys(LABELS) as EvidenceKey[];
export const SENSITIVE_RE = /(?:alarm|security|entry|access|gate|building|lock)\s*(?:code|pin|password|passcode)|password|credential/i;
export const PHONE_RE = /(?:\+\d[\d\s().-]{6,}|\b\d(?:[\d\s().-]*\d){6,}\b)/g;
export const FOLLOW_UP_LIMIT = 8;
export const FOLLOW_UP_MAX = 180;

export function bounded(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, max) : ""; // eslint-disable-line no-control-regex
}
export function validId(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 160; }
export function providerId(value: unknown): string { const id = bounded(value, 160); return PROVIDER_ID_RE.test(id) ? id : ""; }
export function providerStatus(value: unknown): ProviderStatus | null {
  if (typeof value !== "string") return null;
  // Defensive normalization: this repo has only ever observed lowercase snake_case statuses
  // ("queued", "completed", ...) from the live API, but CALL-E's own docs list some terminal
  // outcomes in uppercase with a "cancelled" (double L) spelling — normalize rather than assume.
  const normalized = value.trim().toLowerCase().replace(/^cancelled$/, "canceled");
  return (REMOTE_STATUSES as readonly string[]).includes(normalized) ? (normalized as ProviderStatus) : null;
}
export function safeValue(value: unknown, max = 420): string {
  const text = bounded(value, max);
  if (!text || SENSITIVE_RE.test(text)) return "";
  return text.replace(PHONE_RE, "[phone omitted]").slice(0, max);
}
export function safeArray(value: unknown): string[] {
  return Array.isArray(value) ? value.slice(0, 8).map((item) => safeValue(item, 180)).filter(Boolean) : [];
}
export function safeFollowUps(value: unknown): RecordLike[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, FOLLOW_UP_LIMIT).map((item) => safeValue(item, FOLLOW_UP_MAX)).filter(Boolean).map((item) => ({ value: item, source: "call_reported" }));
}
export function objectValue(value: unknown): RecordLike | null { return value && typeof value === "object" && !Array.isArray(value) ? value as RecordLike : null; }
export function hasOwn(value: RecordLike, key: string): boolean { return Object.prototype.hasOwnProperty.call(value, key); }
export function unknownValue(value: string): boolean { return /^(unknown|unclear|uncertain|not recorded|not provided|n\/a|none given)$/i.test(value.trim()); }
export function categoryForStatus(status: number): SafeErrorCategory {
  if (status === 401 || status === 403) return "provider_auth";
  if (status === 400 || status === 422) return "validation";
  if (status === 402 || status === 429) return "rate_or_credit";
  return "unexpected";
}
export function failureMessage(category: SafeErrorCategory): string {
  if (category === "provider_auth") return "CALL-E did not accept the saved provider authorization. No private status was changed.";
  if (category === "validation") return "CALL-E rejected the status request. No private status was changed.";
  if (category === "rate_or_credit") return "CALL-E could not return status because of a rate or account limit. No private status was changed.";
  if (category === "network") return "The provider status could not be confirmed. No private status was changed.";
  return "CALL-E returned an unexpected status response. No private status was changed.";
}
export function completionStatus(status: ProviderStatus): string {
  return status === "queued" || status === "in_progress" ? "in_progress" : status;
}
export function safeCompletedAt(body: RecordLike, status: ProviderStatus): string | null {
  if (!["completed", "failed", "canceled", "no_answer", "declined", "voicemail", "busy", "expired"].includes(status)) return null;
  const raw = bounded(body.completed_at, 80);
  const parsed = Date.parse(raw);
  return raw && !Number.isNaN(parsed) ? new Date(parsed).toISOString() : null;
}
export function structuredResult(body: RecordLike): RecordLike | null {
  const direct = objectValue(body.structured_result);
  if (direct) return direct;
  const recipients = Array.isArray(body.recipients) ? body.recipients : [];
  for (const recipient of recipients) {
    const result = objectValue(objectValue(recipient)?.structured_result);
    if (result) return result;
  }
  return null;
}
export function recipientResult(body: RecordLike, main: RecordLike | null): RecordLike | null {
  const direct = objectValue(body.recipient_result) ?? objectValue(body.recipient_structured_result);
  if (direct) return direct;
  const recipients = Array.isArray(body.recipients) ? body.recipients : [];
  for (const recipient of recipients) {
    const result = objectValue(objectValue(recipient)?.structured_result);
    if (result && (hasOwn(result, "preparation_consent") || hasOwn(result, "recipient_identity"))) return result;
  }
  return main && (hasOwn(main, "preparation_consent") || hasOwn(main, "recipient_identity")) ? main : null;
}
export function consentState(result: RecordLike | null): "confirmed" | "uncertain" | "not_confirmed" {
  const raw = result?.preparation_consent;
  return raw === "confirmed" || raw === "not_confirmed" || raw === "uncertain" ? raw : "uncertain";
}
export function evidenceItem(key: EvidenceKey, value: unknown, present: boolean, consent: string): RecordLike | null {
  if (!present) return null;
  const text = safeValue(value);
  const status = text && !unknownValue(text) ? consent === "confirmed" ? "confirmed" : "uncertain" : "missing";
  return { key, label: LABELS[key], status, source: "call_reported", value: text && !unknownValue(text) ? text : null, supporting_excerpt: null };
}
export function callEvidence(result: RecordLike | null, consent: string): RecordLike[] {
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
export function callBlockers(result: RecordLike | null): RecordLike[] {
  return safeArray(result?.visit_blockers).map((value) => ({ value, source: "call_reported", supporting_excerpt: null }));
}
const TRANSCRIPT_TURN_LIMIT = 60;
const TRANSCRIPT_TEXT_MAX = 400;
/** Structured transcript turns for this attempt, straight from CALL-E's own documented
 * `recipients[].attempts[].transcript_turns` shape -- real evidence of what was actually said,
 * not a narrated summary. Each turn's text goes through the same sensitive-term/phone scrubbing
 * as every other call-reported field before it's ever stored. */
export function callTranscript(body: RecordLike): RecordLike[] {
  const recipients = Array.isArray(body.recipients) ? body.recipients : [];
  for (const recipient of recipients) {
    const attempts = objectValue(recipient)?.attempts;
    if (!Array.isArray(attempts)) continue;
    for (const attempt of attempts) {
      const turns = objectValue(attempt)?.transcript_turns;
      if (!Array.isArray(turns) || turns.length === 0) continue;
      return turns.slice(0, TRANSCRIPT_TURN_LIMIT).flatMap((turn) => {
        const row = objectValue(turn);
        const text = safeValue(row?.text, TRANSCRIPT_TEXT_MAX);
        if (!row || !text) return [];
        const speaker = row.speaker === "bot" || row.speaker === "user" ? row.speaker : "unknown";
        const offset = typeof row.offset_seconds === "number" && Number.isFinite(row.offset_seconds) ? Math.max(0, Math.floor(row.offset_seconds)) : null;
        return [{ offset_seconds: offset, speaker, text }];
      });
    }
  }
  return [];
}
export function safeSummary(body: RecordLike, status: ProviderStatus, result: RecordLike | null, consent: string, blockers: RecordLike[], followUps: RecordLike[]): string {
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
export function parseStored(value: unknown, max: number): unknown[] {
  const raw = bounded(value, max);
  if (!raw) return [];
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
export function priorCallEvidence(raw: unknown): RecordLike[] {
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
export function mergeEvidence(previous: RecordLike[], incoming: RecordLike[]): RecordLike[] {
  const map = new Map<string, RecordLike>();
  for (const item of previous) { const key = bounded(item.key, 40); if (EVIDENCE_KEYS.includes(key as EvidenceKey)) map.set(key, item); }
  for (const item of incoming) { const key = bounded(item.key, 40); if (EVIDENCE_KEYS.includes(key as EvidenceKey)) map.set(key, item); }
  return EVIDENCE_KEYS.flatMap((key) => map.has(key) ? [map.get(key)!] : []);
}
export function priorCallBlockers(raw: unknown): RecordLike[] {
  return parseStored(raw, 7000).flatMap((item) => {
    const row = objectValue(item);
    const value = safeValue(row?.value);
    return row?.source === "call_reported" && value ? [{ value, source: "call_reported", supporting_excerpt: safeValue(row.supporting_excerpt, 280) || null }] : [];
  }).slice(0, 8) as RecordLike[];
}
export function priorCallFollowUps(raw: unknown): RecordLike[] {
  return parseStored(raw, 4000).flatMap((item) => {
    const row = objectValue(item);
    const value = safeValue(row?.value, FOLLOW_UP_MAX);
    return row?.source === "call_reported" && value ? [{ value, source: "call_reported" }] : [];
  }).slice(0, FOLLOW_UP_LIMIT) as RecordLike[];
}
export function normalizeReview(value: unknown): string { return ["not_reviewed", "reviewed", "needs_follow_up"].includes(String(value)) ? String(value) : "not_reviewed"; }
