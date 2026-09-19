import { createFileRoute } from "@tanstack/react-router";
import { STAGES } from "@sdlc-ai/shared";

export const Route = createFileRoute("/")({
  component: Board,
});

function Board() {
  return (
    <div className="grid grid-cols-7 gap-3 p-4">
      {STAGES.map((stage) => (
        <section key={stage} className="rounded border border-neutral-800 p-2">
          <h2 className="text-xs font-semibold tracking-wide text-neutral-400">{stage}</h2>
        </section>
      ))}
    </div>
  );
}
