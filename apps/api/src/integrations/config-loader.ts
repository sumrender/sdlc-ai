import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ProjectsConfigSchema,
  fullSetup,
  hashManifest,
  toProjectManifest,
  type ProjectConfig,
  type ProjectManifest,
} from "@sdlc-ai/shared";
import { ManifestError, errorMessage } from "../errors.js";

export { hashManifest };

/** Project configs live in the local `sdlc.config.ts`. Failures return `{ok:false,error}` — never process.exit. */
export const LOCAL_CONFIG_SOURCE = "sdlc.config.ts" as const;

export interface LoadedProjectConfig {
  slug: string;
  config: ProjectConfig;
  manifest: ProjectManifest;
  hash: string;
  loadedAt: string;
  source: typeof LOCAL_CONFIG_SOURCE;
  epoch: number;
}

export type LocalProjectsConfigOk = {
  ok: true;
  projects: Map<string, LoadedProjectConfig>;
  list: LoadedProjectConfig[];
  changedSlugs: string[];
  loadedAt: string;
  source: typeof LOCAL_CONFIG_SOURCE;
  path: string;
};

export type LocalProjectsConfigErr = { ok: false; error: string; path?: string };
export type LocalProjectsConfigRead = LocalProjectsConfigOk | LocalProjectsConfigErr;

/** Minimal shape of a task row needed for config pinning (avoids importing db schema). */
export interface TaskConfigPin {
  configHash?: string | null;
}

interface ProjectLoaderState {
  hash: string;
  loadedAt: string;
  source: typeof LOCAL_CONFIG_SOURCE;
  epoch: number;
  config: ProjectConfig;
  manifest: ProjectManifest;
  snapshots: Map<string, ProjectManifest>;
}

const MAX_SNAPSHOTS_PER_PROJECT = 20;
const stateBySlug = new Map<string, ProjectLoaderState>();
let lastConfigError: string | null = null;
let forceCounter = 0;

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

function recordSnapshot(snapshots: Map<string, ProjectManifest>, hash: string, manifest: ProjectManifest): void {
  snapshots.set(hash, manifest);
  if (snapshots.size > MAX_SNAPSHOTS_PER_PROJECT) {
    const oldest = snapshots.keys().next().value;
    if (oldest !== undefined) snapshots.delete(oldest);
  }
}

export function getProjectConfigHash(slug: string): string | null {
  return stateBySlug.get(slug)?.hash ?? null;
}

export function getProjectConfigEpoch(slug: string): number {
  return stateBySlug.get(slug)?.epoch ?? 0;
}

export function getProjectConfigMeta(slug: string): { hash: string; loadedAt: string; source: string } | null {
  const s = stateBySlug.get(slug);
  if (!s) return null;
  return { hash: s.hash, loadedAt: s.loadedAt, source: s.source };
}

export function getLoadedProjectConfig(slug: string): ProjectConfig | null {
  return stateBySlug.get(slug)?.config ?? null;
}

export function getLastConfigError(): string | null {
  return lastConfigError;
}

