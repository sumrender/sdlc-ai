import { ReviewOutputSchema, type ReviewOutput, type Reviewer } from "@sdlc-ai/shared";
import { db } from "../db/index.js";
import { reviews, type TaskRow, type TestRunRow } from "../db/schema.js";
import { bus } from "../events/bus.js";
import { loadManifest } from "../integrations/manifest.js";
import { TIMEOUTS } from "../pipeline/deps.js";
import { latestTestRun, tail } from "../pipeline/tasks.js";
import { WORKSPACE } from "../sandbox/docker.js";
import { extractJsonBlock } from "../sandbox/opencode.js";
import { shellQuote } from "../sandbox/process.js";
import { prepareWorkspace } from "../sandbox/workspace.js";
import { AGENT_DEFINITIONS } from "./definitions.js";
import { invokeAgent, type AgentBody } from "./runner.js";

const REASK_PROMPT =
  "Your previous message did not end with a valid fenced JSON block. Reply with ONLY the fenced JSON block of shape " +
  '{ "verdict": "PASS" | "REJECT", "findings": [ { "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO", "message": string, "file"?: string, "line"?: number } ] } and nothing else.';

const FOCUS: Record<Reviewer, string> = {
  REVIEWER_SECURITY: "security",
  REVIEWER_ARCHITECTURE: "architecture",
  REVIEWER_QUALITY: "quality",
  REVIEWER_PERFORMANCE: "performance",
};

export const reviewerBody =
  (reviewer: Reviewer): AgentBody =>
  async (ctx) => {
    const { deps, sandbox, log, task, project } = ctx;
    if (!task.branchName) throw new Error("Task has no branch name");

    const manifest = await loadManifest(deps.github, project.defaultBranch);
    await prepareWorkspace(sandbox, deps.github, { ref: task.branchName, manifest, agents: [reviewer], log });

    const diff = await sandbox.exec(`git diff ${shellQuote(`origin/${project.defaultBranch}`)}...HEAD`, { cwd: WORKSPACE });
    const testRun = await latestTestRun(task.id);

    let result = await invokeAgent(ctx, {
      agentName: AGENT_DEFINITIONS[reviewer].name,
      prompt: reviewerPrompt(reviewer, task, diff.stdout, testRun),
      timeoutMs: TIMEOUTS.REVIEWER,
      label: reviewer,
    });
    let output = parseReviewOutput(result.text);
    if (!output) {
      log("Reviewer output was not a valid JSON block; asking once more");
      result = await invokeAgent(ctx, {
        agentName: AGENT_DEFINITIONS[reviewer].name,
        prompt: REASK_PROMPT,
        sessionId: result.sessionId,
        timeoutMs: TIMEOUTS.REVIEWER,
        label: reviewer,
      });
      output = parseReviewOutput(result.text);
    }

    const review: ReviewOutput = output ?? {
      verdict: "REJECT",
      findings: [{ severity: "CRITICAL", message: "reviewer output invalid" }],
    };
    if (!output) log("Recording REJECT with a CRITICAL finding: reviewer output invalid");

    const [row] = await db
      .insert(reviews)
      .values({ taskId: task.id, agentRunId: ctx.run.id, reviewer, verdict: review.verdict, findings: review.findings, createdAt: new Date() })
      .returning();
    await bus.emit(task.id, "REVIEW_COMPLETED", {
      reviewId: row!.id,
      reviewer,
      verdict: review.verdict,
      findingCount: review.findings.length,
    });
    log(`Verdict: ${review.verdict} with ${review.findings.length} finding(s)`);
  };

function parseReviewOutput(text: string): ReviewOutput | null {
  const json = extractJsonBlock(text);
  if (json === null) return null;
  const parsed = ReviewOutputSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

function reviewerPrompt(reviewer: Reviewer, task: TaskRow, diff: string, testRun: TestRunRow | null): string {
  const tests = testRun
    ? `Status ${testRun.status}, exit code ${testRun.exitCode ?? "n/a"}: ${testRun.passed ?? 0} passed, ${testRun.failed ?? 0} failed, ${testRun.skipped ?? 0} skipped in ${testRun.durationMs ?? 0} ms.`
    : "No Test Run recorded.";
  return `# Task
Title: ${task.title}

${task.description || "(no description)"}

# Plan
${task.plan ?? "(no plan recorded)"}

# Test Run
${tests}

# Diff against the default branch
\`\`\`diff
${tail(diff, 80_000) || "(empty diff)"}
\`\`\`

Review this change strictly for ${FOCUS[reviewer]}. You may read any file in the checked-out branch for context. End your final message with the fenced JSON block described in your instructions.`;
}
