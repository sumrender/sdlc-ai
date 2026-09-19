# 0003: Gates check completion; Verdicts are informational; only a human blocks

Date: 2026-09-19
Status: Accepted

## Context

Four Reviewer Agents each return a Verdict (`PASS` or `REJECT`) with structured Findings.
The natural design is to let a `REJECT` bounce the Task back to Development automatically,
possibly weighted by Finding severity. That makes the agents the arbiters of what ships,
hides the disagreement from the operator, and risks unbounded review loops on flaky or
over-cautious reviewers.

## Decision

Every Gate in the pipeline checks that work *completed*, not that it *passed judgement*:

- AGENT_REVIEW → HUMAN_REVIEW requires four recorded Reviews. Their Verdicts do not affect
  the Transition; a `REJECT` is rendered as a red row for the human, nothing more.
- HUMAN_REVIEW → STAGING requires an `APPROVED` Approval. Approvals are created only by
  `advance` when the Task enters HUMAN_REVIEW and decided only through the human-facing
  endpoint; no agent code path can create or decide one.
- The two automatic loops that do exist are bounded and mechanical, not judgement-based:
  one Checks fix iteration inside a Developer run, and one E2E Reject loop per Task.

An unparseable Reviewer output is recorded as a `REJECT` with one `CRITICAL` Finding
("reviewer output invalid") so a flaky reviewer surfaces as visible evidence rather than a
stuck card.

## Consequences

- The human is the only blocking decision in the pipeline, exactly at HUMAN_REVIEW.
- Reviewer prompt quality affects the evidence shown, never the pipeline's progress.
- Severity-based auto-bounce is explicitly out of scope and would need a new ADR.
