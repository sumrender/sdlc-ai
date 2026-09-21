import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, FileDiff, MessageCircleQuestion } from "lucide-react";
import { type Artifact, type TaskDetail } from "@sdlc-ai/shared";
import { ApiRequestError } from "~/lib/api";
import { AgentActivity, runLabel } from "~/components/AgentActivity";
import { ApprovalPanel, DecidedApproval } from "~/components/ApprovalPanel";
import { ArtifactViewer } from "~/components/ArtifactViewer";
import { DeploymentStatus } from "~/components/DeploymentStatus";
import { EventTimeline } from "~/components/EventTimeline";
import { GitHubLinks } from "~/components/GitHubLinks";
import { LogViewer } from "~/components/LogViewer";
import { Markdown } from "~/components/Markdown";
import { PlanViewer } from "~/components/PlanViewer";
import { QuestionDialog } from "~/components/QuestionDialog";
import { ReviewPanel, summarizeReviews } from "~/components/ReviewPanel";
import { RunHistory } from "~/components/RunHistory";
import { Section } from "~/components/Section";
import { StageTimeline, STAGE_LABEL } from "~/components/StageTimeline";
import { StatusBadge } from "~/components/StatusBadge";
import { TaskActions } from "~/components/TaskActions";
import { TestRunResults } from "~/components/TestRunResults";
import { Button } from "~/components/ui/button";
import { useProjectSettings } from "~/lib/settings-query";
import { buildTimeline, formatDateTime, logArtifactFor, type Run } from "~/lib/task-detail";
import { useTaskLive, useTaskQuery } from "~/lib/task-query";

export const Route = createFileRoute("/tasks/$id")({
  component: TaskDetailPage,
});

function TaskDetailPage() {
  const { id } = Route.useParams();
  const query = useTaskQuery(id);
  const live = useTaskLive(id);

  if (query.isPending) return <p className="p-6 text-sm text-muted-foreground">Loading Task…</p>;
  if (query.isError) {
    const deleted = query.error instanceof ApiRequestError && query.error.status === 404;
    return (
      <div className="p-6">
        <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {deleted ? "This Task has been deleted." : `Could not load the Task: ${query.error.message}`}
        </p>
        {deleted && (
          <Link to="/" className="mt-3 inline-flex items-center gap-1 text-sm text-blue-700 hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to the board
          </Link>
        )}
      </div>
    );
  }
  return <TaskDetailView task={query.data} live={live} />;
}

function BackLink() {
  return (
    <Link to="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Kanban
    </Link>
  );
}

interface OpenLog {
  artifact: Artifact;
  subtitle: string;
}

