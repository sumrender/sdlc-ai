import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { closableIssue, closablePullRequest, retryAvailability, sendBackAvailability, stopAvailability } from "@sdlc-ai/shared";

const task = (overrides: Partial<{ status: string; stage: string; issueNumber: number | null; pullRequestNumber: number | null; mergedCommitSha: string | null }> = {}) => ({
  status: "RUNNING",
  stage: "DEVELOPMENT",
  issueNumber: 41,
  pullRequestNumber: 120,
  mergedCommitSha: null,
  ...overrides,
});

describe("stopAvailability", () => {
  it("allows a RUNNING task in any active stage", () => {
    assert.deepEqual(stopAvailability(task({ status: "RUNNING", stage: "PLANNING" })), { allowed: true });
    assert.deepEqual(stopAvailability(task({ status: "RUNNING", stage: "E2E" })), { allowed: true });
  });

  it("refuses tasks that are not RUNNING", () => {
    for (const status of ["READY", "WAITING", "FAILED", "COMPLETED"]) {
      const result = stopAvailability(task({ status }));
      assert.equal(result.allowed, false);
      assert.match(result.allowed ? "" : result.reason, /RUNNING/);
    }
  });
});

describe("closableIssue / closablePullRequest", () => {
  it("offers the issue checkbox whenever the task has an issue", () => {
    assert.equal(closableIssue(task()), true);
    assert.equal(closableIssue(task({ issueNumber: null })), false);
  });

  it("offers the PR checkbox for an open PR with no merge yet", () => {
    assert.equal(closablePullRequest(task()), true);
  });

  it("never offers the PR checkbox for an already-merged PR", () => {
    assert.equal(closablePullRequest(task({ mergedCommitSha: "abc123" })), false);
  });

  it("offers nothing when the task has no GitHub refs", () => {
    const t = task({ issueNumber: null, pullRequestNumber: null });
    assert.equal(closableIssue(t), false);
    assert.equal(closablePullRequest(t), false);
  });
});

// Regression guards: the new helpers must not disturb the existing ones.
describe("retryAvailability / sendBackAvailability", () => {
  it("keeps retry restricted to FAILED tasks", () => {
    assert.equal(retryAvailability(task({ status: "FAILED" })).allowed, true);
    assert.equal(retryAvailability(task({ status: "RUNNING" })).allowed, false);
  });

  it("keeps send-back restricted to FAILED-in-E2E tasks", () => {
    assert.equal(sendBackAvailability(task({ status: "FAILED", stage: "E2E" })).allowed, true);
    assert.equal(sendBackAvailability(task({ status: "RUNNING", stage: "E2E" })).allowed, false);
  });
});
