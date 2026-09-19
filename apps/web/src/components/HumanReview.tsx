import { ExternalLink, FileDiff, FileText, GitBranch, GitPullRequest, ShieldCheck } from "lucide-react";
import type { Artifact, TaskDetail } from "@sdlc-ai/shared";
import { AGENT_LABEL } from "~/components/TaskCard";
import { ApprovalPanel } from "~/components/ApprovalPanel";
import { PlanViewer } from "~/components/PlanViewer";
import { ReviewPanel, summarizeReviews } from "~/components/ReviewPanel";
import { Section } from "~/components/Section";
import { TestRunResults } from "~/components/TestRunResults";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { formatDateTime, formatDuration, logArtifactFor, runDuration, type Run } from "~/lib/task-detail";
import { cn } from "~/lib/utils";

export interface HumanReviewProps {
  task: TaskDetail;
  /** Opens a run's LOG Artifact. */
  onOpenLog: (run: Run) => void;
  /** Opens a text Artifact (a DIFF) in the log viewer. */
  onOpenText: (artifact: Artifact, subtitle: string) => void;
  /** Opens a report, screenshot, or video. */
  onOpenArtifact: (artifact: Artifact) => void;
  defaultBranch?: string;
}

/**
 * The HUMAN REVIEW screen: every piece of evidence for the Task in one place,
 * with the Approve and Reject decision beside it.
 */
