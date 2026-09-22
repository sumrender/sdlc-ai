import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AppWindow, Check, Loader2, Pencil, Plus, Server, Trash2, Undo2, X, type LucideIcon } from "lucide-react";
import { REVIEWERS, SEVERITIES, type AgentRun, type Finding, type HumanReviewDecision, type Review, type Reviewer, type Severity, type TaskDetail, type Verdict } from "@sdlc-ai/shared";
import { Markdown } from "~/components/Markdown";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { useApi } from "~/lib/api-context";
import { tasksQueryKey } from "~/lib/board-query";
import { formatTime } from "~/lib/task-detail";
import { setTaskDetail } from "~/lib/task-query";
import { cn } from "~/lib/utils";

export const REVIEWER_LABEL: Record<Reviewer, string> = {
  REVIEWER_FRONTEND: "Frontend",
  REVIEWER_BACKEND: "Backend",
};

const REVIEWER_ICON: Record<Reviewer, LucideIcon> = {
  REVIEWER_FRONTEND: AppWindow,
  REVIEWER_BACKEND: Server,
};

const SEVERITY_CLASS: Record<Severity, string> = {
  CRITICAL: "border-red-200 bg-red-100 text-red-800",
  HIGH: "border-transparent bg-red-100 text-red-700",
  MEDIUM: "border-transparent bg-amber-100 text-amber-800",
  LOW: "border-transparent bg-blue-100 text-blue-700",
  INFO: "border-transparent bg-secondary text-muted-foreground",
};

const severityRank = (s: Severity) => SEVERITIES.indexOf(s);

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

export interface ReviewSummary {
  completed: number;
  passed: number;
  rejected: number;
  findings: number;
  /** Findings at HIGH or CRITICAL. */
  serious: number;
}

export function summarizeReviews(reviews: readonly Review[]): ReviewSummary {
  const latest = latestReviews(reviews);
  const all = latest.flatMap((r) => r.findings);
  return {
    completed: latest.length,
    passed: latest.filter((r) => r.verdict === "PASS").length,
    rejected: latest.filter((r) => r.verdict === "REJECT").length,
    findings: all.length,
    serious: all.filter((f) => f.severity === "HIGH" || f.severity === "CRITICAL").length,
  };
}

/** The most recent Review per Reviewer; a Reject loop re-reviews and the older ones are history. */
export function latestReviews(reviews: readonly Review[]): Review[] {
  const byReviewer = new Map<Reviewer, Review>();
  for (const review of [...reviews].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) byReviewer.set(review.reviewer, review);
  return REVIEWERS.flatMap((r) => {
    const review = byReviewer.get(r);
    return review ? [review] : [];
  });
}

export interface ReviewPanelProps {
  reviews: readonly Review[];
  /** Used to show which Reviewers are still running or failed before their Review exists. */
  agentRuns: readonly AgentRun[];
  /** Opens the LOG Artifact of the Agent Run that produced the Review. */
  onOpenRun?: (agentRunId: string) => void;
  /** Task id, needed for the per-review Accept / Reject / Edit / Send-back mutations. */
  taskId: string;
  /** The PENDING Approval id; Send-back is only available while it exists. */
  pendingApprovalId: string | null;
}

/** Four ReviewCards, one per Reviewer, each with its Verdict and Findings. */
export function ReviewPanel({ reviews, agentRuns, onOpenRun, taskId, pendingApprovalId }: ReviewPanelProps) {
  const latest = latestReviews(reviews);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {REVIEWERS.map((reviewer) => {
        const review = latest.find((r) => r.reviewer === reviewer) ?? null;
        const run = [...agentRuns].filter((r) => r.agent === reviewer).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
        return <ReviewCard key={reviewer} reviewer={reviewer} review={review} run={run} onOpenRun={onOpenRun} taskId={taskId} pendingApprovalId={pendingApprovalId} />;
      })}
    </div>
  );
}

interface ReviewCardProps {
  reviewer: Reviewer;
  review: Review | null;
  run: AgentRun | null;
  onOpenRun?: (agentRunId: string) => void;
  taskId: string;
  pendingApprovalId: string | null;
}

type CardMode = "accept" | "reject" | "edit" | "sendback" | null;

