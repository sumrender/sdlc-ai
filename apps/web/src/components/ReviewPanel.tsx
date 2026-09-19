import { Boxes, Gauge, Loader2, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";
import { REVIEWERS, SEVERITIES, type AgentRun, type Finding, type Review, type Reviewer, type Severity } from "@sdlc-ai/shared";
import { Badge } from "~/components/ui/badge";
import { formatTime } from "~/lib/task-detail";
import { cn } from "~/lib/utils";

export const REVIEWER_LABEL: Record<Reviewer, string> = {
  REVIEWER_SECURITY: "Security",
  REVIEWER_ARCHITECTURE: "Architecture",
  REVIEWER_QUALITY: "Quality",
  REVIEWER_PERFORMANCE: "Performance",
};

const REVIEWER_ICON: Record<Reviewer, LucideIcon> = {
  REVIEWER_SECURITY: ShieldCheck,
  REVIEWER_ARCHITECTURE: Boxes,
  REVIEWER_QUALITY: Sparkles,
  REVIEWER_PERFORMANCE: Gauge,
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
}

/** Four ReviewCards, one per Reviewer, each with its Verdict and Findings. */
export function ReviewPanel({ reviews, agentRuns, onOpenRun }: ReviewPanelProps) {
  const latest = latestReviews(reviews);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {REVIEWERS.map((reviewer) => {
        const review = latest.find((r) => r.reviewer === reviewer) ?? null;
        const run = [...agentRuns].filter((r) => r.agent === reviewer).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
        return <ReviewCard key={reviewer} reviewer={reviewer} review={review} run={run} onOpenRun={onOpenRun} />;
      })}
    </div>
  );
}

interface ReviewCardProps {
  reviewer: Reviewer;
  review: Review | null;
  run: AgentRun | null;
  onOpenRun?: (agentRunId: string) => void;
}

function ReviewCard({ reviewer, review, run, onOpenRun }: ReviewCardProps) {
  const Icon = REVIEWER_ICON[reviewer];
  const rejected = review?.verdict === "REJECT";
  const running = !review && (run?.status === "RUNNING" || run?.status === "QUEUED");
  const failed = !review && run !== null && (run.status === "FAILED" || run.status === "TIMED_OUT");
  const findings = review ? sortFindings(review.findings) : [];

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
        </div>
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
      </header>

      {rejected && (
        <p className="border-t border-amber-200 bg-amber-50 px-3.5 py-1.5 text-[11px] text-amber-800">
          Informational. A REJECT does not block the Task; your Approval decides.
        </p>
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

function FindingRow({ finding }: { finding: Finding }) {
  const location = finding.file ? `${finding.file}${finding.line !== undefined ? `:${finding.line}` : ""}` : null;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-3.5 py-2.5">
      <span className={cn("mt-0.5 inline-flex h-5 items-center rounded border px-1.5 text-[10px] font-semibold uppercase tracking-wide", SEVERITY_CLASS[finding.severity])}>
        {finding.severity}
      </span>
      <div className="min-w-0">
        <p className="text-sm leading-snug">{finding.message}</p>
        {location && (
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={location}>
            {location}
          </p>
        )}
      </div>
    </li>
  );
}
