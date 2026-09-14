import { serviceClient } from "./_shared/auth.ts";
import { providerId, providerStatus, safeCompletedAt, EVENT_ID_RE } from "./logic.ts";

// SECURITY: CALL-E's published webhook spec documents no signature verification for this
// endpoint, so everything received here -- the event id, the event type, and especially the
// embedded call snapshot in `data` -- is treated as an untrusted "something may have changed,
// go check" hint only. It is NEVER written to the database directly. The only thing this
// function trusts is the provider call id extracted from the event, which it then uses to make
// its own authenticated GET request back to CALL-E (the same trusted call the existing polling
// path already makes) before writing anything. A forged or replayed webhook can therefore at
// worst trigger one extra, harmless status refresh -- it can never inject fabricated call
// results, transcripts, or outcomes into a technician brief.
//
// This intentionally does NOT duplicate the full evidence/brief-merge pipeline from
// get-calle-call-status/index.ts (recipient result parsing, sanitization, readiness fields).
// That logic is owner-JWT-scoped and reused as-is; this receiver only refreshes the lightweight
// top-level call_attempts status fields (provider_status, lifecycle_status, completed_at) so the
// readiness queue reflects reality immediately, even before a coordinator opens the job. Full
// evidence still populates the normal way the next time get-calle-call-status runs for that job.
const PROVIDER_URL = "https://api.heycall-e.com/v1/calls";

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return jsonResponse({ status: "error", message: "Use POST." }, 405);

  const eventId = req.headers.get("CALL-E-Event-Id");
  if (!eventId || !EVENT_ID_RE.test(eventId)) {
    return jsonResponse({ status: "error", message: "Missing or invalid event id." }, 400);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ status: "error", message: "Invalid JSON." }, 400);
  }
  const event = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const eventData = event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : {};
  const remoteId = providerId(eventData.id);
  // Untrusted hint only -- confirmed below via our own authenticated GET, never used as-is.
  if (!remoteId) return jsonResponse({ status: "ignored", message: "No usable call id in the event." }, 200);

  const calleKey = Deno.env.get("CALLE_API_KEY");
  if (!calleKey) return jsonResponse({ status: "error", message: "Not configured." }, 503);

  const db = serviceClient();
  const { data: attempt } = await db.from("call_attempts").select("id").eq("provider_call_id", remoteId).maybeSingle();
  if (!attempt?.id) return jsonResponse({ status: "ignored", message: "No matching private record for this call id." }, 200);

  let providerResponse: Response;
  try {
    providerResponse = await fetch(`${PROVIDER_URL}/${encodeURIComponent(remoteId)}`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${calleKey}` },
    });
  } catch {
    return jsonResponse({ status: "error", message: "Could not confirm status with the provider." }, 502);
  }
  if (!providerResponse.ok) return jsonResponse({ status: "error", message: "Provider status lookup failed." }, 502);

  let body: unknown;
  try {
    body = await providerResponse.json();
  } catch {
    body = null;
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const status = providerStatus(record?.status);
  if (!record || !status) return jsonResponse({ status: "ignored", message: "Provider status was not recognized." }, 200);

  const completedAt = safeCompletedAt(record, status);
  const update: Record<string, unknown> = { provider_status: status, lifecycle_status: status, safe_error_category: "" };
  if (completedAt) update.completed_at = completedAt;

  const { error } = await db.from("call_attempts").update(update).eq("id", attempt.id as string);
  if (error) return jsonResponse({ status: "error", message: "The confirmed status could not be saved." }, 502);

  return jsonResponse({ status: "ok", message: "Status refreshed from a confirmed provider lookup." }, 200);
}

if (import.meta.main) {
  Deno.serve(handler);
}
