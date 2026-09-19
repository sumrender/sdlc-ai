import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import { NewTaskDialog } from "./NewTaskDialog";

export function AppHeader({ nav }: { nav?: ReactNode }) {
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card">
      <div className="flex h-14 items-center gap-3 px-4">
        <span className="flex items-center gap-2">
          <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-[#f6821f] text-[11px] font-bold text-white">
            S
          </span>
          <span className="text-sm font-semibold tracking-tight">AI powered SDLC</span>
        </span>
        {nav}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={() => setNewTaskOpen(true)}>
            <Plus /> New Task
          </Button>
        </div>
      </div>

      <NewTaskDialog open={newTaskOpen} onOpenChange={setNewTaskOpen} />
    </header>
  );
}
