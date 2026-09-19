import type { DeploymentStatus } from "@sdlc-ai/shared";

export type OutputStream = "stdout" | "stderr";

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
  onLine?: (line: string, stream: OutputStream) => void;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface Sandbox {
  readonly name: string;
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  writeFile(path: string, content: string): Promise<void>;
  copyOut(containerPath: string, hostDir: string): Promise<boolean>;
  destroy(): Promise<void>;
}

export interface SandboxCreateOptions {
  name: string;
  // Named volume for OpenCode's session store. Only set for runs that must resume a session
  // started in an earlier Sandbox; the store is SQLite and does not tolerate concurrent Sandboxes.
  sessionVolume?: string;
}

export interface SandboxRunner {
  create(options: SandboxCreateOptions): Promise<Sandbox>;
}

export interface GitHubService {
  cloneUrl(): string;
  gitAuthHeader(): string;
  createIssue(title: string, body: string): Promise<{ number: number; url: string }>;
  createPullRequest(input: { title: string; head: string; base: string; body: string }): Promise<{ number: number; url: string }>;
  getChangedFiles(pullNumber: number): Promise<string[]>;
  squashMerge(pullNumber: number, commitTitle: string): Promise<{ sha: string }>;
  deleteBranch(name: string): Promise<void>;
  branchExists(name: string): Promise<boolean>;
  closeIssue(number: number): Promise<void>;
  closePullRequest(number: number): Promise<void>;
  listBranches(prefix: string): Promise<string[]>;
  getFileContent(path: string, ref: string): Promise<string | null>;
  connectionStatus(): Promise<{ ok: boolean; login?: string; error?: string }>;
}

export interface DeployLookup {
  status: DeploymentStatus;
  url: string | null;
  providerRef: string | null;
  error?: string;
}

export interface DeployProvider {
  getDeployment(commitSha: string): Promise<DeployLookup>;
}
