import { useEffect, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  Clock3,
  Copy,
  FileText,
  Link2,
  ListChecks,
  Loader2,
  Printer,
  ShieldAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  completionLabel,
  demoFlowFor,
  evidenceSourceLabel,
  evidenceStatusLabel,
  followUpReviewLabel,
  humanReviewLabel,
  isShareLinkActive,
  readinessDecisionFor,
  readinessLabel,
  readinessMetricsFor,
  sanitizeFollowUpReviewNote,
  type DemoFlowStage,
  type DemoFlowStageState,
  type FollowUpReview,
  type FollowUpReviewStatus,
  type HumanReviewState,
  type ReadinessDecisionTone,
  type RepairBriefView,
} from "@/lib/repair-briefs";
import { applianceLabel, type RepairJobRecord } from "@/lib/repair-jobs";

interface TechnicianBriefProps {
  job: RepairJobRecord;
  brief: RepairBriefView | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  onRetry: () => void;
  onSaveReview: (state: HumanReviewState, note: string, followUpReviews: FollowUpReview[]) => Promise<void>;
  onCopySummary: () => Promise<void>;
  shareLinkState: "idle" | "loading" | "error";
  shareLinkMessage: string;
  onCreateShareLink: () => Promise<void>;
  onRevokeShareLink: () => Promise<void>;
  followUpDraftState: "idle" | "loading";
  onCreateFollowUpDraft: () => Promise<void>;
}

