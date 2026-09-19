import type { Sandbox } from "../ports.js";
import { WORKSPACE } from "./docker.js";
import { shellQuoteIfNeeded } from "./process.js";

export interface OpenCodeOptions {
  agent: string;
  model: string;
  prompt: string;
  apiKey: string;
  sessionId?: string | null;
  timeoutMs: number;
  onLine: (line: string) => void;
}

export interface OpenCodeResult {
  text: string;
  sessionId: string | null;
  exitCode: number;
  timedOut: boolean;
}

export async function runOpenCode(sandbox: Sandbox, options: OpenCodeOptions): Promise<OpenCodeResult> {
  const args = ["opencode", "run", "--format", "json", "--agent", options.agent, "--model", `anthropic/${options.model}`];
  if (options.sessionId) args.push("--session", options.sessionId);
  const command = args.map(shellQuoteIfNeeded).join(" ");

  const parts = new Map<string, string>();
  let anonymous = "";
  let sessionId: string | null = null;

  const result = await sandbox.exec(command, {
    cwd: WORKSPACE,
    stdin: options.prompt,
    env: { ANTHROPIC_API_KEY: options.apiKey },
    timeoutMs: options.timeoutMs,
    onLine: (line, stream) => {
      if (!line.trim()) return;
      const event = tryParseJson(line);
      if (!event) {
        if (stream === "stdout") anonymous += line + "\n";
        options.onLine(stream === "stderr" ? `[stderr] ${line}` : line);
        return;
      }
      sessionId ??= extractSessionId(event);
      const text = extractText(event);
      if (text) {
        const id = extractPartId(event);
        if (id) parts.set(id, text);
        else anonymous += text;
      }
      const display = describeEvent(event);
      if (display) options.onLine(display);
    },
  });

  const text = [...parts.values(), anonymous].join("\n").trim();
  return { text, sessionId, exitCode: result.exitCode, timedOut: result.timedOut };
}

type Json = Record<string, unknown>;

function tryParseJson(line: string): Json | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const value = JSON.parse(trimmed);
    return value && typeof value === "object" ? (value as Json) : null;
  } catch {
    return null;
  }
}

function pick(obj: unknown, ...paths: string[]): unknown {
  for (const path of paths) {
    let cur: unknown = obj;
    for (const key of path.split(".")) {
      if (!cur || typeof cur !== "object") {
        cur = undefined;
        break;
      }
      cur = (cur as Json)[key];
    }
    if (cur !== undefined && cur !== null) return cur;
  }
  return undefined;
}

function extractSessionId(event: Json): string | null {
  const value = pick(event, "sessionID", "sessionId", "session_id", "part.sessionID", "info.sessionID", "properties.sessionID", "properties.info.id");
  return typeof value === "string" ? value : null;
}

function extractPartId(event: Json): string | null {
  const value = pick(event, "part.id", "properties.part.id", "id");
  return typeof value === "string" ? value : null;
}

function extractText(event: Json): string | null {
  const part = (pick(event, "part", "properties.part") ?? event) as Json;
  if (part.type === "text" && typeof part.text === "string") return part.text;
  if (event.type === "text" && typeof event.text === "string") return event.text;
  return null;
}

function describeEvent(event: Json): string | null {
  const part = (pick(event, "part", "properties.part") ?? event) as Json;
  const type = typeof part.type === "string" ? part.type : typeof event.type === "string" ? event.type : null;
  if (!type) return null;
  switch (type) {
    case "text":
      return typeof part.text === "string" ? part.text : null;
    case "tool":
    case "tool_use":
    case "tool-invocation": {
      const tool = pick(part, "tool", "name", "state.title") ?? "tool";
      const status = pick(part, "state.status");
      const title = pick(part, "state.title");
      return `[tool] ${String(tool)}${status ? ` (${String(status)})` : ""}${title ? ` ${String(title)}` : ""}`;
    }
    case "step-start":
    case "step_start":
      return "[step] start";
    case "step-finish":
    case "step_finish":
      return "[step] finish";
    case "reasoning":
      return typeof part.text === "string" ? `[reasoning] ${part.text}` : null;
    case "error":
      return `[error] ${JSON.stringify(pick(event, "error", "properties.error") ?? event)}`;
    default:
      return `[${type}]`;
  }
}

export function extractJsonBlock(text: string): unknown | null {
  const fenced = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/g)];
  for (let i = fenced.length - 1; i >= 0; i--) {
    const candidate = fenced[i]![1]!;
    try {
      return JSON.parse(candidate);
    } catch {
      // try earlier block
    }
  }
  const start = text.lastIndexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // not JSON
    }
  }
  return null;
}
