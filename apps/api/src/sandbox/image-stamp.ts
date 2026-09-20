import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SandboxImageStatus } from "@sdlc-ai/shared";
import { runProcess } from "./process.js";

/**
 * A stale Sandbox image degrades every run silently: tools the Dockerfile adds
 * (CHROME_BIN for `ng test`, the opencode musl shim, ...) are simply absent, and
 * the pipeline logs `Optional check ... skipped (runner missing)` and moves on.
 *
 * `pnpm sandbox:build` stamps the image with the sha256 of the Dockerfile it was
 * built from (see sandbox/build.mjs). Comparing that stamp against the Dockerfile
 * on disk turns "stale image" into a visible warning. This never blocks a run.
 */
export const DOCKERFILE_SHA_LABEL = "sdlc.dockerfile-sha";

const OK: SandboxImageStatus = { ok: true, warning: null };

/** Mirrors sandbox/select-dockerfile.mjs, which the API cannot import (plain JS, outside its tsconfig). */
function dockerfileVariant(): string {
  return process.env.DOCKERFILE ?? (process.platform === "win32" ? "Dockerfile.windows" : "Dockerfile");
}

/** Walks up from this module to the repo checkout. Returns null when running outside one. */
function findDockerfile(): string | null {
  const variant = dockerfileVariant();
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(dir, "sandbox", variant);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export async function checkSandboxImage(image: string, dockerBin: string): Promise<SandboxImageStatus> {
  const dockerfile = findDockerfile();
  // No checkout to compare against (e.g. a packaged deploy): nothing to warn about.
  if (!dockerfile) return OK;

  const expected = createHash("sha256").update(fs.readFileSync(dockerfile)).digest("hex");
  const format = `{{index .Config.Labels "${DOCKERFILE_SHA_LABEL}"}}`;

  let stdout: string;
  let exitCode: number;
  try {
    const result = await runProcess(dockerBin, ["image", "inspect", "--format", format, image]);
    stdout = result.stdout;
    exitCode = result.exitCode;
  } catch (e) {
    return { ok: false, warning: `could not run \`${dockerBin} image inspect ${image}\`: ${(e as Error).message}` };
  }

  if (exitCode !== 0) {
    return { ok: false, warning: `Sandbox image ${image} is not present locally. Run \`pnpm sandbox:build\`.` };
  }

  const stamp = stdout.trim();
  if (stamp === expected) return OK;

  const cause =
    stamp === "" || stamp === "<no value>"
      ? "it carries no build stamp, so it predates or bypassed `pnpm sandbox:build`"
      : `it was built from a different sandbox/${dockerfileVariant()} (image ${stamp.slice(0, 12)}, on disk ${expected.slice(0, 12)})`;
  return {
    ok: false,
    warning: `Sandbox image ${image} is stale: ${cause}. Checks that rely on image tooling (e.g. CHROME_BIN for \`ng test --browsers=ChromeHeadless\`) will be reported as "skipped (runner missing)". Run \`pnpm sandbox:build\`.`,
  };
}
