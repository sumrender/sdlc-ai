import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnswerQuestionInputSchema, type BoardTask, type Question } from "@sdlc-ai/shared";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { useApi } from "~/lib/api-context";
import { upsertTask } from "~/lib/board-query";
import { cn } from "~/lib/utils";

export interface QuestionDialogProps {
  task: BoardTask;
  question: Question;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuestionDialog({ task, question, open, onOpenChange }: QuestionDialogProps) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [freeText, setFreeText] = useState("");
  const options = question.options ?? [];
  const answer = options.length > 0 ? selected : freeText;
  const parsed = AnswerQuestionInputSchema.safeParse({ answer: answer ?? "" });

  const submit = useMutation({
    mutationFn: () => {
      if (!parsed.success) throw new Error("Answer is required");
      return client.answerQuestion(task.id, question.id, parsed.data);
    },
    onSuccess: (updated) => {
      upsertTask(queryClient, updated);
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>The Planner has a Question</DialogTitle>
          <DialogDescription>{task.title}</DialogDescription>
        </DialogHeader>

        <p className="text-sm leading-relaxed">{question.text}</p>

        {options.length > 0 ? (
          <div role="radiogroup" aria-label="Options" className="flex flex-col gap-2">
            {options.map((option) => {
              const checked = selected === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => setSelected(option)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                    checked && "border-primary bg-accent",
                  )}
                >
                  {option}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="question-answer">Your answer</Label>
            <Textarea id="question-answer" value={freeText} onChange={(e) => setFreeText(e.target.value)} autoFocus />
          </div>
        )}

        {submit.error && <p className="text-sm text-red-300">{submit.error.message}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => submit.mutate()} disabled={!parsed.success || submit.isPending}>
            {submit.isPending ? "Sending…" : "Submit answer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
