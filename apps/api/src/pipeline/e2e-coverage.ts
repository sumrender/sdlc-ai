import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { tasks, type TaskRow } from "../db/schema.js";
import { bus } from "../events/bus.js";
import { loadManifest } from "../integrations/manifest.js";
import type { Deps } from "./deps.js";
import { getProject } from "./tasks.js";

export interface CoverageResult {
  covered: boolean;
  specPath?: string;
  rationale: string;
}

export type LlmCoverageCheck = (input: {
  title: string;
  description: string;
  plan: string | null;
  changedFiles: string[];
  specFiles: string[];
  e2eCwd: string;
}) => Promise<{ covered: boolean; rationale: string }>;

// A path counts as spec-like when it looks like a test file, lives under
// __tests__, or sits under the manifest's e2e cwd with a spec/test suffix.
export function isSpecLike(path: string, e2eCwd: string): boolean {
  const p = path.toLowerCase();
  if (p.endsWith(".spec.ts") || p.endsWith(".spec.tsx") || p.endsWith(".spec.js") || p.endsWith(".e2e.ts") || p.endsWith(".e2e.js")) return true;
  if (p.includes("__tests__/") || p.endsWith(".test.ts") || p.endsWith(".test.tsx")) return true;
  const cwd = e2eCwd === "." ? "" : `${e2eCwd.toLowerCase().replace(/\/$/, "")}/`;
  if (cwd && p.startsWith(cwd) && (p.includes("spec") || p.includes("e2e") || p.includes("test"))) return true;
  return false;
}

// Heuristic pass: the diff itself adds/touches a spec → covered, no LLM call.
export function heuristicCovered(changedFiles: string[], e2eCwd: string): { covered: boolean; specFiles: string[] } {
  const specFiles = changedFiles.filter((f) => isSpecLike(f, e2eCwd));
  return { covered: specFiles.length > 0, specFiles };
}

const defaultLlmCheck: LlmCoverageCheck = async ({ changedFiles }) => ({
  // Inconclusive heuristics → assume a test is missing so the writer runs once.
  // A full LLM jury can replace this hook later without touching the caller.
  covered: false,
  rationale: `No spec-like path among ${changedFiles.length} changed file(s); defaulting to not-covered.`,
});

// Checked once per E2E stage visit. Persists to tasks columns (per-visit via
// e2eCoverageCheckedAt >= stageEnteredAt) and emits E2E_COVERAGE_DECIDED.
export async function ensureCoverage(deps: Deps, task: TaskRow, llmCheck: LlmCoverageCheck = defaultLlmCheck): Promise<CoverageResult> {
  if (task.e2eCoverageCheckedAt && task.e2eCoverageCheckedAt >= task.stageEnteredAt) {
    return {
      covered: true,
      specPath: task.e2eGeneratedSpecPath ?? undefined,
      rationale: "Coverage already decided for this E2E visit.",
    };
  }
  const project = await getProject();
  const manifest = await loadManifest(deps.github, project.defaultBranch);
  if (!manifest.e2e) {
    return { covered: true, rationale: "No e2e suite configured in the manifest; coverage not required." };
  }
  const changedFiles = task.pullRequestNumber ? await deps.github.getChangedFiles(task.pullRequestNumber) : [];
  const { covered, specFiles } = heuristicCovered(changedFiles, manifest.e2e.cwd);

  let result: CoverageResult;
  if (covered) {
    result = { covered: true, rationale: `Diff touches spec(s): ${specFiles.join(", ")}` };
  } else {
    const llm = await llmCheck({
      title: task.title,
      description: task.description,
      plan: task.plan,
      changedFiles,
      specFiles,
      e2eCwd: manifest.e2e.cwd,
    });
    result = llm.covered
      ? { covered: true, rationale: llm.rationale }
      : { covered: false, rationale: llm.rationale };
  }

  await db
    .update(tasks)
    .set({ e2eCoverageCheckedAt: new Date(), e2eGeneratedSpecPath: result.specPath ?? null, updatedAt: new Date() })
    .where(eq(tasks.id, task.id));
  await bus.emit(task.id, "E2E_COVERAGE_DECIDED", {
    covered: result.covered,
    generatedSpecPath: result.specPath ?? null,
    rationale: result.rationale,
  });
  return result;
}
