// Pure-logic tests for get-shared-brief — the ONE public, unauthenticated endpoint in this
// codebase. TOKEN_RE is the entire security boundary before an attacker-controlled string ever
// reaches a database query, so these tests focus on confirming it rejects malicious-shaped input.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { TOKEN_RE, parseJsonArray, clientIp } from "./logic.ts";

// --- TOKEN_RE ---

Deno.test("TOKEN_RE accepts valid-format tokens", () => {
  assertEquals(TOKEN_RE.test("a".repeat(20)), true);
  assertEquals(TOKEN_RE.test("a".repeat(80)), true);
  assertEquals(TOKEN_RE.test("abc123_-ABC123_-abc123_-abc1"), true);
});

Deno.test("TOKEN_RE rejects tokens that are too short or too long", () => {
  assertEquals(TOKEN_RE.test("a".repeat(19)), false);
  assertEquals(TOKEN_RE.test("a".repeat(81)), false);
  assertEquals(TOKEN_RE.test(""), false);
});

Deno.test("TOKEN_RE rejects SQL-injection-style content", () => {
  assertEquals(TOKEN_RE.test("' OR '1'='1".padEnd(20, "a")), false);
  assertEquals(TOKEN_RE.test("a".repeat(20) + "' OR '1'='1"), false);
});

Deno.test("TOKEN_RE rejects path-traversal-style content", () => {
  assertEquals(TOKEN_RE.test("../../../etc/passwd".padEnd(20, "a")), false);
});

Deno.test("TOKEN_RE rejects script-injection-style content", () => {
  assertEquals(TOKEN_RE.test("<script>alert(1)</script>".padEnd(30, "a")), false);
});

Deno.test("TOKEN_RE only allows letters, digits, dash, and underscore", () => {
  assertEquals(TOKEN_RE.test("a".repeat(19) + " "), false);
  assertEquals(TOKEN_RE.test("a".repeat(19) + "."), false);
  assertEquals(TOKEN_RE.test("a".repeat(19) + "/"), false);
  assertEquals(TOKEN_RE.test("a".repeat(19) + "\n"), false);
});

// --- parseJsonArray ---

Deno.test("parseJsonArray returns [] for malformed JSON", () => {
  assertEquals(parseJsonArray("{not valid json"), []);
  assertEquals(parseJsonArray("[1, 2,"), []);
});

Deno.test("parseJsonArray returns [] when JSON parses to a non-array", () => {
  assertEquals(parseJsonArray('{"a": 1}'), []);
  assertEquals(parseJsonArray("42"), []);
  assertEquals(parseJsonArray('"a string"'), []);
  assertEquals(parseJsonArray("null"), []);
});

Deno.test("parseJsonArray handles a large/deeply nested array without crashing", () => {
  const nested = JSON.stringify(Array.from({ length: 1000 }, (_, i) => ({ i, nested: [1, 2, 3] })));
  const result = parseJsonArray(nested);
  assertEquals(Array.isArray(result), true);
  assertEquals(result.length, 1000);
});

Deno.test("parseJsonArray returns [] for empty string input", () => {
  assertEquals(parseJsonArray(""), []);
  assertEquals(parseJsonArray("   "), []);
});

Deno.test("parseJsonArray returns [] for non-string input", () => {
  assertEquals(parseJsonArray(null), []);
  assertEquals(parseJsonArray(undefined), []);
  assertEquals(parseJsonArray(42), []);
  assertEquals(parseJsonArray({}), []);
  assertEquals(parseJsonArray([1, 2, 3]), []);
});

Deno.test("parseJsonArray returns the parsed array for valid JSON arrays", () => {
  assertEquals(parseJsonArray("[1,2,3]"), [1, 2, 3]);
  assertEquals(parseJsonArray("[]"), []);
});

// --- clientIp ---

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
