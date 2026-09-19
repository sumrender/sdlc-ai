import { z } from "zod";

export const CreateTaskInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000).default(""),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

export const AnswerQuestionInputSchema = z.object({
  answer: z.string().trim().min(1).max(4_000),
});
export type AnswerQuestionInput = z.infer<typeof AnswerQuestionInputSchema>;

export const DecideApprovalInputSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("APPROVED") }),
  z.object({ decision: z.literal("REJECTED"), feedback: z.string().trim().min(1).max(10_000) }),
]);
export type DecideApprovalInput = z.infer<typeof DecideApprovalInputSchema>;

export const DEMO_TASK = {
  title: "Show the template count in the gallery header",
  description:
    "Display the total number of available templates in the gallery page header so users can see how many templates exist at a glance.",
} as const;
