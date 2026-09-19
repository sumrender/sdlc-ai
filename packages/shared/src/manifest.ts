import { z } from "zod";

export const ProjectManifestSchema = z.object({
  setup: z.array(z.string()).default([]),
  checks: z.array(z.string()).default([]),
  e2e: z.object({
    command: z.string().min(1),
    cwd: z.string().default("."),
    env: z.record(z.string()).default({}),
    artifacts: z.array(z.string()).default([]),
  }),
});
export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;

export const MANIFEST_PATH = ".sdlc/manifest.json";
