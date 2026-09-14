import { supabase } from "@/lib/supabase/client";

export type CalleConnectionStatus = "connected" | "not_connected" | "error";

export interface CalleConnectionResult {
  status: CalleConnectionStatus;
  message: string;
}

async function invoke<T>(name: string, body: object): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw error;
  return data as T;
}

export const checkCalleConnection = (input: Record<string, unknown> = {}) =>
  invoke<CalleConnectionResult>("check-calle-connection", input);

export type AuthorizedDemoCallStatus = "submitted" | "already_started" | "uncertain_submit" | "blocked" | "error";
export interface RunAuthorizedDemoCallInput {
  action: "run_authorized_demo_call";
}
export interface RunAuthorizedDemoCallResult {
  status: AuthorizedDemoCallStatus;
  message: string;
  repair_job_id?: string;
  call_attempt_id?: string;
  safe_error_category?: CalleSafeErrorCategory;
}
export const runAuthorizedDemoCall = (input: RunAuthorizedDemoCallInput) =>
  invoke<RunAuthorizedDemoCallResult>("run-authorized-demo-call", input);

export type CalleSafeErrorCategory = "provider_auth" | "validation" | "rate_or_credit" | "network" | "unexpected";

export interface DispatchCalleCallInput {
  repair_job_id: string;
  call_attempt_id: string;
}

export interface DispatchCalleCallResult {
  status: "dispatch_locked" | "submitted" | "uncertain_submit" | "error";
  message: string;
  safe_error_category?: CalleSafeErrorCategory;
}

// This action validates private ownership and approval prerequisites, then remains fail-closed.
export const dispatchCalleCall = (input: DispatchCalleCallInput) =>
  invoke<DispatchCalleCallResult>("dispatch-calle-call", input);

export interface ApproveCalleCallInput {
  repair_job_id: string;
  call_attempt_id: string;
  confirmed_phone: string;
  region: string;
  locale: string;
}

export interface ApproveCalleCallResult {
  status: "approved" | "error";
  message: string;
  approval_expires_at?: string;
}

// Requires the coordinator to re-type the exact saved number. Approves one call for a short
// window; it does not place the call itself — dispatchCalleCall does that afterward.
export const approveCalleCall = (input: ApproveCalleCallInput) =>
  invoke<ApproveCalleCallResult>("approve-calle-call", input);

export interface GetCalleCallStatusInput {
  call_attempt_id: string;
}

export interface GetCalleCallStatusResult {
  status: "status" | "status_uncertain" | "error";
  message: string;
  repair_job_id?: string;
  call_attempt_id?: string;
  provider_status?: "queued" | "in_progress" | "completed" | "failed" | "canceled";
  safe_result_summary?: string | null;
  safe_error_category?: CalleSafeErrorCategory;
}

// User-triggered only. The server permits this route only for the exact authorized demo attempt.
export const getCalleCallStatus = (input: GetCalleCallStatusInput) =>
  invoke<GetCalleCallStatusResult>("get-calle-call-status", input);
