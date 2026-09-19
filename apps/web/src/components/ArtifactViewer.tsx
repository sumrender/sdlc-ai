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

/** Opens a Test Run Artifact: the Playwright report in a frame, screenshots and videos inline, anything else as a download. */
export function ArtifactViewer({ taskId, artifact, onClose }: ArtifactViewerProps) {
  const { client } = useApi();
  const url = artifact ? client.artifactContentUrl(taskId, artifact.id) : "";

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
          <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-black/40">
            {artifact.type === "SCREENSHOT" ? (
              <img src={url} alt={artifact.name} className="mx-auto max-h-[65vh] object-contain" />
            ) : artifact.type === "VIDEO" ? (
              <video src={url} controls className="mx-auto max-h-[65vh]" />
            ) : artifact.type === "TEST_REPORT" && isHtml(artifact) ? (
              <iframe src={url} title={artifact.name} className="h-[65vh] w-full bg-white" sandbox="allow-scripts allow-same-origin" />
            ) : (
              <p className="p-6 text-sm text-muted-foreground">This Artifact has no inline preview. Download it to inspect.</p>
            )}
          </div>
        )}
        {artifact && (
          <div className="flex justify-end gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={url} target="_blank" rel="noreferrer">
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
