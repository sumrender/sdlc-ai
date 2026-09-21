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
 * Stop cancels every live Agent Run and Test Run of a RUNNING Task and parks it
 * in FAILED with "Stopped by operator". The existing Retry then restarts the
 * Stage from scratch — the gates ignore CANCELLED runs and launch fresh ones.
 * Shared so the API's refusal and the detail page's Stop button apply the same
 * rule.
 */
export function stopAvailability(task: Pick<Task, "status">): ActionAvailability {
  if (task.status !== "RUNNING") return { allowed: false, reason: "Only a RUNNING Task can be stopped." };
  return { allowed: true };
}

/**
 * Delete removes the Task and every row that hangs off it, after stopping any
 * live runs first (delete implies stop). Optional flags let the operator close
 * the GitHub issue and/or the pull request as part of the deletion — but a PR
 * that was already merged must never be closed. Shared so the API's refusal and
 * the delete dialog's checkboxes apply the same rule.
 */
export type ClosableRefs = Pick<Task, "issueNumber" | "pullRequestNumber" | "mergedCommitSha">;

export function closableIssue(task: ClosableRefs): boolean {
  return task.issueNumber != null;
}

/** A merged PR is already closed on GitHub; offering the checkbox would lie. */
export function closablePullRequest(task: ClosableRefs): boolean {
  return task.pullRequestNumber != null && !task.mergedCommitSha;
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
