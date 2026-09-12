import { corsHeaders } from "./_shared/cors.ts";
import { ownerIdFromRequest, serviceClient } from "./_shared/auth.ts";

const CANONICAL_PHONE_RE = /^\+[1-9]\d{6,14}$/;
const REGION_RE = /^[A-Za-z]{2}$/;
const LOCALE_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
const APPROVAL_WINDOW_MS = 15 * 60 * 1000;

type ApproveResponse = {
  status: "approved" | "error";
  message: string;
  approval_expires_at?: string;
};

function jsonResponse(body: ApproveResponse, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Cache-Control": "no-store", "Content-Type": "application/json" },
  });
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 160;
}

function bounded(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  // SECURITY: Reject requests without Origin header to prevent CSRF attacks
  if (!origin) {
    return jsonResponse({ status: "error", message: "Origin header is required for security." }, 403, null);
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") {
    return jsonResponse({ status: "error", message: "Use the signed-in workspace to approve a call." }, 405, origin);
  }

  const ownerId = await ownerIdFromRequest(req);
  if (!ownerId) {
    return jsonResponse({ status: "error", message: "Your session could not be verified. Sign in again and retry." }, 401, origin);
  }
  const db = serviceClient();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ status: "error", message: "The approval request could not be read." }, 400, origin);
  }
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const repairJobId = input.repair_job_id;
  const callAttemptId = input.call_attempt_id;
  const confirmedPhone = bounded(input.confirmed_phone, 32);
  const region = bounded(input.region, 12).toUpperCase();
  const locale = bounded(input.locale, 24);

  if (!validId(repairJobId) || !validId(callAttemptId)) {
    return jsonResponse({ status: "error", message: "Select a repair job and its private preparation draft." }, 400, origin);
  }
  if (!CANONICAL_PHONE_RE.test(confirmedPhone)) {
    return jsonResponse({ status: "error", message: "Re-enter the exact recipient phone in +countrycode format to approve this call." }, 400, origin);
  }
  if (!REGION_RE.test(region) || !LOCALE_RE.test(locale)) {
    return jsonResponse({ status: "error", message: "Choose a valid two-letter region and locale before approving." }, 400, origin);
  }

  const { data: job } = await db.from("repair_jobs").select("*").eq("id", repairJobId).eq("created_by", ownerId).maybeSingle();
  if (!job) {
    return jsonResponse({ status: "error", message: "That job is not available." }, 404, origin);
  }
  const { data: attempt } = await db.from("call_attempts").select("*").eq("id", callAttemptId).eq("created_by", ownerId).maybeSingle();
  if (!attempt || attempt.repair_job_id !== job.id) {
    return jsonResponse({ status: "error", message: "That preparation draft does not belong to the selected job." }, 404, origin);
  }

  // The coordinator must re-type the exact number that's already saved on both the job and the
  // draft. This is the one deliberate point of friction before a real call can ever be approved.
  if (confirmedPhone !== bounded(job.phone, 32) || confirmedPhone !== bounded(attempt.recipient_phone, 32)) {
    return jsonResponse({ status: "error", message: "The number you entered does not exactly match the saved recipient. Nothing was approved." }, 422, origin);
  }
  if (attempt.lifecycle_status !== "prepared") {
    return jsonResponse({ status: "error", message: "This preparation draft is not in a state that can be approved." }, 409, origin);
  }
  if (attempt.approval_state === "approved") {
    return jsonResponse({ status: "error", message: "This draft is already approved. Dispatch it, or wait for the approval to expire before approving again." }, 409, origin);
  }
  if (hasText(attempt.provider_call_id) || hasText(attempt.provider_status) || hasText(attempt.submitted_at) || hasText(attempt.completed_at) || hasText(attempt.safe_error_category)) {
    return jsonResponse({ status: "error", message: "This preparation record already has saved provider state and needs review before it can be approved again." }, 409, origin);
  }

  const approvedAt = new Date();
  const expiresAt = new Date(approvedAt.getTime() + APPROVAL_WINDOW_MS);

  const { error } = await db
    .from("call_attempts")
    .update({
      approval_state: "approved",
      approved_recipient_phone: confirmedPhone,
      approved_at: approvedAt.toISOString(),
      approval_expires_at: expiresAt.toISOString(),
      recipient_region: region,
      recipient_locale: locale,
    })
    .eq("id", callAttemptId);

  if (error) {
    console.error("approve-calle-call persistence failed", error.message);
    return jsonResponse({ status: "error", message: "The approval could not be saved. Try again." }, 500, origin);
  }

  return jsonResponse(
    {
      status: "approved",
      message: `Approved to call ${confirmedPhone} until ${expiresAt.toLocaleTimeString()}. No call has been placed yet.`,
      approval_expires_at: expiresAt.toISOString(),
    },
    200,
    origin,
  );
});
