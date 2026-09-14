import { serviceClient } from "./_shared/auth.ts";
import { providerId, providerStatus, safeCompletedAt, clientIp, eventIdMatches, EVENT_ID_RE } from "./logic.ts";

// Public and unauthenticated by design (CALL-E's webhook carries no Supabase auth token), so it
// needs its own rate limit rather than relying on auth to bound abuse.
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const RATE_BUCKET_PREFIX = "calle-webhook:";

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

  // CALL-E's own webhook docs: return 2xx once the event is accepted, since a non-2xx triggers a
  // retry -- these three checks reject permanently malformed/forged requests that a retry could
  // never fix, so they return 200/"ignored" rather than a 4xx that would just cause CALL-E to
  // keep retrying a request that will never become valid. Genuinely transient failures further
  // down (misconfiguration, rate limiting, a provider/DB hiccup) still return non-2xx, since a
  // retry there could actually succeed.
  const eventId = req.headers.get("CALL-E-Event-Id");
  if (!eventId || !EVENT_ID_RE.test(eventId)) {
    return jsonResponse({ status: "ignored", message: "Missing or invalid event id." }, 200);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ status: "ignored", message: "Invalid JSON." }, 200);
  }
  const event = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  // CALL-E's own webhook docs: "reject the request when that header does not match the body
  // event id." This is the documented primary defense given webhooks carry no signature.
  if (!eventIdMatches(eventId, event.id)) {
    return jsonResponse({ status: "ignored", message: "Event id header does not match the event body." }, 200);
  }
  const eventData = event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : {};
  const remoteId = providerId(eventData.id);
  // Untrusted hint only -- confirmed below via our own authenticated GET, never used as-is.
  if (!remoteId) return jsonResponse({ status: "ignored", message: "No usable call id in the event." }, 200);

  const calleKey = Deno.env.get("CALLE_API_KEY");
  if (!calleKey) return jsonResponse({ status: "error", message: "Not configured." }, 503);

  const db = serviceClient();

  // CALL-E's own webhook docs: delivery is at least once -- "store the webhook event id before
  // processing side effects so duplicate deliveries are ignored safely." A primary-key conflict
  // here means this exact event was already accepted; skip reprocessing (reprocessing itself
  // would be harmless, since everything past this point re-derives from CALL-E's own
  // authenticated response, but it's still wasted work and an extra provider call to avoid).
  const { error: dedupeError } = await db.from("webhook_events_seen").insert({ event_id: eventId });
  if (dedupeError) {
    if (dedupeError.code === "23505") {
      return jsonResponse({ status: "ok", message: "Duplicate delivery, already processed." }, 200);
    }
    console.error("calle-webhook dedupe insert failed", dedupeError.code);
    // An unexpected dedupe-table error shouldn't block an otherwise-idempotent status refresh
    // from at least being attempted -- fall through rather than failing closed here.
  }

  const bucketKey = `${RATE_BUCKET_PREFIX}${clientIp(req)}`;
  const windowStart = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count } = await db
    .from("rate_limit_hits")
    .select("*", { count: "exact", head: true })
    .eq("bucket_key", bucketKey)
    .gte("created_at", windowStart);
  if ((count ?? 0) >= RATE_LIMIT) {
    return jsonResponse({ status: "error", message: "Too many requests." }, 429);
  }
  await db.from("rate_limit_hits").insert({ bucket_key: bucketKey });
  // Opportunistic cleanup, not a separate cron job -- bounded by this bucket's own traffic.
  await db.from("rate_limit_hits").delete().eq("bucket_key", bucketKey).lt("created_at", new Date(Date.now() - 10 * RATE_WINDOW_MS).toISOString());

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
