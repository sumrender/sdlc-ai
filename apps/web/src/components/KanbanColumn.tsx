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
    <section aria-label={STAGE_LABEL[stage]} className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border bg-secondary/50 px-3 py-2">
        <h2 className="truncate text-[13px] font-medium text-foreground">{STAGE_LABEL[stage]}</h2>
        <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-secondary-foreground">{count}</span>
      </header>
      <div className="flex flex-1 flex-col gap-2 p-2">
        <AnimatePresence mode="popLayout" initial={false}>
          {children}
        </AnimatePresence>
      </div>
    </section>
  );
}
