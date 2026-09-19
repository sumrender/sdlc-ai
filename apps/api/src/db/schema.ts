import { boolean, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import {
  AGENTS,
  APPROVAL_STATUSES,
  ARTIFACT_TYPES,
  DEPLOYMENT_STATUSES,
  DEPLOY_TARGETS,
  EVENT_TYPES,
  PROVIDERS,
  QUESTION_STATUSES,
  REVIEWERS,
  RUN_STATUSES,
  STAGES,
  TASK_STATUSES,
  VERDICTS,
  type DeployTargetConfig,
  type Finding,
} from "@sdlc-ai/shared";

export const stageEnum = pgEnum("stage", STAGES);
export const taskStatusEnum = pgEnum("task_status", TASK_STATUSES);
export const agentEnum = pgEnum("agent", AGENTS);
export const reviewerEnum = pgEnum("reviewer", REVIEWERS);
export const runStatusEnum = pgEnum("run_status", RUN_STATUSES);
export const questionStatusEnum = pgEnum("question_status", QUESTION_STATUSES);
export const verdictEnum = pgEnum("verdict", VERDICTS);
export const approvalStatusEnum = pgEnum("approval_status", APPROVAL_STATUSES);
export const deployTargetEnum = pgEnum("deploy_target", DEPLOY_TARGETS);
export const providerEnum = pgEnum("provider", PROVIDERS);
export const deploymentStatusEnum = pgEnum("deployment_status", DEPLOYMENT_STATUSES);
export const artifactTypeEnum = pgEnum("artifact_type", ARTIFACT_TYPES);
export const eventTypeEnum = pgEnum("event_type", EVENT_TYPES);

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  owner: text("owner").notNull(),
  repo: text("repo").notNull(),
  defaultBranch: text("default_branch").notNull().default("main"),
  deployTargets: jsonb("deploy_targets").$type<DeployTargetConfig[]>().notNull().default([]),
  maxConcurrentTasks: integer("max_concurrent_tasks").notNull().default(3),
  reuseSandbox: boolean("reuse_sandbox").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  stage: stageEnum("stage").notNull().default("TODO"),
  status: taskStatusEnum("status").notNull().default("READY"),
  plan: text("plan"),
  issueNumber: integer("issue_number"),
  issueUrl: text("issue_url"),
  branchName: text("branch_name"),
  pullRequestNumber: integer("pull_request_number"),
  pullRequestUrl: text("pull_request_url"),
  mergedCommitSha: text("merged_commit_sha"),
  e2eRejectLoopUsed: boolean("e2e_reject_loop_used").notNull().default(false),
  e2eCoverageCheckedAt: ts("e2e_coverage_checked_at"),
  e2eGeneratedSpecPath: text("e2e_generated_spec_path"),
  e2eReportCommentUrl: text("e2e_report_comment_url"),
  e2eReportVideoUrl: text("e2e_report_video_url"),
  pendingFeedback: text("pending_feedback"),
  error: text("error"),
  stageEnteredAt: ts("stage_entered_at").notNull().defaultNow(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  agent: agentEnum("agent").notNull(),
  status: runStatusEnum("status").notNull().default("QUEUED"),
  attempt: integer("attempt").notNull().default(1),
  opencodeSessionId: text("opencode_session_id"),
  model: text("model").notNull(),
  startedAt: ts("started_at"),
  completedAt: ts("completed_at"),
  exitCode: integer("exit_code"),
  error: text("error"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const testRuns = pgTable("test_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  command: text("command").notNull().default(""),
  status: runStatusEnum("status").notNull().default("QUEUED"),
  attempt: integer("attempt").notNull().default(1),
  exitCode: integer("exit_code"),
  passed: integer("passed"),
  failed: integer("failed"),
  skipped: integer("skipped"),
  durationMs: integer("duration_ms"),
  output: text("output"),
  error: text("error"),
  coverageChecked: boolean("coverage_checked").notNull().default(false),
  generatedSpecPath: text("generated_spec_path"),
  startedAt: ts("started_at"),
  completedAt: ts("completed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const questions = pgTable("questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  agentRunId: uuid("agent_run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  options: jsonb("options").$type<string[]>(),
  status: questionStatusEnum("status").notNull().default("PENDING"),
  answer: text("answer"),
  createdAt: ts("created_at").notNull().defaultNow(),
  answeredAt: ts("answered_at"),
});

export const reviews = pgTable("reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  agentRunId: uuid("agent_run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  reviewer: reviewerEnum("reviewer").notNull(),
  verdict: verdictEnum("verdict").notNull(),
  findings: jsonb("findings").$type<Finding[]>().notNull().default([]),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  status: approvalStatusEnum("status").notNull().default("PENDING"),
  feedback: text("feedback"),
  createdAt: ts("created_at").notNull().defaultNow(),
  decidedAt: ts("decided_at"),
});

export const deployments = pgTable("deployments", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  target: deployTargetEnum("target").notNull(),
  provider: providerEnum("provider").notNull(),
  commitSha: text("commit_sha").notNull(),
  providerRef: text("provider_ref"),
  status: deploymentStatusEnum("status").notNull().default("PENDING"),
  url: text("url"),
  error: text("error"),
  lastPolledAt: ts("last_polled_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const artifacts = pgTable("artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  agentRunId: uuid("agent_run_id").references(() => agentRuns.id, { onDelete: "cascade" }),
  testRunId: uuid("test_run_id").references(() => testRuns.id, { onDelete: "cascade" }),
  type: artifactTypeEnum("type").notNull(),
  name: text("name").notNull(),
  storagePath: text("storage_path").notNull(),
  sizeBytes: integer("size_bytes"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  type: eventTypeEnum("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type ProjectRow = typeof projects.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type AgentRunRow = typeof agentRuns.$inferSelect;
export type TestRunRow = typeof testRuns.$inferSelect;
export type QuestionRow = typeof questions.$inferSelect;
export type ReviewRow = typeof reviews.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;
export type DeploymentRow = typeof deployments.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;
export type EventRow = typeof events.$inferSelect;
