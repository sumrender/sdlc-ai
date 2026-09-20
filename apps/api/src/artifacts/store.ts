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

/**
 * The directory name the Playwright HTML reporter lands under inside a Test Run
 * directory. `importDir` is called with `dir: <testRunDir>/<basename of the
 * manifest artifact path>`, and the manifest points at `<app>/playwright-report`,
 * so the copied tree is always rooted here. Both the report-serving route and
 * the attachment skip rule key off this name.
 *
 * LIMITATION: this assumes Playwright's default `outputFolder`. A Project whose
 * reporter writes somewhere else (`[['html', { outputFolder: 'reports/e2e' }]]`)
 * still gets its report copied out and registered as an Artifact, but the report
 * route cannot root it and the iframe falls back to the single-file content URL —
 * so the report renders with broken `data/*` attachment links. The name is also
 * duplicated client-side in `apps/web/src/components/ArtifactViewer.tsx`
 * (`reportRelativePath`), which cannot import from `apps/api`.
 *
 * The fix is to stop guessing: derive the report directory from the Project
 * Manifest rather than from convention, and move the resulting constant into
 * `packages/shared` so both sides read one value. That means teaching
 * `E2eSchema` about the reporter output folder, so it is deferred until a second
 * repo actually needs it.
 */
export const PLAYWRIGHT_REPORT_DIR = "playwright-report";

/**
 * Playwright's HTML reporter keeps its *own* copy of every attachment under
 * `playwright-report/data/`. Those bytes have to stay on disk — the report HTML
 * links them relatively and the report route streams them — but they must not
 * become Artifact rows: the same videos and screenshots are already imported
 * from `test-results`, so registering both would double the reported storage and
 * show every recording twice in the Test Run media list. Standalone VIDEO and
 * SCREENSHOT Artifacts come from `test-results` only.
 */
export function isPlaywrightReportAttachment(name: string): boolean {
  const segments = name.split("/");
  const reportIndex = segments.lastIndexOf(PLAYWRIGHT_REPORT_DIR);
  // Needs a `data` segment straight after the report folder, and at least one
  // more segment after that — otherwise `data` is a file, not the attachment dir.
  return reportIndex !== -1 && segments[reportIndex + 1] === "data" && segments.length > reportIndex + 2;
}

export class ArtifactStore {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private taskDir(taskId: string) {
    return path.join(this.root, taskId);
  }

  /** Where a Test Run's copied-out files live, without creating the directory. Read paths use this; `testRunDir` is for writers. */
  testRunDirPath(taskId: string, testRunId: string): string {
    return path.join(this.taskDir(taskId), "test-runs", testRunId);
  }

  /** Where a Test Run's Playwright HTML report tree lives, without creating the directory. */
  reportDirPath(taskId: string, testRunId: string): string {
    return path.join(this.testRunDirPath(taskId, testRunId), PLAYWRIGHT_REPORT_DIR);
  }

  async testRunDir(taskId: string, testRunId: string): Promise<string> {
    const dir = this.testRunDirPath(taskId, testRunId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  /**
   * Resolves an untrusted, caller-supplied relative path against a directory
   * inside the store. Mirrors `resolvePath`'s containment check: after
   * normalisation the result must still sit under `dir`, so `../` segments (and
   * their percent-encoded forms, already decoded by the router) cannot escape.
   */
  resolveWithin(dir: string, relative: string): string {
    const base = path.resolve(dir);
    const abs = path.resolve(base, relative);
    if (abs !== base && !abs.startsWith(base + path.sep)) throw new HttpError(403, "path outside artifact directory");
    return abs;
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

  /**
   * Registers every file under `dir` as an Artifact of the Test Run. Returns how
   * many rows were created, which is *not* the file count: report attachments
   * (see `isPlaywrightReportAttachment`) are left on disk unregistered.
   */
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
        const name = `${input.prefix}/${relative}`;
        // The file stays where it was copied; it just never becomes an Artifact row.
        if (isPlaywrightReportAttachment(name)) continue;
        const ext = path.extname(entry.name).toLowerCase();
        const type: ArtifactType = EXTENSION_TYPES[ext] ?? "TEST_REPORT";
        const stat = await fs.stat(full);
        await this.register({
          taskId: input.taskId,
          testRunId: input.testRunId,
          type,
          name,
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