export function HumanReview({ task, onOpenLog, onOpenText, onOpenArtifact, defaultBranch }: HumanReviewProps) {
  const approval = [...task.approvals].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const pending = approval?.status === "PENDING";
  const summary = summarizeReviews(task.reviews);
  const latestTest = [...task.testRuns].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const testPassed = latestTest?.status === "COMPLETED" && latestTest.exitCode === 0;
  const diffs = task.artifacts.filter((a) => a.type === "DIFF");
  const agentRuns = [...task.agentRuns].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const openReviewerRun = (agentRunId: string) => {
    const run = task.agentRuns.find((r) => r.id === agentRunId);
    if (run) onOpenLog({ kind: "agent", run });
  };

  return (
    <section
      aria-labelledby="human-review-title"
      className={cn(
        "overflow-hidden rounded-xl border shadow-lg shadow-black/30",
        pending ? "border-amber-400/50 bg-gradient-to-b from-amber-500/[0.07] to-card ring-1 ring-amber-400/20" : "border-border bg-card",
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", pending ? "bg-amber-400/15 text-amber-300" : "bg-secondary text-muted-foreground")}>
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300/90">Human Review</p>
            <h2 id="human-review-title" className="text-base font-semibold leading-tight">
              {pending ? "Review the evidence, then decide" : approval ? `Decided: ${approval.status}` : "Awaiting an Approval request"}
            </h2>
          </div>
        </div>
        <dl className="flex flex-wrap items-center gap-2 text-xs">
          <Chip label="Pull request" value={task.pullRequestNumber ? `#${task.pullRequestNumber}` : "none"} tone={task.pullRequestNumber ? "ok" : "warn"} />
          <Chip
            label="Tests"
            value={latestTest ? (testPassed ? `${latestTest.passed ?? 0} passed` : `${latestTest.failed ?? "?"} failed`) : "no run"}
            tone={latestTest ? (testPassed ? "ok" : "bad") : "warn"}
          />
          <Chip
            label="Reviews"
            value={`${summary.passed} PASS · ${summary.rejected} REJECT`}
            tone={summary.completed < 4 ? "warn" : summary.rejected > 0 ? "warn" : "ok"}
          />
          <Chip label="Findings" value={summary.serious > 0 ? `${summary.findings} (${summary.serious} serious)` : String(summary.findings)} tone={summary.serious > 0 ? "bad" : summary.findings > 0 ? "warn" : "ok"} />
        </dl>
      </header>

      <div className="grid gap-4 p-4 lg:p-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section
            title="Reviews"
            aside={<span className="text-xs text-muted-foreground">{summary.completed} of 4 · Verdicts are informational</span>}
          >
            <ReviewPanel reviews={task.reviews} agentRuns={task.agentRuns} onOpenRun={openReviewerRun} />
          </Section>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Plan">
              <PlanViewer plan={task.plan} pendingFeedback={task.pendingFeedback} />
            </Section>
            <Section title="Test Run">
              <TestRunResults
                task={task}
                onOpenLog={(artifact, run) => onOpenText(artifact, `Test Run · attempt ${run.attempt}`)}
                onOpenArtifact={onOpenArtifact}
              />
            </Section>
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-4 self-start xl:sticky xl:top-4">
          <Section title="Decision" className={cn(pending && "border-amber-400/40")}>
            {approval ? (
              <ApprovalPanel task={task} approval={approval} defaultBranch={defaultBranch} />
            ) : (
              <p className="text-sm text-muted-foreground">The workflow engine has not requested an Approval yet.</p>
            )}
          </Section>

          <Section title="Change">
            <ul className="flex flex-col gap-2 text-sm">
              <LinkRow icon={GitPullRequest} label="Pull request" href={task.pullRequestUrl} text={task.pullRequestNumber ? `#${task.pullRequestNumber}` : null} pending="Not opened" />
              <LinkRow icon={FileDiff} label="Diff" href={task.pullRequestUrl ? `${task.pullRequestUrl}/files` : null} text={task.pullRequestUrl ? "Files changed" : null} pending="No pull request" />
              <LinkRow icon={GitBranch} label="Branch" href={null} text={task.branchName} pending="No branch" mono />
            </ul>
            {diffs.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {diffs.map((a) => (
                  <Button key={a.id} variant="outline" size="sm" onClick={() => onOpenText(a, "Diff Artifact")} title={a.name}>
                    <FileDiff /> {a.name.split("/").pop()}
                  </Button>
                ))}
              </div>
            )}
          </Section>

          <Section title="Agent Run logs" flush>
            {agentRuns.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No Agent Run yet.</p>
            ) : (
              <ul className="divide-y divide-border/60 text-sm">
                {agentRuns.map((run) => {
                  const log = logArtifactFor(task, { kind: "agent", run });
                  return (
                    <li key={run.id} className="flex items-center gap-3 px-4 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate">
                          {AGENT_LABEL[run.agent]} <span className="text-xs text-muted-foreground">attempt {run.attempt}</span>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {run.startedAt ? formatDateTime(run.startedAt) : "queued"} · {formatDuration(runDuration(run))}
                        </p>
                      </div>
                      <Badge variant={run.status === "COMPLETED" ? "success" : run.status === "RUNNING" || run.status === "QUEUED" ? "info" : "destructive"}>
                        {run.status.replace("_", " ")}
                      </Badge>
                      <Button variant="ghost" size="sm" disabled={!log} onClick={() => onOpenLog({ kind: "agent", run })} aria-label={`Open log of ${AGENT_LABEL[run.agent]} attempt ${run.attempt}`}>
                        <FileText /> Log
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </aside>
      </div>
    </section>
  );
}

function Chip({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "bad" }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-2 py-1",
        tone === "ok" && "border-emerald-500/30 bg-emerald-500/10",
        tone === "warn" && "border-amber-400/30 bg-amber-500/10",
        tone === "bad" && "border-red-500/40 bg-red-500/10",
      )}
    >
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("font-semibold tabular-nums", tone === "ok" && "text-emerald-200", tone === "warn" && "text-amber-200", tone === "bad" && "text-red-200")}>{value}</dd>
    </div>
  );
}

function LinkRow({
  icon: Icon,
  label,
  href,
  text,
  pending,
  mono,
}: {
  icon: typeof GitBranch;
  label: string;
  href: string | null;
  text: string | null;
  pending: string;
  mono?: boolean;
}) {
  return (
    <li className="flex min-w-0 items-center gap-2.5">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
      {text ? (
        href ? (
          <a href={href} target="_blank" rel="noreferrer" className={cn("inline-flex min-w-0 items-center gap-1 text-sky-300 hover:underline", mono && "font-mono text-xs")} title={text}>
            <span className="truncate">{text}</span> <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
          </a>
        ) : (
          <span className={cn("min-w-0 truncate", mono && "font-mono text-xs")} title={text}>
            {text}
          </span>
        )
      ) : (
        <span className="text-xs text-muted-foreground/70">{pending}</span>
      )}
    </li>
  );
}
