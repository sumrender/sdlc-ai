# 0004: Two-shot `opencode run` instead of OpenCode server mode

Date: 2026-09-19
Status: Accepted

## Context

The Planner may ask the operator one Question and must continue from the answer. OpenCode
offers a server mode with a persistent session that could hold the conversation open while
the human replies. Holding a Sandbox and an OpenCode process alive across an unbounded
human wait ties infrastructure to human latency, breaks the step-runner model (ADR-0002),
and leaves a hung process if the API restarts.

## Decision

Agents are invoked as one-shot processes:
`opencode run --format json --agent <name> --model anthropic/<id>` with the prompt on
stdin, inside a fresh Sandbox per Agent Run. Waiting on a human is a Task Status
(`WAITING`), never an Agent Run state: a Planner run that asks a Question *completes*, the
Task parks, and the answer starts a second run in a new Sandbox that passes
`--session <id>` to resume the same OpenCode session. Session storage is a per-Task Docker
volume mounted only into Planner Sandboxes so the second shot can find the first shot's
session; the follow-up prompt also restates the Question and answer, so it still produces a
valid Plan if the session cannot be resumed. Every other agent runs on isolated storage:
OpenCode's store is SQLite, and concurrent Sandboxes sharing one volume fail with
"database is locked" (seen with the four parallel Reviewers). The same pattern gives the Developer one Checks fix
iteration and each Reviewer one re-ask.

`opencode run` is non-interactive, so an agent can never prompt for permission; read-only
agents are enforced through explicit allow/deny rules in their agent definitions, not
through the runner. The runtime image installs the glibc release build (the official
Alpine image's binary does not run on the Playwright base) and pins its version.

## Consequences

- No Sandbox outlives a single Agent Run; timeouts are per run and simple to enforce.
- An API restart mid-Question loses nothing: the Question is in Postgres and the answer
  starts a new run.
- The NDJSON stream is consumed once, forwarded as ephemeral `AGENT_OUTPUT`, and persisted
  only as the run's LOG Artifact.
- OpenCode server mode stays out of scope for the MVP.
