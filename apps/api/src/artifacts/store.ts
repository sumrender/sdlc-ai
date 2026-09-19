import fs from "node:fs/promises";
import path from "node:path";
import type { ArtifactType } from "@sdlc-ai/shared";
import { db } from "../db/index.js";
import { artifacts, type ArtifactRow } from "../db/schema.js";
import { HttpError } from "../errors.js";

const EXTENSION_TYPES: Record<string, ArtifactType> = {
  ".png": "SCREENSHOT",
  ".jpg": "SCREENSHOT",
  ".jpeg": "SCREENSHOT",
  ".webm": "VIDEO",
  ".mp4": "VIDEO",
  ".zip": "TRACE",
  ".log": "LOG",
  ".txt": "LOG",
  ".diff": "DIFF",
  ".patch": "DIFF",
};

export const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".zip": "application/zip",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".js": "text/javascript",
  ".css": "text/css",
  ".log": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".diff": "text/plain; charset=utf-8",
};

export class ArtifactStore {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private taskDir(taskId: string) {
    return path.join(this.root, taskId);
  }

  async testRunDir(taskId: string, testRunId: string): Promise<string> {
    const dir = path.join(this.taskDir(taskId), "test-runs", testRunId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async saveLog(input: { taskId: string; agentRunId?: string; testRunId?: string; name: string; content: string }): Promise<ArtifactRow> {
    const dir = path.join(this.taskDir(input.taskId), "logs");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${input.agentRunId ?? input.testRunId ?? "task"}-${input.name}`);
    await fs.writeFile(file, input.content, "utf8");
    return this.register({
      taskId: input.taskId,
      agentRunId: input.agentRunId,
      testRunId: input.testRunId,
      type: "LOG",
      name: input.name,
      storagePath: file,
      sizeBytes: Buffer.byteLength(input.content),
    });
  }

  async saveText(input: { taskId: string; agentRunId?: string; type: ArtifactType; name: string; content: string }): Promise<ArtifactRow> {
    const dir = path.join(this.taskDir(input.taskId), "files");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${input.agentRunId ?? "task"}-${input.name}`);
    await fs.writeFile(file, input.content, "utf8");
    return this.register({ ...input, storagePath: file, sizeBytes: Buffer.byteLength(input.content) });
  }

  async importDir(input: { taskId: string; testRunId: string; dir: string; prefix: string }): Promise<number> {
    let count = 0;
    const walk = async (current: string) => {
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        const relative = path.relative(input.dir, full).split(path.sep).join("/");
        const ext = path.extname(entry.name).toLowerCase();
        const type: ArtifactType = EXTENSION_TYPES[ext] ?? "TEST_REPORT";
        const stat = await fs.stat(full);
        await this.register({
          taskId: input.taskId,
          testRunId: input.testRunId,
          type,
          name: `${input.prefix}/${relative}`,
          storagePath: full,
          sizeBytes: stat.size,
        });
        count++;
      }
    };
    await walk(input.dir);
    return count;
  }

  private async register(values: {
    taskId: string;
    agentRunId?: string;
    testRunId?: string;
    type: ArtifactType;
    name: string;
    storagePath: string;
    sizeBytes: number;
  }): Promise<ArtifactRow> {
    const [row] = await db
      .insert(artifacts)
      .values({
        taskId: values.taskId,
        agentRunId: values.agentRunId ?? null,
        testRunId: values.testRunId ?? null,
        type: values.type,
        name: values.name,
        storagePath: values.storagePath,
        sizeBytes: values.sizeBytes,
      })
      .returning();
    return row!;
  }

  resolvePath(artifact: ArtifactRow): string {
    const abs = path.resolve(artifact.storagePath);
    if (!abs.startsWith(this.root + path.sep)) throw new HttpError(403, "artifact path outside store");
    return abs;
  }

  async clear(): Promise<void> {
    await fs.rm(this.root, { recursive: true, force: true });
  }
}
