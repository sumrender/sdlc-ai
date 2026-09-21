import type { Sandbox, SandboxCreateOptions, SandboxRunner } from "../ports.js";

/**
 * One long-lived container per Task when `reuseSandbox` is enabled.
 * Setup (clone + manifest setup) runs once; every gate after that reuses the
 * same container with a fresh OpenCode session (`--session` omitted) and a
 * `git status --porcelain` clean-guard before the switch.
 */
export class TaskSandboxPool implements SandboxRunner {
  private readonly shared = new Map<string, { sandbox: Sandbox; lastUsedAt: number }>();
  // Sandboxes a Task owns outright (reuseSandbox off, or a per-run container).
  // The pool is the only place that knows all of a Task's live containers, so
  // Stop/Delete can destroy them even though their run started them.
  private readonly owned = new Map<string, Set<Sandbox>>();
  // Serialize all operations that touch /workspace for a given taskId.
  // Parallel reviewers otherwise race on git fetch/checkout/reset + .opencode writes
  // inside the same container.
  private readonly chains = new Map<string, Promise<void>>();

  constructor(private readonly inner: SandboxRunner) {}

  async create(options: SandboxCreateOptions): Promise<Sandbox> {
    return this.inner.create(options);
  }

  /**
   * Registers a non-shared Sandbox under its Task so `destroyTask` can reach
   * it. Returns a release function the caller runs when the run finishes and
   * destroys (or abandons) the container itself.
   */
  registerOwned(taskId: string, sandbox: Sandbox): () => void {
    let set = this.owned.get(taskId);
    if (!set) {
      set = new Set();
      this.owned.set(taskId, set);
    }
    set.add(sandbox);
    return () => {
      set!.delete(sandbox);
      if (set!.size === 0) this.owned.delete(taskId);
    };
  }

  sharedName(taskId: string): string {
    return `sdlc-task-${taskId.slice(0, 8)}`;
  }

  has(taskId: string): boolean {
    return this.shared.has(taskId);
  }

  async acquire(taskId: string): Promise<Sandbox> {
    const existing = this.shared.get(taskId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.sandbox;
    }
    const sandbox = await this.inner.create({ name: this.sharedName(taskId) });
    this.shared.set(taskId, { sandbox, lastUsedAt: Date.now() });
    return sandbox;
  }

  /** Serialize workspace-touching work for a task (prepareWorkspaceReuse, etc.). */
  async withLock<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(taskId) ?? Promise.resolve();
    let release: () => void;
    const next = new Promise<void>((res) => (release = res));
    this.chains.set(taskId, prev.then(() => next));
    await prev;
    try {
      return await fn();
    } finally {
      release!();
      if (this.chains.get(taskId) === next) this.chains.delete(taskId);
      else next.then(() => { if (this.chains.get(taskId) === next) this.chains.delete(taskId); });
    }
  }

  /** Destroys every container the Task holds: the shared reuse container and any owned per-run ones. */
  async destroyTask(taskId: string): Promise<void> {
    const entry = this.shared.get(taskId);
    this.shared.delete(taskId);
    const owned = [...(this.owned.get(taskId) ?? [])];
    this.owned.delete(taskId);
    await Promise.all([
      entry ? entry.sandbox.destroy().catch(() => undefined) : Promise.resolve(),
      ...owned.map((s) => s.destroy().catch(() => undefined)),
    ]);
  }

  async clear(): Promise<void> {
    const entries = [...this.shared.entries()];
    const owned = [...this.owned.values()].flatMap((set) => [...set]);
    this.shared.clear();
    this.owned.clear();
    await Promise.all([...entries.map(([, e]) => e.sandbox.destroy().catch(() => undefined)), ...owned.map((s) => s.destroy().catch(() => undefined))]);
  }
}
