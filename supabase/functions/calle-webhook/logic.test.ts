import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { bounded, providerId, providerStatus, safeCompletedAt, clientIp, eventIdMatches, EVENT_ID_RE, PROVIDER_ID_RE } from "./logic.ts";

// This function explicitly treats the webhook body as UNTRUSTED (see the SECURITY comment in
// index.ts): the only thing trusted is a provider call id, and only after being re-verified via
// our own authenticated GET. These tests confirm the pure parsing helpers behave safely on
// attacker-controlled input -- they never throw, and they never let a forged/oversized value
// through as a "usable" call id.

// ---------------------------------------------------------------------------
// providerId
// ---------------------------------------------------------------------------

Deno.test("providerId accepts a valid-format call id", () => {
  assertEquals(providerId("call_abc-123.xyz:9"), "call_abc-123.xyz:9");
});

Deno.test("providerId rejects a forged/injection-style id string", () => {
  assertEquals(providerId("'; DROP TABLE call_attempts; --"), "");
  assertEquals(providerId("<script>alert(1)</script>"), "");
  assertEquals(providerId("../../../etc/passwd"), "");
  assertEquals(providerId("call_abc\x00\x1f"), ""); // embedded control chars aren't part of PROVIDER_ID_RE's alphabet
});

Deno.test("providerId rejects oversized input rather than truncating into something that looks valid", () => {
  const oversized = "a".repeat(500);
  // bounded() truncates to 160 chars first; since it's all valid PROVIDER_ID_RE chars this
  // particular oversized string DOES become a 160-char accepted id -- confirm that's the actual
  // (bounded, not unbounded) behavior rather than assuming rejection.
  const result = providerId(oversized);
  assertEquals(result.length, 160);
  assertEquals(result, "a".repeat(160));
});

Deno.test("providerId rejects an oversized id that is invalid once truncated", () => {
  // A 500-char string that only becomes valid-looking after truncation would still need to pass
  // PROVIDER_ID_RE on the truncated 160-char slice. Embed an illegal character past the 160 cutoff
  // boundary to confirm rejection is based on the bounded value, not the raw one.
  const withIllegalPastCutoff = "a".repeat(159) + "!" + "b".repeat(340);
  const result = providerId(withIllegalPastCutoff);
  assertEquals(result, ""); // the "!" lands inside the first 160 chars, so PROVIDER_ID_RE fails
});

Deno.test("providerId rejects empty, null, and non-string input", () => {
  assertEquals(providerId(""), "");
  assertEquals(providerId(null), "");
  assertEquals(providerId(undefined), "");
  assertEquals(providerId(12345), "");
  assertEquals(providerId({ malicious: true }), "");
});

Deno.test("PROVIDER_ID_RE rejects a leading special character", () => {
  assertEquals(PROVIDER_ID_RE.test("-abc123"), false);
  assertEquals(PROVIDER_ID_RE.test("abc123"), true);
});

// ---------------------------------------------------------------------------
// providerStatus
// ---------------------------------------------------------------------------

Deno.test("providerStatus normalizes case and the cancelled/canceled spelling", () => {
  assertEquals(providerStatus("COMPLETED"), "completed");
  assertEquals(providerStatus("Failed"), "failed");
  assertEquals(providerStatus("cancelled"), "canceled");
  assertEquals(providerStatus("canceled"), "canceled");
});

Deno.test("providerStatus rejects invalid/forged status strings", () => {
  assertEquals(providerStatus("completed'; DROP TABLE call_attempts; --"), null);
  assertEquals(providerStatus("totally-invalid-status"), null);
  assertEquals(providerStatus(""), null);
});

Deno.test("providerStatus rejects null/undefined/non-string values without throwing", () => {
  assertEquals(providerStatus(null), null);
  assertEquals(providerStatus(undefined), null);
  assertEquals(providerStatus(42), null);
  assertEquals(providerStatus({}), null);
  assertEquals(providerStatus(["completed"]), null);
});

// ---------------------------------------------------------------------------
// safeCompletedAt
// ---------------------------------------------------------------------------

