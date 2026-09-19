// Shell-proof sandbox image build: picks the Dockerfile variant for the host OS
// (win32 -> Dockerfile.windows, else Dockerfile) and runs docker build.
// Explicit DOCKERFILE env var overrides auto-detection.
// Usage: node sandbox/build.mjs  (via `pnpm sandbox:build`)
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectDockerfile } from "./select-dockerfile.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.env.DOCKERFILE ?? selectDockerfile();
const image = process.env.SANDBOX_IMAGE ?? "sdlc-ai-sandbox:local";
const docker = process.env.DOCKER_BIN ?? "docker";

console.log(`==> building ${image} (sandbox/${file})`);
const result = spawnSync(docker, ["build", "-f", path.join(here, file), "-t", image, here], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
