import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  Briefcase,
  Loader2,
  LogOut,
  Menu,
  Plus,
  PhoneCall,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JobEditor } from "@/components/repairready/JobEditor";
import { JobDetail } from "@/components/repairready/JobDetail";
import { ReadinessQueue } from "@/components/repairready/ReadinessQueue";
import {
  approveCalleCall,
  dispatchCalleCall,
  getCalleCallStatus,
  runAuthorizedDemoCall,
  type AuthorizedDemoCallStatus,
} from "@/functions";
import {
  createRepairJob,
  deleteRepairJob,
  friendlyError,
  jobUpdatedAt,
  listRepairJobs,
  RepairJobInput,
  RepairJobRecord,
  updateRepairJob,
} from "@/lib/repair-jobs";
import {
  isAuthorizedDemoAttempt,
  isNonTerminalCallStatus,
  loadCallAttemptDraft,
  saveCallAttemptDraft,
  saveFollowUpCallAttemptDraft,
  savePostVisitCallAttemptDraft,
  saveRetryCallAttemptDraft,
  type CallAttemptDraft,
} from "@/lib/call-attempts";
import {
  buildSafeBriefSummary,
  copyTextToClipboard,
  createBriefShareLink,
  loadRepairBrief,
  revokeBriefShareLink,
  saveRepairBrief,
  type FollowUpReview,
  type HumanReviewState,
  type RepairBriefView,
} from "@/lib/repair-briefs";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  loadReadinessQueue,
  type ReadinessQueueFilter,
  type ReadinessQueueItem,
  type ReadinessQueueSummary,
} from "@/lib/readiness-queue";

const LOGO = "/brand/logo-mark.jpg";

type AuthState = "loading" | "signed_out" | "signed_in";
type DemoActionState = "idle" | "loading" | AuthorizedDemoCallStatus;

const EMPTY_QUEUE_SUMMARY: ReadinessQueueSummary = {
  loadedJobCount: 0,
  readyCount: 0,
  needsFollowUpCount: 0,
  blockedCount: 0,
  unreviewedCount: 0,
  confirmedEvidenceCount: 0,
  totalEvidenceAreaCount: 0,
  limitedToNewestRecords: false,
  safetyHazardCount: 0,
};