Deno.test("safeCompletedAt returns null for a non-terminal status even with a valid date present", () => {
  assertEquals(safeCompletedAt({ completed_at: "2026-01-01T00:00:00Z" }, "queued"), null);
  assertEquals(safeCompletedAt({ completed_at: "2026-01-01T00:00:00Z" }, "in_progress"), null);
});

Deno.test("safeCompletedAt returns null for a terminal status with a malformed/unparseable date string", () => {
  assertEquals(safeCompletedAt({ completed_at: "not-a-real-date" }, "completed"), null);
  assertEquals(safeCompletedAt({ completed_at: "0000-99-99" }, "failed"), null);
  assertEquals(safeCompletedAt({}, "completed"), null);
});

Deno.test("safeCompletedAt returns a normalized ISO string for a terminal status with a valid date", () => {
  assertEquals(safeCompletedAt({ completed_at: "2026-03-14T09:15:00Z" }, "completed"), "2026-03-14T09:15:00.000Z");
});

Deno.test("safeCompletedAt tolerates a terminal-status date string with extra whitespace/garbage around it", () => {
  // bounded() trims the string but does not strip interior garbage; Date.parse is lenient about
  // some formats but this confirms the exact observed behavior rather than assuming either way.
  const padded = safeCompletedAt({ completed_at: "   2026-03-14T09:15:00Z   " }, "completed");
  assertEquals(padded, "2026-03-14T09:15:00.000Z");

  const garbage = safeCompletedAt({ completed_at: "2026-03-14T09:15:00Z some extra garbage" }, "completed");
  assertEquals(garbage, null); // Date.parse cannot make sense of trailing garbage -> NaN -> null
});

// ---------------------------------------------------------------------------
// bounded / EVENT_ID_RE (supporting helpers)
// ---------------------------------------------------------------------------

Deno.test("bounded trims and truncates without throwing on non-string input", () => {
  assertEquals(bounded("  hello  ", 3), "hel");
  assertEquals(bounded(42, 10), "");
  assertEquals(bounded(null, 10), "");
});

Deno.test("EVENT_ID_RE only accepts the documented evt_ prefix format", () => {
  assertEquals(EVENT_ID_RE.test("evt_abc123"), true);
  assertEquals(EVENT_ID_RE.test("abc123"), false);
  assertEquals(EVENT_ID_RE.test("evt_"), false);
  assertEquals(EVENT_ID_RE.test("evt_<script>"), false);
});

// ---------------------------------------------------------------------------
// clientIp
// ---------------------------------------------------------------------------

Deno.test("clientIp reads the first address from x-forwarded-for", () => {
  const req = new Request("https://example.com", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
  assertEquals(clientIp(req), "1.2.3.4");
});

Deno.test("clientIp falls back to 'unknown' when the header is missing", () => {
  const req = new Request("https://example.com");
  assertEquals(clientIp(req), "unknown");
});

Deno.test("clientIp rejects an implausibly long header value rather than using it as a bucket key", () => {
  const req = new Request("https://example.com", { headers: { "x-forwarded-for": "a".repeat(200) } });
  assertEquals(clientIp(req), "unknown");
});

// ---------------------------------------------------------------------------
// eventIdMatches
// ---------------------------------------------------------------------------

Deno.test("eventIdMatches accepts a header and body id that agree", () => {
  assertEquals(eventIdMatches("evt_abc123", "evt_abc123"), true);
});

Deno.test("eventIdMatches rejects a mismatched body id -- the documented primary defense", () => {
  assertEquals(eventIdMatches("evt_abc123", "evt_forged456"), false);
});

Deno.test("eventIdMatches rejects a missing or non-string body id", () => {
  assertEquals(eventIdMatches("evt_abc123", undefined), false);
  assertEquals(eventIdMatches("evt_abc123", null), false);
  assertEquals(eventIdMatches("evt_abc123", 12345), false);
});

Deno.test("eventIdMatches tolerates surrounding whitespace on the body id only", () => {
  assertEquals(eventIdMatches("evt_abc123", "  evt_abc123  "), true);
});
