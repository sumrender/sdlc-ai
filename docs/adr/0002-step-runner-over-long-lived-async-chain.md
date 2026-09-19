# 0002: A step-runner (`advance`) instead of a long-lived async chain

Date: 2026-09-19
Status: Accepted

## Context

A Task spends up to an hour moving through seven Stages, waiting on Docker Sandboxes,
GitHub, a human Question, a human Approval, and deploy providers. The obvious shape is one
`async` function per Task that awaits each step in turn. That shape holds every Task's
progress in process memory: an API restart mid-demo loses it, and "resume" becomes a
special code path that has to reconstruct where the chain was.

## Decision

Every Transition happens in `WorkflowService.advance(taskId)`, and nowhere else. `advance`
reads the Task and its latest runs from Postgres, evaluates the current Stage's Gate, and
either starts the next unit of work (a new AgentRun, TestRun, Approval, or poll) or parks
the Task. It holds no continuations. It is invoked on every completion signal — an Agent
Run or Test Run finishing, a Question answered, an Approval decided, a deployment poll
tick, Start, Retry — and on API start for every non-terminal Task.

To make re-evaluation idempotent, each Task records `stageEnteredAt`; a Gate only considers
runs, Reviews, and Approvals created after that timestamp, and runs interrupted by a
restart are marked `CANCELLED`, which the Gates ignore. Calls are serialized per Task with
an in-process promise chain so two signals cannot start the same work twice.

## Consequences

- A restart is a resume: on boot, interrupted runs become `CANCELLED` and `advance` starts
  fresh ones from the same Stage. No Task-specific recovery code exists.
- Retry is just "reset `stageEnteredAt` and call `advance`"; it can never re-enter an
  earlier Stage because the Gate for the current Stage is what gets evaluated.
- Long-running work (agents, test runs) is fire-and-forget from `advance`'s point of view
  and must call `advance` again when it finishes.
- Anything that needs to change a Stage from outside `advance` (a route, an agent) is a
  bug by definition.
