// smoke.sh helper: fail when sdlc.config.ts does not parse against ProjectsConfigSchema.
// Deploy-prefix drift is warn-only (same as the API boot path), never a failure.
import { ProjectsConfigSchema, buildProjectRow, deployOverlapWarnings, toProjectManifest } from "@sdlc-ai/shared";
import rawConfig from "../sdlc.config.js";

const configs = ProjectsConfigSchema.parse(rawConfig);
for (const config of configs) {
  const manifest = toProjectManifest(config);
  const row = buildProjectRow(config);
  for (const w of deployOverlapWarnings(row.deployTargets, manifest)) {
    console.warn(`[lint-config:${config.slug}] warning: ${w}`);
  }
}
console.log(`[lint-config] sdlc.config.ts ok (${configs.length} project(s))`);
