import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { bus, messageTaskId } from "../events/bus.js";

const KEEPALIVE_MS = 15_000;

export function eventRoutes() {
  const r = new Hono();

  r.get("/", (c) => {
    const taskId = c.req.query("taskId");
    return streamSSE(c, async (stream) => {
      let open = true;
      const unsubscribe = bus.subscribe((message) => {
        if (!open) return;
        if (taskId && messageTaskId(message) !== taskId) return;
        void stream.writeSSE({ event: message.kind, data: JSON.stringify(message) }).catch(() => undefined);
      });
      stream.onAbort(() => {
        open = false;
        unsubscribe();
      });
      await stream.writeSSE({ event: "ready", data: JSON.stringify({ taskId: taskId ?? null, at: new Date().toISOString() }) });
      while (open) {
        await stream.sleep(KEEPALIVE_MS);
        if (open) await stream.writeSSE({ event: "ping", data: "" }).catch(() => undefined);
      }
    });
  });

  return r;
}
