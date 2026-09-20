import { eq } from "drizzle-orm";
import { e2eSpecDir, type E2eConfig } from "@sdlc-ai/shared";
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

// Suffixes Playwright's default `testMatch` picks up. `.test.ts`/`.test.tsx`
// and `__tests__/` are deliberately absent: those are unit-test conventions,
// and treating them as e2e coverage is what let an Angular/Karma unit spec
// (fe/src/app/.../api-docs.component.spec.ts) green-light the E2E gate.
const PLAYWRIGHT_SPEC_SUFFIXES = [".spec.ts", ".spec.tsx", ".spec.js", ".spec.mjs", ".e2e.ts", ".e2e.js"];

// A changed path counts as e2e coverage only when Playwright would actually
// run it: inside the resolved `<cwd>/<testDir>` AND carrying a spec suffix. A
// helper or fixture under the same directory is support code, not coverage.
// Matching is case-insensitive because GitHub reports paths verbatim while
// manifests are hand-written.
export function isSpecLike(path: string, e2e: Pick<E2eConfig, "cwd" | "testDir">): boolean {
  const p = path.toLowerCase();
  const specDir = e2eSpecDir(e2e).toLowerCase();
  if (specDir && !p.startsWith(`${specDir}/`)) return false;
  return PLAYWRIGHT_SPEC_SUFFIXES.some((suffix) => p.endsWith(suffix));
}

// Heuristic pass: the diff itself adds/touches a spec → covered, no LLM call.
export function heuristicCovered(changedFiles: string[], e2e: Pick<E2eConfig, "cwd" | "testDir">): { covered: boolean; specFiles: string[] } {
  const specFiles = changedFiles.filter((f) => isSpecLike(f, e2e));
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
  const { covered, specFiles } = heuristicCovered(changedFiles, manifest.e2e);

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
