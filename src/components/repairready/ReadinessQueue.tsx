import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Inbox,
  RefreshCw,
  Search,
  ShieldAlert,
  UserRoundCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { applianceLabel, formatTimestamp } from "@/lib/repair-jobs";
import {
  queueCompletionLabel,
  queueEvidenceLabel,
  queueItemsForFilter,
  queueSourceDetail,
  type ReadinessQueueFilter,
  type ReadinessQueueItem,
  type ReadinessQueueSummary,
} from "@/lib/readiness-queue";

interface ReadinessQueueProps {
  items: ReadinessQueueItem[];
  summary: ReadinessQueueSummary;
  selectedId: string | null;
  query: string;
  filter: ReadinessQueueFilter;
  loading: boolean;
  hasLoaded: boolean;
  error: string | null;
  lastRefreshedAt: string | null;
  onSelect: (id: string) => void;
  onQuery: (value: string) => void;
  onFilter: (value: ReadinessQueueFilter) => void;
  onRefresh: () => void;
  onCreate: () => void;
}

const FILTERS: Array<{ id: ReadinessQueueFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "ready_for_technician_review", label: "Ready for technician review" },
  { id: "needs_follow_up", label: "Needs follow-up" },
  { id: "blocked", label: "Blocked" },
  { id: "unreviewed", label: "Unreviewed" },
];

