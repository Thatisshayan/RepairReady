import { corsHeaders } from "./_shared/cors.ts";
import { ownerIdFromRequest } from "./_shared/auth.ts";

const PROVIDER_URL = "https://api.heycall-e.com/v1/goals?limit=1";

type ConnectionStatus = "connected" | "not_connected" | "error";

function jsonResponse(
  body: { status: ConnectionStatus; message: string },
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  // SECURITY: Reject requests without Origin header to prevent CSRF attacks
  if (!origin) {
    return jsonResponse(
      { status: "error", message: "Origin header is required for security." },
      403,
      null,
    );
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { status: "error", message: "Use the connection-check action from the workspace." },
      405,
      origin,
    );
  }

  const ownerId = await ownerIdFromRequest(req);
  if (!ownerId) {
    console.warn("check-calle-connection rejected request", "unauthenticated");
    return jsonResponse(
      { status: "error", message: "Sign in before checking the provider connection." },
      401,
      origin,
    );
  }

  const calleKey = Deno.env.get("CALLE_API_KEY");
  if (!calleKey) {
    console.error("check-calle-connection configuration error", "missing_provider_key");
    return jsonResponse(
      { status: "error", message: "The provider connection is not configured yet. No call was placed." },
      200,
      origin,
    );
  }

  try {
    const providerResponse = await fetch(PROVIDER_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${calleKey}`,
      },
    });

    if (providerResponse.ok) {
      return jsonResponse(
        {
          status: "connected",
          message:
            "CALL-E responded to the read-only setup check. This confirms a setup connection only, not phone-number, region, balance, or calling readiness.",
        },
        200,
        origin,
      );
    }

    if (providerResponse.status === 401 || providerResponse.status === 403) {
      console.warn("check-calle-connection provider response", providerResponse.status);
      return jsonResponse(
        {
          status: "not_connected",
          message: "CALL-E did not accept the saved connection. No phone call was placed.",
        },
        200,
        origin,
      );
    }

    console.warn("check-calle-connection provider response", providerResponse.status);
    return jsonResponse(
      {
        status: "error",
        message: "CALL-E could not complete the read-only setup check. Try again later. No phone call was placed.",
      },
      200,
      origin,
    );
  } catch {
    console.error("check-calle-connection provider request", "network_error");
    return jsonResponse(
      {
        status: "error",
        message: "The read-only setup check could not reach CALL-E. Try again later. No phone call was placed.",
      },
      200,
      origin,
    );
  }
});
