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
