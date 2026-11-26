import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { bus, messageProjectId, messageTaskId } from "../events/bus.js";
import { findProject } from "../pipeline/tasks.js";

const KEEPALIVE_MS = 15_000;

export function eventRoutes() {
  const r = new Hono();

  r.get("/", async (c) => {
    const taskId = c.req.query("taskId");
    const rawProjectId = c.req.query("projectId");
    const projectId = rawProjectId ? ((await findProject(rawProjectId))?.id ?? rawProjectId) : undefined;
    return streamSSE(c, async (stream) => {
      let open = true;
      const unsubscribe = bus.subscribe((message) => {
        if (!open) return;
        if (taskId && messageTaskId(message) !== taskId) return;
        if (projectId && messageProjectId(message) !== projectId) return;
        void stream.writeSSE({ event: message.kind, data: JSON.stringify(message) }).catch(() => undefined);
      });
      stream.onAbort(() => {
        open = false;
        unsubscribe();
      });
      await stream.writeSSE({
        event: "ready",
        data: JSON.stringify({ taskId: taskId ?? null, projectId: projectId ?? null, at: new Date().toISOString() }),
      });
      while (open) {
        await stream.sleep(KEEPALIVE_MS);
        if (open) await stream.writeSSE({ event: "ping", data: "" }).catch(() => undefined);
      }
    });
  });

  return r;
}
