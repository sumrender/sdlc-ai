import { PlannerOutputSchema, type PlannerOutput } from "@sdlc-ai/shared";
import { db } from "../db/index.js";
import { questions, type QuestionRow, type TaskRow } from "../db/schema.js";
import { AgentOutputError } from "../errors.js";
import { bus } from "../events/bus.js";
import { loadManifest } from "../integrations/manifest.js";
import { TIMEOUTS } from "../pipeline/deps.js";
import { answeredQuestion, getAgentRun, getTask, setStatus, updateTask } from "../pipeline/tasks.js";
import { extractJsonBlock } from "../sandbox/opencode.js";
import { prepareWorkspace, prepareWorkspaceReuse } from "../sandbox/workspace.js";
import { AGENT_DEFINITIONS } from "./definitions.js";
import { invokeAgent, type AgentBody } from "./runner.js";

const REASK_PROMPT =
  "Your previous message did not end with a valid fenced JSON block. Reply with ONLY the fenced JSON block of shape " +
  '{ "plan": string | null, "question": { "text": string, "options": string[] | null } | null } and nothing else.';

export const plannerBody: AgentBody = async (ctx) => {
  const { deps, sandbox, log, task, project } = ctx;

  const manifest = await loadManifest(deps.github, project.defaultBranch);
  if ((project as { reuseSandbox?: boolean }).reuseSandbox) {
    await prepareWorkspaceReuse(sandbox, deps.github, { ref: project.defaultBranch, manifest, agents: ["PLANNER"], log });
  } else {
    await prepareWorkspace(sandbox, deps.github, { ref: project.defaultBranch, manifest, agents: ["PLANNER"], log });
  }

  const answered = await answeredQuestion(task.id, task.stageEnteredAt);
  const previousSession = answered ? ((await getAgentRun(answered.agentRunId))?.opencodeSessionId ?? null) : null;

  let result = await invokeAgent(ctx, {
    agentName: AGENT_DEFINITIONS.PLANNER.name,
    prompt: plannerPrompt(task, answered),
    sessionId: previousSession,
    timeoutMs: TIMEOUTS.PLANNER,
    label: "Planner",
  });
  let output = parsePlannerOutput(result.text);
  if (!output) {
    log("Planner output was not a valid JSON block; asking once more");
    result = await invokeAgent(ctx, {
      agentName: AGENT_DEFINITIONS.PLANNER.name,
      prompt: REASK_PROMPT,
      sessionId: result.sessionId,
      timeoutMs: TIMEOUTS.PLANNER,
      label: "Planner",
    });
    output = parsePlannerOutput(result.text);
    if (!output) throw new AgentOutputError("Planner did not return a valid JSON block after one re-ask");
  }

  if (output.question && !answered) {
    const [question] = await db
      .insert(questions)
      .values({
        taskId: task.id,
        agentRunId: ctx.run.id,
        text: output.question.text,
        options: output.question.options,
        createdAt: new Date(),
      })
      .returning();
    await bus.emit(task.id, "QUESTION_CREATED", { question: question! });
    const fresh = await getTask(task.id);
    if (fresh) await setStatus(fresh, "WAITING", { agent: "PLANNER", questionId: question!.id });
    log(`Question for operator: ${question!.text}`);
    return;
  }

  const plan = output.plan?.trim();
  if (!plan) throw new AgentOutputError("Planner returned neither a plan nor a question");
  await updateTask(task.id, { plan });
  log("Plan stored");
};

function parsePlannerOutput(text: string): PlannerOutput | null {
  const json = extractJsonBlock(text);
  if (json === null) return null;
  const parsed = PlannerOutputSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

function plannerPrompt(task: TaskRow, answered: QuestionRow | null): string {
  const clarification = answered
    ? `
# Clarification
You previously asked the operator: "${answered.text}"
The operator answered: "${answered.answer}"
Do not ask another question. Produce the plan now.
`
    : `
You may ask the operator at most ONE clarifying question, and only if the task is genuinely ambiguous. Otherwise set "question" to null and produce the plan.
`;
  return `# Task
Title: ${task.title}

${task.description || "(no description)"}
${clarification}
# Instructions
Explore this repository read-only and produce an implementation Plan for a Developer agent: the files to change, the concrete changes in order, and how to verify them. Respect the repository's own agent guidelines if present.
End your final message with the fenced JSON block described in your instructions.`;
}