export function TechnicianBrief({
  job,
  brief,
  loading,
  saving,
  error,
  onRetry,
  onSaveReview,
  onCopySummary,
  shareLinkState,
  shareLinkMessage,
  onCreateShareLink,
  onRevokeShareLink,
  followUpDraftState,
  onCreateFollowUpDraft,
}: TechnicianBriefProps) {
  const [reviewState, setReviewState] = useState<HumanReviewState>("not_reviewed");
  const [reviewNote, setReviewNote] = useState("");
  const [followUpReviews, setFollowUpReviews] = useState<FollowUpReview[]>([]);

  useEffect(() => {
    setReviewState(brief?.human_review_state ?? "not_reviewed");
    setReviewNote(brief?.human_review_note ?? "");
    setFollowUpReviews(brief?.follow_up_reviews ?? []);
  }, [brief?.id, brief?.updated_at, brief?.updated_date, brief?.human_review_state, brief?.human_review_note, brief?.follow_up_reviews]);

  const printBrief = () => window.requestAnimationFrame(() => window.print());
  const actionDisabled = loading || saving || !brief;
  const reviewFor = (followUp: RepairBriefView["follow_ups"][number]): FollowUpReview => followUpReviews.find((item) => item.key === followUp.key) ?? { key: followUp.key, value: followUp.value, status: "open", note: "" };
  const updateFollowUpReview = (followUp: RepairBriefView["follow_ups"][number], changes: Partial<Pick<FollowUpReview, "status" | "note">>) => {
    setFollowUpReviews((current) => {
      const existing = reviewForFrom(current, followUp);
      const next = { ...existing, ...changes };
      return current.some((item) => item.key === followUp.key) ? current.map((item) => item.key === followUp.key ? next : item) : [...current, next].slice(0, 8);
    });
  };

  return (
    <section className="rr-technician-brief rounded-xl border border-primary/20 bg-card p-4 shadow-sm sm:p-5" aria-labelledby="technician-brief-title">
      <div className="rr-print-brief-heading hidden">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em]">RepairReady · Technician brief</p>
        <h2 className="mt-1 text-xl font-semibold">Evidence-backed visit brief</h2>
        <div className="rr-print-brief-meta mt-3 grid gap-1 text-sm sm:grid-cols-2"><p><span className="font-medium">Job:</span> {job.customer_name}</p><p><span className="font-medium">Appliance:</span> {applianceLabel(job.appliance_type)}</p></div>
      </div>
      <header className="flex items-start gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><ClipboardCheck className="h-4 w-4" aria-hidden /></div>
        <div className="min-w-0"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">05 · Technician brief</p><h3 id="technician-brief-title" className="mt-1 text-base font-semibold text-foreground">Evidence-backed visit brief</h3><p className="rr-brief-screen-only mt-1 text-xs leading-relaxed text-muted-foreground">Review what is known, what is still unknown, and what came from a call. Coordinator entries remain unverified.</p></div>
      </header>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-background/70 px-3.5 py-3 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden /> Loading the private brief…</div>
      ) : error && !brief ? (
        <div className="mt-4 rounded-lg border border-destructive/25 bg-destructive/5 p-3.5" role="alert"><p className="text-sm font-medium text-destructive">The brief could not load.</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{error}</p><Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>Try again</Button></div>
      ) : brief ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="Brief status"><StatusBox icon={<FileText className="h-4 w-4" aria-hidden />} label="Call completion" value={completionLabel(brief.call_completion_status)} tone={brief.call_completion_status === "completed" ? "good" : "neutral"} /><StatusBox icon={<ShieldAlert className="h-4 w-4" aria-hidden />} label="Business readiness" value={readinessLabel(brief.readiness_status)} tone={brief.readiness_status === "ready_for_technician_review" ? "good" : brief.readiness_status === "blocked" ? "blocked" : "attention"} /></div>
          <ReadinessDecisionPanel brief={brief} />
          <div className="rr-brief-screen-only mt-4"><DemoFlowStrip stages={demoFlowFor(brief)} /></div>
          {!brief.evidence.some((item) => item.source === "call_reported") && <div className="rr-brief-screen-only mt-3 rounded-lg border border-border bg-background/70 px-3.5 py-3" role="status"><p className="text-sm font-semibold text-foreground">No call evidence yet</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Coordinator entries are shown for preparation only. Confirmation requires a separately authorized call.</p></div>}
          <div className="mt-4 space-y-2.5"><div className="flex items-center justify-between gap-2"><div><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Required evidence</p><p className="mt-1 text-sm font-semibold text-foreground">What supports the brief today</p></div><span className="rr-status-chip border-border bg-background text-muted-foreground">{brief.evidence.filter((item) => item.status === "confirmed").length}/{brief.evidence.length} confirmed</span></div><ul className="space-y-2" aria-label="Required evidence items">{brief.evidence.map((item) => <EvidenceRow key={item.key} item={item} />)}</ul></div>

          <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-50/80 p-3.5" aria-labelledby="follow-up-details-title">
            <div className="flex items-center gap-2"><ListChecks className="h-4 w-4 text-amber-700" aria-hidden /><p id="follow-up-details-title" className="text-sm font-semibold text-foreground">Follow-up details</p></div>
            <p className="mt-1 text-xs leading-relaxed text-amber-900/80">{brief.follow_ups.length ? "These details came from the call and still need independent confirmation." : "No specific call-reported follow-up details are saved."} Human review records coordinator attention only. It never changes call evidence or the calculated readiness.</p>
            {brief.follow_ups.length ? <ul className="mt-3 space-y-2" aria-label="Follow-up details">{brief.follow_ups.map((followUp) => { const review = reviewFor(followUp); return <li key={followUp.key} className="rr-brief-follow-up-row rounded-md border border-amber-500/25 bg-amber-50 px-2.5 py-2 text-sm text-amber-950"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p>{followUp.value}</p><span className="mt-1 block font-mono text-[10px] uppercase tracking-wide text-amber-800/75">{evidenceSourceLabel(followUp.source)}</span></div><span className="rr-status-chip shrink-0 border-amber-500/30 bg-amber-100 text-amber-900">{followUpReviewLabel(review.status)}</span></div><div className="rr-brief-screen-only mt-2 grid gap-2 sm:grid-cols-[minmax(0,9rem)_1fr]"><label className="text-xs font-semibold text-amber-950"><span className="block">Review status</span><select value={review.status} onChange={(event) => updateFollowUpReview(followUp, { status: event.target.value as FollowUpReviewStatus })} disabled={actionDisabled} aria-label={`Review status for ${followUp.value}`} className="mt-1.5 flex h-9 w-full rounded-md border border-amber-500/[0.35] bg-background px-2.5 text-xs font-normal text-foreground shadow-sm outline-none focus:ring-2 focus:ring-ring"><option value="open">Open</option><option value="reviewed">Reviewed</option></select></label><label className="text-xs font-semibold text-amber-950"><span className="block">Private coordinator note <span className="font-normal text-amber-900/70">Optional</span></span><Input value={review.note} onChange={(event) => updateFollowUpReview(followUp, { note: event.target.value.slice(0, 240) })} disabled={actionDisabled} maxLength={240} placeholder="What should a coordinator check?" aria-label={`Private coordinator note for ${followUp.value}`} className="mt-1.5 h-9 border-amber-500/[0.35] bg-background text-xs font-normal text-foreground" /></label></div><div className="hidden print:block mt-2 border-t border-amber-700/20 pt-2 text-xs text-amber-950"><p className="font-mono text-[10px] uppercase tracking-wide text-amber-800/75">Follow-up review</p><p className="mt-1 font-medium">{followUpReviewLabel(review.status)}</p>{sanitizeFollowUpReviewNote(review.note) && <p className="mt-1 leading-relaxed">Private coordinator note: {sanitizeFollowUpReviewNote(review.note)}</p>}</div></li>; })}</ul> : <p className="mt-2 text-xs leading-relaxed text-muted-foreground">No specific follow-up details were recorded. This does not confirm that every material detail is complete.</p>}
            {brief.readiness_status === "needs_follow_up" && (
              <div className="rr-brief-screen-only mt-3 border-t border-amber-500/25 pt-3">
                <p className="text-xs leading-relaxed text-amber-900/80">
                  Prepare a short follow-up call that asks only about what's unresolved above — not the full
                  intake again. It goes through the same approval step (retype the number) as any other call.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void onCreateFollowUpDraft()}
                  disabled={followUpDraftState === "loading"}
                  className="mt-2 border-amber-500/40 bg-card text-amber-900 hover:bg-amber-100"
                >
                  {followUpDraftState === "loading" ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <ListChecks className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  )}
                  Prepare follow-up call
                </Button>
              </div>
            )}
          </div>

          <div className="mt-4 rounded-lg border border-border bg-background/70 p-3.5"><div className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-amber-700" aria-hidden /><p className="text-sm font-semibold text-foreground">Visit blockers</p></div>{brief.blockers.length ? <ul className="mt-2 space-y-2">{brief.blockers.map((blocker, index) => <li key={`${blocker.value}-${index}`} className="rounded-md border border-amber-500/25 bg-amber-50 px-2.5 py-2 text-sm text-amber-950"><span>{blocker.value}</span><span className="mt-1 block font-mono text-[10px] uppercase tracking-wide text-amber-800/75">{evidenceSourceLabel(blocker.source)}{blocker.supporting_excerpt ? ` · “${blocker.supporting_excerpt}”` : ""}</span></li>)}</ul> : <p className="mt-2 text-xs leading-relaxed text-muted-foreground">No blockers have been explicitly recorded. Missing information is shown above and is not treated as a blocker automatically.</p>}</div>

          <div className="rr-brief-review-form mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3.5 sm:p-4"><div className="flex items-start gap-2.5"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden /><div><p className="text-sm font-semibold text-foreground">Human review</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Human review records coordinator attention only. It never changes call evidence or the calculated readiness, and it does not approve a call.</p></div></div><div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,13rem)_1fr]"><label className="space-y-1.5 text-sm font-medium text-foreground">Review state<select value={reviewState} onChange={(event) => setReviewState(event.target.value as HumanReviewState)} disabled={actionDisabled} className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal shadow-sm outline-none focus:ring-2 focus:ring-ring" aria-label="Human review state"><option value="not_reviewed">Not reviewed</option><option value="reviewed">Reviewed</option><option value="needs_follow_up">Follow-up noted</option></select></label><label className="space-y-1.5 text-sm font-medium text-foreground">Review note<span className="ml-1 text-xs font-normal text-muted-foreground">Optional</span><Textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value.slice(0, 600))} disabled={actionDisabled} rows={3} maxLength={600} placeholder="Record what needs a human follow-up…" className="mt-1.5 resize-y bg-background text-sm font-normal" /></label></div><div className="rr-brief-controls mt-3 flex flex-wrap gap-2"><Button type="button" onClick={() => onSaveReview(reviewState, reviewNote, followUpReviews)} disabled={actionDisabled} className="bg-primary text-primary-foreground hover:bg-primary/90">{saving ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />Saving brief review…</> : "Save brief review"}</Button><Button type="button" variant="outline" onClick={onCopySummary} disabled={actionDisabled} className="bg-card"><Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden />Copy summary</Button><Button type="button" variant="outline" onClick={printBrief} disabled={actionDisabled} className="bg-card"><Printer className="mr-1.5 h-3.5 w-3.5" aria-hidden />Print brief</Button></div></div>
          {brief && (
            <ShareLinkSection
              brief={brief}
              shareLinkState={shareLinkState}
              shareLinkMessage={shareLinkMessage}
              onCreateShareLink={onCreateShareLink}
              onRevokeShareLink={onRevokeShareLink}
            />
          )}
          <div className="rr-brief-review-print hidden"><p className="font-mono text-[10px] uppercase tracking-[0.14em]">Human review</p><p className="mt-1 text-sm font-medium">{humanReviewLabel(brief.human_review_state)}</p>{brief.human_review_note && <p className="mt-1 text-sm leading-relaxed">{brief.human_review_note}</p>}</div>
          <p className="rr-brief-screen-only mt-3 text-xs leading-relaxed text-muted-foreground">Readiness is separate from call completion. A failed provider state does not explain why a call failed, and it does not create confirmation.</p>
        </>
      ) : null}
    </section>
  );
}

