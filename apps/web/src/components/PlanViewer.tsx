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
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-800">Feedback for the next Developer run</p>
          <pre className="mt-1.5 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-amber-900">{pendingFeedback}</pre>
        </div>
      )}
    </div>
  );
}
