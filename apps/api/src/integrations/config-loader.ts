import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ProjectConfigSchema,
  fullSetup,
  hashManifest,
  toProjectManifest,
  type ProjectConfig,
  type ProjectManifest,
} from "@sdlc-ai/shared";
import { ManifestError, errorMessage } from "../errors.js";
import type { GitHubService } from "../ports.js";

export { hashManifest };

/** Project config lives in the local `sdlc.config.ts`. Failures return
 * `{ok:false,error}` — never process.exit. */
export const LOCAL_CONFIG_SOURCE = "sdlc.config.ts" as const;

export type LocalConfigOk = {
  ok: true;
  config: ProjectConfig;
  manifest: ProjectManifest;
  /** sha256 of the canonical manifest JSON: same content => same hash, any source. */
  hash: string;
  loadedAt: string;
  source: typeof LOCAL_CONFIG_SOURCE;
  path: string;
};
export type LocalConfigErr = { ok: false; error: string; path?: string };
export type LocalConfigRead = LocalConfigOk | LocalConfigErr;

/** Minimal shape of a task row needed for config pinning (avoids importing db schema). */
export interface TaskConfigPin {
  configHash?: string | null;
}

let currentHash: string | null = null;
let currentLoadedAt: string | null = null;
let currentSource: string | null = null;
let epoch = 0;
let forceCounter = 0;
/** hash -> manifest snapshots so reviewers in one stage share one manifest. */
const snapshots = new Map<string, ProjectManifest>();

/**
 * setupHash = sha256(configHash + JSON(fullSetup) + imageStamp).
 * A config reload (new hash) or image rebuild (new stamp) invalidates the
 * "Setup skipped" cache; anything else reuses the warm container.
 */
export function computeSetupHash(manifest: ProjectManifest, configHash?: string | null, imageStamp?: string | null): string {
  return createHash("sha256")
    .update(`${configHash ?? "repo"}:${JSON.stringify(fullSetup(manifest))}:${imageStamp ?? "unknown"}`)
    .digest("hex");
}

function noteResolved(hash: string, manifest: ProjectManifest, source: string): void {
  snapshots.set(hash, manifest);
  if (snapshots.size > 20) {
    const oldest = snapshots.keys().next().value;
    if (oldest !== undefined) snapshots.delete(oldest);
  }
  if (hash !== currentHash) {
    currentHash = hash;
    currentLoadedAt = new Date().toISOString();
    currentSource = source;
    epoch += 1;
  }
}

/** Pinned snapshot for a task's configHash, if still cached. */
export function getSnapshot(hash: string): ProjectManifest | undefined {
  return snapshots.get(hash);
}

export function getCurrentConfigHash(): string | null {
  return currentHash;
}

export function getConfigEpoch(): number {
  return epoch;
}

/** Rev metadata for the Settings label (`sdlc.config.ts · rev <hash> · <time>`). Null until the first successful read. */
export function getCurrentConfigMeta(): { hash: string; loadedAt: string; source: string } | null {
  if (currentHash === null || currentLoadedAt === null || currentSource === null) return null;
  return { hash: currentHash, loadedAt: currentLoadedAt, source: currentSource };
}

/** Test hook: reset module state between cases. */
export function resetConfigLoaderForTests(): void {
  currentHash = null;
  currentLoadedAt = null;
  currentSource = null;
  epoch = 0;
  snapshots.clear();
}

