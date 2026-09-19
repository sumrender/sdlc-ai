import { SandboxError } from "../errors.js";
import type { ExecOptions, ExecResult, Sandbox, SandboxRunner } from "../ports.js";
import { runProcess, shellQuote } from "./process.js";

export const WORKSPACE = "/workspace";
const CACHE_VOLUME = "sdlc-ai-cache";
const OPENCODE_VOLUME = "sdlc-ai-opencode";

export class DockerSandboxRunner implements SandboxRunner {
  constructor(
    private readonly image: string,
    private readonly dockerBin: string,
  ) {}

  async create({ name }: { name: string }): Promise<Sandbox> {
    const args = [
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "-v",
      `${CACHE_VOLUME}:/cache`,
      "-v",
      `${OPENCODE_VOLUME}:/root/.local/share/opencode`,
      "-e",
      "npm_config_cache=/cache/npm",
      "-e",
      "NUGET_PACKAGES=/cache/nuget",
      "-e",
      "CI=1",
      "-w",
      WORKSPACE,
      this.image,
      "sleep",
      "infinity",
    ];
    let result: ExecResult;
    try {
      result = await runProcess(this.dockerBin, args);
    } catch (e) {
      throw new SandboxError(`failed to spawn docker: ${(e as Error).message}`);
    }
    if (result.exitCode !== 0) {
      throw new SandboxError(`docker run failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }
    return new DockerSandbox(name, this.dockerBin);
  }
}

class DockerSandbox implements Sandbox {
  constructor(
    readonly name: string,
    private readonly dockerBin: string,
  ) {}

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    const args = ["exec", "-i"];
    if (options.cwd) args.push("-w", options.cwd);
    for (const [key, value] of Object.entries(options.env ?? {})) args.push("-e", `${key}=${value}`);
    args.push(this.name, "bash", "-c", command);
    try {
      return await runProcess(this.dockerBin, args, {
        stdin: options.stdin,
        timeoutMs: options.timeoutMs,
        onLine: options.onLine,
      });
    } catch (e) {
      throw new SandboxError(`docker exec failed: ${(e as Error).message}`);
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    const result = await this.exec(`mkdir -p "$(dirname ${shellQuote(path)})" && cat > ${shellQuote(path)}`, {
      stdin: content,
    });
    if (result.exitCode !== 0) throw new SandboxError(`writeFile ${path} failed: ${result.stderr}`);
  }

  async copyOut(containerPath: string, hostDir: string): Promise<boolean> {
    const result = await runProcess(this.dockerBin, ["cp", `${this.name}:${containerPath}`, hostDir]);
    return result.exitCode === 0;
  }

  async destroy(): Promise<void> {
    await runProcess(this.dockerBin, ["rm", "-f", this.name]).catch(() => undefined);
  }
}
