# 0001: The board reads enriched Tasks and applies Events to its cache

Date: 2026-09-19
Status: Accepted

## Context

The Kanban needs three facts per card that do not live on the Task entity: the Agent
currently running, and the pending Question or Approval a WAITING card is blocked on.
It also has to move cards between columns as Events arrive over SSE, without polling
(see the Event definition in `CONTEXT.md`).

The frontend (#4) and backend (#3) tickets are built in parallel, so the shape of the
list response and of the Event payloads the board consumes must be agreed up front.

## Decision

- The list Tasks endpoint returns `BoardTask[]`: the Task plus `activeAgent`,
  `pendingQuestion`, and `pendingApprovalId`. The schema lives in `@sdlc-ai/shared`.
- REST and SSE paths are constants in `API_PATHS` in `@sdlc-ai/shared`.
- The rule "Start is refused while another Task is between PLANNING and HUMAN_REVIEW"
  is `findBlockingTask` in `@sdlc-ai/shared`, used by both the API and the board.
- The board applies the payloads of `TASK_CREATED`, `TASK_STAGE_CHANGED`,
  `TASK_STATUS_CHANGED`, `AGENT_RUN_STARTED`, `AGENT_RUN_COMPLETED`, `AGENT_RUN_FAILED`,
  `QUESTION_CREATED`, `QUESTION_ANSWERED`, `APPROVAL_REQUESTED`, and `APPROVAL_DECIDED`
  directly to the TanStack Query cache. Their payload schemas are in `@sdlc-ai/shared`.
  Any other Event, and any Event whose payload fails validation, triggers a refetch of
  the list instead.
- On every SSE reconnect the board refetches the list to reconcile whatever it missed.

## Consequences

- The backend must emit those payload shapes; the schemas are the contract.
- Card movement can animate from the Event alone, before any refetch completes.
- The board never derives state by polling; refetches happen only on reconnect or on
  an Event it cannot apply.
