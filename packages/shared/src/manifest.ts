import { z } from "zod";
import type { Reviewer } from "./domain";

export const IntegrationSchema = z.object({
  name: z.string().min(1),
  /** Free-form notes: credentials, dashboards, mock flags, runbooks. */
  notes: z.string().default(""),
});
export type Integration = z.infer<typeof IntegrationSchema>;

export const UnitTestsSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().default("."),
  env: z.record(z.string()).default({}),
  /** When true, a missing runner/skipped suite is not a failure. */
  optional: z.boolean().default(false),
});
export type UnitTests = z.infer<typeof UnitTestsSchema>;

/**
 * One stack (frontend / backend) of a split project. `paths` are the
 * repository-relative prefixes owned by this stack and drive change-scope
 * detection: a diff touching only one stack's paths skips the other stack's
 * checks, unit tests, and reviewer. Files matching neither stack (repo root,
 * CI config, docs, shared packages) count as shared and run everything.
 */
export const StackManifestSchema = z.object({
  /** Primary folder for the stack, e.g. "fe" or "be". */
  dir: z.string().min(1),
  /** Owned path prefixes. Defaults to [`<dir>/**`] when omitted. */
  paths: z.array(z.string().min(1)).default([]),
  setup: z.array(z.string()).default([]),
  checks: z.array(z.string()).default([]),
  /** Stack unit tests. Null/absent means the stack has no unit suite. */
  unitTests: UnitTestsSchema.nullable().default(null),
  /** Custom integrations owned by this stack (CDN, AI, payments, hosting…). */
  integrations: z.array(IntegrationSchema).default([]),
});
export type StackManifest = z.infer<typeof StackManifestSchema>;

export const E2eSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().default("."),
  env: z.record(z.string()).default({}),
  artifacts: z.array(z.string()).default([]),
  /** When true, e2e may be skipped without failing the task. */
  optional: z.boolean().default(false),
});
export type E2eConfig = z.infer<typeof E2eSchema>;

export const ProjectManifestSchema = z.object({
  version: z.number().int().optional(),
  /** Root-level setup/checks: legacy shared commands, always run. */
  setup: z.array(z.string()).default([]),
  checks: z.array(z.string()).default([]),
  frontend: StackManifestSchema.optional(),
  backend: StackManifestSchema.optional(),
  /** Null/absent means the project has no e2e suite; the E2E gate passes. */
  e2e: E2eSchema.nullable().default(null),
});
export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;

export const MANIFEST_PATH = ".sdlc/manifest.json";

// ---- Change scope -----------------------------------------------------------

export interface ChangeScope {
  frontend: boolean;
  backend: boolean;
  shared: boolean;
}

/** Owned path prefixes for a stack, defaulting to `<dir>/**`. */
export function stackPaths(stack: StackManifest | undefined): string[] {
  if (!stack) return [];
  if (stack.paths.length > 0) return stack.paths;
  return [`${stack.dir.replace(/\/$/, "")}/**`];
}

function matchesPrefix(file: string, pattern: string): boolean {
  const p = pattern.replace(/\/$/, "");
  if (p.endsWith("/**")) {
    const base = p.slice(0, -3);
    return file === base || file.startsWith(`${base}/`);
  }
  if (p.endsWith("/*")) {
    const base = p.slice(0, -2);
    if (file === base) return true;
    const rest = file.startsWith(`${base}/`) ? file.slice(base.length + 1) : null;
    return rest !== null && !rest.includes("/");
  }
  return file === p || file.startsWith(`${p}/`);
}

/**
 * Classify a changed-file list against the manifest's stacks. Empty input
 * (unknown diff) and any shared file both resolve to "run everything".
 */
export function computeChangeScope(changedFiles: string[], manifest: ProjectManifest): ChangeScope {
  if (changedFiles.length === 0) return { frontend: true, backend: true, shared: true };
  const fe = stackPaths(manifest.frontend);
  const be = stackPaths(manifest.backend);
  let frontend = false;
  let backend = false;
  for (const file of changedFiles) {
    const inFe = fe.length > 0 && fe.some((p) => matchesPrefix(file, p));
    const inBe = be.length > 0 && be.some((p) => matchesPrefix(file, p));
    if (inFe) frontend = true;
    if (inBe) backend = true;
    if (!inFe && !inBe) return { frontend: true, backend: true, shared: true };
  }
  return { frontend, backend, shared: false };
}

// ---- Scoped selectors -------------------------------------------------------

/** Reviewer agents required for a scope. Shared/unknown diffs need both. */
export function scopedReviewers(scope: ChangeScope): Reviewer[] {
  const out: Reviewer[] = [];
  if (scope.frontend) out.push("REVIEWER_FRONTEND");
  if (scope.backend) out.push("REVIEWER_BACKEND");
  return out.length > 0 ? out : ["REVIEWER_FRONTEND", "REVIEWER_BACKEND"];
}

/** Build/test checks to enforce for a scope: shared checks always run. */
export function scopedChecks(manifest: ProjectManifest, scope: ChangeScope): string[] {
  const out = [...manifest.checks];
  if (scope.frontend && manifest.frontend) out.push(...manifest.frontend.checks);
  if (scope.backend && manifest.backend) out.push(...manifest.backend.checks);
  return out;
}

/** Unit-test suites to enforce for a scope (stack-owned only). */
export function scopedUnitTests(manifest: ProjectManifest, scope: ChangeScope): UnitTests[] {
  const out: UnitTests[] = [];
  if (scope.frontend && manifest.frontend?.unitTests) out.push(manifest.frontend.unitTests);
  if (scope.backend && manifest.backend?.unitTests) out.push(manifest.backend.unitTests);
  return out;
}

/** Full setup union (root + both stacks). Setup is never scoped: workspaces
 *  prepare before the change set is known, and the Developer may touch both. */
export function fullSetup(manifest: ProjectManifest): string[] {
  return [...manifest.setup, ...(manifest.frontend?.setup ?? []), ...(manifest.backend?.setup ?? [])];
}
