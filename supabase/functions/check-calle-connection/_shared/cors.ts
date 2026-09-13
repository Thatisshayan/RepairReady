// SECURITY: Explicit allowlist only. Never fall back to "*" and never reflect an
// arbitrary caller-supplied Origin back to the client -- both defeat the browser's
// same-origin protections for anyone who ever obtains a bearer token for this API.
const ALLOWED_ORIGINS = new Set([
  "https://repairready.vercel.app",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

export function isAllowedOrigin(origin: string | null): boolean {
  return origin !== null && ALLOWED_ORIGINS.has(origin);
}

export function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? (origin as string) : "",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}
