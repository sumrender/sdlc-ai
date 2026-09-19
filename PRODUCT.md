# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Tech lead gating delivery. Day-to-day they watch a single GitHub repo's tasks move through a 7-stage agent pipeline, unblock the Planner's single clarifying question, and Approve/Reject at Human Review with full evidence (plan, PR/diff, E2E results, 4 reviewer verdicts, logs).

## Product Purpose

A single-context control plane that hands a software task to agents and moves it through TODO → PLANNING → DEVELOPMENT → E2E → AGENT REVIEW → HUMAN REVIEW → STAGING, gated at each step, with live Kanban updates over SSE. Success is the demo loop: create task → agent plans → agent codes + opens PR → E2E passes → 4 parallel reviews → human approves with all evidence in one screen → card moves to STAGING.

## Positioning

Not a generic Kanban: every card is an agent-executed task with its plan, branch/PR, E2E proof, four reviewer verdicts (Security, Architecture, Quality, Performance), agent logs, and deployment state attached — the human intervenes only at explicit decision points (planner question, approval).

## Operating Context

One repo/project, one active task at a time (single-task pipeline). Kanban is the home screen; task detail is the review cockpit; settings surfaces the Project Manifest. Updates stream live (SSE), never polled. Users operate in dark ops-room conditions, glancing for what needs them: planner questions and pending approvals.

## Capabilities and Constraints

Confirmed: 7 fixed stages; task model (title, description, stage, status, branch, PR URL); planner asks exactly one question; developer creates branch/commits/pushes/opens PR via OpenCode-in-Docker; E2E is one configured command; 4 parallel reviewers return PASS/REJECT + findings (informational — approval decides); approve merges to default branch and moves to STAGING, reject sends back to DEVELOPMENT with feedback; no auth, no multi-user, no multi-repo (per PLAN.md). Redesign must preserve every route, component contract, SSE behavior, and fixture-mode support; visual replacement only.

## Brand Commitments

Name `sdlc-ai` (lowercase wordmark in header). No confirmed palette, type, logo, or voice beyond the existing neutral dark shadcn base — which this redesign replaces as anti-reference. CRITICAL: do not invent testimonials, customers, benchmarks, or pricing.

## Evidence on Hand

Live incumbent implementation in `apps/web/src` (Kanban board, task detail, settings, SSE lib, fixture API with scripted demo walkthrough). Product truth in `CONTEXT.md` and `PLAN.md` at repo root.

## Product Principles

1. Status at a glance: anything needing the human (question, approval, failure) must be findable within seconds.
2. Evidence over assertion: every stage transition shows its proof (plan text, diff, test counts, verdicts, logs).
3. Calm ops, loud exceptions: the board idles quietly; waiting/failed states carry the emphasis.
4. Pipeline truth is immutable: stages, terminology, and gating semantics never bend for layout convenience.
