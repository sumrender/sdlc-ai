import { AnimatePresence } from "motion/react";
import type { ReactNode } from "react";
import type { Stage } from "@sdlc-ai/shared";

export const STAGE_LABEL: Record<Stage, string> = {
  TODO: "TODO",
  PLANNING: "PLANNING",
  DEVELOPMENT: "DEVELOPMENT",
  E2E: "E2E",
  AGENT_REVIEW: "AGENT REVIEW",
  HUMAN_REVIEW: "HUMAN REVIEW",
  STAGING: "STAGING",
};

export function KanbanColumn({ stage, count, children }: { stage: Stage; count: number; children: ReactNode }) {
  return (
    <section
      aria-label={STAGE_LABEL[stage]}
      className="flex min-h-[60vh] min-w-0 flex-col rounded-lg border border-border/60 bg-neutral-900/40"
    >
      <header className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground">{STAGE_LABEL[stage]}</h2>
        <span className="rounded-full bg-secondary px-2 text-[11px] tabular-nums text-secondary-foreground">{count}</span>
      </header>
      <div className="flex flex-1 flex-col gap-2 p-2">
        <AnimatePresence mode="popLayout" initial={false}>
          {children}
        </AnimatePresence>
      </div>
    </section>
  );
}
