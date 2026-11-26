import { z } from "zod";
import { DeployTargetConfigSchema, MaxConcurrentTasksSchema, type DeployTargetConfig, type MaxConcurrentTasks } from "./domain";
import {
  E2eSchema,
  ProjectManifestSchema,
  StackManifestSchema,
  stackPaths,
  type ProjectManifest,
} from "./manifest";

export const ProjectSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase kebab-case")
  .min(1)
  .max(64);
export type ProjectSlug = z.infer<typeof ProjectSlugSchema>;

export const RepositorySchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  defaultBranch: z.string().min(1).default("main"),
});
export type Repository = z.infer<typeof RepositorySchema>;

export const GitHubProjectConfigSchema = z.object({
  tokenEnv: z.string().min(1).default("GITHUB_TOKEN"),
});
export type GitHubProjectConfig = z.infer<typeof GitHubProjectConfigSchema>;

export const RenderProviderConfigSchema = z.object({
  serviceId: z.string().min(1),
  apiKeyEnv: z.string().min(1).default("RENDER_API_KEY"),
  origin: z.string().min(1).nullable().default(null),
});
export type RenderProviderConfig = z.infer<typeof RenderProviderConfigSchema>;

export const CloudflareProviderConfigSchema = z.object({
  workerName: z.string().min(1),
  apiTokenEnv: z.string().min(1).default("CF_API_TOKEN"),
  accountIdEnv: z.string().min(1).default("CF_ACCOUNT_ID"),
  origin: z.string().min(1).nullable().default(null),
});
export type CloudflareProviderConfig = z.infer<typeof CloudflareProviderConfigSchema>;

export const DeployProvidersConfigSchema = z.object({
  render: RenderProviderConfigSchema.optional(),
  cloudflare: CloudflareProviderConfigSchema.optional(),
});
export type DeployProvidersConfig = z.infer<typeof DeployProvidersConfigSchema>;

export const ModelsSchema = z.object({
  developer: z.string().min(1),
  fast: z.string().min(1),
});
export type Models = z.infer<typeof ModelsSchema>;

export const SandboxSchema = z.object({
  image: z.string().min(1).optional(),
  reuse: z.boolean().default(true),
});
export type Sandbox = z.infer<typeof SandboxSchema>;

const RootSchema = z.object({
  setup: z.array(z.string()).default([]),
  checks: z.array(z.string()).default([]),
});

const StacksSchema = z.object({
  frontend: StackManifestSchema.optional(),
  backend: StackManifestSchema.optional(),
});

export const ProjectConfigSchema = z.object({
  slug: ProjectSlugSchema,
  name: z.string().min(1).optional(),
  version: z.number().int().optional(),
  repository: RepositorySchema,
  github: GitHubProjectConfigSchema.default({}),
  root: RootSchema.default({}),
  stacks: StacksSchema.default({}),
  e2e: E2eSchema.nullable().default(null),
  deploy: z.array(DeployTargetConfigSchema).default([]),
  deployProviders: DeployProvidersConfigSchema.default({}),
  models: ModelsSchema.optional(),
  sandbox: SandboxSchema.optional(),
  maxConcurrentTasks: MaxConcurrentTasksSchema.optional(),
});
export type ProjectConfig = z.output<typeof ProjectConfigSchema>;
export type ProjectConfigInput = z.input<typeof ProjectConfigSchema>;

export const ProjectsConfigSchema = z
  .array(ProjectConfigSchema)
  .min(1, "At least one project must be configured")
  .superRefine((projects, ctx) => {
    const seen = new Set<string>();
    projects.forEach((p, index) => {
      if (seen.has(p.slug)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "slug"],
          message: `Duplicate project slug "${p.slug}" — each project must have a unique slug`,
        });
      }
      seen.add(p.slug);
    });
  });

export function defineProjects(input: ProjectConfigInput[]): ProjectConfig[] {
  return ProjectsConfigSchema.parse(input);
}

