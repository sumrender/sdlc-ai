import type { Provider } from "@sdlc-ai/shared";
import type { ArtifactStore } from "../artifacts/store.js";
import type { DeployProvider, GitHubService, SandboxRunner } from "../ports.js";

export interface Deps {
  sandboxes: SandboxRunner;
  github: GitHubService;
  deployProviders: Partial<Record<Provider, DeployProvider>>;
  artifacts: ArtifactStore;
  advance: (taskId: string) => Promise<void>;
}

export const TIMEOUTS = {
  PLANNER: 5 * 60_000,
  DEVELOPER: 25 * 60_000,
  CHECKS: 10 * 60_000,
  TEST_RUN: 10 * 60_000,
  REVIEWER: 5 * 60_000,
  DEPLOYMENT: 15 * 60_000,
  // Workspace setup now includes manifest-owned toolchain installs (e.g. dotnet
  // via apt on a cold container), so the budget covers apt + project deps.
  WORKSPACE: 20 * 60_000,
} as const;
