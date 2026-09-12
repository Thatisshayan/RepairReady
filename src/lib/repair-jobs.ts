import { RepairJob } from "@/entities";

export const APPLIANCE_TYPES = [
  { value: "washing_machine", label: "Washing machine" },
  { value: "dryer", label: "Dryer" },
  { value: "dishwasher", label: "Dishwasher" },
  { value: "refrigerator", label: "Refrigerator" },
  { value: "oven_range", label: "Oven / range" },
  { value: "other", label: "Other" },
] as const;

export type ApplianceType = (typeof APPLIANCE_TYPES)[number]["value"];

export interface RepairJobRecord {
  id: string;
  customer_name: string;
  phone: string;
  appliance_type: ApplianceType | string;
  brand?: string | null;
  model?: string | null;
  reported_problem: string;
  symptom_timing?: string | null;
  error_code?: string | null;
  visit_note?: string | null;
  access_notes?: string | null;
  operator_notes?: string | null;
  created_at?: string;
  updated_at?: string;
  /** Some SDK responses expose *_date aliases */
  created_date?: string;
  updated_date?: string;
  created_by?: string;
}

export type RepairJobInput = {
  customer_name: string;
  phone: string;
  appliance_type: ApplianceType;
  brand: string;
  model: string;
  reported_problem: string;
  symptom_timing: string;
  error_code: string;
  visit_note: string;
  access_notes: string;
  operator_notes: string;
};

export type FieldErrors = Partial<Record<keyof RepairJobInput, string>>;

const LIMITS = {
  customer_name: 80,
  phone: 32,
  brand: 60,
  model: 80,
  reported_problem: 500,
  symptom_timing: 200,
  error_code: 40,
  visit_note: 400,
  access_notes: 400,
  operator_notes: 600,
} as const;

// The stored value must be canonical E.164-style: a leading + and 7–15 digits.
const PHONE_RE = /^\+[1-9]\d{6,14}$/;
// Formatting is allowed only between the leading + and digits. Letters and extensions stay invalid.
const PHONE_FORMAT_RE = /^\+[\d\s().-]+$/;

/**
 * Known, already-tested CALL-E number. Pre-filled as the default so the low-friction path is
 * the safe one; coordinators can still overwrite it with a real customer's number when they
 * mean to place a real call to that person.
 */
export const SAFE_DEFAULT_PHONE = "+13058347598" as const;

export function emptyJobInput(): RepairJobInput {
  return {
    customer_name: "",
    phone: SAFE_DEFAULT_PHONE,
    appliance_type: "washing_machine",
    brand: "",
    model: "",
    reported_problem: "",
    symptom_timing: "",
    error_code: "",
    visit_note: "",
    access_notes: "",
    operator_notes: "",
  };
}

export function jobToInput(job: RepairJobRecord): RepairJobInput {
  return {
    customer_name: job.customer_name ?? "",
    phone: job.phone ?? "",
    appliance_type: (job.appliance_type as ApplianceType) || "washing_machine",
    brand: job.brand ?? "",
    model: job.model ?? "",
    reported_problem: job.reported_problem ?? "",
    symptom_timing: job.symptom_timing ?? "",
    error_code: job.error_code ?? "",
    visit_note: job.visit_note ?? "",
    access_notes: job.access_notes ?? "",
    operator_notes: job.operator_notes ?? "",
  };
}

function trimOrEmpty(value: string | undefined | null): string {
  return (value ?? "").trim();
}

function optionalText(value: string, max: number): string | null {
  const t = value.trim();
  if (!t) return null;
  return t.slice(0, max);
}

/**
 * Conservatively canonicalizes phone formatting. Invalid text is returned unchanged so validation
 * can explain the problem instead of silently turning letters, extensions, or local numbers into
 * something that could later be dialed.
 */
export function normalizePhoneInput(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (!PHONE_FORMAT_RE.test(value)) return value;
  return `+${value.slice(1).replace(/[\s().-]/g, "")}`;
}

