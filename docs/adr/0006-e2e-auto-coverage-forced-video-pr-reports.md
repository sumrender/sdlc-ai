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
  over `getChangedFiles` mark covered with no LLM call; inconclusive diffs default
  to not-covered through an injectable `LlmCoverageCheck` hook a full LLM jury can
  replace later. A changed path only counts as coverage when Playwright would
  actually run it: inside `e2eSpecDir()` (the Project Manifest's
  `<e2e.cwd>/<e2e.testDir>`) *and* carrying a Playwright spec suffix. Unit-test
  conventions (`__tests__/`, `.test.ts`) are deliberately excluded — see
  Consequences. State is `tasks.e2eCoverageCheckedAt`/`e2eGeneratedSpecPath` (+
  per-run mirrors on `test_runs`) plus an `E2E_COVERAGE_DECIDED` event.
- Writer (`E2E_TEST_WRITER` agent, `agents/e2e-test-writer.ts`): writes one focused
  Playwright spec, commits to the task branch via the shared
  `sandbox/workspace.ts:commitAndPush` helper, and reports `SPEC_PATH:`. The next
  Test Run executes it; loop accounting stays inside ADR-0003's one E2E loop.
- Forced video (`pipeline/e2e.ts:forceVideoOn`): Playwright commands run with a
  temporary overlay config `sdlc-pw.config.ts` written *beside* the project
  config it extends, adding `video: 'on'` (repo config never modified). The
  override is unconditional: the overlay spreads its own `use` last, so a Project
  declaring `video: 'off'` or `'retain-on-failure'` cannot opt out of the
  recording the PR reports on. Only a non-Playwright command, a command pinning
  its own `--config`, or a failed probe leaves the command untouched, each with a
  log line saying video could not be forced on. The
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
  (read-modify-write; human merge is later-stage). The comment states how many
  VIDEO Artifacts the Test Run produced and links the control plane to watch them,
  rather than uploading one arbitrarily-chosen video to a GitHub release. Records
  `PR_COMMENT_POSTED` and task URLs.
- Watchable report (`routes/tasks.ts`, `artifacts/store.ts`): with video on,
  Playwright writes its attachments under `playwright-report/data/` and references
  them *relatively*, which the single-artifact content route cannot serve. A
  path-based route `GET /tasks/:id/test-runs/:testRunId/report/*` serves the copied
  report directory (traversal-guarded), and those attachment files are kept on disk
  but not registered as Artifact rows, so each video appears exactly once — from
  `test-results` — instead of twice.

## Consequences

- Changes without specs get one generated spec per E2E visit, visible in task
  detail ("Test added by E2E" + "New test" chip) and named in reject feedback.
- Every Playwright run yields video for every test, without requiring project
  config changes and without a project being able to opt out.
- The PR always shows the latest suite result, spec note, and video count.
- Scoping coverage to `<e2e.cwd>/<e2e.testDir>` is load-bearing. The earlier rule
  matched any `.spec.ts` in the repo, so an Angular/Karma unit test
  (`fe/src/app/.../api-docs.component.spec.ts`) counted as e2e coverage and the
  writer was skipped for a change with no e2e coverage at all. Projects whose
  `testDir` is not Playwright's default must declare it in the Project Manifest.
- Storing every video costs disk per Test Run (~33 files for a mid-size suite).
  Accepted for now in exchange for not having to guess which video the human wants.
- New `agent`/`event_type` enum values and task/test-run columns require
  migration `drizzle/0001_cold_pixie.sql`. The move off GitHub release assets
  changes only what `tasks.e2e_report_video_url` holds (now a control-plane URL),
  not the schema.
