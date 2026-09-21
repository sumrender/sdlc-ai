import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stopAvailability } from "@sdlc-ai/shared";
import { TaskSandboxPool } from "../sandbox/task-pool.js";
import type { Sandbox } from "../ports.js";

// See e2e.test.ts: the module graph reaches db/index.js, whose postgres client
// is lazy, so a well-formed URL is enough to import it.
process.env.DATABASE_URL ??= "postgres://sdlc:sdlc@127.0.0.1:5432/sdlc_test";

// These suites exercise the pure/protocol pieces of Stop and Delete that do
// not need a live Postgres: the availability gate and the sandbox pool's
// bookkeeping (the part Stop leans on to free containers mid-run).

describe("stopAvailability", () => {
  it("allows stopping a RUNNING task", () => {
    assert.deepEqual(stopAvailability({ status: "RUNNING" }), { allowed: true });
  });

  it("refuses READY, WAITING, FAILED, and COMPLETED tasks", () => {
    for (const status of ["READY", "WAITING", "FAILED", "COMPLETED"] as const) {
      const result = stopAvailability({ status });
      assert.equal(result.allowed, false);
      assert.match(result.allowed ? "" : result.reason, /RUNNING/);
    }
  });
});

// A StubSandbox records destruction so tests can assert what Stop would free.
class StubSandbox implements Sandbox {
  destroyed = false;
  constructor(readonly name: string) {}
  async exec(): Promise<never> {
    throw new Error("not used in this suite");
  }
  async writeFile(): Promise<void> {}
  async copyOut(): Promise<boolean> {
    return false;
  }
  async destroy(): Promise<void> {
    this.destroyed = true;
  }
}

describe("TaskSandboxPool owned-sandbox bookkeeping", () => {
  it("destroyTask destroys the shared container", async () => {
    const pool = new TaskSandboxPool({
      create: async ({ name }: { name: string }) => new StubSandbox(name),
    });
    const shared = await pool.acquire("task-1");
    await pool.destroyTask("task-1");
    assert.equal((shared as StubSandbox).destroyed, true);
    assert.equal(pool.has("task-1"), false);
  });

  it("destroyTask destroys owned per-run containers registered mid-run", async () => {
    const pool = new TaskSandboxPool({
      create: async ({ name }: { name: string }) => new StubSandbox(name),
    });
    const owned = new StubSandbox("sdlc-developer-owned");
    const release = pool.registerOwned("task-2", owned);

    await pool.destroyTask("task-2");
    assert.equal(owned.destroyed, true);
    assert.equal((owned as StubSandbox).destroyed, true);

    // After release the registry is empty; destroying again is a no-op, not a crash.
    release();
    await pool.destroyTask("task-2");
  });

  it("destroyTask leaves other tasks' containers untouched", async () => {
    const pool = new TaskSandboxPool({
      create: async ({ name }: { name: string }) => new StubSandbox(name),
    });
    const keep = await pool.acquire("task-keep");
    const other = new StubSandbox("owned-other");
    pool.registerOwned("task-other", other);

    await pool.destroyTask("task-gone");
    assert.equal((keep as StubSandbox).destroyed, false);
    assert.equal(other.destroyed, false);
  });

  it("clear() also destroys owned containers", async () => {
    const pool = new TaskSandboxPool({
      create: async ({ name }: { name: string }) => new StubSandbox(name),
    });
    const owned = new StubSandbox("owned-clear");
    pool.registerOwned("task-3", owned);
    await pool.clear();
    assert.equal(owned.destroyed, true);
  });
});