/** Display helper only. Does not guess country or make the number clickable. */
export function formatPhoneDisplay(phone: string): string {
  const n = normalizePhoneInput(phone);
  if (!n) return "";
  if (!n.startsWith("+") || !PHONE_RE.test(n)) return n;
  // Light grouping for readability; never invent a national format.
  const digits = n.slice(1);
  if (digits.length <= 4) return n;
  if (digits.length <= 7) return `+${digits.slice(0, digits.length - 4)} ${digits.slice(-4)}`;
  const country = digits.slice(0, Math.min(3, digits.length - 7));
  const rest = digits.slice(country.length);
  const groups: string[] = [];
  let i = 0;
  while (i < rest.length) {
    const take = rest.length - i > 4 ? 3 : rest.length - i;
    groups.push(rest.slice(i, i + take));
    i += take;
  }
  return `+${country} ${groups.join(" ")}`;
}

export function applianceLabel(type: string): string {
  return APPLIANCE_TYPES.find((a) => a.value === type)?.label ?? type;
}

export function validateJobInput(input: RepairJobInput): FieldErrors {
  const errors: FieldErrors = {};
  const name = trimOrEmpty(input.customer_name);
  if (!name) errors.customer_name = "Customer name is required.";
  else if (name.length > LIMITS.customer_name)
    errors.customer_name = `Keep the name under ${LIMITS.customer_name} characters.`;

  const rawPhone = trimOrEmpty(input.phone);
  const phone = normalizePhoneInput(rawPhone);
  if (!rawPhone) errors.phone = "Phone number is required.";
  else if (rawPhone.length > LIMITS.phone)
    errors.phone = `Keep the phone entry under ${LIMITS.phone} characters.`;
  else if (!PHONE_RE.test(phone))
    errors.phone =
      "Use +countrycode with 7–15 digits after +. Spaces, dots, parentheses, and hyphens are okay; letters and extensions are not saved.";

  if (!APPLIANCE_TYPES.some((a) => a.value === input.appliance_type))
    errors.appliance_type = "Choose a supported appliance type.";

  const problem = trimOrEmpty(input.reported_problem);
  if (!problem) errors.reported_problem = "Describe the reported problem.";
  else if (problem.length < 8)
    errors.reported_problem = "Add a short description of the issue (at least a few words).";
  else if (problem.length > LIMITS.reported_problem)
    errors.reported_problem = `Keep the problem under ${LIMITS.reported_problem} characters.`;

  const checkOpt = (key: keyof typeof LIMITS, label: string) => {
    const v = trimOrEmpty(input[key as keyof RepairJobInput] as string);
    if (v.length > LIMITS[key])
      errors[key as keyof RepairJobInput] = `${label} must be under ${LIMITS[key]} characters.`;
  };
  checkOpt("brand", "Brand");
  checkOpt("model", "Model");
  checkOpt("symptom_timing", "Symptom timing");
  checkOpt("error_code", "Error code");
  checkOpt("visit_note", "Visit note");
  checkOpt("access_notes", "Access notes");
  checkOpt("operator_notes", "Operator notes");

  return errors;
}

export function toPayload(input: RepairJobInput) {
  return {
    customer_name: trimOrEmpty(input.customer_name).slice(0, LIMITS.customer_name),
    phone: normalizePhoneInput(input.phone),
    appliance_type: input.appliance_type,
    brand: optionalText(input.brand, LIMITS.brand),
    model: optionalText(input.model, LIMITS.model),
    reported_problem: trimOrEmpty(input.reported_problem).slice(0, LIMITS.reported_problem),
    symptom_timing: optionalText(input.symptom_timing, LIMITS.symptom_timing),
    error_code: optionalText(input.error_code, LIMITS.error_code),
    visit_note: optionalText(input.visit_note, LIMITS.visit_note),
    access_notes: optionalText(input.access_notes, LIMITS.access_notes),
    operator_notes: optionalText(input.operator_notes, LIMITS.operator_notes),
  };
}

