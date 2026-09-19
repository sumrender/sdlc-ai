import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { tasks } from "./routes/tasks.js";

const app = new Hono();

app.use("*", cors({ origin: process.env.FE_ORIGIN ?? "http://localhost:3000" }));
app.get("/health", (c) => c.json({ ok: true }));
app.route("/tasks", tasks);

const port = Number(process.env.PORT ?? 4000);
serve({ fetch: app.fetch, port });
console.log(`api listening on :${port}`);
