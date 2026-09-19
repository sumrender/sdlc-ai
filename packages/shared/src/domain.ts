import { z } from "zod";

export const STAGES = [
  "TODO",
  "PLANNING",
  "DEVELOPMENT",
  "E2E",
  "AGENT_REVIEW",
  "HUMAN_REVIEW",
  "STAGING",
] as const;
export const StageSchema = z.enum(STAGES);
export type Stage = z.infer<typeof StageSchema>;

export const ACTIVE_STAGES = ["PLANNING", "DEVELOPMENT", "E2E", "AGENT_REVIEW", "HUMAN_REVIEW"] as const satisfies readonly Stage[];

export const DEFAULT_MAX_CONCURRENT_TASKS = 3;
export const MAX_CONCURRENT_TASKS_LIMIT = 20;
export const MaxConcurrentTasksSchema = z.number().int().min(1).max(MAX_CONCURRENT_TASKS_LIMIT);
export type MaxConcurrentTasks = z.infer<typeof MaxConcurrentTasksSchema>;

export const TASK_STATUSES = ["READY", "RUNNING", "WAITING", "FAILED", "COMPLETED"] as const;
export const TaskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const REVIEWERS = [
  "REVIEWER_SECURITY",
  "REVIEWER_ARCHITECTURE",
  "REVIEWER_QUALITY",
  "REVIEWER_PERFORMANCE",
] as const;
export const ReviewerSchema = z.enum(REVIEWERS);
export type Reviewer = z.infer<typeof ReviewerSchema>;

export const AGENTS = ["PLANNER", "DEVELOPER", "E2E_TEST_WRITER", ...REVIEWERS] as const;
export const AgentSchema = z.enum(AGENTS);
export type Agent = z.infer<typeof AgentSchema>;

export const RUN_STATUSES = ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "TIMED_OUT", "CANCELLED"] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const QUESTION_STATUSES = ["PENDING", "ANSWERED"] as const;
export const QuestionStatusSchema = z.enum(QUESTION_STATUSES);
export type QuestionStatus = z.infer<typeof QuestionStatusSchema>;

export const VERDICTS = ["PASS", "REJECT"] as const;
export const VerdictSchema = z.enum(VERDICTS);
export type Verdict = z.infer<typeof VerdictSchema>;

export const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
export const SeveritySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof SeveritySchema>;

export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export const ApprovalStatusSchema = z.enum(APPROVAL_STATUSES);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const DEPLOY_TARGETS = ["FE", "BE"] as const;
export const DeployTargetSchema = z.enum(DEPLOY_TARGETS);
export type DeployTarget = z.infer<typeof DeployTargetSchema>;

export const PROVIDERS = ["CLOUDFLARE", "RENDER"] as const;
export const ProviderSchema = z.enum(PROVIDERS);
export type Provider = z.infer<typeof ProviderSchema>;

export const DEPLOYMENT_STATUSES = ["PENDING", "BUILDING", "LIVE", "FAILED", "TIMED_OUT"] as const;
export const DeploymentStatusSchema = z.enum(DEPLOYMENT_STATUSES);
export type DeploymentStatus = z.infer<typeof DeploymentStatusSchema>;

export const ARTIFACT_TYPES = ["LOG", "SCREENSHOT", "VIDEO", "TEST_REPORT", "TRACE", "DIFF"] as const;
export const ArtifactTypeSchema = z.enum(ARTIFACT_TYPES);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const EVENT_TYPES = [
  "TASK_CREATED",
  "TASK_STAGE_CHANGED",
  "TASK_STATUS_CHANGED",
  "AGENT_RUN_STARTED",
  "AGENT_RUN_COMPLETED",
  "AGENT_RUN_FAILED",
  "QUESTION_CREATED",
  "QUESTION_ANSWERED",
  "CHECKS_STARTED",
  "CHECKS_COMPLETED",
  "PR_CREATED",
  "TEST_RUN_STARTED",
  "TEST_RUN_COMPLETED",
  "REVIEW_COMPLETED",
  "APPROVAL_REQUESTED",
  "APPROVAL_DECIDED",
  "MERGED",
  "DEPLOYMENT_UPDATED",
  "TASK_FAILED",
  "TASK_RETRIED",
  "E2E_COVERAGE_DECIDED",
  "PR_COMMENT_POSTED",
] as const;
export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

