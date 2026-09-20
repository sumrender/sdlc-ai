import type { Sandbox, SandboxCreateOptions, SandboxRunner } from "../ports.js";

/**
 * One long-lived container per Task when `reuseSandbox` is enabled.
 * Setup (clone + manifest setup) runs once; every gate after that reuses the
 * same container with a fresh OpenCode session (`--session` omitted) and a
 * `git status --porcelain` clean-guard before the switch.
 */
export class TaskSandboxPool implements SandboxRunner {
  private readonly shared = new Map<string, { sandbox: Sandbox; lastUsedAt: number }>();
  // Serialize all operations that touch /workspace for a given taskId.
  // Parallel reviewers otherwise race on git fetch/checkout/reset + .opencode writes
  // inside the same container.
  private readonly chains = new Map<string, Promise<void>>();

  constructor(private readonly inner: SandboxRunner) {}

  async create(options: SandboxCreateOptions): Promise<Sandbox> {
    return this.inner.create(options);
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

  async destroyTask(taskId: string): Promise<void> {
    const entry = this.shared.get(taskId);
    if (!entry) return;
    this.shared.delete(taskId);
    await entry.sandbox.destroy().catch(() => undefined);
  }

  async clear(): Promise<void> {
    const entries = [...this.shared.entries()];
    this.shared.clear();
    await Promise.all(entries.map(([, e]) => e.sandbox.destroy().catch(() => undefined)));
  }
}
