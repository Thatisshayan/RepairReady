import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { JobDetail } from "@/components/repairready/JobDetail";
import type { RepairJobRecord } from "@/lib/repair-jobs";
import type { CallAttemptDraft } from "@/lib/call-attempts";
import type { RepairBriefView } from "@/lib/repair-briefs";
import type { AuthorizedDemoCallStatus } from "@/functions";

vi.mock("framer-motion", () => ({
  motion: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock: stripping animation props
    div: ({ children, initial: _initial, animate: _animate, transition: _transition, ...rest }: any) => (
      <div {...rest}>{children}</div>
    ),
  },
  useReducedMotion: () => true,
}));

vi.mock("@/functions", () => ({
  checkCalleConnection: vi.fn().mockResolvedValue({ status: "connected", message: "ok" }),
}));

vi.mock("@/components/repairready/TechnicianBrief", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock: stripping component props
  TechnicianBrief: ({ brief, loading, shareLinkState, shareLinkMessage }: any) => (
    <div data-testid="technician-brief">
      <span data-testid="brief-null">{String(brief === null)}</span>
      <span data-testid="brief-loading">{String(loading)}</span>
      <span data-testid="share-link-state">{shareLinkState}</span>
      <span data-testid="share-link-message">{shareLinkMessage}</span>
      {brief && <span data-testid="brief-present">Brief present</span>}
    </div>
  ),
}));

function makeJob(overrides: Partial<RepairJobRecord> = {}): RepairJobRecord {
  return {
    id: "job-1",
    customer_name: "John Smith",
    phone: "+14155552671",
    appliance_type: "washing_machine",
    brand: "Samsung",
    model: "WF45R6100AW",
    reported_problem: "Machine not spinning, making loud noise during spin cycle",
    symptom_timing: "During every wash cycle",
    error_code: "LE",
    visit_note: "Leave tools in garage",
    access_notes: "Gate code 1234",
    operator_notes: "Customer seems anxious about water damage",
    created_at: "2025-01-15T10:00:00Z",
    updated_at: "2025-01-16T14:30:00Z",
    ...overrides,
  };
}

function makeCallDraft(overrides: Partial<CallAttemptDraft> = {}): CallAttemptDraft {
  return {
    id: "draft-1",
    repair_job_id: "job-1",
    recipient_name: "John Smith",
    recipient_phone: "+14155552671",
    preparation_purpose: "Pre-visit preparation check for a washing machine job",
    question_outline: "Confirm identity\nVerify appliance details",
    request_snapshot: "{}",
    idempotency_key: "key-1",
    lifecycle_status: "prepared",
    approval_state: "not_approved",
    ...overrides,
  };
}

