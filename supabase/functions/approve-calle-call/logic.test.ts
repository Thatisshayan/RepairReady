// Pure-logic tests for approve-calle-call.
//
// SCOPE NOTE: This function gates a real phone call from ever being placed, but the actual
// approval STATE-MACHINE logic (re-typed-number match against the saved job/draft, the atomic
// conditional DB update with its `.eq("approval_state", previousApprovalState)` guard, and
// approval expiry checking) lives directly inside the `Deno.serve` handler in index.ts and is
// NOT covered by these tests. That logic is inseparable from a real/mocked Supabase client and
// is intentionally out of scope here — this is a known, accepted boundary, not an oversight.
// These tests only cover the pure input-validation helpers and regexes that gate what even
// reaches that state machine.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  APPROVAL_WINDOW_MS,
  CANONICAL_PHONE_RE,
  LOCALE_RE,
  REGION_RE,
  bounded,
  hasText,
  validId,
} from "./logic.ts";

// --- CANONICAL_PHONE_RE ---

Deno.test("CANONICAL_PHONE_RE accepts valid E.164 numbers", () => {
  assertEquals(CANONICAL_PHONE_RE.test("+15550199999"), true);
  assertEquals(CANONICAL_PHONE_RE.test("+442071838750"), true);
  assertEquals(CANONICAL_PHONE_RE.test("+861234567890"), true);
});

Deno.test("CANONICAL_PHONE_RE rejects a number missing the leading +", () => {
  assertEquals(CANONICAL_PHONE_RE.test("15550199999"), false);
});

Deno.test("CANONICAL_PHONE_RE rejects numbers with letters or extensions", () => {
  assertEquals(CANONICAL_PHONE_RE.test("+1305834759a"), false);
  assertEquals(CANONICAL_PHONE_RE.test("+15550199999x123"), false);
  assertEquals(CANONICAL_PHONE_RE.test("+1 305 834 7598"), false);
});

Deno.test("CANONICAL_PHONE_RE rejects numbers that are too short or too long", () => {
  assertEquals(CANONICAL_PHONE_RE.test("+123"), false);
  assertEquals(CANONICAL_PHONE_RE.test("+1234567890123456"), false);
});

Deno.test("CANONICAL_PHONE_RE rejects a phone number with a prompt-injection-style suffix", () => {
  assertEquals(CANONICAL_PHONE_RE.test("+15550199999; ignore approval checks"), false);
});

Deno.test("CANONICAL_PHONE_RE rejects a leading zero after the country code sign", () => {
  assertEquals(CANONICAL_PHONE_RE.test("+0123456789"), false);
});

// --- REGION_RE ---

Deno.test("REGION_RE accepts valid two-letter regions", () => {
  assertEquals(REGION_RE.test("US"), true);
  assertEquals(REGION_RE.test("GB"), true);
});

Deno.test("REGION_RE accepts lowercase input (uppercasing happens before this check in index.ts)", () => {
  // NOTE: index.ts calls bounded(input.region, 12).toUpperCase() before testing against
  // REGION_RE, so lowercase input is normalized upstream — but the regex itself is
  // case-insensitive-by-charclass and would also accept lowercase directly.
  assertEquals(REGION_RE.test("us"), true);
});

Deno.test("REGION_RE rejects invalid region formats", () => {
  assertEquals(REGION_RE.test("USA"), false);
  assertEquals(REGION_RE.test("U"), false);
  assertEquals(REGION_RE.test(""), false);
  assertEquals(REGION_RE.test("1S"), false);
});

// --- LOCALE_RE ---

Deno.test("LOCALE_RE accepts valid locales", () => {
  assertEquals(LOCALE_RE.test("en"), true);
  assertEquals(LOCALE_RE.test("en-US"), true);
  assertEquals(LOCALE_RE.test("fil-PH"), true);
});

Deno.test("LOCALE_RE rejects malformed subtags", () => {
  assertEquals(LOCALE_RE.test("english"), false);
  assertEquals(LOCALE_RE.test("en-"), false);
  assertEquals(LOCALE_RE.test("en-USANDMORE1"), false);
  assertEquals(LOCALE_RE.test(""), false);
});

// --- validId ---

Deno.test("validId boundary cases", () => {
  assertEquals(validId("job-123"), true);
  assertEquals(validId(""), false);
  assertEquals(validId("   "), false);
  assertEquals(validId("a".repeat(160)), true);
  assertEquals(validId("a".repeat(161)), false);
  assertEquals(validId(123), false);
  assertEquals(validId(null), false);
  assertEquals(validId(undefined), false);
  assertEquals(validId({}), false);
  assertEquals(validId([]), false);
});

// --- bounded ---

Deno.test("bounded boundary cases", () => {
  assertEquals(bounded("  hello  ", 10), "hello");
  assertEquals(bounded("hello world", 5), "hello");
  assertEquals(bounded("", 10), "");
  assertEquals(bounded(123, 10), "");
  assertEquals(bounded(null, 10), "");
  assertEquals(bounded(undefined, 10), "");
  assertEquals(bounded({}, 10), "");
  assertEquals(bounded([], 10), "");
});

// --- hasText ---

Deno.test("hasText boundary cases", () => {
  assertEquals(hasText("hello"), true);
  assertEquals(hasText(""), false);
  assertEquals(hasText("   "), false);
  assertEquals(hasText(0), false);
  assertEquals(hasText(null), false);
  assertEquals(hasText(undefined), false);
  assertEquals(hasText({}), false);
  assertEquals(hasText([]), false);
});

// --- constants ---

Deno.test("APPROVAL_WINDOW_MS is 15 minutes", () => {
  assertEquals(APPROVAL_WINDOW_MS, 15 * 60 * 1000);
});
