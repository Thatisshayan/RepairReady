import { corsHeaders } from "./_shared/cors.ts";
import { serviceClient } from "./_shared/auth.ts";

// Deliberately public / unauthenticated — this is the technician-facing read-only view.
// It must never return anything beyond the small allowlisted, already-sanitized fields below:
// no phone numbers, no coordinator's private review note, no ids, no owner information.
const TOKEN_RE = /^[A-Za-z0-9_-]{20,80}$/;

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

function parseJsonArray(value: unknown): unknown[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  // SECURITY: Reject requests without Origin header to prevent CSRF attacks
  if (!origin) {
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
