import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ShieldCheck, Undo2, X } from "lucide-react";
import { DecideApprovalInputSchema, type Approval, type TaskDetail } from "@sdlc-ai/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { useApi } from "~/lib/api-context";
import { tasksQueryKey } from "~/lib/board-query";
import { formatDateTime } from "~/lib/task-detail";
import { setTaskDetail } from "~/lib/task-query";
import { cn } from "~/lib/utils";

export interface ApprovalPanelProps {
  task: Pick<TaskDetail, "id" | "pullRequestNumber">;
  approval: Approval;
  /** The Project's default branch, named in the Approve confirmation. */
  defaultBranch?: string;
}

/**
 * Approve or Reject the pending Approval. Approve merges the pull request and
 * moves the Task to STAGING; Reject requires feedback and sends the Task back
 * to DEVELOPMENT with that feedback and the Reviews' Findings.
 */
export function ApprovalPanel({ task, approval, defaultBranch }: ApprovalPanelProps) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [feedback, setFeedback] = useState("");

  const rejectInput = DecideApprovalInputSchema.safeParse({ decision: "REJECTED", feedback });

  const decide = useMutation({
    mutationFn: (decision: "APPROVED" | "REJECTED") => {
      if (decision === "APPROVED") return client.decideApproval(task.id, approval.id, { decision });
      if (!rejectInput.success) throw new Error("Feedback is required to Reject.");
      return client.decideApproval(task.id, approval.id, rejectInput.data);
    },
    onSuccess: (detail) => {
      setTaskDetail(queryClient, detail);
      void queryClient.invalidateQueries({ queryKey: tasksQueryKey });
      setRejecting(false);
      setFeedback("");
    },
  });

  if (approval.status !== "PENDING") return <DecidedApproval approval={approval} />;

  const busy = decide.isPending;
  const pr = task.pullRequestNumber ? `PR #${task.pullRequestNumber}` : "the pull request";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-muted-foreground">
        Approve merges {pr} into <span className="font-mono text-foreground">{defaultBranch ?? "the default branch"}</span> and moves the Task to STAGING.
        Reject sends it back to DEVELOPMENT with your feedback.
      </p>

      {!rejecting ? (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => setConfirmApprove(true)}
            disabled={busy}
          >
            <Check /> {busy && decide.variables === "APPROVED" ? "Approving…" : "Approve"}
          </Button>
          <Button variant="outline" onClick={() => setRejecting(true)} disabled={busy}>
            <X /> Reject
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2 rounded-md border border-red-500/40 bg-red-500/[0.06] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (rejectInput.success) decide.mutate("REJECTED");
          }}
        >
          <Label htmlFor="approval-feedback">
            Feedback for the Developer <span className="text-muted-foreground">(required)</span>
          </Label>
          <Textarea
            id="approval-feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What must change before this can ship? The Reviews' Findings are attached automatically."
            rows={4}
            autoFocus
            required
            aria-invalid={feedback.length > 0 && !rejectInput.success}
          />
          <div className="flex flex-col gap-2">
            <p className={cn("text-[11px]", rejectInput.success ? "text-muted-foreground" : "text-red-600")}>
              {rejectInput.success ? "Sends the Task back to DEVELOPMENT." : "Write the feedback before submitting."}
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setRejecting(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" size="sm" variant="destructive" disabled={!rejectInput.success || busy}>
                <Undo2 /> {busy ? "Rejecting…" : "Reject and send back"}
              </Button>
            </div>
          </div>
        </form>
      )}

      {decide.error && (
        <p role="alert" className="text-xs text-red-600">
          {decide.error.message}
        </p>
      )}

      <AlertDialog open={confirmApprove} onOpenChange={setConfirmApprove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve and merge {pr}?</AlertDialogTitle>
            <AlertDialogDescription>
              The pull request is merged into {defaultBranch ?? "the default branch"}, the Task moves to STAGING, and the touched Deploy Targets start
              deploying. Merging cannot be undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => decide.mutate("APPROVED")}>Approve and merge</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The decision, once made. */
export function DecidedApproval({ approval }: { approval: Approval }) {
  const approved = approval.status === "APPROVED";
  return (
    <div className={cn("flex flex-col gap-2 rounded-lg border p-3", approved ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50")}>
      <div className="flex items-center gap-2">
        <ShieldCheck className={cn("h-4 w-4", approved ? "text-emerald-600" : "text-red-600")} aria-hidden />
        <Badge variant={approved ? "success" : "destructive"}>{approval.status}</Badge>
        {approval.decidedAt && <span className="text-xs text-muted-foreground">{formatDateTime(approval.decidedAt)}</span>}
      </div>
      {approval.feedback && <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground/90">{approval.feedback}</pre>}
      {!approval.feedback && <p className="text-xs text-muted-foreground">{approved ? "Merged and moved to STAGING." : "Sent back to DEVELOPMENT."}</p>}
    </div>
  );
}
