import {
  buildProjectRow,
  defineProject,
  deployOverlapWarnings,
  toProjectManifest,
  type ProjectConfig,
  type ProjectRowValues,
} from "@sdlc-ai/shared";
import { loadLocalConfig } from "./config-loader.js";

/** Env fields the projects row is built from (full Env is a superset). */
export interface ProjectRowEnvInput {
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_DEFAULT_BRANCH: string;
  FE_ORIGIN?: string | null;
  BE_ORIGIN?: string | null;
}

/** Env-only fallback when sdlc.config.ts is missing or invalid (deploy targets from env origins, empty stacks). */
function fallbackConfig(env: ProjectRowEnvInput): ProjectConfig {
  return defineProject({
    repository: { owner: env.GITHUB_OWNER, repo: env.GITHUB_REPO, defaultBranch: env.GITHUB_DEFAULT_BRANCH },
    deploy: [
      { target: "FE", provider: "CLOUDFLARE", pathPrefix: "fe/", url: env.FE_ORIGIN ?? null },
      { target: "BE", provider: "RENDER", pathPrefix: "be/", url: env.BE_ORIGIN ?? null },
    ],
  });
}

/**
 * The one way to build the projects row: local sdlc.config.ts, env-derived
 * fallback otherwise. Warns (never throws) when a deploy
 * pathPrefix overlaps no stack paths.
 */
export async function loadProjectRow(env: ProjectRowEnvInput): Promise<ProjectRowValues> {
  const origins = { FE_ORIGIN: env.FE_ORIGIN, BE_ORIGIN: env.BE_ORIGIN };
  const read = await loadLocalConfig();
  if (read.ok) {
    const row = buildProjectRow(read.config, origins);
    for (const w of deployOverlapWarnings(row.deployTargets, read.manifest)) console.warn(`[config] ${w}`);
    return row;
  }
  console.warn(`[api] local config unavailable (${read.error}); seeding project from env`);
  const config = fallbackConfig(env);
  return buildProjectRow(config, origins);
}

/** Overlap warnings for an already-loaded config (boot log without a row build). */
export function warnDeployOverlap(config: ProjectConfig): string[] {
  const warnings = deployOverlapWarnings(buildProjectRow(config).deployTargets, toProjectManifest(config));
  for (const w of warnings) console.warn(`[config] ${w}`);
  return warnings;
}
