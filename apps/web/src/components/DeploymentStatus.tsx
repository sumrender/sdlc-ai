import { ExternalLink, Loader2 } from "lucide-react";
import type { Deployment, DeploymentStatus as Status } from "@sdlc-ai/shared";
import { Badge, type BadgeProps } from "~/components/ui/badge";
import { formatTime } from "~/lib/task-detail";

const VARIANT: Record<Status, NonNullable<BadgeProps["variant"]>> = {
  PENDING: "secondary",
  BUILDING: "info",
  LIVE: "success",
  FAILED: "destructive",
  TIMED_OUT: "destructive",
};

const PROVIDER_LABEL = { CLOUDFLARE: "Cloudflare", RENDER: "Render" } as const;

export interface DeploymentStatusProps {
  deployments: Deployment[];
}

/** One live status row per touched Deploy Target, with the public origin once known. */
export function DeploymentStatus({ deployments }: DeploymentStatusProps) {
  if (deployments.length === 0) {
    return <p className="text-sm text-muted-foreground">The merged change touched no Deploy Target, so nothing is deploying.</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-border/60">
      {deployments.map((d) => {
        const inProgress = d.status === "PENDING" || d.status === "BUILDING";
        return (
          <li key={d.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <span className="w-8 text-sm font-semibold">{d.target}</span>
            <span className="w-24 text-xs text-muted-foreground">{PROVIDER_LABEL[d.provider]}</span>
            <Badge variant={VARIANT[d.status]} className="gap-1">
              {inProgress && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
              {d.status.replace("_", " ")}
            </Badge>
            <span className="font-mono text-xs text-muted-foreground" title={d.commitSha}>
              {d.commitSha.slice(0, 7)}
            </span>
            {d.providerRef && <span className="font-mono text-[11px] text-muted-foreground/70">{d.providerRef}</span>}
            <span className="ml-auto flex items-center gap-3 text-xs">
              {d.lastPolledAt && <span className="text-muted-foreground">polled {formatTime(d.lastPolledAt)}</span>}
              {d.url && (
                <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:underline">
                  {new URL(d.url).host} <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              )}
            </span>
            {d.error && <p className="basis-full text-xs text-red-300">{d.error}</p>}
          </li>
        );
      })}
    </ul>
  );
}
