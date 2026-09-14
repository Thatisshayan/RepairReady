import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  type RepairJobInput,
  type RepairJobRecord,
} from "@/lib/repair-jobs";

/* -------------------------------------------------------------------------- */
/*  Mock Sheet so Radix dialog doesn't portal in jsdom                        */
/* -------------------------------------------------------------------------- */
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="sheet">{children}</div> : null,
  SheetContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sheet-content">{children}</div>
  ),
  SheetHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sheet-header">{children}</div>
  ),
  SheetFooter: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sheet-footer">{children}</div>
  ),
  SheetTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  SheetDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
}));

/* -------------------------------------------------------------------------- */
/*  Mock Select so Radix doesn't portal in jsdom                              */
/* -------------------------------------------------------------------------- */
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) => (
    <select
      data-testid="select-appliance"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => <option value={value}>{children}</option>,
}));

/* -------------------------------------------------------------------------- */
/*  Import component AFTER mocks                                              */
/* -------------------------------------------------------------------------- */
import { JobEditor } from "@/components/repairready/JobEditor";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */
function jobRecord(overrides: Partial<RepairJobRecord> = {}): RepairJobRecord {
  return {
    id: "job-123",
    customer_name: "Jane Doe",
    phone: "+15550199999",
    appliance_type: "refrigerator",
    brand: "Samsung",
    model: "RF28",
    reported_problem: "Not cooling properly, fridge section warm",
    symptom_timing: "During the day",
    error_code: "E4",
    visit_note: "Bring thermometer",
    access_notes: "Side entrance",
    operator_notes: "Customer is elderly",
    ...overrides,
  };
}

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    job: null as RepairJobRecord | null,
    onSave: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** Find the last rendered sheet-footer's buttons to avoid stale-element leakage. */
function getFooter(container: HTMLElement) {
  const footers = container.querySelectorAll("[data-testid='sheet-footer']");
  return footers[footers.length - 1] as HTMLElement;
}

/* -------------------------------------------------------------------------- */
/*  Tests                                                                     */
/* -------------------------------------------------------------------------- */