function ReviewCard({ reviewer, review, run, onOpenRun, taskId, pendingApprovalId }: ReviewCardProps) {
  const Icon = REVIEWER_ICON[reviewer];
  const rejected = review?.verdict === "REJECT";
  const running = !review && (run?.status === "RUNNING" || run?.status === "QUEUED");
  const failed = !review && run !== null && (run.status === "FAILED" || run.status === "TIMED_OUT");
  const findings = review ? sortFindings(review.findings) : [];

  const { client } = useApi();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<CardMode>(null);
  const [comment, setComment] = useState("");
  const [draftVerdict, setDraftVerdict] = useState<Verdict>("PASS");
  const [draftFindings, setDraftFindings] = useState<Finding[]>([]);

  const onSuccess = (detail: TaskDetail) => {
    setTaskDetail(queryClient, detail);
    void queryClient.invalidateQueries({ queryKey: tasksQueryKey });
    setMode(null);
    setComment("");
  };

  const decide = useMutation({
    mutationFn: (input: { decision: HumanReviewDecision; comment: string }) => client.decideReview(taskId, review!.id, input),
    onSuccess,
  });
  const saveEdit = useMutation({
    mutationFn: (input: { verdict: Verdict; findings: Finding[] }) => client.updateReview(taskId, review!.id, input),
    onSuccess,
  });
  const sendBack = useMutation({
    mutationFn: (input: { comment: string; verdict: Verdict; findings: Finding[] }) => client.sendReviewBack(taskId, review!.id, input),
    onSuccess,
  });
  const busy = decide.isPending || saveEdit.isPending || sendBack.isPending;
  const error = decide.error ?? saveEdit.error ?? sendBack.error;

  const openMode = (next: Exclude<CardMode, null>) => {
    if (!review) return;
    setComment(next === "accept" || next === "reject" ? (review.humanComment ?? "") : "");
    setDraftVerdict(review.verdict);
    setDraftFindings(review.findings.map((f) => ({ ...f })));
    setMode(next);
  };

  const canSendBack = review !== null && pendingApprovalId !== null;

  return (
    <article
      aria-label={`${REVIEWER_LABEL[reviewer]} Review`}
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-border bg-card",
        rejected && "border-amber-300",
        review?.verdict === "PASS" && "border-emerald-200",
      )}
    >
      <header className="flex items-center justify-between gap-3 bg-secondary/50 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className={cn("h-4 w-4 shrink-0", rejected ? "text-amber-600" : review ? "text-emerald-600" : "text-muted-foreground")} aria-hidden />
          <h3 className="truncate text-[13px] font-medium">{REVIEWER_LABEL[reviewer]}</h3>
          {review && findings.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {findings.length} {findings.length === 1 ? "Finding" : "Findings"}
            </span>
          )}
          {review?.humanEdited && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800" title="A human edited this review's verdict or findings">
              edited by human
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {review?.humanDecision && <HumanDecisionBadge decision={review.humanDecision} />}
          {review ? (
            <Badge variant={rejected ? "warning" : "success"} title={rejected ? "Informational: a REJECT does not block. Your Approval decides." : undefined}>
              {review.verdict}
            </Badge>
          ) : running ? (
            <Badge variant="info" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Reviewing
            </Badge>
          ) : failed ? (
            <Badge variant="destructive">Run {run.status.replace("_", " ")}</Badge>
          ) : (
            <Badge variant="secondary">Pending</Badge>
          )}
        </div>
      </header>

      {rejected && (
        <p className="border-t border-amber-200 bg-amber-50 px-3.5 py-1.5 text-[11px] text-amber-800">
          Informational. A REJECT does not block the Task; your Approval decides.
        </p>
      )}

      {review?.humanDecision && (
        <div className={cn("border-t px-3.5 py-2 text-xs", review.humanDecision === "ACCEPTED" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50")}>
          <p className={cn("font-medium", review.humanDecision === "ACCEPTED" ? "text-emerald-800" : "text-red-700")}>
            {review.humanDecision === "ACCEPTED" ? "Accepted by human" : "Marked invalid by human"}
            {review.humanDecidedAt && <span className="ml-1.5 font-normal text-muted-foreground">{formatTime(review.humanDecidedAt)}</span>}
          </p>
          {review.humanComment && (
            <div className="mt-0.5 text-foreground/90">
              <Markdown text={review.humanComment} className="[&>p]:my-0" />
            </div>
          )}
        </div>
      )}

      <div className="border-t border-border">
        {review ? (
          findings.length > 0 ? (
            <ul className="divide-y divide-border">
              {findings.map((finding, index) => (
                <FindingRow key={index} finding={finding} />
              ))}
            </ul>
          ) : (
            <p className="px-3.5 py-3 text-xs text-muted-foreground">No Findings.</p>
          )
        ) : (
          <p className="px-3.5 py-3 text-xs text-muted-foreground">
            {running ? "The Reviewer is reading the pull request…" : failed ? (run.error ?? "The Reviewer's run did not finish.") : "Not reviewed yet."}
          </p>
        )}
      </div>

      {review && mode === null && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border bg-secondary/30 px-3.5 py-2">
          <Button size="sm" variant="outline" onClick={() => openMode("accept")} disabled={busy} title="Mark this review valid, with optional insights">
            <Check /> Accept
          </Button>
          <Button size="sm" variant="outline" onClick={() => openMode("reject")} disabled={busy} title="Mark this review invalid, with a reason anyone can see">
            <X /> Reject
          </Button>
          <Button size="sm" variant="outline" onClick={() => openMode("edit")} disabled={busy} title="Edit this review's verdict and findings">
            <Pencil /> Edit
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => openMode("sendback")}
            disabled={busy || !canSendBack}
            title={canSendBack ? "Edit findings, add a comment, and send only this review back to the Developer" : "Available while the Task awaits your decision"}
          >
            <Undo2 /> {sendBack.isPending ? "Sending back…" : "Send back to Developer"}
          </Button>
        </div>
      )}

      {review && (mode === "accept" || mode === "reject") && (
        <form
          className={cn("flex flex-col gap-2 border-t p-3", mode === "reject" ? "border-red-500/40 bg-red-500/[0.06]" : "border-emerald-500/30 bg-emerald-500/[0.05]")}
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === "reject" && !comment.trim()) return;
            decide.mutate({ decision: mode === "accept" ? "ACCEPTED" : "REJECTED", comment: comment.trim() });
          }}
        >
          <Label htmlFor={`${review.id}-${mode}-comment`}>
            {mode === "accept" ? "Your insights (optional)" : "Why is this review invalid? (required)"}
          </Label>
          <Textarea
            id={`${review.id}-${mode}-comment`}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={mode === "accept" ? "What should future readers know about this review?" : "Which findings are wrong and why? Shown to anyone opening the Task."}
            rows={3}
            autoFocus
          />
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode(null)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" size="sm" variant={mode === "reject" ? "destructive" : "default"} disabled={busy || (mode === "reject" && !comment.trim())}>
              {decide.isPending ? "Saving…" : mode === "accept" ? "Accept review" : "Mark invalid"}
            </Button>
          </div>
        </form>
      )}

      {review && (mode === "edit" || mode === "sendback") && (
        <div className="flex flex-col gap-2 border-t border-border p-3">
          <FindingsEditor verdict={draftVerdict} onVerdictChange={setDraftVerdict} findings={draftFindings} onChange={setDraftFindings} disabled={busy} />
          <Label htmlFor={`${review.id}-${mode}-sendback-comment`}>Your comment {mode === "sendback" ? "(sent to the Developer with the findings above)" : "(optional, saved with the edit)"}</Label>
          <Textarea
            id={`${review.id}-${mode}-sendback-comment`}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={mode === "sendback" ? "What must the Developer change? The findings above are attached automatically." : "Note for future readers (optional)."}
            rows={3}
          />
          {mode === "sendback" && !canSendBack && <p className="text-[11px] text-amber-700">Send-back needs a PENDING Approval; the Task may have moved on. Refresh to check.</p>}
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode(null)} disabled={busy}>
              Cancel
            </Button>
            {mode === "edit" ? (
              <Button size="sm" onClick={() => saveEdit.mutate({ verdict: draftVerdict, findings: draftFindings })} disabled={busy}>
                {saveEdit.isPending ? "Saving…" : "Save edits"}
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => sendBack.mutate({ comment: comment.trim(), verdict: draftVerdict, findings: draftFindings })} disabled={busy || !canSendBack}>
                <Undo2 /> {sendBack.isPending ? "Sending back…" : "Send back to Developer"}
              </Button>
            )}
          </div>
        </div>
      )}

      {review && (
        <footer className="flex items-center justify-between gap-3 border-t border-border bg-secondary/30 px-3.5 py-1.5 text-[11px] text-muted-foreground">
          <span>Reviewed {formatTime(review.createdAt)}</span>
          {onOpenRun && (
            <button type="button" onClick={() => onOpenRun(review.agentRunId)} className="text-blue-700 hover:underline">
              Open run log
            </button>
          )}
        </footer>
      )}
    </article>
  );
}

