// Shell-proof sandbox image build: picks the Dockerfile variant for the host OS
// (win32 -> Dockerfile.windows, else Dockerfile) and runs docker build.
// Explicit DOCKERFILE env var overrides auto-detection.
// The image is stamped with a LABEL holding the sha256 of the Dockerfile it was
// built from, so the API can detect a stale image on disk (see
// apps/api/src/sandbox/image-stamp.ts).
// Usage: node sandbox/build.mjs  (via `pnpm sandbox:build`)
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectDockerfile } from "./select-dockerfile.mjs";

/** Label key holding the sha256 of the Dockerfile the image was built from. */
export const DOCKERFILE_SHA_LABEL = "sdlc.dockerfile-sha";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.env.DOCKERFILE ?? selectDockerfile();
const image = process.env.SANDBOX_IMAGE ?? "sdlc-ai-sandbox:local";
const docker = process.env.DOCKER_BIN ?? "docker";

const dockerfile = path.join(here, file);
const sha = createHash("sha256").update(fs.readFileSync(dockerfile)).digest("hex");

console.log(`==> building ${image} (sandbox/${file}, ${DOCKERFILE_SHA_LABEL}=${sha.slice(0, 12)})`);
const result = spawnSync(
  docker,
  ["build", "--label", `${DOCKERFILE_SHA_LABEL}=${sha}`, "-f", dockerfile, "-t", image, here],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
