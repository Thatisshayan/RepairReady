// Pure, side-effect-free logic extracted from index.ts so it can be unit tested without
// starting a real Deno.serve() HTTP listener. No Deno.env, no fetch, no DB access here --
// zero behavior change versus the original inline definitions.

export const PROVIDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
export const EVENT_ID_RE = /^evt_[A-Za-z0-9_-]+$/;
export const REMOTE_STATUSES = ["queued", "in_progress", "completed", "failed", "canceled", "no_answer", "declined", "voicemail", "busy", "expired"] as const;
export type ProviderStatus = (typeof REMOTE_STATUSES)[number];

export function bounded(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
export function providerId(value: unknown): string {
  const id = bounded(value, 160);
  return PROVIDER_ID_RE.test(id) ? id : "";
}
export function providerStatus(value: unknown): ProviderStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/^cancelled$/, "canceled");
  return (REMOTE_STATUSES as readonly string[]).includes(normalized) ? (normalized as ProviderStatus) : null;
}
export function safeCompletedAt(body: Record<string, unknown>, status: ProviderStatus): string | null {
  if (!["completed", "failed", "canceled", "no_answer", "declined", "voicemail", "busy", "expired"].includes(status)) return null;
  const raw = bounded(body.completed_at, 80);
  const parsed = Date.parse(raw);
  return raw && !Number.isNaN(parsed) ? new Date(parsed).toISOString() : null;
}

/** Best-effort client IP from the standard proxy header, first entry only (the client's own
 * address -- later entries are proxies in the chain, spoofable by whoever added them). Falls
 * back to a single shared bucket if the header is missing, which is stricter, not weaker, than
 * per-IP limiting. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";
  const first = forwarded.split(",")[0]?.trim();
  return first && first.length <= 64 ? first : "unknown";
}

/** CALL-E's own webhook docs: "reject the request when that header does not match the body
 * event id." Format validity (EVENT_ID_RE) is checked separately -- this only confirms the two
 * copies of the id agree. */
export function eventIdMatches(headerId: string, bodyId: unknown): boolean {
  return typeof bodyId === "string" && bodyId.trim() === headerId;
}
