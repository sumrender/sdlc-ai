import { useState } from "react";
import { ChevronRight, FileText, Image as ImageIcon, Video } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Artifact, TaskDetail, TestRun } from "@sdlc-ai/shared";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { artifactsForTestRun, findReport, formatDateTime, formatDuration, logArtifactFor } from "~/lib/task-detail";
import { cn } from "~/lib/utils";

export interface TestRunResultsProps {
  task: TaskDetail;
  onOpenLog: (artifact: Artifact, run: TestRun) => void;
  onOpenArtifact: (artifact: Artifact) => void;
}

/** Pass, fail, and skipped counts with duration per Test Run, plus its Playwright report and screenshots. */
export function TestRunResults({ task, onOpenLog, onOpenArtifact }: TestRunResultsProps) {
  const runs = [...task.testRuns].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (runs.length === 0) {
    return <p className="text-sm text-muted-foreground">No Test Run yet. The Project's end-to-end suite runs in E2E.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {task.e2eGeneratedSpecPath && (
        <p className="text-xs text-sky-300">
          Test added by E2E: <span className="font-mono">{task.e2eGeneratedSpecPath}</span>
        </p>
      )}
      {runs.map((run, index) => {
        const specPath = run.generatedSpecPath ?? task.e2eGeneratedSpecPath;
        const artifacts = artifactsForTestRun(task, run.id);
        const report = findReport(artifacts);
        const media = artifacts.filter((a) => a.type === "SCREENSHOT" || a.type === "VIDEO");
        // Playwright records every test now, not just failures, so a green suite
        // yields one video per test. Split by kind and collapse each group rather
        // than wrapping thirty-odd buttons across the card.
        const videos = newTestFirst(
          media.filter((a) => a.type === "VIDEO"),
          specPath,
        );
        const screenshots = newTestFirst(
          media.filter((a) => a.type === "SCREENSHOT"),
          specPath,
        );
        const log = logArtifactFor(task, { kind: "test", run });
        const passed = run.status === "COMPLETED" && run.exitCode === 0;
        const live = run.status === "QUEUED" || run.status === "RUNNING";
        return (
          <li key={run.id} className={cn("rounded-lg border border-border bg-card p-3", index > 0 && "opacity-80")}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={live ? "info" : passed ? "success" : "destructive"}>{live ? run.status : passed ? "Passed" : run.status === "COMPLETED" ? "Failed" : run.status}</Badge>
              <span className="text-xs text-muted-foreground">
                Attempt {run.attempt} · <span className="font-mono">{run.command}</span>
                {run.startedAt ? ` · ${formatDateTime(run.startedAt)}` : ""}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
              <Stat label="Passed" value={run.passed} tone="text-emerald-700" />
              <Stat label="Failed" value={run.failed} tone={run.failed ? "text-red-600" : undefined} />
              <Stat label="Skipped" value={run.skipped} />
              <Stat label="Duration" value={formatDuration(run.durationMs)} />
            </dl>
            {run.error && <p className="mt-2 text-xs text-red-600">{run.error}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {log && (
                <Button variant="outline" size="sm" onClick={() => onOpenLog(log, run)}>
                  <FileText /> Log
                </Button>
              )}
              {report && (
                <Button variant="secondary" size="sm" onClick={() => onOpenArtifact(report)}>
                  <FileText /> Playwright report
                </Button>
              )}
              {!live && !report && media.length === 0 && <span className="self-center text-xs text-muted-foreground">No report or screenshots were copied out.</span>}
            </div>
            {media.length > 0 && (
              <div className="mt-2 flex flex-col gap-1.5">
                <MediaGroup label="Videos" icon={Video} artifacts={videos} specPath={specPath} onOpenArtifact={onOpenArtifact} />
                <MediaGroup label="Screenshots" icon={ImageIcon} artifacts={screenshots} specPath={specPath} onOpenArtifact={onOpenArtifact} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A collapsed count of one kind of media Artifact, expanding to a capped,
 * scrollable list. Each row keeps the click-to-open behaviour the flat button
 * row had; only the chrome around it changed.
 */
function MediaGroup({
  label,
  icon: Icon,
  artifacts,
  specPath,
  onOpenArtifact,
}: {
  label: string;
  icon: LucideIcon;
  artifacts: readonly Artifact[];
  specPath: string | null;
  onOpenArtifact: (artifact: Artifact) => void;
}) {
  const hasNewTest = specPath !== null && artifacts.some((a) => isNewTestArtifact(a.name, specPath));
  // Start expanded only when the group holds the recording of the newly written
  // spec: that is the one the human opened the Task to watch, so it should not
  // cost a click. Every other group stays folded away.
  const [open, setOpen] = useState(hasNewTest);
  if (artifacts.length === 0) return null;
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium hover:bg-secondary/60"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden />
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span>
          {label} ({artifacts.length})
        </span>
      </button>
      {open && (
        // Capped height: a passing suite produces one video per test, so this
        // list is routinely 30+ rows and must not push the card off-screen.
        <ul className="max-h-56 overflow-y-auto border-t border-border">
          {artifacts.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onOpenArtifact(a)}
                title={a.name}
                className="flex w-full items-center gap-2 px-2.5 py-1 text-left font-mono text-xs hover:bg-secondary/60"
              >
                <span className="min-w-0 flex-1 truncate">{a.name.split("/").pop()}</span>
                {specPath && isNewTestArtifact(a.name, specPath) && <Badge variant="info">New test</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The recording of the newly generated spec sorts to the front; everything else keeps its import order. */
function newTestFirst(artifacts: readonly Artifact[], specPath: string | null): Artifact[] {
  if (!specPath) return [...artifacts];
  const matches = (a: Artifact) => isNewTestArtifact(a.name, specPath);
  return [...artifacts.filter(matches), ...artifacts.filter((a) => !matches(a))];
}

/** True when an artifact filename shares its stem with the E2E-generated spec. */
export function isNewTestArtifact(artifactName: string, specPath: string): boolean {
  const stem = specPath
    .split("/")
    .pop()
    ?.replace(/\.(spec|e2e)\.[a-z]+$/i, "")
    .toLowerCase();
  if (!stem) return false;
  return artifactName.toLowerCase().includes(stem);
}

function Stat({ label, value, tone }: { label: string; value: number | string | null; tone?: string }) {
  return (
    <div className="rounded-lg bg-secondary px-2 py-1.5">
      <dt className="text-[10px] font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("text-base font-semibold tabular-nums", tone)}>{value ?? "—"}</dd>
    </div>
  );
}