function makeBrief(overrides: Partial<RepairBriefView> = {}): RepairBriefView {
  return {
    repair_job_id: "job-1",
    call_attempt_id: "draft-1",
    call_completion_status: "completed",
    readiness_status: "ready_for_technician_review",
    human_review_state: "not_reviewed",
    human_review_note: "",
    reviewed_at: "",
    evidence: [],
    follow_ups: [],
    follow_up_reviews: [],
    blockers: [],
    outcome: null,
    safe_summary: "Brief summary",
    ...overrides,
  };
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    job: makeJob(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    callDraft: null as CallAttemptDraft | null,
    callDraftLoading: false,
    callDraftSaving: false,
    callDraftError: null as string | null,
    onSaveCallDraft: vi.fn().mockResolvedValue(undefined),
    brief: null as RepairBriefView | null,
    briefLoading: false,
    briefSaving: false,
    briefError: null as string | null,
    onRetryBrief: vi.fn(),
    onSaveBriefReview: vi.fn().mockResolvedValue(undefined),
    onSaveOutcome: vi.fn().mockResolvedValue(undefined),
    onCopyBriefSummary: vi.fn().mockResolvedValue(undefined),
    authorizedDemoActionState: "idle" as "idle" | "loading" | AuthorizedDemoCallStatus,
    authorizedDemoMessage: "",
    onOpenAuthorizedDemo: vi.fn(),
    demoStatusRefreshing: false,
    demoStatusMessage: "",
    onRefreshDemoStatus: vi.fn().mockResolvedValue(undefined),
    approveState: "idle" as "idle" | "loading" | "approved" | "error",
    approveMessage: "",
    onApproveCall: vi.fn().mockResolvedValue(undefined),
    dispatchState: "idle" as "idle" | "loading" | "submitted" | "error",
    dispatchMessage: "",
    onDispatchCall: vi.fn().mockResolvedValue(undefined),
    retryDraftState: "idle" as "idle" | "loading",
    onRetryCallDraft: vi.fn().mockResolvedValue(undefined),
    shareLinkState: "idle" as "idle" | "loading" | "error",
    shareLinkMessage: "",
    onCreateShareLink: vi.fn().mockResolvedValue(undefined),
    onRevokeShareLink: vi.fn().mockResolvedValue(undefined),
    followUpDraftState: "idle" as "idle" | "loading",
    onCreateFollowUpDraft: vi.fn().mockResolvedValue(undefined),
    postVisitDraftState: "idle" as "idle" | "loading",
    onCreatePostVisitDraft: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("JobDetail", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders customer name and appliance type", () => {
    render(<JobDetail {...makeProps()} />);
    expect(screen.getAllByText("John Smith").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Washing machine").length).toBeGreaterThanOrEqual(1);
  });

  it("shows edit and delete buttons", () => {
    render(<JobDetail {...makeProps()} />);
    expect(screen.getByRole("button", { name: /edit job details/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("calls onEdit when edit button clicked", () => {
    const onEdit = vi.fn();
    render(<JobDetail {...makeProps({ onEdit })} />);
    fireEvent.click(screen.getByRole("button", { name: /edit job details/i }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("calls onDelete when delete button clicked", () => {
    const onDelete = vi.fn();
    render(<JobDetail {...makeProps({ onDelete })} />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("shows preparation checklist", () => {
    render(<JobDetail {...makeProps()} />);
    expect(screen.getByText("Preparation checklist")).toBeInTheDocument();
    expect(screen.getByText("Customer name")).toBeInTheDocument();
    expect(screen.getByText("Phone number")).toBeInTheDocument();
    expect(screen.getByText("Appliance type")).toBeInTheDocument();
  });

  it("shows call review panel when brief is null", () => {
    render(<JobDetail {...makeProps({ brief: null })} />);
    expect(screen.getByText("Review and save locally")).toBeInTheDocument();
    expect(screen.getByText(/Check the recipient, purpose/)).toBeInTheDocument();
  });

  it("shows technician brief when brief is available", () => {
    const brief = makeBrief();
    render(<JobDetail {...makeProps({ brief })} />);
    const briefEls = screen.getAllByTestId("technician-brief");
    expect(briefEls.length).toBe(1);
    expect(screen.getByTestId("brief-null")).toHaveTextContent("false");
    expect(screen.getByTestId("brief-present")).toBeInTheDocument();
  });

  it("shows loading state for brief when briefLoading is true", () => {
    render(<JobDetail {...makeProps({ briefLoading: true })} />);
    const loadingEls = screen.getAllByTestId("brief-loading");
    expect(loadingEls).toHaveLength(1);
    expect(loadingEls[0]).toHaveTextContent("true");
  });

  it("shows approval panel with phone re-type input", () => {
    const callDraft = makeCallDraft({
      approval_state: "not_approved",
      provider_call_id: null,
      provider_status: null,
    });
    render(<JobDetail {...makeProps({ callDraft })} />);
    expect(screen.getByText("Approve this exact number to place a real call")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm phone")).toBeInTheDocument();
    expect(screen.getByLabelText("Region")).toBeInTheDocument();
    expect(screen.getByLabelText("Locale")).toBeInTheDocument();
  });

  it("shows dispatch button after approval", () => {
    const futureDate = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const callDraft = makeCallDraft({
      approval_state: "approved",
      approval_expires_at: futureDate,
      provider_call_id: null,
      provider_status: null,
    });
    render(<JobDetail {...makeProps({ callDraft })} />);
    expect(screen.getByRole("button", { name: /place the call now/i })).toBeInTheDocument();
    expect(screen.getByText(/Approved until/)).toBeInTheDocument();
  });

  it("shows retry option for failed/no-answer calls", () => {
    const callDraft = makeCallDraft({
      provider_call_id: "call-abc",
      provider_status: "no_answer",
    });
    render(<JobDetail {...makeProps({ callDraft })} />);
    expect(screen.getByRole("button", { name: /retry this call/i })).toBeInTheDocument();
    expect(screen.getByText(/The call did not connect/)).toBeInTheDocument();
  });

  it("shows share link section via technician brief", () => {
    const brief = makeBrief();
    render(<JobDetail {...makeProps({ brief, shareLinkState: "idle", shareLinkMessage: "" })} />);
    const shareEls = screen.getAllByTestId("share-link-state");
    expect(shareEls).toHaveLength(1);
    expect(shareEls[0]).toHaveTextContent("idle");
    expect(screen.getByTestId("share-link-message")).toHaveTextContent("");
  });
});