export type PrepStatus = "entered" | "missing";

export interface PrepItem {
  key: string;
  label: string;
  status: PrepStatus;
  value: string | null;
}

/** Draft checklist only. Never marks confirmed or ready. */
export function preparationChecklist(job: RepairJobRecord): PrepItem[] {
  const val = (v?: string | null) => {
    const t = (v ?? "").trim();
    return t ? t : null;
  };
  const items: Array<{ key: string; label: string; raw: string | null }> = [
    { key: "customer", label: "Customer name", raw: val(job.customer_name) },
    { key: "phone", label: "Phone number", raw: val(job.phone) },
    { key: "appliance", label: "Appliance type", raw: val(job.appliance_type) },
    { key: "brand", label: "Brand", raw: val(job.brand) },
    { key: "model", label: "Model", raw: val(job.model) },
    { key: "problem", label: "Reported problem", raw: val(job.reported_problem) },
    { key: "timing", label: "Symptom timing", raw: val(job.symptom_timing) },
    { key: "error", label: "Error code", raw: val(job.error_code) },
    { key: "visit", label: "Visit note", raw: val(job.visit_note) },
    { key: "access", label: "Access notes", raw: val(job.access_notes) },
  ];
  return items.map((i) => ({
    key: i.key,
    label: i.label,
    status: i.raw ? ("entered" as const) : ("missing" as const),
    value: i.raw,
  }));
}

export function statusLabel(status: PrepStatus): string {
  return status === "entered" ? "Entered by coordinator" : "Missing";
}

export function hasMissingInfo(job: RepairJobRecord): boolean {
  return preparationChecklist(job).some(
    (i) =>
      i.status === "missing" &&
      ["brand", "model", "timing", "error", "visit", "access"].includes(i.key)
  );
}

export async function listRepairJobs(): Promise<RepairJobRecord[]> {
  // SDK list sort examples use *_date aliases (e.g. -updated_date).
  const rows = await RepairJob.list("-updated_date", 200);
  return (rows as RepairJobRecord[]) ?? [];
}

export function jobUpdatedAt(job: RepairJobRecord): string | undefined {
  return job.updated_at ?? job.updated_date ?? job.created_at ?? job.created_date;
}

export async function createRepairJob(input: RepairJobInput): Promise<RepairJobRecord> {
  const errors = validateJobInput(input);
  if (Object.keys(errors).length) {
    const err = new Error("Validation failed") as Error & { fieldErrors: FieldErrors };
    err.fieldErrors = errors;
    throw err;
  }
  const created = await RepairJob.create(toPayload(input));
  return created as RepairJobRecord;
}

export async function updateRepairJob(
  id: string,
  input: RepairJobInput
): Promise<RepairJobRecord> {
  const errors = validateJobInput(input);
  if (Object.keys(errors).length) {
    const err = new Error("Validation failed") as Error & { fieldErrors: FieldErrors };
    err.fieldErrors = errors;
    throw err;
  }
  const updated = await RepairJob.update(id, toPayload(input));
  return updated as RepairJobRecord;
}

export async function deleteRepairJob(id: string): Promise<void> {
  await RepairJob.delete(id);
}

export function friendlyError(error: unknown, fallback: string): string {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  const e = error as { message?: string; status?: number; response?: { status?: number } };
  const status = e.status ?? e.response?.status;
  if (status === 401 || status === 403)
    return "You need to be signed in, and you can only manage your own jobs.";
  if (status === 404) return "That job was not found. It may have been deleted.";
  if (e.message && !/failed to fetch|network/i.test(e.message)) return e.message;
  return fallback;
}

export function formatTimestamp(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return "—";
  }
}

export function matchesSearch(job: RepairJobRecord, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    job.customer_name,
    job.phone,
    applianceLabel(job.appliance_type),
    job.appliance_type,
    job.brand,
    job.model,
    job.reported_problem,
    job.error_code,
    job.visit_note,
    job.access_notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}