/** SDLC_CONFIG_PATH wins; otherwise walk up from cwd to the repo root. */
export function resolveConfigPath(): string | null {
  const override = process.env.SDLC_CONFIG_PATH;
  if (override) return path.resolve(override);
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(dir, "sdlc.config.ts");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Import sdlc.config.ts -> safeParse -> manifest. Never throws, never exits. */
export async function loadLocalConfig(options: { force?: boolean } = {}): Promise<LocalConfigRead> {
  const configPath = resolveConfigPath();
  if (!configPath) {
    return { ok: false, error: "sdlc.config.ts not found (set SDLC_CONFIG_PATH or add sdlc.config.ts at the repo root)" };
  }
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(configPath).mtimeMs;
  } catch (e) {
    return { ok: false, error: `could not stat ${configPath}: ${errorMessage(e)}`, path: configPath };
  }
  try {
    if (options.force) forceCounter += 1;
    const url = `${pathToFileURL(configPath).href}?mtime=${Math.floor(mtimeMs)}${options.force ? `&reload=${forceCounter}` : ""}`;
    const mod = (await import(url)) as { default?: unknown; config?: unknown };
    // ESM first, then one CJS-interop unwrap (a .ts config under a CJS
    // package.json arrives shaped as { default: X }).
    const candidates: unknown[] = [mod.default ?? mod.config ?? mod];
    if (candidates[0] !== null && typeof candidates[0] === "object" && "default" in (candidates[0] as Record<string, unknown>)) {
      candidates.push((candidates[0] as { default: unknown }).default);
    }
    let issues: string | null = null;
    for (const candidate of candidates) {
      const parsed = ProjectConfigSchema.safeParse(candidate);
      if (parsed.success) {
        const manifest = toProjectManifest(parsed.data);
        const hash = hashManifest(manifest);
        noteResolved(hash, manifest, LOCAL_CONFIG_SOURCE);
        return { ok: true, config: parsed.data, manifest, hash, loadedAt: currentLoadedAt ?? new Date().toISOString(), source: LOCAL_CONFIG_SOURCE, path: configPath };
      }
      issues = parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
    }
    return { ok: false, error: `sdlc.config.ts failed validation: ${issues}`, path: configPath };
  } catch (e) {
    return { ok: false, error: `could not load ${configPath}: ${errorMessage(e)}`, path: configPath };
  }
}

/**
 * Local-only loader (same throw contract as the old repo loader).
 * `github`/`ref` are kept for call-site compat but the repo is never read:
 * a broken local config throws so routes/project.ts renders the amber
 * Settings state instead of silently running a stale fallback.
 */
export async function loadManifest(_github: GitHubService, _ref: string): Promise<ProjectManifest> {
  const local = await loadLocalConfig();
  if (local.ok) {
    console.log(`[config] local ${local.source} rev ${local.hash.slice(0, 12)} (epoch ${epoch})`);
    return local.manifest;
  }
  throw new ManifestError(local.error);
}

/** Task-pinned read: reviewers in one stage share the stamped snapshot. */
export async function loadManifestForTask(github: GitHubService, ref: string, task?: TaskConfigPin | null): Promise<ProjectManifest> {
  const pinned = task?.configHash ? getSnapshot(task.configHash) : undefined;
  if (pinned) return pinned;
  return loadManifest(github, ref);
}

/** Force a fresh import (busts the ESM cache), bumps the epoch when the hash changes. Never throws. */
export async function reloadLocalConfig(): Promise<LocalConfigRead> {
  return loadLocalConfig({ force: true });
}

/**
 * mtime watch on the local config file. Calls onReload only when the content
 * hash changes. Returns a stop function. Never throws, never exits.
 */
export function startConfigWatch(options: {
  onReload: (info: { hash: string; source: string; epoch: number }) => void | Promise<void>;
  pollMs?: number;
}): () => void {
  const configPath = resolveConfigPath() ?? path.resolve(process.cwd(), "sdlc.config.ts");
  let lastHash = currentHash;
  const check = async () => {
    const read = await loadLocalConfig().catch(
      (): LocalConfigRead => ({ ok: false, error: "config check failed" }),
    );
    if (read.ok && read.hash !== lastHash) {
      lastHash = read.hash;
      await options.onReload({ hash: read.hash, source: read.source, epoch });
    }
  };
  const listener = (curr: fs.Stats, prev: fs.Stats) => {
    if (curr.mtimeMs !== prev.mtimeMs) void check();
  };
  fs.watchFile(configPath, { interval: options.pollMs ?? 2000 }, listener);
  return () => {
    fs.unwatchFile(configPath, listener);
  };
}