function ShareLinkSection({
  brief,
  shareLinkState,
  shareLinkMessage,
  onCreateShareLink,
  onRevokeShareLink,
}: {
  brief: RepairBriefView;
  shareLinkState: "idle" | "loading" | "error";
  shareLinkMessage: string;
  onCreateShareLink: () => Promise<void>;
  onRevokeShareLink: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const active = isShareLinkActive(brief);
  const shareUrl = active && typeof window !== "undefined" ? `${window.location.origin}/shared/${brief.share_token}` : "";

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable; the link is still visible to select manually */
    }
  };

  return (
    <div className="rr-brief-screen-only mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3.5 sm:p-4">
      <div className="flex items-start gap-2.5">
        <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Share with a technician</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {active
              ? `A read-only link is live until ${new Date(brief.share_expires_at as string).toLocaleString()}. No sign-in required to view it. Phone numbers and private review notes are never included.`
              : "Create a time-boxed, read-only link a technician can open without an account. Valid 48 hours; revoke it any time."}
          </p>
        </div>
      </div>
      {active ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={shareUrl} className="bg-background font-mono text-xs" onFocus={(e) => e.target.select()} />
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()} className="bg-card">
                <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void onRevokeShareLink()}
                disabled={shareLinkState === "loading"}
                className="border-destructive/30 text-destructive hover:bg-destructive/5"
              >
                <X className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Revoke
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void onCreateShareLink()}
          disabled={shareLinkState === "loading"}
          className="mt-3 bg-card"
        >
          {shareLinkState === "loading" ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          )}
          Create share link
        </Button>
      )}
      {shareLinkMessage && (
        <p className="mt-2 text-xs leading-relaxed text-destructive" role="alert">
          {shareLinkMessage}
        </p>
      )}
    </div>
  );
}