/** Test hook: reset module state between cases. */
export function resetConfigLoaderForTests(): void {
  stateBySlug.clear();
  lastConfigError = null;
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

/** Import sdlc.config.ts -> safeParse(ProjectsConfigSchema) -> per-slug state. Never throws, never exits. */
export async function loadLocalProjectsConfig(options: { force?: boolean } = {}): Promise<LocalProjectsConfigRead> {
  const configPath = resolveConfigPath();
  if (!configPath) {
    lastConfigError = "sdlc.config.ts not found (set SDLC_CONFIG_PATH or add sdlc.config.ts at the repo root)";
    return { ok: false, error: lastConfigError };
  }
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(configPath).mtimeMs;
  } catch (e) {
    lastConfigError = `could not stat ${configPath}: ${errorMessage(e)}`;
    return { ok: false, error: lastConfigError, path: configPath };
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
      const parsed = ProjectsConfigSchema.safeParse(candidate);
      if (parsed.success) {
        lastConfigError = null;
        const now = new Date().toISOString();
        const nextSlugs = new Set(parsed.data.map((c) => c.slug));
        const changedSlugs: string[] = [];

        // Detect removed slugs and drop their active config state.
        for (const existingSlug of [...stateBySlug.keys()]) {
          if (!nextSlugs.has(existingSlug)) {
            stateBySlug.delete(existingSlug);
            changedSlugs.push(existingSlug);
          }
        }

        const projectsMap = new Map<string, LoadedProjectConfig>();
        const list: LoadedProjectConfig[] = [];
        for (const config of parsed.data) {
          const manifest = toProjectManifest(config);
          const hash = hashManifest(manifest);
          const prev = stateBySlug.get(config.slug);
          const snapshots = prev?.snapshots ?? new Map<string, ProjectManifest>();
          recordSnapshot(snapshots, hash, manifest);

          const changed = !prev || prev.hash !== hash;
          const epoch = changed ? (prev?.epoch ?? 0) + 1 : prev.epoch;
          const loadedAt = changed ? now : prev.loadedAt;
          if (changed) changedSlugs.push(config.slug);

          const nextState: ProjectLoaderState = {
            hash,
            loadedAt,
            source: LOCAL_CONFIG_SOURCE,
            epoch,
            config,
            manifest,
            snapshots,
          };
          stateBySlug.set(config.slug, nextState);

          const entry: LoadedProjectConfig = {
            slug: config.slug,
            config,
            manifest,
            hash,
            loadedAt,
            source: LOCAL_CONFIG_SOURCE,
            epoch,
          };
          projectsMap.set(config.slug, entry);
          list.push(entry);
        }

        return {
          ok: true,
          projects: projectsMap,
          list,
          changedSlugs,
          loadedAt: now,
          source: LOCAL_CONFIG_SOURCE,
          path: configPath,
        };
      }
      issues = parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
    }
    lastConfigError = `sdlc.config.ts failed validation: ${issues}`;
    return { ok: false, error: lastConfigError, path: configPath };
  } catch (e) {
    lastConfigError = `could not load ${configPath}: ${errorMessage(e)}`;
    return { ok: false, error: lastConfigError, path: configPath };
  }
}

/** Force a fresh import (busts the ESM cache), bumping epochs only for changed projects. Never throws. */
export async function reloadLocalProjectsConfig(): Promise<LocalProjectsConfigRead> {
  return loadLocalProjectsConfig({ force: true });
}

/** Load the manifest for one configured project slug; throws ManifestError if missing/invalid. */
export async function loadManifestForSlug(slug: string): Promise<ProjectManifest> {
  const local = await loadLocalProjectsConfig();
  if (!local.ok) throw new ManifestError(local.error);
  const entry = local.projects.get(slug);
  if (!entry) throw new ManifestError(`Project "${slug}" is not configured in ${LOCAL_CONFIG_SOURCE}`);
  return entry.manifest;
}

/** Task-pinned read: reviewers in one stage share the stamped snapshot for that project. */
export async function loadManifestForTask(slug: string, task?: TaskConfigPin | null): Promise<ProjectManifest> {
  const pinned = task?.configHash ? stateBySlug.get(slug)?.snapshots.get(task.configHash) : undefined;
  if (pinned) return pinned;
  return loadManifestForSlug(slug);
}

/**
 * mtime watch on the local config file. Calls onReload only when at least one
 * project is added, removed, or changes manifest hash. Returns a stop function.
 */
export function startConfigWatch(options: {
  onReload: (changedSlugs: string[], read: LocalProjectsConfigOk) => void | Promise<void>;
  pollMs?: number;
}): () => void {
  const configPath = resolveConfigPath() ?? path.resolve(process.cwd(), "sdlc.config.ts");
  const check = async () => {
    const read = await loadLocalProjectsConfig().catch(
      (): LocalProjectsConfigRead => ({ ok: false, error: "config check failed" }),
    );
    if (read.ok && read.changedSlugs.length > 0) {
      await options.onReload(read.changedSlugs, read);
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
