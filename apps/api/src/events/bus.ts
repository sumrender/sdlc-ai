import { EventEmitter } from "node:events";
import type { EventType, SseMessage } from "@sdlc-ai/shared";
import { db } from "../db/index.js";
import { events, type EventRow } from "../db/schema.js";

function serialize(row: EventRow): Extract<SseMessage, { kind: "event" }>["event"] {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  async emit(taskId: string, type: EventType, payload: Record<string, unknown> = {}): Promise<EventRow> {
    const [row] = await db.insert(events).values({ taskId, type, payload }).returning();
    this.broadcast({ kind: "event", event: serialize(row!) });
    return row!;
  }

  output(taskId: string, ref: { agentRunId?: string; testRunId?: string }, line: string) {
    this.broadcast({
      kind: "agent_output",
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
