// Deliberately public / unauthenticated — this is the technician-facing read-only view.
// It must never return anything beyond the small allowlisted, already-sanitized fields below:
// no phone numbers, no coordinator's private review note, no ids, no owner information.
export const TOKEN_RE = /^[A-Za-z0-9_-]{20,80}$/;

export function parseJsonArray(value: unknown): unknown[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