export const FindingSchema = z.object({
  severity: SeveritySchema,
  message: z.string(),
  file: z.string().optional(),
  line: z.number().int().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const DeployTargetConfigSchema = z.object({
  target: DeployTargetSchema,
  provider: ProviderSchema,
  pathPrefix: z.string(),
  url: z.string().nullable(),
});
export type DeployTargetConfig = z.infer<typeof DeployTargetConfigSchema>;

export const PlannerOutputSchema = z.object({
  plan: z.string().nullable().default(null),
  question: z
    .object({ text: z.string(), options: z.array(z.string()).nullable().default(null) })
    .nullable()
    .default(null),
});
export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

export const ReviewOutputSchema = z.object({
  verdict: VerdictSchema,
  findings: z.array(FindingSchema).default([]),
});
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

const iso = z.string();

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner: z.string(),
  repo: z.string(),
  defaultBranch: z.string(),
  deployTargets: z.array(DeployTargetConfigSchema),
  maxConcurrentTasks: MaxConcurrentTasksSchema.default(DEFAULT_MAX_CONCURRENT_TASKS),
  reuseSandbox: z.boolean().default(true),
  createdAt: iso,
});
export type Project = z.infer<typeof ProjectSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string(),
  stage: StageSchema,
  status: TaskStatusSchema,
  plan: z.string().nullable(),
  issueNumber: z.number().int().nullable(),
  issueUrl: z.string().nullable(),
  branchName: z.string().nullable(),
  pullRequestNumber: z.number().int().nullable(),
  pullRequestUrl: z.string().nullable(),
  mergedCommitSha: z.string().nullable(),
  e2eRejectLoopUsed: z.boolean(),
  e2eCoverageCheckedAt: iso.nullable(),
  e2eGeneratedSpecPath: z.string().nullable(),
  e2eReportCommentUrl: z.string().nullable(),
  e2eReportVideoUrl: z.string().nullable(),
  pendingFeedback: z.string().nullable(),
  error: z.string().nullable(),
  stageEnteredAt: iso,
  createdAt: iso,
  updatedAt: iso,
});
export type Task = z.infer<typeof TaskSchema>;

export const AgentRunSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  agent: AgentSchema,
  status: RunStatusSchema,
  attempt: z.number().int(),
  opencodeSessionId: z.string().nullable(),
  model: z.string(),
  startedAt: iso.nullable(),
  completedAt: iso.nullable(),
  exitCode: z.number().int().nullable(),
  error: z.string().nullable(),
  createdAt: iso,
});
export type AgentRun = z.infer<typeof AgentRunSchema>;

export const TestRunSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  command: z.string(),
  status: RunStatusSchema,
  attempt: z.number().int(),
  exitCode: z.number().int().nullable(),
  passed: z.number().int().nullable(),
  failed: z.number().int().nullable(),
  skipped: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  error: z.string().nullable(),
  coverageChecked: z.boolean().default(false),
  generatedSpecPath: z.string().nullable().default(null),
  startedAt: iso.nullable(),
  completedAt: iso.nullable(),
  createdAt: iso,
});
export type TestRun = z.infer<typeof TestRunSchema>;

export const QuestionSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  agentRunId: z.string(),
  text: z.string(),
  options: z.array(z.string()).nullable(),
  status: QuestionStatusSchema,
  answer: z.string().nullable(),
  createdAt: iso,
  answeredAt: iso.nullable(),
});
export type Question = z.infer<typeof QuestionSchema>;

export const ReviewSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  agentRunId: z.string(),
  reviewer: ReviewerSchema,
  verdict: VerdictSchema,
  findings: z.array(FindingSchema),
  createdAt: iso,
});
export type Review = z.infer<typeof ReviewSchema>;

export const ApprovalSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  status: ApprovalStatusSchema,
  feedback: z.string().nullable(),
  createdAt: iso,
  decidedAt: iso.nullable(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const DeploymentSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  target: DeployTargetSchema,
  provider: ProviderSchema,
  commitSha: z.string(),
  providerRef: z.string().nullable(),
  status: DeploymentStatusSchema,
  url: z.string().nullable(),
  error: z.string().nullable(),
  lastPolledAt: iso.nullable(),
  createdAt: iso,
});
export type Deployment = z.infer<typeof DeploymentSchema>;

export const ArtifactSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  agentRunId: z.string().nullable(),
  testRunId: z.string().nullable(),
  type: ArtifactTypeSchema,
  name: z.string(),
  sizeBytes: z.number().int().nullable(),
  createdAt: iso,
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const EventSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  type: EventTypeSchema,
  payload: z.record(z.unknown()),
  createdAt: iso,
});
export type Event = z.infer<typeof EventSchema>;

export const TaskDetailSchema = TaskSchema.extend({
  agentRuns: z.array(AgentRunSchema),
  testRuns: z.array(TestRunSchema),
  questions: z.array(QuestionSchema),
  reviews: z.array(ReviewSchema),
  approvals: z.array(ApprovalSchema),
  deployments: z.array(DeploymentSchema),
  artifacts: z.array(ArtifactSchema),
  events: z.array(EventSchema),
});
export type TaskDetail = z.infer<typeof TaskDetailSchema>;

export const SseMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), event: EventSchema }),
  z.object({
    kind: z.literal("agent_output"),
    taskId: z.string(),
    agentRunId: z.string().nullable(),
    testRunId: z.string().nullable(),
    line: z.string(),
    at: iso,
  }),
]);
export type SseMessage = z.infer<typeof SseMessageSchema>;