function ReadinessDecisionPanel({ brief }: { brief: RepairBriefView }) {
  const metrics = readinessMetricsFor(brief);
  const decision = readinessDecisionFor(brief);
  const panelTone = decision.tone === "good"
    ? "border-primary/30 bg-primary/5"
    : decision.tone === "blocked"
      ? "border-destructive/30 bg-destructive/5"
      : decision.tone === "attention"
        ? "border-amber-500/30 bg-amber-50/80"
        : "border-border bg-background/70";
  const iconTone = decision.tone === "good"
    ? "bg-primary/10 text-primary"
    : decision.tone === "blocked"
      ? "bg-destructive/10 text-destructive"
      : decision.tone === "attention"
        ? "bg-amber-100 text-amber-800"
        : "bg-muted text-muted-foreground";
  const badgeTone = decision.tone === "good"
    ? "border-primary/25 bg-primary/10 text-primary"
    : decision.tone === "blocked"
      ? "border-destructive/25 bg-destructive/10 text-destructive"
      : decision.tone === "attention"
        ? "border-amber-500/30 bg-amber-100 text-amber-900"
        : "border-border bg-background text-muted-foreground";

  return (
    <section className={cn("rr-brief-decision mt-4 rounded-xl border p-3.5 sm:p-4", panelTone)} aria-labelledby="readiness-decision-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", iconTone)}><DecisionIcon tone={decision.tone} /></div>
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Readiness decision</p>
            <div className="mt-1 flex flex-wrap items-center gap-2"><h4 id="readiness-decision-title" className="text-base font-semibold text-foreground">{decision.title}</h4><span className={cn("rr-status-chip", badgeTone)}>{readinessLabel(brief.readiness_status)}</span></div>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-foreground/[0.85]">{decision.explanation}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3" role="group" aria-label="Readiness counts">
        <DecisionMetric count={metrics.confirmedEvidenceAreas} label="Confirmed evidence areas" detail="Status is confirmed" />
        <DecisionMetric count={metrics.followUpDetails} label="Open follow-up details" detail="Reported by call and kept open" />
        <DecisionMetric count={metrics.visitBlockers} label="Explicit visit blockers" detail="Recorded blockers only" />
      </div>

      <div className="mt-3 rounded-lg border border-border/80 bg-background/[0.65] px-3 py-2.5" role="group" aria-label="Next action">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Next action</p>
        <p className="mt-1 text-sm font-medium leading-relaxed text-foreground">{decision.nextAction}</p>
      </div>

      {decision.reviewPending && decision.reviewMessage && <div className="rr-brief-decision-review mt-3 rounded-lg border border-amber-500/25 bg-amber-50/80 px-3 py-2.5" role="status"><p className="text-sm font-semibold text-amber-950">Human review still pending</p><p className="mt-1 text-xs leading-relaxed text-amber-900/80">{decision.reviewMessage}</p></div>}
    </section>
  );
}