describe("JobEditor", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /* 1. Renders nothing when open is false */
  it("renders nothing when open is false", () => {
    const { container } = render(<JobEditor {...defaultProps({ open: false })} />);
    expect(container.querySelector("[data-testid='sheet']")).toBeNull();
    expect(screen.queryByText("Create repair job")).toBeNull();
  });

  /* 2. Shows Create title when job is null (create mode) */
  it("shows Create title when job is null (create mode)", () => {
    render(<JobEditor {...defaultProps()} />);
    expect(screen.getByText("Create repair job")).toBeDefined();
    expect(screen.getByText("New job draft")).toBeDefined();
    expect(screen.getByText("Create job")).toBeDefined();
  });

  /* 3. Shows Edit title when job has an id (edit mode) */
  it("shows Edit title when job has an id (edit mode)", () => {
    render(<JobEditor {...defaultProps({ job: jobRecord() })} />);
    expect(screen.getByText("Update repair job")).toBeDefined();
    expect(screen.getByText("Edit draft")).toBeDefined();
    expect(screen.getByText("Save changes")).toBeDefined();
  });

  /* 4. Pre-fills form fields when editing an existing job */
  it("pre-fills form fields when editing an existing job", () => {
    const job = jobRecord();
    const { container } = render(<JobEditor {...defaultProps({ job })} />);

    expect(container.querySelector<HTMLInputElement>("#customer_name")?.value).toBe("Jane Doe");
    expect(container.querySelector<HTMLInputElement>("#phone")?.value).toBe("+15550199999");
    expect(container.querySelector<HTMLTextAreaElement>("#reported_problem")?.value).toBe(
      "Not cooling properly, fridge section warm"
    );
    expect(container.querySelector<HTMLInputElement>("#brand")?.value).toBe("Samsung");
    expect(container.querySelector<HTMLInputElement>("#model")?.value).toBe("RF28");
    expect(container.querySelector<HTMLInputElement>("#symptom_timing")?.value).toBe(
      "During the day"
    );
    expect(container.querySelector<HTMLInputElement>("#error_code")?.value).toBe("E4");
    expect(container.querySelector<HTMLTextAreaElement>("#visit_note")?.value).toBe(
      "Bring thermometer"
    );
    expect(container.querySelector<HTMLTextAreaElement>("#access_notes")?.value).toBe(
      "Side entrance"
    );
    expect(container.querySelector<HTMLTextAreaElement>("#operator_notes")?.value).toBe(
      "Customer is elderly"
    );
  });

  /* 5. Shows validation errors when submitting with empty required fields */
  it("shows validation errors when submitting with empty required fields", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    const { container } = render(
      <JobEditor {...defaultProps({ onSave, onOpenChange })} />
    );

    const nameInput = container.querySelector<HTMLInputElement>("#customer_name")!;
    const phoneInput = container.querySelector<HTMLInputElement>("#phone")!;
    const problemInput = container.querySelector<HTMLTextAreaElement>("#reported_problem")!;

    await user.clear(nameInput);
    await user.clear(phoneInput);
    await user.clear(problemInput);

    const footer = getFooter(container);
    await user.click(footer.querySelector("button[type='submit']")!);

    expect(await screen.findByText("Customer name is required.")).toBeDefined();
    expect(await screen.findByText("Phone number is required.")).toBeDefined();
    expect(
      await screen.findByText("Describe the reported problem.")
    ).toBeDefined();

    expect(onSave).not.toHaveBeenCalled();
  });

  /* 6. Calls onSave with correct data when form is valid */
  it("calls onSave with correct data when form is valid", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<JobEditor {...defaultProps({ onSave })} />);

    const nameInput = container.querySelector<HTMLInputElement>("#customer_name")!;
    const phoneInput = container.querySelector<HTMLInputElement>("#phone")!;
    const problemInput = container.querySelector<HTMLTextAreaElement>("#reported_problem")!;

    await user.type(nameInput, "John Smith");
    await user.clear(phoneInput);
    await user.type(phoneInput, "+15551234567");
    await user.type(problemInput, "Washer not draining after cycle");

    const footer = getFooter(container);
    await user.click(footer.querySelector("button[type='submit']")!);

    expect(onSave).toHaveBeenCalledTimes(1);
    const calledWith = onSave.mock.calls[0][0] as RepairJobInput;
    expect(calledWith.customer_name).toContain("John Smith");
    expect(calledWith.phone).toContain("+15551234567");
    expect(calledWith.reported_problem).toContain("Washer not draining after cycle");
  });

  /* 7. Calls onSave with the job id when editing */
  it("calls onSave with the job id when editing", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const job = jobRecord();
    const { container } = render(<JobEditor {...defaultProps({ job, onSave })} />);

    const footer = getFooter(container);
    await user.click(footer.querySelector("button[type='submit']")!);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][1]).toBe("job-123");
  });

  /* 8. Calls onSave with null jobId when creating */
  it("calls onSave with null jobId when creating", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<JobEditor {...defaultProps({ onSave })} />);

    const nameInput = container.querySelector<HTMLInputElement>("#customer_name")!;
    const phoneInput = container.querySelector<HTMLInputElement>("#phone")!;
    const problemInput = container.querySelector<HTMLTextAreaElement>("#reported_problem")!;

    await user.type(nameInput, "John Smith");
    await user.clear(phoneInput);
    await user.type(phoneInput, "+15551234567");
    await user.type(problemInput, "Washer not draining after cycle");

    const footer = getFooter(container);
    await user.click(footer.querySelector("button[type='submit']")!);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][1]).toBeNull();
  });

  /* 9. Shows saving state while onSave is in progress */
  it("shows saving state while onSave is in progress", async () => {
    const user = userEvent.setup();

    let resolveSave!: () => void;
    const savePromise = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const onSave = vi.fn().mockReturnValue(savePromise);

    const { container } = render(<JobEditor {...defaultProps({ onSave })} />);

    const nameInput = container.querySelector<HTMLInputElement>("#customer_name")!;
    const phoneInput = container.querySelector<HTMLInputElement>("#phone")!;
    const problemInput = container.querySelector<HTMLTextAreaElement>("#reported_problem")!;

    await user.type(nameInput, "John Smith");
    await user.clear(phoneInput);
    await user.type(phoneInput, "+15551234567");
    await user.type(problemInput, "Washer not draining after cycle");

    const footer = getFooter(container);
    await user.click(footer.querySelector("button[type='submit']")!);

    // Should show saving text while the promise is pending
    expect(screen.getByText("Saving\u2026")).toBeDefined();
    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();

    resolveSave();
    await savePromise;
  });

  /* 10. Calls onOpenChange(false) when cancel is clicked */
  it("calls onOpenChange(false) when cancel is clicked", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { container } = render(<JobEditor {...defaultProps({ onOpenChange })} />);

    const footer = getFooter(container);
    const cancelBtn = footer.querySelector("button[type='button']")!;
    await user.click(cancelBtn);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
