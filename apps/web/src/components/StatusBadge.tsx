import type { TaskStatus } from "@sdlc-ai/shared";
import { Badge, type BadgeProps } from "~/components/ui/badge";

const VARIANT: Record<TaskStatus, NonNullable<BadgeProps["variant"]>> = {
  READY: "secondary",
  RUNNING: "info",
  WAITING: "warning",
  FAILED: "destructive",
  COMPLETED: "success",
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <Badge variant={VARIANT[status]}>{status}</Badge>;
}
