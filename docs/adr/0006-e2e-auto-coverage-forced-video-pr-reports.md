# 0006: E2E auto-coverage, forced video, and PR-linked reports

Date: 2026-09-19
Status: Accepted

## Context

E2E only ran the project's suite: a change with no spec passed trivially, video
depended on project config, and nothing reported back to the PR. The pipeline
needed the gate to add the missing test, record video, and link both to the PR
without inventing a new reject budget.

## Decision

- Coverage check (`pipeline/e2e-coverage.ts`, once per E2E visit): diff heuristics
  over `getChangedFiles` (spec-like paths, `__tests__`, manifest `e2e.cwd`) mark
  covered with no LLM call; inconclusive diffs default to not-covered through an
  injectable `LlmCoverageCheck` hook a full LLM jury can replace later. State is
  `tasks.e2eCoverageCheckedAt`/`e2eGeneratedSpecPath` (+ per-run mirrors on
  `test_runs`) plus an `E2E_COVERAGE_DECIDED` event.
- Writer (`E2E_TEST_WRITER` agent, `agents/e2e-test-writer.ts`): writes one focused
  Playwright spec, commits to the task branch via the shared
  `sandbox/workspace.ts:commitAndPush` helper, and reports `SPEC_PATH:`. The next
  Test Run executes it; loop accounting stays inside ADR-0003's one E2E loop.
- Forced video (`pipeline/e2e.ts:forceVideoOn`): Playwright commands run with a
  temporary overlay config `sdlc-pw.config.ts` written *beside* the project
  config it extends, adding `video: 'retain-on-failure'` (repo config never
  modified); non-Playwright commands get env-only injection + a warning. The
  conventional `test-results` dir is appended to the import list for that run
  only. Placement is load-bearing: Playwright resolves `testDir`, `outputDir`,
  reporter folders and `webServer.cwd` against the directory of the config it
  loaded, so an overlay outside the Workspace relocates the whole suite. The
  overlay is added to `.git/info/exclude` (the Workspace is reused and the
  Developer stages with `git add -A`) and deleted when the Test Run ends.
  The `--config` flag is appended via `appendCliArg`, which inserts the `--`
  separator for `npm`/`pnpm` run wrappers that would otherwise swallow it.
- PR report (`pipeline/e2e-report.ts`): after every finished suite, upsert one
  `<!-- sdlc-ai-e2e -->` marker comment and refresh a `Latest E2E` PR-body section
  (read-modify-write; human merge is later-stage). The first VIDEO artifact is
  uploaded as a `sdlc-e2e-assets` release asset so the PR links a GitHub-hosted
  viewable file, never a bearer-free control-plane URL; upload failure degrades to
  no video link + a log line. Records `PR_COMMENT_POSTED` and task URLs.

## Consequences

- Changes without specs get one generated spec per E2E visit, visible in task
  detail ("Test added by E2E" + "New test" chip) and named in reject feedback.
- Every Playwright run yields video without requiring project config changes.
- The PR always shows the latest suite result, spec note, and playable video.
- New `agent`/`event_type` enum values and task/test-run columns require
  migration `drizzle/0001_cold_pixie.sql`.
