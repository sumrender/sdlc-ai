import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { CONTENT_TYPES, type ArtifactStore } from "../artifacts/store.js";
import { db } from "../db/index.js";
import { artifacts } from "../db/schema.js";
import { HttpError } from "../errors.js";

export function artifactRoutes(store: ArtifactStore) {
  const r = new Hono();

  r.get("/:id", async (c) => {
    const row = await find(c.req.param("id"));
    const { storagePath: _storagePath, ...publicRow } = row;
    return c.json(publicRow);
  });

  r.get("/:id/content", async (c) => {
    const row = await find(c.req.param("id"));
    const file = store.resolvePath(row);
    const stat = await fs.promises.stat(file).catch(() => null);
    if (!stat) throw new HttpError(404, "Artifact file missing on disk");
    const ext = path.extname(file).toLowerCase();
    c.header("Content-Type", CONTENT_TYPES[ext] ?? "application/octet-stream");
    c.header("Content-Length", String(stat.size));
    if (c.req.query("download") === "1") c.header("Content-Disposition", `attachment; filename="${path.basename(row.name)}"`);
    return c.body(Readable.toWeb(fs.createReadStream(file)) as ReadableStream);
  });

  return r;
}

async function find(id: string) {
  const [row] = await db.select().from(artifacts).where(eq(artifacts.id, id)).limit(1);
  if (!row) throw new HttpError(404, "Artifact not found");
  return row;
}
