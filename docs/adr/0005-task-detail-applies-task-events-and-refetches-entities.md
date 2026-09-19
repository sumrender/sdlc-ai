# 0005: The Task detail page applies Task-level Events and refetches for entity Events

Date: 2026-09-19
Status: Accepted

## Context

The Task detail page (#6) shows the Task plus every Agent Run, Test Run, Question, Review,
Approval, Deployment, Artifact, and Event. Like the board (ADR 0001) it must update live
from Events over SSE and never poll. Unlike the board, most Events it cares about change a
row that is not the Task: a run finishing, a Review landing, an Artifact being registered.
Those payloads carry ids and a summary, not the full row.

The API also streams ephemeral `AGENT_OUTPUT` lines, which are persisted only inside the
LOG Artifact written when the run ends.

## Decision

- `GET /tasks/:id` returns `TaskDetail` (`@sdlc-ai/shared`): the Task with every related
  collection. The page loads it once with TanStack Query under the key `["task", id]`.
- The page subscribes to `GET /events?taskId=` and appends every Event to the cached
  `events`. Task-level fields are patched from the payload (`TASK_STAGE_CHANGED`,
  `TASK_STATUS_CHANGED`, `TASK_FAILED`, `PR_CREATED`, `DEPLOYMENT_UPDATED`); an
  `AGENT_RUN_STARTED` inserts a stub run so the activity feed has a header immediately.
- Any Event that changes a related row triggers a debounced refetch of the detail, so the
  page shows the persisted row rather than a reconstruction. Refetching on an Event is not
  polling: nothing is fetched without a signal.
- `AGENT_OUTPUT` lines live in component state for the page session only, capped, and are
  shown for the active run(s). The full record is the LOG Artifact, opened in the LogViewer.
- Action endpoints answer with the shape the caller renders: board actions (create, start,
  answer Question, Run Demo) return `BoardTask`; detail actions (retry, send back, decide
  Approval) return `TaskDetail`.
- Retry and Send back availability are `retryAvailability` and `sendBackAvailability` in
  `@sdlc-ai/shared`, used by both the API's refusal and the page's buttons.
- The SSE client listens for the named `event` and `agent_output` frames the API emits;
  browsers do not deliver named frames through `onmessage`.

## Consequences

- Adding an Event type needs no page change: unknown types append to the timeline and
  refetch.
- Output lines are lost on refresh until the run finishes and its LOG Artifact exists;
  this is by design (Events are the record, log lines are Artifact content).
