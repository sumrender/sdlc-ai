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
`opencode run --format json --agent <name> --model anthropic/<id> --auto` with the prompt
on stdin, inside a fresh Sandbox per Agent Run. Waiting on a human is a Task Status
(`WAITING`), never an Agent Run state: a Planner run that asks a Question *completes*, the
Task parks, and the answer starts a second run in a new Sandbox that passes
`--session <id>` to resume the same OpenCode session. Session storage is a named Docker
volume mounted into every Sandbox so the second shot can find the first shot's session; the
follow-up prompt also restates the Question and answer, so it still produces a valid Plan if
the session cannot be resumed. The same pattern gives the Developer one Checks fix
iteration and each Reviewer one re-ask.

`--auto` is required because `opencode run` otherwise auto-cancels questions and
auto-rejects permissions; read-only agents are enforced through agent-definition
permissions, not through the runner.

## Consequences

- No Sandbox outlives a single Agent Run; timeouts are per run and simple to enforce.
- An API restart mid-Question loses nothing: the Question is in Postgres and the answer
  starts a new run.
- The NDJSON stream is consumed once, forwarded as ephemeral `AGENT_OUTPUT`, and persisted
  only as the run's LOG Artifact.
- OpenCode server mode stays out of scope for the MVP.