export function ReadinessQueue({
  items,
  summary,
  selectedId,
  query,
  filter,
  loading,
  hasLoaded,
  error,
  lastRefreshedAt,
  onSelect,
  onQuery,
  onFilter,
  onRefresh,
  onCreate,
}: ReadinessQueueProps) {
  const visibleItems = queueItemsForFilter(items, query, filter);
  const showInitialLoading = loading && !hasLoaded;
  const showInitialError = Boolean(error && !hasLoaded);
  const showStaleWarning = Boolean(error && hasLoaded);
  const newestBoundaryNote = summary.limitedToNewestRecords
    ? "Reads the newest 200 saved records per entity"
    : "All loaded saved jobs shown";

  return (
    <section className="rr-readiness-queue flex h-full min-h-0 flex-col" aria-labelledby="readiness-queue-title">
      <header className="rr-queue-header space-y-3 border-b border-border p-3.5 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Daily triage</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h2 id="readiness-queue-title" className="text-sm font-semibold text-foreground">
                Readiness queue
              </h2>
              <span className="font-mono text-[10px] text-muted-foreground">
                {summary.loadedJobCount} loaded
              </span>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0 bg-background"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh readiness queue"
            title="Read saved job, call, and brief records again"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} aria-hidden />
          </Button>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          A saved-state view for deciding which repair jobs need attention next. Queue refresh reads saved records only.
        </p>

        {summary.safetyHazardCount > 0 && (
          <div
            className="rr-safety-banner flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-destructive"
            role="alert"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p className="text-xs font-semibold leading-relaxed">
              {summary.safetyHazardCount} job{summary.safetyHazardCount === 1 ? "" : "s"} with a reported safety
              hazard {summary.safetyHazardCount === 1 ? "is" : "are"} pinned to the top of this queue.
            </p>
          </div>
        )}

        <div className="rr-queue-summary grid grid-cols-2 gap-2" aria-label="Readiness queue counts">
          <SummaryCount label="Ready for technician review" count={summary.readyCount} tone="good" />
          <SummaryCount label="Needs follow-up" count={summary.needsFollowUpCount} tone="attention" />
          <SummaryCount label="Blocked" count={summary.blockedCount} tone="blocked" />
          <SummaryCount label="Unreviewed" count={summary.unreviewedCount} tone="review" />
        </div>
        {summary.totalEvidenceAreaCount > 0 && (
          <div className="rr-evidence-stat rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">
              Call-confirmed evidence
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">
              {summary.confirmedEvidenceCount} of {summary.totalEvidenceAreaCount} evidence areas confirmed by a
              real call
            </p>
          </div>
        )}
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Unreviewed is a human-review filter, not a readiness state. {newestBoundaryNote}.
        </p>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search customer, appliance, brand, model, issue"
            className="h-10 bg-background pl-8 pr-8 text-xs sm:text-sm"
            aria-label="Search readiness queue"
          />
          {query && (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => onQuery("")}
              aria-label="Clear queue search"
            >
              <span aria-hidden>×</span>
            </button>
          )}
        </div>

        <div className="rr-queue-filters -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="Filter readiness queue">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onFilter(option.id)}
              aria-pressed={filter === option.id}
              className={cn(
                "min-h-9 shrink-0 rounded-full border px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.08em] transition-colors",
                filter === option.id
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {lastRefreshedAt && !loading && !error && (
          <p className="font-mono text-[9px] text-muted-foreground">
            Saved queue read {formatTimestamp(lastRefreshedAt)}
          </p>
        )}
      </header>

      {showStaleWarning && (
        <div className="rr-queue-refresh-warning mx-3.5 mt-3 rounded-lg border border-amber-500/30 bg-amber-50 px-3 py-2.5 sm:mx-4" role="alert">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" aria-hidden />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-950">Showing the last saved queue</p>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-900/80">{error}</p>
              <Button type="button" variant="outline" size="sm" className="mt-2 h-8 bg-card text-xs" onClick={onRefresh} disabled={loading}>
                <RefreshCw className={cn("mr-1.5 h-3 w-3", loading && "animate-spin")} aria-hidden />
                Retry queue refresh
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5 sm:p-3">
        {showInitialLoading && <QueueSkeleton />}
        {showInitialError && <QueueError message={error ?? "The saved queue could not load."} onRetry={onRefresh} loading={loading} />}
        {!showInitialLoading && !showInitialError && hasLoaded && summary.loadedJobCount === 0 && (
          <QueueEmpty onCreate={onCreate} />
        )}
        {!showInitialLoading && !showInitialError && hasLoaded && summary.loadedJobCount > 0 && visibleItems.length === 0 && (
          <div className="rr-queue-filter-empty rounded-xl border border-dashed border-border bg-card/40 px-4 py-10 text-center">
            <Search className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="mt-3 text-sm font-semibold text-foreground">No jobs match this view</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Try another filter or clear the search to see more saved jobs.</p>
          </div>
        )}
        {!showInitialLoading && !showInitialError && visibleItems.length > 0 && (
          <div className="space-y-4">
            <QueueGroup group="blocked" items={visibleItems} selectedId={selectedId} onSelect={onSelect} />
            <QueueGroup group="needs_follow_up" items={visibleItems} selectedId={selectedId} onSelect={onSelect} />
            <QueueGroup group="ready_for_technician_review" items={visibleItems} selectedId={selectedId} onSelect={onSelect} />
          </div>
        )}
      </div>
    </section>
  );
}

function SummaryCount({ label, count, tone }: { label: string; count: number; tone: "good" | "attention" | "blocked" | "review" }) {
  return (
    <div className={cn("rr-queue-summary-count rounded-lg border px-2.5 py-2", summaryTone(tone))}>
      <p className="text-lg font-semibold tracking-tight text-foreground">{count}</p>
      <p className="mt-0.5 text-[10px] font-semibold leading-snug text-foreground">{label}</p>
    </div>
  );
}

function QueueGroup({
  group,
  items,
  selectedId,
  onSelect,
}: {
  group: "blocked" | "needs_follow_up" | "ready_for_technician_review";
  items: ReadinessQueueItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const groupItems = items.filter((item) => item.readinessBucket === group);
  if (!groupItems.length) return null;
  const copy = groupCopy(group);
  return (
    <section className="rr-queue-group" aria-labelledby={`queue-group-${group}`}>
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", copy.dot)} aria-hidden />
          <h3 id={`queue-group-${group}`} className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {copy.label}
          </h3>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">{groupItems.length}</span>
      </div>
      <ul className="space-y-2">
        {groupItems.map((item) => (
          <li key={item.job.id}>
            <QueueCard item={item} active={item.job.id === selectedId} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function QueueCard({ item, active, onSelect }: { item: ReadinessQueueItem; active: boolean; onSelect: (id: string) => void }) {
  const job = item.job;
  const appliance = applianceLabel(job.appliance_type);
  const detailLabel = [job.brand, job.model].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      onClick={() => onSelect(job.id)}
      aria-current={active ? "true" : undefined}
      className={cn("rr-queue-card w-full rounded-xl border p-3 text-left", active && "rr-queue-card-active")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{job.customer_name || "Unnamed customer"}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {appliance}{detailLabel ? ` · ${detailLabel}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {item.hasSafetyHazard && (
            <span className="rr-status-chip border-destructive/50 bg-destructive text-destructive-foreground">
              Safety hazard
            </span>
          )}
          <span className={cn("rr-status-chip shrink-0", decisionTone(item))}>{item.decision.title}</span>
        </div>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-foreground/80">{item.decision.explanation}</p>
      <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
        Reported: {job.reported_problem || "No issue description saved"}
      </p>

      <div className="rr-queue-card-meta mt-3 grid grid-cols-2 gap-1.5">
        <MetaCell label="Call completion" value={queueCompletionLabel(item)} icon={<Clock3 className="h-3 w-3" aria-hidden />} />
        <MetaCell label="Human review" value={item.humanReviewLabel} icon={<UserRoundCheck className="h-3 w-3" aria-hidden />} tone={item.humanReviewState === "not_reviewed" || item.humanReviewState === "needs_follow_up" ? "attention" : undefined} />
        <MetaCell label="Evidence" value={queueEvidenceLabel(item)} icon={<CheckCircle2 className="h-3 w-3" aria-hidden />} />
        <MetaCell label="Source" value={item.sourceLabel} icon={<CircleDashed className="h-3 w-3" aria-hidden />} />
      </div>

      {item.blockerCount > 0 && (
        <div className="mt-2 rounded-lg border border-destructive/25 bg-destructive/5 px-2.5 py-2 text-xs text-destructive" role="group" aria-label={`${item.blockerCount} explicit blocker${item.blockerCount === 1 ? "" : "s"}`}>
          <div className="flex items-start gap-1.5">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="font-semibold">{item.blockerCount} explicit blocker{item.blockerCount === 1 ? "" : "s"}</p>
              {item.blockerText && <p className="mt-1 break-words leading-relaxed">{item.blockerText}</p>}
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 border-t border-border/70 pt-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Next action</p>
            <p className="mt-1 text-[11px] font-medium leading-relaxed text-foreground">{item.nextAction}</p>
          </div>
          <span className="shrink-0 pt-0.5 text-muted-foreground" aria-hidden>→</span>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Latest activity: {item.latestActivity ? formatTimestamp(item.latestActivity) : "No saved activity"}
        </p>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground/80">{queueSourceDetail(item)}</p>
    </button>
  );
}

function MetaCell({ label, value, icon, tone }: { label: string; value: string; icon: ReactNode; tone?: "attention" }) {
  return (
    <div className={cn("min-w-0 rounded-md border border-border/80 bg-background/70 px-2 py-1.5", tone === "attention" && "border-amber-500/25 bg-amber-50/70")}>
      <p className="flex items-center gap-1 font-mono text-[8px] uppercase tracking-[0.08em] text-muted-foreground">{icon}{label}</p>
      <p className={cn("mt-1 break-words text-[10px] font-medium leading-snug text-foreground", tone === "attention" && "text-amber-950")}>{value}</p>
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div className="space-y-2.5" aria-label="Loading readiness queue" aria-busy="true">
      {["one", "two", "three"].map((key) => (
        <div key={key} className="rr-queue-skeleton animate-pulse rounded-xl border border-border bg-card/60 p-3">
          <div className="h-3 w-2/5 rounded bg-muted" />
          <div className="mt-2 h-2.5 w-3/5 rounded bg-muted" />
          <div className="mt-4 h-9 rounded-lg bg-muted/80" />
          <div className="mt-2 grid grid-cols-2 gap-1.5"><div className="h-8 rounded bg-muted/70" /><div className="h-8 rounded bg-muted/70" /></div>
        </div>
      ))}
      <p className="px-2 pt-1 text-center text-xs text-muted-foreground">Reading saved jobs and review records…</p>
    </div>
  );
}

function QueueError({ message, onRetry, loading }: { message: string; onRetry: () => void; loading: boolean }) {
  return (
    <div className="rr-queue-error rounded-xl border border-destructive/25 bg-card p-5 text-center" role="alert">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive"><AlertCircle className="h-5 w-5" aria-hidden /></div>
      <p className="mt-3 text-sm font-semibold text-foreground">Readiness queue could not load</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{message}</p>
      <Button type="button" variant="outline" size="sm" className="mt-4 bg-background" onClick={onRetry} disabled={loading}>
        <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} aria-hidden />
        Try again
      </Button>
    </div>
  );
}

function QueueEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rr-queue-empty rounded-xl border border-dashed border-border bg-card/40 px-4 py-10 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary"><Inbox className="h-5 w-5" aria-hidden /></div>
      <p className="mt-3 text-sm font-semibold text-foreground">Your readiness queue is clear</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Create a private job draft to give the next appliance visit a clear starting point.</p>
      <Button type="button" size="sm" className="mt-4 bg-primary text-primary-foreground" onClick={onCreate}>Create new job</Button>
    </div>
  );
}

function groupCopy(group: "blocked" | "needs_follow_up" | "ready_for_technician_review") {
  if (group === "blocked") return { label: "Blocked", dot: "bg-destructive" };
  if (group === "ready_for_technician_review") return { label: "Ready for technician review", dot: "bg-primary" };
  return { label: "Needs follow-up", dot: "bg-amber-600" };
}

function summaryTone(tone: "good" | "attention" | "blocked" | "review"): string {
  if (tone === "good") return "border-primary/25 bg-primary/5";
  if (tone === "blocked") return "border-destructive/25 bg-destructive/5";
  if (tone === "review") return "border-border bg-background/70";
  return "border-amber-500/25 bg-amber-50/75";
}

function decisionTone(item: ReadinessQueueItem): string {
  if (item.readinessBucket === "blocked") return "border-destructive/30 bg-destructive/10 text-destructive";
  if (item.readinessBucket === "ready_for_technician_review") return "border-primary/30 bg-primary/10 text-primary";
  return "border-amber-500/30 bg-amber-100 text-amber-950";
}
