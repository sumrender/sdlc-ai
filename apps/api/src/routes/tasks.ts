import { Hono } from "hono";

export const tasks = new Hono();

tasks.get("/", (c) => c.json([]));