const Index = () => {
  const { toast } = useToast();
  const reduceMotion = useReducedMotion();
  const [auth, setAuth] = useState<AuthState>("loading");
  const [jobs, setJobs] = useState<RepairJobRecord[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [queueItems, setQueueItems] = useState<ReadinessQueueItem[]>([]);
  const [queueSummary, setQueueSummary] = useState<ReadinessQueueSummary>(EMPTY_QUEUE_SUMMARY);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueHasLoaded, setQueueHasLoaded] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueLastRefreshedAt, setQueueLastRefreshedAt] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReadinessQueueFilter>("all");
  const [selectedQueueIds, setSelectedQueueIds] = useState<Set<string>>(new Set());
  const [bulkPreparing, setBulkPreparing] = useState(false);
  const jobsRequestRef = useRef(0);
  const queueRequestRef = useRef(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<RepairJobRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RepairJobRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [callDraft, setCallDraft] = useState<CallAttemptDraft | null>(null);
  const [callDraftLoading, setCallDraftLoading] = useState(false);
  const [callDraftSaving, setCallDraftSaving] = useState(false);
  const [callDraftError, setCallDraftError] = useState<string | null>(null);
  const [brief, setBrief] = useState<RepairBriefView | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefSaving, setBriefSaving] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [briefReloadKey, setBriefReloadKey] = useState(0);
  const [demoConfirmOpen, setDemoConfirmOpen] = useState(false);
  const [demoActionState, setDemoActionState] = useState<DemoActionState>("idle");
  const [demoActionMessage, setDemoActionMessage] = useState("");
  const [demoStatusRefreshing, setDemoStatusRefreshing] = useState(false);
  const [demoStatusMessage, setDemoStatusMessage] = useState("");
  const [approveState, setApproveState] = useState<"idle" | "loading" | "approved" | "error">("idle");
  const [approveMessage, setApproveMessage] = useState("");
  const [dispatchState, setDispatchState] = useState<"idle" | "loading" | "submitted" | "error">("idle");
  const [dispatchMessage, setDispatchMessage] = useState("");
  const [shareLinkState, setShareLinkState] = useState<"idle" | "loading" | "error">("idle");
  const [shareLinkMessage, setShareLinkMessage] = useState("");

  const clearPrivateState = useCallback(() => {
    jobsRequestRef.current += 1;
    queueRequestRef.current += 1;
    setJobs([]);
    setQueueItems([]);
    setQueueSummary(EMPTY_QUEUE_SUMMARY);
    setQueueHasLoaded(false);
    setQueueLoading(false);
    setQueueError(null);
    setQueueLastRefreshedAt(null);
    setSelectedId(null);
    setQuery("");
    setFilter("all");
    setListError(null);
    setEditingJob(null);
    setEditorOpen(false);
    setDeleteTarget(null);
    setMobileNav(false);
    setMobileListOpen(false);
    setCallDraft(null);
    setCallDraftLoading(false);
    setCallDraftSaving(false);
    setCallDraftError(null);
    setBrief(null);
    setBriefLoading(false);
    setBriefSaving(false);
    setBriefError(null);
    setBriefReloadKey(0);
    setDemoConfirmOpen(false);
    setDemoActionState("idle");
    setDemoActionMessage("");
    setDemoStatusRefreshing(false);
    setDemoStatusMessage("");
    setApproveState("idle");
    setApproveMessage("");
    setDispatchState("idle");
    setDispatchMessage("");
    setShareLinkState("idle");
    setShareLinkMessage("");
  }, []);

  const resolveAuth = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        clearPrivateState();
        setAuth("signed_out");
        return;
      }
      setAuth("signed_in");
    } catch {
      clearPrivateState();
      setAuth("signed_out");
    }
  }, [clearPrivateState]);

  useEffect(() => {
    resolveAuth();
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setAuth("signed_in");
      } else {
        clearPrivateState();
        setAuth("signed_out");
      }
    });
    return () => subscription.subscription.unsubscribe();
  }, [resolveAuth, clearPrivateState]);

  const refreshReadinessQueue = useCallback(async (sourceJobs: RepairJobRecord[]) => {
    if (auth !== "signed_in") return;
    const requestId = ++queueRequestRef.current;
    setQueueLoading(true);
    setQueueError(null);
    try {
      const snapshot = await loadReadinessQueue(sourceJobs);
      if (requestId !== queueRequestRef.current || auth !== "signed_in") return;
      setQueueItems(snapshot.items);
      setQueueSummary(snapshot.summary);
      setQueueHasLoaded(true);
      setQueueLastRefreshedAt(snapshot.loadedAt);
    } catch (err) {
      if (requestId !== queueRequestRef.current || auth !== "signed_in") return;
      setQueueError(
        friendlyError(err, "Could not refresh the saved readiness queue. Your last saved queue remains visible.")
      );
    } finally {
      if (requestId === queueRequestRef.current) setQueueLoading(false);
    }
  }, [auth]);

  const loadJobs = useCallback(async (preferredJobId?: string | null) => {
    if (auth !== "signed_in") return;
    const requestId = ++jobsRequestRef.current;
    setListLoading(true);
    setListError(null);
    try {
      const rows = await listRepairJobs();
      if (requestId !== jobsRequestRef.current || auth !== "signed_in") return;
      setJobs(rows);
      setSelectedId((prev) => {
        if (preferredJobId && rows.some((r) => r.id === preferredJobId)) return preferredJobId;
        if (prev && rows.some((r) => r.id === prev)) return prev;
        return rows[0]?.id ?? null;
      });
      setListLoading(false);
      await refreshReadinessQueue(rows);
    } catch (err) {
      if (requestId !== jobsRequestRef.current || auth !== "signed_in") return;
      setListError(
        friendlyError(err, "Could not load jobs. Check your connection and try again.")
      );
    } finally {
      if (requestId === jobsRequestRef.current) setListLoading(false);
    }
  }, [auth, refreshReadinessQueue]);

  useEffect(() => {
    if (auth === "signed_in") loadJobs();
    else if (auth === "signed_out") clearPrivateState();
  }, [auth, loadJobs, clearPrivateState]);

  const selected = useMemo(
    () => jobs.find((j) => j.id === selectedId) ?? null,
    [jobs, selectedId]
  );

  const hasSavedCallEvidence = Boolean(
    selected &&
      ((brief?.repair_job_id === selected.id &&
        brief.evidence.some((item) => item.source === "call_reported")) ||
        (callDraft?.repair_job_id === selected.id &&
          isAuthorizedDemoAttempt(callDraft) &&
          callDraft.provider_status === "completed"))
  );

  useEffect(() => {
    let active = true;
    if (auth !== "signed_in" || !selected) {
      setCallDraft(null);
      setCallDraftLoading(false);
      setCallDraftError(null);
      return () => {
        active = false;
      };
    }

    setCallDraftLoading(true);
    setCallDraftError(null);
    loadCallAttemptDraft(selected)
      .then((draft) => {
        if (active) setCallDraft(draft);
      })
      .catch((err) => {
        if (!active) return;
        setCallDraft(null);
        setCallDraftError(
          friendlyError(err, "Could not load the private preparation draft. Try again.")
        );
      })
      .finally(() => {
        if (active) setCallDraftLoading(false);
      });

    return () => {
      active = false;
    };
  }, [auth, selected]);

  useEffect(() => {
    let active = true;
    if (auth !== "signed_in" || !selected) {
      setBrief(null);
      setBriefLoading(false);
      setBriefError(null);
      return () => {
        active = false;
      };
    }

    setBriefLoading(true);
    setBriefError(null);
    loadRepairBrief(selected, callDraft)
      .then((loaded) => {
        if (active) setBrief(loaded);
      })
      .catch((err) => {
        if (!active) return;
        setBrief(null);
        setBriefError(
          friendlyError(err, "Could not load the private technician brief. Try again.")
        );
      })
      .finally(() => {
        if (active) setBriefLoading(false);
      });

    return () => {
      active = false;
    };
  }, [auth, selected, callDraft, briefReloadKey]);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      /* ignore */
    }
    clearPrivateState();
    setAuth("signed_out");
  };

  const openCreate = () => {
    setEditingJob(null);
    setEditorOpen(true);
  };

  const openEdit = (job: RepairJobRecord) => {
    setEditingJob(job);
    setEditorOpen(true);
  };

  const handleSave = async (input: RepairJobInput, jobId: string | null) => {
    setCallDraft(null);
    setCallDraftError(null);
    setBrief(null);
    setBriefError(null);
    setApproveState("idle");
    setApproveMessage("");
    setDispatchState("idle");
    setDispatchMessage("");
    setShareLinkState("idle");
    setShareLinkMessage("");
    if (jobId) {
      const updated = await updateRepairJob(jobId, input);
      const nextJobs = jobs
        .map((j) => (j.id === jobId ? { ...j, ...updated } : j))
        .sort((a, b) =>
          String(jobUpdatedAt(b) ?? "").localeCompare(String(jobUpdatedAt(a) ?? ""))
        );
      setJobs(nextJobs);
      setSelectedId(jobId);
      await refreshReadinessQueue(nextJobs);
      toast({
        title: "Job updated",
        description: "Changes are saved to your private workspace.",
      });
    } else {
      const created = await createRepairJob(input);
      const nextJobs = [created, ...jobs];
      setJobs(nextJobs);
      setSelectedId(created.id);
      await refreshReadinessQueue(nextJobs);
      toast({
        title: "Job created",
        description: "Draft saved. Nothing has been verified by call.",
      });
    }
  };

  const handleSaveCallDraft = async () => {
    const target = selected;
    if (!target || callDraftSaving) return;

    setCallDraftSaving(true);
    setCallDraftError(null);
    try {
      const saved = await saveCallAttemptDraft(target);
      if (selectedId === target.id) setCallDraft(saved);
      await refreshReadinessQueue(jobs);
      toast({
        title: "Preparation draft saved",
        description: "Saved privately for review. No one was contacted and no approval was recorded.",
      });
    } catch (err) {
      const message = friendlyError(
        err,
        "Could not save the private preparation draft. Check the job and try again."
      );
      if (selectedId === target.id) setCallDraftError(message);
      toast({ title: "Draft was not saved", description: message, variant: "destructive" });
    } finally {
      setCallDraftSaving(false);
    }
  };

  const handleToggleQueueSelect = (id: string) => {
    setSelectedQueueIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleClearQueueSelection = () => setSelectedQueueIds(new Set());

  const handlePrepareSelectedDrafts = async () => {
    if (bulkPreparing || selectedQueueIds.size === 0) return;
    const targets = jobs.filter((job) => selectedQueueIds.has(job.id));
    if (!targets.length) return;

    setBulkPreparing(true);
    let succeeded = 0;
    const failures: string[] = [];
    for (const job of targets) {
      try {
        const saved = await saveCallAttemptDraft(job);
        succeeded += 1;
        if (selectedId === job.id) setCallDraft(saved);
      } catch (err) {
        failures.push(`${job.customer_name || "Unnamed customer"}: ${friendlyError(err, "could not be prepared")}`);
      }
    }
    setBulkPreparing(false);
    setSelectedQueueIds(new Set());
    await refreshReadinessQueue(jobs);

    if (!failures.length) {
      toast({
        title: `${succeeded} preparation draft${succeeded === 1 ? "" : "s"} saved`,
        description: "Saved privately for review. No one was contacted and no approval was recorded.",
      });
    } else {
      toast({
        title: `${succeeded} saved, ${failures.length} could not be prepared`,
        description: failures.slice(0, 3).join(" · "),
        variant: succeeded ? "default" : "destructive",
      });
    }
  };

  const handleCreateFollowUpDraft = async () => {
    const target = selected;
    if (!target || !brief || callDraftSaving) return;

    setCallDraftSaving(true);
    setCallDraftError(null);
    setApproveState("idle");
    setApproveMessage("");
    setDispatchState("idle");
    setDispatchMessage("");
    try {
      const saved = await saveFollowUpCallAttemptDraft(target, brief);
      if (selectedId === target.id) setCallDraft(saved);
      await refreshReadinessQueue(jobs);
      toast({
        title: "Follow-up call prepared",
        description: "A targeted draft was saved above, asking only about what the last call left unresolved. Approve it there to place the call.",
      });
    } catch (err) {
      const message = friendlyError(err, "Could not prepare the follow-up call. Try again.");
      if (selectedId === target.id) setCallDraftError(message);
      toast({ title: "Follow-up draft was not saved", description: message, variant: "destructive" });
    } finally {
      setCallDraftSaving(false);
    }
  };

  const handleRetryCallDraft = async () => {
    const target = selected;
    if (!target || callDraftSaving) return;

    setCallDraftSaving(true);
    setCallDraftError(null);
    setApproveState("idle");
    setApproveMessage("");
    setDispatchState("idle");
    setDispatchMessage("");
    try {
      const saved = await saveRetryCallAttemptDraft(target);
      if (selectedId === target.id) setCallDraft(saved);
      await refreshReadinessQueue(jobs);
      toast({
        title: "Retry prepared",
        description: "A new draft was saved above with the same questions. Approve it there to place the call again.",
      });
    } catch (err) {
      const message = friendlyError(err, "Could not prepare the retry call. Try again.");
      if (selectedId === target.id) setCallDraftError(message);
      toast({ title: "Retry draft was not saved", description: message, variant: "destructive" });
    } finally {
      setCallDraftSaving(false);
    }
  };

  const handleCreatePostVisitDraft = async () => {
    const target = selected;
    if (!target || callDraftSaving) return;

    setCallDraftSaving(true);
    setCallDraftError(null);
    setApproveState("idle");
    setApproveMessage("");
    setDispatchState("idle");
    setDispatchMessage("");
    try {
      const saved = await savePostVisitCallAttemptDraft(target);
      if (selectedId === target.id) setCallDraft(saved);
      await refreshReadinessQueue(jobs);
      toast({
        title: "Post-visit check-in prepared",
        description: "A new draft was saved above to confirm the repair and catch any new issue. Approve it there to place the call.",
      });
    } catch (err) {
      const message = friendlyError(err, "Could not prepare the post-visit check-in call. Try again.");
      if (selectedId === target.id) setCallDraftError(message);
      toast({ title: "Post-visit draft was not saved", description: message, variant: "destructive" });
    } finally {
      setCallDraftSaving(false);
    }
  };

  const handleSaveBriefReview = async (state: HumanReviewState, note: string, followUpReviews: FollowUpReview[]) => {
    const target = selected;
    if (!target || !brief || briefSaving) return;

    setBriefSaving(true);
    try {
      const saved = await saveRepairBrief(target, brief, {
        human_review_state: state,
        human_review_note: note,
        follow_up_reviews: followUpReviews,
        call_attempt_id: brief.call_attempt_id || callDraft?.id,
      });
      if (selectedId === target.id) setBrief(saved);
      await refreshReadinessQueue(jobs);
      toast({
        title: "Brief review saved",
        description: "Follow-up statuses and notes are private. They do not change evidence, readiness, or call approval.",
      });
    } catch (err) {
      toast({
        title: "Brief review was not saved",
        description: friendlyError(err, "Could not save the private brief review. Try again."),
        variant: "destructive",
      });
    } finally {
      setBriefSaving(false);
    }
  };

  const handleCopyBriefSummary = async () => {
    if (!selected || !brief) return;
    try {
      await copyTextToClipboard(buildSafeBriefSummary(brief, selected));
      toast({
        title: "Summary copied",
        description: "Phone details were left out. Coordinator entries remain labeled unverified.",
      });
    } catch (err) {
      toast({
        title: "Could not copy summary",
        description: friendlyError(err, "Clipboard access is unavailable. Select the brief text and copy it manually."),
        variant: "destructive",
      });
    }
  };

  const handleCreateShareLink = async () => {
    if (!brief || shareLinkState === "loading") return;
    setShareLinkState("loading");
    setShareLinkMessage("");
    try {
      const updated = await createBriefShareLink(brief);
      setBrief(updated);
      toast({
        title: "Share link created",
        description: "Valid for 48 hours. Anyone with the link can view the brief; no sign-in required.",
      });
    } catch (err) {
      const message = friendlyError(err, "Could not create a share link. Try again.");
      setShareLinkMessage(message);
      toast({ title: "Share link not created", description: message, variant: "destructive" });
    } finally {
      setShareLinkState("idle");
    }
  };

  const handleRevokeShareLink = async () => {
    if (!brief || shareLinkState === "loading") return;
    setShareLinkState("loading");
    try {
      const updated = await revokeBriefShareLink(brief);
      setBrief(updated);
      toast({ title: "Share link revoked", description: "The old link no longer works." });
    } catch (err) {
      const message = friendlyError(err, "Could not revoke the share link. Try again.");
      setShareLinkMessage(message);
      toast({ title: "Could not revoke link", description: message, variant: "destructive" });
    } finally {
      setShareLinkState("idle");
    }
  };

  const retryBrief = () => {
    setBriefError(null);
    setBriefReloadKey((value) => value + 1);
  };

  const handleRunAuthorizedDemoCall = async () => {
    if (demoActionState !== "idle") return;
    setDemoConfirmOpen(false);
    setDemoActionState("loading");
    setDemoActionMessage("Creating the private demo record and preparing the one approved call…");
    try {
      const result = await runAuthorizedDemoCall({ action: "run_authorized_demo_call" });
      const validStatus = ["submitted", "already_started", "uncertain_submit", "blocked", "error"].includes(result?.status);
      if (!validStatus) {
        setDemoActionState("error");
        setDemoActionMessage("The authorized demo returned an unexpected result. No automatic retry was made.");
        toast({
          title: "Demo needs review",
          description: "The workspace received an unexpected result. No automatic retry was made.",
          variant: "destructive",
        });
        return;
      }

      setDemoActionState(result.status);
      setDemoActionMessage(result.message);
      await loadJobs(result.repair_job_id);
      toast({
        title:
          result.status === "submitted"
            ? "Authorized demo call queued"
            : result.status === "already_started"
              ? "Authorized demo already started"
              : result.status === "uncertain_submit"
                ? "Demo submission needs review"
                : "Demo action reviewed",
        description: result.message,
        variant: result.status === "submitted" || result.status === "already_started" ? "default" : "destructive",
      });
    } catch (err) {
      const message = friendlyError(
        err,
        "The authorized demo action could not be completed. No automatic retry was made."
      );
      setDemoActionState("error");
      setDemoActionMessage(message);
      toast({ title: "Demo action needs review", description: message, variant: "destructive" });
    }
  };

  const handleRefreshDemoStatus = async (auto = false) => {
    const target = selected;
    const attempt = callDraft;
    if (demoStatusRefreshing) return;
    if (!target || !attempt || attempt.approval_state !== "approved" || !attempt.provider_call_id?.trim()) {
      if (auto) return;
      const message = "Manual status refresh is available only for an approved call after a provider call ID is saved.";
      setDemoStatusMessage(message);
      toast({ title: "Status refresh unavailable", description: message, variant: "destructive" });
      return;
    }

    setDemoStatusRefreshing(true);
    setDemoStatusMessage(auto ? "Checking on the call…" : "Reading the approved call status once…");
    try {
      const result = await getCalleCallStatus({ call_attempt_id: attempt.id });
      setDemoStatusMessage(result.message);
      // Auto-polling only announces the result once the call reaches a terminal status, so it
      // doesn't spam a toast every ~10s while the call is still ringing/in progress.
      const stillInFlight = auto && isNonTerminalCallStatus(result.provider_status);
      if (!stillInFlight) {
        toast({
          title: result.status === "status" ? "Call status updated" : "Call status needs review",
          description: result.message,
          variant: result.status === "status" ? "default" : "destructive",
        });
      }
    } catch (err) {
      const message = friendlyError(
        err,
        "The call status could not be refreshed. Review the private record and do not retry automatically."
      );
      setDemoStatusMessage(message);
      if (!auto) toast({ title: "Status refresh needs review", description: message, variant: "destructive" });
    } finally {
      try {
        const refreshedDraft = await loadCallAttemptDraft(target);
        if (selectedId === target.id) {
          setCallDraft(refreshedDraft);
          setBriefReloadKey((value) => value + 1);
        }
      } catch {
        if (selectedId === target.id) {
          setDemoStatusMessage("The status action finished, but the private record could not be reloaded. Open the job again to review it.");
        }
      }
      await refreshReadinessQueue(jobs);
      setDemoStatusRefreshing(false);
    }
  };

  // Auto-poll while a dispatched call is still in flight, matching CALL-E's own recommended
  // polling cadence. Self-terminating: once the refreshed draft's status is no longer
  // queued/in_progress, this effect's condition stops matching and no further poll is scheduled.
  useEffect(() => {
    if (!callDraft || demoStatusRefreshing) return;
    if (callDraft.approval_state !== "approved" || !callDraft.provider_call_id?.trim()) return;
    if (!isNonTerminalCallStatus(callDraft.provider_status)) return;
    const timeoutId = setTimeout(() => { void handleRefreshDemoStatus(true); }, 10000);
    return () => clearTimeout(timeoutId);
  }, [callDraft, demoStatusRefreshing]);

  const handleApproveCall = async (confirmedPhone: string, region: string, locale: string) => {
    const target = selected;
    const attempt = callDraft;
    if (!target || !attempt || approveState === "loading") return;
    setApproveState("loading");
    setApproveMessage("Saving the approval…");
    try {
      const result = await approveCalleCall({
        repair_job_id: target.id,
        call_attempt_id: attempt.id,
        confirmed_phone: confirmedPhone,
        region,
        locale,
      });
      setApproveState(result.status === "approved" ? "approved" : "error");
      setApproveMessage(result.message);
      toast({
        title: result.status === "approved" ? "Call approved" : "Approval needs review",
        description: result.message,
        variant: result.status === "approved" ? "default" : "destructive",
      });
    } catch (err) {
      const message = friendlyError(err, "The approval could not be saved. Try again.");
      setApproveState("error");
      setApproveMessage(message);
      toast({ title: "Approval needs review", description: message, variant: "destructive" });
    } finally {
      try {
        const refreshedDraft = await loadCallAttemptDraft(target);
        if (selectedId === target.id) setCallDraft(refreshedDraft);
      } catch {
        /* the toast above already reflects the outcome */
      }
    }
  };

  const handleDispatchCall = async () => {
    const target = selected;
    const attempt = callDraft;
    if (!target || !attempt || dispatchState === "loading") return;
    setDispatchState("loading");
    setDispatchMessage("Contacting CALL-E…");
    try {
      const result = await dispatchCalleCall({ repair_job_id: target.id, call_attempt_id: attempt.id });
      const succeeded = result.status === "submitted";
      setDispatchState(succeeded ? "submitted" : "error");
      setDispatchMessage(result.message);
      toast({
        title: succeeded ? "Call dispatched" : "Dispatch needs review",
        description: result.message,
        variant: succeeded ? "default" : "destructive",
      });
    } catch (err) {
      const message = friendlyError(err, "The call could not be dispatched. Review the record and do not retry automatically.");
      setDispatchState("error");
      setDispatchMessage(message);
      toast({ title: "Dispatch needs review", description: message, variant: "destructive" });
    } finally {
      try {
        const refreshedDraft = await loadCallAttemptDraft(target);
        if (selectedId === target.id) {
          setCallDraft(refreshedDraft);
          setApproveState("idle");
          setApproveMessage("");
        }
      } catch {
        /* the toast above already reflects the outcome */
      }
      await refreshReadinessQueue(jobs);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteRepairJob(deleteTarget.id);
      const nextJobs = jobs.filter((j) => j.id !== deleteTarget.id);
      setJobs(nextJobs);
      setSelectedId((prev) => (prev === deleteTarget.id ? null : prev));
      if (selectedId === deleteTarget.id) {
        setBrief(null);
        setBriefLoading(false);
        setBriefError(null);
      }
      await refreshReadinessQueue(nextJobs);
      toast({ title: "Job deleted", description: "Removed from your private workspace." });
      setDeleteTarget(null);
    } catch (err) {
      toast({
        title: "Could not delete",
        description: friendlyError(err, "Try again in a moment."),
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const selectJob = (id: string) => {
    setCallDraft(null);
    setCallDraftError(null);
    setCallDraftLoading(false);
    setBrief(null);
    setBriefError(null);
    setBriefLoading(false);
    setDemoStatusMessage("");
    setApproveState("idle");
    setApproveMessage("");
    setDispatchState("idle");
    setDispatchMessage("");
    setShareLinkState("idle");
    setShareLinkMessage("");
    setSelectedId(id);
    setMobileListOpen(false);
  };

  const demoActionInProgress = demoActionState === "loading";
  const demoActionLabel =
    demoActionState === "loading"
      ? "Preparing authorized demo…"
      : demoActionState === "submitted"
        ? "Authorized demo queued"
        : demoActionState === "already_started"
          ? "Authorized demo already started"
          : demoActionState === "uncertain_submit"
            ? "Demo needs review"
            : demoActionState === "blocked" || demoActionState === "error"
              ? "Demo action reviewed"
              : "Run authorized demo call";

  if (auth === "loading") {
    return (
      <div className="rr-shell flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
          Checking your sign-in…
        </div>
      </div>
    );
  }

  return (
    <div className="rr-shell flex min-h-screen bg-background text-foreground">
      <aside className="rr-sidebar hidden w-[16.5rem] shrink-0 flex-col border-r border-sidebar-border lg:flex">
        <SidebarBody />
      </aside>

      <Sheet open={mobileNav} onOpenChange={setMobileNav}>
        <SheetContent side="left" className="rr-sidebar w-[17rem] border-sidebar-border p-0">
          <SidebarBody onNavigate={() => setMobileNav(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="rr-topbar flex h-16 items-center justify-between gap-3 border-b border-border bg-card/85 px-4 backdrop-blur-sm sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileNav(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Owner workspace
              </p>
              <h1 className="truncate text-sm font-semibold tracking-tight sm:text-base">
                Repair preparation
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {auth === "signed_in" ? (
              <>
                <span
                  className="hidden max-w-[12rem] truncate text-xs text-muted-foreground sm:inline"
                  aria-label="Signed-in owner workspace"
                >
                  Owner workspace
                </span>
                <Button variant="outline" size="sm" onClick={handleLogout} className="gap-1.5">
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Sign out</span>
                </Button>
              </>
            ) : null}
          </div>
        </header>

        {auth === "signed_out" ? (
          <SignedOutView reduceMotion={!!reduceMotion} />
        ) : (
          <>
            <section className="rr-workspace-intro px-4 py-5 sm:px-6 sm:py-6">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div className="max-w-2xl">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
                    Private operations desk · daily readiness triage
                  </p>
                  <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                    Decide what needs attention next
                  </h2>
                  <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
                    Read the saved readiness queue first, then open a job to review its evidence-backed
                    brief. The queue reads saved state only. Placing a real call to any job always requires
                    an explicit per-call approval step first; the fixed authorized demonstration is separate
                    and runs only after you confirm it.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rr-status-chip border-primary/25 bg-primary/5 text-primary">
                    <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                    Private review
                  </span>
                  {!selected && (
                    <Button
                      variant="outline"
                      onClick={() => setDemoConfirmOpen(true)}
                      disabled={demoActionState !== "idle"}
                      className="shrink-0 border-primary/30 bg-card text-primary hover:bg-primary/10 hover:text-primary"
                    >
                      {demoActionInProgress ? (
                        <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <PhoneCall className="mr-1.5 h-4 w-4" aria-hidden />
                      )}
                      {demoActionLabel}
                    </Button>
                  )}
                  <Button
                    onClick={openCreate}
                    className="shrink-0 bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    New job
                  </Button>
                </div>
              </div>
            </section>

            {demoActionState !== "idle" && (
              <div className="px-4 pb-4 sm:px-6">
                <div
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3.5 text-sm shadow-sm",
                    demoActionState === "submitted" || demoActionState === "already_started"
                      ? "border-primary/25 bg-primary/5 text-foreground"
                      : demoActionState === "loading"
                        ? "border-border bg-card text-foreground"
                        : "border-amber-500/25 bg-amber-50 text-amber-950",
                  )}
                  role="status"
                  aria-live="polite"
                >
                  {demoActionState === "loading" ? (
                    <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
                  ) : demoActionState === "submitted" || demoActionState === "already_started" ? (
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  ) : (
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" aria-hidden />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium">
                      {demoActionState === "loading" ? "Authorized demo in progress" : demoActionLabel}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{demoActionMessage}</p>
                    {(demoActionState === "uncertain_submit" || demoActionState === "error") && (
                      <p className="mt-2 text-xs font-medium leading-relaxed text-amber-900">
                        Do not submit again. Review the private demo record before taking any further action.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              <div className="rr-list-column hidden w-full max-w-md shrink-0 flex-col border-r border-border lg:flex">
                <ReadinessQueue
                  items={queueItems}
                  summary={queueSummary}
                  selectedId={selectedId}
                  query={query}
                  filter={filter}
                  loading={queueLoading || listLoading}
                  hasLoaded={queueHasLoaded}
                  error={queueError ?? listError}
                  lastRefreshedAt={queueLastRefreshedAt}
                  onSelect={selectJob}
                  onQuery={setQuery}
                  onFilter={setFilter}
                  onRefresh={() => { void loadJobs(); }}
                  onCreate={openCreate}
                  selectedIds={selectedQueueIds}
                  onToggleSelect={handleToggleQueueSelect}
                  onClearSelection={handleClearQueueSelection}
                  bulkPreparing={bulkPreparing}
                  onPrepareSelected={handlePrepareSelectedDrafts}
                />
              </div>

              <div className="rr-mobile-jobbar flex items-center gap-2 border-b border-border px-4 py-2.5 lg:hidden">
                <Button
                  variant="outline"
                  size="sm"
                  className="min-w-0 flex-1 justify-start gap-2 bg-background"
                  onClick={() => setMobileListOpen(true)}
                >
                  <Briefcase className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                  <span className="truncate">{selected ? selected.customer_name : "Choose a job"}</span>
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => { void loadJobs(); }}
                  disabled={listLoading || queueLoading}
                  aria-label="Refresh readiness queue"
                  title="Read saved jobs and queue records again"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", (listLoading || queueLoading) && "animate-spin")} />
                </Button>
              </div>

              <Sheet open={mobileListOpen} onOpenChange={setMobileListOpen}>
                <SheetContent
                  side="bottom"
                  className="rr-mobile-drawer flex h-[85vh] max-h-[44rem] flex-col p-0 sm:max-w-full"
                >
                  <ReadinessQueue
                    items={queueItems}
                    summary={queueSummary}
                    selectedId={selectedId}
                    query={query}
                    filter={filter}
                    loading={queueLoading || listLoading}
                    hasLoaded={queueHasLoaded}
                    error={queueError ?? listError}
                    lastRefreshedAt={queueLastRefreshedAt}
                    onSelect={selectJob}
                    onQuery={setQuery}
                    onFilter={setFilter}
                    onRefresh={() => { void loadJobs(); }}
                    onCreate={openCreate}
                    selectedIds={selectedQueueIds}
                    onToggleSelect={handleToggleQueueSelect}
                    onClearSelection={handleClearQueueSelection}
                    bulkPreparing={bulkPreparing}
                    onPrepareSelected={handlePrepareSelectedDrafts}
                  />
                </SheetContent>
              </Sheet>

              <main className="rr-main min-h-0 flex-1 overflow-y-auto p-4 pb-8 sm:p-6 sm:pb-10">
                {selected && hasSavedCallEvidence && (
                  <section
                    className="rr-recording-orientation mb-4 rounded-xl border border-primary/20 bg-primary/5 p-3.5 sm:p-4"
                    aria-label="Before and after orientation"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">
                          Selected job story
                        </p>
                        <p className="mt-1 text-sm font-semibold text-foreground">
                          The saved result keeps the boundary visible.
                        </p>
                      </div>
                      <span className="rr-status-chip border-primary/25 bg-card text-primary">
                        Saved state
                      </span>
                    </div>
                    <div className="rr-recording-orientation-grid mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-stretch">
                      <div className="rr-recording-orientation-step rounded-lg border border-amber-500/25 bg-amber-50/75 px-3 py-2.5" data-state="before">
                        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-amber-800">
                          Before
                        </p>
                        <p className="mt-1 text-sm font-semibold text-amber-950">
                          Coordinator draft
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-amber-900/80">
                          Entered by the coordinator, still unverified.
                        </p>
                      </div>
                      <div className="rr-recording-orientation-arrow hidden items-center justify-center px-1 text-primary sm:flex" aria-hidden>
                        <span className="font-mono text-lg">→</span>
                      </div>
                      <div className="rr-recording-orientation-step rounded-lg border border-primary/25 bg-card px-3 py-2.5" data-state="after">
                        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
                          After
                        </p>
                        <p className="mt-1 text-sm font-semibold text-foreground">
                          Saved CALL-E evidence, visible gaps, and readiness decision
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          Confirmed facts, open details, and the next action stay separate.
                        </p>
                      </div>
                    </div>
                  </section>
                )}
                {listLoading && jobs.length === 0 ? (
                  <LoadingDetail />
                ) : listError && jobs.length === 0 ? (
                  <LoadError message={listError} onRetry={loadJobs} />
                ) : selected ? (
                  <JobDetail
                    job={selected}
                    onEdit={() => openEdit(selected)}
                    onDelete={() => setDeleteTarget(selected)}
                    callDraft={callDraft}
                    callDraftLoading={callDraftLoading}
                    callDraftSaving={callDraftSaving}
                    callDraftError={callDraftError}
                    onSaveCallDraft={handleSaveCallDraft}
                    brief={brief}
                    briefLoading={briefLoading}
                    briefSaving={briefSaving}
                    briefError={briefError}
                    onRetryBrief={retryBrief}
                    onSaveBriefReview={handleSaveBriefReview}
                    onCopyBriefSummary={handleCopyBriefSummary}
                    authorizedDemoActionState={demoActionState}
                    authorizedDemoMessage={demoActionMessage}
                    onOpenAuthorizedDemo={() => setDemoConfirmOpen(true)}
                    demoStatusRefreshing={demoStatusRefreshing}
                    demoStatusMessage={demoStatusMessage}
                    onRefreshDemoStatus={handleRefreshDemoStatus}
                    approveState={approveState}
                    approveMessage={approveMessage}
                    onApproveCall={handleApproveCall}
                    dispatchState={dispatchState}
                    dispatchMessage={dispatchMessage}
                    onDispatchCall={handleDispatchCall}
                    retryDraftState={callDraftSaving ? "loading" : "idle"}
                    onRetryCallDraft={handleRetryCallDraft}
                    shareLinkState={shareLinkState}
                    shareLinkMessage={shareLinkMessage}
                    onCreateShareLink={handleCreateShareLink}
                    onRevokeShareLink={handleRevokeShareLink}
                    followUpDraftState={callDraftSaving ? "loading" : "idle"}
                    onCreateFollowUpDraft={handleCreateFollowUpDraft}
                    postVisitDraftState={callDraftSaving ? "loading" : "idle"}
                    onCreatePostVisitDraft={handleCreatePostVisitDraft}
                  />
                ) : (
                  <EmptyDetail onCreate={openCreate} hasJobs={jobs.length > 0} />
                )}
              </main>
            </div>
          </>
        )}
      </div>

      <JobEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        job={editingJob}
        onSave={handleSave}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this job?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Remove the draft for ${deleteTarget.customer_name}. This cannot be undone.`
                : "This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete job"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={demoConfirmOpen} onOpenChange={(open) => !demoActionInProgress && setDemoConfirmOpen(open)}>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Run the authorized RepairReady demo?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create one private job labeled as a demonstration and place one call to the approved
              demo participant. The AI will identify itself as part of an authorized RepairReady demonstration
              and ask the participant to agree before it asks preparation questions.
              <br />
              <br />
              This is not a service booking, diagnosis, repair recommendation, or payment request. Once the
              provider accepts the call, it cannot be canceled from this workspace. It runs only after you
              confirm here and never on refresh, reload, or job selection.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={demoActionInProgress}>Keep review-only</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleRunAuthorizedDemoCall();
              }}
              disabled={demoActionInProgress || demoActionState !== "idle"}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {demoActionInProgress ? "Preparing demo…" : "Create demo and place one call"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col px-4 py-5 text-sidebar-foreground">
      <div className="mb-8 flex items-center gap-2.5 px-1">
        <img
          src={LOGO}
          alt="RepairReady"
          className="h-10 w-10 rounded-xl object-cover ring-1 ring-white/10"
          width={40}
          height={40}
        />
        <div>
          <p className="text-base font-semibold tracking-tight text-sidebar-foreground">RepairReady</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-sidebar-foreground/50">
            Field preparation
          </p>
        </div>
      </div>

      <nav className="space-y-1 border-t border-white/10 pt-4" aria-label="Workspace navigation">
        <button
          type="button"
          onClick={onNavigate}
          className="flex w-full items-center gap-2.5 rounded-lg bg-sidebar-accent px-3 py-2.5 text-left text-sm font-medium text-sidebar-accent-foreground transition-colors hover:bg-sidebar-accent/80"
          aria-current="page"
        >
          <Briefcase className="h-4 w-4 text-sidebar-primary" aria-hidden />
          Jobs
        </button>
      </nav>

      <div className="mt-auto space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-sidebar-foreground/45">
          This workspace
        </p>
        <ol className="space-y-2.5 text-xs leading-relaxed text-sidebar-foreground/70">
          <li className="flex gap-2.5">
            <span className="font-mono text-sidebar-primary">1</span>
            Capture the issue as the coordinator knows it.
          </li>
          <li className="flex gap-2.5">
            <span className="font-mono text-sidebar-foreground/40">2</span>
            Review the recipient and outline, then save one private preparation draft.
          </li>
          <li className="flex gap-2.5">
            <span className="font-mono text-sidebar-foreground/40">3</span>
            Check the provider connection only when you choose.
          </li>
          <li className="flex gap-2.5">
            <span className="font-mono text-sidebar-foreground/40">4</span>
            Run the fixed authorized demonstration only after confirmation.
          </li>
        </ol>
        <p className="border-t border-white/10 pt-3 text-[11px] leading-relaxed text-sidebar-foreground/45">
          Connection checks are read-only. Calling any job's number requires re-typing it to approve one
          real call; the fixed demonstration has its own separate guarded action.
        </p>
      </div>
    </div>
  );
}

function SignedOutView({ reduceMotion }: { reduceMotion: boolean }) {
  const [mode, setMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "sign_up") {
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        setNotice("Account created. If email confirmation is required, check your inbox, then sign in.");
        setMode("sign_in");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Check your details and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center p-5 sm:p-8">
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-xl space-y-6 rounded-2xl border border-border bg-card p-6 shadow-md sm:p-9"
      >
        <div className="flex items-center gap-3">
          <img src={LOGO} alt="RepairReady" className="h-12 w-12 rounded-xl" width={48} height={48} />
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Private workspace</p>
            <p className="mt-1 text-sm font-semibold text-foreground">RepairReady</p>
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Sign in to the repair desk
          </h2>
          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
            Keep appliance-repair drafts on your account while you prepare the next visit. Job data is
            never shown without authentication.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-muted/35 p-4">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            What you can do here
          </p>
          <ul className="space-y-2.5 text-sm leading-relaxed text-foreground/90">
            <li className="flex gap-2.5">
              <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              Record the customer, appliance, symptoms, and access notes you already have.
            </li>
            <li className="flex gap-2.5">
              <Search className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              Spot missing preparation details before the technician visit.
            </li>
            <li className="flex gap-2.5">
              <Shield className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              Review a read-only provider connection check. A single authorized demonstration is available
              after sign-in; calling any other job's number requires you to re-confirm it first.
            </li>
          </ul>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="auth-email">Email</Label>
            <Input
              id="auth-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="auth-password">Password</Label>
            <Input
              id="auth-password"
              type="password"
              required
              minLength={6}
              autoComplete={mode === "sign_up" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <p className="text-xs leading-relaxed text-destructive" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="text-xs leading-relaxed text-primary" role="status">
              {notice}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" disabled={submitting} className="flex-1 bg-primary text-primary-foreground">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "sign_up" ? "Create account" : "Sign in"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={submitting}
              onClick={() => {
                setMode(mode === "sign_up" ? "sign_in" : "sign_up");
                setError(null);
                setNotice(null);
              }}
            >
              {mode === "sign_up" ? "Sign in instead" : "Create account instead"}
            </Button>
          </div>
        </form>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Your jobs stay on your account. This is a private preparation desk, not a public customer portal.
        </p>
      </motion.div>
    </div>
  );
}

function LoadingDetail() {
  return (
    <div className="flex min-h-[20rem] flex-col items-center justify-center rounded-2xl border border-border bg-card/45 p-8 text-center">
      <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
      <p className="mt-3 text-sm font-medium text-foreground">Loading private jobs</p>
      <p className="mt-1 text-xs text-muted-foreground">Your saved drafts will appear here.</p>
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-[20rem] flex-col items-center justify-center rounded-2xl border border-destructive/25 bg-card p-8 text-center shadow-sm" role="alert">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-5 w-5" aria-hidden />
      </div>
      <p className="mt-3 text-sm font-semibold text-foreground">Jobs could not load</p>
      <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        Try again
      </Button>
    </div>
  );
}

function EmptyDetail({ onCreate, hasJobs }: { onCreate: () => void; hasJobs: boolean }) {
  return (
    <div className="flex min-h-[20rem] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Wrench className="h-5 w-5" aria-hidden />
      </div>
      <p className="text-base font-semibold text-foreground">
        {hasJobs ? "Choose a job to begin" : "Start with a job draft"}
      </p>
      <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {hasJobs
          ? "Select a draft from the queue to review preparation details and the local call outline."
          : "Save customer and appliance details here. Connection checking and real dialing stay separate from this draft."}
      </p>
      {!hasJobs && (
        <Button className="mt-4 bg-primary text-primary-foreground" onClick={onCreate}>
          <Plus className="mr-1.5 h-4 w-4" />
          New job
        </Button>
      )}
    </div>
  );
}

export default Index;
