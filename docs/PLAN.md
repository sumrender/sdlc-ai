# AI-Native SDLC — 1-Day MVP

### Goal

Build a **working vertical slice for one GitHub repo**:

```text
TODO
 ↓
PLANNING → DEVELOPMENT → E2E → AGENT REVIEW → HUMAN REVIEW → STAGING
```

Kanban updates **live** as the workflow progresses.

---

## Stack

* **Frontend:** TanStack Start + React + Tailwind/shadcn
* **Backend:** Hono + TypeScript
* **DB:** PostgreSQL + Drizzle
* **Realtime:** SSE
* **Agent:** OpenCode `ghcr.io/anomalyco/opencode:2.0.8`
* **Execution:** Docker
* **GitHub:** Octokit
* **Deployment:** Docker initially; keep backend portable to Cloudflare Workers

Architecture:

```text
TanStack Start
      ↓
    Hono
      ↓
 Workflow Engine
   ↙   ↓    ↘
 DB  GitHub  Agent Executor
             ↓
        OpenCode Docker
```

---

## What to actually build

### 1. Kanban — highest priority

7 columns:

```text
TODO | PLANNING | DEVELOPMENT | E2E |
AGENT REVIEW | HUMAN REVIEW | STAGING
```

Cards automatically move via SSE.

### 2. Task

```text
title
description
stage
status
branch
PR URL
```

Only one repo/project.

### 3. Planning

OpenCode creates a plan and can ask **one human question**.

```text
Agent → question → UI → human answer → Agent resumes
```

### 4. Development

Real OpenCode execution:

```text
Task
 ↓
create branch
 ↓
OpenCode edits repo
 ↓
run tests
 ↓
commit
 ↓
push
 ↓
create GitHub PR
```

### 5. E2E

Run one configured command:

```bash
npm run test:e2e
```

Capture logs/results/screenshots if available.

### 6. Agent Review

Run the required stack reviewers in parallel (change-scoped from the manifest):

```text
Frontend (fe-only, shared, or unknown diffs)
Backend  (be-only, shared, or unknown diffs)
```

Each returns:

```text
PASS / REJECT
+ findings
```

### 7. Human Review

Best UI screen.

Show:

* plan
* GitHub PR/diff
* E2E results
* screenshots/evidence
* 4 review verdicts
* agent logs

Then:

```text
[ Reject ] [ Approve ]
```

Reject → Development with feedback.

Approve → Staging.

### 8. Staging

Keep it simple. Trigger a basic deployment or deployment command.

---

## Minimal backend primitives

Only implement:

```text
Task
Workflow / State Machine
AgentRun
HumanQuestion
TestRun
Review
Artifact
Approval
Event
```

Everything else can be simple internal code.

---

## Important abstraction

Keep agent execution behind:

```ts
interface AgentExecutor {
  run(input: AgentInput): Promise<AgentResult>
}
```

Tomorrow:

```text
DockerAgentExecutor
       ↓
OpenCode container
```

Later:

```text
Cloud / Kubernetes / TrueForge / etc.
```

This also keeps your Hono backend portable.

---

## Don't build

❌ Auth
❌ Multi-user
❌ Multi-repo
❌ RBAC
❌ Billing
❌ Slack/email
❌ Workflow builder
❌ Agent marketplace
❌ Production deployment
❌ Kubernetes
❌ Temporal
❌ Complex retry/recovery
❌ Secret management UI

---

## One-day priority

```text
1. Beautiful Kanban + task detail       🔴
2. Workflow/state machine               🔴
3. Live SSE updates                     🔴
4. OpenCode Docker execution            🔴
5. GitHub branch + PR                   🔴
6. E2E                                  🟠
7. Parallel reviews                     🟠
8. Human approval                       🟠
9. Staging                              🟠
10. Polish + demo reliability           🟢
```

### The demo you want

> **Create task → Planning → agent codes → PR created → E2E passes → 4 agents review → human sees all evidence → Approve → card automatically moves to Staging.**

If that works and looks polished, **you have the MVP.**