function TaskDetailView({ task, live }: { task: TaskDetail; live: ReturnType<typeof useTaskLive> }) {
  const [openLog, setOpenLog] = useState<OpenLog | null>(null);
  const [openArtifact, setOpenArtifact] = useState<Artifact | null>(null);
  const [questionOpen, setQuestionOpen] = useState(false);
  const settings = useProjectSettings();

  const pendingQuestion = task.questions.find((q) => q.status === "PENDING") ?? null;
  const sortedApprovals = [...task.approvals].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestApproval = sortedApprovals[0] ?? null;
  const pendingApproval = latestApproval?.status === "PENDING" ? latestApproval : null;
  const decidedApprovals = sortedApprovals.filter((a) => a.status !== "PENDING");
  const reviewSummary = summarizeReviews(task.reviews);
  const diffs = task.artifacts.filter((a) => a.type === "DIFF");

  const openRunLog = (run: Run) => {
    const artifact = logArtifactFor(task, run);
    if (artifact) setOpenLog({ artifact, subtitle: `${runLabel(run)} · attempt ${run.run.attempt}` });
  };

  return (
    <div className="flex flex-col gap-3 p-4 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Link to="/" className="hover:text-foreground hover:underline">
              Board
            </Link>
            <span aria-hidden>/</span>
            <span className="max-w-[40ch] truncate font-medium text-foreground">{task.title}</span>
          </nav>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{task.title}</h1>
            <StatusBadge status={task.status} />
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            in {STAGE_LABEL[task.stage]} · Created {formatDateTime(task.createdAt)} · entered {STAGE_LABEL[task.stage]} {formatDateTime(task.stageEnteredAt)}
          </p>
          {task.description && (
            <div className="mt-2 max-w-3xl text-muted-foreground">
              <Markdown text={task.description} />
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {live.streamStatus === "reconnecting" && (
            <span role="status" className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
              Live updates disconnected. Reconnecting…
            </span>
          )}
          <TaskActions task={task} />
        </div>
      </div>

      {task.status === "FAILED" && task.error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {task.error}
        </div>
      )}
      {pendingQuestion && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
          <div className="flex min-w-0 flex-1 items-start gap-2 text-amber-800">
            <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium">The Planner has a Question</p>
              <Markdown text={pendingQuestion.text} className="[&>p]:my-1" />
            </div>
          </div>
          <Button size="sm" onClick={() => setQuestionOpen(true)}>
            Answer
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <div className="flex min-w-max items-center gap-1 border-b border-border bg-secondary/40 px-3 pt-2 text-[13px]">
          <span className="rounded-t-md bg-card px-3 py-1.5 font-medium text-foreground shadow-[inset_0_1px_0_hsl(var(--border)),inset_1px_0_0_hsl(var(--border)),inset_-1px_0_0_hsl(var(--border))]">Overview</span>
          <span className="px-3 py-1.5 text-muted-foreground">Plan</span>
          <span className="px-3 py-1.5 text-muted-foreground">Reviews · {reviewSummary.passed}/{reviewSummary.completed}</span>
          <span className="px-3 py-1.5 text-muted-foreground">Tests</span>
          <span className="px-3 py-1.5 text-muted-foreground">Deployments</span>
          <span className="px-3 py-1.5 text-muted-foreground">Activity</span>
        </div>
        <div className="p-4">
          <StageTimeline entries={buildTimeline(task)} status={task.status} />
        </div>
      </div>

      <Section
        title="Decision"
        aside={pendingApproval ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Awaiting your decision</span> : undefined}
      >
        {pendingApproval ? (
          <div className="flex max-w-2xl flex-col gap-3">
            <ApprovalPanel task={task} approval={pendingApproval} defaultBranch={settings.data?.project.defaultBranch} />
            {decidedApprovals.length > 0 && (
              <div className="flex flex-col gap-2">
                {decidedApprovals.map((a) => (
                  <DecidedApproval key={a.id} approval={a} />
                ))}
              </div>
            )}
          </div>
        ) : decidedApprovals.length > 0 ? (
          <div className="flex max-w-2xl flex-col gap-2">
            {decidedApprovals.map((a) => (
              <DecidedApproval key={a.id} approval={a} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">The workflow engine has not requested an Approval yet. It appears here when the Task reaches HUMAN REVIEW.</p>
        )}
      </Section>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="flex flex-col gap-3 lg:col-span-2">
          <Section title="Agent activity" flush>
            <AgentActivity task={task} activity={live.activity} onOpenLog={openRunLog} />
          </Section>
          <Section
            title="Reviews"
            aside={
              <span className="text-xs text-muted-foreground">
                {reviewSummary.completed} of 4 · {reviewSummary.passed} PASS · {reviewSummary.rejected} REJECT
              </span>
            }
          >
            <ReviewPanel
              reviews={task.reviews}
              agentRuns={task.agentRuns}
              onOpenRun={(agentRunId) => {
                const run = task.agentRuns.find((r) => r.id === agentRunId);
                if (run) openRunLog({ kind: "agent", run });
              }}
            />
          </Section>
          <Section title="Plan">
            <PlanViewer plan={task.plan} pendingFeedback={task.pendingFeedback} />
          </Section>
          <Section title="Test Runs">
            <TestRunResults
              task={task}
              onOpenLog={(artifact, run) => setOpenLog({ artifact, subtitle: `Test Run · attempt ${run.attempt}` })}
              onOpenArtifact={setOpenArtifact}
            />
          </Section>
          <Section title="Deployments">
            <DeploymentStatus deployments={task.deployments} />
          </Section>
        </div>
        <div className="flex flex-col gap-3">
          <Section title="GitHub">
            <GitHubLinks task={task} />
            {diffs.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {diffs.map((a) => (
                  <Button key={a.id} variant="outline" size="sm" onClick={() => setOpenLog({ artifact: a, subtitle: "Diff Artifact" })} title={a.name}>
                    <FileDiff /> {a.name.split("/").pop()}
                  </Button>
                ))}
              </div>
            )}
          </Section>
          <Section title="Runs">
            <RunHistory task={task} onOpenLog={openRunLog} />
          </Section>
          <Section title="Events">
            <EventTimeline events={task.events} />
          </Section>
        </div>
      </div>

      <LogViewer taskId={task.id} artifact={openLog?.artifact ?? null} subtitle={openLog?.subtitle} onClose={() => setOpenLog(null)} />
      <ArtifactViewer taskId={task.id} artifact={openArtifact} onClose={() => setOpenArtifact(null)} />
      {pendingQuestion && (
        <QuestionDialog key={pendingQuestion.id} task={task} question={pendingQuestion} open={questionOpen} onOpenChange={setQuestionOpen} />
      )}
    </div>
  );
}
