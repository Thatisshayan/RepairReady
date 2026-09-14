import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TechnicianBrief } from "@/components/repairready/TechnicianBrief";
import type { EvidenceItem, RepairBriefView } from "@/lib/repair-briefs";
import type { RepairJobRecord } from "@/lib/repair-jobs";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<RepairJobRecord> = {}): RepairJobRecord {
  return {
    id: "job-1",
    customer_name: "Jane Doe",
    phone: "+14155551234",
    appliance_type: "dryer",
    brand: "Samsung",
    model: "DV45H7000",
    reported_problem: "Dryer not heating",
    symptom_timing: "Every cycle",
    error_code: "tC",
    access_notes: "2nd floor, elevator available",
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    key: "symptoms",
    label: "Symptoms in the customer's own words",
    status: "confirmed",
    source: "call_reported",
    value: "Dryer runs but produces no heat",
    supporting_excerpt: "no heat at all",
    ...overrides,
  };
}

function makeBrief(overrides: Partial<RepairBriefView> = {}): RepairBriefView {
  return {
    repair_job_id: "job-1",
    call_attempt_id: "attempt-1",
    call_completion_status: "completed",
    readiness_status: "ready_for_technician_review",
    human_review_state: "not_reviewed",
    human_review_note: "",
    reviewed_at: "",
    evidence: [makeEvidence()],
    follow_ups: [],
    follow_up_reviews: [],
    blockers: [],
    outcome: null,
    safe_summary: "",
    share_token: null,
    share_expires_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Default props
// ---------------------------------------------------------------------------

const noop = vi.fn();
const asyncNoop = vi.fn().mockResolvedValue(undefined);

function defaultProps(overrides: Partial<React.ComponentProps<typeof TechnicianBrief>> = {}) {
  return {
    job: makeJob(),
    brief: makeBrief(),
    loading: false,
    saving: false,
    error: null,
    onRetry: noop,
    onSaveReview: asyncNoop,
    onSaveOutcome: asyncNoop,
    onCopySummary: asyncNoop,
    shareLinkState: "idle" as const,
    shareLinkMessage: "",
    onCreateShareLink: asyncNoop,
    onRevokeShareLink: asyncNoop,
    followUpDraftState: "idle" as const,
    onCreateFollowUpDraft: asyncNoop,
    postVisitDraftState: "idle" as const,
    onCreatePostVisitDraft: asyncNoop,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TechnicianBrief", () => {
  it("renders loading state when loading is true", () => {
    render(<TechnicianBrief {...defaultProps({ brief: null, loading: true })} />);
    expect(screen.getByRole("status")).toHaveTextContent(/Loading the private brief/i);
  });

  it("renders error state with retry button when error is set and brief is null", async () => {
    const onRetry = vi.fn();
    render(
      <TechnicianBrief {...defaultProps({ brief: null, error: "Network timeout", onRetry })} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/The brief could not load/i);
    expect(screen.getByRole("alert")).toHaveTextContent("Network timeout");
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders empty section when brief is null and not loading", () => {
    const { container } = render(<TechnicianBrief {...defaultProps({ brief: null })} />);
    // Component renders section header but null body content
    const section = container.querySelector("section");
    expect(section).toBeInTheDocument();
    // No evidence list, no review form, no share link section
    expect(screen.queryByRole("list", { name: /required evidence items/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Human review state")).not.toBeInTheDocument();
  });

  it("renders evidence items with correct status labels", () => {
    const evidence: EvidenceItem[] = [
      makeEvidence({ key: "appliance_identity", label: "Appliance brand and model", status: "confirmed", value: "Samsung DV45H7000" }),
      makeEvidence({ key: "symptoms", label: "Symptoms in the customer's own words", status: "confirmed", value: "Dryer runs but produces no heat" }),
      makeEvidence({ key: "timing", label: "When the symptom occurs", status: "uncertain", value: null, source: null }),
      makeEvidence({ key: "error_code", label: "Error code or explicit none", status: "missing", value: null, source: null }),
      makeEvidence({ key: "visit_logistics", label: "Access, parking, pets, and workspace", status: "unverified", value: "2nd floor", source: "coordinator" }),
    ];
    render(<TechnicianBrief {...defaultProps({ brief: makeBrief({ evidence }) })} />);

    const list = screen.getByRole("list", { name: /required evidence items/i });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(5);

    expect(items[0]).toHaveTextContent("Confirmed");
    expect(items[1]).toHaveTextContent("Confirmed");
    expect(items[2]).toHaveTextContent("Uncertain");
    expect(items[3]).toHaveTextContent("Missing");
    expect(items[4]).toHaveTextContent("Unverified");

    expect(screen.getByText("2/5 confirmed")).toBeInTheDocument();
  });

  it("shows safety flags banner when safety flags are present", () => {
    const evidence: EvidenceItem[] = [
      makeEvidence({ key: "symptoms", value: "Smell of gas near dryer", status: "confirmed" }),
    ];
    render(<TechnicianBrief {...defaultProps({ brief: makeBrief({ evidence }) })} />);

    const alert = screen.getByRole("alert", { name: /safety/i });
    expect(within(alert).getByText(/Safety hold/i)).toBeInTheDocument();
    expect(within(alert).getByText("Gas or carbon monoxide")).toBeInTheDocument();
  });

  it("does not show safety flags banner when no hazard text is present", () => {
    const evidence: EvidenceItem[] = [
      makeEvidence({ key: "symptoms", value: "Dryer runs but no heat", status: "confirmed" }),
    ];
    render(<TechnicianBrief {...defaultProps({ brief: makeBrief({ evidence }) })} />);
    expect(screen.queryByText(/Safety hold/i)).not.toBeInTheDocument();
  });

  it("shows contradictions panel when coordinator and call values materially disagree", () => {
    const job = makeJob({ brand: "LG", model: "WM3900" });
    const evidence: EvidenceItem[] = [
      makeEvidence({
        key: "appliance_identity",
        label: "Appliance brand and model",
        status: "confirmed",
        source: "call_reported",
        value: "Whirlpool WFW5605MW",
      }),
    ];
    render(<TechnicianBrief {...defaultProps({ job, brief: makeBrief({ evidence }) })} />);

    expect(screen.getByText(/Don't assume/i)).toBeInTheDocument();
    // LG WM3900 appears in the evidence row and contradictions panel
    expect(screen.getAllByText("LG WM3900").length).toBeGreaterThanOrEqual(1);
    // Whirlpool appears as the call-confirmed value
    expect(screen.getAllByText("Whirlpool WFW5605MW").length).toBeGreaterThanOrEqual(1);
  });

  it("does not show contradictions panel when values agree", () => {
    const job = makeJob({ brand: "Samsung", model: "DV45H7000" });
    const evidence: EvidenceItem[] = [
      makeEvidence({
        key: "appliance_identity",
        label: "Appliance brand and model",
        status: "confirmed",
        source: "call_reported",
        value: "Samsung DV45H7000",
      }),
    ];
    render(<TechnicianBrief {...defaultProps({ job, brief: makeBrief({ evidence }) })} />);
    expect(screen.queryByText(/Don't assume/i)).not.toBeInTheDocument();
  });

  it("shows diagnosis hypothesis when a symptom rule matches", () => {
    const evidence: EvidenceItem[] = [
      makeEvidence({ key: "symptoms", value: "Dryer not heating, cold air only", status: "confirmed" }),
      makeEvidence({ key: "error_code", value: "tC", status: "confirmed" }),
      makeEvidence({ key: "timing", value: "Every cycle", status: "confirmed" }),
    ];
    render(<TechnicianBrief {...defaultProps({ brief: makeBrief({ evidence }) })} />);

    expect(screen.getByText(/diagnostic hypothesis/i)).toBeInTheDocument();
    expect(screen.getByText("Heating circuit")).toBeInTheDocument();
    expect(screen.getByText(/Heating element \/ heating assembly/i)).toBeInTheDocument();
    // Exact text match to avoid matching the description "A tripped thermal fuse cuts heat..."
    expect(screen.getByText("Thermal fuse")).toBeInTheDocument();
    expect(screen.getByText(/Confidence/i)).toBeInTheDocument();
  });

  it("does not show diagnosis hypothesis when safety flags are present", () => {
    const evidence: EvidenceItem[] = [
      makeEvidence({ key: "symptoms", value: "Dryer sparking and not heating", status: "confirmed" }),
    ];
    render(<TechnicianBrief {...defaultProps({ brief: makeBrief({ evidence }) })} />);
    expect(screen.queryByText(/diagnostic hypothesis/i)).not.toBeInTheDocument();
  });

  it("shows human review form elements", () => {
    render(<TechnicianBrief {...defaultProps()} />);

    expect(screen.getByLabelText("Human review state")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Record what needs a human follow-up/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save brief review/i })).toBeInTheDocument();
  });

  it("shows share link section", () => {
    render(<TechnicianBrief {...defaultProps()} />);
    expect(screen.getByRole("button", { name: /create share link/i })).toBeInTheDocument();
  });

  it("shows share link with revoke button when link is active", () => {
    const futureDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    render(
      <TechnicianBrief {...defaultProps({ brief: makeBrief({ share_token: "abc123", share_expires_at: futureDate }) })} />,
    );

    expect(screen.getByRole("button", { name: /revoke/i })).toBeInTheDocument();
    // Use exact "Copy" to distinguish from "Copy summary" button
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.getByDisplayValue(/shared\/abc123/)).toBeInTheDocument();
  });

  it("shows share link error message when shareLinkMessage is set", () => {
    render(<TechnicianBrief {...defaultProps({ shareLinkMessage: "Failed to create link" })} />);
    expect(screen.getByText("Failed to create link")).toBeInTheDocument();
  });

  it("shows visit outcome section when call is completed", () => {
    render(<TechnicianBrief {...defaultProps()} />);

    expect(screen.getByText("Visit outcome")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. Failed thermal fuse")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. Thermal fuse")).toBeInTheDocument();
    expect(screen.getByText("Repair completed this visit")).toBeInTheDocument();
    expect(screen.getByText("Second visit required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save visit outcome/i })).toBeInTheDocument();
  });

  it("hides visit outcome section when call is not completed", () => {
    render(
      <TechnicianBrief {...defaultProps({ brief: makeBrief({ call_completion_status: "in_progress" }) })} />,
    );
    expect(screen.queryByText("Visit outcome")).not.toBeInTheDocument();
  });

  it("shows post-visit check-in section when call is completed", () => {
    render(<TechnicianBrief {...defaultProps()} />);
    expect(screen.getByText("Post-visit check-in")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /prepare post-visit check-in call/i })).toBeInTheDocument();
  });

  it("hides post-visit check-in section when call is not completed", () => {
    render(
      <TechnicianBrief {...defaultProps({ brief: makeBrief({ call_completion_status: "failed" }) })} />,
    );
    expect(screen.queryByText("Post-visit check-in")).not.toBeInTheDocument();
  });

  it("shows follow-up details section", () => {
    const followUps = [
      { key: "follow-up-1", value: "Is the vent clear?", source: "call_reported" as const },
    ];
    render(<TechnicianBrief {...defaultProps({ brief: makeBrief({ follow_ups: followUps }) })} />);

    expect(screen.getByText("Follow-up details")).toBeInTheDocument();
    expect(screen.getByText("Is the vent clear?")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: /follow-up details/i })).toBeInTheDocument();
  });

  it("shows prepare follow-up call button when readiness needs follow-up", () => {
    render(
      <TechnicianBrief {...defaultProps({ brief: makeBrief({ readiness_status: "needs_follow_up" }) })} />,
    );
    expect(screen.getByRole("button", { name: /prepare follow-up call/i })).toBeInTheDocument();
  });

  it("shows blockers section with explicit blocker", () => {
    const blockers = [
      { value: "Elevator out of service", source: "call_reported" as const, supporting_excerpt: null },
    ];
    render(<TechnicianBrief {...defaultProps({ brief: makeBrief({ blockers }) })} />);
    expect(screen.getByText("Visit blockers")).toBeInTheDocument();
    expect(screen.getByText("Elevator out of service")).toBeInTheDocument();
  });

  it("shows empty blockers message when no blockers recorded", () => {
    render(<TechnicianBrief {...defaultProps()} />);
    expect(screen.getByText(/No blockers have been explicitly recorded/)).toBeInTheDocument();
  });

  it("disables action buttons when saving is true", () => {
    render(<TechnicianBrief {...defaultProps({ saving: true })} />);
    // Button text changes to "Saving brief review…" when saving is true
    expect(screen.getByRole("button", { name: /saving brief review/i })).toBeDisabled();
    expect(screen.getByLabelText("Human review state")).toBeDisabled();
  });

  it("shows saving spinner in save review button when saving", () => {
    render(<TechnicianBrief {...defaultProps({ saving: true })} />);
    expect(screen.getByText("Saving brief review\u2026")).toBeInTheDocument();
  });

  it("shows loading spinner in share link create button when shareLinkState is loading", () => {
    render(<TechnicianBrief {...defaultProps({ shareLinkState: "loading" })} />);
    expect(screen.getByRole("button", { name: /create share link/i })).toBeDisabled();
  });

  it("shows safety hazard badge on blocker with hazard text", () => {
    const blockers = [
      { value: "Gas smell near dryer", source: "call_reported" as const, supporting_excerpt: null },
    ];
    render(<TechnicianBrief {...defaultProps({ brief: makeBrief({ blockers }) })} />);

    // The hazard text appears in the blockers list with a "Safety hazard" badge
    expect(screen.getByText("Safety hazard")).toBeInTheDocument();
    // Use getAllByText since the same value may appear in evidence rows too
    const hazardTexts = screen.getAllByText("Gas smell near dryer");
    expect(hazardTexts.length).toBeGreaterThanOrEqual(1);
  });

  it("shows no call evidence notice when no call-reported evidence exists", () => {
    const evidence: EvidenceItem[] = [
      makeEvidence({ key: "appliance_identity", source: "coordinator", status: "unverified", value: "Samsung" }),
    ];
    render(<TechnicianBrief {...defaultProps({ brief: makeBrief({ evidence }) })} />);
    // The "No call evidence yet" text appears both in the readiness decision title
    // and in the no-evidence notice. Use getAllByText.
    const matches = screen.getAllByText("No call evidence yet");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("hides no call evidence notice when call-reported evidence exists", () => {
    render(<TechnicianBrief {...defaultProps()} />);
    // With call-reported evidence, "No call evidence yet" should not appear at all
    const matches = screen.queryAllByText("No call evidence yet");
    expect(matches).toHaveLength(0);
  });

  it("calls onSaveOutcome with form values when save visit outcome is clicked", async () => {
    const onSaveOutcome = vi.fn().mockResolvedValue(undefined);
    render(<TechnicianBrief {...defaultProps({ onSaveOutcome })} />);

    await userEvent.type(screen.getByPlaceholderText("e.g. Failed thermal fuse"), "Failed thermal fuse");
    await userEvent.type(screen.getByPlaceholderText("e.g. Thermal fuse"), "Thermal fuse");
    await userEvent.click(screen.getByText("Repair completed this visit"));
    await userEvent.click(screen.getByRole("button", { name: /save visit outcome/i }));

    expect(onSaveOutcome).toHaveBeenCalledOnce();
    expect(onSaveOutcome).toHaveBeenCalledWith({
      actual_diagnosis: "Failed thermal fuse",
      part_used: "Thermal fuse",
      repair_completed: true,
      second_visit_required: false,
    });
  });
});
