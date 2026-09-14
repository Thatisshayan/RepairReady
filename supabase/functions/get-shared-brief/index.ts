import { corsHeaders, isAllowedOrigin } from "./_shared/cors.ts";
import { serviceClient } from "./_shared/auth.ts";
import { TOKEN_RE, parseJsonArray, clientIp } from "./logic.ts";

// Public and unauthenticated by design (a technician reads this without an account), so it needs
// its own rate limit rather than relying on RLS/auth to bound abuse.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const RATE_BUCKET_PREFIX = "get-shared-brief:";

type SharedBriefResponse = {
  status: "ok" | "not_found" | "expired" | "error";
  message: string;
  brief?: {
    safe_summary: string;
    readiness_status: string;
    call_completion_status: string;
    evidence: unknown[];
    blockers: unknown[];
    follow_ups: unknown[];
    expires_at: string;
  };
};

function jsonResponse(body: SharedBriefResponse, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Cache-Control": "no-store", "Content-Type": "application/json" },
  });
}

if (import.meta.main) {
  Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  // SECURITY: Reject requests from a missing or non-allowlisted Origin.
  if (!isAllowedOrigin(origin)) {
    return jsonResponse({ status: "error", message: "Origin header is required for security." }, 403, null);
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") {
    return jsonResponse({ status: "error", message: "Use a POST request with a share token." }, 405, origin);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ status: "error", message: "The share request could not be read." }, 400, origin);
  }
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const token = typeof input.share_token === "string" ? input.share_token.trim() : "";
  if (!TOKEN_RE.test(token)) {
    return jsonResponse({ status: "not_found", message: "This share link is invalid." }, 404, origin);
  }

  const db = serviceClient();

  const bucketKey = `${RATE_BUCKET_PREFIX}${clientIp(req)}`;
  const windowStart = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count } = await db
    .from("rate_limit_hits")
    .select("*", { count: "exact", head: true })
    .eq("bucket_key", bucketKey)
    .gte("created_at", windowStart);
  if ((count ?? 0) >= RATE_LIMIT) {
    return jsonResponse({ status: "error", message: "Too many requests. Try again in a minute." }, 429, origin);
  }
  await db.from("rate_limit_hits").insert({ bucket_key: bucketKey });
  // Opportunistic cleanup, not a separate cron job -- bounded by this bucket's own traffic.
  await db.from("rate_limit_hits").delete().eq("bucket_key", bucketKey).lt("created_at", new Date(Date.now() - 10 * RATE_WINDOW_MS).toISOString());

  const { data: brief } = await db
    .from("repair_briefs")
    .select("safe_summary, readiness_status, call_completion_status, evidence_json, blockers_json, follow_up_json, share_expires_at")
    .eq("share_token", token)
    .maybeSingle();

  if (!brief) {
    return jsonResponse({ status: "not_found", message: "This share link is invalid or has been revoked." }, 404, origin);
  }
  const expiresAt = typeof brief.share_expires_at === "string" ? brief.share_expires_at : "";
  if (!expiresAt || Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
    return jsonResponse({ status: "expired", message: "This share link has expired. Ask the coordinator for a fresh one." }, 410, origin);
  }

  return jsonResponse(
    {
      status: "ok",
      message: "Shared brief loaded.",
      brief: {
        safe_summary: typeof brief.safe_summary === "string" ? brief.safe_summary : "",
        readiness_status: typeof brief.readiness_status === "string" ? brief.readiness_status : "unknown",
        call_completion_status: typeof brief.call_completion_status === "string" ? brief.call_completion_status : "unknown",
        evidence: parseJsonArray(brief.evidence_json),
        blockers: parseJsonArray(brief.blockers_json),
        follow_ups: parseJsonArray(brief.follow_up_json),
        expires_at: expiresAt,
      },
    },
    200,
    origin,
  );
  });
}
