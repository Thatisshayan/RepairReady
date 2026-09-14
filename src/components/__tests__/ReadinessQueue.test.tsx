import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ReadinessQueue } from "@/components/repairready/ReadinessQueue";
import type { ReadinessQueueItem, ReadinessQueueSummary, ReadinessQueueFilter } from "@/lib/readiness-queue";
import type { FirstTimeFixSummary } from "@/lib/repair-briefs";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeSummary(overrides: Partial<ReadinessQueueSummary> = {}): ReadinessQueueSummary {
  return {
    loadedJobCount: 1,
    readyCount: 1,
    needsFollowUpCount: 0,
    blockedCount: 0,
    unreviewedCount: 0,
    confirmedEvidenceCount: 5,
    totalEvidenceAreaCount: 5,
    limitedToNewestRecords: false,
    safetyHazardCount: 0,
    firstTimeFix: null,
    ...overrides,
  };
}

function makeItem(overrides: Partial<ReadinessQueueItem> = {}): ReadinessQueueItem {
  return {
    job: {
      id: "job-1",
      customer_name: "Jane Doe",
      appliance_type: "washing_machine",
      brand: "LG",
      model: "WM3900",
      reported_problem: "Not draining",
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-02T00:00:00Z",
      created_date: "2025-01-01",
      updated_date: "2025-01-02",
    },
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
      title: "Ready for technician review",
      explanation: "All evidence confirmed.",
      nextAction: "Use this brief for technician review.",
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
    nextAction: "Use this brief for technician review.",
    ...overrides,
  };
}

const noop = () => {};
const noopAsync = async () => {};
const defaultProps = {
  items: [],
  summary: makeSummary(),
  selectedId: null,
  query: "",
  filter: "all" as ReadinessQueueFilter,
  loading: false,
  hasLoaded: true,
  error: null,
  lastRefreshedAt: null,
  onSelect: noop,
  onQuery: noop,
  onFilter: noop,
  onRefresh: noop,
  onCreate: noop,
  selectedIds: new Set<string>(),
  onToggleSelect: noop,
  onClearSelection: noop,
  bulkPreparing: false,
  onPrepareSelected: noopAsync,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReadinessQueue", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders loading state when loading is true and hasLoaded is false", () => {
    render(<ReadinessQueue {...defaultProps} loading={true} hasLoaded={false} />);
    expect(screen.getByLabelText("Loading readiness queue")).toBeInTheDocument();
    expect(screen.getByText(/Reading saved jobs and review records/)).toBeInTheDocument();
  });

  it("renders error state when error is set and hasLoaded is false", () => {
    render(
      <ReadinessQueue
        {...defaultProps}
        hasLoaded={false}
        error="Failed to load queue"
      />,
    );
    const alerts = screen.getAllByRole("alert");
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Readiness queue could not load")).toBeInTheDocument();
    expect(screen.getByText("Failed to load queue")).toBeInTheDocument();
  });

  it("renders empty state when there are no loaded jobs", () => {
    const summary = makeSummary({ loadedJobCount: 0, readyCount: 0, needsFollowUpCount: 0, blockedCount: 0, unreviewedCount: 0 });
    render(<ReadinessQueue {...defaultProps} summary={summary} />);
    expect(screen.getByText("Your readiness queue is clear")).toBeInTheDocument();
    expect(screen.getByText("Create new job")).toBeInTheDocument();
  });

  it("shows summary counts for ready, needs follow-up, blocked, and unreviewed", () => {
    const summary = makeSummary({
      readyCount: 3,
      needsFollowUpCount: 2,
      blockedCount: 1,
      unreviewedCount: 4,
    });
    render(<ReadinessQueue {...defaultProps} items={[makeItem()]} summary={summary} />);
    const counts = screen.getByLabelText("Readiness queue counts");
    expect(within(counts).getByText("3")).toBeInTheDocument();
    expect(within(counts).getByText("Ready for technician review")).toBeInTheDocument();
    expect(within(counts).getByText("2")).toBeInTheDocument();
    expect(within(counts).getByText("Needs follow-up")).toBeInTheDocument();
    expect(within(counts).getByText("1")).toBeInTheDocument();
    expect(within(counts).getByText("Blocked")).toBeInTheDocument();
    expect(within(counts).getByText("4")).toBeInTheDocument();
    expect(within(counts).getByText("Unreviewed")).toBeInTheDocument();
  });

  it("shows safety hazard banner when safetyHazardCount > 0", () => {
    const summary = makeSummary({ safetyHazardCount: 2 });
    render(<ReadinessQueue {...defaultProps} items={[makeItem()]} summary={summary} />);
    const banner = document.querySelector(".rr-safety-banner");
    expect(banner).toBeTruthy();
    expect(banner!.getAttribute("role")).toBe("alert");
    expect(banner!.textContent).toContain("2 jobs with a reported safety hazard");
  });

  it("renders queue items with customer names", () => {
    const items = [
      makeItem({ job: { ...makeItem().job, id: "j1", customer_name: "Alice Smith" } }),
      makeItem({ job: { ...makeItem().job, id: "j2", customer_name: "Bob Jones" } }),
    ];
    const summary = makeSummary({ loadedJobCount: 2, readyCount: 2 });
    render(<ReadinessQueue {...defaultProps} items={items} summary={summary} />);
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
  });

  it("shows first-time-fix rate when available", () => {
    const firstTimeFix: FirstTimeFixSummary = {
      recorded: 10,
      firstTimeFixes: 7,
      rate: 0.7,
    };
    const summary = makeSummary({ firstTimeFix });
    render(<ReadinessQueue {...defaultProps} items={[makeItem()]} summary={summary} />);
    const stat = document.querySelector(".rr-first-time-fix-stat");
    expect(stat).toBeTruthy();
    expect(stat!.textContent).toContain("70%");
    expect(stat!.textContent).toContain("7 of 10");
    expect(stat!.textContent).toContain("repaired on the first visit");
  });

  it('shows "not enough data yet" when firstTimeFix is null', () => {
    const summary = makeSummary({ firstTimeFix: null });
    render(<ReadinessQueue {...defaultProps} items={[makeItem()]} summary={summary} />);
    const stat = document.querySelector(".rr-first-time-fix-stat");
    expect(stat).toBeTruthy();
    expect(stat!.textContent).toContain("Not enough data yet");
  });

  it("calls onSelect when a queue item is clicked", () => {
    const onSelect = vi.fn();
    const item = makeItem({
      job: { ...makeItem().job, id: "job-click", customer_name: "Click Me" },
    });
    const summary = makeSummary({ loadedJobCount: 1, readyCount: 1 });
    render(<ReadinessQueue {...defaultProps} items={[item]} summary={summary} onSelect={onSelect} />);

    const card = screen.getAllByRole("button").find(
      (el) => el.textContent?.includes("Click Me"),
    );
    expect(card).toBeTruthy();
    card!.click();
    expect(onSelect).toHaveBeenCalledWith("job-click");
  });

  it("shows filter pills with all five filter options", () => {
    render(<ReadinessQueue {...defaultProps} items={[makeItem()]} />);
    const filterGroup = screen.getByRole("group", { name: "Filter readiness queue" });
    const buttons = within(filterGroup).getAllByRole("button");
    const labels = buttons.map((b) => b.textContent);
    expect(labels).toContain("All");
    expect(labels).toContain("Ready for technician review");
    expect(labels).toContain("Needs follow-up");
    expect(labels).toContain("Blocked");
    expect(labels).toContain("Unreviewed");
    expect(buttons).toHaveLength(5);
  });
});