function DecisionMetric({ count, label, detail }: { count: number; label: string; detail: string }) {
  return <div className="rounded-lg border border-border/80 bg-background/60 px-3 py-2.5" role="group" aria-label={`${count} ${label}`}><p className="text-xl font-semibold tracking-tight text-foreground">{count}</p><p className="mt-0.5 text-xs font-semibold leading-snug text-foreground">{label}</p><p className="mt-1 text-[10px] leading-snug text-muted-foreground">{detail}</p></div>;
}

function DecisionIcon({ tone }: { tone: ReadinessDecisionTone }) {
  if (tone === "good") return <CheckCircle2 className="h-5 w-5" aria-hidden />;
  if (tone === "blocked") return <ShieldAlert className="h-5 w-5" aria-hidden />;
  if (tone === "attention") return <ListChecks className="h-5 w-5" aria-hidden />;
  return <CircleDashed className="h-5 w-5" aria-hidden />;
}

function DemoFlowStrip({ stages }: { stages: DemoFlowStage[] }) {
  return (
    <section className="rr-brief-demo-flow rounded-lg border border-border bg-background/60 p-3.5" aria-labelledby="demo-flow-title">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><p id="demo-flow-title" className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Demo flow</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">A state-only view of this brief. It does not start a call or change saved evidence.</p></div><span className="rr-status-chip border-border bg-card text-muted-foreground">Saved state only</span></div>
      <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Demo flow stages">{stages.map((stage) => <li key={stage.key} className={cn("min-w-0 rounded-lg border px-2.5 py-2.5", flowStageTone(stage.state))} aria-label={`${stage.label}: ${stage.status}. ${stage.detail}`}><div className="flex items-center gap-1.5"><span aria-hidden><FlowStateIcon state={stage.state} /></span><span className="min-w-0 truncate font-mono text-[10px] uppercase tracking-[0.1em]">{stage.label}</span></div><p className="mt-2 text-xs font-semibold leading-snug">{stage.status}</p><p className="mt-1 text-[10px] leading-relaxed opacity-80">{stage.detail}</p></li>)}</ol>
    </section>
  );
}

