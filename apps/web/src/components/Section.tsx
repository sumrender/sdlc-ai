import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export interface SectionProps {
  title: string;
  /** Right-aligned controls or a summary badge. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Removes the inner padding so a full-bleed child (a log pane) can own it. */
  flush?: boolean;
}

/** A titled panel on the Task detail page. */
export function Section({ title, aside, children, className, flush }: SectionProps) {
  return (
    <section className={cn("flex flex-col rounded-lg border bg-card text-card-foreground", className)}>
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        {aside}
      </header>
      <div className={cn("min-h-0 flex-1", flush ? "" : "p-4")}>{children}</div>
    </section>
  );
}
