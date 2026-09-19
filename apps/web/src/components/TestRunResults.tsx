import { FileText, Image as ImageIcon, Video } from "lucide-react";
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
        const log = logArtifactFor(task, { kind: "test", run });
        const passed = run.status === "COMPLETED" && run.exitCode === 0;
        const live = run.status === "QUEUED" || run.status === "RUNNING";
        return (
          <li key={run.id} className={cn("rounded-md border p-3", index > 0 && "opacity-80")}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={live ? "info" : passed ? "success" : "destructive"}>{live ? run.status : passed ? "PASSED" : run.status === "COMPLETED" ? "FAILED" : run.status}</Badge>
              <span className="text-xs text-muted-foreground">
                Attempt {run.attempt} · <span className="font-mono">{run.command}</span>
                {run.startedAt ? ` · ${formatDateTime(run.startedAt)}` : ""}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
              <Stat label="Passed" value={run.passed} tone="text-emerald-300" />
              <Stat label="Failed" value={run.failed} tone={run.failed ? "text-red-300" : undefined} />
              <Stat label="Skipped" value={run.skipped} />
              <Stat label="Duration" value={formatDuration(run.durationMs)} />
            </dl>
            {run.error && <p className="mt-2 text-xs text-red-300">{run.error}</p>}
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
              {media.map((a) => (
                <Button key={a.id} variant="outline" size="sm" onClick={() => onOpenArtifact(a)} title={a.name}>
                  {a.type === "VIDEO" ? <Video /> : <ImageIcon />} {a.name.split("/").pop()}
                  {specPath && isNewTestArtifact(a.name, specPath) && (
                    <Badge variant="info" className="ml-1">
                      New test
                    </Badge>
                  )}
                </Button>
              ))}
              {!live && !report && media.length === 0 && <span className="self-center text-xs text-muted-foreground">No report or screenshots were copied out.</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
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
    <div className="rounded bg-black/30 px-2 py-1.5">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("text-base font-semibold tabular-nums", tone)}>{value ?? "—"}</dd>
    </div>
  );
}
