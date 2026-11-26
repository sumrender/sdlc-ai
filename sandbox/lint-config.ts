// smoke.sh helper: fail when sdlc.config.ts does not parse. Deploy-prefix
// drift is warn-only (same as the API boot path), never a failure.
import { buildProjectRow, deployOverlapWarnings, toProjectManifest } from "@sdlc-ai/shared";
import config from "../sdlc.config.js";

const manifest = toProjectManifest(config);
const row = buildProjectRow(config);
for (const w of deployOverlapWarnings(row.deployTargets, manifest)) console.warn(`[lint-config] warning: ${w}`);
console.log(
  `[lint-config] sdlc.config.ts ok (${manifest.setup.length} root setup, ${row.deployTargets.length} deploy targets)`,
);