function HumanDecisionBadge({ decision }: { decision: HumanReviewDecision }) {
  return decision === "ACCEPTED" ? (
    <Badge variant="success" title="A human marked this review valid">
      Accepted
    </Badge>
  ) : (
    <Badge variant="destructive" title="A human marked this review invalid — see the comment">
      Invalid
    </Badge>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const location = finding.file ? `${finding.file}${finding.line !== undefined ? `:${finding.line}` : ""}` : null;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-3.5 py-2.5">
      <span className={cn("mt-0.5 inline-flex h-5 items-center rounded border px-1.5 text-[10px] font-semibold uppercase tracking-wide", SEVERITY_CLASS[finding.severity])}>
        {finding.severity}
      </span>
      <div className="min-w-0">
        <Markdown text={finding.message} className="[&>p]:my-0" />
        {location && (
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={location}>
            {location}
          </p>
        )}
      </div>
    </li>
  );
}

interface FindingsEditorProps {
  verdict: Verdict;
  onVerdictChange: (v: Verdict) => void;
  findings: Finding[];
  onChange: (next: Finding[]) => void;
  disabled?: boolean;
}

function FindingsEditor({ verdict, onVerdictChange, findings, onChange, disabled }: FindingsEditorProps) {
  const set = (index: number, patch: Partial<Finding>) => onChange(findings.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  const remove = (index: number) => onChange(findings.filter((_, i) => i !== index));
  const add = () => onChange([...findings, { severity: "MEDIUM" as Severity, message: "" }]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Label>Verdict</Label>
        <div className="flex gap-1.5" role="group" aria-label="Review verdict">
          {(["PASS", "REJECT"] as const).map((v) => (
            <Button key={v} type="button" size="sm" variant={verdict === v ? "default" : "outline"} onClick={() => onVerdictChange(v)} disabled={disabled}>
              {v}
            </Button>
          ))}
        </div>
      </div>
      {findings.length === 0 && <p className="text-xs text-muted-foreground">No findings — add one below or send with just your comment.</p>}
      <ul className="flex flex-col gap-2">
        {findings.map((finding, index) => (
          <li key={index} className="flex flex-col gap-1.5 rounded-md border border-border p-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor={`finding-${index}-severity`} className="sr-only">
                Severity
              </Label>
              <select
                id={`finding-${index}-severity`}
                value={finding.severity}
                onChange={(e) => set(index, { severity: e.target.value as Severity })}
                disabled={disabled}
                className="h-8 rounded-md border border-input bg-card px-2 text-xs shadow-sm"
                aria-label={`Finding ${index + 1} severity`}
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <span className="flex-1 text-[11px] text-muted-foreground">Finding {index + 1}</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => remove(index)} disabled={disabled} title="Dismiss this finding (removes it from what the Developer receives)" className="text-red-600 hover:bg-red-50 hover:text-red-700">
                <Trash2 /> Dismiss
              </Button>
            </div>
            <Textarea
              value={finding.message}
              onChange={(e) => set(index, { message: e.target.value })}
              placeholder="Finding text (edit or correct it)"
              rows={2}
              disabled={disabled}
              aria-label={`Finding ${index + 1} message`}
            />
            <div className="grid grid-cols-[1fr_100px] gap-1.5">
              <Input value={finding.file ?? ""} onChange={(e) => set(index, { file: e.target.value || undefined })} placeholder="file (optional)" disabled={disabled} aria-label={`Finding ${index + 1} file`} />
              <Input
                value={finding.line?.toString() ?? ""}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  set(index, { line: Number.isNaN(n) ? undefined : n });
                }}
                placeholder="line"
                inputMode="numeric"
                disabled={disabled}
                aria-label={`Finding ${index + 1} line`}
              />
            </div>
          </li>
        ))}
      </ul>
      <div>
        <Button type="button" size="sm" variant="outline" onClick={add} disabled={disabled}>
          <Plus /> Add finding
        </Button>
      </div>
    </div>
  );
}
