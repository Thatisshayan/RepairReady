export const CANONICAL_PHONE_RE = /^\+[1-9]\d{6,14}$/;
export const REGION_RE = /^[A-Za-z]{2}$/;
export const LOCALE_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
export const APPROVAL_WINDOW_MS = 15 * 60 * 1000;

export function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 160;
}

export function bounded(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