export function toProjectManifest(config: ProjectConfig): ProjectManifest {
  return ProjectManifestSchema.parse({
    version: config.version,
    setup: config.root.setup,
    checks: config.root.checks,
    frontend: config.stacks.frontend,
    backend: config.stacks.backend,
    e2e: config.e2e,
  });
}

// ---- Project row ------------------------------------------------------------

export interface ProjectRowValues {
  slug: string;
  name: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  deployTargets: DeployTargetConfig[];
  maxConcurrentTasks?: MaxConcurrentTasks;
  reuseSandbox?: boolean;
}

/**
 * Single builder for a projects row. Boot syncing, db:seed, and the web
 * fixture all go through here so the row cannot drift between them.
 * A null deploy.url resolves from deployProviders.<provider>.origin.
 */
export function buildProjectRow(config: ProjectConfig): ProjectRowValues {
  const deployTargets = config.deploy.map((d) => {
    if (d.url != null) return d;
    const fallback =
      d.provider === "CLOUDFLARE"
        ? config.deployProviders.cloudflare?.origin
        : d.provider === "RENDER"
          ? config.deployProviders.render?.origin
          : undefined;
    return { ...d, url: fallback ?? null };
  });
  const row: ProjectRowValues = {
    slug: config.slug,
    name: config.name ?? config.repository.repo,
    owner: config.repository.owner,
    repo: config.repository.repo,
    defaultBranch: config.repository.defaultBranch,
    deployTargets,
  };
  if (config.maxConcurrentTasks !== undefined) row.maxConcurrentTasks = config.maxConcurrentTasks;
  if (config.sandbox?.reuse !== undefined) row.reuseSandbox = config.sandbox.reuse;
  return row;
}

// ---- Deploy overlap ---------------------------------------------------------

function normalizePrefix(prefix: string): string {
  return prefix
    .trim()
    .replace(/^(?:\.?\/)+/, "")
    .replace(/\/(\*\*?)?$/, "")
    .replace(/\/+$/, "");
}

/**
 * Load-time check: every deploy.pathPrefix must overlap a stack's paths.
 * Deploy matching (startsWith pathPrefix) and change scope (stackPaths) use
 * different prefixes, so an orphaned target silently never deploys. Returns
 * one warning per orphaned target; callers log and surface them in Settings,
 * never throw.
 */
export function deployOverlapWarnings(targets: DeployTargetConfig[], manifest: ProjectManifest): string[] {
  const owned = [...stackPaths(manifest.frontend), ...stackPaths(manifest.backend)]
    .map(normalizePrefix)
    .filter((p) => p.length > 0);
  const warnings: string[] = [];
  for (const t of targets) {
    const prefix = normalizePrefix(t.pathPrefix);
    const overlaps =
      prefix.length > 0 && owned.some((o) => prefix === o || prefix.startsWith(`${o}/`) || o.startsWith(`${prefix}/`));
    if (!overlaps) {
      warnings.push(
        `Deploy target ${t.target} watches "${t.pathPrefix}" which overlaps no stack paths (${owned.join(", ") || "no stacks declared"}); its deployments will never trigger`,
      );
    }
  }
  return warnings;
}

// ---- Content hash -----------------------------------------------------------

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

// Pure-TS sha256 so the API and the web fixture share one rev hash without a
// node:crypto import (shared/config.ts ships to the browser).
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
];

function sha256Hex(input: string): string {
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const data = new TextEncoder().encode(input);
  const bitLen = data.length * 8;
  const paddedLen = (((data.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(paddedLen - 4, bitLen >>> 0);
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  const W = (i: number): number => w[i]!;
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(W(i - 15), 7) ^ rotr(W(i - 15), 18) ^ (W(i - 15) >>> 3);
      const s1 = rotr(W(i - 2), 17) ^ rotr(W(i - 2), 19) ^ (W(i - 2) >>> 10);
      w[i] = (W(i - 16) + s0 + W(i - 7) + s1) | 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + SHA256_K[i]! + W(i)) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}

/** sha256 of the canonical manifest JSON: same content => same hash, any source. */
export function hashManifest(manifest: ProjectManifest): string {
  return sha256Hex(stableStringify(manifest));
}
