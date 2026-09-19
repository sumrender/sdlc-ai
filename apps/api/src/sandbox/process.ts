import { spawn } from "node:child_process";
import type { ExecResult, OutputStream } from "../ports.js";

export interface ProcessOptions {
  stdin?: string;
  timeoutMs?: number;
  onLine?: (line: string, stream: OutputStream) => void;
}

export function runProcess(bin: string, args: string[], options: ProcessOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const pending: Record<OutputStream, string> = { stdout: "", stderr: "" };

    const onData = (stream: OutputStream) => (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (stream === "stdout") stdout += text;
      else stderr += text;
      if (!options.onLine) return;
      pending[stream] += text;
      let idx: number;
      while ((idx = pending[stream].indexOf("\n")) >= 0) {
        const line = pending[stream].slice(0, idx).replace(/\r$/, "");
        pending[stream] = pending[stream].slice(idx + 1);
        options.onLine(line, stream);
      }
    };

    child.stdout.on("data", onData("stdout"));
    child.stderr.on("data", onData("stderr"));

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, options.timeoutMs)
      : null;

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (options.onLine) {
        for (const stream of ["stdout", "stderr"] as const) {
          if (pending[stream]) options.onLine(pending[stream], stream);
        }
      }
      resolve({ exitCode: code ?? -1, stdout, stderr, timedOut });
    });

    child.stdin.on("error", () => {});
    child.stdin.end(options.stdin ?? "");
  });
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function shellQuoteIfNeeded(value: string): string {
  return /^[A-Za-z0-9_\-./:=@]+$/.test(value) ? value : shellQuote(value);
}
