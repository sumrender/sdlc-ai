import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, MessageCircleQuestion } from "lucide-react";
import { REVIEWERS, type Artifact, type TaskDetail } from "@sdlc-ai/shared";
import { AgentActivity, runLabel } from "~/components/AgentActivity";
import { DecidedApproval } from "~/components/ApprovalPanel";
import { ArtifactViewer } from "~/components/ArtifactViewer";
import { DeploymentStatus } from "~/components/DeploymentStatus";
import { EventTimeline } from "~/components/EventTimeline";
import { GitHubLinks } from "~/components/GitHubLinks";
import { HumanReview } from "~/components/HumanReview";
import { LogViewer } from "~/components/LogViewer";
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
    return (
      <div className="p-6">
        <BackLink />
        <p role="alert" className="mt-4 text-sm text-red-300">
          Could not load the Task: {query.error.message}
        </p>
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
  const showDeployments = task.stage === "STAGING" || task.deployments.length > 0;
  const humanReview = task.stage === "HUMAN_REVIEW";
  const reviewerRuns = task.agentRuns.filter((r) => (REVIEWERS as readonly string[]).includes(r.agent));
  const showReviews = !humanReview && (task.reviews.length > 0 || reviewerRuns.length > 0);
  const decidedApprovals = humanReview ? [] : task.approvals.filter((a) => a.status !== "PENDING").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const reviewSummary = summarizeReviews(task.reviews);

  const openRunLog = (run: Run) => {
    const artifact = logArtifactFor(task, run);
    if (artifact) setOpenLog({ artifact, subtitle: `${runLabel(run)} · attempt ${run.run.attempt}` });
  };

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <BackLink />
          {live.streamStatus === "reconnecting" && (
            <span role="status" className="text-xs text-amber-300">
              Live updates disconnected. Reconnecting…
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold leading-tight">{task.title}</h1>
              <StatusBadge status={task.status} />
              <span className="text-xs text-muted-foreground">in {STAGE_LABEL[task.stage]}</span>
            </div>
            {task.description && <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">{task.description}</p>}
            <p className="mt-1.5 text-xs text-muted-foreground/70">
              Created {formatDateTime(task.createdAt)} · entered {STAGE_LABEL[task.stage]} {formatDateTime(task.stageEnteredAt)}
            </p>
          </div>
          <TaskActions task={task} />
        </div>

        {task.status === "FAILED" && task.error && (
          <div role="alert" className="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-red-200">
            {task.error}
          </div>
        )}
        {pendingQuestion && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-400/60 bg-amber-500/10 px-3 py-2 text-sm">
            <p className="flex items-center gap-2 text-amber-200">
              <MessageCircleQuestion className="h-4 w-4 shrink-0" aria-hidden />
              <span>
                The Planner has a Question: <span className="text-foreground">{pendingQuestion.text}</span>
              </span>
            </p>
            <Button size="sm" onClick={() => setQuestionOpen(true)}>
              Answer
            </Button>
          </div>
        )}
      </header>

      <Section title="Stage timeline">
        <StageTimeline entries={buildTimeline(task)} status={task.status} />
      </Section>

      {humanReview && (
        <HumanReview
          task={task}
          onOpenLog={openRunLog}
          onOpenText={(artifact, subtitle) => setOpenLog({ artifact, subtitle })}
          onOpenArtifact={setOpenArtifact}
          defaultBranch={settings.data?.project.defaultBranch}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Section title="Agent activity" flush>
            <AgentActivity task={task} activity={live.activity} onOpenLog={openRunLog} />
          </Section>
          {showReviews && (
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
          )}
          {!humanReview && (
            <>
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
            </>
          )}
          {showDeployments && (
            <Section title="Deployments">
              <DeploymentStatus deployments={task.deployments} />
            </Section>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <Section title="GitHub">
            <GitHubLinks task={task} />
          </Section>
          {decidedApprovals.length > 0 && (
            <Section title="Approval">
              <div className="flex flex-col gap-2">
                {decidedApprovals.map((a) => (
                  <DecidedApproval key={a.id} approval={a} />
                ))}
              </div>
            </Section>
          )}
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