function FlowStateIcon({ state }: { state: DemoFlowStageState }) {
  if (state === "complete") return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (state === "blocked") return <ShieldAlert className="h-3.5 w-3.5" />;
  if (state === "current" || state === "attention") return <Clock3 className="h-3.5 w-3.5" />;
  return <CircleDashed className="h-3.5 w-3.5" />;
}

function flowStageTone(state: DemoFlowStageState): string {
  if (state === "complete") return "border-primary/25 bg-primary/5 text-primary";
  if (state === "blocked") return "border-destructive/25 bg-destructive/5 text-destructive";
  if (state === "current" || state === "attention") return "border-amber-500/25 bg-amber-50 text-amber-950";
  return "border-border bg-card text-muted-foreground";
}

function reviewForFrom(current: FollowUpReview[], followUp: RepairBriefView["follow_ups"][number]): FollowUpReview {
  return current.find((item) => item.key === followUp.key) ?? { key: followUp.key, value: followUp.value, status: "open", note: "" };
}
function EvidenceRow({ item }: { item: RepairBriefView["evidence"][number] }) {
  const isAccessDetails = item.key === "visit_logistics";
  const statusTone = item.status === "confirmed" ? "border-primary/25 bg-primary/5 text-primary" : item.status === "missing" ? "border-amber-500/25 bg-amber-50 text-amber-900" : item.status === "uncertain" ? "border-amber-500/25 bg-amber-50 text-amber-900" : "border-border bg-background text-muted-foreground";
  return <li className="rr-brief-evidence-row rounded-lg border border-border/80 bg-background/60 px-3 py-2.5" data-status={item.status}><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-medium text-foreground">{item.label}</p><p className={cn("mt-1 text-sm leading-relaxed", item.value ? "text-foreground/90" : "italic text-muted-foreground", isAccessDetails && "rr-brief-screen-only")}>{item.value || "Unknown"}</p>{isAccessDetails && <p className="mt-1 hidden text-xs italic text-muted-foreground print:block">Access details omitted from print.</p>}</div><span className={cn("rr-status-chip shrink-0", statusTone)}>{evidenceStatusLabel(item.status)}</span></div><div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"><span>{evidenceSourceLabel(item.source)}</span>{item.supporting_excerpt && !isAccessDetails && <span className="normal-case tracking-normal text-foreground/70">“{item.supporting_excerpt}”</span>}</div></li>;
}
function StatusBox({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: "good" | "attention" | "blocked" | "neutral" }) {
  const toneClass = tone === "good" ? "border-primary/25 bg-primary/5 text-primary" : tone === "blocked" ? "border-destructive/25 bg-destructive/5 text-destructive" : tone === "attention" ? "border-amber-500/25 bg-amber-50 text-amber-950" : "border-border bg-background text-foreground";
  return <div className={cn("rounded-lg border p-3", toneClass)}><div className="flex items-center gap-2"><span aria-hidden>{icon}</span><span className="font-mono text-[10px] uppercase tracking-[0.14em] opacity-75">{label}</span></div><p className="mt-2 text-sm font-semibold">{value}</p></div>;
}
