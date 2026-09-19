export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Infrastructure failure (docker unavailable, container died). Eligible for one automatic retry.
export class SandboxError extends Error {}

export class TimeoutError extends Error {}

// The agent or the project misbehaved (bad output, failing setup/checks). Not retried automatically.
export class AgentOutputError extends Error {}

export class WorkspaceError extends Error {}

export class ManifestError extends Error {}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
