import { Download, ExternalLink } from "lucide-react";
import type { Artifact } from "@sdlc-ai/shared";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { useApi } from "~/lib/api-context";
import { formatBytes, formatDateTime } from "~/lib/task-detail";

export interface ArtifactViewerProps {
  taskId: string;
  artifact: Artifact | null;
  onClose: () => void;
}

const isHtml = (a: Artifact) => /\.html?$/i.test(a.name);

/**
 * The path of a Playwright-report Artifact *within the copied report directory*,
 * or null if it is not part of one.
 *
 * Artifact names are `<manifest artifact path>/<path under that dir>` (see
 * `ArtifactStore.importDir`), e.g. `fe/playwright-report/index.html`. The server
 * serves the report rooted at the `playwright-report` directory, so everything
 * up to and including that segment is the prefix and gets stripped — leaving
 * `index.html`.
 *
 * LIMITATION: `"playwright-report"` is Playwright's default `outputFolder`,
 * hardcoded here and again server-side as `PLAYWRIGHT_REPORT_DIR` in
 * `apps/api/src/artifacts/store.ts` — web cannot import from api, so the two must
 * be kept in step by hand. A Project that configures a different reporter folder
 * returns null here and falls back to the single-file content URL, which renders
 * the report with broken `data/*` attachment links. See the server-side constant
 * for the proper fix (derive it from the Project Manifest, share one constant).
 */
export function reportRelativePath(name: string): string | null {
  const segments = name.split("/");
  const reportIndex = segments.lastIndexOf("playwright-report");
  if (reportIndex === -1 || reportIndex === segments.length - 1) return null;
  return segments.slice(reportIndex + 1).join("/");
}

/** Opens a Test Run Artifact: the Playwright report in a frame, screenshots and videos inline, anything else as a download. */
export function ArtifactViewer({ taskId, artifact, onClose }: ArtifactViewerProps) {
  const { client } = useApi();
  const url = artifact ? client.artifactContentUrl(taskId, artifact.id) : "";
  /**
   * The HTML report links its attachments relatively (`data/*.webm`), which only
   * resolves if the frame's own URL mirrors the report's directory layout. So an
   * HTML report backed by a Test Run gets framed at the path route instead of the
   * opaque artifact-content URL; every other Artifact keeps the content URL.
   */
  const reportPath = artifact && artifact.type === "TEST_REPORT" && isHtml(artifact) ? reportRelativePath(artifact.name) : null;
  const frameUrl = artifact && artifact.testRunId && reportPath !== null ? client.testRunReportUrl(taskId, artifact.testRunId, reportPath) : url;

  return (
    <Dialog open={artifact !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{artifact?.name}</DialogTitle>
          <DialogDescription>
            {artifact ? `${artifact.type} · ${formatDateTime(artifact.createdAt)} · ${formatBytes(artifact.sizeBytes)}` : ""}
          </DialogDescription>
        </DialogHeader>
        {artifact && (
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-secondary/40">
            {artifact.type === "SCREENSHOT" ? (
              <img src={url} alt={artifact.name} className="mx-auto max-h-[65vh] object-contain" />
            ) : artifact.type === "VIDEO" ? (
              <video src={url} controls className="mx-auto max-h-[65vh]" />
            ) : artifact.type === "TEST_REPORT" && isHtml(artifact) ? (
              <iframe src={frameUrl} title={artifact.name} className="h-[65vh] w-full bg-white" sandbox="allow-scripts allow-same-origin" />
            ) : (
              <p className="p-6 text-sm text-muted-foreground">This Artifact has no inline preview. Download it to inspect.</p>
            )}
          </div>
        )}
        {artifact && (
          <div className="flex justify-end gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={frameUrl} target="_blank" rel="noreferrer">
                <ExternalLink /> Open in new tab
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`${url}?download=1`} download={artifact.name.split("/").pop()}>
                <Download /> Download
              </a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
