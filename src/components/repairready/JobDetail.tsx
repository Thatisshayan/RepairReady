import { useEffect, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  Phone,
  Pencil,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  checkCalleConnection,
  type AuthorizedDemoCallStatus,
  type CalleConnectionResult,
} from "@/functions";
import {
  callPurposeForJob,
  isAuthorizedDemoAttempt,
  isCanonicalE164Phone,
  isRemoteCallStatus,
  parseQuestionOutline,
  type CallAttemptDraft,
} from "@/lib/call-attempts";
import { TechnicianBrief } from "@/components/repairready/TechnicianBrief";
import { adaptiveQuestionsForJob, type FollowUpReview, type HumanReviewState, type RepairBriefView } from "@/lib/repair-briefs";
import {
  applianceLabel,
  formatTimestamp,
  jobUpdatedAt,
  preparationChecklist,
  RepairJobRecord,
  statusLabel,
} from "@/lib/repair-jobs";

interface JobDetailProps {
  job: RepairJobRecord;
  onEdit: () => void;
  onDelete: () => void;
  callDraft: CallAttemptDraft | null;
  callDraftLoading: boolean;
  callDraftSaving: boolean;
  callDraftError: string | null;
  onSaveCallDraft: () => Promise<void>;
  brief: RepairBriefView | null;
  briefLoading: boolean;
  briefSaving: boolean;
  briefError: string | null;
  onRetryBrief: () => void;
  onSaveBriefReview: (state: HumanReviewState, note: string, followUpReviews: FollowUpReview[]) => Promise<void>;
  onCopyBriefSummary: () => Promise<void>;
  authorizedDemoActionState: "idle" | "loading" | AuthorizedDemoCallStatus;
  authorizedDemoMessage: string;
  onOpenAuthorizedDemo: () => void;
  demoStatusRefreshing: boolean;
  demoStatusMessage: string;
  onRefreshDemoStatus: () => Promise<void>;
  approveState: "idle" | "loading" | "approved" | "error";
  approveMessage: string;
  onApproveCall: (confirmedPhone: string, region: string, locale: string) => Promise<void>;
  dispatchState: "idle" | "loading" | "submitted" | "error";
  dispatchMessage: string;
  onDispatchCall: () => Promise<void>;
}

type ConnectionState = "idle" | "checking" | "connected" | "not_connected" | "error";

