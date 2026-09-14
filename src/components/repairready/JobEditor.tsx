import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import {
  APPLIANCE_TYPES,
  ApplianceType,
  emptyJobInput,
  FieldErrors,
  friendlyError,
  jobToInput,
  RepairJobInput,
  RepairJobRecord,
  validateJobInput,
} from "@/lib/repair-jobs";

interface JobEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: RepairJobRecord | null;
  onSave: (input: RepairJobInput, jobId: string | null) => Promise<void>;
}

export function JobEditor({ open, onOpenChange, job, onSave }: JobEditorProps) {
  const [form, setForm] = useState<RepairJobInput>(emptyJobInput());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = Boolean(job?.id);

  useEffect(() => {
    if (!open) return;
    setForm(job ? jobToInput(job) : emptyJobInput());
    setErrors({});
    setSubmitError(null);
    setSaving(false);
  }, [open, job]);

  const setField = <K extends keyof RepairJobInput>(key: K, value: RepairJobInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const fieldErrors = validateJobInput(form);
    if (Object.keys(fieldErrors).length) {
      setErrors(fieldErrors);
      setSubmitError("Fix the highlighted fields, then try again.");
      return;
    }
    setSaving(true);
    setSubmitError(null);
    try {
      await onSave(form, job?.id ?? null);
      onOpenChange(false);
    } catch (err) {
      const withFields = err as { fieldErrors?: FieldErrors };
      if (withFields.fieldErrors) setErrors(withFields.fieldErrors);
      setSubmitError(
        friendlyError(err, "Could not save this job. Your entries are still here; try again.")
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-l border-border bg-card p-0 sm:max-w-lg"
      >
        <SheetHeader className="rr-editor-header border-b border-border px-5 py-5 text-left sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">
              {isEdit ? "Edit draft" : "New job draft"}
            </p>
            <span className="rr-status-chip border-border bg-background text-muted-foreground">
              Private
            </span>
          </div>
          <SheetTitle className="text-xl font-semibold tracking-tight text-foreground">
            {isEdit ? "Update repair job" : "Create repair job"}
          </SheetTitle>
          <SheetDescription className="max-w-md text-sm leading-relaxed text-muted-foreground">
            Capture what the coordinator knows today. Every entry remains an unverified draft until a
            later, separately authorized phase.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="flex-1 space-y-7 overflow-y-auto px-5 py-5 sm:px-6">
            <section className="space-y-3">
              <SectionLabel eyebrow="01">Customer</SectionLabel>
              <Field id="customer_name" label="Customer name" required error={errors.customer_name}>
                <Input
                  id="customer_name"
                  value={form.customer_name}
                  onChange={(e) => setField("customer_name", e.target.value)}
                  placeholder="Full name"
                  autoComplete="name"
                  disabled={saving}
                  aria-invalid={Boolean(errors.customer_name)}
                  aria-describedby={errors.customer_name ? "customer_name-error" : undefined}
                  className="bg-background"
                />
              </Field>
              <Field
                id="phone"
                label="Phone"
                required
                error={errors.phone}
                hint="Required"
                helper="Pre-filled with a known, already-tested CALL-E number. Replace it with the real customer's number when you're ready to call them — no call happens from this form either way."
              >
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={(e) => setField("phone", e.target.value)}
                  placeholder="+14165551234"
                  inputMode="tel"
                  autoComplete="tel"
                  disabled={saving}
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={errors.phone ? "phone-error" : "phone-help"}
                  className="bg-background font-mono text-sm"
                />
              </Field>
            </section>

            <section className="space-y-3">
              <SectionLabel eyebrow="02">Appliance & issue</SectionLabel>
              <Field id="appliance_type" label="Appliance" required error={errors.appliance_type}>
                <Select
                  value={form.appliance_type}
                  onValueChange={(v) => setField("appliance_type", v as ApplianceType)}
                  disabled={saving}
                >
                  <SelectTrigger
                    id="appliance_type"
                    className="bg-background"
                    aria-invalid={Boolean(errors.appliance_type)}
                    aria-describedby={errors.appliance_type ? "appliance_type-error" : undefined}
                  >
                    <SelectValue placeholder="Select appliance" />
                  </SelectTrigger>
                  <SelectContent>
                    {APPLIANCE_TYPES.map((a) => (
                      <SelectItem key={a.value} value={a.value}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field id="brand" label="Brand" error={errors.brand} hint="If known">
                  <Input
                    id="brand"
                    value={form.brand}
                    onChange={(e) => setField("brand", e.target.value)}
                    placeholder="e.g. LG"
                    disabled={saving}
                    aria-invalid={Boolean(errors.brand)}
                    aria-describedby={errors.brand ? "brand-error" : undefined}
                    className="bg-background"
                  />
                </Field>
                <Field id="model" label="Model" error={errors.model} hint="If known">
                  <Input
                    id="model"
                    value={form.model}
                    onChange={(e) => setField("model", e.target.value)}
                    placeholder="Model number"
                    disabled={saving}
                    aria-invalid={Boolean(errors.model)}
                    aria-describedby={errors.model ? "model-error" : undefined}
                    className="bg-background"
                  />
                </Field>
              </div>
              <Field id="reported_problem" label="Reported problem" required error={errors.reported_problem}>
                <Textarea
                  id="reported_problem"
                  value={form.reported_problem}
                  onChange={(e) => setField("reported_problem", e.target.value)}
                  placeholder="What the customer described…"
                  rows={3}
                  disabled={saving}
                  aria-invalid={Boolean(errors.reported_problem)}
                  aria-describedby={errors.reported_problem ? "reported_problem-error" : undefined}
                  className="resize-y bg-background"
                />
              </Field>
              <Field id="symptom_timing" label="When it happens" error={errors.symptom_timing} hint="Optional">
                <Input
                  id="symptom_timing"
                  value={form.symptom_timing}
                  onChange={(e) => setField("symptom_timing", e.target.value)}
                  placeholder="e.g. during spin cycle"
                  disabled={saving}
                  aria-invalid={Boolean(errors.symptom_timing)}
                  aria-describedby={errors.symptom_timing ? "symptom_timing-error" : undefined}
                  className="bg-background"
                />
              </Field>
              <Field id="error_code" label="Error code" error={errors.error_code} hint="Optional">
                <Input
                  id="error_code"
                  value={form.error_code}
                  onChange={(e) => setField("error_code", e.target.value)}
                  placeholder="Display code if shown"
                  disabled={saving}
                  aria-invalid={Boolean(errors.error_code)}
                  aria-describedby={errors.error_code ? "error_code-error" : undefined}
                  className="bg-background font-mono text-sm"
                />
              </Field>
            </section>

            <section className="space-y-3">
              <SectionLabel eyebrow="03">Visit & access</SectionLabel>
              <Field
                id="visit_note"
                label="Visit note"
                error={errors.visit_note}
                hint="Existing details only"
                helper="This records a note about an existing visit. It does not schedule one."
              >
                <Textarea
                  id="visit_note"
                  value={form.visit_note}
                  onChange={(e) => setField("visit_note", e.target.value)}
                  placeholder="e.g. Customer mentioned Friday afternoon window"
                  rows={2}
                  disabled={saving}
                  aria-invalid={Boolean(errors.visit_note)}
                  aria-describedby={errors.visit_note ? "visit_note-error" : "visit_note-help"}
                  className="resize-y bg-background"
                />
              </Field>
              <Field
                id="access_notes"
                label="Access notes"
                error={errors.access_notes}
                hint="Parking, pets, entry"
                helper="Do not store alarm, door, or other security codes."
              >
                <Textarea
                  id="access_notes"
                  value={form.access_notes}
                  onChange={(e) => setField("access_notes", e.target.value)}
                  placeholder="How the technician reaches the appliance…"
                  rows={2}
                  disabled={saving}
                  aria-invalid={Boolean(errors.access_notes)}
                  aria-describedby={errors.access_notes ? "access_notes-error" : "access_notes-help"}
                  className="resize-y bg-background"
                />
              </Field>
              <Field id="operator_notes" label="Operator notes" error={errors.operator_notes} hint="Internal only">
                <Textarea
                  id="operator_notes"
                  value={form.operator_notes}
                  onChange={(e) => setField("operator_notes", e.target.value)}
                  placeholder="Anything else the team should know…"
                  rows={2}
                  disabled={saving}
                  aria-invalid={Boolean(errors.operator_notes)}
                  aria-describedby={errors.operator_notes ? "operator_notes-error" : undefined}
                  className="resize-y bg-background"
                />
              </Field>
            </section>

            {submitError && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm leading-relaxed text-destructive"
              >
                {submitError}
              </p>
            )}
          </div>

          <SheetFooter className="rr-safe-bottom flex-row gap-2 border-t border-border bg-card px-5 py-4 sm:justify-between sm:px-6">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="min-w-[9rem] bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : isEdit ? (
                "Save changes"
              ) : (
                "Create job"
              )}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function SectionLabel({ children, eyebrow }: { children: ReactNode; eyebrow: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-border/70 pb-2">
      <span className="font-mono text-[10px] font-medium tracking-[0.16em] text-primary">{eyebrow}</span>
      <h3 className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {children}
      </h3>
    </div>
  );
}

function Field({
  id,
  label,
  required,
  error,
  hint,
  helper,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  helper?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="ml-1 text-primary" aria-hidden>*</span>}
        </Label>
        {hint && !error && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
      {helper && !error && (
        <p id={`${id}-help`} className="text-[11px] leading-relaxed text-muted-foreground">
          {helper}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs leading-relaxed text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
