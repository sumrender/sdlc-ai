import { EventEmitter } from "node:events";
import { eq } from "drizzle-orm";
import type { EventType, SseMessage } from "@sdlc-ai/shared";
import { db } from "../db/index.js";
import { events, tasks, type EventRow } from "../db/schema.js";

function serialize(row: EventRow): Extract<SseMessage, { kind: "event" }>["event"] {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

class EventBus {
  private readonly emitter = new EventEmitter();
  private readonly taskProjects = new Map<string, string>();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  bindTaskProject(taskId: string, projectId: string): void {
    this.taskProjects.set(taskId, projectId);
  }

  unbindTask(taskId: string): void {
    this.taskProjects.delete(taskId);
  }

  private async resolveProjectId(taskId: string, explicit?: string): Promise<string> {
    if (explicit) {
      this.taskProjects.set(taskId, explicit);
      return explicit;
    }
    const cached = this.taskProjects.get(taskId);
    if (cached) return cached;
    const [row] = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (row) {
      this.taskProjects.set(taskId, row.projectId);
      return row.projectId;
    }
    return "";
  }

  async emit(taskId: string, type: EventType, payload: Record<string, unknown> = {}, explicitProjectId?: string): Promise<EventRow> {
    const projectId = await this.resolveProjectId(taskId, explicitProjectId);
    const [row] = await db.insert(events).values({ taskId, type, payload }).returning();
    this.broadcast({ kind: "event", projectId, event: serialize(row!) });
    return row!;
  }

  output(taskId: string, ref: { agentRunId?: string; testRunId?: string }, line: string, explicitProjectId?: string) {
    const projectId = explicitProjectId ?? this.taskProjects.get(taskId) ?? "";
    this.broadcast({
      kind: "agent_output",
      projectId,
      taskId,
      agentRunId: ref.agentRunId ?? null,
      testRunId: ref.testRunId ?? null,
      line,
      at: new Date().toISOString(),
    });
  }

  subscribe(listener: (message: SseMessage) => void): () => void {
    this.emitter.on("message", listener);
    return () => this.emitter.off("message", listener);
  }

  private broadcast(message: SseMessage) {
    this.emitter.emit("message", message);
  }
}

export const bus = new EventBus();

export function messageTaskId(message: SseMessage): string {
  return message.kind === "event" ? message.event.taskId : message.taskId;
}

export function messageProjectId(message: SseMessage): string {
  return message.projectId;
}
