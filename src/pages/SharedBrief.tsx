import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertCircle, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { completionLabel, readinessLabel, type CallCompletionStatus, type ReadinessStatus } from "@/lib/repair-briefs";

interface SharedBriefPayload {
  safe_summary: string;
  readiness_status: string;
  call_completion_status: string;
  expires_at: string;
}

type LoadState = "loading" | "ok" | "not_found" | "expired" | "error";

const SharedBrief = () => {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");
  const [brief, setBrief] = useState<SharedBriefPayload | null>(null);

  useEffect(() => {
    let active = true;
    if (!token) {
      setState("not_found");
      setMessage("No share link was provided.");
      return;
    }
    setState("loading");
    supabase.functions
      .invoke("get-shared-brief", { body: { share_token: token } })
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data) {
          setState("error");
          setMessage("This shared brief could not be loaded. Try again later.");
          return;
        }
        const result = data as { status: LoadState; message: string; brief?: SharedBriefPayload };
        setState(result.status);
        setMessage(result.message);
        setBrief(result.brief ?? null);
      })
      .catch(() => {
        if (!active) return;
        setState("error");
        setMessage("This shared brief could not be loaded. Try again later.");
      });
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-5 sm:p-8">
      <div className="w-full max-w-xl space-y-4 rounded-2xl border border-border bg-card p-6 shadow-md sm:p-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">RepairReady · Shared brief</p>

        {state === "loading" && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
            Loading the shared brief…
          </div>
        )}

        {(state === "not_found" || state === "expired" || state === "error") && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertCircle className="h-5 w-5" aria-hidden />
            </div>
            <p className="text-sm font-semibold text-foreground">
              {state === "expired" ? "This link has expired" : "This link isn't available"}
            </p>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{message}</p>
          </div>
        )}

        {state === "ok" && brief && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
              <span className="rr-status-chip border-primary/25 bg-primary/5 text-primary">
                {readinessLabel(brief.readiness_status as ReadinessStatus)}
              </span>
              <span className="rr-status-chip border-border bg-background text-muted-foreground">
                {completionLabel(brief.call_completion_status as CallCompletionStatus)}
              </span>
            </div>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
              {brief.safe_summary}
            </pre>
            <div className="flex items-start gap-2 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              <p>
                This is a read-only, time-boxed view shared by the coordinator. It expires automatically at{" "}
                {new Date(brief.expires_at).toLocaleString()}.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default SharedBrief;
