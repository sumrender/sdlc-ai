import { Markdown } from "~/components/Markdown";

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
        <Markdown text={plan} />
      ) : (
        <p className="text-sm text-muted-foreground">No Plan yet. The Planner writes it during PLANNING.</p>
      )}
      {pendingFeedback && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-800">Feedback for the next Developer run</p>
          <div className="mt-1.5 text-amber-900">
            <Markdown text={pendingFeedback} />
          </div>
        </div>
      )}
    </div>
  );
}
