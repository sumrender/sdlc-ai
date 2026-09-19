export interface PlanViewerProps {
  plan: string | null;
  /** Feedback carried into the next Developer run by a Reject loop. */
  pendingFeedback: string | null;
}

/** The Planner's written approach, shown as soon as it exists. */
export function PlanViewer({ plan, pendingFeedback }: PlanViewerProps) {
  return (
    <div className="flex flex-col gap-4">
      {plan ? (
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{plan}</pre>
      ) : (
        <p className="text-sm text-muted-foreground">No Plan yet. The Planner writes it during PLANNING.</p>
      )}
      {pendingFeedback && (
        <div className="rounded-md border border-amber-400/40 bg-amber-500/10 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">Feedback for the next Developer run</p>
          <pre className="mt-1.5 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-amber-100/90">{pendingFeedback}</pre>
        </div>
      )}
    </div>
  );
}
