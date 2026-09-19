import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import type { Artifact } from "@sdlc-ai/shared";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { useApi } from "~/lib/api-context";
import { formatBytes, formatDateTime } from "~/lib/task-detail";

export interface LogViewerProps {
  taskId: string;
  artifact: Artifact | null;
  /** Shown above the log: which run produced it. */
  subtitle?: string;
  onClose: () => void;
}

/** Opens the full LOG Artifact of a past Agent Run or Test Run. */
export function LogViewer({ taskId, artifact, subtitle, onClose }: LogViewerProps) {
  const { client } = useApi();
  const content = useQuery({
    queryKey: ["artifact-text", taskId, artifact?.id],
    queryFn: () => client.fetchArtifactText(taskId, artifact!.id),
    enabled: artifact !== null,
    staleTime: Infinity,
  });

  return (
    <Dialog open={artifact !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{artifact?.name}</DialogTitle>
          <DialogDescription>
            {subtitle ? `${subtitle} · ` : ""}
            {artifact ? `${formatDateTime(artifact.createdAt)} · ${formatBytes(artifact.sizeBytes)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <pre
          className="min-h-40 flex-1 overflow-auto rounded-md border bg-black/40 p-3 font-mono text-[12px] leading-5 whitespace-pre-wrap break-words"
          aria-busy={content.isPending}
        >
          {content.isPending && "Loading log…"}
          {content.isError && <span className="text-red-300">Could not load the log: {content.error.message}</span>}
          {content.data !== undefined && (content.data.length > 0 ? content.data : <span className="text-muted-foreground">(empty log)</span>)}
        </pre>
        {artifact && (
          <div className="flex justify-end">
            <Button asChild variant="outline" size="sm">
              <a href={`${client.artifactContentUrl(taskId, artifact.id)}?download=1`} download={artifact.name}>
                <Download /> Download
              </a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