export function JobDetail({
  job,
  onEdit,
  onDelete,
  callDraft,
  callDraftLoading,
  callDraftSaving,
  callDraftError,
  onSaveCallDraft,
  brief,
  briefLoading,
  briefSaving,
  briefError,
  onRetryBrief,
  onSaveBriefReview,
  onCopyBriefSummary,
  authorizedDemoActionState,
  authorizedDemoMessage,
  onOpenAuthorizedDemo,
  demoStatusRefreshing,
  demoStatusMessage,
  onRefreshDemoStatus,
  approveState,
  approveMessage,
  onApproveCall,
  dispatchState,
  dispatchMessage,
  onDispatchCall,
}: JobDetailProps) {
  const reduceMotion = useReducedMotion();
  const checklist = preparationChecklist(job);
  const enteredCount = checklist.filter((c) => c.status === "entered").length;
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [connectionMessage, setConnectionMessage] = useState("");

  useEffect(() => {
    // The result is session-only UI state. A changed recipient gets a fresh, unchecked view.
    setConnectionState("idle");
    setConnectionMessage("");
  }, [job.id, job.phone]);

  const handleConnectionCheck = async () => {
    if (connectionState === "checking") return;
    setConnectionState("checking");
    setConnectionMessage("");
    try {
      const result = (await checkCalleConnection({})) as CalleConnectionResult;
      if (
        result?.status === "connected" ||
        result?.status === "not_connected" ||
        result?.status === "error"
      ) {
        setConnectionState(result.status);
        setConnectionMessage(result.message);
      } else {
        setConnectionState("error");
        setConnectionMessage("The connection check returned an unexpected result. No phone call was placed.");
      }
    } catch {
      setConnectionState("error");
      setConnectionMessage("The connection check failed. Try again later. No phone call was placed.");
    }
  };

  const fade = reduceMotion
    ? undefined
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const initial = job.customer_name.trim().slice(0, 1).toUpperCase() || "J";

  return (
    <motion.div
      key={job.id}
      {...(fade ?? {})}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="rr-job-detail-shell flex h-full min-h-0 flex-col"
    >
      <header className="rr-job-header rr-detail-header flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <div className="rr-job-initial hidden shrink-0 sm:flex" aria-hidden>
            {initial}
          </div>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Operator draft
              </p>
              <span className="rr-status-chip border-amber-500/25 bg-amber-50 text-amber-900">
                Unverified
              </span>
            </div>
            <h2 className="truncate text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">
              {job.customer_name}
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                <Phone className="h-3.5 w-3.5 text-primary" aria-hidden />
                <span aria-label="Participant phone hidden for recording">
                  Participant phone hidden for recording
                </span>
              </span>
              <span className="text-border" aria-hidden>
                ·
              </span>
              <span>{applianceLabel(job.appliance_type)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Updated {formatTimestamp(jobUpdatedAt(job))} · Entered by the coordinator
            </p>
          </div>
        </div>
        <div className="rr-job-actions flex shrink-0 flex-wrap gap-2 sm:pt-1">
          <Button variant="outline" size="sm" onClick={onEdit} className="border-border bg-card">
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Edit draft
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onDelete}
            className="border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      </header>

      <div className="mt-5 grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1.16fr)_minmax(18rem,0.84fr)]">
        <div className="space-y-4">
          <DetailCard title="Appliance & issue" eyebrow="01">
            <dl className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
              <Fact label="Appliance" value={applianceLabel(job.appliance_type)} />
              <Fact label="Brand" value={job.brand} />
              <Fact label="Model" value={job.model} />
              <Fact label="Error code" value={job.error_code} mono />
              <Fact label="When it happens" value={job.symptom_timing} className="sm:col-span-2" />
              <Fact
                label="Reported problem"
                value={job.reported_problem}
                className="sm:col-span-2"
              />
            </dl>
          </DetailCard>

          <DetailCard title="Visit & access" eyebrow="02">
            <dl className="grid gap-4">
              <Fact label="Visit note" value={job.visit_note} />
              <Fact label="Access notes" value={job.access_notes} />
            </dl>
          </DetailCard>

          <DetailCard title="Operator notes" eyebrow="03">
            <Fact label="Internal notes" value={job.operator_notes} hideLabel />
          </DetailCard>

          <CallReviewPanel
            job={job}
            connectionState={connectionState}
            connectionMessage={connectionMessage}
            onConnectionCheck={handleConnectionCheck}
            callDraft={callDraft}
            callDraftLoading={callDraftLoading}
            callDraftSaving={callDraftSaving}
            callDraftError={callDraftError}
            onSaveCallDraft={onSaveCallDraft}
            approveState={approveState}
            approveMessage={approveMessage}
            onApproveCall={onApproveCall}
            dispatchState={dispatchState}
            dispatchMessage={dispatchMessage}
            onDispatchCall={onDispatchCall}
          />

          <TechnicianBrief
            job={job}
            brief={brief}
            loading={briefLoading}
            saving={briefSaving}
            error={briefError}
            onRetry={onRetryBrief}
            onSaveReview={onSaveBriefReview}
            onCopySummary={onCopyBriefSummary}
          />
        </div>

        <aside className="rr-nonprint-section space-y-4 lg:sticky lg:top-0 lg:self-start">
          <AuthorizedDemoPanel
            callDraft={callDraft}
            callDraftLoading={callDraftLoading}
            actionState={authorizedDemoActionState}
            actionMessage={authorizedDemoMessage}
            onOpen={onOpenAuthorizedDemo}
            statusRefreshing={demoStatusRefreshing}
            statusMessage={demoStatusMessage}
            onRefresh={onRefreshDemoStatus}
          />

          <div className="rr-status-card rounded-xl border border-amber-500/25 bg-amber-50/80 p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800">
                <ShieldAlert className="h-4 w-4" aria-hidden />
              </div>
              <div className="space-y-1.5">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-800/80">
                  Preparation status
                </p>
                <p className="text-sm font-semibold text-amber-950">Draft, unverified</p>
                <p className="text-xs leading-relaxed text-amber-900/80">
                  These fields reflect coordinator entries only. Saved call evidence, visible gaps, and
                  the calculated readiness decision appear separately in the technician brief.
                </p>
              </div>
            </div>
          </div>

          <div className="rr-detail-card rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-primary" aria-hidden />
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Preparation checklist</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">What is on the draft today</p>
                </div>
              </div>
              <span className="rr-status-chip border-primary/20 bg-primary/5 text-primary">
                {enteredCount}/{checklist.length} entered
              </span>
            </div>
            <ul className="space-y-2">
              {checklist.map((item) => (
                <li
                  key={item.key}
                  className="flex items-start gap-2.5 rounded-lg border border-border/70 bg-background/60 px-2.5 py-2"
                >
                  {item.status === "entered" ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  ) : (
                    <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                      <span className="text-sm font-medium text-foreground">{item.label}</span>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {statusLabel(item.status)}
                      </span>
                    </div>
                    {item.value ? (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {item.key === "phone" ? "Participant phone hidden for recording" : item.value}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-xs italic text-muted-foreground/70">Not entered</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
              Fill missing draft fields, then review the local call outline. Placing a real call always
              needs its own explicit approval step below; the fixed authorized demonstration is separate.
            </p>
          </div>
        </aside>
      </div>
    </motion.div>
  );
}

type AuthorizedDemoActionState = "idle" | "loading" | AuthorizedDemoCallStatus;

function AuthorizedDemoPanel({
  callDraft,
  callDraftLoading,
  actionState,
  actionMessage,
  onOpen,
  statusRefreshing,
  statusMessage,
  onRefresh,
}: {
  callDraft: CallAttemptDraft | null;
  callDraftLoading: boolean;
  actionState: AuthorizedDemoActionState;
  actionMessage: string;
  onOpen: () => void;
  statusRefreshing: boolean;
  statusMessage: string;
  onRefresh: () => Promise<void>;
}) {
  const isDemo = isAuthorizedDemoAttempt(callDraft);
  const providerIdSaved = Boolean(callDraft?.provider_call_id?.trim());
  const actionLocked = actionState !== "idle";
  const savedStatus = callDraft?.provider_status
    ? remoteStatusText(callDraft.provider_status)
    : "No provider status saved";
  const completedAtLabel = callDraft?.completed_at ? formatTimestamp(callDraft.completed_at) : "";
  const safeResultSummary = callDraft?.safe_result_summary?.trim().slice(0, 480) ?? "";

  return (
    <section className="rr-nonprint-section rr-authorized-demo-card rounded-xl border border-primary/25 bg-primary/5 p-4 shadow-sm">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Phone className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">{isDemo ? "Authorized CALL-E proof" : "Authorized demo route"}</p>
          <h3 className="mt-1 text-sm font-semibold text-foreground">
            {isDemo ? "Saved authorized CALL-E result" : "One approved demonstration"}
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {isDemo
              ? "This saved result is private and separate from generic job calling. Opening the job, brief, or saved demo flow makes no new call."
              : "This fixed route creates one private washing-machine demo job and places one approved call after you confirm the disclosure and consent step."}
          </p>
        </div>
      </div>

      {!isDemo ? (
        <div className="mt-3">
          {callDraftLoading ? (
            <p className="text-xs text-muted-foreground" role="status">Loading the private preparation record…</p>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={onOpen}
              disabled={actionLocked}
              className="w-full border-primary/30 bg-card text-primary hover:bg-primary/10 hover:text-primary"
            >
              {actionState === "loading" ? (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Phone className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              )}
              {actionState === "loading" ? "Preparing authorized demo…" : actionLocked ? "Demo action reviewed" : "Run authorized demo call"}
            </Button>
          )}
          {actionState !== "idle" && actionMessage && (
            <p className="mt-2 text-xs leading-relaxed text-foreground" role="status">{actionMessage}</p>
          )}
        </div>
      ) : (
        <div className="rr-authorized-demo-proof mt-3 rounded-lg border border-primary/20 bg-card/70 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Saved authorized result</p>
              <p className="mt-1 text-xs text-muted-foreground">Actual provider status</p>
            </div>
            <span className="rr-status-chip border-primary/25 bg-primary/5 text-primary">{savedStatus}</span>
          </div>
          <dl className="mt-3 grid gap-3 border-t border-border/70 pt-3 sm:grid-cols-2">
            {completedAtLabel && completedAtLabel !== "—" && (
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Completed at</dt>
                <dd className="mt-1 text-sm text-foreground">{completedAtLabel}</dd>
              </div>
            )}
            <div className="sm:col-span-2">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Sanitized result summary</dt>
              <dd className="mt-1 text-sm leading-relaxed text-foreground">
                {safeResultSummary || "No sanitized summary saved."}
              </dd>
            </div>
          </dl>
          <div className="mt-3 flex items-start gap-2.5 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <p className="text-xs leading-relaxed text-foreground/90">
              <span className="font-semibold text-primary">No new call.</span> This card is a saved result for review. Reading status once is the only provider action available here.
            </p>
          </div>
          {providerIdSaved ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void onRefresh()}
                disabled={statusRefreshing}
                className="mt-3 border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", statusRefreshing && "animate-spin")} aria-hidden />
                {statusRefreshing ? "Reading status once…" : "Read status once"}
              </Button>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Reads the saved provider status once and never starts another call.
              </p>
            </>
          ) : (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              No saved provider call identifier is available, so the status read is unavailable. Review this saved record and do not submit again.
            </p>
          )}
          {statusMessage && (
            <p className="mt-2 border-t border-border/70 pt-2 text-xs leading-relaxed text-foreground" role="status">
              {statusMessage}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function DetailCard({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <section className="rr-nonprint-section rr-detail-card rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="font-mono text-[10px] font-medium tracking-[0.16em] text-primary">{eyebrow}</span>
        <h3 className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {title}
        </h3>
      </div>
      {children}
    </section>
  );
}

function Fact({
  label,
  value,
  mono,
  hideLabel,
  className = "",
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  hideLabel?: boolean;
  className?: string;
}) {
  const filled = Boolean(value && String(value).trim());
  return (
    <div className={className}>
      {!hideLabel && (
        <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      )}
      <div className="mt-1 flex items-start justify-between gap-3">
        <dd
          className={cn(
            "min-w-0 text-sm leading-relaxed",
            filled ? "text-foreground" : "italic text-muted-foreground/70",
            mono && filled && "font-mono text-[13px]",
          )}
        >
          {filled ? value : "Not entered"}
        </dd>
        <span
          className={cn(
            "shrink-0 font-mono text-[9px] uppercase tracking-wider",
            filled ? "text-primary" : "text-muted-foreground",
          )}
        >
          {filled ? "Entered" : "Missing"}
        </span>
      </div>
    </div>
  );
}

function CallReviewPanel({
  job,
  connectionState,
  connectionMessage,
  onConnectionCheck,
  callDraft,
  callDraftLoading,
  callDraftSaving,
  callDraftError,
  onSaveCallDraft,
  approveState,
  approveMessage,
  onApproveCall,
  dispatchState,
  dispatchMessage,
  onDispatchCall,
}: {
  job: RepairJobRecord;
  connectionState: ConnectionState;
  connectionMessage: string;
  onConnectionCheck: () => void;
  callDraft: CallAttemptDraft | null;
  callDraftLoading: boolean;
  callDraftSaving: boolean;
  callDraftError: string | null;
  onSaveCallDraft: () => Promise<void>;
  approveState: "idle" | "loading" | "approved" | "error";
  approveMessage: string;
  onApproveCall: (confirmedPhone: string, region: string, locale: string) => Promise<void>;
  dispatchState: "idle" | "loading" | "submitted" | "error";
  dispatchMessage: string;
  onDispatchCall: () => Promise<void>;
}) {
  const [reviewed, setReviewed] = useState(false);
  const [confirmPhone, setConfirmPhone] = useState("");
  const [region, setRegion] = useState("US");
  const [locale, setLocale] = useState("en-US");
  const [safetyChecked, setSafetyChecked] = useState(false);
  const canonicalPhone = isCanonicalE164Phone(job.phone);
  const savedQuestions = parseQuestionOutline(callDraft?.question_outline, job);
  const remoteStatus = callDraft && isRemoteCallStatus(callDraft.provider_status)
    ? callDraft.provider_status
    : null;
  const approvalLabel = callDraft?.approval_state === "approved" ? "Approved" : "Not approved";

  useEffect(() => {
    setReviewed(false);
    setConfirmPhone("");
    setSafetyChecked(false);
  }, [job.id, callDraft?.id, callDraft?.updated_at, callDraft?.updated_date]);

  return (
    <section className="rr-nonprint-section rr-call-review-panel rr-detail-card rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-start gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Phone className="h-4 w-4" aria-hidden />
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            04 · Call preparation
          </p>
          <h3 className="mt-1 text-base font-semibold text-foreground">Review and save locally</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Check the recipient, purpose, canonical phone, and question outline before saving one private
            preparation draft. Nothing in this panel contacts the recipient.
          </p>
        </div>
      </div>

      <ConnectionCard
        state={connectionState}
        message={connectionMessage}
        onCheck={onConnectionCheck}
      />

      <div className="mt-4 space-y-4 rounded-lg border border-border/80 bg-background/70 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Intended recipient
            </p>
            <p className="mt-1 text-sm font-medium text-foreground">{job.customer_name}</p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Participant phone
            </p>
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground" aria-label="Participant phone hidden for recording">
              Participant phone hidden for recording
            </p>
            <p className="mt-1 text-xs text-muted-foreground">The canonical value stays in the private record and is hidden in this presentation view.</p>
          </div>
          <span className="rr-status-chip border-border bg-card text-muted-foreground">Local review</span>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Preparation purpose</p>
          <p className="mt-1 text-sm leading-relaxed text-foreground/90">{callPurposeForJob(job)}</p>
        </div>
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Question outline
          </p>
          <ol className="list-decimal space-y-1.5 pl-4 text-sm leading-relaxed text-foreground/90">
            {adaptiveQuestionsForJob(job).map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ol>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3.5 sm:p-4">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <p className="text-xs leading-relaxed text-foreground/90">
            Saving records a private preparation draft only. It does not contact anyone or give approval.
            The fixed authorized demonstration can start only from its separate workspace action after confirmation.
          </p>
        </div>
      </div>

      {callDraftLoading && (
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          Loading the saved private preparation draft…
        </p>
      )}

      {callDraft && (
        <div className="mt-4 rounded-lg border border-primary/25 bg-card p-3.5 shadow-sm sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Saved local request summary
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {remoteStatus
                  ? "Provider status saved"
                  : callDraft.is_current === false
                    ? "Draft needs a fresh review"
                    : "Draft prepared"}
              </p>
            </div>
            <span className="rr-status-chip border-primary/25 bg-primary/5 text-primary" role="status">
              {remoteStatus ? remoteStatusText(remoteStatus) : callDraft.is_current === false ? "Review needed" : "Prepared"}
            </span>
          </div>
          <dl className="mt-3 grid gap-3 border-t border-border/70 pt-3 sm:grid-cols-2">
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Saved recipient</dt>
              <dd className="mt-1 text-sm text-foreground">
                {callDraft.recipient_name}
                <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                  Participant phone hidden for recording
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Approval state</dt>
              <dd className={cn("mt-1 text-sm font-medium", approvalLabel === "Approved" ? "text-primary" : "text-amber-800")}>
                {approvalLabel}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Saved provider status</dt>
              <dd className="mt-1 text-sm font-medium text-foreground">
                {remoteStatus ? remoteStatusText(remoteStatus) : "No provider status"}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Saved purpose</dt>
              <dd className="mt-1 text-sm leading-relaxed text-foreground">{callDraft.preparation_purpose}</dd>
            </div>
          </dl>
          <div className="mt-3 border-t border-border/70 pt-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Saved question outline</p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-sm leading-relaxed text-foreground/90">
              {savedQuestions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ol>
          </div>
          <p className="mt-3 border-t border-border/70 pt-3 text-xs leading-relaxed text-muted-foreground">
            {remoteStatus
              ? isAuthorizedDemoAttempt(callDraft) && callDraft.provider_call_id
                ? "This status is saved on the private demo record. Refresh is manual and reads status only."
                : "This status is shown only because it was saved on the private record. Refresh is manual and reads status only."
              : "Prepared means saved for review. A durable private request key is kept with this draft. Approve the exact number below before any call can be placed."}
          </p>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-border bg-background/70 p-3.5 sm:p-4">
        <label className="flex items-start gap-2.5 text-sm text-foreground">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(event) => setReviewed(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary"
          />
          <span>
            I reviewed this local outline and understand that saving it does not contact anyone or approve
            a call.
          </span>
        </label>
        <p className="mt-2 pl-6 text-xs leading-relaxed text-muted-foreground">
          This checkbox confirms review only. It cannot authorize or start a phone call.
        </p>
        {callDraftError && (
          <p className="mt-3 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive" role="alert">
            {callDraftError}
          </p>
        )}
        {!canonicalPhone && (
          <p className="mt-3 rounded-md border border-amber-500/25 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900" role="alert">
            Save the job with a canonical +countrycode phone before preparing this draft.
          </p>
        )}
        <Button
          type="button"
          onClick={onSaveCallDraft}
          disabled={!reviewed || !canonicalPhone || callDraftLoading || callDraftSaving}
          className="mt-4 w-full bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 sm:w-auto"
        >
          {callDraftSaving ? (
            <>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              Saving preparation draft…
            </>
          ) : callDraft ? (
            "Update preparation draft"
          ) : (
            "Save preparation draft"
          )}
        </Button>
      </div>

      {callDraft && !isAuthorizedDemoAttempt(callDraft) && (
        <ApproveAndCallPanel
          callDraft={callDraft}
          confirmPhone={confirmPhone}
          onConfirmPhoneChange={setConfirmPhone}
          region={region}
          onRegionChange={setRegion}
          locale={locale}
          onLocaleChange={setLocale}
          safetyChecked={safetyChecked}
          onSafetyCheckedChange={setSafetyChecked}
          approveState={approveState}
          approveMessage={approveMessage}
          onApproveCall={onApproveCall}
          dispatchState={dispatchState}
          dispatchMessage={dispatchMessage}
          onDispatchCall={onDispatchCall}
        />
      )}
    </section>
  );
}

function ApproveAndCallPanel({
  callDraft,
  confirmPhone,
  onConfirmPhoneChange,
  region,
  onRegionChange,
  locale,
  onLocaleChange,
  safetyChecked,
  onSafetyCheckedChange,
  approveState,
  approveMessage,
  onApproveCall,
  dispatchState,
  dispatchMessage,
  onDispatchCall,
}: {
  callDraft: CallAttemptDraft;
  confirmPhone: string;
  onConfirmPhoneChange: (value: string) => void;
  region: string;
  onRegionChange: (value: string) => void;
  locale: string;
  onLocaleChange: (value: string) => void;
  safetyChecked: boolean;
  onSafetyCheckedChange: (value: boolean) => void;
  approveState: "idle" | "loading" | "approved" | "error";
  approveMessage: string;
  onApproveCall: (confirmedPhone: string, region: string, locale: string) => Promise<void>;
  dispatchState: "idle" | "loading" | "submitted" | "error";
  dispatchMessage: string;
  onDispatchCall: () => Promise<void>;
}) {
  const isApproved =
    callDraft.approval_state === "approved" &&
    Boolean(callDraft.approval_expires_at) &&
    Date.parse(callDraft.approval_expires_at as string) > Date.now();
  const alreadySubmitted = Boolean(callDraft.provider_call_id?.trim() || callDraft.provider_status?.trim());
  const last4 = callDraft.recipient_phone?.trim().slice(-4) ?? "";

  if (alreadySubmitted) {
    return (
      <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3.5 sm:p-4">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <p className="text-xs leading-relaxed text-foreground/90">
            This draft already has saved provider state ({callDraft.provider_status || "submitted"}). Review it
            in the panel above rather than approving or dispatching again.
          </p>
        </div>
      </div>
    );
  }

  if (!isApproved) {
    return (
      <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-50/70 p-3.5 sm:p-4">
        <div className="flex items-start gap-2.5">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-950">Approve this exact number to place a real call</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-900/80">
              Re-type the saved recipient phone (ends in {last4 || "····"}) to confirm it. Approval is valid for
              15 minutes and does not place the call by itself.
            </p>
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_5rem_6rem]">
          <div className="space-y-1">
            <label htmlFor="confirm-phone" className="text-[11px] font-medium uppercase tracking-wide text-amber-900/80">
              Confirm phone
            </label>
            <input
              id="confirm-phone"
              value={confirmPhone}
              onChange={(e) => onConfirmPhoneChange(e.target.value)}
              placeholder="+1..."
              className="w-full rounded-md border border-amber-500/40 bg-background px-2.5 py-1.5 font-mono text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="approve-region" className="text-[11px] font-medium uppercase tracking-wide text-amber-900/80">
              Region
            </label>
            <input
              id="approve-region"
              value={region}
              onChange={(e) => onRegionChange(e.target.value)}
              placeholder="US"
              maxLength={2}
              className="w-full rounded-md border border-amber-500/40 bg-background px-2.5 py-1.5 font-mono text-sm uppercase"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="approve-locale" className="text-[11px] font-medium uppercase tracking-wide text-amber-900/80">
              Locale
            </label>
            <input
              id="approve-locale"
              value={locale}
              onChange={(e) => onLocaleChange(e.target.value)}
              placeholder="en-US"
              className="w-full rounded-md border border-amber-500/40 bg-background px-2.5 py-1.5 font-mono text-sm"
            />
          </div>
        </div>
        <label className="mt-3 flex items-start gap-2.5 text-xs text-amber-950">
          <input
            type="checkbox"
            checked={safetyChecked}
            onChange={(e) => onSafetyCheckedChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-500/50"
          />
          <span>I have permission to call this number and intend to place a real, automated call now.</span>
        </label>
        {approveMessage && (
          <p className="mt-2 text-xs leading-relaxed text-amber-950" role="status">
            {approveMessage}
          </p>
        )}
        <Button
          type="button"
          onClick={() => void onApproveCall(confirmPhone.trim(), region.trim(), locale.trim())}
          disabled={!confirmPhone.trim() || !region.trim() || !locale.trim() || !safetyChecked || approveState === "loading"}
          className="mt-3 w-full bg-amber-700 text-white hover:bg-amber-800 sm:w-auto"
        >
          {approveState === "loading" ? (
            <>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              Approving…
            </>
          ) : (
            "Approve this call"
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-primary/25 bg-primary/5 p-3.5 sm:p-4">
      <div className="flex items-start gap-2.5">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            Approved until {new Date(callDraft.approval_expires_at as string).toLocaleTimeString()}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Approved to call the number ending in {last4 || "····"}. Placing the call now will use a real
            CALL-E credit and contact this number.
          </p>
        </div>
      </div>
      {dispatchMessage && (
        <p className="mt-2 text-xs leading-relaxed text-foreground" role="status">
          {dispatchMessage}
        </p>
      )}
      <Button
        type="button"
        onClick={() => void onDispatchCall()}
        disabled={dispatchState === "loading"}
        className="mt-3 w-full bg-primary text-primary-foreground hover:bg-primary/90 sm:w-auto"
      >
        {dispatchState === "loading" ? (
          <>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            Placing the call…
          </>
        ) : (
          <>
            <Phone className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Place the call now
          </>
        )}
      </Button>
    </div>
  );
}

function remoteStatusText(status: string): string {
  if (status === "in_progress") return "In progress";
  return status.slice(0, 1).toUpperCase() + status.slice(1);
}

function ConnectionCard({
  state,
  message,
  onCheck,
}: {
  state: ConnectionState;
  message: string;
  onCheck: () => void;
}) {
  const isChecking = state === "checking";
  const statusLabel =
    state === "connected"
      ? "Connected for setup"
      : state === "not_connected"
        ? "Connection not confirmed"
        : state === "error"
          ? "Check needs attention"
          : isChecking
            ? "Checking connection"
            : "Not checked";
  const statusTone =
    state === "connected"
      ? "border-primary/25 bg-primary/5 text-primary"
      : state === "not_connected" || state === "error"
        ? "border-amber-500/25 bg-amber-50 text-amber-900"
        : "border-border bg-card text-muted-foreground";

  return (
    <div className="rr-connection-card rounded-lg border border-primary/20 bg-primary/5 p-3.5" data-state={state}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 text-primary">
            {state === "connected" ? (
              <ShieldCheck className="h-4 w-4" aria-hidden />
            ) : state === "checking" ? (
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
            ) : state === "not_connected" || state === "error" ? (
              <AlertCircle className="h-4 w-4" aria-hidden />
            ) : (
              <ShieldCheck className="h-4 w-4" aria-hidden />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                CALL-E connection
              </p>
              <span className={cn("rr-status-chip", statusTone)} aria-live="polite">
                {statusLabel}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Check the saved provider connection with one read-only request. This never places a
              phone call, creates a call task, or contacts the recipient.
            </p>
            {message && (
              <p className="mt-2 text-xs font-medium leading-relaxed text-foreground" role="status">
                {message}
              </p>
            )}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCheck}
          disabled={isChecking}
          className="shrink-0 self-start border-primary/25 bg-card text-primary hover:bg-primary/10 hover:text-primary"
        >
          {isChecking ? (
            <>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Checking…
            </>
          ) : state === "error" || state === "not_connected" ? (
            "Try again"
          ) : (
            "Check connection"
          )}
        </Button>
      </div>
    </div>
  );
}
