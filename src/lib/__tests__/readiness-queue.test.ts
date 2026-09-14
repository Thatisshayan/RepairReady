import { describe, it, expect } from "vitest";
import {
  queueItemsForFilter,
  queueMatchesSearch,
  queueEvidenceLabel,
  queueCompletionLabel,
  queueSourceDetail,
  type ReadinessQueueItem,
  type ReadinessQueueJob,
  type ReadinessQueueFilter,
} from "@/lib/readiness-queue";

function makeJob(overrides: Partial<ReadinessQueueJob> = {}): ReadinessQueueJob {
  return {
    id: "job-1",
    customer_name: "Jane Doe",
    appliance_type: "washing_machine",
    brand: "LG",
    model: "WM3900",
    reported_problem: "Not draining properly",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-02T00:00:00Z",
    created_date: "2025-01-01",
    updated_date: "2025-01-02",
    ...overrides,
  };
}

function makeItem(overrides: Partial<ReadinessQueueItem> = {}): ReadinessQueueItem {
  return {
    job: makeJob(),
    attempt: null,
    brief: {
      repair_job_id: "job-1",
      call_attempt_id: "",
      call_completion_status: "completed",
      readiness_status: "ready_for_technician_review",
      human_review_state: "reviewed",
      human_review_note: "",
      reviewed_at: "",
      evidence: [],
      follow_ups: [],
      follow_up_reviews: [],
      blockers: [],
      outcome: null,
      safe_summary: "",
      share_token: null,
      share_expires_at: null,
    },
    hasPersistedAttempt: false,
    hasPersistedBrief: false,
    readinessBucket: "ready_for_technician_review",
    decision: {
      state: "ready_for_technician_review",
      tone: "good",
      title: "Ready",
      explanation: "All evidence confirmed.",
      nextAction: "Use brief.",
      reviewPending: false,
      reviewMessage: null,
    },
    metrics: {
      confirmedEvidenceAreas: 5,
      followUpDetails: 0,
      visitBlockers: 0,
      callEvidenceAreas: 5,
      incompleteEvidenceAreas: 0,
    },
    humanReviewState: "reviewed",
    humanReviewLabel: "Reviewed",
    sourceLabel: "Saved brief",
    completionLabel: "Completed",
    blockerCount: 0,
    blockerText: null,
    hasSafetyHazard: false,
    latestActivity: "2025-01-02T00:00:00Z",
    nextAction: "Use brief.",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// queueMatchesSearch
// ---------------------------------------------------------------------------
describe("queueMatchesSearch", () => {
  it("returns true for an empty query", () => {
    const item = makeItem();
    expect(queueMatchesSearch(item, "")).toBe(true);
  });

  it("returns true for a whitespace-only query", () => {
    const item = makeItem();
    expect(queueMatchesSearch(item, "   ")).toBe(true);
  });

  it("matches against customer name (case-insensitive)", () => {
    const item = makeItem();
    expect(queueMatchesSearch(item, "jane")).toBe(true);
    expect(queueMatchesSearch(item, "DOE")).toBe(true);
  });

  it("matches against brand", () => {
    const item = makeItem({ job: makeJob({ brand: "Samsung" }) });
    expect(queueMatchesSearch(item, "samsung")).toBe(true);
  });

  it("matches against model", () => {
    const item = makeItem({ job: makeJob({ model: "WF45R6100AW" }) });
    expect(queueMatchesSearch(item, "WF45R6100AW")).toBe(true);
  });

  it("matches against reported_problem", () => {
    const item = makeItem({ job: makeJob({ reported_problem: "Leaking from the bottom" }) });
    expect(queueMatchesSearch(item, "leaking")).toBe(true);
  });

  it("matches against appliance_type raw value", () => {
    const item = makeItem({ job: makeJob({ appliance_type: "dryer" }) });
    expect(queueMatchesSearch(item, "dryer")).toBe(true);
  });

  it("does not match an irrelevant query", () => {
    const item = makeItem();
    expect(queueMatchesSearch(item, "xyzzy")).toBe(false);
  });

  it("returns true when query partially matches a field", () => {
    const item = makeItem({ job: makeJob({ customer_name: "Johnson" }) });
    expect(queueMatchesSearch(item, "johns")).toBe(true);
  });

  it("handles null/optional brand and model gracefully", () => {
    const item = makeItem({ job: makeJob({ brand: null, model: null }) });
    // Should still match on other fields
    expect(queueMatchesSearch(item, "jane")).toBe(true);
    // Should not crash
    expect(queueMatchesSearch(item, "brand")).toBe(false);
  });

  it("matches across concatenated fields", () => {
    // The search concatenates all fields; query spans two adjacent fields
    const item = makeItem({ job: makeJob({ brand: "Maytag", model: "MHW3500" }) });
    // "maytag mhw" is a substring of "maytag MHW3500"
    expect(queueMatchesSearch(item, "maytag mhw")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// queueItemsForFilter
// ---------------------------------------------------------------------------
describe("queueItemsForFilter", () => {
  const readyItem = makeItem({
    readinessBucket: "ready_for_technician_review",
    humanReviewState: "reviewed",
  });
  const blockedItem = makeItem({
    readinessBucket: "blocked",
    humanReviewState: "reviewed",
  });
  const needsFollowUpItem = makeItem({
    readinessBucket: "needs_follow_up",
    humanReviewState: "not_reviewed",
  });
  const readyUnreviewedItem = makeItem({
    readinessBucket: "ready_for_technician_review",
    humanReviewState: "not_reviewed",
  });

  const allItems = [readyItem, blockedItem, needsFollowUpItem, readyUnreviewedItem];

  it("returns all items with filter='all' and empty query", () => {
    expect(queueItemsForFilter(allItems, "", "all")).toHaveLength(4);
  });

  it("filters by ready_for_technician_review bucket", () => {
    const result = queueItemsForFilter(allItems, "", "ready_for_technician_review");
    expect(result).toHaveLength(2);
    expect(result.every((i) => i.readinessBucket === "ready_for_technician_review")).toBe(true);
  });

  it("filters by blocked bucket", () => {
    const result = queueItemsForFilter(allItems, "", "blocked");
    expect(result).toHaveLength(1);
    expect(result[0].readinessBucket).toBe("blocked");
  });

  it("filters by needs_follow_up bucket", () => {
    const result = queueItemsForFilter(allItems, "", "needs_follow_up");
    expect(result).toHaveLength(1);
    expect(result[0].readinessBucket).toBe("needs_follow_up");
  });

  it("filters unreviewed items across all buckets", () => {
    const result = queueItemsForFilter(allItems, "", "unreviewed");
    expect(result).toHaveLength(2);
    expect(result.every((i) => i.humanReviewState === "not_reviewed")).toBe(true);
  });

  it("combines search query with filter", () => {
    // All items have customer_name "Jane Doe", so "jane" matches all.
    // Blocked filter should narrow to just the blocked item.
    const result = queueItemsForFilter(allItems, "jane", "blocked");
    expect(result).toHaveLength(1);
    expect(result[0].readinessBucket).toBe("blocked");
  });

  it("returns empty array when no items match query", () => {
    expect(queueItemsForFilter(allItems, "nonexistent", "all")).toHaveLength(0);
  });

  it("returns empty array for empty items", () => {
    expect(queueItemsForFilter([], "", "all")).toHaveLength(0);
  });

  it("returns all items when filter is 'all' even if query is empty", () => {
    const items = [readyItem, blockedItem, needsFollowUpItem];
    expect(queueItemsForFilter(items, "", "all")).toHaveLength(3);
  });

  it("unreviewed filter excludes reviewed items", () => {
    const result = queueItemsForFilter(allItems, "", "unreviewed");
    expect(result.every((i) => i.humanReviewState === "not_reviewed")).toBe(true);
  });

  it("bucket filter only matches that bucket regardless of review state", () => {
    const result = queueItemsForFilter(allItems, "", "needs_follow_up");
    expect(result).toHaveLength(1);
    expect(result[0].humanReviewState).toBe("not_reviewed");
    // ready_for_technician_review includes both reviewed and unreviewed
    const ready = queueItemsForFilter(allItems, "", "ready_for_technician_review");
    expect(ready).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// queueEvidenceLabel
// ---------------------------------------------------------------------------
describe("queueEvidenceLabel", () => {
  it("formats confirmed and call evidence counts", () => {
    const item = makeItem({
      metrics: {
        confirmedEvidenceAreas: 3,
        callEvidenceAreas: 4,
        followUpDetails: 0,
        visitBlockers: 0,
        incompleteEvidenceAreas: 1,
      },
    });
    expect(queueEvidenceLabel(item)).toBe("3/5 confirmed · 4/5 from call");
  });

  it("formats 5/5 confirmed and 5/5 from call", () => {
    const item = makeItem({
      metrics: {
        confirmedEvidenceAreas: 5,
        callEvidenceAreas: 5,
        followUpDetails: 0,
        visitBlockers: 0,
        incompleteEvidenceAreas: 0,
      },
    });
    expect(queueEvidenceLabel(item)).toBe("5/5 confirmed · 5/5 from call");
  });

  it("formats 0/5 confirmed and 0/5 from call", () => {
    const item = makeItem({
      metrics: {
        confirmedEvidenceAreas: 0,
        callEvidenceAreas: 0,
        followUpDetails: 0,
        visitBlockers: 0,
        incompleteEvidenceAreas: 5,
      },
    });
    expect(queueEvidenceLabel(item)).toBe("0/5 confirmed · 0/5 from call");
  });

  it("formats when confirmed > call evidence", () => {
    const item = makeItem({
      metrics: {
        confirmedEvidenceAreas: 2,
        callEvidenceAreas: 1,
        followUpDetails: 0,
        visitBlockers: 0,
        incompleteEvidenceAreas: 3,
      },
    });
    expect(queueEvidenceLabel(item)).toBe("2/5 confirmed · 1/5 from call");
  });
});

// ---------------------------------------------------------------------------
// queueCompletionLabel
// ---------------------------------------------------------------------------
describe("queueCompletionLabel", () => {
  it("returns the completion label from the item", () => {
    const item = makeItem({ completionLabel: "Completed" });
    expect(queueCompletionLabel(item)).toBe("Completed");
  });

  it("returns different labels as configured", () => {
    expect(queueCompletionLabel(makeItem({ completionLabel: "In progress" }))).toBe("In progress");
    expect(queueCompletionLabel(makeItem({ completionLabel: "No answer" }))).toBe("No answer");
    expect(queueCompletionLabel(makeItem({ completionLabel: "Provider reported failure" }))).toBe(
      "Provider reported failure"
    );
    expect(queueCompletionLabel(makeItem({ completionLabel: "Canceled" }))).toBe("Canceled");
    expect(queueCompletionLabel(makeItem({ completionLabel: "Declined" }))).toBe("Declined");
    expect(queueCompletionLabel(makeItem({ completionLabel: "Reached voicemail" }))).toBe(
      "Reached voicemail"
    );
    expect(queueCompletionLabel(makeItem({ completionLabel: "Line busy" }))).toBe("Line busy");
    expect(queueCompletionLabel(makeItem({ completionLabel: "Attempt expired" }))).toBe(
      "Attempt expired"
    );
    expect(queueCompletionLabel(makeItem({ completionLabel: "Unknown" }))).toBe("Unknown");
    expect(queueCompletionLabel(makeItem({ completionLabel: "Not started" }))).toBe("Not started");
  });
});

// ---------------------------------------------------------------------------
// queueSourceDetail
// ---------------------------------------------------------------------------
describe("queueSourceDetail", () => {
  it("returns persisted brief message when hasPersistedBrief is true", () => {
    const item = makeItem({ hasPersistedBrief: true });
    expect(queueSourceDetail(item)).toBe("Saved brief is the persisted review snapshot.");
  });

  it("returns preparation-only message when hasPersistedBrief is false", () => {
    const item = makeItem({ hasPersistedBrief: false });
    expect(queueSourceDetail(item)).toBe(
      "Coordinator entries are preparation only until saved call evidence exists."
    );
  });
});

// ---------------------------------------------------------------------------
// Additional edge-case coverage
// ---------------------------------------------------------------------------
describe("queueMatchesSearch edge cases", () => {
  it("is case-insensitive across all fields", () => {
    const item = makeItem({
      job: makeJob({
        customer_name: "Alice Smith",
        brand: "Whirlpool",
        model: "WFW5605MW",
        reported_problem: "Will not spin",
      }),
    });
    expect(queueMatchesSearch(item, "ALICE")).toBe(true);
    expect(queueMatchesSearch(item, "whirlpool")).toBe(true);
    expect(queueMatchesSearch(item, "WFW5605MW")).toBe(true);
    expect(queueMatchesSearch(item, "will not spin")).toBe(true);
  });

  it("returns false when none of the searchable fields match", () => {
    const item = makeItem({ job: makeJob({ customer_name: "Bob" }) });
    expect(queueMatchesSearch(item, "carol")).toBe(false);
  });

  it("handles a single-character query", () => {
    const item = makeItem({ job: makeJob({ customer_name: "Xena" }) });
    expect(queueMatchesSearch(item, "x")).toBe(true);
  });
});

describe("queueItemsForFilter edge cases", () => {
  it("returns empty when items is empty", () => {
    expect(queueItemsForFilter([], "", "unreviewed")).toHaveLength(0);
  });

  it("returns empty when query matches nothing even with filter=all", () => {
    const items = [makeItem({ job: makeJob({ customer_name: "OnlyOne" }) })];
    expect(queueItemsForFilter(items, "zzz", "all")).toHaveLength(0);
  });

  it("unreviewed filter with query", () => {
    const items = [
      makeItem({
        job: makeJob({ customer_name: "Reviewed Guy", id: "r1" }),
        humanReviewState: "reviewed",
      }),
      makeItem({
        job: makeJob({ customer_name: "Unreviewed Gal", id: "r2" }),
        humanReviewState: "not_reviewed",
      }),
    ];
    expect(queueItemsForFilter(items, "gal", "unreviewed")).toHaveLength(1);
    expect(queueItemsForFilter(items, "guy", "unreviewed")).toHaveLength(0);
  });

  it("bucket filter ignores unrelated items", () => {
    const items = [
      makeItem({
        job: makeJob({ id: "a" }),
        readinessBucket: "blocked",
      }),
      makeItem({
        job: makeJob({ id: "b" }),
        readinessBucket: "needs_follow_up",
      }),
      makeItem({
        job: makeJob({ id: "c" }),
        readinessBucket: "ready_for_technician_review",
      }),
    ];
    expect(queueItemsForFilter(items, "", "blocked")).toHaveLength(1);
    expect(queueItemsForFilter(items, "", "needs_follow_up")).toHaveLength(1);
    expect(queueItemsForFilter(items, "", "ready_for_technician_review")).toHaveLength(1);
  });
});
