import type { Task } from "./domain";

export type ActionAvailability = { allowed: true } | { allowed: false; reason: string };

/**
 * Retry re-runs the current Stage's work after a FAILED Status. Shared so the
 * API's refusal and the detail page's disabled button apply the same rule.
 */
export function retryAvailability(task: Pick<Task, "stage" | "status">): ActionAvailability {
  if (task.status !== "FAILED") return { allowed: false, reason: "Only a FAILED Task can be retried." };
  if (task.stage === "TODO") return { allowed: false, reason: "Nothing to retry in TODO." };
  return { allowed: true };
}

/**
 * Send back to Development is the operator's recovery for a Task that FAILED in
 * E2E once its automatic Reject loop is spent: a new Developer run gets the
 * failure output as feedback instead of the Task staying parked.
 */
export function sendBackAvailability(task: Pick<Task, "stage" | "status">): ActionAvailability {
  if (task.stage !== "E2E" || task.status !== "FAILED") {
    return { allowed: false, reason: "Send back is only available for a Task that FAILED in E2E." };
  }
  return { allowed: true };
}
