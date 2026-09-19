# AI-Native SD

A single-context control plane: a human hands a software task to an agent, and the task moves through a fixed pipeline of stages, each gated, until it reaches staging. Humans intervene only at explicit decision points. This glossary defines the shared language for tasks, stages, agent execution, evidence, and human checkpoints.

## Language

### Work

**Project**:
The one thing the control plane operates on: a single GitHub repository plus its default branch. Holds the repository coordinates; is not the repository itself.
_Avoid_: repo (when meaning the Project), workspace

**Task**:
A unit of work handed to the pipeline: a title and description that an agent turns into a pull request. The central entity; everything else hangs off a Task.
_Avoid_: ticket, issue (an Issue is the GitHub record a Task may be linked to), card (that's the UI representation)

**Plan**:
The Planner's written approach for a Task: the steps it intends to take. Input to Development, shown at Human Review, re-supplied on Reject. One Plan per Task; re-planning overwrites it.
_Avoid_: spec, design

### Pipeline

**Stage**:
One of the seven fixed columns a Task occupies, in order: TODO, PLANNING, DEVELOPMENT, E2E, AGENT REVIEW, HUMAN REVIEW, STAGING. A Task is in exactly one Stage at a time.
_Avoid_: phase, step, column (UI term), state (see Status)

**Status**:
What is happening to a Task *within* its current Stage. Exactly one of: READY (Stage entered, nothing started), RUNNING (an Agent Run or Test Run is active), WAITING (blocked on a human: a pending Question or Approval), FAILED (the last run failed; Retry is available), COMPLETED (terminal; only valid in STAGING).
_Avoid_: state, stage (Stage is *where*, Status is *how it's going*)

**Transition**:
Moving a Task from one Stage to the next. Only the workflow engine performs Transitions, never the UI directly.
_Avoid_: move, promote, drag

**Gate**:
The condition a Task must satisfy before a Transition is allowed. Each Stage's exit has one Gate (a Plan exists; a pull request exists; the Test Run passed; all four Reviews completed; an Approval is APPROVED). Gates check that work *completed*, with one exception: E2E must *pass*. Whether Reviews passed is the human's call at Human Review.
_Avoid_: check, validation, rule

**Retry**:
Re-running the current Stage's work from scratch after a FAILED Status. Creates a new Agent Run or Test Run; never re-enters an earlier Stage.

**Reject loop**:
The Transition back to DEVELOPMENT carrying feedback into the next Agent Run. Two triggers: a human REJECTED Approval (feedback plus the Reviews' Findings; unlimited), or a failed Test Run (the failure output; at most once per Task, after which the Task is FAILED).

### Execution

**Agent**:
A named role an LLM plays for one Stage: Planner, Developer, and the four Reviewers (Security, Architecture, Quality, Performance). An Agent is a definition (prompt, permissions, model), not a running process.
_Avoid_: bot, model (the model is what an Agent runs on)

**Agent Run**:
One invocation of one Agent against one Task, inside one Sandbox. Has its own lifecycle: QUEUED, RUNNING, COMPLETED, FAILED, TIMED_OUT, CANCELLED. Waiting on a human is a Task Status, never an Agent Run state; a run that needs an answer ends and a new run resumes with it.
_Avoid_: job, execution, session (an OpenCode session is an implementation detail of a run)

**Sandbox**:
The isolated environment an Agent Run or Test Run executes in. Today a Docker container; later a remote execution service. The boundary the workflow talks to; it never reaches inside.
_Avoid_: container (implementation), VM, executor (the executor *provides* Sandboxes)

**Workspace**:
The checked-out copy of the Project's repository inside a Sandbox, on the Task's branch. Created fresh per Stage and discarded with the Sandbox.
_Avoid_: repo, checkout, working directory

**Test Run**:
One deterministic execution of the Project Manifest's end-to-end test command in a Sandbox, recording exit code, pass/fail counts, duration, and produced Artifacts. Not an Agent Run: no LLM is involved.
_Avoid_: E2E run (E2E is the Stage), test job

**Project Manifest**:
The Project's own declaration, versioned in its repository, of how a Workspace is prepared (setup commands), how a change is verified before commit (Checks), and how end-to-end tests run. The control plane reads it; it never hardcodes a repository's tooling.
_Avoid_: config, settings (Settings is the control-plane screen that *displays* the Manifest), recipe

**Check**:
One deterministic command from the Project Manifest (build, lint, unit tests) run in the Workspace after the Developer finishes and before anything is committed. A failing Check is handed back to the Developer for one fix iteration.
_Avoid_: test (Test Run is the end-to-end Stage), validation, gate (a Gate is between Stages; a Check is within one)

### Human checkpoints

**Question**:
A single clarifying question the Planner asks the human before finishing its Plan, optionally with fixed options. Exactly one per Planning run; PENDING until ANSWERED. Answering resumes planning.
_Avoid_: prompt, clarification, blocker

**Approval**:
The human's explicit decision at HUMAN REVIEW: APPROVED or REJECTED, with optional feedback (required on REJECTED). The only thing that can open the Gate into STAGING. An Agent can never create an Approval.
_Avoid_: sign-off, verdict (Verdict belongs to Reviews), merge (the consequence, not the decision)

### Delivery

**Deploy Target**:
An independently deployed part of the Project, with its own provider, watched path prefix, and public origin. A change touches a Deploy Target when its diff includes files under that prefix.
_Avoid_: environment (staging is the environment; a target is what gets deployed into it), service

**Deployment**:
A provider's build-and-release of one commit to one Deploy Target. Observed, never performed, by the control plane: merging to the default branch triggers it; the control plane polls until it is live.
_Avoid_: release, deploy (verb only), build

### Evidence

**Review**:
One Reviewer's structured judgement of a Task's pull request: a Verdict plus Findings. Four Reviews per Agent Review pass, one per Reviewer.
_Avoid_: audit, check

**Verdict**:
A Review's overall call: PASS or REJECT. Informational: a REJECT does not block the Transition to HUMAN REVIEW; it is shown to the human.
_Avoid_: result, status, approval

**Finding**:
One concrete observation inside a Review, with a severity (LOW, MEDIUM, HIGH, CRITICAL), a message, and optionally a file and line.
_Avoid_: issue, comment, violation

**Artifact**:
Any stored output produced during a Task's pipeline that a human may want to inspect: a log, a screenshot, a video, a test report, a diff. "Evidence" is UI copy for a collection of Artifacts, not a distinct concept.
_Avoid_: evidence (as a noun in code), attachment, output

**Event**:
An immutable, timestamped record that something happened to a Task (a Transition, a run starting or finishing, a Question asked, an Approval decided). Persisted and streamed live to the UI; the UI never derives state by polling.
_Avoid_: message, notification, log line (log lines are Artifact content, not Events)
