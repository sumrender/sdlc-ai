import { eq } from "drizzle-orm";
import type { DeployTargetConfig } from "@sdlc-ai/shared";
import { db } from "../db/index.js";
import { deployments, type DeploymentRow, type TaskRow } from "../db/schema.js";
import { errorMessage } from "../errors.js";
import { bus } from "../events/bus.js";
import type { Deps } from "./deps.js";

const MIN_POLL_INTERVAL_MS = 4_000;

export function computeTouchedTargets(changedFiles: string[], targets: DeployTargetConfig[]): DeployTargetConfig[] {
  const touched = targets.filter((t) => changedFiles.some((f) => f.startsWith(t.pathPrefix)));
  return touched.length > 0 ? touched : targets;
}

export const isTerminalDeployment = (d: DeploymentRow) => d.status === "LIVE" || d.status === "FAILED" || d.status === "TIMED_OUT";

export async function pollDeployments(deps: Deps, task: TaskRow): Promise<DeploymentRow[]> {
  const rows = await db.select().from(deployments).where(eq(deployments.taskId, task.id));
  const now = new Date();

  for (const d of rows) {
    if (isTerminalDeployment(d)) continue;
    if (d.lastPolledAt && now.getTime() - d.lastPolledAt.getTime() < MIN_POLL_INTERVAL_MS) continue;

    const provider = deps.deployProviders[d.provider];
    if (!provider) {
      if (d.error !== "provider not configured") {
        await db.update(deployments).set({ error: "provider not configured", lastPolledAt: now }).where(eq(deployments.id, d.id));
      }
      continue;
    }

    try {
      const lookup = await provider.getDeployment(d.commitSha);
      await db
        .update(deployments)
        .set({
          status: lookup.status,
          url: lookup.url ?? d.url,
          providerRef: lookup.providerRef ?? d.providerRef,
          error: lookup.error ?? null,
          lastPolledAt: now,
        })
        .where(eq(deployments.id, d.id));
      if (lookup.status !== d.status) {
        await bus.emit(task.id, "DEPLOYMENT_UPDATED", {
          deploymentId: d.id,
          target: d.target,
          provider: d.provider,
          from: d.status,
          to: lookup.status,
          url: lookup.url ?? d.url,
        });
      }
    } catch (e) {
      await db.update(deployments).set({ error: errorMessage(e), lastPolledAt: now }).where(eq(deployments.id, d.id));
    }
  }

  return db.select().from(deployments).where(eq(deployments.taskId, task.id));
}
